const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebglAddon } = require('@xterm/addon-webgl');

// ============ 主题定义 ============
const THEMES = {
  dark: {
    background: '#171b20',
    foreground: '#f4f7fb',
    cursor: '#c7d2de',
    cursorAccent: '#171b20',
    selectionBackground: '#8aa4c333',
    black: '#20262d',
    red: '#d98989',
    green: '#93b387',
    yellow: '#d6c08e',
    blue: '#91a8c7',
    magenta: '#b39ac9',
    cyan: '#8eb8c2',
    white: '#d9e1ea',
    brightBlack: '#495360',
    brightRed: '#e7a0a0',
    brightGreen: '#a7c79b',
    brightYellow: '#e4cea0',
    brightBlue: '#a6bddc',
    brightMagenta: '#c5addb',
    brightCyan: '#a2ccd5',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#f5f7fa',
    foreground: '#2f3944',
    cursor: '#6f8499',
    cursorAccent: '#f5f7fa',
    selectionBackground: '#90a4bf40',
    black: '#5f6974',
    red: '#bf6f6f',
    green: '#6f9163',
    yellow: '#b39a67',
    blue: '#6985a4',
    magenta: '#8a75a2',
    cyan: '#628f98',
    white: '#d6dde6',
    brightBlack: '#7c8793',
    brightRed: '#cf8181',
    brightGreen: '#80a474',
    brightYellow: '#c4ab77',
    brightBlue: '#7a96b5',
    brightMagenta: '#9b86b3',
    brightCyan: '#73a0a9',
    brightWhite: '#e8edf3',
  },
};

const LEGACY_YAHEI_DEFAULT_FONT_FAMILY = "'Microsoft YaHei UI', 'Microsoft YaHei', 'Cascadia Code', 'Consolas', monospace";
const DEFAULT_TERMINAL_FONT_FAMILY = "'Consolas', 'Cascadia Code', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace";
const TERMINAL_FONT_PRESETS = [
  {
    label: 'Consolas（默认，适合终端）',
    value: DEFAULT_TERMINAL_FONT_FAMILY,
    description: '经典终端字体，整体更紧凑，中文自动回退到微软雅黑。',
  },
  {
    label: 'Cascadia Code（现代代码风格）',
    value: "'Cascadia Code', 'Consolas', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace",
    description: '更偏现代代码终端风格，英文和符号辨识度更高。',
  },
  {
    label: '微软雅黑（适合中文）',
    value: LEGACY_YAHEI_DEFAULT_FONT_FAMILY,
    description: '中文阅读更自然，但终端里的英文和符号会显得更松一些。',
  },
];
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

let showUpdaterChangelog = null;

// ============ 布局算法 ============
// 返回每个面板的 { left, top, width, height } 百分比
function computeLayout(count) {
  const gap = 4; // px gap 用百分比近似
  const g = 0.3; // gap 百分比近似
  switch (count) {
    case 1:
      return [{ left: 0, top: 0, width: 100, height: 100 }];
    case 2:
      return [
        { left: 0, top: 0, width: 50 - g, height: 100 },
        { left: 50 + g, top: 0, width: 50 - g, height: 100 },
      ];
    case 3:
      return [
        { left: 0, top: 0, width: 50 - g, height: 100 },
        { left: 50 + g, top: 0, width: 50 - g, height: 50 - g },
        { left: 50 + g, top: 50 + g, width: 50 - g, height: 50 - g },
      ];
    case 4:
      return [
        { left: 0, top: 0, width: 50 - g, height: 50 - g },
        { left: 50 + g, top: 0, width: 50 - g, height: 50 - g },
        { left: 0, top: 50 + g, width: 50 - g, height: 50 - g },
        { left: 50 + g, top: 50 + g, width: 50 - g, height: 50 - g },
      ];
    case 5:
      return [
        { left: 0, top: 0, width: 33.33 - g, height: 50 - g },
        { left: 33.33 + g / 2, top: 0, width: 33.33 - g, height: 50 - g },
        { left: 66.66 + g / 2, top: 0, width: 33.34 - g, height: 50 - g },
        { left: 0, top: 50 + g, width: 50 - g, height: 50 - g },
        { left: 50 + g, top: 50 + g, width: 50 - g, height: 50 - g },
      ];
    case 6:
    default:
      return [
        { left: 0, top: 0, width: 33.33 - g, height: 50 - g },
        { left: 33.33 + g / 2, top: 0, width: 33.33 - g, height: 50 - g },
        { left: 66.66 + g / 2, top: 0, width: 33.34 - g, height: 50 - g },
        { left: 0, top: 50 + g, width: 33.33 - g, height: 50 - g },
        { left: 33.33 + g / 2, top: 50 + g, width: 33.33 - g, height: 50 - g },
        { left: 66.66 + g / 2, top: 50 + g, width: 33.34 - g, height: 50 - g },
      ];
  }
}

// ============ 状态管理 ============
let currentTheme = 'dark';
let sessionCounter = 0;
let tabCounter = 0;
let activeTabId = null;
let currentRootPath = null;
let sidebarVisible = false;
let globalFontSize = 14;
let globalFontFamily = DEFAULT_TERMINAL_FONT_FAMILY;

// tabs: Map<tabId, { name, sessions: [sessionId...], focusedSession }>
const tabs = new Map();
// sessions: Map<sessionId, { tabId, term, fitAddon, name, element, ptyId }>
const allSessions = new Map();

// 获取已被终端面板关联的 Claude session ID 集合
function getAssociatedClaudeIds() {
  const ids = new Set();
  for (const [, s] of allSessions) {
    if (s.claudeSessionId) ids.add(s.claudeSessionId);
  }
  return ids;
}

const container = document.getElementById('terminal-container');
const tabsEl = document.getElementById('tabs');
const sessionInfoEl = document.getElementById('session-info');
const settingsDropdown = document.getElementById('settings-dropdown');

// ============ 项目选择对话框管理 ============
const projectDialog = document.getElementById('project-dialog');
const recentProjectsList = document.getElementById('recent-projects-list');
const projectPathInput = document.getElementById('project-path-input');
const projectDialogConfirm = document.getElementById('project-dialog-confirm');
const projectDialogCancel = document.getElementById('project-dialog-cancel');
const projectDialogClose = document.getElementById('project-dialog-close');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const providerInputs = Array.from(document.querySelectorAll('input[name="session-provider"]'));
const projectClaudeSection = document.getElementById('project-claude-section');
const projectClaudeList = document.getElementById('project-claude-list');
const projectHistoryLabel = document.getElementById('project-history-label');

let selectedProjectPath = null;
let selectedProvider = 'codex';
let selectedHistorySession = null; // { provider, id, projectPath, cwd, summary, customName }
let pendingSessionOpts = null;
let isConfirming = false;  // 防止重复点击
let projectHistoryLoadTimer = null; // 防抖定时器

// 从 localStorage 加载最近使用的项目
function loadRecentProjects() {
  try {
    const stored = localStorage.getItem('recentProjects');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentProjects(projects) {
  try {
    localStorage.setItem('recentProjects', JSON.stringify(projects.slice(0, 10)));
  } catch {
    // 忽略存储错误
  }
}

function addProjectToRecent(path) {
  if (!path) return;
  const recent = loadRecentProjects();
  const filtered = recent.filter(p => p.path !== path);
  filtered.unshift({
    path,
    name: path.split('\\').pop() || path.split('/').pop() || path,
    usedAt: Date.now(),
  });
  saveRecentProjects(filtered);
}

function getProviderLabel(provider) {
  return provider === 'claude' ? 'Claude' : 'Codex';
}

function getProviderBadgeClass(provider) {
  return provider === 'claude' ? 'claude' : 'codex';
}

function getHistoryResumeCommand(session) {
  return session.provider === 'claude'
    ? `claude --resume ${session.id}`
    : `codex resume ${session.id}`;
}

function sortConversationSessions() {
  conversationSessionsCache.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActive.localeCompare(a.lastActive);
  });
}

function findConversationSession(provider, sessionId) {
  return conversationSessionsCache.find(s => s.provider === provider && s.id === sessionId);
}

async function renameHistorySession(session, newName) {
  if (session.provider === 'claude') {
    await window.termAPI.renameClaudeSession({
      projectPath: session.projectPath,
      sessionId: session.id,
      name: newName,
    });
  } else {
    await window.termAPI.renameCodexSession({
      sessionId: session.id,
      name: newName,
    });
  }

  session.customName = newName || null;
  const cached = findConversationSession(session.provider, session.id);
  if (cached) cached.customName = session.customName;
}

async function pinHistorySession(session, pinned) {
  if (session.provider === 'claude') {
    await window.termAPI.pinClaudeSession({
      projectPath: session.projectPath,
      sessionId: session.id,
      pinned,
    });
  } else {
    await window.termAPI.pinCodexSession({
      sessionId: session.id,
      pinned,
    });
  }

  session.pinned = pinned;
  const cached = findConversationSession(session.provider, session.id);
  if (cached) cached.pinned = pinned;
  sortConversationSessions();
}

async function deleteHistorySession(session) {
  if (session.provider === 'claude') {
    await window.termAPI.deleteClaudeSession({
      projectPath: session.projectPath,
      sessionId: session.id,
    });
  } else {
    await window.termAPI.deleteCodexSession({
      sessionId: session.id,
    });
  }

  conversationSessionsCache = conversationSessionsCache.filter(s => !(s.provider === session.provider && s.id === session.id));
}

async function resumeHistorySession(historySession, fallbackPath) {
  if (!historySession) return null;

  if (historySession.provider === 'claude') {
    const claudeName = historySession.customName || (historySession.summary ? historySession.summary.slice(0, 50) : null);
    const sessionId = await createSession(null, {
      ...pendingSessionOpts,
      cwd: historySession.cwd || fallbackPath,
      historyProvider: 'claude',
      claudeSessionId: historySession.id,
      claudeProjectPath: historySession.projectPath,
      claudeName,
      historyName: claudeName,
    });
    if (sessionId) {
      setTimeout(() => {
        window.termAPI.write({ id: sessionId, data: `${getHistoryResumeCommand(historySession)}\r` });
      }, 500);
    }
    return sessionId;
  }

  const historyName = historySession.customName || historySession.summary || null;
  const sessionId = await createSession(null, {
    ...pendingSessionOpts,
    cwd: historySession.cwd || fallbackPath,
    historyProvider: 'codex',
    codexSessionId: historySession.id,
    codexThreadName: historyName,
    historyName,
  });
  if (sessionId) {
    setTimeout(() => {
      window.termAPI.write({ id: sessionId, data: `${getHistoryResumeCommand(historySession)}\r` });
    }, 500);
  }
  return sessionId;
}

function updateProviderUI() {
  selectedHistorySession = null;
  if (projectHistoryLoadTimer) {
    clearTimeout(projectHistoryLoadTimer);
    projectHistoryLoadTimer = null;
  }

  const path = selectedProjectPath || projectPathInput.value.trim();
  if (!path) {
    projectClaudeSection.style.display = 'none';
    projectClaudeList.innerHTML = '';
    if (projectHistoryLabel) {
      projectHistoryLabel.textContent = '该项目的历史会话（可选）：';
    }
    return;
  }

  if (projectHistoryLabel) {
    projectHistoryLabel.textContent = `该项目的 ${getProviderLabel(selectedProvider)} 历史会话（可选）：`;
  }
  scheduleLoadProjectHistory(path);
}

function showProjectDialog(sessionOpts = {}) {
  pendingSessionOpts = sessionOpts;
  selectedProjectPath = null;
  selectedProvider = 'codex';
  selectedHistorySession = null;
  projectPathInput.value = '';
  projectDialogConfirm.disabled = true;
  providerInputs.forEach(input => {
    input.checked = input.value === selectedProvider;
  });
  projectClaudeSection.style.display = 'none';
  projectClaudeList.innerHTML = '';
  if (projectHistoryLabel) {
    projectHistoryLabel.textContent = '该项目的历史会话（可选）：';
  }

  renderRecentProjects();

  projectDialog.classList.remove('hidden');
  setTimeout(() => projectPathInput.focus(), 100);
}

function hideProjectDialog() {
  projectDialog.classList.add('hidden');
  pendingSessionOpts = null;
  selectedProjectPath = null;
  selectedHistorySession = null;
  if (projectHistoryLoadTimer) { clearTimeout(projectHistoryLoadTimer); projectHistoryLoadTimer = null; }
}

function renderRecentProjects() {
  const recent = loadRecentProjects();
  recentProjectsList.innerHTML = '';

  if (recent.length === 0) {
    recentProjectsList.innerHTML = '<div class="recent-folder-empty">暂无最近使用的项目</div>';
    return;
  }

  recent.forEach(project => {
    const item = document.createElement('div');
    item.className = 'project-item' + (selectedProjectPath === project.path ? ' selected' : '');
    item.innerHTML = `
      <span class="project-item-icon">📁</span>
      <div class="project-item-info">
        <div class="project-item-name">${project.name}</div>
        <div class="project-item-path">${project.path}</div>
      </div>
      <span class="project-item-check">✓</span>
    `;
    item.addEventListener('click', () => {
      selectedProjectPath = project.path;
      projectPathInput.value = project.path;
      projectDialogConfirm.disabled = false;

      recentProjectsList.querySelectorAll('.project-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      updateProviderUI();
    });

    recentProjectsList.appendChild(item);
  });
}

// 防抖加载项目历史会话
function scheduleLoadProjectHistory(folderPath) {
  if (projectHistoryLoadTimer) clearTimeout(projectHistoryLoadTimer);
  projectHistoryLoadTimer = setTimeout(() => loadHistorySessionsForPath(folderPath), 300);
}

async function loadHistorySessionsForPath(folderPath) {
  const requestedProvider = selectedProvider;
  const requestedPath = folderPath;
  selectedHistorySession = null;
  projectClaudeSection.style.display = 'block';
  projectClaudeList.innerHTML = '<div class="project-claude-loading">加载中...</div>';

  let sessions = [];
  try {
    sessions = await window.termAPI.listConversationSessions({ rootPath: requestedPath, provider: requestedProvider });
  } catch {
    const activePath = selectedProjectPath || projectPathInput.value.trim();
    if (projectDialog.classList.contains('hidden') || activePath !== requestedPath || selectedProvider !== requestedProvider) return;
    projectClaudeList.innerHTML = '<div class="project-claude-empty">加载失败</div>';
    return;
  }

  const activePath = selectedProjectPath || projectPathInput.value.trim();
  if (projectDialog.classList.contains('hidden') || activePath !== requestedPath || selectedProvider !== requestedProvider) return;

  projectClaudeList.innerHTML = '';

  if (sessions.length === 0) {
    projectClaudeList.innerHTML = `<div class="project-claude-empty">该项目暂无 ${getProviderLabel(selectedProvider)} 历史会话</div>`;
    return;
  }

  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'project-claude-item';
    const displayName = s.customName || (s.summary ? s.summary.slice(0, 60) : '(空会话)');
    const timeStr = s.lastActive ? formatTime(s.lastActive) : '';
    const providerLabel = getProviderLabel(s.provider);
    item.innerHTML = `
      <span class="project-claude-item-icon ${getProviderBadgeClass(s.provider)}">${providerLabel}</span>
      <div class="project-claude-item-info">
        <div class="project-claude-item-name" title="${displayName}">${displayName}</div>
        <div class="project-claude-item-meta">${timeStr}</div>
      </div>
      <span class="project-claude-item-check">✓</span>
    `;
    item.addEventListener('click', () => {
      if (selectedHistorySession === s) {
        // 再次点击取消选择
        selectedHistorySession = null;
        item.classList.remove('selected');
      } else {
        selectedHistorySession = s;
        projectClaudeList.querySelectorAll('.project-claude-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      }
    });
    projectClaudeList.appendChild(item);
  }
}

async function confirmProjectSelection() {
  // 防止重复点击
  if (isConfirming) return;
  isConfirming = true;

  try {
    let path = selectedProjectPath || projectPathInput.value.trim();

    if (!path) {
      alert('请选择或输入项目文件夹路径');
      return;
    }

    // 验证路径是否存在
    try {
      const exists = await window.termAPI.validatePath(path);
      if (!exists) {
        alert('文件夹不存在，请检查路径是否正确');
        return;
      }
    } catch {
      alert('无法验证文件夹路径');
      return;
    }

    addProjectToRecent(path);

    const historySession = selectedHistorySession;
    if (historySession) {
      const sessionId = await resumeHistorySession(historySession, path);
      hideProjectDialog();
      if (!sessionId) return;
    } else {
      // 未选历史会话：按供应商新建会话
      const sessionId = await createSession(null, {
        ...pendingSessionOpts,
        cwd: path,
      });
      hideProjectDialog();
      if (sessionId) {
        setTimeout(() => {
          window.termAPI.write({ id: sessionId, data: `${selectedProvider}\r` });
        }, 500);
      }
    }
  } finally {
    setTimeout(() => { isConfirming = false; }, 100);
  }
}

// 项目选择对话框事件监听
projectDialogCancel.addEventListener('click', hideProjectDialog);
projectDialogClose.addEventListener('click', hideProjectDialog);
projectDialogConfirm.addEventListener('click', confirmProjectSelection);
btnBrowseFolder.addEventListener('click', async () => {
  const folderPath = await window.termAPI.openFolderDialog();
  if (folderPath) {
    projectPathInput.value = folderPath;
    selectedProjectPath = folderPath;
    projectDialogConfirm.disabled = false;
    recentProjectsList.querySelectorAll('.project-item').forEach(el => el.classList.remove('selected'));
    updateProviderUI();
  }
});

// 输入框变化时更新选中状态
projectPathInput.addEventListener('input', () => {
  const path = projectPathInput.value.trim();
  selectedProjectPath = path;
  projectDialogConfirm.disabled = !path;
  recentProjectsList.querySelectorAll('.project-item').forEach(el => el.classList.remove('selected'));
  if (path) {
    updateProviderUI();
  } else {
    projectClaudeSection.style.display = 'none';
    projectClaudeList.innerHTML = '';
    selectedHistorySession = null;
  }
});

providerInputs.forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    selectedProvider = input.value;
    updateProviderUI();
  });
});

// 点击遮罩层关闭
projectDialog.querySelector('.dialog-overlay').addEventListener('click', hideProjectDialog);

// ESC 键关闭对话框
document.addEventListener('keydown', (e) => {
  if (!projectDialog.classList.contains('hidden') && e.key === 'Escape') {
    hideProjectDialog();
  }
});

function clampFontSize(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return globalFontSize;
  return Math.min(Math.max(Math.round(next), MIN_FONT_SIZE), MAX_FONT_SIZE);
}

function getTerminalFontPreset(fontFamily) {
  return TERMINAL_FONT_PRESETS.find(option => option.value === fontFamily) || null;
}

function getTerminalFontTuning(fontFamily) {
  if (/microsoft yahei/i.test(fontFamily || '')) {
    return { letterSpacing: -1, lineHeight: 1 };
  }
  return { letterSpacing: 0, lineHeight: 1 };
}

function buildLayoutSnapshot() {
  const tabsLayout = [];
  for (const [, tab] of tabs) {
    const panes = [];
    for (const sid of tab.sessions) {
      const s = allSessions.get(sid);
      if (!s) continue;
      panes.push({
        name: s.name,
        cwd: s.cwd || null,
        historyProvider: s.historyProvider || null,
        claudeSessionId: s.claudeSessionId || null,
        claudeProjectPath: s.claudeProjectPath || null,
        codexSessionId: s.codexSessionId || null,
        codexThreadName: s.codexThreadName || null,
      });
    }
    if (panes.length === 0) continue;
    tabsLayout.push({ name: tab.name, panes });
  }
  return {
    tabs: tabsLayout,
    theme: currentTheme,
    terminalFontFamily: globalFontFamily,
    terminalFontSize: globalFontSize,
  };
}

function persistLayout() {
  try {
    void window.termAPI.saveLayout(buildLayoutSnapshot());
  } catch {
    // ignore persistence errors in renderer
  }
}

let persistLayoutTimer = null;

function scheduleLayoutPersist() {
  clearTimeout(persistLayoutTimer);
  persistLayoutTimer = setTimeout(() => {
    persistLayoutTimer = null;
    persistLayout();
  }, 150);
}

function syncSettingsControls() {
  if (!settingsDropdown || settingsDropdown.classList.contains('hidden')) return;
  const themeSelect = settingsDropdown.querySelector('[data-setting="theme"]');
  const fontSelect = settingsDropdown.querySelector('[data-setting="font-family"]');
  const sizeSelect = settingsDropdown.querySelector('[data-setting="font-size"]');
  const fontHint = settingsDropdown.querySelector('.settings-font-hint');
  const preview = settingsDropdown.querySelector('.settings-preview');
  const fontPreset = getTerminalFontPreset(globalFontFamily);
  const tuning = getTerminalFontTuning(globalFontFamily);
  if (themeSelect) themeSelect.value = currentTheme;
  if (fontSelect) fontSelect.value = globalFontFamily;
  if (sizeSelect) sizeSelect.value = String(globalFontSize);
  if (fontHint) {
    fontHint.textContent = fontPreset
      ? fontPreset.description
      : '保留中文回退支持。按住 Ctrl 滚轮也可以快速调整字号。';
  }
  if (preview) {
    preview.style.fontFamily = globalFontFamily;
    preview.style.fontSize = `${Math.min(globalFontSize, 16)}px`;
    preview.style.letterSpacing = `${tuning.letterSpacing}px`;
    preview.style.lineHeight = String(tuning.lineHeight);
  }
}

function applyTheme(themeName, { persist = true } = {}) {
  if (!THEMES[themeName]) return;
  currentTheme = themeName;
  document.documentElement.dataset.theme = currentTheme === 'light' ? 'light' : '';
  for (const [, session] of allSessions) {
    session.term.options.theme = THEMES[currentTheme];
  }
  syncSettingsControls();
  if (persist) scheduleLayoutPersist();
}

function applyTerminalAppearance({ fontFamily = globalFontFamily, fontSize = globalFontSize, persist = true } = {}) {
  globalFontFamily = fontFamily || DEFAULT_TERMINAL_FONT_FAMILY;
  globalFontSize = clampFontSize(fontSize);
  const tuning = getTerminalFontTuning(globalFontFamily);
  document.documentElement.style.setProperty('--terminal-font-family', globalFontFamily);
  document.documentElement.style.setProperty('--terminal-font-size', `${globalFontSize}px`);
  for (const [, session] of allSessions) {
    session.term.options.fontFamily = globalFontFamily;
    session.term.options.fontSize = globalFontSize;
    session.term.options.letterSpacing = tuning.letterSpacing;
    session.term.options.lineHeight = tuning.lineHeight;
  }
  syncSettingsControls();
  if (allSessions.size > 0) fitAllSessions();
  if (persist) scheduleLayoutPersist();
}

function renderSettingsDropdown() {
  settingsDropdown.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'settings-header';
  header.innerHTML = '<span>常用设置</span>';
  settingsDropdown.appendChild(header);

  const body = document.createElement('div');
  body.className = 'settings-body';

  const terminalSection = document.createElement('div');
  terminalSection.className = 'settings-section';

  const terminalTitle = document.createElement('div');
  terminalTitle.className = 'settings-section-title';
  terminalTitle.textContent = '终端外观';
  terminalSection.appendChild(terminalTitle);

  const themeField = document.createElement('div');
  themeField.className = 'settings-field';
  const themeLabel = document.createElement('label');
  themeLabel.textContent = '主题';
  const themeSelect = document.createElement('select');
  themeSelect.dataset.setting = 'theme';
  themeSelect.innerHTML = `
    <option value="dark">深色</option>
    <option value="light">浅色</option>
  `;
  themeSelect.value = currentTheme;
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  themeField.appendChild(themeLabel);
  themeField.appendChild(themeSelect);
  terminalSection.appendChild(themeField);

  const fontField = document.createElement('div');
  fontField.className = 'settings-field';
  const fontLabel = document.createElement('label');
  fontLabel.textContent = '字体';
  const fontSelect = document.createElement('select');
  fontSelect.dataset.setting = 'font-family';
  for (const option of TERMINAL_FONT_PRESETS) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    fontSelect.appendChild(el);
  }
  fontSelect.value = globalFontFamily;
  fontSelect.addEventListener('change', () => {
    applyTerminalAppearance({ fontFamily: fontSelect.value });
  });
  fontField.appendChild(fontLabel);
  fontField.appendChild(fontSelect);
  const fontHint = document.createElement('div');
  fontHint.className = 'settings-hint settings-font-hint';
  fontHint.textContent = getTerminalFontPreset(globalFontFamily)?.description || '保留中文回退支持。按住 Ctrl 滚轮也可以快速调整字号。';
  fontField.appendChild(fontHint);
  terminalSection.appendChild(fontField);

  const fontSizeField = document.createElement('div');
  fontSizeField.className = 'settings-field';
  const fontSizeLabel = document.createElement('label');
  fontSizeLabel.textContent = '字号';
  const fontSizeSelect = document.createElement('select');
  fontSizeSelect.dataset.setting = 'font-size';
  for (let size = MIN_FONT_SIZE; size <= MAX_FONT_SIZE; size++) {
    const el = document.createElement('option');
    el.value = String(size);
    el.textContent = `${size}px`;
    fontSizeSelect.appendChild(el);
  }
  fontSizeSelect.value = String(globalFontSize);
  fontSizeSelect.addEventListener('change', () => {
    applyTerminalAppearance({ fontSize: parseInt(fontSizeSelect.value, 10) });
  });
  fontSizeField.appendChild(fontSizeLabel);
  fontSizeField.appendChild(fontSizeSelect);
  terminalSection.appendChild(fontSizeField);

  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = '按住 Ctrl 滚轮也可以快速调整字号。';
  terminalSection.appendChild(hint);

  const preview = document.createElement('div');
  preview.className = 'settings-preview';
  preview.textContent = '终端字体预览: const path = "D:\\workspace\\split-terminal\\README.md";';
  terminalSection.appendChild(preview);

  body.appendChild(terminalSection);

  const updateSection = document.createElement('div');
  updateSection.className = 'settings-section';
  const updateTitle = document.createElement('div');
  updateTitle.className = 'settings-section-title';
  updateTitle.textContent = '版本更新';
  updateSection.appendChild(updateTitle);

  const updateHint = document.createElement('div');
  updateHint.className = 'settings-hint';
  updateHint.textContent = '在这里直接检查更新，或打开版本说明查看变更记录。';
  updateSection.appendChild(updateHint);

  const updateActions = document.createElement('div');
  updateActions.className = 'settings-actions';

  const checkUpdateBtn = document.createElement('button');
  checkUpdateBtn.textContent = '检查更新';
  checkUpdateBtn.addEventListener('click', () => {
    window.termAPI.updaterCheckForUpdates();
  });
  updateActions.appendChild(checkUpdateBtn);

  const changelogBtn = document.createElement('button');
  changelogBtn.textContent = '版本说明';
  changelogBtn.addEventListener('click', () => {
    if (typeof showUpdaterChangelog === 'function') {
      showUpdaterChangelog();
    }
  });
  updateActions.appendChild(changelogBtn);

  updateSection.appendChild(updateActions);
  body.appendChild(updateSection);

  settingsDropdown.appendChild(body);
}

function toggleSettingsDropdown() {
  if (settingsDropdown.classList.contains('hidden')) {
    renderSettingsDropdown();
    settingsDropdown.classList.remove('hidden');
  } else {
    settingsDropdown.classList.add('hidden');
  }
}

function hasTransferType(dataTransfer, type) {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes(type);
}

function isExternalFileTransfer(dataTransfer) {
  if (!dataTransfer) return false;
  if (hasTransferType(dataTransfer, 'Files')) return true;
  if (Array.from(dataTransfer.items || []).some(item => item.kind === 'file')) return true;
  if ((dataTransfer.files?.length || 0) > 0) return true;
  return false;
}

function looksLikeAbsolutePath(pathText) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(pathText);
}

function fileUriToPath(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') return '';
    let pathname = decodeURIComponent(parsed.pathname || '');
    if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
    return pathname.replace(/\//g, '\\');
  } catch {
    return '';
  }
}

function extractPathsFromText(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.startsWith('file://') ? fileUriToPath(line) : line)
    .filter(looksLikeAbsolutePath);
}

function extractNativePathsFromFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0 || typeof window.termAPI.resolveNativeFilePaths !== 'function') return [];
  try {
    return window.termAPI.resolveNativeFilePaths(list).filter(looksLikeAbsolutePath);
  } catch {
    return [];
  }
}

function extractPathsFromDataTransfer(dataTransfer) {
  const results = [];
  const seen = new Set();
  const push = (candidate) => {
    const next = (candidate || '').trim();
    if (!next || !looksLikeAbsolutePath(next) || seen.has(next)) return;
    seen.add(next);
    results.push(next);
  };

  for (const nativePath of extractNativePathsFromFiles(dataTransfer?.files)) {
    push(nativePath);
  }
  for (const file of Array.from(dataTransfer?.files || [])) {
    push(file.path || file.name);
  }

  const itemFiles = [];
  for (const item of Array.from(dataTransfer?.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) itemFiles.push(file);
    push(file?.path || file?.name);
  }
  for (const nativePath of extractNativePathsFromFiles(itemFiles)) {
    push(nativePath);
  }

  for (const pathText of extractPathsFromText(dataTransfer?.getData('text/uri-list'))) {
    push(pathText);
  }
  if (results.length === 0) {
    for (const pathText of extractPathsFromText(dataTransfer?.getData('text/plain'))) {
      push(pathText);
    }
  }
  return results;
}

function formatDroppedPathForInput(pathText) {
  return /\s/.test(pathText) ? `"${pathText}"` : pathText;
}

function writeDroppedPathsToSession(sessionId, dataTransfer) {
  const droppedPaths = extractPathsFromDataTransfer(dataTransfer);
  if (droppedPaths.length === 0) return false;
  const payload = droppedPaths.map(formatDroppedPathForInput).join(' ');
  window.termAPI.write({ id: sessionId, data: payload });
  return true;
}

function getFocusedWritableSessionId() {
  const tab = tabs.get(activeTabId);
  if (!tab?.focusedSession) return null;
  const session = allSessions.get(tab.focusedSession);
  if (!session || session.isHistory) return null;
  return tab.focusedSession;
}

// ============ 标签页管理 ============
function createTab(name) {
  const tabId = `tab-${++tabCounter}`;
  tabs.set(tabId, {
    name: name || `标签 ${tabCounter}`,
    sessions: [],
    focusedSession: null,
  });
  renderTabs();
  switchTab(tabId);
  return tabId;
}

async function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  // 关闭该标签页下所有会话
  for (const sid of [...tab.sessions]) {
    await destroySession(sid, true);
  }
  tabs.delete(tabId);
  if (activeTabId === tabId) {
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      createTab();
    }
  }
  renderTabs();
}

function switchTab(tabId) {
  if (!tabs.has(tabId)) return;
  activeTabId = tabId;
  renderTabs();
  renderPanes();
  // 切换标签页后聚焦当前面板（确保 IME 中文输入正常）
  const tab = tabs.get(tabId);
  if (tab && tab.focusedSession) {
    setTimeout(() => focusSession(tab.focusedSession), 50);
  }
}

function renderTabs() {
  tabsEl.innerHTML = '';
  let dragSrcId = null;

  for (const [id, tab] of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (id === activeTabId ? ' active' : '');
    el.draggable = true;
    el.dataset.tabId = id;
    el.innerHTML = `<span title="双击重命名">${tab.name} (${tab.sessions.length})</span>`;
    el.querySelector('span').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startTabInlineRename(id);
    });
    el.addEventListener('click', () => switchTab(id));

    // 拖拽排序
    el.addEventListener('dragstart', (e) => {
      dragSrcId = id;
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('tab-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('tab-dragging');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      // 面板拖入标签页 或 标签页排序
      if (hasTransferType(e.dataTransfer, 'text/x-pane-id')) {
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('tab-drag-over');
      } else if (dragSrcId && dragSrcId !== id) {
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
        el.classList.add('tab-drag-over');
      }
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('tab-drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('tab-drag-over');

      // 面板拖入标签页：移动面板到目标标签页
      const paneSrcId = e.dataTransfer.getData('text/x-pane-id');
      if (paneSrcId) {
        const session = allSessions.get(paneSrcId);
        if (!session || session.tabId === id) return;
        const srcTab = tabs.get(session.tabId);
        const dstTab = tabs.get(id);
        if (!srcTab || !dstTab) return;
        // 目标标签页已满（6个）
        if (dstTab.sessions.length >= 6) return;
        // 源标签页只剩1个面板，不允许移走
        if (srcTab.sessions.length <= 1) return;
        // 从源标签页移除
        srcTab.sessions = srcTab.sessions.filter(s => s !== paneSrcId);
        if (srcTab.focusedSession === paneSrcId) {
          srcTab.focusedSession = srcTab.sessions[0] || null;
        }
        // 加入目标标签页
        dstTab.sessions.push(paneSrcId);
        session.tabId = id;
        // 切换到目标标签页并聚焦该面板
        switchTab(id);
        dstTab.focusedSession = paneSrcId;
        renderPanes();
        renderTabs();
        return;
      }

      // 标签页排序
      if (!dragSrcId || dragSrcId === id) return;
      // 重排 tabs Map
      const entries = [...tabs.entries()];
      const srcIdx = entries.findIndex(([k]) => k === dragSrcId);
      const dstIdx = entries.findIndex(([k]) => k === id);
      if (srcIdx === -1 || dstIdx === -1) return;
      entries.splice(dstIdx, 0, entries.splice(srcIdx, 1)[0]);
      tabs.clear();
      for (const [k, v] of entries) tabs.set(k, v);
      dragSrcId = null;
      renderTabs();
    });

    // 编辑图标
    const renameBtn = document.createElement('button');
    renameBtn.className = 'tab-rename';
    renameBtn.textContent = '✎';
    renameBtn.title = '重命名 (Ctrl+Shift+E)';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startTabInlineRename(id);
    });
    el.appendChild(renameBtn);

    if (tabs.size > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'close-tab';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
      });
      el.appendChild(closeBtn);
    }
    tabsEl.appendChild(el);
  }
}

// ============ 会话管理 ============
async function createSession(tabId, opts = {}) {
  tabId = tabId || activeTabId;
  const tab = tabs.get(tabId);
  if (!tab || tab.sessions.length >= 6) return;

  const sessionId = `session-${++sessionCounter}`;
  const name = `Shell ${sessionCounter}`;

  // 创建 xterm 实例
  const term = new Terminal({
    fontSize: globalFontSize,
    fontFamily: globalFontFamily,
    letterSpacing: getTerminalFontTuning(globalFontFamily).letterSpacing,
    lineHeight: getTerminalFontTuning(globalFontFamily).lineHeight,
    theme: THEMES[currentTheme],
    cursorBlink: true,
    allowProposedApi: true,
  });

  // Ctrl+C 有选中文本时复制，否则发送 SIGINT；Ctrl+V 粘贴
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    // 跳过 IME 输入法组合状态，避免干扰中文输入
    if (e.isComposing || e.keyCode === 229) return true;
    // Shift+Enter / Ctrl+Enter → 换行（模拟 Alt+Enter：ESC + CR）
    if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      window.termAPI.write({ id: sessionId, data: '\x1b\r' });
      return false;
    }
    if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.key === 'v') {
      navigator.clipboard.readText().then(text => {
        if (text) window.termAPI.write({ id: sessionId, data: text });
      });
      return false;
    }
    return true;
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // 创建 DOM
  const pane = document.createElement('div');
  pane.className = 'terminal-pane';
  pane.dataset.sessionId = sessionId;

  const header = document.createElement('div');
  header.className = 'pane-header';
  header.innerHTML = `<span class="pane-title" title="双击重命名">${name}</span><button class="pane-rename" title="重命名 (Ctrl+Shift+R)">✎</button><button class="pane-close" title="关闭">×</button>`;
  header.querySelector('.pane-close').addEventListener('click', () => destroySession(sessionId));
  header.querySelector('.pane-rename').addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineRename(session, 'pane');
  });
  header.querySelector('.pane-title').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startInlineRename(session, 'pane');
  });
  header.addEventListener('click', (e) => {
    if (e.target.classList.contains('pane-close')) return;
    if (e.target.classList.contains('inline-rename')) return;
    focusSession(sessionId);
  });

  // 面板拖拽排序（通过 header 拖拽交换位置）
  header.draggable = true;
  header.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-pane-id', sessionId);
    pane.classList.add('pane-dragging');
  });
  header.addEventListener('dragend', () => {
    pane.classList.remove('pane-dragging');
    document.querySelectorAll('.terminal-pane').forEach(p => p.classList.remove('pane-drag-over'));
  });
  pane.addEventListener('dragover', (e) => {
    const srcId = hasTransferType(e.dataTransfer, 'text/x-pane-id');
    if (!srcId) return; // 不是面板拖拽，交给文件拖拽处理
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    pane.classList.add('pane-drag-over');
  });
  pane.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && pane.contains(e.relatedTarget)) return;
    pane.classList.remove('pane-drag-over');
  });
  pane.addEventListener('drop', (e) => {
    const srcSessionId = e.dataTransfer.getData('text/x-pane-id');
    if (!srcSessionId || srcSessionId === sessionId) {
      pane.classList.remove('pane-drag-over');
      return; // 不是面板拖拽或拖到自身，跳过
    }
    e.preventDefault();
    e.stopPropagation();
    pane.classList.remove('pane-drag-over');
    // 交换两个面板在 tab.sessions 中的位置
    const curTab = tabs.get(activeTabId);
    if (!curTab) return;
    const srcIdx = curTab.sessions.indexOf(srcSessionId);
    const dstIdx = curTab.sessions.indexOf(sessionId);
    if (srcIdx === -1 || dstIdx === -1) return;
    [curTab.sessions[srcIdx], curTab.sessions[dstIdx]] = [curTab.sessions[dstIdx], curTab.sessions[srcIdx]];
    renderPanes();
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'xterm-wrapper';

  pane.appendChild(header);
  pane.appendChild(wrapper);

  const displayName = opts.historyName || opts.claudeName || opts.codexThreadName || name;
  const session = { 
    tabId, 
    term, 
    fitAddon, 
    name: displayName, 
    element: pane, 
    ptyId: sessionId, 
    outputBuffer: '', 
    createdAt: new Date().toISOString(), 
    historyProvider: opts.historyProvider || (opts.claudeSessionId ? 'claude' : (opts.codexSessionId ? 'codex' : null)),
    claudeSessionId: opts.claudeSessionId || null, 
    claudeProjectPath: opts.claudeProjectPath || null,
    codexSessionId: opts.codexSessionId || null,
    codexThreadName: opts.codexThreadName || null,
    cwd: opts.cwd || null  // 会话的工作目录
  };
  if (displayName !== name) {
    header.querySelector('.pane-title').textContent = displayName;
  }
  allSessions.set(sessionId, session);
  tab.sessions.push(sessionId);
  tab.focusedSession = sessionId;

  // 挂载到 DOM
  container.appendChild(pane);
  term.open(wrapper);

  // 注册路径 link provider：识别 Windows 绝对路径，点击用系统默认程序打开
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) { callback([]); return; }
      const text = line.translateToString(false);
      // 匹配 Windows 绝对路径：盘符:\... 或 \\server\...，允许中文、空格（但不含引号/换行）
      const pathRe = /(?:[A-Za-z]:[\\\/][^\x00-\x1f"'\n\r]*|\\\\[^\x00-\x1f"'\n\r]+)/g;
      const links = [];
      let m;
      while ((m = pathRe.exec(text)) !== null) {
        // 去掉末尾的标点符号（逗号、句号、右括号等）
        let rawPath = m[0].replace(/[,;。，、）\)\]>]+$/, '');
        const startCol = m.index;
        const endCol = startCol + rawPath.length;
        links.push({
          range: {
            start: { x: startCol + 1, y: bufferLineNumber },
            end: { x: endCol, y: bufferLineNumber },
          },
          text: rawPath,
          activate(event, text) {
            window.termAPI.openFile(text);
          },
          hover(event, text) {},
          leave(event, text) {},
        });
      }
      callback(links);
    },
  });

  // 阻止浏览器 paste 事件（避免与 Ctrl+V 手动处理重复）
  wrapper.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // WebGL 加速延迟到 focus 之后加载（见下方），避免渲染器切换重置 IME 状态

  // 创建 PTY
  await window.termAPI.createSession({
    id: sessionId,
    cols: term.cols,
    rows: term.rows,
    cwd: opts.cwd || currentRootPath || undefined,
  });

  // 终端输入 → PTY（含 claude 命令自动识别）
  let inputBuffer = '';

  // 启动 Claude 会话自动关联轮询（挂到 session 上供 PTY 输出回调调用）
  session._claudeDetectTimer = null;
  session.startClaudeDetection = function(afterTime) {
    if (session._claudeDetectTimer || session.claudeSessionId) return;
    console.log('[Claude] Starting detection polling for session', sessionId);
    let retries = 0;
    const maxRetries = 12;
    const poll = async () => {
      if (session.claudeSessionId || retries >= maxRetries) {
        session._claudeDetectTimer = null;
        console.log('[Claude] Detection stopped: associated=', !!session.claudeSessionId, 'retries=', retries);
        return;
      }
      retries++;
      try {
        const cwd = opts.cwd || currentRootPath;
        if (!cwd) { session._claudeDetectTimer = setTimeout(poll, 5000); return; }
        const result = await window.termAPI.findLatestClaudeSession({ cwd, afterTime });
        if (result && !session.claudeSessionId) {
          const associated = getAssociatedClaudeIds();
          if (associated.has(result.id)) {
            session._claudeDetectTimer = setTimeout(poll, 5000);
            return;
          }
          session.claudeSessionId = result.id;
          session.claudeProjectPath = result.projectPath;
          session._claudeDetectTimer = null;
          console.log('[Claude] Auto-associated! id:', result.id);
          const claudeName = result.customName || (result.summary ? result.summary.slice(0, 50) : null);
          if (claudeName) {
            session.name = claudeName;
            const titleEl = session.element.querySelector('.pane-title');
            if (titleEl) titleEl.textContent = claudeName;
            updateInfo();
          }
        } else {
          session._claudeDetectTimer = setTimeout(poll, 5000);
        }
      } catch {
        session._claudeDetectTimer = setTimeout(poll, 5000);
      }
    };
    session._claudeDetectTimer = setTimeout(poll, 3000);
  };

  term.onData((data) => {
    window.termAPI.write({ id: sessionId, data });
    if (data === '\r' || data === '\n') {
      const trimmed = inputBuffer.trim();
      // claude --resume <UUID> 直接关联
      const resumeMatch = trimmed.match(/claude\s+(?:--resume|-r)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (resumeMatch && !session.claudeSessionId) {
        const claudeId = resumeMatch[1];
        const cached = conversationSessionsCache.find(s => s.provider === 'claude' && s.id === claudeId);
        session.claudeSessionId = claudeId;
        session.historyProvider = 'claude';
        if (cached) {
          session.claudeProjectPath = cached.projectPath;
          const claudeName = cached.customName || (cached.summary ? cached.summary.slice(0, 50) : null);
          if (claudeName) {
            session.name = claudeName;
            const titleEl = session.element.querySelector('.pane-title');
            if (titleEl) titleEl.textContent = claudeName;
            updateInfo();
          }
        }
      } else {
        const codexResumeMatch = trimmed.match(/codex\s+resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (codexResumeMatch && !session.codexSessionId) {
          const codexId = codexResumeMatch[1];
          const cached = conversationSessionsCache.find(s => s.provider === 'codex' && s.id === codexId);
          session.codexSessionId = codexId;
          session.historyProvider = 'codex';
          if (cached) {
            const codexName = cached.customName || cached.summary || null;
            session.codexThreadName = codexName;
            if (codexName) {
              session.name = codexName;
              const titleEl = session.element.querySelector('.pane-title');
              if (titleEl) titleEl.textContent = codexName;
              updateInfo();
            }
          }
        }
      }
      if (!session.claudeSessionId && /^claude(\s+|$)/.test(trimmed) && !/^claude\s+(auth|doctor|install|mcp|plugin|setup-token|update)\b/.test(trimmed)) {
        // 用户输入了 claude 命令，启动轮询
        session.startClaudeDetection(Date.now() - 2000);
      }
      inputBuffer = '';
    } else if (data === '\x7f') {
      inputBuffer = inputBuffer.slice(0, -1);
    } else if (data.indexOf('\x1b') === -1) {
      for (const ch of data) {
        if (ch >= ' ' && ch <= '~') inputBuffer += ch;
      }
    }
  });

  // 点击面板聚焦
  wrapper.addEventListener('mousedown', () => focusSession(sessionId));

  // 接收文件树拖拽（仅处理非面板拖拽）
  wrapper.addEventListener('dragover', (e) => {
    if (hasTransferType(e.dataTransfer, 'text/x-pane-id')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    pane.classList.add('drag-over');
  });
  wrapper.addEventListener('dragleave', () => {
    pane.classList.remove('drag-over');
  });
  wrapper.addEventListener('drop', (e) => {
    if (hasTransferType(e.dataTransfer, 'text/x-pane-id')) return;
    e.preventDefault();
    e.stopPropagation();
    pane.classList.remove('drag-over');
    if (!session.isHistory && writeDroppedPathsToSession(sessionId, e.dataTransfer)) {
      focusSession(sessionId);
    }
  });

  renderPanes();
  updateInfo();

  // 延迟 fit 确保布局完成
  requestAnimationFrame(() => {
    fitSession(sessionId);
    term.focus();
    // 确保 xterm 内部 textarea 获得焦点（修复 IME 中文输入问题）
    const xtermTextarea = wrapper.querySelector('.xterm-helper-textarea');
    if (xtermTextarea) xtermTextarea.focus();

    // WebGL 渲染器加载放在 focus 之后，避免渲染器切换（DOM 变动）重置 Windows IME 状态
    // 延迟 500ms 确保 IME 已完成绑定
    setTimeout(() => {
      try {
        const webgl = new WebglAddon();
        term.loadAddon(webgl);
        // WebGL 切换后重新 focus textarea，让 IME 重新绑定
        requestAnimationFrame(() => {
          const ta = wrapper.querySelector('.xterm-helper-textarea');
          if (ta) {
            ta.blur();
            ta.focus();
          }
        });
      } catch (e) {
        console.warn('WebGL addon failed, using canvas renderer');
      }
    }, 500);
  });

  return sessionId;
}

async function destroySession(sessionId, skipRender) {
  const session = allSessions.get(sessionId);
  if (!session) return;

  if (session._claudeDetectTimer) {
    clearInterval(session._claudeDetectTimer);
    session._claudeDetectTimer = null;
  }
  window.termAPI.kill({ id: sessionId });
  session.term.dispose();
  session.element.remove();
  allSessions.delete(sessionId);

  const tab = tabs.get(session.tabId);
  if (tab) {
    tab.sessions = tab.sessions.filter((s) => s !== sessionId);
    if (tab.focusedSession === sessionId) {
      tab.focusedSession = tab.sessions[tab.sessions.length - 1] || null;
    }
  }

  if (!skipRender) {
    renderPanes();
    renderTabs();
    updateInfo();
    // 聚焦剩余面板 — 必须延迟到 renderPanes 内部的 fitAllSessions (280ms) 完成之后，
    // 否则 fit 触发 xterm DOM 重算会导致 textarea 失焦、Windows IME 中文输入丢失
    if (tab && tab.focusedSession) {
      const sid = tab.focusedSession;
      setTimeout(() => {
        focusSession(sid);
        // 双重保险：再次确保 textarea 获得焦点
        requestAnimationFrame(() => {
          const s = allSessions.get(sid);
          if (s) {
            const ta = s.element.querySelector('.xterm-helper-textarea');
            if (ta) { ta.blur(); ta.focus(); }
          }
        });
      }, 350);
    }
  }
}

function focusSession(sessionId) {
  const session = allSessions.get(sessionId);
  if (!session) return;
  const tab = tabs.get(session.tabId);
  if (tab) tab.focusedSession = sessionId;

  // 更新 focused 样式
  container.querySelectorAll('.terminal-pane').forEach((el) => {
    el.classList.toggle('focused', el.dataset.sessionId === sessionId);
  });

  session.term.focus();
  // 确保 xterm 内部 textarea 获得焦点（修复 IME 中文输入问题）
  const xtermTextarea = session.element.querySelector('.xterm-helper-textarea');
  if (xtermTextarea) xtermTextarea.focus();
  
  // 文件夹栏跟随焦点会话切换
  if (session.cwd && sidebarVisible) {
    switchFolderForSession(session.cwd);
  }
  
  updateInfo();
}

function fitSession(sessionId) {
  const session = allSessions.get(sessionId);
  if (!session) return;
  try {
    session.fitAddon.fit();
    window.termAPI.resize({
      id: sessionId,
      cols: session.term.cols,
      rows: session.term.rows,
    });
  } catch (e) {
    // 忽略
  }
}

function fitAllSessions() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  for (const sid of tab.sessions) {
    fitSession(sid);
  }
}

// ============ 面板渲染 ============
function renderPanes() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  // 隐藏非当前标签页的面板
  for (const [sid, session] of allSessions) {
    session.element.style.display = session.tabId === activeTabId ? '' : 'none';
  }

  const sessionIds = tab.sessions;
  const layouts = computeLayout(sessionIds.length);

  sessionIds.forEach((sid, i) => {
    const session = allSessions.get(sid);
    if (!session || !layouts[i]) return;
    const l = layouts[i];
    const el = session.element;
    el.style.left = l.left + '%';
    el.style.top = l.top + '%';
    el.style.width = l.width + '%';
    el.style.height = l.height + '%';
    el.classList.toggle('focused', sid === tab.focusedSession);
  });

  // 等 transition 结束后 fit
  setTimeout(fitAllSessions, 280);
}

function updateInfo() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const focused = tab.focusedSession ? allSessions.get(tab.focusedSession) : null;
  const name = focused ? focused.name : '-';
  sessionInfoEl.textContent = `${tab.name} | ${name} | 会话: ${tab.sessions.length}/6`;
}

// ============ 主题切换 ============
function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

// ============ 会话重命名（内联编辑） ============
function renameCurrentSession() {
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.focusedSession) return;
  const session = allSessions.get(tab.focusedSession);
  if (!session || session.isHistory) return;
  startInlineRename(session, 'pane');
}

function startInlineRename(session, type) {
  const titleEl = session.element.querySelector('.pane-title');
  if (!titleEl || titleEl.querySelector('.inline-rename')) return;

  const currentName = session.name;
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.value = currentName;

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      session.name = newName;
      if (session.claudeSessionId) {
        window.termAPI.renameClaudeSession({
          projectPath: session.claudeProjectPath,
          sessionId: session.claudeSessionId,
          name: newName,
        }).then(() => {
          const cached = conversationSessionsCache.find(s => s.provider === 'claude' && s.id === session.claudeSessionId);
          if (cached) cached.customName = newName;
        }).catch(() => {});
      } else if (session.codexSessionId) {
        window.termAPI.renameCodexSession({
          sessionId: session.codexSessionId,
          name: newName,
        }).then(() => {
          session.codexThreadName = newName;
          const cached = conversationSessionsCache.find(s => s.provider === 'codex' && s.id === session.codexSessionId);
          if (cached) cached.customName = newName;
        }).catch(() => {});
      }
    }
    titleEl.textContent = session.name;
    updateInfo();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); titleEl.textContent = currentName; updateInfo(); }
    e.stopPropagation();
  });
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
}

// ============ 标签页重命名（内联编辑） ============
function renameCurrentTab() {
  startTabInlineRename(activeTabId);
}

function startTabInlineRename(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  const tabEl = tabsEl.querySelector(`.tab.active span`) || [...tabsEl.querySelectorAll('.tab')].find(el => {
    const span = el.querySelector('span');
    return span && span.textContent.startsWith(tab.name);
  })?.querySelector('span');

  if (!tabEl || tabEl.querySelector('.inline-rename')) return;

  const currentName = tab.name;
  const input = document.createElement('input');
  input.className = 'inline-rename';
  input.value = currentName;

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      tab.name = newName;
    }
    renderTabs();
    updateInfo();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); renderTabs(); }
    e.stopPropagation();
  });
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);

  tabEl.textContent = '';
  tabEl.appendChild(input);
  input.focus();
  input.select();
}

// ============ 工具函数 ============
function formatTime(isoStr) {
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============ PTY 数据回调 ============
const OUTPUT_BUFFER_MAX = 1024 * 1024; // 1MB

window.termAPI.onData(({ id, data }) => {
  const session = allSessions.get(id);
  if (session) {
    session.term.write(data);
    session.outputBuffer += data;
    if (session.outputBuffer.length > OUTPUT_BUFFER_MAX) {
      session.outputBuffer = session.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
    }
    // 备用检测：通过 PTY 输出中的 Claude 特征触发关联轮询
    if (!session.claudeSessionId && !session._claudeOutputTriggered && session.startClaudeDetection) {
      // 简单检测：去除所有 ANSI 转义后，检查是否包含 Claude 相关文本
      const plain = data.replace(/\x1b[^a-zA-Z]*[a-zA-Z]/g, '');
      if (plain.includes('Claude') || plain.includes('claude')) {
        session._claudeOutputTriggered = true;
        console.log('[Claude] Output trigger: detected "Claude" in PTY output');
        session.startClaudeDetection(Date.now() - 30000);
      }
    }
  }
});

window.termAPI.onExit(({ id, exitCode }) => {
  const session = allSessions.get(id);
  destroySession(id);
});

// ============ 快捷键 ============
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey;
  const shift = e.shiftKey;

  if (ctrl && shift) {
    switch (e.key) {
      case 'N': // 新建会话（选择项目）
        e.preventDefault();
        showProjectDialog();
        break;
      case 'W': // 关闭当前会话
        e.preventDefault();
        const tab = tabs.get(activeTabId);
        if (tab && tab.focusedSession) destroySession(tab.focusedSession);
        break;
      case 'K': // 切换主题
        e.preventDefault();
        toggleTheme();
        break;
      case 'R': // 重命名会话（内联编辑）
        e.preventDefault();
        renameCurrentSession();
        break;
      case 'E': // 重命名标签页
        e.preventDefault();
        renameCurrentTab();
        break;
      case 'T': // 新建标签页
        e.preventDefault();
        const newTab = createTab();
        createSession(newTab);
        break;
      case 'B': // 切换侧边栏
        e.preventDefault();
        toggleSidebar();
        break;
      case 'L': // 对话历史
        e.preventDefault();
        toggleClaudeDropdown();
        break;
      case 'J': // 定时任务
        e.preventDefault();
        toggleSchedulerDropdown();
        break;
    }
    return;
  }

  // Ctrl+1~6 切换面板
  if (ctrl && !shift && e.key >= '1' && e.key <= '6') {
    e.preventDefault();
    const tab2 = tabs.get(activeTabId);
    if (!tab2) return;
    const idx = parseInt(e.key) - 1;
    if (tab2.sessions[idx]) {
      focusSession(tab2.sessions[idx]);
    }
  }
});

// ============ 窗口 resize ============
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitAllSessions, 100);
});

// ============ 按钮事件 ============
document.getElementById('btn-add').addEventListener('click', async () => {
  showProjectDialog();
});
document.getElementById('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSettingsDropdown();
});
document.getElementById('btn-new-tab').addEventListener('click', () => {
  const newTab = createTab();
  showProjectDialog();
});
document.getElementById('btn-open-folder').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleRecentFolders();
});
document.getElementById('btn-claude').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleClaudeDropdown();
});
document.getElementById('btn-new-file').addEventListener('click', () => {
  if (currentRootPath) createNewItem('file', currentRootPath);
});
document.getElementById('btn-new-folder').addEventListener('click', () => {
  if (currentRootPath) createNewItem('folder', currentRootPath);
});
document.getElementById('btn-refresh').addEventListener('click', () => refreshFileTree());
document.getElementById('btn-collapse-sidebar').addEventListener('click', () => {
  sidebarVisible = false;
  document.getElementById('sidebar').classList.add('hidden');
  setTimeout(fitAllSessions, 50);
});

// ============ 文件浏览器 ============
const sidebar = document.getElementById('sidebar');
const fileTreeEl = document.getElementById('file-tree');
const sidebarTitleEl = document.getElementById('sidebar-title');
const contextMenuEl = document.getElementById('context-menu');
const resizeHandle = document.getElementById('sidebar-resize-handle');
const recentFoldersDropdown = document.getElementById('recent-folders-dropdown');

// 文件树选中状态
let selectedTreeItem = null; // { path, isDirectory, element }
const expandedFolders = new Set(); // 记录已展开的文件夹路径

fileTreeEl.setAttribute('tabindex', '0');
fileTreeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' && selectedTreeItem && selectedTreeItem.path !== currentRootPath) {
    e.preventDefault();
    deleteTreeItem(selectedTreeItem.path, selectedTreeItem.isDirectory);
  }
  if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    let targetDir = currentRootPath;
    if (selectedTreeItem) {
      if (selectedTreeItem.isDirectory) {
        targetDir = selectedTreeItem.path;
      } else {
        const p = selectedTreeItem.path;
        targetDir = p.substring(0, p.lastIndexOf('\\')) || p.substring(0, p.lastIndexOf('/')) || currentRootPath;
      }
    }
    if (targetDir) pasteFilesToDir(targetDir);
  }
});

// 监听文件系统变化，自动刷新文件树（渲染进程侧防抖）
let fsChangedDebounce = null;
window.termAPI.onFsChanged(() => {
  if (!currentRootPath) return;
  clearTimeout(fsChangedDebounce);
  fsChangedDebounce = setTimeout(() => refreshFileTree(), 800);
});

function selectTreeItem(path, isDirectory, element) {
  if (selectedTreeItem && selectedTreeItem.element) {
    selectedTreeItem.element.classList.remove('selected');
  }
  selectedTreeItem = { path, isDirectory, element };
  element.classList.add('selected');
  fileTreeEl.focus();
}

// ---- 侧边栏宽度拖拽 ----
let isResizing = false;
resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  isResizing = true;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const mainArea = document.getElementById('main-area');
  const newWidth = Math.min(Math.max(e.clientX - mainArea.getBoundingClientRect().left, 120), 600);
  sidebar.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false;
  resizeHandle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  setTimeout(fitAllSessions, 50);
});

// ---- 最近文件夹 ----
async function addRecentFolder(folderPath) {
  let list = await window.termAPI.getRecentFolders();
  list = list.filter(p => p !== folderPath);
  list.unshift(folderPath);
  if (list.length > 10) list = list.slice(0, 10);
  await window.termAPI.saveRecentFolders(list);
}

async function openFolder() {
  const folderPath = await window.termAPI.openFolderDialog();
  if (!folderPath) return;
  await openFolderByPath(folderPath);
}

async function openFolderByPath(folderPath) {
  currentRootPath = folderPath;
  sidebarVisible = true;
  sidebar.classList.remove('hidden');
  sidebarTitleEl.textContent = folderPath.split('\\').pop() || folderPath.split('/').pop() || folderPath;
  sidebarTitleEl.title = folderPath;
  await addRecentFolder(folderPath);
  await window.termAPI.saveLastFolder(folderPath);
  refreshFileTree();
  // 启动文件系统监听，自动刷新文件树
  window.termAPI.watchDir(folderPath);
  setTimeout(fitAllSessions, 50);
}

function toggleSidebar() {
  if (!currentRootPath) {
    openFolder();
    return;
  }
  sidebarVisible = !sidebarVisible;
  sidebar.classList.toggle('hidden', !sidebarVisible);
  setTimeout(fitAllSessions, 50);
}

// 切换文件夹（避免频繁刷新）
async function switchFolderForSession(folderPath) {
  if (!folderPath || folderPath === currentRootPath) return;
  
  // 更新文件夹路径
  currentRootPath = folderPath;
  sidebarTitleEl.textContent = folderPath.split('\\').pop() || folderPath.split('/').pop() || folderPath;
  sidebarTitleEl.title = folderPath;
  
  // 刷新文件树
  refreshFileTree();
  
  // 启动文件系统监听，自动刷新文件树
  window.termAPI.watchDir(folderPath);
}

function refreshFileTree() {
  if (!currentRootPath) return;
  // 增量更新：对比现有 DOM 和新数据，只更新变化的部分
  refreshFileTreeDir(fileTreeEl, currentRootPath, 0);
}

async function refreshFileTreeDir(parentEl, dirPath, level) {
  let entries;
  try {
    entries = await window.termAPI.readDir(dirPath);
  } catch {
    return;
  }

  // 构建新条目的 key 列表（name + type）
  const newKeys = entries.map(e => (e.isDirectory ? 'd:' : 'f:') + e.name);

  // 收集现有 DOM 节点的 key（跳过 input 行等临时元素）
  const existingNodes = []; // { key, elements: [folderRow, childrenContainer] or [fileRow] }
  let i = 0;
  const children = Array.from(parentEl.children);
  while (i < children.length) {
    const el = children[i];
    if (!el.classList.contains('tree-item')) { i++; continue; }
    const nameEl = el.querySelector('.tree-name');
    if (!nameEl) { i++; continue; }
    const name = nameEl.textContent;
    const arrow = el.querySelector('.tree-arrow');
    if (arrow) {
      // 文件夹：下一个兄弟是 children container
      const container = children[i + 1];
      existingNodes.push({ key: 'd:' + name, elements: [el, container], name });
      i += 2;
    } else {
      existingNodes.push({ key: 'f:' + name, elements: [el], name });
      i += 1;
    }
  }

  const existingKeySet = new Set(existingNodes.map(n => n.key));
  const newKeySet = new Set(newKeys);

  // 删除不再存在的节点
  for (const node of existingNodes) {
    if (!newKeySet.has(node.key)) {
      for (const el of node.elements) el.remove();
      // 清理 expandedFolders 中的记录
      if (node.key.startsWith('d:')) {
        const folderPath = dirPath + '\\' + node.name;
        expandedFolders.delete(folderPath);
      }
    }
  }

  // 添加新增的节点 + 递归更新已展开的文件夹
  // 为了保持顺序，按 entries 顺序重新排列
  const existingMap = new Map();
  for (const node of existingNodes) {
    if (newKeySet.has(node.key)) {
      existingMap.set(node.key, node);
    }
  }

  // 清空后按新顺序重新插入（移动 DOM 节点不会导致闪烁）
  for (const entry of entries) {
    const key = (entry.isDirectory ? 'd:' : 'f:') + entry.name;
    const existing = existingMap.get(key);

    if (existing) {
      // 已存在：移动到正确位置
      for (const el of existing.elements) parentEl.appendChild(el);
      // 如果是已展开的文件夹，递归更新其子目录
      if (entry.isDirectory && expandedFolders.has(entry.path)) {
        const container = existing.elements[1];
        if (container && !container.classList.contains('collapsed')) {
          await refreshFileTreeDir(container, entry.path, level + 1);
        }
      }
    } else {
      // 新增：创建 DOM
      if (entry.isDirectory) {
        createFolderNode(parentEl, entry, level);
      } else {
        createFileNode(parentEl, entry, level);
      }
    }
  }
}

function createFolderNode(parentEl, entry, level) {
  const folderRow = document.createElement('div');
  folderRow.className = 'tree-item';
  folderRow.style.paddingLeft = (level * 16 + 8) + 'px';
  folderRow.dataset.path = entry.path;

  const arrow = document.createElement('span');
  arrow.className = 'tree-arrow';
  arrow.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📁';

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = entry.name;

  folderRow.appendChild(arrow);
  folderRow.appendChild(icon);
  folderRow.appendChild(name);

  folderRow.draggable = true;
  folderRow.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'copy';
  });

  folderRow.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const tab = tabs.get(activeTabId);
    if (tab && tab.focusedSession) {
      const session = allSessions.get(tab.focusedSession);
      if (session && !session.isHistory) {
        window.termAPI.write({ id: tab.focusedSession, data: `cd "${entry.path}"` });
        focusSession(tab.focusedSession);
      }
    }
  });

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-folder-children collapsed';

  let loaded = false;

  folderRow.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideContextMenu();
    selectTreeItem(entry.path, true, folderRow);
    const isCollapsed = childrenContainer.classList.contains('collapsed');
    if (isCollapsed) {
      if (!loaded) {
        await renderFileTree(childrenContainer, entry.path, level + 1);
        loaded = true;
      }
      childrenContainer.classList.remove('collapsed');
      arrow.textContent = '▼';
      expandedFolders.add(entry.path);
    } else {
      childrenContainer.classList.add('collapsed');
      arrow.textContent = '▶';
      expandedFolders.delete(entry.path);
    }
  });

  folderRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e, entry.path, true);
  });

  parentEl.appendChild(folderRow);
  parentEl.appendChild(childrenContainer);

  // 自动恢复展开状态
  if (expandedFolders.has(entry.path)) {
    (async () => {
      await renderFileTree(childrenContainer, entry.path, level + 1);
      loaded = true;
      childrenContainer.classList.remove('collapsed');
      arrow.textContent = '▼';
    })();
  }
}

// SVG 图标：Office 系列 + PDF（仿官方风格）
const FILE_SVG_ICONS = {
  excel: `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="14" height="14" rx="2" fill="#1d6f42"/><text x="8" y="12" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold" font-family="Arial">X</text></svg>`,
  word: `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="14" height="14" rx="2" fill="#2b579a"/><text x="8" y="12" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold" font-family="Arial">W</text></svg>`,
  ppt: `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="14" height="14" rx="2" fill="#c43e1c"/><text x="8" y="12" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold" font-family="Arial">P</text></svg>`,
  pdf: `<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="1" width="14" height="14" rx="2" fill="#e03030"/><text x="8" y="12" text-anchor="middle" fill="#fff" font-size="8" font-weight="bold" font-family="Arial">PDF</text></svg>`,
};

const FILE_SVG_MAP = {
  xlsx: 'excel', xls: 'excel', csv: 'excel',
  docx: 'word', doc: 'word',
  pptx: 'ppt', ppt: 'ppt',
  pdf: 'pdf',
};

const FILE_EMOJI_MAP = {
  html: '🌐', htm: '🌐',
  css:  '🎨', scss: '🎨', less: '🎨',
  js: '📒', jsx: '📒', ts: '📒', tsx: '📒',
  py: '🐍', go: '🔷', rs: '🦀', java: '☕', rb: '💎',
  json: '📋', yaml: '📋', yml: '📋', toml: '📋', xml: '📋',
  md: '📝',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️',
  mp4: '🎬', mov: '🎬', avi: '🎬',
  mp3: '🎵', wav: '🎵', flac: '🎵',
  zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  sh: '⚙️', bat: '⚙️', ps1: '⚙️',
  exe: '💿', dmg: '💿', msi: '💿',
  txt: '📄', log: '📄',
  env: '🔒', gitignore: '🔒',
  sql: '🗃️',
};

function createFileNode(parentEl, entry, level) {
  const fileRow = document.createElement('div');
  fileRow.className = 'tree-item';
  fileRow.style.paddingLeft = (level * 16 + 24) + 'px';
  fileRow.dataset.path = entry.path;

  const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  const svgType = FILE_SVG_MAP[ext];
  if (svgType) {
    icon.innerHTML = FILE_SVG_ICONS[svgType];
  } else {
    icon.textContent = FILE_EMOJI_MAP[ext] || '📄';
  }

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = entry.name;

  fileRow.appendChild(icon);
  fileRow.appendChild(name);

  fileRow.draggable = true;
  fileRow.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'copy';
  });

  fileRow.addEventListener('click', (e) => {
    e.stopPropagation();
    hideContextMenu();
    selectTreeItem(entry.path, false, fileRow);
  });

  fileRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e, entry.path, false);
  });

  parentEl.appendChild(fileRow);
}

async function renderFileTree(parentEl, dirPath, level) {
  const entries = await window.termAPI.readDir(dirPath);
  for (const entry of entries) {
    if (entry.isDirectory) {
      createFolderNode(parentEl, entry, level);
    } else {
      createFileNode(parentEl, entry, level);
    }
  }
}

function createNewItem(type, parentDir) {
  // 找到对应的容器来插入 input
  // 如果 parentDir 是 currentRootPath，插入到 fileTreeEl 顶部
  // 否则找到对应的展开的 children 容器
  let targetContainer = fileTreeEl;

  if (parentDir !== currentRootPath) {
    // 通过 data-path 属性精确匹配目标文件夹的 children 容器
    const folderName = parentDir.split('\\').pop() || parentDir.split('/').pop();
    const allItems = fileTreeEl.querySelectorAll('.tree-item');
    for (const item of allItems) {
      const nameEl = item.querySelector('.tree-name');
      const container = item.nextElementSibling;
      if (nameEl && nameEl.textContent === folderName &&
          container && container.classList.contains('tree-folder-children') &&
          item.dataset.path === parentDir) {
        targetContainer = container;
        targetContainer.classList.remove('collapsed');
        const arrow = item.querySelector('.tree-arrow');
        if (arrow) arrow.textContent = '▼';
        break;
      }
    }
  }

  const inputRow = document.createElement('div');
  inputRow.className = 'tree-item';
  inputRow.style.paddingLeft = '24px';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = type === 'folder' ? '📁' : '📄';

  const input = document.createElement('input');
  input.className = 'tree-item-input';
  input.placeholder = type === 'folder' ? '文件夹名称' : '文件名称';

  inputRow.appendChild(icon);
  inputRow.appendChild(input);

  // 插入到容器顶部
  if (targetContainer.firstChild) {
    targetContainer.insertBefore(inputRow, targetContainer.firstChild);
  } else {
    targetContainer.appendChild(inputRow);
  }

  input.focus();

  const commit = async () => {
    const name = input.value.trim();
    if (name) {
      const fullPath = parentDir + '\\' + name;
      let result;
      if (type === 'folder') {
        result = await window.termAPI.createFolder(fullPath);
      } else {
        result = await window.termAPI.createFile(fullPath);
      }
      if (!result.success) {
        console.error('创建失败:', result.error);
      }
    }
    inputRow.remove();
    refreshFileTree();
  };

  const cancel = () => {
    inputRow.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation();
  });

  input.addEventListener('blur', () => {
    // 延迟一下，避免和 Enter 冲突
    setTimeout(() => {
      if (inputRow.parentNode) {
        if (input.value.trim()) {
          commit();
        } else {
          cancel();
        }
      }
    }, 100);
  });
}

// ============ 右键菜单 ============
function showContextMenu(e, itemPath, isDirectory) {
  contextMenuEl.innerHTML = '';

  const items = [];

  if (!isDirectory) {
    items.push({ label: '▶️ 打开', action: () => window.termAPI.openFile(itemPath) });
    // 粘贴到文件所在目录
    const parentDir = itemPath.substring(0, itemPath.lastIndexOf('\\')) || itemPath.substring(0, itemPath.lastIndexOf('/'));
    if (parentDir) {
      items.push({ label: '📋 粘贴文件到此处', action: () => pasteFilesToDir(parentDir) });
    }
  }
  if (isDirectory) {
    items.push({ label: '📄 新建文件', action: () => createNewItem('file', itemPath) });
    items.push({ label: '📁 新建文件夹', action: () => createNewItem('folder', itemPath) });
    items.push({ label: '📋 粘贴文件', action: () => pasteFilesToDir(itemPath) });
  }
  // 不对根目录显示重命名/删除
  if (itemPath !== currentRootPath) {
    items.push({ label: '✏️ 重命名', action: () => startTreeRename(itemPath, isDirectory) });
    items.push({ label: '🗑️ 删除', action: () => deleteTreeItem(itemPath, isDirectory) });
  }
  items.push({ label: '📋 复制路径', action: () => {
    navigator.clipboard.writeText(itemPath).then(() => {
      showToast('路径已复制');
    });
  }});
  items.push({ label: '📂 在资源管理器中显示', action: () => window.termAPI.showInExplorer(itemPath) });

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hideContextMenu();
      item.action();
    });
    contextMenuEl.appendChild(el);
  }

  contextMenuEl.style.left = e.clientX + 'px';
  contextMenuEl.style.top = e.clientY + 'px';
  contextMenuEl.classList.remove('hidden');

  // 确保菜单不超出窗口
  requestAnimationFrame(() => {
    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenuEl.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenuEl.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  });
}

function hideContextMenu() {
  contextMenuEl.classList.add('hidden');
}

// ---- 文件树重命名 ----
function startTreeRename(itemPath, isDirectory) {
  // 通过 data-path 精确匹配对应的 tree-item 元素
  const itemName = itemPath.split('\\').pop() || itemPath.split('/').pop();
  const parentDir = itemPath.substring(0, itemPath.length - itemName.length - 1);
  const row = fileTreeEl.querySelector(`.tree-item[data-path="${CSS.escape(itemPath)}"]`);
  if (!row) return;
  const nameEl = row.querySelector('.tree-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.className = 'tree-item-input';
  input.value = itemName;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  // 选中文件名（不含扩展名）
  const dotIdx = itemName.lastIndexOf('.');
  if (!isDirectory && dotIdx > 0) {
    input.setSelectionRange(0, dotIdx);
  } else {
    input.select();
  }

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== itemName) {
      const newPath = parentDir + '\\' + newName;
      const result = await window.termAPI.rename(itemPath, newPath);
      if (!result.success) {
        console.error('重命名失败:', result.error);
      }
    }
    refreshFileTree();
  };

  const cancel = () => {
    nameEl.textContent = itemName;
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (nameEl.contains(input)) {
        if (input.value.trim() && input.value.trim() !== itemName) {
          commit();
        } else {
          cancel();
        }
      }
    }, 100);
  });
}

// ---- 文件树删除 ----
async function deleteTreeItem(itemPath, isDirectory) {
  const itemName = itemPath.split('\\').pop() || itemPath.split('/').pop();
  const typeLabel = isDirectory ? '文件夹' : '文件';
  if (!confirm(`确定删除${typeLabel}「${itemName}」？${isDirectory ? '\n\n将同时删除其中所有内容。' : ''}`)) return;
  const result = await window.termAPI.delete(itemPath, isDirectory);
  if (!result.success) {
    console.error('删除失败:', result.error);
  }
  refreshFileTree();
}

// ---- 文件粘贴 ----
async function pasteFilesToDir(targetDir) {
  const result = await window.termAPI.pasteFiles(targetDir);
  if (!result.success) {
    console.warn('粘贴失败:', result.error);
    return;
  }
  const failed = result.results.filter(r => !r.success);
  if (failed.length > 0) {
    console.warn('部分文件粘贴失败:', failed);
  }
  refreshFileTree();
}

// 点击外部关闭右键菜单
document.addEventListener('click', (e) => {
  if (!contextMenuEl.classList.contains('hidden') && !e.target.closest('#context-menu')) {
    hideContextMenu();
  }
});

// 文件树空白区域右键
fileTreeEl.addEventListener('contextmenu', (e) => {
  if (currentRootPath && e.target === fileTreeEl) {
    e.preventDefault();
    showContextMenu(e, currentRootPath, true);
  }
});

// ============ 最近文件夹 UI ============
async function toggleRecentFolders() {
  if (recentFoldersDropdown.classList.contains('hidden')) {
    await showRecentFolders();
  } else {
    recentFoldersDropdown.classList.add('hidden');
  }
}

async function showRecentFolders() {
  const list = await window.termAPI.getRecentFolders();
  recentFoldersDropdown.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'recent-folder-header';
  header.innerHTML = `<span>最近打开 (${list.length})</span>`;
  recentFoldersDropdown.appendChild(header);

  const listEl = document.createElement('div');
  listEl.className = 'recent-folder-list';

  if (list.length === 0) {
    listEl.innerHTML = '<div class="recent-folder-empty">暂无最近打开的文件夹</div>';
  } else {
    for (const folderPath of list) {
      const row = document.createElement('div');
      row.className = 'recent-folder-item';

      const folderName = folderPath.split('\\').pop() || folderPath.split('/').pop() || folderPath;

      const nameEl = document.createElement('span');
      nameEl.className = 'recent-folder-item-name';
      nameEl.textContent = '📂 ' + folderName;

      const pathEl = document.createElement('span');
      pathEl.className = 'recent-folder-item-path';
      pathEl.textContent = folderPath;
      pathEl.title = folderPath;

      const delBtn = document.createElement('button');
      delBtn.className = 'recent-folder-item-delete';
      delBtn.textContent = '×';
      delBtn.title = '移除';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let current = await window.termAPI.getRecentFolders();
        current = current.filter(p => p !== folderPath);
        await window.termAPI.saveRecentFolders(current);
        showRecentFolders();
      });

      row.appendChild(nameEl);
      row.appendChild(pathEl);
      row.appendChild(delBtn);

      row.addEventListener('click', () => {
        recentFoldersDropdown.classList.add('hidden');
        openFolderByPath(folderPath);
      });

      listEl.appendChild(row);
    }
  }

  recentFoldersDropdown.appendChild(listEl);

  // 底部「打开其他文件夹」按钮
  const openBtn = document.createElement('button');
  openBtn.className = 'recent-folder-open-btn';
  openBtn.textContent = '📂 打开其他文件夹...';
  openBtn.addEventListener('click', () => {
    recentFoldersDropdown.classList.add('hidden');
    openFolder();
  });
  recentFoldersDropdown.appendChild(openBtn);

  recentFoldersDropdown.classList.remove('hidden');
}

// 点击外部关闭最近文件夹下拉
document.addEventListener('click', (e) => {
  if (!recentFoldersDropdown.classList.contains('hidden') && !e.target.closest('#folder-wrapper')) {
    recentFoldersDropdown.classList.add('hidden');
  }
});

document.addEventListener('click', (e) => {
  if (!settingsDropdown.classList.contains('hidden') && !e.target.closest('#settings-wrapper')) {
    settingsDropdown.classList.add('hidden');
  }
});

document.addEventListener('dragover', (e) => {
  if (hasTransferType(e.dataTransfer, 'text/x-pane-id')) return;
  if (!isExternalFileTransfer(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('drop', (e) => {
  if (hasTransferType(e.dataTransfer, 'text/x-pane-id')) return;
  if (!isExternalFileTransfer(e.dataTransfer)) return;
  e.preventDefault();
  const sessionId = getFocusedWritableSessionId();
  if (!sessionId) return;
  if (writeDroppedPathsToSession(sessionId, e.dataTransfer)) {
    focusSession(sessionId);
  }
});

// ============ 对话历史 UI ============
const claudeDropdown = document.getElementById('claude-dropdown');
let conversationSessionsCache = [];

function toggleClaudeDropdown() {
  if (claudeDropdown.classList.contains('hidden')) {
    showConversationDropdown();
  } else {
    claudeDropdown.classList.add('hidden');
  }
}

async function showConversationDropdown() {
  claudeDropdown.innerHTML = '';

  if (!currentRootPath) {
    claudeDropdown.innerHTML = '<div class="claude-empty">请先打开一个文件夹</div>';
    claudeDropdown.classList.remove('hidden');
    return;
  }

  conversationSessionsCache = await window.termAPI.listConversationSessions({ rootPath: currentRootPath });
  sortConversationSessions();
  claudeDropdown.innerHTML = '';

  // 头部
  const header = document.createElement('div');
  header.className = 'claude-header';
  header.innerHTML = `<span>对话历史 (${conversationSessionsCache.length})</span>`;
  claudeDropdown.appendChild(header);

  // 搜索框
  const searchInput = document.createElement('input');
  searchInput.className = 'claude-search-input';
  searchInput.placeholder = '搜索会话...';
  searchInput.addEventListener('input', () => {
    renderConversationList(listEl, searchInput.value.trim().toLowerCase());
  });
  searchInput.addEventListener('keydown', (e) => e.stopPropagation());
  claudeDropdown.appendChild(searchInput);

  // 列表容器
  const listEl = document.createElement('div');
  listEl.className = 'claude-list';
  claudeDropdown.appendChild(listEl);

  renderConversationList(listEl, '');
  claudeDropdown.classList.remove('hidden');

  // 聚焦搜索框
  requestAnimationFrame(() => searchInput.focus());
}

function renderConversationList(listEl, filter) {
  listEl.innerHTML = '';

  const filtered = filter
    ? conversationSessionsCache.filter(s =>
        (s.customName && s.customName.toLowerCase().includes(filter)) ||
        s.summary.toLowerCase().includes(filter) ||
        s.projectName.toLowerCase().includes(filter) ||
        s.id.toLowerCase().includes(filter) ||
        getProviderLabel(s.provider).toLowerCase().includes(filter))
    : conversationSessionsCache;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="claude-empty">${filter ? '无匹配结果' : '未找到历史会话'}</div>`;
    return;
  }

  for (const session of filtered) {
    const row = document.createElement('div');
    row.className = 'claude-session-item';

    const info = document.createElement('div');
    info.className = 'claude-session-info';

    // 显示名称或摘要
    const nameEl = document.createElement('div');
    if (session.customName) {
      nameEl.className = 'claude-session-name';
      nameEl.textContent = session.customName;
    } else {
      nameEl.className = 'claude-session-summary';
      nameEl.textContent = session.summary ? session.summary.slice(0, 50) : '(空会话)';
    }
    nameEl.title = session.summary || '';

    const providerMeta = document.createElement('div');
    providerMeta.className = 'history-provider-row';
    const providerTag = document.createElement('span');
    providerTag.className = `history-provider-tag ${getProviderBadgeClass(session.provider)}`;
    providerTag.textContent = getProviderLabel(session.provider);
    providerMeta.appendChild(providerTag);

    // 项目 + 时间
    const meta = document.createElement('div');
    meta.className = 'claude-session-meta';
    meta.textContent = `${session.projectName} | ${formatTime(session.lastActive)}`;
    meta.title = session.projectName;

    info.appendChild(providerMeta);
    info.appendChild(nameEl);
    info.appendChild(meta);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'claude-session-actions';

    const copyIdBtn = document.createElement('button');
    copyIdBtn.textContent = '⎘';
    copyIdBtn.title = `复制 ${getHistoryResumeCommand(session)}`;
    copyIdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(getHistoryResumeCommand(session)).then(() => {
        copyIdBtn.textContent = '✓';
        setTimeout(() => { copyIdBtn.textContent = '⎘'; }, 1500);
      });
    });
    actions.appendChild(copyIdBtn);

    const pinBtn = document.createElement('button');
    pinBtn.className = 'claude-pin-btn' + (session.pinned ? ' pinned' : '');
    pinBtn.textContent = session.pinned ? '★' : '☆';
    pinBtn.title = session.pinned ? '取消收藏' : '收藏';
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newPinned = !session.pinned;
      await pinHistorySession(session, newPinned);
      const searchInput = claudeDropdown.querySelector('.claude-search-input');
      const filterValue = searchInput ? searchInput.value.trim().toLowerCase() : '';
      renderConversationList(listEl, filterValue);
    });

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎';
    renameBtn.title = '重命名';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startHistorySessionRename(session, nameEl);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = '删除会话';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除此会话？')) return;
      await deleteHistorySession(session);
      const searchInput = claudeDropdown.querySelector('.claude-search-input');
      const filterValue = searchInput ? searchInput.value.trim().toLowerCase() : '';
      renderConversationList(listEl, filterValue);
    });

    actions.prepend(pinBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(info);
    row.appendChild(actions);

    // 点击整行 → 创建新终端并执行 resume（cwd 设为会话原始目录）
    row.addEventListener('click', async () => {
      claudeDropdown.classList.add('hidden');
      await resumeHistorySession(session, session.cwd || currentRootPath);
    });

    listEl.appendChild(row);
  }
}

function startHistorySessionRename(session, nameEl) {
  if (nameEl.querySelector('.claude-inline-rename')) return;

  const currentName = session.customName || '';
  const input = document.createElement('input');
  input.className = 'claude-inline-rename';
  input.value = currentName;
  input.placeholder = '输入会话名称';

  const commit = async () => {
    const newName = input.value.trim();
    await renameHistorySession(session, newName);
    // 更新显示
    if (newName) {
      nameEl.className = 'claude-session-name';
      nameEl.textContent = newName;
    } else {
      nameEl.className = 'claude-session-summary';
      nameEl.textContent = session.summary ? session.summary.slice(0, 50) : '(空会话)';
    }
    const searchInput = claudeDropdown.querySelector('.claude-search-input');
    const filterValue = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const listEl = claudeDropdown.querySelector('.claude-list');
    if (listEl) renderConversationList(listEl, filterValue);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (session.customName) {
        nameEl.className = 'claude-session-name';
        nameEl.textContent = session.customName;
      } else {
        nameEl.className = 'claude-session-summary';
        nameEl.textContent = session.summary ? session.summary.slice(0, 50) : '(空会话)';
      }
    }
    e.stopPropagation();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);

  nameEl.textContent = '';
  nameEl.className = 'claude-session-name';
  nameEl.appendChild(input);
  input.focus();
  input.select();
}

// 点击外部关闭 Claude 下拉
document.addEventListener('click', (e) => {
  if (!claudeDropdown.classList.contains('hidden') && !e.target.closest('#claude-wrapper')) {
    claudeDropdown.classList.add('hidden');
  }
});

// ============ 定时任务 ============
const schedulerDropdown = document.getElementById('scheduler-dropdown');

// 正在执行的任务跟踪: Map<taskId, { sessionId, aborted }>
const runningSchedulerTasks = new Map();

// 中止任务
function abortSchedulerTask(taskId) {
  const running = runningSchedulerTasks.get(taskId);
  if (running) {
    running.aborted = true;
    // kill PTY 终止 Claude 进程
    if (running.sessionId) {
      window.termAPI.write({ id: running.sessionId, data: '\x03' }); // 先发 Ctrl+C
      setTimeout(() => {
        window.termAPI.write({ id: running.sessionId, data: '\x03' });
        setTimeout(() => {
          window.termAPI.kill({ id: running.sessionId });
        }, 500);
      }, 500);
    }
  }
}

// 工具函数：剥离 ANSI 转义码
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b[^a-zA-Z]*[a-zA-Z]/g, '');
}

// 从终端输出中提取 Claude 的实际回复内容（去除 spinner、分隔线等噪音）
function extractClaudeReply(plainText) {
  // 取最后 2000 字符
  let text = plainText.slice(-2000);
  // 按行分割
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过空行
    if (!trimmed) continue;
    // 跳过分隔线（连续的 ─ 或 ═ 或 ─ 混合）
    if (/^[─═━─\-]{5,}$/.test(trimmed)) continue;
    // 跳过 spinner 动画行（Pondering、Thinking 等 + 特殊字符）
    if (/^[✶✻✽✢·●○◉◎\s]*(Pondering|Thinking|Processing|Loading|Generating|Analyzing|Searching|Reading|Writing|Editing|Running)…?[✶✻✽✢·●○◉◎\s]*$/i.test(trimmed)) continue;
    // 跳过纯 spinner 字符行
    if (/^[✶✻✽✢·●○◉◎\s*]+$/.test(trimmed)) continue;
    // 跳过 Claude 提示符行
    if (/^[>❯\$]\s*$/.test(trimmed)) continue;
    // 跳过 "Found X settings issues" 等系统消息
    if (/^Found \d+ settings? issues?/i.test(trimmed)) continue;
    if (/^\/doctor for details/i.test(trimmed)) continue;
    cleaned.push(trimmed);
  }
  // 取最后几行有意义的内容
  const result = cleaned.slice(-8).join('\n');
  return result.slice(0, 500);
}

// Claude 就绪检测：轮询 outputBuffer，检测提示符
function waitForClaudeReady(sessionId, timeoutMs = 45000, abortSignal = null) {
  return new Promise((resolve) => {
    const session = allSessions.get(sessionId);
    if (!session) { resolve(false); return; }

    const startTime = Date.now();
    const minWait = 5000; // 最少等 5 秒
    let lastBufferLen = 0;
    let stableStart = 0;
    let promptDetectedAt = 0;
    let resolved = false;

    const done = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    const check = () => {
      if (resolved) return;
      if (abortSignal && abortSignal.aborted) { done(false); return; }
      const s = allSessions.get(sessionId);
      if (!s) { done(false); return; }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        console.warn('[Scheduler] waitForClaudeReady: timeout after', elapsed, 'ms, force proceeding');
        done(true);
        return;
      }

      const buf = s.outputBuffer || '';
      const currentLen = buf.length;

      // 每 5 秒打印一次调试信息
      if (Math.floor(elapsed / 5000) !== Math.floor((elapsed - 200) / 5000)) {
        const plain = stripAnsi(buf.slice(-300));
        console.log('[Scheduler] Ready check @', elapsed, 'ms, bufLen:', currentLen, 'tail:', JSON.stringify(plain.slice(-100)));
      }

      // 检查提示符：Claude Code 的输入提示符
      const plain = stripAnsi(buf.slice(-3000));
      const lines = plain.split('\n');
      const lastLines = lines.slice(-10);

      // Claude Code 提示符模式：独立的 ">" 或 "❯" 行
      const hasPrompt = lastLines.some(l => {
        const trimmed = l.trim();
        return /^[>❯]\s*$/.test(trimmed);
      });

      // TUI 输入框检测（box-drawing 字符）
      const rawTail = buf.slice(-1000);
      const hasInputArea = rawTail.includes('╭') || rawTail.includes('│') || rawTail.includes('╰');

      // 方式 1：检测到提示符
      if (hasPrompt && elapsed >= minWait) {
        console.log('[Scheduler] Prompt ">" detected after', elapsed, 'ms');
        setTimeout(() => done(true), 2000);
        return;
      }

      // 方式 2：TUI 输入框出现且输出稳定
      if (hasInputArea && elapsed >= minWait) {
        if (!promptDetectedAt) {
          promptDetectedAt = Date.now();
          console.log('[Scheduler] TUI input area first detected at', elapsed, 'ms');
        }
        if (currentLen === lastBufferLen && (Date.now() - promptDetectedAt) >= 2000) {
          console.log('[Scheduler] TUI input area stable after', elapsed, 'ms');
          setTimeout(() => done(true), 2000);
          return;
        }
      }

      // 方式 3：输出稳定超过 8 秒（保底）
      if (currentLen !== lastBufferLen) {
        lastBufferLen = currentLen;
        stableStart = Date.now();
      } else if (elapsed >= minWait && currentLen > 0 && (Date.now() - stableStart) >= 8000) {
        console.log('[Scheduler] Output stable for 8s, proceeding after', elapsed, 'ms');
        setTimeout(() => done(true), 1000);
        return;
      }

      setTimeout(check, 200);
    };

    setTimeout(check, 200);
  });
}

// 等待任务完成：输出稳定 30 秒或 PTY 退出
function waitForTaskCompletion(sessionId, timeoutMs = 600000, abortSignal = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastBufferLen = 0;
    let stableStart = Date.now();

    const check = () => {
      if (abortSignal && abortSignal.aborted) { resolve('aborted'); return; }
      const s = allSessions.get(sessionId);
      if (!s) {
        // session 退出不一定是失败，可能是 Claude 正常完成后用户/系统关闭了
        // 给一个 'exited' 状态，由调用方判断
        resolve('exited'); return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) { resolve('timeout'); return; }

      const currentLen = (s.outputBuffer || '').length;
      if (currentLen !== lastBufferLen) {
        lastBufferLen = currentLen;
        stableStart = Date.now();
      } else if ((Date.now() - stableStart) >= 30000) {
        // 30秒无输出变化，检查是否回到了 Claude 提示符（说明任务完成）
        const plain = stripAnsi((s.outputBuffer || '').slice(-300));
        if (/[>❯\$]\s*$/.test(plain) || /\n\s*$/.test(plain)) {
          resolve('stable');
          return;
        }
        // 即使没检测到提示符，30秒无变化也认为完成
        resolve('stable');
        return;
      }

      setTimeout(check, 2000);
    };

    setTimeout(check, 2000);
  });
}

// 执行引擎
async function executeSchedulerTask(task) {
  const logs = [];
  const log = (msg) => { const t = new Date().toISOString().slice(11, 23); const line = `[${t}] ${msg}`; console.log('[Scheduler]', msg); logs.push(line); };

  log(`Executing task: ${task.name} (${task.id})`);
  const startedAt = new Date().toISOString();
  let status = 'failed';
  let summary = '';

  // 注册到运行中任务跟踪
  const runState = { sessionId: null, aborted: false };
  runningSchedulerTasks.set(task.id, runState);

  try {
    // 1. 创建新标签页和会话
    log('Step 1: Creating tab and session...');
    const tabId = createTab(`⏰ ${task.name}`);
    log('Tab created: ' + tabId);
    const sessionId = await createSession(tabId, { cwd: task.cwd || undefined });
    log('Session created: ' + sessionId);
    if (!sessionId) throw new Error('Failed to create session');
    runState.sessionId = sessionId;

    if (runState.aborted) throw new Error('已中止');

    // 2. 等 PTY 就绪
    log('Step 2: Waiting 800ms for PTY...');
    await new Promise(r => setTimeout(r, 800));

    if (runState.aborted) throw new Error('已中止');

    // 3. 发送 claude --resume 命令
    const resumeCmd = `claude --resume ${task.claudeSessionId}`;
    log('Step 3: Sending: ' + resumeCmd);
    window.termAPI.write({ id: sessionId, data: resumeCmd + '\r' });

    // 4. 等待 Claude 就绪
    log('Step 4: Waiting for Claude ready (timeout 45s)...');
    const ready = await waitForClaudeReady(sessionId, 45000, runState);
    if (runState.aborted) throw new Error('已中止');
    if (!ready) throw new Error('Claude session not ready (returned false)');

    // 打印就绪时的 buffer 尾部
    const dbgSession = allSessions.get(sessionId);
    if (dbgSession) {
      const dbgPlain = stripAnsi((dbgSession.outputBuffer || '').slice(-500));
      log('Claude ready! Buffer tail: ' + JSON.stringify(dbgPlain.slice(-200)));
      log('Raw tail: ' + JSON.stringify((dbgSession.outputBuffer || '').slice(-200)));
    }

    if (runState.aborted) throw new Error('已中止');

    // 5. 发送指令 — 一次性写入全部文本，然后发回车
    log('Step 5: Sending instruction: ' + task.instruction.slice(0, 80));
    const preLen = (allSessions.get(sessionId)?.outputBuffer || '').length;

    // 方式 A：一次性写入（模拟粘贴）
    window.termAPI.write({ id: sessionId, data: task.instruction });
    log('Instruction text written, waiting 800ms...');
    await new Promise(r => setTimeout(r, 800));

    const afterTextLen = (allSessions.get(sessionId)?.outputBuffer || '').length;
    log('Buffer after text: +' + (afterTextLen - preLen) + ' bytes');

    if (runState.aborted) throw new Error('已中止');

    // 发送回车
    log('Sending Enter (\\r)...');
    window.termAPI.write({ id: sessionId, data: '\r' });
    await new Promise(r => setTimeout(r, 2000));

    const afterEnterLen = (allSessions.get(sessionId)?.outputBuffer || '').length;
    log('Buffer after Enter: +' + (afterEnterLen - afterTextLen) + ' bytes');

    // 如果 \r 后 buffer 变化很小，可能没生效，重试
    if (afterEnterLen - afterTextLen < 20) {
      log('Enter may not have worked, retrying with \\n...');
      window.termAPI.write({ id: sessionId, data: '\n' });
      await new Promise(r => setTimeout(r, 1000));
      const afterRetryLen = (allSessions.get(sessionId)?.outputBuffer || '').length;
      log('Buffer after \\n retry: +' + (afterRetryLen - afterEnterLen) + ' bytes');

      // 还是没反应，尝试逐字符重新输入
      if (afterRetryLen - afterEnterLen < 20) {
        log('Retrying with character-by-character input...');
        // 先发 Ctrl+C 清除当前输入
        window.termAPI.write({ id: sessionId, data: '\x03' });
        await new Promise(r => setTimeout(r, 500));
        // 逐字符输入
        for (const ch of task.instruction) {
          window.termAPI.write({ id: sessionId, data: ch });
          await new Promise(r => setTimeout(r, 50));
        }
        await new Promise(r => setTimeout(r, 500));
        window.termAPI.write({ id: sessionId, data: '\r' });
        await new Promise(r => setTimeout(r, 1000));
        log('Character-by-character retry done');
      }
    }

    log('Instruction sent, waiting for completion...');

    // 6. 等待任务完成
    const result = await waitForTaskCompletion(sessionId, 600000, runState);

    if (runState.aborted) throw new Error('已中止');

    log('Result: ' + result);

    // 提取 Claude 的实际回复内容（去除 spinner、分隔线等终端噪音）
    const s = allSessions.get(sessionId);
    if (s) {
      const plain = stripAnsi(s.outputBuffer || '');
      summary = extractClaudeReply(plain);
    }

    // exited 也可能是正常完成（Claude 退出），不一律判定失败
    status = (result === 'stable' || result === 'exited') ? 'success' : 'failed';
    if (result === 'timeout') summary = '[超时] ' + summary;
  } catch (e) {
    const msg = e.message || String(e);
    log('ERROR: ' + msg);
    if (runState.aborted || msg === '已中止') {
      status = 'cancelled';
      summary = '用户手动中止';
    } else {
      status = 'failed';
      summary = msg;
    }
  }

  log('Task finished. Status: ' + status);
  // 保存调试日志到 localStorage
  try { localStorage.setItem('scheduler-debug-' + task.id, logs.join('\n')); } catch {}
  console.log('[Scheduler] Task finished. Status:', status, 'Summary:', summary.slice(0, 100));

  const finishedSessionId = runState.sessionId;
  runningSchedulerTasks.delete(task.id);

  // 报告结果
  window.termAPI.schedulerReportResult({
    taskId: task.id,
    status,
    summary,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  // 任务完成后执行系统操作（仅成功时触发）
  if (status === 'success' && task.postAction && task.postAction !== 'none') {
    const actionNames = { shutdown: '关机', lock: '锁屏', sleep: '睡眠', hibernate: '休眠' };
    console.log('[Scheduler] Post-action:', task.postAction);
    try {
      await window.termAPI.systemPostAction(task.postAction);
      console.log('[Scheduler] Post-action executed:', task.postAction);
    } catch (e) {
      console.error('[Scheduler] Post-action failed:', e);
    }
  }

  // 任务完成后关闭定时任务创建的终端标签页
  if (finishedSessionId) {
    const s = allSessions.get(finishedSessionId);
    if (s && s.tabId) {
      log('Closing scheduler tab: ' + s.tabId);
      closeTab(s.tabId);
    }
  }
}

// 注册执行引擎：主进程调度 + 立即运行按钮
window.termAPI.onSchedulerExecute(executeSchedulerTask);
window._schedulerExecuteHandler = executeSchedulerTask;

// 托盘"查看任务状态"点击时打开面板
window.termAPI.onSchedulerShowPanel(() => {
  if (schedulerDropdown.classList.contains('hidden')) {
    renderSchedulerList();
    schedulerDropdown.classList.remove('hidden');
  }
});

// UI: 切换定时任务面板
function toggleSchedulerDropdown() {
  if (schedulerDropdown.classList.contains('hidden')) {
    renderSchedulerList();
    schedulerDropdown.classList.remove('hidden');
  } else {
    schedulerDropdown.classList.add('hidden');
  }
}

// UI: 任务列表视图
async function renderSchedulerList() {
  const tasks = await window.termAPI.schedulerGetTasks();
  schedulerDropdown.innerHTML = '';

  // 头部
  const header = document.createElement('div');
  header.className = 'scheduler-header';
  header.innerHTML = `<span>定时任务 (${tasks.length})</span>`;
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ 新建';
  addBtn.addEventListener('click', () => renderSchedulerForm(null));
  header.appendChild(addBtn);
  schedulerDropdown.appendChild(header);

  // 列表
  const listEl = document.createElement('div');
  listEl.className = 'scheduler-list';

  if (tasks.length === 0) {
    listEl.innerHTML = '<div class="scheduler-empty">暂无定时任务</div>';
  } else {
    for (const task of tasks) {
      const row = document.createElement('div');
      row.className = 'scheduler-task-item';

      // 开关
      const toggle = document.createElement('div');
      toggle.className = 'scheduler-toggle' + (task.enabled ? ' enabled' : '');
      toggle.title = task.enabled ? '点击禁用' : '点击启用';
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newEnabled = !task.enabled;
        await window.termAPI.schedulerToggleTask({ taskId: task.id, enabled: newEnabled });
        task.enabled = newEnabled;
        toggle.className = 'scheduler-toggle' + (newEnabled ? ' enabled' : '');
        toggle.title = newEnabled ? '点击禁用' : '点击启用';
      });

      // 信息
      const info = document.createElement('div');
      info.className = 'scheduler-task-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'scheduler-task-name';
      nameEl.textContent = task.name;

      const meta = document.createElement('div');
      meta.className = 'scheduler-task-meta';
      let scheduleDesc;
      if (task.scheduleType === 'daily') {
        scheduleDesc = `每天 ${task.dailyTime}`;
      } else if (task.scheduleType === 'interval') {
        scheduleDesc = `每 ${task.intervalHours} 小时`;
      } else if (task.scheduleType === 'once') {
        scheduleDesc = `一次性 ${task.onceDateTime}`;
      } else if (task.scheduleType === 'cron') {
        scheduleDesc = `cron: ${task.cronExpression || '?'}`;
      }
      const lastRun = task.lastRunAt ? formatTime(task.lastRunAt) : '从未执行';
      const postActionNames = { shutdown: '关机', lock: '锁屏', sleep: '睡眠', hibernate: '休眠' };
      const postActionDesc = task.postAction && postActionNames[task.postAction] ? ` → ${postActionNames[task.postAction]}` : '';
      meta.textContent = `${scheduleDesc}${postActionDesc} | 上次: ${lastRun}`;

      info.appendChild(nameEl);
      info.appendChild(meta);

      // 状态
      let statusEl = null;
      if (task.lastRunStatus) {
        statusEl = document.createElement('span');
        statusEl.className = 'scheduler-task-status ' + task.lastRunStatus;
        const statusText = { success: '成功', failed: '失败', running: '运行中', cancelled: '已中止' };
        statusEl.textContent = statusText[task.lastRunStatus] || task.lastRunStatus;
      }

      // 操作按钮
      const actions = document.createElement('div');
      actions.className = 'scheduler-task-actions';

      // 运行中时显示中止按钮（只要状态是 running 就显示，不依赖内存 Map）
      if (task.lastRunStatus === 'running') {
        if (runningSchedulerTasks.has(task.id)) {
          // 任务确实在本进程运行中，显示中止按钮
          const abortBtn = document.createElement('button');
          abortBtn.textContent = '⏹';
          abortBtn.title = '中止任务';
          abortBtn.style.opacity = '1';
          abortBtn.style.color = '#e0355f';
          abortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`确定中止任务「${task.name}」？`)) return;
            abortSchedulerTask(task.id);
            abortBtn.textContent = '⏳';
            abortBtn.title = '正在中止...';
            abortBtn.style.pointerEvents = 'none';
            // 延迟刷新列表
            setTimeout(() => renderSchedulerList(), 2000);
          });
          actions.appendChild(abortBtn);
        } else {
          // 状态是 running 但本进程没有跟踪到（可能执行已结束但状态没更新），显示重置按钮
          const resetBtn = document.createElement('button');
          resetBtn.textContent = '↻';
          resetBtn.title = '重置状态（任务可能已结束但状态未更新）';
          resetBtn.style.opacity = '1';
          resetBtn.style.color = '#e0b800';
          resetBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            task.lastRunStatus = 'failed';
            await window.termAPI.schedulerSaveTask(task);
            renderSchedulerList();
          });
          actions.appendChild(resetBtn);
        }
      }

      // 立即运行按钮（非 running 状态时显示）
      if (task.lastRunStatus !== 'running') {
        const runBtn = document.createElement('button');
        runBtn.textContent = '▶';
        runBtn.title = '立即运行';
        runBtn.style.opacity = '1';
        runBtn.style.color = '#00c87a';
        runBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          task.lastRunStatus = 'running';
          await window.termAPI.schedulerSaveTask(task);
          if (window._schedulerExecuteHandler) {
            window._schedulerExecuteHandler(task);
          }
          renderSchedulerList();
        });
        actions.appendChild(runBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.title = '编辑';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSchedulerForm(task);
      });

      const logBtn = document.createElement('button');
      logBtn.textContent = '📋';
      logBtn.title = '查看日志';
      logBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSchedulerLogs(task);
      });

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = '删除';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`确定删除任务「${task.name}」？`)) return;
        await window.termAPI.schedulerDeleteTask(task.id);
        renderSchedulerList();
      });

      actions.appendChild(editBtn);
      actions.appendChild(logBtn);
      actions.appendChild(delBtn);

      row.appendChild(toggle);
      row.appendChild(info);
      if (statusEl) row.appendChild(statusEl);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  }

  schedulerDropdown.appendChild(listEl);
}

// UI: 新建/编辑表单
async function renderSchedulerForm(existingTask) {
  schedulerDropdown.innerHTML = '';

  // 头部
  const header = document.createElement('div');
  header.className = 'scheduler-header';
  const backBtn = document.createElement('button');
  backBtn.className = 'scheduler-back-btn';
  backBtn.textContent = '← 返回';
  backBtn.addEventListener('click', () => renderSchedulerList());
  const titleSpan = document.createElement('span');
  titleSpan.textContent = existingTask ? '编辑任务' : '新建任务';
  titleSpan.style.marginLeft = '8px';
  header.appendChild(backBtn);
  header.appendChild(titleSpan);
  schedulerDropdown.appendChild(header);

  // 表单
  const form = document.createElement('div');
  form.className = 'scheduler-form';

  // 任务名称
  const nameLabel = document.createElement('label');
  nameLabel.textContent = '任务名称';
  const nameInput = document.createElement('input');
  nameInput.value = existingTask ? existingTask.name : '';
  nameInput.placeholder = '例如：每日代码审查';
  nameInput.addEventListener('keydown', (e) => e.stopPropagation());
  form.appendChild(nameLabel);
  form.appendChild(nameInput);

  // Claude 会话选择
  const sessionLabel = document.createElement('label');
  sessionLabel.textContent = 'Claude 会话';
  const sessionSelect = document.createElement('select');
  sessionSelect.innerHTML = '<option value="">加载中...</option>';
  form.appendChild(sessionLabel);
  form.appendChild(sessionSelect);

  // 异步加载会话列表
  (async () => {
    const sessions = await window.termAPI.listClaudeSessions({ rootPath: currentRootPath || undefined });
    sessionSelect.innerHTML = '<option value="">-- 选择 Claude 会话 --</option>';
    for (const s of sessions) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ id: s.id, projectPath: s.projectPath, cwd: s.cwd });
      opt.textContent = s.customName || (s.summary ? s.summary.slice(0, 60) : s.id.slice(0, 8));
      if (existingTask && s.id === existingTask.claudeSessionId) opt.selected = true;
      sessionSelect.appendChild(opt);
    }
  })();

  // 指令
  const instrLabel = document.createElement('label');
  instrLabel.textContent = '发送给 Claude 的指令';
  const instrInput = document.createElement('textarea');
  instrInput.value = existingTask ? existingTask.instruction : '';
  instrInput.placeholder = '例如：请检查最近的代码变更并生成报告';
  instrInput.addEventListener('keydown', (e) => e.stopPropagation());
  form.appendChild(instrLabel);
  form.appendChild(instrInput);

  // 调度方式
  const schedRow = document.createElement('div');
  schedRow.className = 'scheduler-form-row';

  const typeDiv = document.createElement('div');
  const typeLabel = document.createElement('label');
  typeLabel.textContent = '调度方式';
  const typeSelect = document.createElement('select');
  typeSelect.innerHTML = '<option value="daily">每天定时</option><option value="interval">固定间隔</option><option value="once">一次性执行</option><option value="cron">Cron 表达式</option>';
  if (existingTask) typeSelect.value = existingTask.scheduleType || 'daily';
  typeDiv.appendChild(typeLabel);
  typeDiv.appendChild(typeSelect);

  const paramDiv = document.createElement('div');
  const paramLabel = document.createElement('label');
  paramLabel.textContent = '时间/间隔';
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = existingTask ? (existingTask.dailyTime || '09:00') : '09:00';
  timeInput.addEventListener('keydown', (e) => e.stopPropagation());
  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.max = '168';
  intervalInput.value = existingTask ? (existingTask.intervalHours || 4) : 4;
  intervalInput.placeholder = '小时';
  intervalInput.style.display = 'none';
  intervalInput.addEventListener('keydown', (e) => e.stopPropagation());
  const onceDateTimeInput = document.createElement('input');
  onceDateTimeInput.type = 'datetime-local';
  onceDateTimeInput.value = existingTask && existingTask.onceDateTime ? existingTask.onceDateTime : new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  onceDateTimeInput.addEventListener('keydown', (e) => e.stopPropagation());
  onceDateTimeInput.style.display = 'none';

  // Cron 表达式输入
  const cronWrapper = document.createElement('div');
  cronWrapper.style.display = 'none';
  const cronInput = document.createElement('input');
  cronInput.type = 'text';
  cronInput.value = existingTask ? (existingTask.cronExpression || '') : '';
  cronInput.placeholder = '例如: 0 8,12,18 * * *';
  cronInput.addEventListener('keydown', (e) => e.stopPropagation());
  const cronPreset = document.createElement('select');
  cronPreset.innerHTML = `
    <option value="">常用预设...</option>
    <option value="*/5 * * * *">每5分钟</option>
    <option value="*/30 * * * *">每30分钟</option>
    <option value="0 * * * *">每小时整点</option>
    <option value="0 8,12,18 * * *">每天 8/12/18 点</option>
    <option value="0 9 * * 1-5">工作日 9:00</option>
    <option value="0 0 * * *">每天午夜</option>
    <option value="0 0 * * 0">每周日午夜</option>
    <option value="0 0 1 * *">每月1号午夜</option>
  `;
  cronPreset.addEventListener('change', () => {
    if (cronPreset.value) {
      cronInput.value = cronPreset.value;
      cronPreset.value = '';
    }
  });
  cronWrapper.appendChild(cronInput);
  cronWrapper.appendChild(cronPreset);

  const updateParamVisibility = () => {
    if (typeSelect.value === 'daily') {
      timeInput.style.display = '';
      intervalInput.style.display = 'none';
      onceDateTimeInput.style.display = 'none';
      cronWrapper.style.display = 'none';
      paramLabel.textContent = '执行时间';
    } else if (typeSelect.value === 'interval') {
      timeInput.style.display = 'none';
      intervalInput.style.display = '';
      onceDateTimeInput.style.display = 'none';
      cronWrapper.style.display = 'none';
      paramLabel.textContent = '间隔(小时)';
    } else if (typeSelect.value === 'once') {
      timeInput.style.display = 'none';
      intervalInput.style.display = 'none';
      onceDateTimeInput.style.display = '';
      cronWrapper.style.display = 'none';
      paramLabel.textContent = '执行时间';
    } else if (typeSelect.value === 'cron') {
      timeInput.style.display = 'none';
      intervalInput.style.display = 'none';
      onceDateTimeInput.style.display = 'none';
      cronWrapper.style.display = '';
      paramLabel.textContent = 'Cron 表达式';
    }
  };
  typeSelect.addEventListener('change', updateParamVisibility);
  updateParamVisibility();

  paramDiv.appendChild(paramLabel);
  paramDiv.appendChild(timeInput);
  paramDiv.appendChild(intervalInput);
  paramDiv.appendChild(onceDateTimeInput);
  paramDiv.appendChild(cronWrapper);

  schedRow.appendChild(typeDiv);
  schedRow.appendChild(paramDiv);
  form.appendChild(schedRow);

  // 工作目录
  const cwdLabel = document.createElement('label');
  cwdLabel.textContent = '工作目录';
  const cwdInput = document.createElement('input');
  cwdInput.value = existingTask ? (existingTask.cwd || '') : (currentRootPath || '');
  cwdInput.placeholder = '留空使用默认目录';
  cwdInput.addEventListener('keydown', (e) => e.stopPropagation());
  form.appendChild(cwdLabel);
  form.appendChild(cwdInput);

  // 完成后操作
  const postActionLabel = document.createElement('label');
  postActionLabel.textContent = '任务完成后操作';
  const postActionSelect = document.createElement('select');
  postActionSelect.innerHTML = `
    <option value="none">无操作</option>
    <option value="lock">锁屏</option>
    <option value="sleep">睡眠</option>
    <option value="hibernate">休眠</option>
    <option value="shutdown">关机（60秒倒计时）</option>
  `;
  if (existingTask && existingTask.postAction) postActionSelect.value = existingTask.postAction;
  form.appendChild(postActionLabel);
  form.appendChild(postActionSelect);

  // 按钮
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'scheduler-form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'scheduler-cancel-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => renderSchedulerList());

  const saveBtn = document.createElement('button');
  saveBtn.className = 'scheduler-save-btn';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const sessionVal = sessionSelect.value;
    if (!sessionVal) { sessionSelect.focus(); return; }
    const instruction = instrInput.value.trim();
    if (!instruction) { instrInput.focus(); return; }

    let sessionData;
    try { sessionData = JSON.parse(sessionVal); } catch { return; }

    const task = {
      id: existingTask ? existingTask.id : `task-${Date.now()}`,
      name,
      claudeSessionId: sessionData.id,
      claudeProjectPath: sessionData.projectPath,
      instruction,
      cwd: cwdInput.value.trim() || sessionData.cwd || '',
      scheduleType: typeSelect.value,
      dailyTime: typeSelect.value === 'daily' ? timeInput.value : undefined,
      intervalHours: typeSelect.value === 'interval' ? parseInt(intervalInput.value) || 4 : undefined,
      onceDateTime: typeSelect.value === 'once' ? onceDateTimeInput.value : undefined,
      cronExpression: typeSelect.value === 'cron' ? cronInput.value.trim() : undefined,
      postAction: postActionSelect.value !== 'none' ? postActionSelect.value : undefined,
      enabled: existingTask ? existingTask.enabled : true,
      lastRunAt: existingTask ? existingTask.lastRunAt : null,
      lastRunStatus: existingTask ? existingTask.lastRunStatus : null,
    };

    await window.termAPI.schedulerSaveTask(task);
    renderSchedulerList();
  });

  actionsDiv.appendChild(cancelBtn);
  actionsDiv.appendChild(saveBtn);
  form.appendChild(actionsDiv);

  schedulerDropdown.appendChild(form);
}

// UI: 日志视图
async function renderSchedulerLogs(task) {
  schedulerDropdown.innerHTML = '';

  // 头部
  const header = document.createElement('div');
  header.className = 'scheduler-header';
  const backBtn = document.createElement('button');
  backBtn.className = 'scheduler-back-btn';
  backBtn.textContent = '← 返回';
  backBtn.addEventListener('click', () => renderSchedulerList());
  const titleSpan = document.createElement('span');
  titleSpan.textContent = `${task.name} - 执行日志`;
  titleSpan.style.marginLeft = '8px';
  titleSpan.style.flex = '1';
  titleSpan.style.overflow = 'hidden';
  titleSpan.style.textOverflow = 'ellipsis';
  titleSpan.style.whiteSpace = 'nowrap';

  const clearBtn = document.createElement('button');
  clearBtn.textContent = '清空';
  clearBtn.addEventListener('click', async () => {
    if (!confirm('确定清空所有日志？')) return;
    await window.termAPI.schedulerClearLogs(task.id);
    renderSchedulerLogs(task);
  });

  header.appendChild(backBtn);
  header.appendChild(titleSpan);
  header.appendChild(clearBtn);
  schedulerDropdown.appendChild(header);

  // 日志列表
  const logs = await window.termAPI.schedulerGetLogs(task.id);
  const listEl = document.createElement('div');
  listEl.className = 'scheduler-log-list';

  if (logs.length === 0) {
    listEl.innerHTML = '<div class="scheduler-empty">暂无执行日志</div>';
  } else {
    for (const log of logs) {
      const entry = document.createElement('div');
      entry.className = 'scheduler-log-entry';

      const timeEl = document.createElement('span');
      timeEl.className = 'scheduler-log-time';
      timeEl.textContent = log.startedAt ? formatTime(log.startedAt) : '-';

      const statusEl = document.createElement('span');
      statusEl.className = 'scheduler-log-status scheduler-task-status ' + (log.status || '');
      const statusText = { success: '成功', failed: '失败', running: '运行中' };
      statusEl.textContent = statusText[log.status] || log.status || '-';

      const summaryEl = document.createElement('span');
      summaryEl.className = 'scheduler-log-summary';
      summaryEl.textContent = log.summary ? log.summary.slice(0, 200) : '-';
      summaryEl.title = log.summary || '';

      entry.appendChild(timeEl);
      entry.appendChild(statusEl);
      entry.appendChild(summaryEl);
      listEl.appendChild(entry);
    }
  }

  schedulerDropdown.appendChild(listEl);
}

// 按钮绑定
document.getElementById('btn-scheduler').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSchedulerDropdown();
});

// 点击外部关闭定时任务下拉
document.addEventListener('click', (e) => {
  if (!schedulerDropdown.classList.contains('hidden') && document.contains(e.target) && !e.target.closest('#scheduler-wrapper')) {
    schedulerDropdown.classList.add('hidden');
  }
});

// ============ Ctrl+滚轮调整字体大小 ============
container.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  applyTerminalAppearance({ fontSize: globalFontSize + delta });
}, { passive: false });

// ============ 初始化 ============
(async function init() {
  applyTerminalAppearance({ persist: false });

  // 尝试恢复上次布局
  let layoutRestored = false;
  try {
    const layout = await window.termAPI.loadLayout();
    if (layout) {
      // 恢复主题
      if (layout.theme && THEMES[layout.theme]) {
        applyTheme(layout.theme, { persist: false });
      }
      if (typeof layout.terminalFontFamily === 'string' || typeof layout.terminalFontSize === 'number') {
        const restoredFontFamily = typeof layout.terminalFontFamily === 'string'
          ? (layout.terminalFontFamily === LEGACY_YAHEI_DEFAULT_FONT_FAMILY ? DEFAULT_TERMINAL_FONT_FAMILY : layout.terminalFontFamily)
          : globalFontFamily;
        applyTerminalAppearance({
          fontFamily: restoredFontFamily,
          fontSize: typeof layout.terminalFontSize === 'number' ? layout.terminalFontSize : globalFontSize,
          persist: false,
        });
      }
      if (Array.isArray(layout.tabs) && layout.tabs.length > 0) {
        for (let i = 0; i < layout.tabs.length; i++) {
          const tabLayout = layout.tabs[i];
          const tabId = i === 0 ? createTab(tabLayout.name || '默认') : createTab(tabLayout.name || `标签 ${i + 1}`);

          // 兼容旧格式（count+cwd）和新格式（panes[]）
          const panes = tabLayout.panes || Array.from({ length: Math.min(Math.max(tabLayout.count || 1, 1), 6) }, () => ({ cwd: tabLayout.cwd || null }));

          for (const pane of panes) {
            const restoredHistoryProvider = pane.historyProvider
              || (pane.claudeSessionId ? 'claude' : null)
              || (pane.codexSessionId ? 'codex' : null);
            const restoredHistoryName = pane.name || pane.codexThreadName || null;
            const sid = await createSession(tabId, {
              cwd: pane.cwd || null,
              historyProvider: restoredHistoryProvider,
              claudeSessionId: pane.claudeSessionId || null,
              claudeProjectPath: pane.claudeProjectPath || null,
              claudeName: restoredHistoryProvider === 'claude' ? (pane.name || null) : null,
              codexSessionId: pane.codexSessionId || null,
              codexThreadName: pane.codexThreadName || null,
              historyName: restoredHistoryName,
            });
            // 如果有关联的历史会话，自动 resume
            if (sid && restoredHistoryProvider === 'claude' && pane.claudeSessionId) {
              setTimeout(() => {
                window.termAPI.write({ id: sid, data: `claude --resume ${pane.claudeSessionId}\r` });
              }, 800);
            }
            if (sid && restoredHistoryProvider === 'codex' && pane.codexSessionId) {
              setTimeout(() => {
                window.termAPI.write({ id: sid, data: `codex resume ${pane.codexSessionId}\r` });
              }, 800);
            }
          }
        }
        layoutRestored = true;
      }
    }
  } catch { /* ignore, fall through to default */ }

  if (!layoutRestored) {
    createTab('默认');
  }

  // 恢复上次打开的文件夹
  const lastFolder = await window.termAPI.getLastFolder();
  if (lastFolder) {
    try {
      await openFolderByPath(lastFolder);
    } catch { /* ignore */ }
  }
})();

// 窗口关闭前保存布局
window.addEventListener('beforeunload', () => {
  persistLayout();
});

// ============ 自动更新 ============
(function initUpdater() {
  if (!window.termAPI.onUpdaterEvent) return;

  // 创建更新通知条
  const updateBar = document.createElement('div');
  updateBar.id = 'update-bar';
  updateBar.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1a3a5c;color:#a0d4ff;padding:8px 16px;font-size:13px;display:none;align-items:center;gap:10px;';
  document.body.appendChild(updateBar);

  let downloadStarted = false; // kept for compatibility, unused

  function showBar(html, buttons = []) {
    updateBar.innerHTML = `<span style="flex:1">${html}</span>`;
    buttons.forEach(({ label, primary, onClick }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `padding:3px 12px;border-radius:4px;border:none;cursor:pointer;font-size:12px;${primary ? 'background:#0099ee;color:#fff;' : 'background:#2a4a6c;color:#a0d4ff;'}`;
      btn.addEventListener('click', onClick);
      updateBar.appendChild(btn);
    });
    updateBar.style.display = 'flex';
  }

  function hideBar() {
    updateBar.style.display = 'none';
  }

  window.termAPI.onUpdaterEvent((event, data) => {
    switch (event) {
      case 'checking':
        showBar('正在检查更新...');
        break;
      case 'update-available':
        // 静默后台下载，不打扰用户
        break;
      case 'update-not-available':
        showBar('当前已是最新版本');
        setTimeout(hideBar, 3000);
        break;
      case 'download-progress': {
        const pct = data.percent || 0;
        let speedStr = '';
        if (data.bytesPerSecond > 0) {
          const bps = data.bytesPerSecond;
          speedStr = bps >= 1024 * 1024
            ? ` · ${(bps / 1024 / 1024).toFixed(1)} MB/s`
            : ` · ${(bps / 1024).toFixed(0)} KB/s`;
        }
        let etaStr = '';
        if (data.bytesPerSecond > 0 && data.total > 0 && data.transferred < data.total) {
          const remaining = Math.ceil((data.total - data.transferred) / data.bytesPerSecond);
          etaStr = remaining >= 60
            ? ` · 剩余 ${Math.ceil(remaining / 60)} 分钟`
            : ` · 剩余 ${remaining} 秒`;
        }
        showBar(`正在后台下载更新... ${pct}%${speedStr}${etaStr}`);
        break;
      }
      case 'update-downloaded':
        showBar(`新版本 <strong>v${data.version}</strong> 已下载完成，重启后生效`, [
          { label: '立即重启安装', primary: true, onClick: () => {
            window.termAPI.updaterClearPending && window.termAPI.updaterClearPending();
            window.termAPI.updaterInstallUpdate();
          }},
          { label: '稍后', onClick: hideBar },
        ]);
        break;
      case 'pending-install':
        // 上次已下载完成，本次启动时提示
        showBar(`新版本 <strong>v${data.version}</strong> 已就绪，是否立即安装？`, [
          { label: '立即安装', primary: true, onClick: () => {
            window.termAPI.updaterClearPending && window.termAPI.updaterClearPending();
            window.termAPI.updaterInstallUpdate();
          }},
          { label: '稍后', onClick: () => {
            window.termAPI.updaterClearPending && window.termAPI.updaterClearPending();
            hideBar();
          }},
        ]);
        break;
      case 'error':
        showBar(`更新检查失败：${data.message}`);
        setTimeout(hideBar, 5000);
        break;
    }
  });

  // 更新日志数据
  const CHANGELOG = [
    {
      version: '1.6.0',
      date: '2026-03-30',
      notes: [
        '新增：统一“对话历史”，支持在同一列表中查看 Claude 与 Codex 会话，并显示来源标识',
        '新增：Codex 历史会话支持收藏、重命名、删除，并支持布局恢复后自动续接',
        '新增：终端支持 Ctrl+Enter 换行，外部文件拖拽到窗口后自动粘贴绝对路径',
        '优化：常用设置集中管理字体与更新，移除重复入口',
        '优化：默认终端字体改为 Consolas 优先，微软雅黑仅作中文回退，整体显示更紧凑',
      ],
    },
    {
      version: '1.5.1',
      date: '2026-03-20',
      notes: [
        '新增：README 提供国内加速下载链接（ghproxy / 99988866 双通道）',
        '优化：CI 发版后自动更新 README 中的下载链接版本号',
      ],
    },
    {
      version: '1.4.2',
      date: '2026-03-16',
      notes: [
        '优化：自动更新使用国内镜像加速下载，镜像失败自动回退 GitHub 直连',
      ],
    },
    {
      version: '1.4.1',
      date: '2026-03-16',
      notes: [
        '修复：Shift+Enter 换行不准，彻底阻止事件冒泡避免重复回车',
        '修复：关闭会话或切换标签页后无法输入中文（IME 焦点丢失）',
      ],
    },
    {
      version: '1.4.0',
      date: '2026-03-16',
      notes: [
        '新增：Shift+Enter 换行（与 Alt+Enter 一致）',
        '新增：面板拖拽排序，拖拽标题栏交换同标签页内面板位置',
        '新增：面板跨标签页拖拽，拖拽标题栏到其他标签页可移动面板',
        '新增：主题记忆，切换主题后下次启动自动恢复',
        '新增：定时任务支持 cron 表达式',
        '修复：定时任务成功后状态误判为失败',
        '优化：定时任务完成后自动关闭终端会话',
      ],
    },
    {
      version: '1.3.2',
      date: '2026-03-09',
      notes: [
        '优化：文件树图标区分格式，Office 文件使用 SVG 彩色图标，其他格式使用语义化 emoji',
      ],
    },
    {
      version: '1.3.1',
      date: '2026-03-07',
      notes: [
        '修复：版本号修正，确保自动更新可正常触发',
      ],
    },
    {
      version: '1.3.0',
      date: '2026-03-07',
      notes: [
        '新增：布局持久化，关闭时保存每个分屏的工作目录和 Claude 会话关联',
        '新增：启动时自动恢复布局，并自动续接上次的 Claude 历史会话',
      ],
    },
    {
      version: '1.2.2',
      date: '2026-03-06',
      notes: [
        '修复：GitHub Actions CI 构建环境兼容性问题（Python 3.12 distutils）',
      ],
    },
    {
      version: '1.2.1',
      date: '2026-03-06',
      notes: [
        '新增：macOS 版本支持，提供 DMG 安装包（x64 / arm64）',
        '优化：GitHub Actions 自动构建，推送 tag 即可同时发布 Windows 和 macOS 版本',
      ],
    },
    {
      version: '1.2.0',
      date: '2026-03-06',
      notes: [
        '新增：软件内置更新日志，点击"更新"按钮可查看版本历史',
        '优化：自动更新流程，修复 latest.yml 文件名兼容问题',
      ],
    },
    {
      version: '1.1.0',
      date: '2026-03-05',
      notes: [
        '新增：自动更新功能，启动后自动检查新版本，发现更新底部弹出提示',
        '新增：工具栏"更新"按钮，支持手动检查更新',
        '新增：终端输出中的 Windows 路径支持点击直接打开文件/文件夹',
        '新增：新建会话时展示所选项目文件夹下的 Claude 历史会话，可选择续接',
        '优化：Claude 历史下拉列表按时间倒序排列，置顶会话优先显示',
        '修复：对话框内容过长时无法滚动到底部的问题',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-02-01',
      notes: [
        '初始版本发布',
        '支持多标签页、多分屏终端管理',
        '集成 Claude 历史会话管理（查看、重命名、置顶、删除）',
        '内置文件浏览器，支持新建/重命名/删除/粘贴文件',
        '定时任务调度（每日/间隔/一次性），支持任务完成后关机/锁屏',
        '支持亮色/暗色主题切换，Ctrl+滚轮调整字体大小',
      ],
    },
  ];

  // 创建更新日志弹窗
  const changelogModal = document.createElement('div');
  changelogModal.id = 'changelog-modal';
  changelogModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;';
  changelogModal.innerHTML = `
    <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
        <span style="color:var(--text-primary);font-size:14px;font-weight:600;">版本更新说明</span>
        <button id="changelog-close" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
      <div id="changelog-body" style="overflow-y:auto;padding:16px 18px;flex:1;"></div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
        <button id="changelog-check-update" style="padding:5px 16px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">检查更新</button>
        <button id="changelog-close-btn" style="padding:5px 16px;background:var(--bg-active);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:13px;">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(changelogModal);

  // 渲染日志内容
  const changelogBody = changelogModal.querySelector('#changelog-body');
  CHANGELOG.forEach(({ version, date, notes }) => {
    const block = document.createElement('div');
    block.style.cssText = 'margin-bottom:18px;';
    block.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;">
        <span style="color:var(--accent);font-size:14px;font-weight:700;">v${version}</span>
        <span style="color:var(--text-secondary);font-size:12px;">${date}</span>
      </div>
      <ul style="margin:0;padding-left:18px;color:var(--text-primary);font-size:13px;line-height:1.8;">
        ${notes.map(n => `<li>${n}</li>`).join('')}
      </ul>`;
    changelogBody.appendChild(block);
  });

  function showChangelog() {
    changelogModal.style.display = 'flex';
  }
  showUpdaterChangelog = showChangelog;
  function hideChangelog() {
    changelogModal.style.display = 'none';
  }

  changelogModal.querySelector('#changelog-close').addEventListener('click', hideChangelog);
  changelogModal.querySelector('#changelog-close-btn').addEventListener('click', hideChangelog);
  changelogModal.addEventListener('click', (e) => { if (e.target === changelogModal) hideChangelog(); });
  changelogModal.querySelector('#changelog-check-update').addEventListener('click', () => {
    hideChangelog();
    window.termAPI.updaterCheckForUpdates();
  });
})();
