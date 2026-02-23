import { RateLimiterTier, RateLimiterConfig } from '../types';
import { RATE_LIMITER_CONFIG, GEMINI_TEXT_RATE_LIMITER_CONFIG, OPENAI_RATE_LIMITER_CONFIG } from '../constants';

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
}

/**
 * AIRateLimiter - Configurable rate limiter for AI API requests
 *
 * Implements a priority queue with tier-based configuration to manage
 * concurrent requests and prevent rate limiting from AI service providers.
 * Supports multiple independent instances for different providers.
 */
class AIRateLimiter {
  private queue: QueuedRequest[] = [];
  private activeRequests: number = 0;
  private requestTimestamps: number[] = [];
  private config: RateLimiterConfig;
  private isInCooldown: boolean = false;
  private cooldownEndTime: number = 0;
  private processingQueue: boolean = false;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  /**
   * Update the rate limiter configuration
   */
  setConfig(config: RateLimiterConfig): void {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueLength: number;
    activeRequests: number;
    requestsLastMinute: number;
    isInCooldown: boolean;
  } {
    this.cleanupOldTimestamps();
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      requestsLastMinute: this.requestTimestamps.length,
      isInCooldown: this.isInCooldown,
    };
  }

  /**
   * Acquire a slot in the rate limiter queue.
   * Higher priority values are processed first.
   */
  async acquire(priority: number = 0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request: QueuedRequest = {
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      };

      this.queue.push(request);
      this.sortQueue();
      this.processQueue();
    });
  }

  /**
   * Release a slot after completing a request
   */
  release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.processQueue();
  }

  /**
   * Handle rate limit error - enter cooldown mode
   */
  handleRateLimitError(): void {
    this.isInCooldown = true;
    this.cooldownEndTime = Date.now() + this.config.rateLimitCooldown;

    setTimeout(() => {
      this.isInCooldown = false;
      this.processQueue();
    }, this.config.rateLimitCooldown);
  }

  /**
   * Sort queue by priority (highest first), then by timestamp (oldest first)
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Clean up timestamps older than 1 minute
   */
  private cleanupOldTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
  }

  /**
   * Check if we can make a new request
   */
  private canMakeRequest(): boolean {
    if (this.isInCooldown) {
      return false;
    }

    if (this.activeRequests >= this.config.maxConcurrent) {
      return false;
    }

    this.cleanupOldTimestamps();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      return false;
    }

    return true;
  }

  /**
   * Get time until next request can be made
   */
  private getTimeUntilNextSlot(): number {
    if (this.isInCooldown) {
      return Math.max(0, this.cooldownEndTime - Date.now());
    }

    this.cleanupOldTimestamps();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      const oldestTimestamp = Math.min(...this.requestTimestamps);
      return Math.max(0, oldestTimestamp + 60000 - Date.now());
    }

    return this.config.minDelayBetweenRequests;
  }

  /**
   * Process the queue and dispatch requests
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;

    try {
      while (this.queue.length > 0 && this.canMakeRequest()) {
        const request = this.queue.shift();
        if (!request) break;

        this.activeRequests++;
        this.requestTimestamps.push(Date.now());
        request.resolve();

        // Add minimum delay between dispatches
        if (this.queue.length > 0 && this.config.minDelayBetweenRequests > 0) {
          await this.delay(this.config.minDelayBetweenRequests);
        }
      }

      // If queue still has items, schedule next processing
      if (this.queue.length > 0) {
        const waitTime = this.getTimeUntilNextSlot();
        setTimeout(() => this.processQueue(), waitTime);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear the queue (for cleanup/reset)
   */
  clearQueue(): void {
    for (const request of this.queue) {
      request.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    this.activeRequests = 0;
    this.requestTimestamps = [];
    this.isInCooldown = false;
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(
    fn: () => Promise<T>,
    priority: number = 0,
    retryOnRateLimit: boolean = true
  ): Promise<T> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.acquire(priority);

        try {
          const result = await fn();
          return result;
        } finally {
          this.release();
        }
      } catch (error) {
        lastError = error as Error;
        const isRateLimitError = this.isRateLimitError(error);

        if (isRateLimitError && retryOnRateLimit && attempt < maxRetries) {
          this.handleRateLimitError();

          // Exponential backoff with jitter
          const backoffDelay = Math.min(
            this.config.rateLimitCooldown * Math.pow(1.5, attempt) + Math.random() * 2000,
            60000
          );

          await this.delay(backoffDelay);
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('resource_exhausted') ||
        message.includes('too many requests')
      );
    }
    return false;
  }
}

// ============================================
// Tier Detection
// ============================================

const detectTier = (): RateLimiterTier => {
  const tierEnv = process.env.GEMINI_TIER;
  if (tierEnv === 'tier2') return 'tier2';
  if (tierEnv === 'paid' || tierEnv === 'tier1') return 'paid';
  if (tierEnv === 'free') return 'free';

  const isPaidTier = process.env.GEMINI_PAID_TIER === 'true';
  return isPaidTier ? 'paid' : 'free';
};

// ============================================
// Provider-Specific Singleton Instances
// ============================================

let geminiImageLimiter: AIRateLimiter | null = null;
let geminiTextLimiter: AIRateLimiter | null = null;
let openaiLimiter: AIRateLimiter | null = null;

/**
 * Rate limiter for Gemini image generation (strict IPM limits)
 */
export const getGeminiImageRateLimiter = (): AIRateLimiter => {
  if (!geminiImageLimiter) {
    const tier = detectTier();
    geminiImageLimiter = new AIRateLimiter(RATE_LIMITER_CONFIG[tier]);
  }
  return geminiImageLimiter;
};

/**
 * Rate limiter for Gemini text/vision API calls (QA, analysis, prompts)
 * Much more generous limits than image generation
 */
export const getGeminiTextRateLimiter = (): AIRateLimiter => {
  if (!geminiTextLimiter) {
    const tier = detectTier();
    geminiTextLimiter = new AIRateLimiter(GEMINI_TEXT_RATE_LIMITER_CONFIG[tier]);
  }
  return geminiTextLimiter;
};

/**
 * Rate limiter for OpenAI API calls (only used when gpt-image model is selected)
 */
export const getOpenAIRateLimiter = (): AIRateLimiter => {
  if (!openaiLimiter) {
    openaiLimiter = new AIRateLimiter(OPENAI_RATE_LIMITER_CONFIG);
  }
  return openaiLimiter;
};

/**
 * Update tier for all rate limiters
 */
export const setAllTiers = (tier: RateLimiterTier): void => {
  if (geminiImageLimiter) {
    geminiImageLimiter.setConfig(RATE_LIMITER_CONFIG[tier]);
  }
  if (geminiTextLimiter) {
    geminiTextLimiter.setConfig(GEMINI_TEXT_RATE_LIMITER_CONFIG[tier]);
  }
};

/**
 * Backward-compatible getter (defaults to Gemini image rate limiter)
 */
export const getRateLimiter = getGeminiImageRateLimiter;

// Export class for testing
export { AIRateLimiter };

// Priority constants for convenience
// QA checks run after generation and block the pipeline (regen waits on QA),
// so they need priority above prompt work but below active generation.
export const PRIORITY = {
  IMAGE_GENERATION: 10,
  QA_CHECK: 5,
  PROMPT_REIMAGINATION: 3,
  PROMPT_REFINEMENT: 2,
  PRODUCT_ANALYSIS: 1,
} as const;
