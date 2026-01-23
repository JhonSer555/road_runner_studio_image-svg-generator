
// node test-hf-russian.js
const token = process.env.HUGGING_FACE_TOKEN;
const model = "black-forest-labs/FLUX.1-schnell";
const prompt = "Кот в сапогах со шпагой стоит как человек на задних лапах на голове широкополосная шляпа вокруг молодые красивые девушки";

async function testHF() {
    console.log(`Testing Hugging Face with Russian prompt: "${prompt}"...`);

    try {
        const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: prompt }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error(`HF Error (${response.status}):`, JSON.stringify(err, null, 2));
            return;
        }

        const contentType = response.headers.get("content-type");
        console.log("Response Content-Type:", contentType);

        if (contentType && contentType.includes("image")) {
            const buffer = await response.arrayBuffer();
            console.log("✅ Success! Received image buffer. Size:", buffer.byteLength);
        } else {
            const data = await response.json();
            console.log("Unexpected response data:", data);
        }
    } catch (error) {
        console.error("🚨 Test failed:", error);
    }
}

testHF();
