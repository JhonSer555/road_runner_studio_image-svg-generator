<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1fmbkFnc1QwWpRcxUCp_Uc47gMZea1Fiv
<img width="960" height="488" alt="Снимок экрана 2026-02-19 232726" src="https://github.com/user-attachments/assets/1cb004e7-06cb-4cdd-9781-0e16587bbbdc" />
<img width="960" height="484" alt="Снимок экрана 2026-02-19 233016" src="https://github.com/user-attachments/assets/71313991-96a4-406d-86d4-8e43f65bc88d" />
<img width="960" height="486" alt="Снимок экрана 2026-02-19 233143" src="https://github.com/user-attachments/assets/85dea5f2-51cd-4318-971c-602a1cbc781d" />
<img width="960" height="486" alt="Снимок экрана 2026-02-19 233439" src="https://github.com/user-attachments/assets/ce32ee70-37c9-4c8f-9a57-264c9eb9a87e" />
<img width="960" height="369" alt="Снимок экрана 2026-02-20 032842" src="https://github.com/user-attachments/assets/77eef521-3c73-437b-afe7-27fa971c0703" />

## Run locally

Follow these steps to run the app on your machine.

### 1. Prerequisites

- Node.js 18 or higher installed

### 2. Clone the repository
```bash
git clone https://github.com/JhonSer555/road_runner_studio_image-svg-generator.git
```

### 3. Go to the directory
```bash
cd road_runner_studio_image-svg-generator
```

### 4. Install dependencies
```bash
npm install
```

### 5. Run the app
```bash
npm run dev
```

## Desktop (Windows .exe installer)

This project now supports Electron + NSIS installer with:
- install path selection
- desktop/start menu shortcuts
- uninstall entry in Control Panel
- app update checks via GitHub Releases

### Run desktop app in dev mode
```bash
npm run dev:desktop
```

### Build installer (.exe)
```bash
npm run build:desktop
```

Output folder:
- `release/`

### Build unpacked desktop app (without installer)
```bash
npm run build:desktop:dir
```

### Auto-update flow (GitHub Releases)

The desktop app checks updates from:
- `JhonSer555/road_runner_studio_image-svg-generator`

To publish a new desktop update:
1. Bump app version in `package.json`.
2. Build and publish artifacts to GitHub Releases.
3. Users get in-app update notification and can restart to install.

Notes:
- Without code signing, Windows SmartScreen may show a warning.
- `Publisher` in Windows comes from certificate identity; without signature it stays unknown.

<p align="center">
  © Created by <strong><span style="color:#0d47a1;">@FDTiger777</span></strong>
</p>

## Legal

- This project is protected under a proprietary license.
- See `LICENSE` for terms of use and restrictions.
- Author: `@FDTiger777`
- Version: `2.8.3`



