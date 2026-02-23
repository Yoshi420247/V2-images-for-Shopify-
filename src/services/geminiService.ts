import {
  ProductAnalysis,
  BackgroundOption,
  QAInfo,
  GeminiGenerationResult,
  ImageGenerationModel,
  ImageResolution,
} from '../types';
import { getGeminiImageRateLimiter, getGeminiTextRateLimiter, getOpenAIRateLimiter, PRIORITY } from './sharedRateLimiter';
import { MODELS, AI_STYLIST_PROMPT, SHOT_BRIEFS } from '../constants';
import {
  getGeminiClient,
  getOpenAIClient,
  extractAndParseGeminiJson,
  extractGeminiText,
  extractGeminiImage,
  stripDataUrlPrefix,
} from './apiClients';

/**
 * Get the Gemini model ID for the selected model type
 */
const getGeminiModelId = (model?: ImageGenerationModel): string => {
  if (model === 'nano-banana-pro') {
    return MODELS.IMAGE_GENERATION_PRO;
  }
  // Default to fast model (Nano Banana)
  return MODELS.IMAGE_GENERATION_FAST;
};

/**
 * Get the image resolution dimensions
 */
const getResolutionSize = (resolution?: ImageResolution): number => {
  switch (resolution) {
    case '4k':
      return 4096;
    case '2k':
      return 2048;
    case '1k':
    default:
      return 1024;
  }
};

// ============================================
// Error Handling
// ============================================

const handleGeminiError = (error: unknown): Error => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('api key') || message.includes('authentication')) {
      return new Error(
        'Invalid API key. Please check your API key configuration.'
      );
    }

    if (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('resource_exhausted')
    ) {
      return new Error(
        'Rate limit exceeded. The system will automatically retry. Consider upgrading to paid tier for higher limits.'
      );
    }

    if (message.includes('safety') || message.includes('blocked')) {
      return new Error(
        'Content was blocked by safety filters. Try adjusting the prompt or image content.'
      );
    }

    return error;
  }

  return new Error('An unknown error occurred with the AI service');
};

// ============================================
// Helper: Prepare Gemini image parts
// ============================================

const toGeminiImageParts = (base64s: string[]) =>
  base64s.map((base64) => ({
    inlineData: {
      mimeType: 'image/jpeg' as const,
      data: stripDataUrlPrefix(base64),
    },
  }));

// ============================================
// Product Analysis (Gemini Flash)
// ============================================

/**
 * Analyze a product using Gemini Flash vision capabilities
 * Returns description, estimated size, and use cases
 */
export const analyzeProduct = async (
  productTitle: string,
  sourceImageBase64s: string[]
): Promise<ProductAnalysis> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();
      const imageParts = toGeminiImageParts(sourceImageBase64s);

      const response = await genai.models.generateContent({
        model: MODELS.QA_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              ...imageParts,
              {
                text: `You are an expert product analyst. Analyze the product images and provide detailed information.

Product name: "${productTitle}"

Provide a detailed analysis including description, estimated physical size, and common use cases.

Return a JSON object with the following structure:
{
  "description": "A detailed description of the product, its features, materials, and design",
  "estimatedSize": "Estimated physical dimensions (e.g., '30mm diameter', '15cm x 10cm x 5cm')",
  "useCases": ["Use case 1", "Use case 2", "Use case 3"]
}

Be specific and accurate. Focus on what you can actually see in the images.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      });

      return extractAndParseGeminiJson<ProductAnalysis>(response, 'product analysis');
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};

// ============================================
// Prompt Refinement (Gemini Flash)
// ============================================

/**
 * Get background instruction string from BackgroundOption
 */
const getBackgroundInstruction = (option: BackgroundOption): string => {
  switch (option.type) {
    case 'default':
      return 'Use a clean, professional background appropriate for the shot type.';
    case 'transparent':
      return 'Use a pure white background that can be easily removed for transparency.';
    case 'solid':
      return `Use a solid ${option.color} background.`;
    case 'gradient':
      return `Use a gradient background transitioning from ${option.colors.join(' to ')}.`;
    case 'custom':
      return option.description;
    default:
      return '';
  }
};

/**
 * Build the shot briefs text for prompt refinement
 */
const buildShotBriefsText = (shotIndices: number[]): string => {
  return shotIndices
    .map((index) => {
      const brief = SHOT_BRIEFS.find((b) => b.index === index) || SHOT_BRIEFS[0];
      return `### SHOT ${brief.index} - ${brief.type.toUpperCase()}
${brief.description}
Cannabis allowed: ${brief.allowsCannabis}, Smoke allowed: ${brief.allowsSmoke}`;
    })
    .join('\n\n');
};

/**
 * The prompt refinement system instruction (shared between standalone and combined calls)
 */
const REFINEMENT_INSTRUCTIONS = `You are an expert commercial product photography director creating precise image generation prompts.

Your prompts must be HIGHLY SPECIFIC and TECHNICAL, like instructions to a professional photographer.

## PROMPT STRUCTURE REQUIREMENTS

Each prompt MUST include:
1. **Subject Description**: Exact product with materials, colors, and finish
2. **Camera Specs**: Angle, distance, lens equivalent, perspective
3. **Lighting Setup**: Key light position, fill, rim lights, modifiers
4. **Background**: Exact color codes or description
5. **Composition**: Framing, product placement, negative space
6. **Technical Settings**: Depth of field, focus point, exposure style
7. **Style Reference**: "Professional product photography" + specific style notes
8. **Quality Anchors**: "8K detail, photorealistic, commercial quality"

## ANTI-ARTIFACT INSTRUCTIONS (Include in EVERY prompt)
Always end prompts with: "Sharp focus, no blur artifacts, no distortion, anatomically correct, physically accurate, professional retouched quality."

## CRITICAL RULES
- Shots 1-7: Product ONLY. Zero cannabis, smoke, or lifestyle elements.
- Shots 8-10: May include lifestyle elements if allowed.
- Hands: ONLY "elegant feminine hand with slender fingers, natural manicured nails, exactly 5 fingers"
- Never alter the product itself - exact match to reference required`;

/**
 * Refine generic shot briefs into product-specific prompts using Gemini Flash
 */
export const refinePrompts = async (
  productTitle: string,
  analysis: ProductAnalysis,
  shotIndices: number[],
  backgroundOption: BackgroundOption,
  brandGuidelines?: string
): Promise<string[]> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();
      const backgroundInstruction = getBackgroundInstruction(backgroundOption);

      const response = await genai.models.generateContent({
        model: MODELS.REASONING_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${REFINEMENT_INSTRUCTIONS}

- Scale: Always reference "${analysis?.estimatedSize || 'accurate scale'}"

## PRODUCT DETAILS
Name: "${productTitle}"
Description: ${analysis.description}
Physical Size: ${analysis.estimatedSize}
Common Uses: ${analysis.useCases.join(', ')}

## BACKGROUND PREFERENCE
${backgroundInstruction}

${brandGuidelines ? `## BRAND GUIDELINES\n${brandGuidelines}` : ''}

## SHOTS TO CREATE (Generate one detailed prompt per shot)
${buildShotBriefsText(shotIndices)}

Generate ${shotIndices.length} highly detailed prompts. Each prompt should be 100-200 words with specific technical photography instructions. Remember to include anti-artifact instructions at the end of each prompt.

Return JSON: { "prompts": ["detailed prompt 1", "detailed prompt 2", ...] }`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      });

      const result = extractAndParseGeminiJson<{ prompts: string[] }>(response, 'prompt refinement');
      return result.prompts;
    },
    PRIORITY.PROMPT_REFINEMENT
  );
};

// ============================================
// Combined Analysis + Prompt Refinement (Gemini Flash)
// Saves 1 API call per product by doing both in one request
// ============================================

/**
 * Analyze product AND refine prompts in a single Gemini Flash call.
 * This replaces separate analyzeProduct() + refinePrompts() calls during initial generation.
 */
export const analyzeAndRefinePrompts = async (
  productTitle: string,
  sourceImageBase64s: string[],
  shotIndices: number[],
  backgroundOption: BackgroundOption,
  brandGuidelines?: string
): Promise<{ analysis: ProductAnalysis; prompts: string[] }> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();
      const imageParts = toGeminiImageParts(sourceImageBase64s);
      const backgroundInstruction = getBackgroundInstruction(backgroundOption);

      const response = await genai.models.generateContent({
        model: MODELS.REASONING_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              ...imageParts,
              {
                text: `You are an expert product analyst AND commercial photography director. Complete BOTH tasks below in a single response.

## TASK 1: PRODUCT ANALYSIS
Analyze the product images for "${productTitle}". Determine:
- A detailed description of the product (features, materials, design)
- Estimated physical dimensions
- Common use cases

## TASK 2: PHOTOGRAPHY PROMPT GENERATION

${REFINEMENT_INSTRUCTIONS}

Using your analysis from Task 1, create detailed photography prompts for these shots:

## BACKGROUND PREFERENCE
${backgroundInstruction}

${brandGuidelines ? `## BRAND GUIDELINES\n${brandGuidelines}` : ''}

## SHOTS TO CREATE
${buildShotBriefsText(shotIndices)}

Generate ${shotIndices.length} highly detailed prompts (100-200 words each) with specific technical photography instructions. Include anti-artifact instructions at the end of each prompt. Reference the product's actual size from your analysis.

Return JSON:
{
  "analysis": {
    "description": "detailed product description",
    "estimatedSize": "physical dimensions",
    "useCases": ["use case 1", "use case 2", "use case 3"]
  },
  "prompts": ["detailed prompt 1", "detailed prompt 2", ...]
}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });

      return extractAndParseGeminiJson<{ analysis: ProductAnalysis; prompts: string[] }>(
        response,
        'analysis and prompt refinement'
      );
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};

// ============================================
// Smart Image Analysis (Gemini Flash)
// ============================================

/**
 * Smart analyze an image to determine what went wrong and suggest improvements
 * Used for the "Smart Regenerate" feature
 */
export const smartAnalyzeImage = async (
  generatedImageBase64: string,
  sourceImageBase64: string,
  productTitle: string,
  originalPrompt: string,
  estimatedSize: string
): Promise<{ analysis: string; suggestedFixes: string[] }> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      const response = await genai.models.generateContent({
        model: MODELS.QA_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: stripDataUrlPrefix(generatedImageBase64),
                },
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: stripDataUrlPrefix(sourceImageBase64),
                },
              },
              {
                text: `You are an expert image quality analyst for e-commerce product photography.
Compare the generated AI image (first) against the original product photo (second) and identify specific issues.

Product: "${productTitle}"
Expected Size: ${estimatedSize}
Original Prompt: ${originalPrompt}

Focus on:
1. Product accuracy - does the generated product match the original exactly?
2. Scale and proportions - is the product the right size?
3. Photorealism - are there any AI artifacts, distortions, or unrealistic elements?
4. Composition issues - is the lighting, angle, or staging problematic?
5. Content compliance - any prohibited elements (male characters, incorrect usage)?

Return a JSON object:
{
  "analysis": "A detailed explanation of what went wrong with the generated image",
  "suggestedFixes": ["Specific fix 1", "Specific fix 2", "..."]
}

Be specific and actionable in your suggestions.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });

      return extractAndParseGeminiJson<{ analysis: string; suggestedFixes: string[] }>(response, 'smart analysis');
    },
    PRIORITY.QA_CHECK
  );
};

// ============================================
// Prompt Reimagination (Gemini Flash)
// ============================================

/**
 * Reimagine a prompt after QA failure with specific feedback
 */
export const reimaginePrompt = async (
  originalPrompt: string,
  feedback: string,
  productTitle: string,
  analysis: ProductAnalysis
): Promise<string> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      const response = await genai.models.generateContent({
        model: MODELS.REASONING_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${AI_STYLIST_PROMPT}

You are reimagining a prompt that failed quality checks. Create an improved version that addresses the feedback while maintaining the original intent.

STRICT RULES remain the same:
- No male characters, feminine hands only
- Correct product usage and scale
- Cannabis/smoke only in designated lifestyle shots

Product: "${productTitle}"
Estimated Size: ${analysis.estimatedSize}

Original Prompt: ${originalPrompt}

QA Feedback / Issues: ${feedback}

Create an improved prompt that addresses these issues while maintaining the original shot concept. Return ONLY the new prompt text, nothing else.`,
              },
            ],
          },
        ],
        config: {
          temperature: 0.8,
        },
      });

      return extractGeminiText(response).trim();
    },
    PRIORITY.PROMPT_REIMAGINATION
  );
};

// ============================================
// Image Generation
// ============================================

/**
 * Generate an image using Gemini with source images as reference
 */
export const generateImageWithGemini = async (
  sourceImageBase64s: string[],
  prompt: string,
  imageModel?: ImageGenerationModel,
  imageResolution?: ImageResolution
): Promise<string> => {
  const rateLimiter = getGeminiImageRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      const imageParts = toGeminiImageParts(sourceImageBase64s);
      const modelId = getGeminiModelId(imageModel);
      const resolution = getResolutionSize(imageResolution);

      const model = genai.models.generateContent({
        model: modelId,
        contents: [
          {
            role: 'user',
            parts: [
              ...imageParts,
              {
                text: `${AI_STYLIST_PROMPT}

Using the provided product image(s) as reference, generate a new professional e-commerce product photograph following this brief:

${prompt}

IMPORTANT:
- The product in the generated image must match the reference images EXACTLY
- Maintain correct scale and proportions
- Create a photorealistic, commercial-quality image
- Output a ${resolution}x${resolution} pixel image suitable for e-commerce`,
              },
            ],
          },
        ],
        config: {
          responseModalities: ['image', 'text'],
        },
      });

      const response = await model;
      return extractGeminiImage(response);
    },
    PRIORITY.IMAGE_GENERATION
  );
};

/**
 * Map our resolution setting to valid OpenAI image sizes.
 */
const getOpenAISize = (
  resolution?: ImageResolution
): 'auto' | '1024x1024' | '1024x1536' | '1536x1024' => {
  switch (resolution) {
    case '4k':
    case '2k':
      return 'auto';
    case '1k':
    default:
      return '1024x1024';
  }
};

/**
 * Map our resolution setting to OpenAI quality parameter.
 */
const getOpenAIQuality = (
  resolution?: ImageResolution
): 'low' | 'medium' | 'high' | 'auto' => {
  switch (resolution) {
    case '4k':
      return 'high';
    case '2k':
      return 'high';
    case '1k':
    default:
      return 'medium';
  }
};

/**
 * Generate an image using OpenAI GPT Image with reference images.
 */
export const generateImageWithOpenAI = async (
  sourceImageBase64s: string[],
  prompt: string,
  imageResolution?: ImageResolution
): Promise<string> => {
  const rateLimiter = getOpenAIRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();
      const size = getOpenAISize(imageResolution);
      const quality = getOpenAIQuality(imageResolution);

      const fullPrompt = `${AI_STYLIST_PROMPT}

Generate a professional e-commerce product photograph following this brief:

${prompt}

IMPORTANT:
- The product must match the reference image(s) EXACTLY
- Create a photorealistic, commercial-quality image
- Maintain correct scale and proportions
- Output a high-resolution image suitable for e-commerce`;

      // If we have source images, use the edit endpoint for reference-grounded generation
      if (sourceImageBase64s.length > 0) {
        const imageFiles: File[] = [];
        for (const base64 of sourceImageBase64s.slice(0, 1)) {
          const raw = stripDataUrlPrefix(base64);
          const byteChars = atob(raw);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
          }
          imageFiles.push(
            new File([byteArray], 'reference.png', { type: 'image/png' })
          );
        }

        const response = await openai.images.edit({
          model: MODELS.IMAGE_GENERATION_OPENAI,
          image: imageFiles,
          prompt: fullPrompt,
          n: 1,
          size,
          quality,
        });

        if (!response.data || response.data.length === 0) {
          throw new Error('No image data returned from OpenAI');
        }

        const imageData = response.data[0]?.b64_json;
        if (!imageData) {
          throw new Error('No image generated from OpenAI');
        }

        return `data:image/png;base64,${imageData}`;
      }

      // Fallback: no source images, use generate endpoint
      const response = await openai.images.generate({
        model: MODELS.IMAGE_GENERATION_OPENAI,
        prompt: fullPrompt,
        n: 1,
        size,
        quality,
        response_format: 'b64_json',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No image data returned from OpenAI');
      }

      const imageData = response.data[0]?.b64_json;
      if (!imageData) {
        throw new Error('No image generated from OpenAI');
      }

      return `data:image/png;base64,${imageData}`;
    },
    PRIORITY.IMAGE_GENERATION
  );
};

// ============================================
// Quality Assurance (Gemini Flash)
// ============================================

/**
 * Perform quality check on generated image using Gemini Flash vision
 */
export const performQualityCheck = async (
  generatedImageBase64: string,
  productTitle: string,
  prompt: string,
  estimatedSize: string,
  sourceImageBase64?: string
): Promise<QAInfo> => {
  const rateLimiter = getGeminiTextRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = [
        {
          inlineData: {
            mimeType: 'image/png',
            data: stripDataUrlPrefix(generatedImageBase64),
          },
        },
      ];

      if (sourceImageBase64) {
        imageParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: stripDataUrlPrefix(sourceImageBase64),
          },
        });
      }

      const response = await genai.models.generateContent({
        model: MODELS.QA_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              ...imageParts,
              {
                text: `You are a quality assurance specialist for e-commerce product photography. Your job is to identify images that are NOT suitable for commercial use.

## EVALUATION CRITERIA (in order of importance)

### 1. PRODUCT ACCURACY (Critical)
- Does the generated product closely match the reference?
- Are the colors, shape, and key features preserved?
- Minor stylistic differences are OK if the product is recognizable

### 2. TECHNICAL QUALITY (Important)
- Is the image sharp and well-lit?
- Are there obvious AI artifacts? (melted edges, impossible geometry, repeated patterns)
- Would this look professional on a product page?

### 3. HAND QUALITY (If hands present)
- Are hands anatomically correct? (5 fingers, proper proportions)
- Do fingers look natural, not warped or fused?
- Feminine appearance as specified?

### 4. COMPOSITION (Moderate)
- Is the product the clear focal point?
- Is it properly framed for e-commerce?

## AUTO-FAIL (Reject immediately)
- Hands with wrong number of fingers or severely distorted
- Product is wrong/different item entirely
- Severe warping, melting, or impossible physics
- Male characters or clearly masculine hands
- Text/watermarks not in original
- Product obscured or not visible

## AUTO-PASS (Accept if these are the only issues)
- Minor lighting differences from ideal
- Slightly different angle than requested
- Background color not exact match
- Minor style differences if product is accurate

Product: "${productTitle}"
Expected product size for scale reference: ${estimatedSize}
Shot Brief: ${prompt}

${sourceImageBase64 ? 'First image is the generated result. Second image is the source product for comparison.' : 'Evaluate this generated product image.'}

Be REASONABLE - reject obvious failures but accept commercially viable images. A good-enough image is better than constant regeneration.

Return JSON: {
  "isApproved": boolean,
  "reasoning": "Brief explanation (1-2 sentences) of decision"
}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      return extractAndParseGeminiJson<QAInfo>(response, 'quality check');
    },
    PRIORITY.QA_CHECK
  );
};

// ============================================
// Main Generation Pipeline
// ============================================

/**
 * Main entry point for image generation
 * Handles the full pipeline: refinement -> generation -> QA
 * Accepts optional preRefinedPrompt to skip per-image refinement call
 */
export const generateImage = async (
  sourceImageBase64s: string[],
  shotBriefIndex: number,
  productTitle: string,
  analysis: ProductAnalysis,
  backgroundOption: BackgroundOption,
  brandGuidelines?: string,
  isRegeneration?: boolean,
  feedback?: string,
  previousPrompt?: string,
  imageModel?: ImageGenerationModel,
  imageResolution?: ImageResolution,
  preRefinedPrompt?: string
): Promise<GeminiGenerationResult> => {
  try {
    let prompt: string;
    let originalPrompt: string | undefined;

    if (preRefinedPrompt) {
      // Use pre-refined prompt from combined analyzeAndRefinePrompts() call
      prompt = preRefinedPrompt;
    } else if (isRegeneration && previousPrompt && feedback) {
      // Reimagine the prompt based on feedback
      prompt = await reimaginePrompt(previousPrompt, feedback, productTitle, analysis);
      originalPrompt = previousPrompt;
    } else {
      // Refine the shot brief into a specific prompt
      const refinedPrompts = await refinePrompts(
        productTitle,
        analysis,
        [shotBriefIndex],
        backgroundOption,
        brandGuidelines
      );
      prompt = refinedPrompts[0];
    }

    // Generate the image - route to appropriate provider
    let imageBase64: string;
    if (imageModel === 'gpt-image') {
      imageBase64 = await generateImageWithOpenAI(sourceImageBase64s, prompt, imageResolution);
    } else {
      imageBase64 = await generateImageWithGemini(sourceImageBase64s, prompt, imageModel, imageResolution);
    }

    // Perform quality check (pass first source image for comparison if available)
    const qaInfo = await performQualityCheck(
      imageBase64,
      productTitle,
      prompt,
      analysis.estimatedSize,
      sourceImageBase64s.length > 0 ? sourceImageBase64s[0] : undefined
    );

    return {
      base64: imageBase64,
      prompt,
      originalPrompt,
      qaInfo,
    };
  } catch (error) {
    throw handleGeminiError(error);
  }
};

/**
 * Generate multiple images for a product
 */
export const generateMultipleImages = async (
  sourceImageBase64s: string[],
  shotBriefIndices: number[],
  productTitle: string,
  analysis: ProductAnalysis,
  backgroundOption: BackgroundOption,
  brandGuidelines?: string,
  onImageGenerated?: (result: GeminiGenerationResult, index: number) => void,
  imageModel?: ImageGenerationModel,
  imageResolution?: ImageResolution
): Promise<GeminiGenerationResult[]> => {
  const results: GeminiGenerationResult[] = [];

  for (let i = 0; i < shotBriefIndices.length; i++) {
    const result = await generateImage(
      sourceImageBase64s,
      shotBriefIndices[i],
      productTitle,
      analysis,
      backgroundOption,
      brandGuidelines,
      undefined,
      undefined,
      undefined,
      imageModel,
      imageResolution
    );

    results.push(result);
    onImageGenerated?.(result, i);
  }

  return results;
};

// ============================================
// Utility Functions
// ============================================

/**
 * Check if API keys are configured
 */
export const checkApiConfiguration = (): {
  gemini: boolean;
  openai: boolean;
  allConfigured: boolean;
} => {
  const gemini = !!process.env.GEMINI_API_KEY;
  const openai = !!process.env.OPENAI_API_KEY;

  return {
    gemini,
    openai,
    allConfigured: gemini && openai,
  };
};

/**
 * Get available shot briefs for a given count
 */
export const getDefaultShotIndices = (count: number): number[] => {
  return SHOT_BRIEFS.slice(0, count).map((b) => b.index);
};
