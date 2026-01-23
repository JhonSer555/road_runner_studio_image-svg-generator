
const apiKey = process.env.HUGGING_FACE_TOKEN;
const modelId = "stabilityai/stable-diffusion-xl-base-1.0";
const url = `https://huggingface.co/api/models/${modelId}/inference`;

console.log("Testing Hugging Face API...");
console.log("URL:", url);

async function testHF() {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inputs: "A futuristic car on a highway, vector art" })
        });

        if (!response.ok) {
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response Body:", text);
        } else {
            console.log("SUCCESS! HF API responded.");
            const contentType = response.headers.get("content-type");
            console.log("Content-Type:", contentType);
            const blob = await response.blob();
            console.log("Blob size:", blob.size);
        }
    } catch (error) {
        console.error("CONNECTION FAILED:", error);
    }
}

testHF();
