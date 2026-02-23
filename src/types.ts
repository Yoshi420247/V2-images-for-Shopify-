// ============================================
// Shopify Domain Types
// ============================================

export interface ShopifyCredentials {
  storeUrl: string;
  accessToken: string;
  proxyUrl: string;
}

export interface ShopifyImage {
  id: number;
  src: string;
  position?: number;
  alt?: string | null;
  width?: number;
  height?: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  images: ShopifyImage[];
  product_type: string;
  body_html: string;
  vendor: string;
  status: 'active' | 'archived' | 'draft';
  handle?: string;
  tags?: string;
}

export interface ShopifyCollection {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  image: ShopifyImage | null;
  products_count?: number;
  collection_type: 'smart' | 'custom';
}

// ============================================
// AI Analysis Types
// ============================================

export interface ProductAnalysis {
  description: string;
  estimatedSize: string;
  useCases: string[];
  sources?: { uri: string; title: string }[];
}

export interface CollectionAnalysis {
  collectionTheme: string;
  targetAudience: string;
  visualStyle: string;
  keyProducts: string[];
  marketingAngle: string;
  suggestedImageConcept: string;
}

// ============================================
// Quality Assurance Types
// ============================================

export interface QAInfo {
  isApproved: boolean;
  reasoning: string;
}

export interface CollectionQAResult {
  isApproved: boolean;
  categoryMatch: number;
  realismScore: number;
  issues: string[];
  suggestions: string[];
  reasoning: string;
}

// ============================================
// Generation Settings Types
// ============================================

export type BackgroundOption =
  | { type: 'default' }
  | { type: 'transparent' }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[] }
  | { type: 'custom'; description: string };

export interface ProductRangeSelection {
  start: number;
  end: number;
}

export type ImageGenerationModel = 'nano-banana' | 'nano-banana-pro' | 'gpt-image';
export type ImageResolution = '1k' | '2k' | '4k';

export interface GenerationSettings {
  numToGenerate: number;
  uploadMode: 'replace' | 'append';
  backgroundOption: BackgroundOption;
  preserveOriginalImage: boolean;
  productRange?: ProductRangeSelection;
  parallelProducts: number;
  brandGuidelines?: string;
  imageModel?: ImageGenerationModel;
  imageResolution?: ImageResolution;
  maxAutoRetries?: number;
  skipMinImages?: number;
}

// ============================================
// Generated Image Types
// ============================================

export interface GeneratedImage {
  id: string;
  base64: string;
  imageUrl?: string;
  prompt: string;
  originalPrompt?: string;
  status: 'generating' | 'success' | 'error' | 'uploading' | 'uploaded' | 'qa_failed';
  error?: string;
  isApproved: boolean;
  selectedForUpload: boolean;
  qaInfo: QAInfo | null;
  regenerationCount: number;
}

export interface CollectionGeneratedImage {
  id: string;
  base64: string;
  imageUrl?: string;
  prompt: string;
  status: 'generating' | 'success' | 'error' | 'uploading' | 'uploaded' | 'qa_failed';
  error?: string;
  qaResult: CollectionQAResult | null;
  regenerationCount: number;
}

// ============================================
// Product Generation State Types
// ============================================

export interface ProductGenerationState {
  sourceImageBase64s: string[] | null;
  analysis: ProductAnalysis | null;
  generatedImages: GeneratedImage[];
  isGenerating: boolean;
  isAnalyzed: boolean;
  error: string | null;
}

// ============================================
// Job Types
// ============================================

export type JobStatus =
  | 'queued'
  | 'analyzing_products'
  | 'generating_images'
  | 'completed'
  | 'failed'
  | 'stopping'
  | 'stopped';

export interface GenerationJob {
  id: string;
  name: string;
  status: JobStatus;
  productIds: number[];
  settings: GenerationSettings;
  creationDate: string;
  productStates: Record<number, ProductGenerationState>;
  error?: string;
  storeUrl?: string;
}

// ============================================
// Collection Generation Types
// ============================================

export type CollectionGenerationStatus =
  | 'pending'
  | 'queued'
  | 'analyzing'
  | 'generating'
  | 'uploading'
  | 'completed'
  | 'error';

/**
 * Market context for tailoring imagery to specific niches
 */
export interface MarketContext {
  industry: string; // e.g., "cannabis smokeshop", "cannabis extraction", "vape retail"
  brandIdentity?: string; // Brand-specific guidelines
  targetDemographic?: string; // e.g., "medical users", "recreational enthusiasts"
  aestheticPreferences?: string; // e.g., "modern minimalist", "rustic organic"
  avoidElements?: string[]; // Things to avoid in imagery
}

export interface CollectionGenerationState {
  collection: ShopifyCollection;
  sampleProducts: ShopifyProduct[];
  analysis: CollectionAnalysis | null;
  generatedImage: CollectionGeneratedImage | null;
  status: CollectionGenerationStatus;
  error: string | null;
  userFeedback?: string; // User's feedback for regeneration
  marketContext?: MarketContext; // Market targeting context
}

/**
 * Queued collection for batch processing
 */
export interface QueuedCollection {
  collectionId: number;
  priority: number;
  addedAt: Date;
}

// ============================================
// Collection Plan Types (for pipeline)
// ============================================

export interface CollectionPlan {
  analysis: CollectionAnalysis;
  imageRequirements: {
    mustInclude: string[];
    mustAvoid: string[];
    colorPalette: string[];
    composition: string;
    lighting: string;
    realisticElements: string[];
  };
  qualityCriteria: {
    categoryFit: string;
    realismChecks: string[];
    brandAlignment: string;
  };
}

// ============================================
// App View State Types
// ============================================

export type AppView =
  | { state: 'CONNECTING' }
  | { state: 'LOADING'; message: string }
  | { state: 'DASHBOARD' }
  | { state: 'CREATING_JOB' }
  | { state: 'VIEWING_JOB'; jobId: string }
  | { state: 'COLLECTION_MANAGER' };

// ============================================
// Rate Limiter Types
// ============================================

export type RateLimiterTier = 'free' | 'paid' | 'tier2';

export interface RateLimiterConfig {
  maxConcurrent: number;
  minDelayBetweenRequests: number;
  maxRequestsPerMinute: number;
  rateLimitCooldown: number;
}

// ============================================
// Shot Brief Types
// ============================================

export interface ShotBrief {
  index: number;
  type: 'studio' | 'in-use' | 'premium' | 'lifestyle';
  description: string;
  allowsCannabis: boolean;
  allowsSmoke: boolean;
}

// ============================================
// API Response Types
// ============================================

export interface ShopifyApiResponse<T> {
  data: T;
  headers: Headers;
}

export interface GeminiGenerationResult {
  base64: string;
  prompt: string;
  originalPrompt?: string;
  qaInfo: QAInfo | null;
}

// ============================================
// Supabase Types
// ============================================

export interface SupabaseJobRecord {
  id: string;
  name: string;
  status: JobStatus;
  product_ids: number[];
  settings: GenerationSettings;
  creation_date: string;
  product_states: Record<number, ProductGenerationState>;
  error?: string;
  store_url?: string;
}

// ============================================
// Event Handler Types
// ============================================

export type JobUpdater = (job: GenerationJob) => GenerationJob;
export type SetStatusCallback = (status: string) => void;
