
const apiKey = process.env.GEMINI_API_KEY;
const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

console.log("Testing Gemini API Connection...");
console.log("URL:", `${baseUrl}/v1/models/gemini-2.5-flash:generateContent?key=${apiKey.substring(0, 5)}...`);

async function testConnection() {
    try {
        const response = await fetch(`${baseUrl}/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "Hello, world!" }] }]
            })
        });

        if (!response.ok) {
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response:", text);
        } else {
            console.log("SUCCESS! API connection working.");
            const data = await response.json();
            console.log("Data received:", JSON.stringify(data, null, 2).substring(0, 100) + "...");
        }
    } catch (error) {
        console.error("CONNECTION FAILED:", error.message);
        if (error.cause) console.error("Cause:", error.cause);
    }
}

testConnection();
