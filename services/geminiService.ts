import { GoogleGenAI } from "@google/genai";
import { GenerationResult, ImageAsset } from "../types";

// Helper to initialize the client only when needed.
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is configured.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Edits a SINGLE image based on a text prompt using Gemini 2.5 Flash Image.
 * Used for the "Edit" tab where we transform one specific image.
 */
export const editImageWithGemini = async (
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<GenerationResult> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    return parseResponse(response);
  } catch (error) {
    handleError(error, "Failed to edit image");
    return {};
  }
};

/**
 * Generates an image using Gemini 2.5 Flash Image with MULTIPLE reference images (up to 3).
 * Used for the "Generate" tab.
 */
export const generateMultimodalImage = async (
  prompt: string,
  referenceImages: ImageAsset[] = []
): Promise<GenerationResult> => {
  try {
    const ai = getAiClient();
    
    const parts: any[] = [];
    
    // Add all reference images
    referenceImages.forEach(img => {
      parts.push({
        inlineData: {
          data: img.base64Data,
          mimeType: img.mimeType,
        },
      });
    });

    // Add prompt
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: parts,
      },
    });

    return parseResponse(response);
  } catch (error) {
    handleError(error, "Failed to generate image");
    return {};
  }
};

/**
 * Generates SVG code or text based on prompts and optional MULTIPLE images.
 * Uses Gemini 3 Flash Preview (Text/Code model).
 */
export const generateSvgWithGemini = async (
  prompt: string,
  referenceImages: ImageAsset[] = []
): Promise<GenerationResult> => {
  try {
    const ai = getAiClient();
    const parts: any[] = [];
    
    // Add images first if available (multimodal input)
    referenceImages.forEach(img => {
      parts.push({
        inlineData: {
          data: img.base64Data,
          mimeType: img.mimeType,
        },
      });
    });

    // Add prompt requesting SVG specifically
    parts.push({ 
      text: `${prompt}\n\nPlease output the result as clean, valid SVG code within a code block. Do not use markdown backticks for the SVG logic if possible, just the raw SVG or standard code block.` 
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: parts,
      },
    });

    return parseResponse(response);
  } catch (error) {
    handleError(error, "Failed to generate SVG/Code");
    return {};
  }
};

// --- Helpers ---

const parseResponse = (response: any): GenerationResult => {
  const result: GenerationResult = {};

  if (response.candidates && response.candidates[0].content.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const base64Response = part.inlineData.data;
        result.imageUrl = `data:image/png;base64,${base64Response}`;
      } else if (part.text) {
        result.text = part.text;
      }
    }
  }
  return result;
};

const handleError = (error: unknown, context: string) => {
  console.error("Gemini API Error:", error);
  if (error instanceof Error && error.message.includes("API Key")) {
    throw error;
  }
  throw new Error(`${context}. Please try again.`);
};