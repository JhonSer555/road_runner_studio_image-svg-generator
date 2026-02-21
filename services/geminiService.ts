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
  console.log("geminiService.ts: Initializing AI Client...");
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
 * Translates the prompt to English for UI visibility using chunking and engine rotation.
 */
export const translatePrompt = async (prompt: string): Promise<string> => {
  const trimmed = prompt.trim();
  if (!trimmed || !/[^\x00-\x7F]/.test(trimmed)) return trimmed;

  // 1. Split text into segments based on language (ASCII vs Non-ASCII)
  // This ensures we only translate what's necessary and preserve the rest.
  const segments = splitByLanguage(trimmed);
  const results: string[] = [];

  for (const segment of segments) {
    if (segment.isNonAscii) {
      // Translate only non-English parts
      results.push(await translateChunk(segment.text));
    } else {
      // Keep English parts exactly as they are
      results.push(segment.text);
    }
  }

  return results.join("");
};

const splitByLanguage = (text: string): { text: string; isNonAscii: boolean }[] => {
  const segments: { text: string; isNonAscii: boolean }[] = [];
  if (!text) return segments;

  // Improved Regex: Group runs of Non-ASCII words including the spaces between them.
  // This ensures prepositions like "в" are translated in context.
  const regex = /([^\x00-\x7F\s]+(?:\s+[^\x00-\x7F\s]+)*|[\x00-\x7F\s]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index === regex.lastIndex && match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }

    const part = match[0];
    segments.push({
      text: part,
      isNonAscii: /[^\x00-\x7F]/.test(part)
    });
  }

  return segments;
};

/**
 * Translates a single chunk using a rotation of free engines.
 */
const translateChunk = async (chunk: string): Promise<string> => {
  // OPTIMIZATION: If chunk is already pure English/ASCII, skip translation.
  if (!/[^\x00-\x7F]/.test(chunk)) return chunk;

  const engines = [
    // 1. Google Translate - Client: gtx
    async () => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(chunk)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("GTX Fail");
      const data = await res.json();
      return (data[0] || []).map((s: any) => s[0]).join("");
    },
    // 2. MyMemory API (Very reliable for chunks < 500)
    async () => {
      const hasCyrillic = /[а-яА-ЯёЁ]/.test(chunk);
      // If mixed or specifically Cyrillic, use ru|en, otherwise auto|en
      const langPair = hasCyrillic ? "ru|en" : "auto|en";
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langPair}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("MyMemory Fail");
      const data = await res.json();
      const text = data.responseData?.translatedText;
      if (text?.toUpperCase().includes("LIMIT EXCEEDED")) throw new Error("Limit");
      return text || "";
    },
    // 3. Google Translate - Client: dict-chrome-ex
    async () => {
      const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=en&dt=t&q=${encodeURIComponent(chunk)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("ChromeEx Fail");
      const data = await res.json();
      return (data[0] || []).map((s: any) => s[0]).join("");
    }
  ];

  for (const engine of engines) {
    try {
      const result = await engine();
      // Only return if result is non-empty and valid.
      if (result && result.trim() && !isTranslationConfused(chunk, result)) return result;
    } catch { continue; }
  }

  // No additional fallbacks.

  // Ultimate fallback to Gemini
  try {
    const geminiResult = await translateOnlyWithGemini(chunk);
    if (geminiResult && geminiResult.trim() && !isTranslationConfused(chunk, geminiResult)) {
      return geminiResult;
    }
  } catch (err) {
    console.warn("Gemini translation fallback failed:", err);
  }

  // ULTIMATE FALLBACK: Return the original chunk if all else fails.
  return chunk;
};

/**
 * Splits long text into manageable chunks if needed (unused in current targeted splitting but kept for utility)
 */
const splitIntoChunks = (text: string, maxLen: number): string[] => {
  const result: string[] = [];
  const parts = text.split(/([.!?。！？\n]+)/);
  let current = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if ((current + part).length > maxLen && current.length > 0) {
      result.push(current);
      current = "";
    }
    current += part;
  }
  if (current) result.push(current);
  return result;
};

/**
 * Validates the translation result.
 * True if the translation seems failed, partial, or confusing.
 */
const isTranslationConfused = (prompt: string, translated: string): boolean => {
  if (!translated || !translated.trim()) return true; // Reject empty/whitespace translations

  const upper = translated.toUpperCase();
  const isErr = upper.includes("LIMIT EXCEEDED") || upper.includes("MAX ALLOWED") || upper.includes("SOURCE LANGUAGE");
  if (isErr) return true;

  // Counts non-ASCII characters (RU, ZH, etc.)
  const originalNonAscii = (prompt.match(/[^\x00-\x7F]/g) || []).length;
  const newNonAscii = (translated.match(/[^\x00-\x7F]/g) || []).length;

  const isUnchanged = translated.trim() === prompt.trim();

  // Confused if:
  // 1. Text is basically unchanged but had non-ascii to begin with.
  // 2. The amount of non-ascii characters hasn't dropped significantly (indicates partial translation).
  return (isUnchanged && originalNonAscii > 0) || (newNonAscii > originalNonAscii * 0.2 && originalNonAscii > 5);
};

/**
 * Translates and enhances the prompt using Gemini to ensure it's optimized for the image model.
 */
export const translateAndEnhancePrompt = async (prompt: string, aspectRatio?: { width: number; height: number }): Promise<string> => {
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

    if (apiKey) {
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
      const ratioSuffix = aspectRatio
        ? `\n\nNote: The target aspect ratio is ${aspectRatio.width}:${aspectRatio.height}. Optimize the description for this orientation.`
        : '';

      for (const model of MODEL_CHAIN_SVG) {
        try {
          const res = await fetch(
            `${baseUrl}/v1/models/${model}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}${ratioSuffix}\n\nUser prompt: ${prompt}` }] }],
              }),
            }
          );

          if (res.ok) {
            const json = await res.json();
            const enhanced = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (enhanced) return enhanced;
          } else if (res.status === 429) {
            console.warn(`Gemini rate limit (429) on model ${model}. Stopping chain.`);
            break; // Stop trying other models if we hit a rate limit
          }
        } catch (e) {
          console.warn(`Gemini enhancement failed with model ${model}, trying next...`, e);
          continue;
        }
      }
    }

    return prompt;
  } catch (error) {
    console.warn("Prompt enhancement failed, using original:", error);
    return prompt;
  }
};

/**
 * Robust translation using Gemini for complex or mixed-language prompts.
 */
const translateOnlyWithGemini = async (prompt: string): Promise<string> => {
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

    const defaultBaseUrl = import.meta.env.PROD
      ? "https://generativelanguage.googleapis.com"
      : "/api/gemini";
    const baseUrl = process.env.GEMINI_BASE_URL || defaultBaseUrl;

    const systemPrompt = "Translate the following prompt exactly into English. If it contains multiple languages, translate everything to English. Maintain the original meaning and tone. Output ONLY the English translation, no other text.";

    const res = await fetch(
      `${baseUrl}/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nPrompt: ${prompt}` }] }],
        }),
      }
    );

    if (!res.ok) return prompt;
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt;
  } catch (err) {
    return prompt;
  }
};

export const refinePromptWithGemini = async (prompt: string): Promise<string[]> => {
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

    if (!apiKey) return [prompt];

    const defaultBaseUrl = import.meta.env.PROD
      ? "https://generativelanguage.googleapis.com"
      : "/api/gemini";
    const baseUrl = process.env.GEMINI_BASE_URL || defaultBaseUrl;

    const systemPrompt = `
      You are an expert AI prompt engineer for image generation models (Flux, Stable Diffusion).
      Given a user's prompt, generate 3-5 creative variations that:
      1. Translate to English if needed
      2. Expand with vivid details about style, lighting, composition, and mood
      3. Maintain the original subject and intent
      4. Offer diverse creative directions (e.g., different art styles, perspectives, moods)
      
      IMPORTANT: Output ONLY a JSON array of strings, each being a complete prompt variation.
      Example format: ["variation 1 here", "variation 2 here", "variation 3 here"]
      Do NOT include any explanations or markdown formatting.
    `;

    // Try each model in the chain
    for (const model of MODEL_CHAIN_SVG) {
      try {
        const res = await fetch(
          `${baseUrl}/v1/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\nUser prompt: ${prompt}` }] }],
            }),
          }
        );

        if (res.ok) {
          const json = await res.json();
          const responseText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (responseText) {
            try {
              const parsed = JSON.parse(responseText.replace(/```json|```/g, "").trim());
              if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.filter(p => typeof p === 'string' && p.trim());
              }
            } catch {
              // If JSON parsing fails, try to return single text result if it looks like a prompt
              if (responseText.length > 5) return [responseText];
            }
          }
        } else if (res.status === 429) {
          console.warn(`Gemini refinement rate limit (429) on model ${model}. Stopping chain.`);
          break; // Stop trying other models if we hit a rate limit
        }
      } catch (err) {
        console.warn(`Refinement failed with model ${model}:`, err);
        continue; // Try next model
      }
    }

    // If all models fail
    return [prompt];
  } catch (error) {
    console.warn("Prompt refinement failed:", error);
    return [prompt];
  }
};

export const generateSurprisePrompt = async (): Promise<string> => {
  const prompts = [
    "A futuristic road runner bird, minimalist vector logo, neon colors",
    "Cyberpunk city street at night, neon blue and orange, rain reflections",
    "Abstract geometric shapes, 3d render, white background, soft shadows",
    "A sleek modern icon for a speed delivery service, flat design",
    "A magical forest with bioluminescent plants, digital art style",
    "Steam punk coffee machine, detailed illustration, vintage style"
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
};

/**
 * Generates an image using Gemini 2.5 Flash Image with MULTIPLE reference images (up to 3).
 * Used for the "Generate" tab.
 */
export const generateMultimodalImage = async (
  prompt: string,
  referenceImages: ImageAsset[] = [],
  aspectRatio?: { width: number; height: number }
): Promise<GenerationResult> => {
  try {
    // 0. Enhance the prompt using Gemini (Translation + Prompt Engineering)
    const enhancedPrompt = await translateAndEnhancePrompt(prompt, aspectRatio);

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

    // Prepare request body with aspect ratio support
    const requestBody: any = {
      inputs: enhancedPrompt,
      parameters: {}
    };

    // Add width and height if aspect ratio is provided
    if (aspectRatio) {
      requestBody.parameters.width = aspectRatio.width;
      requestBody.parameters.height = aspectRatio.height;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
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
  referenceImages: ImageAsset[] = [],
  aspectRatio?: { width: number; height: number }
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

    // Add aspect ratio context to prompt
    const ratioInfo = aspectRatio
      ? `The target aspect ratio is ${aspectRatio.width}:${aspectRatio.height}. Please ensure the SVG viewbox and design are oriented ${aspectRatio.width < aspectRatio.height ? 'vertically' : aspectRatio.width > aspectRatio.height ? 'horizontally' : 'as a square'}.`
      : '';

    parts.push({
      text: `${prompt}\n\n${ratioInfo}\n\nCRITICAL: Output ONLY the raw <svg> tag and its contents. DO NOT use markdown code blocks (\`\`\`svg or \`\`\`). 
      1. Ensure the <svg> has width="100%" height="100%" and preserveAspectRatio="xMidYMid slice" to fill the viewport without margins.
      2. ALWAYS include a background <rect width="100%" height="100%" fill="..."/> as the VERY FIRST element inside the svg tag. 
      3. Use the background color requested in the prompt (default to #000000 black if not specified).
      4. No internal padding or borders outside the primary content.`,
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
