
// Dependency-free test script for AI Horde (Stable Horde)
// node test-aihorde.js

async function testAIHorde() {
    console.log("Testing AI Horde Anonymous API...");

    const apiKey = "0000000000";
    const baseUrl = "https://aihorde.net/api/v2";

    try {
        // 1. Submit Request
        console.log("Submitting generation request...");
        const submitRes = await fetch(`${baseUrl}/generate/async`, {
            method: "POST",
            headers: {
                "apikey": apiKey,
                "Content-Type": "application/json",
                "Client-Agent": "RoadRunnerStudio:1.0:TestScript"
            },
            body: JSON.stringify({
                prompt: "A beautiful sunset over a cyberpunk city",
                params: {
                    sampler_name: "k_euler_a",
                    height: 512,
                    width: 512,
                    steps: 20,
                    n: 1
                },
                models: ["ICBINP - I Can't Believe It's Not Photoreal", "Stable Diffusion XL"],
            }),
        });

        if (!submitRes.ok) {
            const text = await submitRes.text();
            console.error(`Submission Error (${submitRes.status}):`, text);
            return;
        }

        const { id } = await submitRes.json();
        console.log(`Request ID: ${id}`);

        // 2. Poll for Completion
        let isDone = false;
        let attempts = 0;
        while (!isDone && attempts < 30) {
            attempts++;
            console.log(`Polling attempt ${attempts}...`);
            await new Promise(r => setTimeout(r, 5000)); // Poll every 5 seconds

            const checkRes = await fetch(`${baseUrl}/generate/check/${id}`, {
                method: "GET",
                headers: { "apikey": apiKey }
            });

            if (!checkRes.ok) continue;

            const status = await checkRes.json();
            if (status.done) {
                isDone = true;
                console.log("Generation complete!");
            } else {
                console.log(`Status: Queue Pos: ${status.queue_position}, Wait Time: ${status.wait_time}s`);
            }
        }

        if (!isDone) {
            console.error("Timed out waiting for generation.");
            return;
        }

        // 3. Get Result
        console.log("Retrieving result...");
        const statusRes = await fetch(`${baseUrl}/generate/status/${id}`, {
            method: "GET",
            headers: { "apikey": apiKey }
        });

        const finalData = await statusRes.json();
        const generation = finalData.generations?.[0];

        if (generation && generation.img) {
            console.log("✅ Success! Image generated.");
            console.log("Image data length:", generation.img.length);
            console.log("Image preview (first 100 chars):", generation.img.substring(0, 100));
        } else {
            console.error("Unexpected result payload:", finalData);
        }

    } catch (error) {
        console.error("🚨 Test failed:", error);
    }
}

testAIHorde();
