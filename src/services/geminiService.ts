import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import {
  ProductAnalysis,
  BackgroundOption,
  QAInfo,
  GeminiGenerationResult,
  ImageGenerationModel,
  ImageResolution,
} from '../types';
import { getRateLimiter, PRIORITY } from './sharedRateLimiter';
import { MODELS, AI_STYLIST_PROMPT, SHOT_BRIEFS } from '../constants';

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
// Client Initialization
// ============================================

let geminiClient: GoogleGenAI | null = null;
let openaiClient: OpenAI | null = null;

const getGeminiClient = (): GoogleGenAI => {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
};

const getOpenAIClient = (): OpenAI => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    openaiClient = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }
  return openaiClient;
};

// ============================================
// Error Handling
// ============================================

const handleGeminiError = (error: unknown): Error => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('api key') || message.includes('authentication')) {
      return new Error(
        'Invalid API key. Please check your GEMINI_API_KEY configuration.'
      );
    }

    if (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('resource_exhausted')
    ) {
      const rateLimiter = getRateLimiter();
      rateLimiter.handleRateLimitError();
      return new Error(
        `Rate limit exceeded. Current tier: ${rateLimiter.getConfig().tier}. ` +
          'Consider upgrading to paid tier for higher limits.'
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
// Product Analysis
// ============================================

/**
 * Analyze a product using GPT-5.1 vision capabilities
 * Returns description, estimated size, and use cases
 */
export const analyzeProduct = async (
  productTitle: string,
  sourceImageBase64s: string[]
): Promise<ProductAnalysis> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      // Prepare image messages
      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
        sourceImageBase64s.map((base64) => ({
          type: 'image_url' as const,
          image_url: {
            url: base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`,
          },
        }));

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert product analyst. Analyze the product images and provide detailed information.

Return a JSON object with the following structure:
{
  "description": "A detailed description of the product, its features, materials, and design",
  "estimatedSize": "Estimated physical dimensions (e.g., '30mm diameter', '15cm x 10cm x 5cm')",
  "useCases": ["Use case 1", "Use case 2", "Use case 3"]
}

Be specific and accurate. Focus on what you can actually see in the images.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this product: "${productTitle}". Provide a detailed analysis including description, estimated physical size, and common use cases.`,
              },
              ...imageMessages,
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from product analysis');
      }

      try {
        const analysis = JSON.parse(content) as ProductAnalysis;
        return analysis;
      } catch {
        throw new Error('Failed to parse product analysis response');
      }
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};

// ============================================
// Prompt Refinement
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
 * Refine generic shot briefs into product-specific prompts using GPT-5.1
 */
export const refinePrompts = async (
  productTitle: string,
  analysis: ProductAnalysis,
  shotIndices: number[],
  backgroundOption: BackgroundOption,
  brandGuidelines?: string
): Promise<string[]> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const selectedBriefs = shotIndices.map((index) => {
        const brief = SHOT_BRIEFS.find((b) => b.index === index) || SHOT_BRIEFS[0];
        return {
          index: brief.index,
          type: brief.type,
          baseDescription: brief.description,
          allowsCannabis: brief.allowsCannabis,
          allowsSmoke: brief.allowsSmoke,
        };
      });

      const backgroundInstruction = getBackgroundInstruction(backgroundOption);

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${AI_STYLIST_PROMPT}

You are refining shot briefs into specific, detailed prompts for AI image generation.

STRICT RULES:
1. For shots 1-7: Product ONLY. No cannabis, no smoke, no lifestyle elements.
2. For shots 8-10: May include in-use scenarios, cannabis, or smoke ONLY if allowed.
3. NEVER include male characters or masculine hands.
4. If hands are needed, specify "elegant feminine hands with natural manicure".
5. Preserve exact product appearance - do not alter the product itself.
6. Include the estimated size in prompts to ensure correct scale.

Return a JSON object: { "prompts": ["prompt1", "prompt2", ...] }`,
          },
          {
            role: 'user',
            content: `Product: "${productTitle}"

Product Analysis:
- Description: ${analysis.description}
- Estimated Size: ${analysis.estimatedSize}
- Use Cases: ${analysis.useCases.join(', ')}

Background Instruction: ${backgroundInstruction}

${brandGuidelines ? `Brand Guidelines: ${brandGuidelines}` : ''}

Shot Briefs to Refine:
${selectedBriefs
  .map(
    (b) =>
      `- Shot ${b.index} (${b.type}): ${b.baseDescription}
   Cannabis allowed: ${b.allowsCannabis}, Smoke allowed: ${b.allowsSmoke}`
  )
  .join('\n')}

Create ${shotIndices.length} detailed, specific prompts tailored to this exact product.`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from prompt refinement');
      }

      try {
        const result = JSON.parse(content) as { prompts: string[] };
        return result.prompts;
      } catch {
        throw new Error('Failed to parse prompt refinement response');
      }
    },
    PRIORITY.PROMPT_REFINEMENT
  );
};

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
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert image quality analyst for e-commerce product photography.
Your job is to compare a generated AI image against the original product photo and identify specific issues that need to be fixed.

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
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Product: "${productTitle}"
Expected Size: ${estimatedSize}
Original Prompt: ${originalPrompt}

Compare these images and identify what went wrong with the AI-generated version.
First image: Generated result
Second image: Original product reference`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: generatedImageBase64.startsWith('data:')
                    ? generatedImageBase64
                    : `data:image/png;base64,${generatedImageBase64}`,
                },
              },
              {
                type: 'image_url',
                image_url: {
                  url: sourceImageBase64.startsWith('data:')
                    ? sourceImageBase64
                    : `data:image/jpeg;base64,${sourceImageBase64}`,
                },
              },
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from smart analysis');
      }

      try {
        return JSON.parse(content) as { analysis: string; suggestedFixes: string[] };
      } catch {
        throw new Error('Failed to parse smart analysis response');
      }
    },
    PRIORITY.QA_CHECK
  );
};

/**
 * Reimagine a prompt after QA failure with specific feedback
 */
export const reimaginePrompt = async (
  originalPrompt: string,
  feedback: string,
  productTitle: string,
  analysis: ProductAnalysis
): Promise<string> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `${AI_STYLIST_PROMPT}

You are reimagining a prompt that failed quality checks. Create an improved version that addresses the feedback while maintaining the original intent.

STRICT RULES remain the same:
- No male characters, feminine hands only
- Correct product usage and scale
- Cannabis/smoke only in designated lifestyle shots`,
          },
          {
            role: 'user',
            content: `Product: "${productTitle}"
Estimated Size: ${analysis.estimatedSize}

Original Prompt: ${originalPrompt}

QA Feedback / Issues: ${feedback}

Create an improved prompt that addresses these issues while maintaining the original shot concept.`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from prompt reimagination');
      }

      return content.trim();
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
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      // Prepare image parts for Gemini
      const imageParts = sourceImageBase64s.map((base64) => {
        const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
        return {
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanBase64,
          },
        };
      });

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
          // @ts-expect-error - Gemini API may support image size config
          imageSize: { width: resolution, height: resolution },
        },
      });

      const response = await model;

      // Extract image from response
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        throw new Error('No image generated');
      }

      for (const part of candidate.content.parts) {
        if ('inlineData' in part && part.inlineData?.data) {
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }

      throw new Error('No image data in response');
    },
    PRIORITY.IMAGE_GENERATION
  );
};

/**
 * Generate an image using OpenAI GPT Image
 * Note: OpenAI image generation doesn't use reference images directly in the same way as Gemini,
 * so we rely on detailed prompts. The source images are kept for API consistency.
 */
export const generateImageWithOpenAI = async (
  _sourceImageBase64s: string[],
  prompt: string
): Promise<string> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      // Build the full prompt with context
      const fullPrompt = `${AI_STYLIST_PROMPT}

Generate a professional e-commerce product photograph following this brief:

${prompt}

IMPORTANT:
- Create a photorealistic, commercial-quality image
- Maintain correct scale and proportions
- Output a high-resolution image suitable for e-commerce`;

      // Use OpenAI's image generation
      const response = await openai.images.generate({
        model: MODELS.IMAGE_GENERATION_OPENAI,
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
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
// Quality Assurance
// ============================================

/**
 * Perform quality check on generated image using GPT-5.1 vision
 */
export const performQualityCheck = async (
  generatedImageBase64: string,
  productTitle: string,
  prompt: string,
  estimatedSize: string,
  sourceImageBase64?: string
): Promise<QAInfo> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: 'image_url' as const,
          image_url: {
            url: generatedImageBase64.startsWith('data:')
              ? generatedImageBase64
              : `data:image/png;base64,${generatedImageBase64}`,
          },
        },
      ];

      // Add source image for comparison if available
      if (sourceImageBase64) {
        imageMessages.push({
          type: 'image_url' as const,
          image_url: {
            url: sourceImageBase64.startsWith('data:')
              ? sourceImageBase64
              : `data:image/jpeg;base64,${sourceImageBase64}`,
          },
        });
      }

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a strict quality assurance specialist for e-commerce product photography.

Evaluate the generated image against these criteria:

1. **Product Integrity**: Does the product match the original exactly? No alterations to shape, color, or design.
2. **Scale Accuracy**: Is the product shown at realistic scale? (Expected size: ${estimatedSize})
3. **Photorealistic Quality**: Professional lighting, shadows, focus? No AI artifacts?
4. **Prompt Adherence**: Does the image match the requested shot type and composition?
5. **Content Compliance**:
   - NO male characters or masculine hands
   - Correct product usage if in-use shot
   - Cannabis/smoke only in lifestyle shots

AUTO-FAIL CONDITIONS (immediately reject):
- Wrong equipment or incorrect usage
- Male characters or masculine hands
- Distorted or badly rendered hands
- Significant product alterations
- Obvious AI artifacts or distortions
- Wrong scale (product appears too large or too small)

Return JSON: {
  "isApproved": boolean,
  "reasoning": "Detailed explanation of the decision"
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Product: "${productTitle}"
Expected Size: ${estimatedSize}
Shot Brief: ${prompt}

${sourceImageBase64 ? 'First image is the generated result. Second image is the source product for comparison.' : 'Evaluate this generated product image.'}

Perform quality check and provide your assessment.`,
              },
              ...imageMessages,
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from quality check');
      }

      try {
        const qaResult = JSON.parse(content) as QAInfo;
        return qaResult;
      } catch {
        throw new Error('Failed to parse QA response');
      }
    },
    PRIORITY.QA_CHECK
  );
};

// ============================================
// Main Generation Pipeline
// ============================================

/**
 * Main entry point for image generation
 * Handles the full pipeline: refinement → generation → QA
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
  imageResolution?: ImageResolution
): Promise<GeminiGenerationResult> => {
  try {
    let prompt: string;
    let originalPrompt: string | undefined;

    if (isRegeneration && previousPrompt && feedback) {
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
      imageBase64 = await generateImageWithOpenAI(sourceImageBase64s, prompt);
    } else {
      imageBase64 = await generateImageWithGemini(sourceImageBase64s, prompt, imageModel, imageResolution);
    }

    // Perform quality check
    const qaInfo = await performQualityCheck(
      imageBase64,
      productTitle,
      prompt,
      analysis.estimatedSize,
      sourceImageBase64s[0]
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
