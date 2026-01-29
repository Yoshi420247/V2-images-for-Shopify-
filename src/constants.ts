import { ShotBrief, RateLimiterConfig } from './types';

// ============================================
// API Configuration
// ============================================

export const CORS_PROXY_URL = 'https://cors-proxy.joshwrites247.workers.dev/';

export const SHOPIFY_API_VERSION = '2024-07';

export const MODELS = {
  TEXT_MODEL: 'gpt-5.1',
  IMAGE_GENERATION: 'gemini-3-pro-image-preview',
  IMAGE_GENERATION_FAST: 'gemini-2.5-flash-preview-image-generation', // "Nano Banana" - faster, lower cost
} as const;

export type ImageGenerationModel = 'gemini-3-pro' | 'nano-banana';

export const IMAGE_MODEL_OPTIONS: { id: ImageGenerationModel; name: string; description: string }[] = [
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    description: 'Highest quality, best for final production images',
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    description: 'Gemini 2.5 Flash - Faster generation, lower cost',
  },
];

// ============================================
// AI System Prompt
// ============================================

export const AI_STYLIST_PROMPT = `
You are a world-class e-commerce art director and photographer AI specializing in high-end product photography for online stores. Your role is to analyze products and create stunning, commercially effective product images that drive sales.

Core Directives:

1. **Product Integrity is Absolute:** You must preserve the exact geometry, material, texture, color, and proportions of the product. Never alter, distort, or misrepresent the product in any way. The customer must receive exactly what they see.

2. **Scale Accuracy is Crucial:** Always depict products at their realistic size relative to any other elements in the frame. A small accessory should look small, a large appliance should look appropriately sized. Use visual cues and props scaled correctly to communicate size.

3. **Photorealistic Quality:** All images must achieve professional photography standards:
   - Perfect lighting with natural shadows
   - Accurate material rendering (glass should look like glass, metal like metal)
   - Proper depth of field and focus
   - No artifacts, distortions, or AI-generated anomalies

4. **In-Use Shots (When Specified):** When showing products in use:
   - Demonstrate CORRECT usage only
   - Use appropriate equipment and accessories
   - Show realistic scenarios that match the product's intended purpose
   - Never show improper, dangerous, or incorrect usage

5. **Cannabis/Smoke Content:** Cannabis plant imagery and smoke effects are ONLY permitted in designated lifestyle shots (typically shots 8-10). Never include cannabis or smoke in standard studio shots (1-7).

6. **No Male Characters:** If human elements are required, use only feminine hands or female models. No male characters or masculine hands should appear in any image.

7. **Hand Model Quality:** When hands appear:
   - Use elegant, well-manicured feminine hands
   - Natural nail colors (clear, soft pink, or nude)
   - No jewelry or minimal, tasteful jewelry
   - Proper proportion to the product
   - Natural, relaxed poses

Remember: You are creating commercial imagery that must be accurate, appealing, and drive purchase decisions. Every image should make the viewer want to buy the product.
`;

// ============================================
// Shot Briefs
// ============================================

export const SHOT_BRIEFS: ShotBrief[] = [
  {
    index: 1,
    type: 'studio',
    description: 'Clean, minimal hero shot on seamless white or light gray background. Product centered with soft, even lighting. Focus on showcasing the product\'s form and design details.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 2,
    type: 'studio',
    description: '45-degree angle product shot with dramatic side lighting creating depth and dimension. Emphasize textures and materials.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 3,
    type: 'studio',
    description: 'Top-down flat lay composition with complementary accessories or styling elements. Clean, organized aesthetic.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 4,
    type: 'studio',
    description: 'Close-up macro shot highlighting key features, craftsmanship, or unique design elements. Sharp focus on details.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 5,
    type: 'studio',
    description: 'Product shown with scale reference - feminine hand holding or interacting with the product to demonstrate size and ergonomics.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 6,
    type: 'studio',
    description: 'Multiple angle compilation or product family shot if applicable. Clean arrangement showing product versatility.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 7,
    type: 'studio',
    description: 'Creative studio shot with colored gel lighting or gradient backdrop. Modern, eye-catching aesthetic while keeping focus on product.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 8,
    type: 'in-use',
    description: 'Lifestyle in-use shot showing product being used correctly with proper equipment. Demonstrate functionality in a realistic setting.',
    allowsCannabis: true,
    allowsSmoke: true,
  },
  {
    index: 9,
    type: 'premium',
    description: 'Premium aesthetic shot on reflective black surface with dramatic lighting. High-end, luxurious feel.',
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 10,
    type: 'lifestyle',
    description: 'Atmospheric lifestyle shot with environmental context. May include ambient smoke, plants, or lifestyle elements appropriate to product category.',
    allowsCannabis: true,
    allowsSmoke: true,
  },
];

// ============================================
// Rate Limiter Configuration
// ============================================

export const RATE_LIMITER_CONFIG: Record<'free' | 'paid', RateLimiterConfig> = {
  free: {
    maxConcurrent: 1,
    minDelayBetweenRequests: 12000,
    maxRequestsPerMinute: 2,
    rateLimitCooldown: 60000,
  },
  paid: {
    maxConcurrent: 3,
    minDelayBetweenRequests: 4000,
    maxRequestsPerMinute: 15,
    rateLimitCooldown: 10000,
  },
};

// ============================================
// Generation Defaults
// ============================================

export const DEFAULT_GENERATION_SETTINGS = {
  numToGenerate: 4,
  uploadMode: 'append' as const,
  backgroundOption: { type: 'default' as const },
  preserveOriginalImage: true,
  parallelProducts: 1,
};

// ============================================
// Retry Configuration
// ============================================

export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5,
};

// ============================================
// Local Storage Keys
// ============================================

export const STORAGE_KEYS = {
  SHOPIFY_CREDENTIALS: 'shopify_credentials',
  JOBS: 'generation_jobs',
  GENERATION_SETTINGS: 'generation_settings',
};

// ============================================
// UI Constants
// ============================================

export const MAX_IMAGES_PER_PRODUCT = 12;
export const MIN_IMAGES_PER_PRODUCT = 1;
export const DEFAULT_PARALLEL_PRODUCTS = 1;
export const MAX_PARALLEL_PRODUCTS = 20;

// ============================================
// Background Options
// ============================================

export const PRESET_BACKGROUND_COLORS = [
  { name: 'White', value: '#FFFFFF' },
  { name: 'Light Gray', value: '#F5F5F5' },
  { name: 'Soft Cream', value: '#FAF9F6' },
  { name: 'Cool Gray', value: '#E8E8E8' },
  { name: 'Warm White', value: '#FFFDF9' },
  { name: 'Black', value: '#000000' },
  { name: 'Charcoal', value: '#2D2D2D' },
];

export const PRESET_GRADIENTS = [
  { name: 'Soft Light', colors: ['#FFFFFF', '#F0F0F0'] },
  { name: 'Warm Fade', colors: ['#FFF8F0', '#FFE8D6'] },
  { name: 'Cool Blue', colors: ['#E8F4FD', '#D1E8F8'] },
  { name: 'Luxe Dark', colors: ['#1A1A2E', '#16213E'] },
  { name: 'Sunset Glow', colors: ['#FFF5EB', '#FFE5D9'] },
];

// ============================================
// Status Messages
// ============================================

export const STATUS_MESSAGES = {
  CONNECTING: 'Connecting to Shopify...',
  LOADING_PRODUCTS: 'Loading products...',
  ANALYZING: 'Analyzing product...',
  GENERATING: 'Generating images...',
  UPLOADING: 'Uploading to Shopify...',
  QUALITY_CHECK: 'Performing quality check...',
  COMPLETE: 'Complete!',
  ERROR: 'An error occurred',
};

// ============================================
// QA Thresholds
// ============================================

export const QA_THRESHOLDS = {
  MIN_CATEGORY_MATCH: 7,
  MIN_REALISM_SCORE: 7,
  MAX_AUTO_REGENERATIONS: 3,
};
