import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

// ============================================
// Singleton API Client Initialization
// ============================================

let geminiClient: GoogleGenAI | null = null;
let openaiClient: OpenAI | null = null;

export const getGeminiClient = (): GoogleGenAI => {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
};

export const getOpenAIClient = (): OpenAI => {
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
// Response Parsing Utilities
// ============================================

/**
 * Extract text content from an OpenAI chat completion response.
 * Throws a descriptive error if the response is empty.
 */
export const extractChatContent = (
  response: OpenAI.Chat.Completions.ChatCompletion,
  context: string
): string => {
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`No response from ${context}`);
  }
  return content;
};

/**
 * Parse a JSON string returned from an AI model with a descriptive error on failure.
 */
export const parseJsonResponse = <T>(raw: string, context: string): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse ${context} response as JSON`);
  }
};

/**
 * Convenience: extract + parse in one call.
 */
export const extractAndParseJson = <T>(
  response: OpenAI.Chat.Completions.ChatCompletion,
  context: string
): T => {
  const content = extractChatContent(response, context);
  return parseJsonResponse<T>(content, context);
};

/**
 * Extract a base64 image from a Gemini generation response.
 * Throws if no image data is found.
 */
export const extractGeminiImage = (
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>
): string => {
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
};

/**
 * Extract text content from a Gemini generation response.
 * Throws a descriptive error if no text is found.
 */
export const extractGeminiText = (
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>
): string => {
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error('No content in Gemini response');
  }

  for (const part of candidate.content.parts) {
    if ('text' in part && part.text) {
      return part.text;
    }
  }

  throw new Error('No text content in Gemini response');
};

/**
 * Extract text from a Gemini response and parse as JSON.
 */
export const extractAndParseGeminiJson = <T>(
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>,
  context: string
): T => {
  const text = extractGeminiText(response);
  return parseJsonResponse<T>(text, context);
};

/**
 * Prepare a base64 string as a data URL, adding the prefix if missing.
 */
export const toDataUrl = (
  base64: string,
  defaultMime: string = 'image/jpeg'
): string => {
  return base64.startsWith('data:') ? base64 : `data:${defaultMime};base64,${base64}`;
};

/**
 * Strip the data URL prefix from a base64 string.
 */
export const stripDataUrlPrefix = (base64: string): string => {
  return base64.replace(/^data:image\/\w+;base64,/, '');
};
