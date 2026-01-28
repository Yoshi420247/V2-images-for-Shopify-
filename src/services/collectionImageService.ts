import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import {
  ShopifyCollection,
  ShopifyProduct,
  CollectionAnalysis,
  CollectionPlan,
  CollectionQAResult,
} from '../types';
import { getRateLimiter, PRIORITY } from './sharedRateLimiter';
import { MODELS, AI_STYLIST_PROMPT } from '../constants';

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
// Stage 1: Collection Analysis & Planning
// ============================================

/**
 * Analyze a collection and create a comprehensive plan for image generation
 */
export const createCollectionPlan = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[],
  productImageBase64s: string[]
): Promise<CollectionPlan> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      // Prepare product info
      const productInfo = sampleProducts
        .map((p) => `- ${p.title}: ${p.product_type || 'General'}`)
        .join('\n');

      // Prepare image messages
      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
        productImageBase64s.slice(0, 4).map((base64) => ({
          type: 'image_url' as const,
          image_url: {
            url: base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`,
          },
        }));

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert e-commerce marketing strategist and visual merchandising specialist. Analyze the collection and create a comprehensive plan for generating a compelling collection marketing image.

Return a JSON object with this structure:
{
  "analysis": {
    "collectionTheme": "The core theme/concept of this collection",
    "targetAudience": "Who this collection appeals to",
    "visualStyle": "The aesthetic direction (e.g., modern, rustic, luxury)",
    "keyProducts": ["Product 1", "Product 2", "Product 3"],
    "marketingAngle": "The selling point/angle to emphasize",
    "suggestedImageConcept": "A detailed concept for the collection image"
  },
  "imageRequirements": {
    "mustInclude": ["Element 1", "Element 2"],
    "mustAvoid": ["Element 1", "Element 2"],
    "colorPalette": ["#color1", "#color2", "#color3"],
    "composition": "Description of ideal composition",
    "lighting": "Lighting style recommendation",
    "realisticElements": ["Real-world element 1", "Real-world element 2"]
  },
  "qualityCriteria": {
    "categoryFit": "How the image should fit the category",
    "realismChecks": ["Check 1", "Check 2"],
    "brandAlignment": "How it should align with brand identity"
  }
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Collection: "${collection.title}"
Description: ${collection.body_html || 'No description'}

Products in Collection:
${productInfo}

Analyze this collection and the sample product images to create a comprehensive plan for generating an effective marketing image.`,
              },
              ...imageMessages,
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from collection analysis');
      }

      try {
        return JSON.parse(content) as CollectionPlan;
      } catch {
        throw new Error('Failed to parse collection plan response');
      }
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};

// ============================================
// Stage 2: Image Generation
// ============================================

/**
 * Generate a collection image based on the plan
 */
export const generateCollectionImageWithPlan = async (
  plan: CollectionPlan,
  collection: ShopifyCollection,
  productImageBase64s: string[]
): Promise<string> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      // Build comprehensive prompt from plan
      const prompt = `${AI_STYLIST_PROMPT}

Create a stunning marketing banner image for an e-commerce collection.

Collection: "${collection.title}"
Theme: ${plan.analysis.collectionTheme}
Visual Style: ${plan.analysis.visualStyle}
Marketing Angle: ${plan.analysis.marketingAngle}

Image Concept: ${plan.analysis.suggestedImageConcept}

COMPOSITION REQUIREMENTS:
${plan.imageRequirements.composition}

MUST INCLUDE:
${plan.imageRequirements.mustInclude.map((item) => `- ${item}`).join('\n')}

MUST AVOID:
${plan.imageRequirements.mustAvoid.map((item) => `- ${item}`).join('\n')}

COLOR PALETTE: ${plan.imageRequirements.colorPalette.join(', ')}

LIGHTING: ${plan.imageRequirements.lighting}

REALISM REQUIREMENTS:
${plan.imageRequirements.realisticElements.map((item) => `- ${item}`).join('\n')}

CRITICAL INSTRUCTIONS:
1. Products shown must match the reference images EXACTLY
2. Create a photorealistic, professional marketing image
3. The image should be suitable for a collection banner/hero
4. Maintain brand consistency and commercial appeal
5. Output a high-resolution landscape-oriented image`;

      // Prepare image parts for reference
      const imageParts = productImageBase64s.slice(0, 3).map((base64) => {
        const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
        return {
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanBase64,
          },
        };
      });

      const model = genai.models.generateContent({
        model: MODELS.IMAGE_GENERATION,
        contents: [
          {
            role: 'user',
            parts: [
              ...imageParts,
              { text: prompt },
            ],
          },
        ],
        config: {
          responseModalities: ['image', 'text'],
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

// ============================================
// Stage 3: Quality Assurance
// ============================================

/**
 * Perform comprehensive QA on the generated collection image
 */
export const performCollectionQA = async (
  generatedImageBase64: string,
  collection: ShopifyCollection,
  plan: CollectionPlan,
  productImageBase64s: string[]
): Promise<CollectionQAResult> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      // Prepare image messages
      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: 'image_url' as const,
          image_url: {
            url: generatedImageBase64.startsWith('data:')
              ? generatedImageBase64
              : `data:image/png;base64,${generatedImageBase64}`,
          },
        },
        // Include a reference product image for comparison
        ...(productImageBase64s.slice(0, 1).map((base64) => ({
          type: 'image_url' as const,
          image_url: {
            url: base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`,
          },
        }))),
      ];

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a strict quality assurance specialist for e-commerce marketing imagery.

Evaluate the generated collection image against these criteria:

1. **Category Match** (1-10): Does the image fit the collection's category and theme?
2. **Realism Score** (1-10): Is this photorealistic? No AI artifacts?
3. **Product Accuracy**: Do any products shown match the references?
4. **Brand Fit**: Does it align with professional e-commerce standards?
5. **Composition**: Is it suitable for a collection banner/hero?

Quality Criteria from Plan:
- Category Fit: ${plan.qualityCriteria.categoryFit}
- Realism Checks: ${plan.qualityCriteria.realismChecks.join(', ')}
- Brand Alignment: ${plan.qualityCriteria.brandAlignment}

Must Avoid: ${plan.imageRequirements.mustAvoid.join(', ')}

Return JSON:
{
  "isApproved": boolean (true if categoryMatch >= 7 AND realismScore >= 7),
  "categoryMatch": number (1-10),
  "realismScore": number (1-10),
  "issues": ["Issue 1", "Issue 2"],
  "suggestions": ["Suggestion 1", "Suggestion 2"],
  "reasoning": "Detailed explanation"
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Collection: "${collection.title}"
Theme: ${plan.analysis.collectionTheme}
Visual Style: ${plan.analysis.visualStyle}

First image is the generated collection image. Second image is a reference product from the collection.

Perform comprehensive quality assessment.`,
              },
              ...imageMessages,
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from collection QA');
      }

      try {
        return JSON.parse(content) as CollectionQAResult;
      } catch {
        throw new Error('Failed to parse collection QA response');
      }
    },
    PRIORITY.QA_CHECK
  );
};

// ============================================
// Stage 4: Retry with Enhanced Plan
// ============================================

/**
 * Create an enhanced plan addressing previous issues
 */
export const createEnhancedPlan = async (
  originalPlan: CollectionPlan,
  qaResult: CollectionQAResult,
  collection: ShopifyCollection
): Promise<CollectionPlan> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are refining a collection image generation plan based on QA feedback.

The previous attempt had issues that need to be addressed. Create an improved plan that specifically addresses the problems while maintaining the original concept.

Return the same JSON structure as before but with improvements:
{
  "analysis": { ... },
  "imageRequirements": { ... },
  "qualityCriteria": { ... }
}`,
          },
          {
            role: 'user',
            content: `Collection: "${collection.title}"

Original Plan:
${JSON.stringify(originalPlan, null, 2)}

QA Feedback:
- Category Match Score: ${qaResult.categoryMatch}/10
- Realism Score: ${qaResult.realismScore}/10
- Issues: ${qaResult.issues.join(', ')}
- Suggestions: ${qaResult.suggestions.join(', ')}
- Reasoning: ${qaResult.reasoning}

Create an enhanced plan that addresses these issues. Add the issues to mustAvoid and incorporate suggestions into the requirements.`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from plan enhancement');
      }

      try {
        return JSON.parse(content) as CollectionPlan;
      } catch {
        throw new Error('Failed to parse enhanced plan response');
      }
    },
    PRIORITY.PROMPT_REFINEMENT
  );
};

/**
 * Retry collection image generation with enhanced plan
 */
export const retryCollectionImage = async (
  collection: ShopifyCollection,
  originalPlan: CollectionPlan,
  qaResult: CollectionQAResult,
  productImageBase64s: string[]
): Promise<{ base64: string; plan: CollectionPlan; qaResult: CollectionQAResult }> => {
  // Create enhanced plan addressing issues
  const enhancedPlan = await createEnhancedPlan(originalPlan, qaResult, collection);

  // Generate new image with enhanced plan
  const newImageBase64 = await generateCollectionImageWithPlan(
    enhancedPlan,
    collection,
    productImageBase64s
  );

  // Perform QA on new image
  const newQaResult = await performCollectionQA(
    newImageBase64,
    collection,
    enhancedPlan,
    productImageBase64s
  );

  return {
    base64: newImageBase64,
    plan: enhancedPlan,
    qaResult: newQaResult,
  };
};

// ============================================
// Main Collection Pipeline
// ============================================

/**
 * Complete pipeline for generating a collection image
 */
export const generateCollectionImage = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[],
  productImageBase64s: string[],
  maxRetries: number = 3,
  onProgress?: (stage: string, data?: unknown) => void
): Promise<{
  base64: string;
  plan: CollectionPlan;
  qaResult: CollectionQAResult;
  attempts: number;
}> => {
  // Stage 1: Create plan
  onProgress?.('planning', { collection: collection.title });
  const plan = await createCollectionPlan(collection, sampleProducts, productImageBase64s);
  onProgress?.('plan_complete', { plan });

  let currentPlan = plan;
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    onProgress?.('generating', { attempt: attempts, maxRetries });

    // Stage 2: Generate image
    const imageBase64 = await generateCollectionImageWithPlan(
      currentPlan,
      collection,
      productImageBase64s
    );
    onProgress?.('generation_complete', { attempt: attempts });

    // Stage 3: Quality check
    onProgress?.('qa_checking', { attempt: attempts });
    const qaResult = await performCollectionQA(
      imageBase64,
      collection,
      currentPlan,
      productImageBase64s
    );
    onProgress?.('qa_complete', { qaResult, attempt: attempts });

    // Check if approved
    if (qaResult.isApproved) {
      return {
        base64: imageBase64,
        plan: currentPlan,
        qaResult,
        attempts,
      };
    }

    // If not approved and we have retries left, enhance the plan
    if (attempts < maxRetries) {
      onProgress?.('retrying', {
        reason: qaResult.reasoning,
        issues: qaResult.issues,
        attempt: attempts,
      });
      currentPlan = await createEnhancedPlan(currentPlan, qaResult, collection);
    } else {
      // Return the last attempt even if not approved
      return {
        base64: imageBase64,
        plan: currentPlan,
        qaResult,
        attempts,
      };
    }
  }

  throw new Error('Failed to generate approved collection image after max retries');
};

// ============================================
// Utility Functions
// ============================================

/**
 * Quick analysis without full plan (for preview)
 */
export const quickAnalyzeCollection = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[]
): Promise<CollectionAnalysis> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const productInfo = sampleProducts
        .map((p) => `- ${p.title}: ${p.product_type || 'General'}`)
        .join('\n');

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Quickly analyze this collection and return a JSON object:
{
  "collectionTheme": "Core theme",
  "targetAudience": "Target audience",
  "visualStyle": "Visual direction",
  "keyProducts": ["Product 1", "Product 2"],
  "marketingAngle": "Key selling point",
  "suggestedImageConcept": "Brief image concept"
}`,
          },
          {
            role: 'user',
            content: `Collection: "${collection.title}"
Description: ${collection.body_html || 'No description'}
Products: ${productInfo}`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from quick analysis');
      }

      return JSON.parse(content) as CollectionAnalysis;
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};
