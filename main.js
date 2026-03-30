const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { autoUpdater } = require('electron-updater');
const { CronExpressionParser } = require('cron-parser');

// 检测可用的 Shell
function detectShell() {
  const pwshPaths = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
  ];
  for (const p of pwshPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

const shellPath = detectShell();
let mainWindow = null;
let tray = null;
const sessions = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Split Terminal',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // 监听渲染进程控制台消息
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    console.log(`[Renderer ${levels[level] || level}] ${message} (${sourceId}:${line})`);
  });

  // 设置右键菜单（含检查更新）
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '检查更新',
      click: () => checkForUpdatesManually(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
  mainWindow.hookWindowMessage && mainWindow.hookWindowMessage(0x0313, () => {
    contextMenu.popup({ window: mainWindow });
  });

  // 启动后静默检查更新（延迟 3 秒，避免影响启动速度）
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);

  // 检查是否有上次下载完成但未安装的更新
  setTimeout(() => {
    const file = getPendingUpdateFile();
    try {
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater:pending-install', { version: data.version });
        }
      }
    } catch { /* ignore */ }
  }, 1500);

  // ============ 系统托盘 ============
  const iconPath = path.join(__dirname, 'icon.ico');
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Split Terminal');

  const trayMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '查看任务状态',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('scheduler:showPanel');
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 拦截窗口关闭：有启用的定时任务时最小化到托盘
  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    const hasEnabledTasks = schedulerTasks.some(t => t.enabled);
    if (hasEnabledTasks) {
      e.preventDefault();
      mainWindow.hide();
      tray.displayBalloon({
        iconType: 'info',
        title: 'Split Terminal',
        content: '已最小化到系统托盘，定时任务将继续运行。',
      });
    }
  });
}

ipcMain.handle('pty:create', (event, { id, cols, rows, cwd }) => {
  const ptyProcess = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd || os.homedir(),
    env: (() => { const e = { ...process.env }; delete e.CLAUDECODE; return e; })(),
  });

  sessions.set(id, ptyProcess);

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:data', { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', { id, exitCode });
    }
  });

  return { id, shell: shellPath };
});

ipcMain.on('pty:write', (event, { id, data }) => {
  const proc = sessions.get(id);
  if (!proc) return;

  // 分块写入，避免大段文本丢失（尤其是 Claude CLI 等交互式程序）
  // 同时确保 ANSI 转义序列不被拆断
  const CHUNK_SIZE = 256;
  const CHUNK_DELAY = 50;

  // 查找安全的分割点，避免拆断 ANSI 转义序列
  const findSafeEnd = (str, start, maxEnd) => {
    let end = Math.min(start + maxEnd, str.length);
    if (end >= str.length) return end;

    // 检查末尾 20 字节内是否有未闭合的 ESC 序列
    const lookback = Math.min(20, end - start);
    const tail = str.slice(end - lookback, end);
    const escIdx = tail.lastIndexOf('\x1b');

    if (escIdx !== -1) {
      // 找到 ESC，检查是否有闭合（以字母结尾）
      const afterEsc = tail.slice(escIdx);
      const hasTerminator = /\x1b\[[0-9;]*[A-Za-z]/.test(afterEsc);
      if (!hasTerminator) {
        // 未闭合，回退到 ESC 之前
        return end - lookback + escIdx;
      }
    }
    return end;
  };

  if (data.length <= CHUNK_SIZE) {
    proc.write(data);
  } else {
    let offset = 0;
    const writeChunk = () => {
      if (offset >= data.length) return;
      const safeEnd = findSafeEnd(data, offset, CHUNK_SIZE);
      const chunk = data.slice(offset, safeEnd);
      if (chunk.length > 0) proc.write(chunk);
      offset = safeEnd;
      setTimeout(writeChunk, CHUNK_DELAY);
    };
    writeChunk();
  }
});

ipcMain.on('pty:resize', (event, { id, cols, rows }) => {
  const proc = sessions.get(id);
  if (proc) {
    try { proc.resize(cols, rows); } catch (e) { /* ignore */ }
  }
});

ipcMain.on('pty:kill', (event, { id }) => {
  const proc = sessions.get(id);
  if (proc) {
    proc.kill();
    sessions.delete(id);
  }
});

// ============ 自动更新 ============
autoUpdater.autoDownload = true; // 发现新版本后静默后台下载

const UPDATER_MIRROR_URL = 'https://mirror.ghproxy.com/https://github.com/liangmu-git2/split-terminal/releases/latest/download';
const UPDATER_GITHUB_URL = 'https://github.com/liangmu-git2/split-terminal/releases/latest/download';
let updaterUsingMirror = true; // 当前是否使用镜像

function setUpdaterFeed(useMirror) {
  updaterUsingMirror = useMirror;
  const url = useMirror ? UPDATER_MIRROR_URL : UPDATER_GITHUB_URL;
  autoUpdater.setFeedURL({ provider: 'generic', url });
  console.log(`[Updater] Feed URL: ${useMirror ? 'mirror' : 'github direct'}`);
}

setUpdaterFeed(true); // 默认走镜像

function getPendingUpdateFile() {
  return path.join(app.getPath('userData'), 'pending-update.json');
}

autoUpdater.on('update-available', (info) => {
  // 静默下载，不通知用户（下载完成后再提示）
  console.log('[Updater] Update available:', info.version, '- downloading silently...');
});

autoUpdater.on('update-not-available', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:update-not-available');
});

autoUpdater.on('download-progress', (progress) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:download-progress', {
    percent: Math.round(progress.percent),
    bytesPerSecond: progress.bytesPerSecond || 0,
    transferred: progress.transferred || 0,
    total: progress.total || 0,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  // 写标记文件，下次启动时提示安装
  try {
    fs.writeFileSync(getPendingUpdateFile(), JSON.stringify({ version: info.version }), 'utf-8');
  } catch (e) {
    console.error('[Updater] Failed to write pending-update.json:', e);
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:update-downloaded', { version: info.version });
});

autoUpdater.on('error', (err) => {
  // 镜像失败时自动回退到 GitHub 直连重试一次
  if (updaterUsingMirror) {
    console.log('[Updater] Mirror failed, falling back to GitHub direct:', err.message);
    setUpdaterFeed(false);
    autoUpdater.checkForUpdates().catch(() => {});
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:error', { message: err.message });
});

function checkForUpdatesManually() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updater:checking');
  setUpdaterFeed(true); // 手动检查时重新从镜像开始尝试
  autoUpdater.checkForUpdates().catch((err) => {
    mainWindow.webContents.send('updater:error', { message: err.message });
  });
}

ipcMain.handle('updater:checkForUpdates', () => {
  checkForUpdatesManually();
});

ipcMain.handle('updater:downloadUpdate', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle('updater:installUpdate', () => {
  autoUpdater.quitAndInstall();
});

// 检查是否有待安装的更新（上次下载完成但未安装）
ipcMain.handle('updater:checkPending', () => {
  const file = getPendingUpdateFile();
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return data; // { version }
    }
  } catch { /* ignore */ }
  return null;
});

// 清除待安装标记（用户选择"稍后"时）
ipcMain.handle('updater:clearPending', () => {
  try {
    const file = getPendingUpdateFile();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch { /* ignore */ }
});

app.whenReady().then(createWindow);

// ============ 布局持久化 ============
function getLayoutFile() {
  return path.join(app.getPath('userData'), 'window-layout.json');
}

ipcMain.handle('layout:save', (event, layout) => {
  try {
    fs.writeFileSync(getLayoutFile(), JSON.stringify(layout, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('layout:load', () => {
  const file = getLayoutFile();
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* ignore */ }
  return null;
});

// ============ 历史记录存储 ============
function getHistoryDir() {
  const dir = path.join(app.getPath('userData'), 'history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('history:save', (event, record) => {
  const dir = getHistoryDir();
  const id = Date.now().toString();
  const data = { id, ...record, closedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2), 'utf-8');
  return id;
});

ipcMain.handle('history:update', (event, { id, record }) => {
  const dir = getHistoryDir();
  const filePath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  const data = { id, ...record, closedAt: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

ipcMain.handle('history:list', () => {
  const dir = getHistoryDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return { id: data.id, name: data.name, createdAt: data.createdAt, closedAt: data.closedAt };
    } catch { return null; }
  }).filter(Boolean);
  list.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  return list;
});

ipcMain.handle('history:get', (event, id) => {
  const file = path.join(getHistoryDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
});

ipcMain.handle('history:delete', (event, id) => {
  const file = path.join(getHistoryDir(), `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
});

ipcMain.handle('history:clear', () => {
  const dir = getHistoryDir();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    fs.unlinkSync(path.join(dir, f));
  }
});

// ============ 文件系统 IPC ============
ipcMain.handle('fs:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:readDir', (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));
    // 文件夹优先，然后按名称排序
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return items;
  } catch (e) {
    return [];
  }
});

ipcMain.handle('fs:createFile', (event, filePath) => {
  try {
    fs.writeFileSync(filePath, '', 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:createFolder', (event, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:showInExplorer', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('fs:openFile', (event, filePath) => {
  return shell.openPath(filePath);
});

// 文件系统监听
let fsWatcher = null;
let fsWatchDebounce = null;

ipcMain.handle('fs:watch', (event, dirPath) => {
  if (fsWatcher) { fsWatcher.close(); fsWatcher = null; }
  if (!dirPath || !fs.existsSync(dirPath)) return;
  try {
    fsWatcher = fs.watch(dirPath, { recursive: true }, (eventType) => {
      // 只在文件创建/删除/重命名时刷新，忽略纯内容修改
      if (eventType !== 'rename') return;
      clearTimeout(fsWatchDebounce);
      fsWatchDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('fs:changed');
        }
      }, 500);
    });
  } catch (e) {
    console.error('fs:watch error:', e);
  }
});

ipcMain.handle('fs:unwatch', () => {
  if (fsWatcher) { fsWatcher.close(); fsWatcher = null; }
});

ipcMain.handle('fs:rename', (event, { oldPath, newPath }) => {
  try {
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:delete', (event, { targetPath, isDirectory }) => {
  try {
    if (isDirectory) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 从剪贴板粘贴文件到目标目录
ipcMain.handle('fs:pasteFiles', (event, { targetDir }) => {
  try {
    const { clipboard } = require('electron');
    // Windows: 读取剪贴板中的文件路径列表
    // Electron clipboard.readBuffer('FileNameW') 可以读取文件路径
    // 但更可靠的方式是用 native-image 检测或 readBuffer
    if (process.platform === 'win32') {
      // 尝试读取 CF_HDROP 格式（文件列表）
      const rawBuffer = clipboard.readBuffer('FileNameW');
      if (rawBuffer && rawBuffer.length > 0) {
        // FileNameW 是 UTF-16LE 编码的文件路径，以双 null 结尾
        const decoded = rawBuffer.toString('utf16le');
        const filePaths = decoded.split('\0').filter(p => p.length > 0);
        if (filePaths.length === 0) {
          return { success: false, error: '剪贴板中没有文件' };
        }
        const results = [];
        for (const srcPath of filePaths) {
          const baseName = path.basename(srcPath);
          let destPath = path.join(targetDir, baseName);
          // 处理同名文件
          if (fs.existsSync(destPath)) {
            const ext = path.extname(baseName);
            const nameNoExt = path.basename(baseName, ext);
            let i = 1;
            while (fs.existsSync(destPath)) {
              destPath = path.join(targetDir, `${nameNoExt} (${i})${ext}`);
              i++;
            }
          }
          fs.copyFileSync(srcPath, destPath);
          results.push(destPath);
        }
        return { success: true, files: results };
      }
    }
    return { success: false, error: '不支持的剪贴板格式' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 验证路径是否存在
ipcMain.handle('fs:validatePath', (event, pathToValidate) => {
  try {
    const exists = fs.existsSync(pathToValidate);
    const isDirectory = exists ? fs.statSync(pathToValidate).isDirectory() : false;
    return exists && isDirectory;
  } catch {
    return false;
  }
});

// ============ 最近打开文件夹 ============
function getRecentFoldersFile() {
  return path.join(app.getPath('userData'), 'recent-folders.json');
}

function getLastFolderFile() {
  return path.join(app.getPath('userData'), 'last-folder.json');
}

ipcMain.handle('recentFolders:get', () => {
  const file = getRecentFoldersFile();
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) { /* ignore */ }
  return [];
});

ipcMain.handle('recentFolders:save', (event, list) => {
  fs.writeFileSync(getRecentFoldersFile(), JSON.stringify(list), 'utf-8');
});

ipcMain.handle('lastFolder:get', () => {
  const file = getLastFolderFile();
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* ignore */ }
  return null;
});

ipcMain.handle('lastFolder:save', (event, folderPath) => {
  fs.writeFileSync(getLastFolderFile(), JSON.stringify(folderPath), 'utf-8');
});

// ============ Claude 会话管理 ============
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CODEX_HOME_DIR = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME_DIR, 'sessions');
const CODEX_ARCHIVED_SESSIONS_DIR = path.join(CODEX_HOME_DIR, 'archived_sessions');
const CODEX_SESSION_INDEX_FILE = path.join(CODEX_HOME_DIR, 'session_index.jsonl');
const readline = require('readline');

// 只读取文件前 N 行，避免读取整个大文件
function readFirstLines(filePath, maxLines) {
  return new Promise((resolve) => {
    const lines = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      lines.push(line);
      if (lines.length >= maxLines) {
        rl.close();
        stream.destroy();
      }
    });
    rl.on('close', () => resolve(lines));
    rl.on('error', () => resolve(lines));
  });
}

// 从 JSONL 行中提取第一条 user 消息摘要、cwd 和 slug
function extractSummaryAndCwd(lines) {
  let summary = '';
  let cwd = '';
  let slug = '';
  let firstUserSessionId = '';
  let hasAssistant = false;
  let hasClearCommand = false;
  let realUserCount = 0; // 非 meta 的 user 消息数
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (!cwd && msg.cwd) cwd = msg.cwd;
      if (!slug && msg.slug) slug = msg.slug;
      if (msg.type === 'assistant') hasAssistant = true;
      if (msg.type === 'user') {
        // 记录第一条 user 消息中的 sessionId（用于检测续接会话）
        if (!firstUserSessionId && msg.sessionId) firstUserSessionId = msg.sessionId;
        if (!msg.isMeta) {
          realUserCount++;
          const content = msg.message?.content;
          const text = typeof content === 'string' ? content : '';
          if (text.includes('<command-name>/clear</command-name>')) hasClearCommand = true;
        }
        if (!summary) {
          const content = msg.message?.content;
          if (typeof content === 'string') {
            summary = content.slice(0, 80).replace(/\n/g, ' ');
          } else if (Array.isArray(content)) {
            const textBlock = content.find(b => typeof b === 'string' || b.type === 'text');
            const text = typeof textBlock === 'string' ? textBlock : textBlock?.text || '';
            summary = text.slice(0, 80).replace(/\n/g, ' ');
          }
        }
      }
      if (summary && cwd && slug) break;
    } catch { continue; }
  }
  // /clear 产生的空会话：没有 assistant 回复，唯一的真实 user 消息就是 /clear 命令
  const isClearOnly = hasClearCommand && !hasAssistant && realUserCount <= 1;
  return { summary, cwd, slug, firstUserSessionId, isClearOnly };
}

function normalizePathForCompare(p) {
  return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function collectJsonlFiles(dirPath, into = []) {
  if (!fs.existsSync(dirPath)) return into;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsonlFiles(fullPath, into);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      into.push(fullPath);
    }
  }
  return into;
}

function extractCodexSessionIdFromPath(filePath) {
  const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : '';
}

function extractCodexCwd(lines) {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'session_meta' && msg.payload?.cwd) {
        return msg.payload.cwd;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return '';
}

function getCodexSessionMetaFile() {
  return path.join(app.getPath('userData'), 'codex-session-meta.json');
}

function readCodexSessionMeta() {
  try {
    const metaFile = getCodexSessionMetaFile();
    if (!fs.existsSync(metaFile)) return { names: {}, pins: [] };
    const raw = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    const names = {};
    if (raw && typeof raw.names === 'object' && raw.names && !Array.isArray(raw.names)) {
      for (const [sessionId, name] of Object.entries(raw.names)) {
        if (typeof name !== 'string') continue;
        const trimmed = name.trim();
        if (trimmed) names[sessionId] = trimmed;
      }
    }
    const pins = Array.isArray(raw?.pins)
      ? [...new Set(raw.pins.filter(id => typeof id === 'string' && id))]
      : [];
    return { names, pins };
  } catch {
    return { names: {}, pins: [] };
  }
}

function writeCodexSessionMeta(meta) {
  const normalized = {
    names: {},
    pins: Array.isArray(meta?.pins)
      ? [...new Set(meta.pins.filter(id => typeof id === 'string' && id))]
      : [],
  };

  if (meta && typeof meta.names === 'object' && meta.names && !Array.isArray(meta.names)) {
    for (const [sessionId, name] of Object.entries(meta.names)) {
      if (typeof name !== 'string') continue;
      const trimmed = name.trim();
      if (trimmed) normalized.names[sessionId] = trimmed;
    }
  }

  fs.writeFileSync(getCodexSessionMetaFile(), JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function buildCodexSessionFileMap() {
  const fileMap = new Map();
  for (const filePath of collectJsonlFiles(CODEX_SESSIONS_DIR)) {
    const sessionId = extractCodexSessionIdFromPath(filePath);
    if (!sessionId) continue;
    fileMap.set(sessionId, { filePath, archived: false });
  }
  for (const filePath of collectJsonlFiles(CODEX_ARCHIVED_SESSIONS_DIR)) {
    const sessionId = extractCodexSessionIdFromPath(filePath);
    if (!sessionId || fileMap.has(sessionId)) continue;
    fileMap.set(sessionId, { filePath, archived: true });
  }
  return fileMap;
}

function readCodexSessionIndexEntries() {
  if (!fs.existsSync(CODEX_SESSION_INDEX_FILE)) return [];
  const lines = fs.readFileSync(CODEX_SESSION_INDEX_FILE, 'utf-8').split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (!item.id || !item.updated_at) continue;
      entries.push(item);
    } catch {
      // ignore malformed lines
    }
  }
  return entries;
}

function writeCodexSessionIndexEntries(entries) {
  const content = entries.map(item => JSON.stringify(item)).join(os.EOL);
  fs.writeFileSync(CODEX_SESSION_INDEX_FILE, content ? content + os.EOL : '', 'utf-8');
}

async function listClaudeSessionsInternal({ rootPath } = {}) {
  try {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];

    const results = [];
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    for (const projDir of projectDirs) {
      if (!projDir.isDirectory()) continue;
      const projPath = path.join(CLAUDE_PROJECTS_DIR, projDir.name);

      // 读取自定义名称映射
      let nameMap = {};
      const namesFile = path.join(projPath, '_session-names.json');
      try {
        if (fs.existsSync(namesFile)) {
          nameMap = JSON.parse(fs.readFileSync(namesFile, 'utf-8'));
        }
      } catch { /* ignore */ }

      // 读取置顶列表
      let pinSet = new Set();
      const pinsFile = path.join(projPath, '_session-pins.json');
      try {
        if (fs.existsSync(pinsFile)) {
          pinSet = new Set(JSON.parse(fs.readFileSync(pinsFile, 'utf-8')));
        }
      } catch { /* ignore */ }

      // 项目目录名（用于显示）
      const projectName = projDir.name;

      let files;
      try {
        files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      // 第一遍：收集所有会话的元信息
      const sessionInfos = [];
      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projPath, file);
        try {
          const stat = fs.statSync(filePath);
          const firstLines = await readFirstLines(filePath, 50);
          const { summary, cwd, slug, firstUserSessionId, isClearOnly } = extractSummaryAndCwd(firstLines);
          if (isClearOnly) continue; // 跳过 /clear 产生的空会话
          if (!summary && !nameMap[sessionId]) continue;
          sessionInfos.push({
            sessionId, filePath, stat, summary, cwd, slug, firstUserSessionId,
            isOriginal: !firstUserSessionId || firstUserSessionId === sessionId,
          });
        } catch { continue; }
      }

      // 第二遍：按 slug 分组，每组保留原始会话的摘要，但 ID 用最新续接会话的
      const slugGroups = new Map(); // slug -> { original, latest, allInfos }
      const noSlug = []; // 没有 slug 的会话单独处理
      for (const info of sessionInfos) {
        if (!info.slug) {
          if (info.isOriginal) noSlug.push(info);
          continue;
        }
        const group = slugGroups.get(info.slug);
        if (!group) {
          slugGroups.set(info.slug, { original: info.isOriginal ? info : null, latest: info, allInfos: [info] });
        } else {
          group.allInfos.push(info);
          if (info.isOriginal) group.original = info;
          if (info.stat.mtimeMs > group.latest.stat.mtimeMs) group.latest = info;
        }
      }

      // 第三遍：将无 slug 的原始会话通过 firstUserSessionId 反向关联到 slug 组
      // 场景：原始会话创建时没有 slug（旧版 Claude Code），续接会话有 slug
      for (let i = noSlug.length - 1; i >= 0; i--) {
        const orphan = noSlug[i];
        let matched = false;
        for (const [, group] of slugGroups) {
          // 如果该组中有续接会话的 firstUserSessionId 指向这个无 slug 的原始会话
          if (group.allInfos.some(gi => gi.firstUserSessionId === orphan.sessionId && gi.sessionId !== orphan.sessionId)) {
            group.original = group.original || orphan;
            group.allInfos.push(orphan);
            noSlug.splice(i, 1);
            matched = true;
            break;
          }
        }
      }

      // 第四遍：将 noSlug 中通过 firstUserSessionId 互相关联的会话合并
      // 场景：/clear 后产生的新会话没有 slug，其 firstUserSessionId 指向原会话（也无 slug）
      const noSlugById = new Map(noSlug.map(info => [info.sessionId, info]));
      const noSlugGroups = new Map(); // 原始 sessionId -> { original, latest, allInfos }
      const noSlugMerged = new Set(); // 已被合并的 sessionId
      for (const info of noSlug) {
        if (noSlugMerged.has(info.sessionId)) continue;
        const parentId = info.firstUserSessionId;
        if (parentId && parentId !== info.sessionId && noSlugById.has(parentId)) {
          // 当前 info 是续接会话，parent 是原始会话
          const parent = noSlugById.get(parentId);
          const groupKey = parentId;
          if (!noSlugGroups.has(groupKey)) {
            noSlugGroups.set(groupKey, { original: parent, latest: parent, allInfos: [parent] });
            noSlugMerged.add(parentId);
          }
          const group = noSlugGroups.get(groupKey);
          group.allInfos.push(info);
          if (info.stat.mtimeMs > group.latest.stat.mtimeMs) group.latest = info;
          noSlugMerged.add(info.sessionId);
        }
      }

      // 合并结果：收集每组所有 sessionId 用于置顶/名称判断
      const merged = [];
      for (const [, group] of slugGroups) {
        const display = group.original || group.latest;
        const latest = group.latest;
        const allIds = [...new Set(group.allInfos.map(i => i.sessionId))];
        merged.push({ ...display, sessionId: latest.sessionId, stat: latest.stat, allIds });
      }
      for (const [, group] of noSlugGroups) {
        const display = group.original || group.latest;
        const allIds = [...new Set(group.allInfos.map(i => i.sessionId))];
        merged.push({ ...display, sessionId: group.latest.sessionId, stat: group.latest.stat, allIds });
      }
      for (const info of noSlug) {
        if (!noSlugMerged.has(info.sessionId)) {
          merged.push({ ...info, allIds: [info.sessionId] });
        }
      }

      for (const info of merged) {
        const { sessionId, summary, cwd } = info;

        // 如果指定了 rootPath，按 cwd 前缀过滤
        if (rootPath && cwd) {
          const normRoot = rootPath.replace(/\\/g, '/').toLowerCase();
          const normCwd = cwd.replace(/\\/g, '/').toLowerCase();
          if (!normCwd.startsWith(normRoot)) continue;
        } else if (rootPath && !cwd) {
          continue;
        }

        // 置顶状态：该组任一 sessionId 被置顶都算
        const isPinned = info.allIds.some(id => pinSet.has(id));

        results.push({
          provider: 'claude',
          id: sessionId,
          projectPath: projDir.name,
          projectName,
          cwd: cwd || '',
          summary,
          slug: info.slug || '',
          lastActive: info.stat.mtime.toISOString(),
          customName: info.allIds.map(id => nameMap[id]).find(Boolean) || null,
          pinned: isPinned,
        });
      }
    }

    // 置顶优先，然后按最后活跃时间倒序，限制 50 条
    results.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActive.localeCompare(a.lastActive);
    });
    return results.slice(0, 50);
  } catch (e) {
    console.error('claude:listSessions error:', e);
    return [];
  }
}

async function listCodexSessionsInternal({ rootPath } = {}) {
  try {
    if (!fs.existsSync(CODEX_SESSION_INDEX_FILE)) return [];

    const meta = readCodexSessionMeta();
    const pinSet = new Set(meta.pins);
    const fileMap = buildCodexSessionFileMap();
    const indexEntries = readCodexSessionIndexEntries();
    indexEntries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    const results = [];
    const normRoot = rootPath ? normalizePathForCompare(rootPath) : '';

    for (const entry of indexEntries) {
      const fileInfo = fileMap.get(entry.id);
      if (!fileInfo) continue;

      let cwd = '';
      try {
        cwd = extractCodexCwd(await readFirstLines(fileInfo.filePath, 3));
      } catch {
        cwd = '';
      }

      if (normRoot) {
        const normCwd = normalizePathForCompare(cwd);
        if (!normCwd || !normCwd.startsWith(normRoot)) continue;
      }

      const trimmedCwd = cwd.replace(/[\\/]+$/, '');
      const projectName = trimmedCwd ? path.basename(trimmedCwd) || trimmedCwd : 'Codex';
      const summary = entry.thread_name || `Codex 会话 ${entry.id.slice(0, 8)}`;
      const customName = meta.names[entry.id] || null;
      results.push({
        provider: 'codex',
        id: entry.id,
        projectPath: '',
        projectName,
        cwd,
        summary,
        lastActive: entry.updated_at,
        customName,
        pinned: pinSet.has(entry.id),
        archived: fileInfo.archived,
      });
    }

    results.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActive.localeCompare(a.lastActive);
    });
    return results.slice(0, 50);
  } catch (e) {
    console.error('codex:listSessions error:', e);
    return [];
  }
}

ipcMain.handle('claude:listSessions', async (event, { rootPath } = {}) => {
  return listClaudeSessionsInternal({ rootPath });
});

ipcMain.handle('conversation:listSessions', async (event, { rootPath, provider } = {}) => {
  const results = [];
  if (!provider || provider === 'claude') {
    results.push(...await listClaudeSessionsInternal({ rootPath }));
  }
  if (!provider || provider === 'codex') {
    results.push(...await listCodexSessionsInternal({ rootPath }));
  }
  results.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActive.localeCompare(a.lastActive);
  });
  return results.slice(0, 80);
});

ipcMain.handle('claude:renameSession', (event, { projectPath, sessionId, name }) => {
  try {
    const namesFile = path.join(CLAUDE_PROJECTS_DIR, projectPath, '_session-names.json');
    let nameMap = {};
    try {
      if (fs.existsSync(namesFile)) {
        nameMap = JSON.parse(fs.readFileSync(namesFile, 'utf-8'));
      }
    } catch { /* ignore */ }

    if (name) {
      nameMap[sessionId] = name;
    } else {
      delete nameMap[sessionId];
    }

    fs.writeFileSync(namesFile, JSON.stringify(nameMap, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('claude:pinSession', (event, { projectPath, sessionId, pinned }) => {
  try {
    const pinsFile = path.join(CLAUDE_PROJECTS_DIR, projectPath, '_session-pins.json');
    let pins = [];
    try {
      if (fs.existsSync(pinsFile)) {
        pins = JSON.parse(fs.readFileSync(pinsFile, 'utf-8'));
      }
    } catch { /* ignore */ }

    if (pinned) {
      if (!pins.includes(sessionId)) pins.push(sessionId);
    } else {
      pins = pins.filter(id => id !== sessionId);
    }

    fs.writeFileSync(pinsFile, JSON.stringify(pins, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 根据 cwd 查找指定时间之后新建的最新 Claude 会话
ipcMain.handle('claude:findLatestSession', async (event, { cwd, afterTime }) => {
  console.log('[findLatestSession] cwd:', cwd, 'afterTime:', new Date(afterTime).toISOString());
  try {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    let best = null;

    for (const projDir of projectDirs) {
      if (!projDir.isDirectory()) continue;
      const projPath = path.join(CLAUDE_PROJECTS_DIR, projDir.name);

      let files;
      try {
        files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl') && !f.startsWith('_') && !f.startsWith('agent-'));
      } catch { continue; }

      for (const file of files) {
        const filePath = path.join(projPath, file);
        try {
          const stat = fs.statSync(filePath);
          const birthTime = stat.birthtime ? stat.birthtime.getTime() : stat.ctime.getTime();
          if (birthTime < afterTime) continue;

          const firstLines = await readFirstLines(filePath, 50);
          const { summary, cwd: fileCwd, firstUserSessionId, isClearOnly } = extractSummaryAndCwd(firstLines);
          const sessionId = file.replace('.jsonl', '');

          // 跳过 /clear 产生的空会话
          if (isClearOnly) continue;

          // 跳过没有用户消息的文件（如 file-history-snapshot 备份文件）
          if (!summary && !fileCwd) continue;

          // 跳过续接会话（firstUserSessionId 不等于自身 ID，说明是从其他会话续接来的）
          // 这些会话应该通过原始会话来访问
          if (firstUserSessionId && firstUserSessionId !== sessionId) continue;

          // 如果文件有 cwd 且与目标 cwd 不匹配，跳过
          if (fileCwd && cwd) {
            const normCwd = cwd.replace(/\\/g, '/').toLowerCase();
            const normFileCwd = fileCwd.replace(/\\/g, '/').toLowerCase();
            if (normFileCwd !== normCwd) continue;
          }

          // 选最新创建的文件
          if (!best || birthTime > best.birthTime) {
            let customName = null;
            const namesFile = path.join(projPath, '_session-names.json');
            try {
              if (fs.existsSync(namesFile)) {
                const nameMap = JSON.parse(fs.readFileSync(namesFile, 'utf-8'));
                customName = nameMap[sessionId] || null;
              }
            } catch { /* ignore */ }

            best = {
              id: sessionId,
              projectPath: projDir.name,
              summary: summary || '',
              customName,
              birthTime,
            };
          }
        } catch { continue; }
      }
    }
    console.log('[findLatestSession] result:', best ? best.id : 'null');
    return best;
  } catch (e) {
    console.error('claude:findLatestSession error:', e);
    return null;
  }
});

ipcMain.handle('claude:deleteSession', (event, { projectPath, sessionId }) => {
  try {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, projectPath, `${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('codex:renameSession', (event, { sessionId, name }) => {
  try {
    const meta = readCodexSessionMeta();
    if (name) {
      meta.names[sessionId] = name;
    } else {
      delete meta.names[sessionId];
    }
    writeCodexSessionMeta(meta);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('codex:pinSession', (event, { sessionId, pinned }) => {
  try {
    const meta = readCodexSessionMeta();
    if (pinned) {
      if (!meta.pins.includes(sessionId)) meta.pins.push(sessionId);
    } else {
      meta.pins = meta.pins.filter(id => id !== sessionId);
    }
    writeCodexSessionMeta(meta);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('codex:deleteSession', (event, { sessionId }) => {
  try {
    const fileMap = buildCodexSessionFileMap();
    const fileInfo = fileMap.get(sessionId);
    if (fileInfo?.filePath && fs.existsSync(fileInfo.filePath)) {
      fs.unlinkSync(fileInfo.filePath);
    }

    const nextEntries = readCodexSessionIndexEntries().filter(entry => entry.id !== sessionId);
    writeCodexSessionIndexEntries(nextEntries);

    const meta = readCodexSessionMeta();
    delete meta.names[sessionId];
    meta.pins = meta.pins.filter(id => id !== sessionId);
    writeCodexSessionMeta(meta);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('claude:getSessionDetail', (event, { projectPath, sessionId }) => {
  try {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, projectPath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages = [];

    for (const line of lines) {
      if (messages.length >= 20) break;
      try {
        const msg = JSON.parse(line);
        let role = null;
        let text = '';

        if (msg.type === 'user') {
          role = 'user';
          const c = msg.message?.content;
          if (typeof c === 'string') {
            text = c;
          } else if (Array.isArray(c)) {
            const tb = c.find(b => typeof b === 'string' || b.type === 'text');
            text = typeof tb === 'string' ? tb : tb?.text || '';
          }
        } else if (msg.type === 'assistant') {
          role = 'assistant';
          const c = msg.message?.content;
          if (Array.isArray(c)) {
            const tb = c.find(b => b.type === 'text');
            text = tb?.text || '';
          } else if (typeof c === 'string') {
            text = c;
          }
        }

        if (role && text) {
          messages.push({ role, text: text.slice(0, 200).replace(/\n/g, ' ') });
        }
      } catch { continue; }
    }

    return messages;
  } catch (e) {
    console.error('claude:getSessionDetail error:', e);
    return [];
  }
});

// ============ 定时任务调度 ============
function getSchedulerTasksFile() {
  return path.join(app.getPath('userData'), 'scheduler-tasks.json');
}

function getSchedulerLogsDir() {
  const dir = path.join(app.getPath('userData'), 'scheduler-logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let schedulerTasks = [];
let schedulerInterval = null;

function loadTasks() {
  const file = getSchedulerTasksFile();
  try {
    if (fs.existsSync(file)) {
      schedulerTasks = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch { schedulerTasks = []; }
}

function saveTasks() {
  fs.writeFileSync(getSchedulerTasksFile(), JSON.stringify(schedulerTasks, null, 2), 'utf-8');
}

ipcMain.handle('scheduler:getTasks', () => {
  return schedulerTasks;
});

ipcMain.handle('scheduler:saveTask', (event, task) => {
  const idx = schedulerTasks.findIndex(t => t.id === task.id);
  if (idx >= 0) {
    schedulerTasks[idx] = task;
  } else {
    schedulerTasks.push(task);
  }
  saveTasks();
  return { success: true };
});

ipcMain.handle('scheduler:deleteTask', (event, taskId) => {
  schedulerTasks = schedulerTasks.filter(t => t.id !== taskId);
  saveTasks();
  // 清理该任务的日志
  try {
    const logsDir = getSchedulerLogsDir();
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith(taskId + '-'));
    for (const f of files) fs.unlinkSync(path.join(logsDir, f));
  } catch { /* ignore */ }
  return { success: true };
});

ipcMain.handle('scheduler:toggleTask', (event, { taskId, enabled }) => {
  const task = schedulerTasks.find(t => t.id === taskId);
  if (task) {
    task.enabled = enabled;
    saveTasks();
  }
  return { success: true };
});

ipcMain.handle('scheduler:getLogs', (event, taskId) => {
  try {
    const logsDir = getSchedulerLogsDir();
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith(taskId + '-') && f.endsWith('.json'))
      .sort().reverse().slice(0, 50);
    return files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
});

ipcMain.handle('scheduler:clearLogs', (event, taskId) => {
  try {
    const logsDir = getSchedulerLogsDir();
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith(taskId + '-'));
    for (const f of files) fs.unlinkSync(path.join(logsDir, f));
  } catch { /* ignore */ }
  return { success: true };
});

ipcMain.on('scheduler:reportResult', (event, result) => {
  const { taskId, status, summary, startedAt, finishedAt } = result;
  // 更新任务状态
  const task = schedulerTasks.find(t => t.id === taskId);
  if (task) {
    task.lastRunAt = finishedAt || new Date().toISOString();
    task.lastRunStatus = status;
    // 一次性任务执行后自动禁用
    if (task.scheduleType === 'once') {
      task.enabled = false;
    }
    saveTasks();
  }
  // 写日志
  try {
    const logsDir = getSchedulerLogsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `${taskId}-${timestamp}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
      taskId, status, summary,
      startedAt, finishedAt,
    }, null, 2), 'utf-8');
    // 保留最近 50 条
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith(taskId + '-') && f.endsWith('.json'))
      .sort();
    if (files.length > 50) {
      for (const f of files.slice(0, files.length - 50)) {
        fs.unlinkSync(path.join(logsDir, f));
      }
    }
  } catch (e) {
    console.error('scheduler:reportResult log error:', e);
  }
});

function startScheduler() {
  loadTasks();
  // 记录每日任务当天是否已执行
  const dailyRanToday = new Set();

  schedulerInterval = setInterval(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (const task of schedulerTasks) {
      if (!task.enabled) continue;
      if (task.lastRunStatus === 'running') continue;

      let shouldRun = false;

      if (task.scheduleType === 'daily' && task.dailyTime) {
        const [hh, mm] = task.dailyTime.split(':').map(Number);
        const targetMinutes = hh * 60 + mm;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const diff = Math.abs(nowMinutes - targetMinutes);
        const key = `${task.id}-${todayStr}`;
        if (diff <= 1 && !dailyRanToday.has(key)) {
          shouldRun = true;
          dailyRanToday.add(key);
        }
      } else if (task.scheduleType === 'interval' && task.intervalHours) {
        const intervalMs = task.intervalHours * 3600 * 1000;
        const lastRun = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
        if (now.getTime() - lastRun >= intervalMs) {
          shouldRun = true;
        }
      } else if (task.scheduleType === 'once' && task.onceDateTime) {
        const targetTime = new Date(task.onceDateTime).getTime();
        if (now.getTime() >= targetTime && (!task.lastRunAt || new Date(task.lastRunAt).getTime() < targetTime)) {
          shouldRun = true;
        }
      } else if (task.scheduleType === 'cron' && task.cronExpression) {
        try {
          const interval = CronExpressionParser.parse(task.cronExpression, { currentDate: now });
          const prev = interval.prev().toDate();
          // 如果上一个触发点在 60 秒内，且上次运行时间早于该触发点，则执行
          const diffMs = now.getTime() - prev.getTime();
          const lastRun = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
          if (diffMs >= 0 && diffMs < 90000 && lastRun < prev.getTime()) {
            shouldRun = true;
          }
        } catch (e) {
          // cron 表达式解析失败，跳过
        }
      }

      if (shouldRun) {
        console.log(`[Scheduler] Triggering task: ${task.name} (${task.id})`);
        task.lastRunStatus = 'running';
        saveTasks();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scheduler:execute', task);
        }
      }
    }
  }, 60000); // 每 60 秒检查
}

app.whenReady().then(() => {
  startScheduler();
});

// ============ 系统操作（定时任务完成后） ============
const { exec } = require('child_process');

ipcMain.handle('system:postAction', (event, action) => {
  switch (action) {
    case 'shutdown':
      exec('shutdown /s /t 60 /c "Split Terminal 定时任务已完成，将在60秒后关机"');
      return { success: true, message: '将在60秒后关机' };
    case 'lock':
      exec('rundll32.exe user32.dll,LockWorkStation');
      return { success: true, message: '已锁屏' };
    case 'sleep':
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
      return { success: true, message: '已进入睡眠' };
    case 'hibernate':
      exec('shutdown /h');
      return { success: true, message: '已休眠' };
    default:
      return { success: false, message: '未知操作' };
  }
});

app.on('window-all-closed', () => {
  if (schedulerInterval) clearInterval(schedulerInterval);
  for (const [, proc] of sessions) {
    try { proc.kill(); } catch (e) { /* ignore */ }
  }
  sessions.clear();
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
});
