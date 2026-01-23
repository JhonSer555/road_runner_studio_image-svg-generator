const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 850,
        title: "Road Runner Studio",
        backgroundColor: "#0f172a", // slate-900
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        // Убираем стандартное меню для чистого вида Web App
        autoHideMenuBar: true
    });

    // В разработке грузим с локалхоста, в продакшене из билда
    const startUrl = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, '../dist/index.html')}`;

    win.loadURL(startUrl);

    // Ссылки в отдельном браузере
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (isDev) {
        // win.webContents.openDevTools(); // Раскомментируйте если нужны инструменты разработчика
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
