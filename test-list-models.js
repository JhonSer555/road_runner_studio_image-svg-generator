
const apiKey = process.env.GEMINI_API_KEY;
const baseUrl = "https://generativelanguage.googleapis.com";

console.log("Listing available models...");

async function listModels() {
    try {
        const url = `${baseUrl}/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response:", text);
            return;
        }

        const data = await response.json();
        console.log("Models found:");
        data.models.forEach(m => {
            console.log(`- ${m.name} (${m.supportedGenerationMethods.join(", ")})`);
        });

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
