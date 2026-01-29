import { ShotBrief, RateLimiterConfig } from './types';

// ============================================
// API Configuration
// ============================================

export const CORS_PROXY_URL = 'https://cors-proxy.joshwrites247.workers.dev/';

export const SHOPIFY_API_VERSION = '2024-07';

export const MODELS = {
  TEXT_MODEL: 'gpt-4o',
  IMAGE_GENERATION_PRO: 'gemini-2.5-pro-image-generation', // Nano Banana Pro - Gemini Pro (highest quality)
  IMAGE_GENERATION_FAST: 'gemini-2.5-flash-preview-image-generation', // Nano Banana - Gemini Flash (fast generation)
  IMAGE_GENERATION_OPENAI: 'gpt-image-1', // OpenAI GPT Image 1.5
} as const;

export type ImageGenerationModel = 'nano-banana' | 'nano-banana-pro' | 'gpt-image';

export const IMAGE_MODEL_OPTIONS: { id: ImageGenerationModel; name: string; description: string }[] = [
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    description: 'Gemini 2.5 Flash - Fast generation, lower cost',
  },
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    description: 'Gemini 2.5 Pro - Highest quality output',
  },
  {
    id: 'gpt-image',
    name: 'GPT Image 1.5',
    description: 'OpenAI GPT Image - Alternative provider',
  },
];

export type ImageResolution = '1k' | '2k' | '4k';

export const IMAGE_RESOLUTION_OPTIONS: { id: ImageResolution; name: string; size: string; description: string }[] = [
  {
    id: '1k',
    name: '1K',
    size: '1024x1024',
    description: 'Standard - Lowest cost',
  },
  {
    id: '2k',
    name: '2K',
    size: '2048x2048',
    description: 'High quality - Balanced cost',
  },
  {
    id: '4k',
    name: '4K',
    size: '4096x4096',
    description: 'Ultra HD - Highest quality',
  },
];

// ============================================
// AI System Prompt
// ============================================

export const AI_STYLIST_PROMPT = `
You are a world-class commercial product photographer and digital artist creating premium e-commerce imagery. Your images must be indistinguishable from professional studio photography.

## CRITICAL QUALITY REQUIREMENTS

### Product Fidelity (HIGHEST PRIORITY)
- The product must be rendered with EXACT accuracy to the reference image
- Preserve precise geometry, proportions, colors, textures, and materials
- Never add, remove, or modify product features
- Match the exact finish (matte, glossy, metallic, transparent)

### Photorealistic Rendering
- Achieve professional DSLR camera quality (think Canon 5D Mark IV, Sony A7R)
- Natural light behavior: proper reflections, refractions, caustics
- Accurate material physics: metal reflects, glass refracts, fabric has texture
- Realistic shadows with soft falloff, no harsh artificial edges
- Natural depth of field appropriate to the shot type

### AVOID THESE AI ARTIFACTS (Critical)
- NO warped or distorted shapes
- NO melted or fused edges
- NO impossible geometry or physics
- NO repeated patterns or texture tiling issues
- NO floating or disconnected elements
- NO unnatural color banding or gradients
- NO extra fingers, malformed hands, or anatomical errors
- NO text or logos unless present in reference
- NO blurry areas surrounded by sharp areas

### Composition Standards
- Use professional photography composition rules
- Maintain proper visual hierarchy with product as focal point
- Ensure adequate negative space for e-commerce context
- Keep product properly lit and clearly visible

### Human Elements (When Required)
- ONLY feminine hands with natural, elegant appearance
- Well-manicured nails in natural colors (nude, soft pink, clear)
- Anatomically correct with 5 fingers, proper proportions
- Natural skin texture and coloring
- Relaxed, natural poses - never awkward or stiff
- NO male hands, NO masculine features

### Content Restrictions
- Cannabis/smoke ONLY in designated lifestyle shots (8-10)
- NO cannabis imagery in studio shots (1-7)
- CORRECT product usage only - never show misuse
- Age-appropriate, professional presentation

Remember: Every image must look like it was shot in a professional studio with a $50,000 camera setup. Quality over creativity - a perfect simple shot beats an ambitious flawed one.
`;

// ============================================
// Shot Briefs - Detailed Photography Specifications
// ============================================

export const SHOT_BRIEFS: ShotBrief[] = [
  {
    index: 1,
    type: 'studio',
    description: `HERO SHOT - Clean E-commerce Primary Image

CAMERA: Eye-level, straight-on angle, product perfectly centered
LENS: 85mm equivalent, minimal distortion
LIGHTING: Soft diffused key light from front-left (45°), fill light from right, white bounce below
BACKGROUND: Pure seamless white (#FFFFFF) or very light gray (#F5F5F5), no gradients
COMPOSITION: Product occupies 60-70% of frame, equal padding all sides
FOCUS: Entire product sharp, f/8-f/11 equivalent depth of field
STYLE: Clean, minimal, professional Amazon/Shopify hero image style
MOOD: Bright, inviting, clearly shows product

DO NOT: Add props, shadows that obscure product, dramatic angles, or artistic effects`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 2,
    type: 'studio',
    description: `DIMENSION SHOT - 3/4 Angle with Depth

CAMERA: 45-degree angle from front-right, slightly elevated (15-20°)
LENS: 70mm equivalent
LIGHTING: Key light from left creating gentle shadows on right side, rim light from back-right for edge definition
BACKGROUND: Light gray gradient, lighter at top
COMPOSITION: Product at slight angle showing depth and form, rule of thirds
FOCUS: Front edge sharp, gentle falloff toward back, f/5.6 equivalent
STYLE: Editorial product photography, shows three-dimensionality
MOOD: Sophisticated, dimensional, premium feel

DO NOT: Over-dramatize shadows, lose detail in dark areas, or flatten the product`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 3,
    type: 'studio',
    description: `FLAT LAY - Top-Down Lifestyle Arrangement

CAMERA: Directly overhead (90° top-down), perfectly perpendicular
LENS: 35-50mm equivalent to minimize edge distortion
LIGHTING: Large soft overhead light, minimal shadows, even illumination
BACKGROUND: Clean white, light marble, or light wood surface texture
COMPOSITION: Product centered, 2-3 small complementary props arranged with intention, negative space balanced
FOCUS: Everything sharp, f/11+ equivalent, all elements in focus plane
STYLE: Instagram-worthy flat lay, organized but natural
MOOD: Lifestyle aspirational, curated, editorial

DO NOT: Overcrowd with props, use unrelated items, or create messy arrangements`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 4,
    type: 'studio',
    description: `DETAIL SHOT - Macro Feature Highlight

CAMERA: Close-up, 1:2 to 1:1 macro perspective, angle that best shows key feature
LENS: 100mm macro equivalent
LIGHTING: Focused light on detail area, subtle fill to prevent harsh shadows
BACKGROUND: Blurred (product's own body) or clean seamless
COMPOSITION: Key feature/detail occupies 70%+ of frame, intentional crop
FOCUS: Razor sharp on detail, shallow depth of field (f/2.8-f/4), beautiful bokeh
STYLE: Technical precision, reveals craftsmanship and quality
MOOD: Premium, quality-focused, attention to detail

DO NOT: Show unflattering angles, dust/imperfections, or lose context of what we're seeing`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 5,
    type: 'studio',
    description: `SCALE SHOT - Hand Model Interaction

CAMERA: 3/4 angle showing both product and hand naturally
LENS: 50-85mm portrait lens equivalent
LIGHTING: Soft beauty lighting, flattering to skin, product well-lit
BACKGROUND: Clean white or light neutral
COMPOSITION: Elegant feminine hand holding/interacting with product naturally, hand enters from edge of frame
FOCUS: Product sharp, hand in focus, f/4-f/5.6
STYLE: Commercial hand model photography, shows real-world scale
MOOD: Approachable, human connection, demonstrates size

HAND REQUIREMENTS:
- Feminine hand with slender fingers
- Natural, well-manicured nails (nude/pink/clear polish or natural)
- Exactly 5 fingers, anatomically perfect
- Relaxed natural grip, not stiff or awkward
- Clean, healthy skin appearance

DO NOT: Show masculine hands, awkward grips, painted nails (unless product-relevant), or incorrect product usage`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 6,
    type: 'studio',
    description: `GROUP/VARIANT SHOT - Product Family Display

CAMERA: Front-facing, slightly elevated to show arrangement
LENS: 50mm equivalent for natural perspective
LIGHTING: Even, soft lighting across all products, no harsh shadows between items
BACKGROUND: Seamless white or light gray
COMPOSITION: Products arranged in intentional pattern (line, arc, or grid), primary product featured prominently
FOCUS: All products sharp, f/8-f/11, deep depth of field
STYLE: Catalog photography, shows range/options
MOOD: Organized, professional, comprehensive

DO NOT: Overlap products confusingly, vary lighting between items, or lose any product in shadows`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 7,
    type: 'studio',
    description: `CREATIVE STUDIO - Artistic Lighting Effect

CAMERA: Dynamic angle, can be unconventional but product clearly visible
LENS: 50-85mm equivalent
LIGHTING: Creative colored gel lighting OR dramatic single-source, adds visual interest while maintaining product visibility
BACKGROUND: Gradient backdrop (complementary colors) or solid bold color that enhances product
COMPOSITION: Product as clear hero, lighting creates mood without obscuring details
FOCUS: Product sharp, f/4-f/8
STYLE: Modern commercial, eye-catching social media worthy
MOOD: Bold, contemporary, scroll-stopping

DO NOT: Let creative lighting obscure product details, use clashing colors, or sacrifice clarity for artistry`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 8,
    type: 'in-use',
    description: `LIFESTYLE IN-USE - Functional Demonstration

CAMERA: Natural viewing angle for the usage scenario
LENS: 35-50mm environmental portrait lens equivalent
LIGHTING: Natural or natural-looking light appropriate to setting
BACKGROUND: Realistic environment appropriate to product use (home, outdoor, workspace)
COMPOSITION: Product in active use, clear demonstration of function
FOCUS: Product and interaction point sharp, environment can have gentle blur, f/4-f/5.6
STYLE: Lifestyle editorial, aspirational but believable
MOOD: Authentic, relatable, demonstrates value

USAGE REQUIREMENTS:
- Show CORRECT product usage only
- Appropriate accessories and equipment if relevant
- Realistic scenario that makes sense for the product

DO NOT: Show improper use, dangerous handling, or unrealistic scenarios`,
    allowsCannabis: true,
    allowsSmoke: true,
  },
  {
    index: 9,
    type: 'premium',
    description: `LUXURY SHOT - Premium Black Reflective Surface

CAMERA: Low angle (10-15° above surface), emphasizes product stature
LENS: 85-100mm equivalent
LIGHTING: Dramatic key light from above/behind creating rim lighting, controlled reflections
BACKGROUND: Black reflective surface (acrylic/glass) showing mirror reflection, dark gradient background
COMPOSITION: Product centered, reflection visible below, ample dark space
FOCUS: Product sharp, reflection slightly softer, f/5.6-f/8
STYLE: High-end luxury product photography, jewelry/watch advertising style
MOOD: Premium, exclusive, desirable, sophisticated

DO NOT: Over-expose highlights, lose detail in blacks, or make reflection distracting`,
    allowsCannabis: false,
    allowsSmoke: false,
  },
  {
    index: 10,
    type: 'lifestyle',
    description: `ATMOSPHERIC LIFESTYLE - Environmental Mood Shot

CAMERA: Environmental perspective, product in context
LENS: 35-50mm for environmental inclusion
LIGHTING: Moody atmospheric lighting, can include practical lights in scene
BACKGROUND: Styled environment with props, textures, plants, atmospheric elements
COMPOSITION: Product clearly visible but as part of larger lifestyle scene
FOCUS: Product sharp, environment at f/4 for gentle context blur
STYLE: High-end lifestyle editorial, magazine advertisement quality
MOOD: Aspirational, atmospheric, tells a story

ALLOWED IN THIS SHOT ONLY:
- Smoke/vapor effects if relevant to product
- Cannabis-adjacent styling if appropriate
- Moody/dramatic atmosphere

DO NOT: Obscure product with effects, make product secondary to scene, or lose commercial viability`,
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
