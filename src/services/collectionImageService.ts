import OpenAI from 'openai';
import {
  ShopifyCollection,
  ShopifyProduct,
  CollectionAnalysis,
  CollectionPlan,
  CollectionQAResult,
  MarketContext,
} from '../types';
import { getRateLimiter, PRIORITY } from './sharedRateLimiter';
import { MODELS, AI_STYLIST_PROMPT } from '../constants';
import {
  getGeminiClient,
  getOpenAIClient,
  extractAndParseJson,
  extractGeminiImage,
  toDataUrl,
  stripDataUrlPrefix,
} from './apiClients';

// ============================================
// Stage 1: Collection Analysis & Planning
// ============================================

const buildMarketContextPrompt = (marketContext?: MarketContext): string => {
  if (!marketContext) return '';

  const parts: string[] = [];

  parts.push(`\n## MARKET CONTEXT & BRAND TARGETING`);
  parts.push(`Industry/Niche: ${marketContext.industry}`);

  if (marketContext.brandIdentity) {
    parts.push(`Brand Identity: ${marketContext.brandIdentity}`);
  }
  if (marketContext.targetDemographic) {
    parts.push(`Target Demographic: ${marketContext.targetDemographic}`);
  }
  if (marketContext.aestheticPreferences) {
    parts.push(`Aesthetic Style: ${marketContext.aestheticPreferences}`);
  }
  if (marketContext.avoidElements && marketContext.avoidElements.length > 0) {
    parts.push(`MUST AVOID for this market: ${marketContext.avoidElements.join(', ')}`);
  }

  parts.push(`\nIMPORTANT: Tailor ALL visual decisions to appeal to the ${marketContext.industry} market.`);

  return parts.join('\n');
};

export const createCollectionPlan = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[],
  productImageBase64s: string[],
  marketContext?: MarketContext
): Promise<CollectionPlan> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const productInfo = sampleProducts
        .map((p) => `- ${p.title}: ${p.product_type || 'General'}`)
        .join('\n');

      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
        productImageBase64s.slice(0, 4).map((base64) => ({
          type: 'image_url' as const,
          image_url: { url: toDataUrl(base64) },
        }));

      const marketContextPrompt = buildMarketContextPrompt(marketContext);

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert e-commerce marketing strategist and visual merchandising specialist. Analyze the collection and create a comprehensive plan for generating a compelling collection marketing image.
${marketContextPrompt}

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
${marketContext ? `\nTarget Market: ${marketContext.industry}` : ''}

Analyze this collection and the sample product images to create a comprehensive plan for generating an effective marketing image that resonates with the target market.`,
              },
              ...imageMessages,
            ],
          },
        ],
      });

      return extractAndParseJson<CollectionPlan>(response, 'collection plan');
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};

// ============================================
// Stage 2: Image Generation
// ============================================

export const generateCollectionImageWithPlan = async (
  plan: CollectionPlan,
  collection: ShopifyCollection,
  productImageBase64s: string[],
  marketContext?: MarketContext
): Promise<string> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const genai = getGeminiClient();

      const marketInstructions = marketContext
        ? `\nMARKET TARGETING:
This image is for the ${marketContext.industry} market.
${marketContext.brandIdentity ? `Brand Identity: ${marketContext.brandIdentity}` : ''}
${marketContext.targetDemographic ? `Target Audience: ${marketContext.targetDemographic}` : ''}
${marketContext.aestheticPreferences ? `Aesthetic: ${marketContext.aestheticPreferences}` : ''}
Ensure the image resonates with this specific market and demographic.`
        : '';

      const prompt = `${AI_STYLIST_PROMPT}

Create a stunning marketing banner image for an e-commerce collection.

Collection: "${collection.title}"
Theme: ${plan.analysis.collectionTheme}
Visual Style: ${plan.analysis.visualStyle}
Marketing Angle: ${plan.analysis.marketingAngle}
${marketInstructions}

Image Concept: ${plan.analysis.suggestedImageConcept}

COMPOSITION REQUIREMENTS:
${plan.imageRequirements.composition}

MUST INCLUDE:
${plan.imageRequirements.mustInclude.map((item) => `- ${item}`).join('\n')}

MUST AVOID:
${plan.imageRequirements.mustAvoid.map((item) => `- ${item}`).join('\n')}
${marketContext?.avoidElements ? marketContext.avoidElements.map((item) => `- ${item}`).join('\n') : ''}

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

      const imageParts = productImageBase64s.slice(0, 3).map((base64) => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data: stripDataUrlPrefix(base64),
        },
      }));

      const response = await genai.models.generateContent({
        model: MODELS.IMAGE_GENERATION_PRO,
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

      return extractGeminiImage(response);
    },
    PRIORITY.IMAGE_GENERATION
  );
};

// ============================================
// Stage 3: Quality Assurance
// ============================================

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

      const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
          type: 'image_url' as const,
          image_url: { url: toDataUrl(generatedImageBase64, 'image/png') },
        },
        ...productImageBase64s.slice(0, 1).map((base64) => ({
          type: 'image_url' as const,
          image_url: { url: toDataUrl(base64) },
        })),
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

      return extractAndParseJson<CollectionQAResult>(response, 'collection QA');
    },
    PRIORITY.QA_CHECK
  );
};

// ============================================
// Stage 4: Retry with Enhanced Plan
// ============================================

export const createEnhancedPlan = async (
  originalPlan: CollectionPlan,
  qaResult: CollectionQAResult,
  collection: ShopifyCollection,
  marketContext?: MarketContext,
  userFeedback?: string
): Promise<CollectionPlan> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const marketContextPrompt = buildMarketContextPrompt(marketContext);

      const userFeedbackSection = userFeedback
        ? `\n## USER FEEDBACK (CRITICAL - ADDRESS THIS FIRST)
The user has provided specific feedback about what went wrong:
"${userFeedback}"

This feedback takes priority. Understand WHY the user is unhappy and make specific changes to address their concerns.`
        : '';

      const response = await openai.chat.completions.create({
        model: MODELS.TEXT_MODEL,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are refining a collection image generation plan based on QA feedback and user input.

The previous attempt had issues that need to be addressed. Create an improved plan that specifically addresses the problems while maintaining the original concept.
${marketContextPrompt}
${userFeedbackSection}

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
${userFeedback ? `\nUser's Feedback: "${userFeedback}"` : ''}

Create an enhanced plan that addresses these issues${userFeedback ? ' AND the user feedback' : ''}. Add the issues to mustAvoid and incorporate suggestions into the requirements.`,
          },
        ],
      });

      return extractAndParseJson<CollectionPlan>(response, 'enhanced plan');
    },
    PRIORITY.PROMPT_REFINEMENT
  );
};

export const regenerateWithUserFeedback = async (
  collection: ShopifyCollection,
  originalPlan: CollectionPlan,
  previousQaResult: CollectionQAResult,
  productImageBase64s: string[],
  userFeedback: string,
  marketContext?: MarketContext,
  onProgress?: (stage: string, data?: unknown) => void
): Promise<{ base64: string; plan: CollectionPlan; qaResult: CollectionQAResult }> => {
  onProgress?.('processing_feedback', { feedback: userFeedback });

  const enhancedPlan = await createEnhancedPlan(
    originalPlan,
    previousQaResult,
    collection,
    marketContext,
    userFeedback
  );
  onProgress?.('plan_enhanced', { plan: enhancedPlan });

  onProgress?.('generating', { withFeedback: true });
  const newImageBase64 = await generateCollectionImageWithPlan(
    enhancedPlan,
    collection,
    productImageBase64s,
    marketContext
  );
  onProgress?.('generation_complete', {});

  onProgress?.('qa_checking', {});
  const newQaResult = await performCollectionQA(
    newImageBase64,
    collection,
    enhancedPlan,
    productImageBase64s
  );
  onProgress?.('qa_complete', { qaResult: newQaResult });

  return {
    base64: newImageBase64,
    plan: enhancedPlan,
    qaResult: newQaResult,
  };
};

export const retryCollectionImage = async (
  collection: ShopifyCollection,
  originalPlan: CollectionPlan,
  qaResult: CollectionQAResult,
  productImageBase64s: string[],
  marketContext?: MarketContext
): Promise<{ base64: string; plan: CollectionPlan; qaResult: CollectionQAResult }> => {
  const enhancedPlan = await createEnhancedPlan(originalPlan, qaResult, collection, marketContext);

  const newImageBase64 = await generateCollectionImageWithPlan(
    enhancedPlan,
    collection,
    productImageBase64s,
    marketContext
  );

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

export const generateCollectionImage = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[],
  productImageBase64s: string[],
  maxRetries: number = 3,
  onProgress?: (stage: string, data?: unknown) => void,
  marketContext?: MarketContext
): Promise<{
  base64: string;
  plan: CollectionPlan;
  qaResult: CollectionQAResult;
  attempts: number;
}> => {
  onProgress?.('planning', { collection: collection.title });
  const plan = await createCollectionPlan(collection, sampleProducts, productImageBase64s, marketContext);
  onProgress?.('plan_complete', { plan });

  let currentPlan = plan;
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    onProgress?.('generating', { attempt: attempts, maxRetries });

    const imageBase64 = await generateCollectionImageWithPlan(
      currentPlan,
      collection,
      productImageBase64s,
      marketContext
    );
    onProgress?.('generation_complete', { attempt: attempts });

    onProgress?.('qa_checking', { attempt: attempts });
    const qaResult = await performCollectionQA(
      imageBase64,
      collection,
      currentPlan,
      productImageBase64s
    );
    onProgress?.('qa_complete', { qaResult, attempt: attempts });

    if (qaResult.isApproved) {
      return { base64: imageBase64, plan: currentPlan, qaResult, attempts };
    }

    if (attempts < maxRetries) {
      onProgress?.('retrying', {
        reason: qaResult.reasoning,
        issues: qaResult.issues,
        attempt: attempts,
      });
      currentPlan = await createEnhancedPlan(currentPlan, qaResult, collection, marketContext);
    } else {
      return { base64: imageBase64, plan: currentPlan, qaResult, attempts };
    }
  }

  throw new Error('Failed to generate approved collection image after max retries');
};

// ============================================
// Utility Functions
// ============================================

export const quickAnalyzeCollection = async (
  collection: ShopifyCollection,
  sampleProducts: ShopifyProduct[],
  marketContext?: MarketContext
): Promise<CollectionAnalysis> => {
  const rateLimiter = getRateLimiter();

  return rateLimiter.execute(
    async () => {
      const openai = getOpenAIClient();

      const productInfo = sampleProducts
        .map((p) => `- ${p.title}: ${p.product_type || 'General'}`)
        .join('\n');

      const marketContextPrompt = marketContext
        ? `\nIMPORTANT: This is for the ${marketContext.industry} market. Tailor the analysis to this specific niche.`
        : '';

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
}${marketContextPrompt}`,
          },
          {
            role: 'user',
            content: `Collection: "${collection.title}"
Description: ${collection.body_html || 'No description'}
Products: ${productInfo}${marketContext ? `\nTarget Market: ${marketContext.industry}` : ''}`,
          },
        ],
      });

      return extractAndParseJson<CollectionAnalysis>(response, 'quick analysis');
    },
    PRIORITY.PRODUCT_ANALYSIS
  );
};
