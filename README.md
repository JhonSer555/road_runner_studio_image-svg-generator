<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1fmbkFnc1QwWpRcxUCp_Uc47gMZea1Fiv

## Run locally

Follow these steps to run the app on your machine.

### 1. Prerequisites

- Node.js 18 or higher installed

### 2. Clone the repository


git clone https://github.com/JhonSer555/road_runner_studio_image-svg-generator.git
cd road_runner_studio_image-svg-generator

3. Install dependencies

npm install

5. Configure environment variables

Create a file named .env.local in the project root and add your Gemini API key:

GEMINI_API_KEY=your_gemini_api_key_here
You can get a Gemini API key from https://ai.google.dev.

5. Run the app

npm run dev
