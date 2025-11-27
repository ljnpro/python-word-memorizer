const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let dataFilePath;

const readPersisted = () => {
  if (!dataFilePath) return {};
  try {
    if (!fs.existsSync(dataFilePath)) return {};
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('读取持久化数据失败', err);
    return {};
  }
};

const writePersisted = (payload) => {
  if (!dataFilePath) return false;
  try {
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('写入持久化数据失败', err);
    return false;
  }
};

const setupPersistence = () => {
  dataFilePath = path.join(app.getPath('userData'), 'lumen-words.json');
  ipcMain.handle('persist:load', () => readPersisted());
  ipcMain.handle('persist:save', (_event, payload) => {
    const existing = readPersisted();
    const next = { ...existing, ...payload };
    writePersisted(next);
    return next;
  });
};

function createWindow() {
  const isDev = !app.isPackaged;
  const devServerURL = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  const indexPath = path.join(__dirname, 'build', 'index.html');

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const loadLocalBuild = () => win.loadFile(indexPath);

  if (isDev) {
    win.loadURL(devServerURL).catch(loadLocalBuild);
    // 如果开发服务器不可用，自动回退到本地构建文件
    win.webContents.once('did-fail-load', loadLocalBuild);
  } else {
    loadLocalBuild();
  }
}

app.whenReady().then(() => {
  setupPersistence();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
