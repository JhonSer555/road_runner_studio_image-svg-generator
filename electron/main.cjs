const path = require('path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const appUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';

let mainWindow = null;
let updaterConfigured = false;

const normalizeUpdaterErrorMessage = (error) => {
  const fallback = 'Failed to check for updates.';
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error.message === 'string'
        ? error.message
        : '';

  if (!raw) return fallback;

  const normalized = raw.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('status code 404') || lower.includes('not found') || lower.includes('latest.yml')) {
    return 'Updates are not available yet. Please try again later.';
  }

  if (
    lower.includes('internet_disconnected') ||
    lower.includes('timed out') ||
    lower.includes('econn') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('network')
  ) {
    return 'Unable to reach the update server. Check your internet connection and try again.';
  }

  if (lower.includes('rate limit')) {
    return 'Update service rate limit reached. Please try again later.';
  }

  return normalized.split(' at ')[0] || fallback;
};

const sendUpdaterStatus = (payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:status', payload);
};

const setupAutoUpdater = () => {
  if (isDev || updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterStatus({ stage: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdaterStatus({ stage: 'available', version: info?.version || null });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdaterStatus({ stage: 'not-available', version: info?.version || null });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterStatus({
      stage: 'downloading',
      percent: Number.isFinite(progress?.percent) ? progress.percent : 0,
      transferred: Number.isFinite(progress?.transferred) ? progress.transferred : 0,
      total: Number.isFinite(progress?.total) ? progress.total : 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdaterStatus({ stage: 'downloaded', version: info?.version || null });
  });

  autoUpdater.on('error', (error) => {
    sendUpdaterStatus({ stage: 'error', message: normalizeUpdaterErrorMessage(error) });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      sendUpdaterStatus({ stage: 'error', message: normalizeUpdaterErrorMessage(error) });
    });
  }, 10000);
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#0b1120',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (!currentUrl) return;
    const sameOrigin = new URL(url).origin === new URL(currentUrl).origin;
    if (!sameOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    await mainWindow.loadURL(appUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.setAppUserModelId('com.fdtiger777.roadrunnerstudio');

ipcMain.handle('updater:check', async () => {
  if (isDev) return { ok: false, reason: 'dev-mode' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (error) {
    const message = normalizeUpdaterErrorMessage(error);
    sendUpdaterStatus({ stage: 'error', message });
    return { ok: false, message };
  }
});

ipcMain.handle('updater:quitAndInstall', () => {
  if (isDev) return false;
  autoUpdater.quitAndInstall(true, true);
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:isPackaged', () => app.isPackaged);

ipcMain.handle('pdf:save', async (_event, payload) => {
  let pdfWindow = null;
  let tempHtmlPath = '';

  try {
    const html = typeof payload?.html === 'string' ? payload.html : '';
    if (!html.trim()) {
      return { ok: false, error: 'Nothing to export.' };
    }

    const defaultFileNameRaw = typeof payload?.defaultFileName === 'string'
      ? payload.defaultFileName.trim()
      : '';
    const defaultFileName = defaultFileNameRaw
      ? (defaultFileNameRaw.toLowerCase().endsWith('.pdf') ? defaultFileNameRaw : `${defaultFileNameRaw}.pdf`)
      : `roadrunner-${Date.now()}.pdf`;

    pdfWindow = new BrowserWindow({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    tempHtmlPath = path.join(
      app.getPath('temp'),
      `rrs-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    );
    await fs.writeFile(tempHtmlPath, html, 'utf8');
    await pdfWindow.loadFile(tempHtmlPath);

    await pdfWindow.webContents
      .executeJavaScript(
        `
        new Promise((resolve) => {
          const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(done).catch(done);
          } else {
            done();
          }
        });
        `,
        true
      )
      .catch(() => {});

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: false,
    });

    const saveResult = await dialog.showSaveDialog(mainWindow || pdfWindow, {
      title: 'Save PDF',
      defaultPath: defaultFileName,
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true };
    }

    await fs.writeFile(saveResult.filePath, pdfBuffer);
    return { ok: true, filePath: saveResult.filePath };
  } catch (error) {
    return { ok: false, error: error?.message || 'Failed to export PDF.' };
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
    if (tempHtmlPath) {
      await fs.unlink(tempHtmlPath).catch(() => {});
    }
  }
});

app.whenReady().then(async () => {
  await createMainWindow();
  setupAutoUpdater();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
      setupAutoUpdater();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
