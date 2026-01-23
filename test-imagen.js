
const apiKey = process.env.GEMINI_API_KEY;
const baseUrl = "https://generativelanguage.googleapis.com";

console.log("Testing Imagen 3 API...");

async function testImagen() {
    try {
        const url = `${baseUrl}/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKey}`;
        console.log("URL:", url);

        const payload = {
            instances: [
                { prompt: "A cute robot drawing, vector art" }
            ],
            parameters: {
                sampleCount: 1,
                aspectRatio: "1:1"
            }
        };

        console.log("Payload:", JSON.stringify(payload, null, 2));

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response Body:", text);
        } else {
            console.log("SUCCESS! Imagen API responded.");
            const data = await response.json();
            // Don't log full base64
            if (data.predictions) {
                console.log("Predictions received:", data.predictions.length);
            } else {
                console.log("Data received (no predictions):", data);
            }
        }
    } catch (error) {
        console.error("CONNECTION FAILED:", error);
    }
}

testImagen();
