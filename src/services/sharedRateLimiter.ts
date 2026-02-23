import { RateLimiterTier, RateLimiterConfig } from '../types';
import { RATE_LIMITER_CONFIG } from '../constants';

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
}

/**
 * SharedGeminiRateLimiter - Singleton rate limiter for all AI API requests
 *
 * Implements a priority queue with tier-based configuration to manage
 * concurrent requests and prevent rate limiting from AI service providers.
 */
class SharedGeminiRateLimiter {
  private static instance: SharedGeminiRateLimiter | null = null;

  private queue: QueuedRequest[] = [];
  private activeRequests: number = 0;
  private requestTimestamps: number[] = [];
  private config: RateLimiterConfig;
  private tier: RateLimiterTier;
  private isInCooldown: boolean = false;
  private cooldownEndTime: number = 0;
  private processingQueue: boolean = false;

  private constructor() {
    this.tier = this.detectTier();
    this.config = RATE_LIMITER_CONFIG[this.tier];
    // Rate limiter ready with configured tier
  }

  static getInstance(): SharedGeminiRateLimiter {
    if (!SharedGeminiRateLimiter.instance) {
      SharedGeminiRateLimiter.instance = new SharedGeminiRateLimiter();
    }
    return SharedGeminiRateLimiter.instance;
  }

  private detectTier(): RateLimiterTier {
    // Check for specific tier setting first
    const tierEnv = process.env.GEMINI_TIER;
    if (tierEnv === 'tier2') return 'tier2';
    if (tierEnv === 'paid' || tierEnv === 'tier1') return 'paid';
    if (tierEnv === 'free') return 'free';

    // Fallback to legacy env var
    const isPaidTier = process.env.GEMINI_PAID_TIER === 'true';
    return isPaidTier ? 'paid' : 'free';
  }

  /**
   * Set the tier configuration manually
   */
  setTier(tier: RateLimiterTier): void {
    this.tier = tier;
    this.config = RATE_LIMITER_CONFIG[tier];
    // Tier configuration updated
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimiterConfig & { tier: RateLimiterTier } {
    return { ...this.config, tier: this.tier };
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
   * Acquire a slot in the rate limiter queue
   * Higher priority values are processed first
   *
   * Priority levels:
   * - 10: Image generation (highest)
   * - 3: Prompt reimagination
   * - 2: Prompt refinement
   * - 1: Product analysis
   * - 0: QA checks (lowest)
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

          // Retrying after rate limit backoff
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

// Export singleton instance getter
export const getRateLimiter = (): SharedGeminiRateLimiter => {
  return SharedGeminiRateLimiter.getInstance();
};

// Export class for testing
export { SharedGeminiRateLimiter };

// Priority constants for convenience
export const PRIORITY = {
  IMAGE_GENERATION: 10,
  PROMPT_REIMAGINATION: 3,
  PROMPT_REFINEMENT: 2,
  PRODUCT_ANALYSIS: 1,
  QA_CHECK: 0,
} as const;
