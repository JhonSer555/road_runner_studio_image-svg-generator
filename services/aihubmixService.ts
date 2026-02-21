import { GenerationResult, ImageAsset } from "../types";

/**
 * Get AIHubMix API Key from localStorage
 */
const getAIHubMixKey = (): string => {
    if (typeof window !== "undefined") {
        return window.localStorage.getItem("AIHUBMIX_API_KEY") || "";
    }
    return "";
};

const getBaseUrl = () => {
    return "https://aihubmix.com/v1";
};

/**
 * Check account balance before generation
 */
const checkAccountBalance = async (apiKey: string): Promise<{ hasBalance: boolean; balance: number; message?: string }> => {
    try {
        const baseUrl = getBaseUrl();
        const response = await fetch(`${baseUrl}/user/balance`, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
        });

        if (response.ok) {
            const balanceData = await response.json();
            const balance = balanceData.balance || balanceData.credits || 0;
            
            if (balance <= 0) {
                return {
                    hasBalance: false,
                    balance: 0,
                    message: "Your AIHubMix account balance is $0.00. Please recharge your account to generate videos. Visit aihubmix.com to add credits."
                };
            }
            
            return { hasBalance: true, balance };
        }
    } catch (error) {
        console.warn('Could not check account balance:', error);
    }
    // If we can't check balance, proceed anyway
    return { hasBalance: true, balance: 0 };
};

/**
 * Poll for task completion
 */
const pollAIHubMixTask = async (taskId: string, apiKey: string): Promise<string> => {
    const baseUrl = getBaseUrl();
    const maxAttempts = 60; // 2 minutes with 2s interval
    const interval = 2000;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(`${baseUrl}/videos/${taskId}`, {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`AIHubMix Task Status Failed: ${error.message || response.statusText}`);
            }

            const task = await response.json();

            if (task.status === "completed") {
                return task.output?.[0]?.url || task.output?.url || task.url;
            } else if (task.status === "failed") {
                throw new Error(`AIHubMix Task Failed: ${task.error || "Unknown error"}`);
            } else if (task.status === "cancelled") {
                throw new Error("AIHubMix Task was cancelled.");
            }

            // Add error handling for the Promise/timeout
            await new Promise<void>((resolve) => {
                try {
                    setTimeout(() => resolve(), interval);
                } catch (error) {
                    console.warn('Timeout error in polling:', error);
                    resolve(); // Continue polling even if timeout fails
                }
            });
        } catch (error) {
            // If this is a network error or polling error, continue trying
            if (i === maxAttempts - 1) {
                throw error; // Re-throw on last attempt
            }
            console.warn(`Polling attempt ${i + 1} failed, retrying...`, error);
            // Wait before retrying
            await new Promise<void>((resolve) => {
                try {
                    setTimeout(() => resolve(), interval);
                } catch (timeoutError) {
                    console.warn('Timeout error in retry:', timeoutError);
                    resolve();
                }
            });
        }
    }

    throw new Error("AIHubMix Task timed out.");
};

/**
 * Text to Video Generation with AIHubMix
 */
export const generateTextToVideoWithAIHubMix = async (
    prompt: string,
    options?: {
        model?: string;
        size?: string;
        seconds?: number;
    }
): Promise<GenerationResult> => {
    const apiKey = getAIHubMixKey();
    if (!apiKey) throw new Error("AIHubMix API Key is missing. Add it in Settings (Key icon).");

    // Check account balance first
    const balanceCheck = await checkAccountBalance(apiKey);
    if (!balanceCheck.hasBalance) {
        throw new Error(balanceCheck.message || "Insufficient account balance. Please recharge your AIHubMix account to continue generating videos.");
    }

    const baseUrl = getBaseUrl();
    const endpoint = `${baseUrl}/videos`;

    // Default parameters
    const model = options?.model || "sora-2-pro"; // Default to Sora 2 Pro
    const size = options?.size || "1280x720"; // Default 16:9
    const seconds = options?.seconds || 4; // Default 4 seconds

    // Available models from documentation
    const availableModels = [
        "veo-3.1-generate-preview",
        "veo-3.0-generate-preview", 
        "sora-2",
        "sora-2-pro",
        "wan2.2-i2v-plus",
        "wan2.2-t2v-plus",
        "wan2.5-i2v-preview",
        "wan2.5-t2v-preview"
    ];

    const finalModel = availableModels.includes(model) ? model : "sora-2-pro";

    const payload = {
        model: finalModel,
        prompt: prompt,
        size: size,
        seconds: seconds.toString()
    };

    try {
        console.log("Sending request to AIHubMix Text-to-Video API:", endpoint, payload);

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AIHubMix API Error - Full Response]:', errorText);

            let errorMessage = `Bad Request (${response.status})`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message?.includes('balance is insufficient')) {
                    errorMessage = 'Insufficient account balance. Please recharge your AIHubMix account to continue generating videos.';
                } else if (errorJson.error?.message) {
                    errorMessage = errorJson.error.message;
                } else if (errorJson.message) {
                    errorMessage = errorJson.message;
                } else if (errorJson.error) {
                    errorMessage = errorJson.error;
                } else {
                    errorMessage = errorText;
                }
            } catch {
                errorMessage = errorText;
            }

            throw new Error(`AIHubMix API Error: ${errorMessage}`);
        }

        const task = await response.json();
        
        // For AIHubMix, the response might be direct or async
        if (task.output && task.output[0] && task.output[0].url) {
            // Direct response
            return {
                videoUrl: task.output[0].url,
                provider: `AIHubMix (${finalModel})`
            };
        } else if (task.id) {
            // Async response - poll for completion
            const videoUrl = await pollAIHubMixTask(task.id, apiKey);
            return {
                videoUrl: videoUrl,
                provider: `AIHubMix (${finalModel})`
            };
        } else {
            throw new Error("Invalid response format from AIHubMix API");
        }
    } catch (error) {
        console.error("AIHubMix Text-to-Video Failed:", error);
        throw error;
    }
};

/**
 * Image to Video Generation with AIHubMix
 */
export const generateImageToVideoWithAIHubMix = async (
    imageAsset: ImageAsset,
    prompt?: string,
    options?: {
        model?: string;
        size?: string;
        seconds?: number;
    }
): Promise<GenerationResult> => {
    const apiKey = getAIHubMixKey();
    if (!apiKey) throw new Error("AIHubMix API Key is missing. Add it in Settings (Key icon).");

    // Check account balance first
    const balanceCheck = await checkAccountBalance(apiKey);
    if (!balanceCheck.hasBalance) {
        throw new Error(balanceCheck.message || "Insufficient account balance. Please recharge your AIHubMix account to continue generating videos.");
    }

    const baseUrl = getBaseUrl();
    const endpoint = `${baseUrl}/videos`;

    // Default parameters
    const model = options?.model || "sora-2"; // Default to Sora 2 for image-to-video
    const size = options?.size || "1280x720";
    const seconds = options?.seconds || 4;

    // Available models that support image-to-video
    const availableModels = [
        "sora-2",
        "sora-2-pro",
        "wan2.2-i2v-plus",
        "wan2.5-i2v-preview"
    ];

    const finalModel = availableModels.includes(model) ? model : "sora-2";

    try {
        console.log("Sending request to AIHubMix Image-to-Video API:", endpoint);

        // Create FormData for file upload
        const formData = new FormData();
        formData.append("model", finalModel);
        formData.append("prompt", prompt || "Generate video from image");
        formData.append("size", size);
        formData.append("seconds", seconds.toString());
        
        // Convert base64 to blob for upload
        const base64Data = imageAsset.base64Data;
        const mimeType = imageAsset.mimeType;
        
        // Extract base64 data without the data:image/...;base64, prefix
        const cleanBase64 = base64Data.includes(',') 
            ? base64Data.split(',')[1] 
            : base64Data;
            
        const byteCharacters = atob(cleanBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });
        
        formData.append("input_reference", blob, "image.jpg");

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AIHubMix API Error - Full Response]:', errorText);

            let errorMessage = `Bad Request (${response.status})`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message?.includes('balance is insufficient')) {
                    errorMessage = 'Insufficient account balance. Please recharge your AIHubMix account to continue generating videos.';
                } else if (errorJson.error?.message) {
                    errorMessage = errorJson.error.message;
                } else if (errorJson.message) {
                    errorMessage = errorJson.message;
                } else if (errorJson.error) {
                    errorMessage = errorJson.error;
                } else {
                    errorMessage = errorText;
                }
            } catch {
                errorMessage = errorText;
            }

            throw new Error(`AIHubMix API Error: ${errorMessage}`);
        }

        const task = await response.json();
        
        // For AIHubMix, the response might be direct or async
        if (task.output && task.output[0] && task.output[0].url) {
            // Direct response
            return {
                videoUrl: task.output[0].url,
                provider: `AIHubMix (${finalModel})`
            };
        } else if (task.id) {
            // Async response - poll for completion
            const videoUrl = await pollAIHubMixTask(task.id, apiKey);
            return {
                videoUrl: videoUrl,
                provider: `AIHubMix (${finalModel})`
            };
        } else {
            throw new Error("Invalid response format from AIHubMix API");
        }
    } catch (error) {
        console.error("AIHubMix Image-to-Video Failed:", error);
        throw error;
    }
};

/**
 * Get available AIHubMix video models
 */
export const getAIHubMixVideoModels = () => {
    return [
        {
            id: "sora-2-pro",
            name: "Sora 2 Pro",
            description: "OpenAI's advanced video generation model",
            supportsTextToVideo: true,
            supportsImageToVideo: true,
            maxSeconds: 12,
            resolutions: ["720x1280", "1280x720"]
        },
        {
            id: "sora-2",
            name: "Sora 2",
            description: "OpenAI's video generation model",
            supportsTextToVideo: true,
            supportsImageToVideo: true,
            maxSeconds: 8,
            resolutions: ["720x1280", "1280x720"]
        },
        {
            id: "veo-3.1-generate-preview",
            name: "Veo 3.1",
            description: "Google's advanced video generation model",
            supportsTextToVideo: true,
            supportsImageToVideo: false,
            maxSeconds: 8,
            resolutions: ["720p", "1080p"]
        },
        {
            id: "veo-3.0-generate-preview",
            name: "Veo 3.0",
            description: "Google's video generation model",
            supportsTextToVideo: true,
            supportsImageToVideo: false,
            maxSeconds: 8,
            resolutions: ["720p", "1080p"]
        },
        {
            id: "wan2.5-i2v-preview",
            name: "Wan 2.5 I2V",
            description: "Alibaba's image-to-video model",
            supportsTextToVideo: false,
            supportsImageToVideo: true,
            maxSeconds: 10,
            resolutions: ["480p", "720p", "1080p"]
        },
        {
            id: "wan2.5-t2v-preview",
            name: "Wan 2.5 T2V",
            description: "Alibaba's text-to-video model",
            supportsTextToVideo: true,
            supportsImageToVideo: false,
            maxSeconds: 10,
            resolutions: ["480p", "720p", "1080p"]
        },
        {
            id: "wan2.2-i2v-plus",
            name: "Wan 2.2 I2V Plus",
            description: "Alibaba's image-to-video model",
            supportsTextToVideo: false,
            supportsImageToVideo: true,
            maxSeconds: 5,
            resolutions: ["480p", "720p"]
        },
        {
            id: "wan2.2-t2v-plus",
            name: "Wan 2.2 T2V Plus",
            description: "Alibaba's text-to-video model",
            supportsTextToVideo: true,
            supportsImageToVideo: false,
            maxSeconds: 5,
            resolutions: ["480p", "720p"]
        }
    ];
};
