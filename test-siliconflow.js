
// Dependency-free test script for Node.js 22
// Usage: node --env-file=.env test-siliconflow.js

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;

if (!SILICONFLOW_API_KEY) {
    console.error("SILICONFLOW_API_KEY is missing!");
    console.log("Please run this script using: node --env-file=.env test-siliconflow.js");
    process.exit(1);
}

async function testSiliconFlow() {
    console.log("Testing SiliconFlow API (Flux Schnell)...");

    try {
        const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${SILICONFLOW_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "black-forest-labs/FLUX.1-schnell",
                prompt: "A beautiful sunset over a cyberpunk city",
                image_size: "1024x1024",
                batch_size: 1,
                num_inference_steps: 4,
                guidance_scale: 7.5
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`API Error (${response.status}):`, text);
            return;
        }

        const data = await response.json();

        // SiliconFlow returns { images: [{ url: "..." }] }
        const imgUrl = data.images?.[0]?.url || data.data?.[0]?.url;

        if (imgUrl) {
            console.log("✅ Success! Image generated.");
            console.log("Image URL:", imgUrl);
        } else {
            console.error("❓ Unexpected response payload:", JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error("🚨 Request failed:", error);
    }
}

testSiliconFlow();
