/// <reference types="vite/client" />
import { GoogleGenAI } from "@google/genai";
import { GenerationResult, ImageAsset } from "../types";

// ----- МОДЕЛИ ДЛЯ ФОЛБЭКА -----

// Цепочка для SVG/кода (text-out модели)
const MODEL_CHAIN_SVG = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

// Цепочка для изображений (можно расширить, если появятся другие image-модели)
// Цепочка для изображений — временно отключаем
const MODEL_CHAIN_IMAGE: string[] = [];


// Helper to initialize the client only when needed.
const getAiClient = () => {
  // 1. Пробуем взять ключ из localStorage (в браузере)
  let storedKey: string | null = null;

  if (typeof window !== "undefined") {
    try {
      storedKey = window.localStorage.getItem("GEMINI_API_KEY");
    } catch {
      // ignore
    }
  }

  // 2. Если в localStorage нет — берём из process.env (для разработчика)
  const apiKey = storedKey || process.env.API_KEY;

  if (!apiKey) {
    throw new Error(
      "API Key is missing. Please provide your Gemini API key in the app settings."
    );
  }

  return new GoogleGenAI({ apiKey });
};

// ----- ОБЩИЕ ХЕЛПЕРЫ ДЛЯ ОШИБОК / ФОЛБЭКА -----

const isQuotaError = (error: unknown): boolean => {
  const anyErr = error as any;
  const apiError = anyErr?.error || anyErr;

  const status = apiError?.status as string | undefined;
  const code = apiError?.code as number | undefined;
  const message: string | undefined = apiError?.message;

  return (
    status === "RESOURCE_EXHAUSTED" ||
    code === 429 ||
    message?.includes("You exceeded your current quota")
  );
};

// универсальный фолбэк по цепочке моделей
const callWithFallback = async (
  models: string[],
  buildRequest: (model: string) => Promise<any>,
  contextForError: string
): Promise<any> => {
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const response = await buildRequest(model);
      return response;
    } catch (err) {
      lastError = err;

      // если это квота — пробуем следующую модель
      if (isQuotaError(err)) {
        console.warn(`Quota exhausted for model ${model}, trying next...`);
        continue;
      }

      // любая другая ошибка — сразу наверх
      throw err;
    }
  }

  // если все модели выбили квоты
  throw new Error(
    `${contextForError}. The Gemini API quota has been exhausted for all available models in this chain. Please try again later or adjust your plan/quotas in Google AI Studio.`
  );
};

// ----- ПУБЛИЧНЫЕ ФУНКЦИИ -----

/**
 * Edits a SINGLE image based on a text prompt using Gemini 2.5 Flash Image.
 * Used for the "Edit" tab where we transform one specific image.
 */
export const editImageWithGemini = async (
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<GenerationResult> => {
  throw new Error(
    "Image editing is currently unavailable: this Gemini project has no free quota or network access for image models. Please use SVG/Code mode."
  );
};

/**
 * Translates the prompt to English for UI visibility using free Google Translate API.
 */
export const translatePrompt = async (prompt: string): Promise<string> => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(prompt)}`;

    const res = await fetch(url);
    if (!res.ok) return prompt;

    const data = await res.json();
    if (data && Array.isArray(data[0])) {
      const translated = data[0]
        .filter((seg: any) => Array.isArray(seg) && typeof seg[0] === "string")
        .map((seg: any) => seg[0])
        .join("");

      if (translated.trim() === prompt.trim() && /[а-яА-ЯёЁ]/.test(prompt)) {
        const retryUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t&q=${encodeURIComponent(prompt)}`;
        const retryRes = await fetch(retryUrl);
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          if (retryData && Array.isArray(retryData[0])) {
            return retryData[0]
              .filter((seg: any) => Array.isArray(seg) && typeof seg[0] === "string")
              .map((seg: any) => seg[0])
              .join("");
          }
        }
      }
      return translated || prompt;
    }

    return prompt;
  } catch (error) {
    console.warn("Google Translate failed:", error);
    return prompt;
  }
};

/**
 * Translates and enhances the prompt using Gemini to ensure it's optimized for the image model.
 */
const translateAndEnhancePrompt = async (prompt: string): Promise<string> => {
  try {
    let storedKey: string | null = null;
    if (typeof window !== "undefined") {
      try {
        storedKey = window.localStorage.getItem("GEMINI_API_KEY");
      } catch {
        // ignore
      }
    }
    const apiKey = storedKey || process.env.API_KEY;
    if (!apiKey) return prompt;

    // Use direct URL in production (built Electron), use proxy in development
    const defaultBaseUrl = import.meta.env.PROD
      ? "https://generativelanguage.googleapis.com"
      : "/api/gemini";

    const baseUrl = process.env.GEMINI_BASE_URL || defaultBaseUrl;

    const systemPrompt = `
      You are an expert AI prompt engineer for Flux and Stable Diffusion.
      1. Translate the user prompt to English if it's not already.
      2. Expand it into a detailed, high-quality image generation prompt.
      3. Add details about style, lighting, composition, and mood.
      4. Maintain the original subject and actions.
      5. IMPORTANT: Output ONLY the final English prompt text. No explanations.
    `;

    const res = await fetch(
      `${baseUrl}/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `${systemPrompt}\n\nUser prompt: ${prompt}` }]
          }],
        }),
      }
    );

    if (!res.ok) {
      return prompt;
    }

    const json = await res.json();
    const enhanced = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    console.log("Original prompt:", prompt);
    console.log("Enhanced prompt:", enhanced);

    return enhanced || prompt;
  } catch (error) {
    console.warn("Prompt enhancement failed, using original:", error);
    return prompt;
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
    // 0. Enhance the prompt using Gemini (Translation + Prompt Engineering)
    const enhancedPrompt = await translateAndEnhancePrompt(prompt);

    // Hugging Face Implementation (Flux Schnell via Router)
    // Uses local proxy /api/huggingface to avoid CORS

    let hfToken: string | null = null;
    if (typeof window !== "undefined") {
      try {
        hfToken = window.localStorage.getItem("HF_API_KEY");
      } catch {
        // ignore
      }
    }
    const token = hfToken || process.env.HUGGING_FACE_TOKEN;

    if (!token) {
      throw new Error("Hugging Face Token is missing. Please add your token in the settings modal (Key icon in header).");
    }

    const model = "black-forest-labs/FLUX.1-schnell";

    // Use direct URL in production (built Electron), use proxy in development
    const baseUrl = import.meta.env.PROD
      ? "https://router.huggingface.co/hf-inference"
      : "/api/huggingface";

    const url = `${baseUrl}/models/${model}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: enhancedPrompt }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`Hugging Face API error: ${response.status} ${errBody.error || response.statusText}`);
    }

    const blob = await response.blob();
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return {
      imageUrl: base64Data
    };

  } catch (error) {
    console.error("Image Generation Failed:", error);
    throw error;
  }
};

/**
 * Generates SVG code or text based on prompts and optional MULTIPLE images.
 * Uses Gemini 3 Flash Preview (Text/Code model) with fallback to other text models.
 */
export const generateSvgWithGemini = async (
  prompt: string,
  referenceImages: ImageAsset[] = []
): Promise<GenerationResult> => {
  try {
    // 1. Берём ключ так же, как в getAiClient
    let storedKey: string | null = null;

    if (typeof window !== "undefined") {
      try {
        storedKey = window.localStorage.getItem("GEMINI_API_KEY");
      } catch {
        // ignore
      }
    }

    const apiKey = storedKey || process.env.API_KEY;

    if (!apiKey) {
      throw new Error(
        "API Key is missing. Please provide your Gemini API key in the app settings."
      );
    }

    // 2. Base URL config
    const defaultBaseUrl = import.meta.env.PROD
      ? "https://generativelanguage.googleapis.com"
      : "/api/gemini";
    const baseUrl = process.env.GEMINI_BASE_URL || defaultBaseUrl;

    // 3. Собираем parts (как раньше)
    const parts: any[] = [];

    referenceImages.forEach((img) => {
      parts.push({
        inlineData: {
          data: img.base64Data,
          mimeType: img.mimeType,
        },
      });
    });

    parts.push({
      text: `${prompt}\n\nPlease output the result as clean, valid SVG code within a code block. Do not use markdown backticks for the SVG logic if possible, just the raw SVG or standard code block.`,
    });

    // 3. Прямой HTTP‑запрос к Gemini
    const res = await fetch(
      `${baseUrl}/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts }],
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw errBody.error || new Error("Gemini HTTP error " + res.status);
    }

    const json = await res.json();
    return parseResponse(json);
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

  // Если это уже наш Error про API Key — пробрасываем как есть
  if (error instanceof Error && error.message.includes("API Key")) {
    throw error;
  }

  const anyErr = error as any;
  const apiError = anyErr?.error || anyErr;

  const status = apiError?.status as string | undefined;
  const code = apiError?.code as number | undefined;
  const message = apiError?.message as string | undefined;

  // 1) Квоты / лимиты
  if (
    status === "RESOURCE_EXHAUSTED" ||
    code === 429 ||
    message?.includes("You exceeded your current quota")
  ) {
    throw new Error(
      "The Gemini API limit for this model or project has been reached. Please try again later or check your plan and quotas in Google AI Studio."
    );
  }

  // 2) Регион не поддерживается
  if (
    status === "FAILED_PRECONDITION" &&
    message?.includes("User location is not supported")
  ) {
    throw new Error(
      "Your region is currently not supported for the Gemini API. Please use a server/proxy in a supported country."
    );
  }

  // 3) Ключ истёк / недействителен
  if (
    status === "INVALID_ARGUMENT" &&
    message?.includes("API key expired")
  ) {
    throw new Error(
      "The Gemini API key has expired or is invalid. Please update the API key in the application settings."
    );
  }

  // 4) Фолбэк
  throw new Error(
    `${context}. The request to the Gemini API failed. If you are in a region where Google AI is blocked, please check your GEMINI_BASE_URL proxy settings in .env.`
  );
};
