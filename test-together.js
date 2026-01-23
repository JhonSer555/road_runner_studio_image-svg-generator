
const fetch = require('node-fetch');
require('dotenv').config();

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

if (!TOGETHER_API_KEY) {
    console.error("TOGETHER_API_KEY is missing in .env");
    process.exit(1);
}

async function testTogether() {
    console.log("Testing Together AI API...");

    try {
        const response = await fetch('https://api.together.xyz/v1/images/generations', {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${TOGETHER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "black-forest-labs/FLUX.1-schnell",
                prompt: "A beautiful sunset over a cyberpunk city",
                width: 1024,
                height: 1024,
                steps: 4,
                n: 1,
                response_format: "b64_json"
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            console.error("API Error:", err);
            return;
        }

        const data = await response.json();
        console.log("Success! Image generated.");
        console.log("Response format check:", !!data.data[0].b64_json);
    } catch (error) {
        console.error("Request failed:", error);
    }
}

testTogether();
