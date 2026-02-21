import { GenerationResult, ImageAsset } from "../types";
import { translateAndEnhancePrompt } from "./geminiService";

/**
 * Generates an image using Hugging Face (Flux Schnell)
 */
export const generateMultimodalImage = async (
    prompt: string,
    referenceImages: ImageAsset[] = [],
    aspectRatio?: { width: number; height: number }
): Promise<GenerationResult> => {
    try {
        // 0. Enhance the prompt using Gemini (Translation + Prompt Engineering)
        const enhancedPrompt = await translateAndEnhancePrompt(prompt, aspectRatio);

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
            throw new Error("Hugging Face Token is missing. Please add your token in the settings modal (Draft tab).");
        }

        const model = "black-forest-labs/FLUX.1-schnell";
        const baseUrl = import.meta.env.PROD
            ? "https://router.huggingface.co/hf-inference"
            : "/api/huggingface/hf-inference";
        const url = `${baseUrl}/models/${model}`;

        const requestBody: any = {
            inputs: enhancedPrompt,
            parameters: {}
        };

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
            imageUrl: base64Data,
            provider: "Flux (Draft)"
        };

    } catch (error) {
        console.error("Hugging Face Generation Failed:", error);
        throw error;
    }
};

/**
 * Poll Hugging Face task status for async video generation
 */
const pollHuggingFaceTask = async (taskUrl: string, token: string): Promise<string> => {
    const maxAttempts = 60; // 5 minutes with 5s interval
    const interval = 5000;

    for (let i = 0; i < maxAttempts; i++) {
        const response = await fetch(taskUrl, {
            headers: {
                "Authorization": `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error(`HF Task polling failed: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type");

        // If we get a video back, it's done
        if (contentType?.includes("video")) {
            const blob = await response.blob();
            const videoUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            return videoUrl;
        }

        // Otherwise, check status
        const status = await response.json().catch(() => null);

        if (status?.status === "succeeded" && status?.output) {
            return status.output;
        } else if (status?.status === "failed") {
            throw new Error(`HF Task failed: ${status.error || "Unknown error"}`);
        }

        // Wait before next poll
        await new Promise(r => setTimeout(r, interval));
    }

    throw new Error("HF video generation timed out");
};

/**
 * Generate video from text using Hugging Face
 */
export const generateTextToVideoWithHuggingFace = async (
    prompt: string,
    options?: {
        model?: string;
        duration?: number;
    }
): Promise<GenerationResult> => {
    try {
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
            throw new Error("Hugging Face Token is missing. Please add your token in the settings modal.");
        }

        // Default to Zeroscope (fast and reliable)
        const model = options?.model || "cerspense/zeroscope_v2_XL";

        // Унифицированный URL для разработки и продакшена
        const baseUrl = import.meta.env.PROD
            ? "https://router.huggingface.co"
            : "/api/huggingface";
        const url = `${baseUrl}/models/${model}`;

        console.log(`[HF Video] Generating text-to-video with ${model}...`);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    num_frames: options?.duration || 24,
                }
            }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(`HF API error: ${response.status} ${errBody.error || response.statusText}`);
        }

        // Check if we got a video directly or need to poll
        const contentType = response.headers.get("content-type");

        if (contentType?.includes("video")) {
            const blob = await response.blob();
            const videoUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            return {
                videoUrl: videoUrl,
                provider: "Hugging Face (Zeroscope)"
            };
        } else {
            // Async generation - poll for result
            const taskData = await response.json();
            const videoUrl = await pollHuggingFaceTask(url, token);

            return {
                videoUrl: videoUrl,
                provider: "Hugging Face (Zeroscope)"
            };
        }

    } catch (error) {
        console.error("HF Text-to-Video Failed:", error);
        throw error;
    }
};

/**
 * Generate video from image using Hugging Face (Stable Video Diffusion)
 */
export const generateImageToVideoWithHuggingFace = async (
    imageUrl: string,
    prompt?: string
): Promise<GenerationResult> => {
    try {
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
            throw new Error("Hugging Face Token is missing. Please add your token in the settings modal.");
        }

        const model = "stabilityai/stable-video-diffusion-img2vid-xt";

        // Унифицированный URL для разработки и продакшена
        const baseUrl = import.meta.env.PROD
            ? "https://router.huggingface.co"
            : "/api/huggingface";
        const url = `${baseUrl}/models/${model}`;

        console.log(`[HF Video] Generating image-to-video with SVD...`);

        // Convert image URL to base64 if needed
        let imageData = imageUrl;
        if (!imageUrl.startsWith('data:')) {
            const imgResponse = await fetch(imageUrl);
            const blob = await imgResponse.blob();
            imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                inputs: {
                    image: imageData,
                    prompt: prompt || ""
                }
            }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(`HF API error: ${response.status} ${errBody.error || response.statusText}`);
        }

        // Check if we got a video directly or need to poll
        const contentType = response.headers.get("content-type");

        if (contentType?.includes("video")) {
            const blob = await response.blob();
            const videoUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            return {
                videoUrl: videoUrl,
                provider: "Hugging Face (SVD)"
            };
        } else {
            // Async generation - poll for result
            const videoUrl = await pollHuggingFaceTask(url, token);

            return {
                videoUrl: videoUrl,
                provider: "Hugging Face (SVD)"
            };
        }

    } catch (error) {
        console.error("HF Image-to-Video Failed:", error);
        throw error;
    }
};
