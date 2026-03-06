const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebglAddon } = require('@xterm/addon-webgl');

// ============ 主题定义 ============
const THEMES = {
  dark: {
    background: '#0a0e17',
    foreground: '#a0b0c0',
    cursor: '#00d4ff',
    cursorAccent: '#0a0e17',
    selectionBackground: '#00d4ff33',
    black: '#1a2332',
    red: '#e0355f',
    green: '#00c87a',
    yellow: '#e0b800',
    blue: '#0099ee',
    magenta: '#b85ee0',
    cyan: '#00c8b0',
    white: '#a0b0c0',
    brightBlack: '#3a4f6a',
    brightRed: '#e05070',
    brightGreen: '#20d090',
    brightYellow: '#e0c830',
    brightBlue: '#30aaee',
    brightMagenta: '#c070e0',
    brightCyan: '#20d0b8',
    brightWhite: '#c0ccd8',
  },
  light: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    cursorAccent: '#eff1f5',
    selectionBackground: '#7287fd44',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#ea76cb',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#d20f39',
    brightGreen: '#40a02b',
    brightYellow: '#df8e1d',
    brightBlue: '#1e66f5',
    brightMagenta: '#ea76cb',
    brightCyan: '#179299',
    brightWhite: '#bcc0cc',
  },
};

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

// ============ 项目选择对话框管理 ============
const projectDialog = document.getElementById('project-dialog');
const recentProjectsList = document.getElementById('recent-projects-list');
const projectPathInput = document.getElementById('project-path-input');
const projectDialogConfirm = document.getElementById('project-dialog-confirm');
const projectDialogCancel = document.getElementById('project-dialog-cancel');
const projectDialogClose = document.getElementById('project-dialog-close');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const projectClaudeSection = document.getElementById('project-claude-section');
const projectClaudeList = document.getElementById('project-claude-list');

let selectedProjectPath = null;
let selectedClaudeSession = null; // { id, projectPath, cwd, summary, customName }
let pendingSessionOpts = null;
let isConfirming = false;  // 防止重复点击
let claudeLoadTimer = null; // 防抖定时器

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

function showProjectDialog(sessionOpts = {}) {
  pendingSessionOpts = sessionOpts;
  selectedProjectPath = null;
  selectedClaudeSession = null;
  projectPathInput.value = '';
  projectDialogConfirm.disabled = true;
  projectClaudeSection.style.display = 'none';
  projectClaudeList.innerHTML = '';

  renderRecentProjects();

  projectDialog.classList.remove('hidden');
  setTimeout(() => projectPathInput.focus(), 100);
}

function hideProjectDialog() {
  projectDialog.classList.add('hidden');
  pendingSessionOpts = null;
  selectedProjectPath = null;
  selectedClaudeSession = null;
  if (claudeLoadTimer) { clearTimeout(claudeLoadTimer); claudeLoadTimer = null; }
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
      scheduleLoadClaudeSessions(project.path);
    });

    recentProjectsList.appendChild(item);
  });
}

// 防抖加载 Claude 历史会话
function scheduleLoadClaudeSessions(folderPath) {
  if (claudeLoadTimer) clearTimeout(claudeLoadTimer);
  claudeLoadTimer = setTimeout(() => loadClaudeSessionsForPath(folderPath), 300);
}

async function loadClaudeSessionsForPath(folderPath) {
  selectedClaudeSession = null;
  projectClaudeSection.style.display = 'block';
  projectClaudeList.innerHTML = '<div class="project-claude-loading">加载中...</div>';

  let sessions = [];
  try {
    sessions = await window.termAPI.listClaudeSessions({ rootPath: folderPath });
  } catch {
    projectClaudeList.innerHTML = '<div class="project-claude-empty">加载失败</div>';
    return;
  }

  projectClaudeList.innerHTML = '';

  if (sessions.length === 0) {
    projectClaudeList.innerHTML = '<div class="project-claude-empty">该项目暂无 Claude 历史会话</div>';
    return;
  }

  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'project-claude-item';
    const displayName = s.customName || (s.summary ? s.summary.slice(0, 60) : '(空会话)');
    const timeStr = s.lastActive ? formatTime(s.lastActive) : '';
    item.innerHTML = `
      <span class="project-claude-item-icon">🤖</span>
      <div class="project-claude-item-info">
        <div class="project-claude-item-name" title="${displayName}">${displayName}</div>
        <div class="project-claude-item-meta">${timeStr}</div>
      </div>
      <span class="project-claude-item-check">✓</span>
    `;
    item.addEventListener('click', () => {
      selectedClaudeSession = s;
      projectClaudeList.querySelectorAll('.project-claude-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
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

    const cs = selectedClaudeSession;
    if (cs) {
      // 选择了历史会话：直接 resume
      const claudeName = cs.customName || (cs.summary ? cs.summary.slice(0, 50) : null);
      const sessionId = await createSession(null, {
        ...pendingSessionOpts,
        cwd: cs.cwd || path,
        claudeSessionId: cs.id,
        claudeProjectPath: cs.projectPath,
        claudeName,
      });
      hideProjectDialog();
      if (sessionId) {
        setTimeout(() => {
          window.termAPI.write({ id: sessionId, data: `claude --resume ${cs.id}\r` });
        }, 500);
      }
    } else {
      // 未选历史会话：新建 claude 会话
      const sessionId = await createSession(null, {
        ...pendingSessionOpts,
        cwd: path,
      });
      hideProjectDialog();
      if (sessionId) {
        setTimeout(() => {
          window.termAPI.write({ id: sessionId, data: 'claude\r' });
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
    scheduleLoadClaudeSessions(folderPath);
  }
});

// 输入框变化时更新选中状态
projectPathInput.addEventListener('input', () => {
  const path = projectPathInput.value.trim();
  selectedProjectPath = path;
  projectDialogConfirm.disabled = !path;
  recentProjectsList.querySelectorAll('.project-item').forEach(el => el.classList.remove('selected'));
  if (path) {
    scheduleLoadClaudeSessions(path);
  } else {
    projectClaudeSection.style.display = 'none';
    selectedClaudeSession = null;
  }
});

// 点击遮罩层关闭
projectDialog.querySelector('.dialog-overlay').addEventListener('click', hideProjectDialog);

// ESC 键关闭对话框
document.addEventListener('keydown', (e) => {
  if (!projectDialog.classList.contains('hidden') && e.key === 'Escape') {
    hideProjectDialog();
  }
});

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
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const [id, tab] of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (id === activeTabId ? ' active' : '');
    el.innerHTML = `<span title="双击重命名">${tab.name} (${tab.sessions.length})</span>`;
    el.querySelector('span').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startTabInlineRename(id);
    });
    el.addEventListener('click', () => switchTab(id));

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
    fontFamily: "'Cascadia Code', 'Consolas', monospace",
    theme: THEMES[currentTheme],
    cursorBlink: true,
    allowProposedApi: true,
  });

  // Ctrl+C 有选中文本时复制，否则发送 SIGINT；Ctrl+V 粘贴
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    // 跳过 IME 输入法组合状态，避免干扰中文输入
    if (e.isComposing || e.keyCode === 229) return true;
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

  const wrapper = document.createElement('div');
  wrapper.className = 'xterm-wrapper';

  pane.appendChild(header);
  pane.appendChild(wrapper);

  const displayName = opts.claudeName || name;
  const session = { 
    tabId, 
    term, 
    fitAddon, 
    name: displayName, 
    element: pane, 
    ptyId: sessionId, 
    outputBuffer: '', 
    createdAt: new Date().toISOString(), 
    claudeSessionId: opts.claudeSessionId || null, 
    claudeProjectPath: opts.claudeProjectPath || null,
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

  // 尝试 WebGL 加速
  try {
    const webgl = new WebglAddon();
    term.loadAddon(webgl);
  } catch (e) {
    console.warn('WebGL addon failed, using canvas renderer');
  }

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
        const cached = claudeSessionsCache.find(s => s.id === claudeId);
        session.claudeSessionId = claudeId;
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
      } else if (!session.claudeSessionId && /^claude(\s+|$)/.test(trimmed) && !/^claude\s+(auth|doctor|install|mcp|plugin|setup-token|update)\b/.test(trimmed)) {
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

  // 接收文件树拖拽
  pane.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    pane.classList.add('drag-over');
  });
  pane.addEventListener('dragleave', () => {
    pane.classList.remove('drag-over');
  });
  pane.addEventListener('drop', (e) => {
    e.preventDefault();
    pane.classList.remove('drag-over');
    const droppedPath = e.dataTransfer.getData('text/plain');
    if (droppedPath && !session.isHistory) {
      // 路径含空格时加引号
      const safePath = droppedPath.includes(' ') ? `"${droppedPath}"` : droppedPath;
      window.termAPI.write({ id: sessionId, data: safePath });
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
    setTimeout(() => {
      const xtermTextarea = wrapper.querySelector('.xterm-helper-textarea');
      if (xtermTextarea) xtermTextarea.focus();
    }, 50);
  });

  return sessionId;
}

async function destroySession(sessionId, skipRender) {
  const session = allSessions.get(sessionId);
  if (!session) return;

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
    // 聚焦剩余面板
    if (tab && tab.focusedSession) {
      const s = allSessions.get(tab.focusedSession);
      if (s) s.term.focus();
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
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = currentTheme === 'light' ? 'light' : '';
  // 更新所有终端主题
  for (const [, session] of allSessions) {
    session.term.options.theme = THEMES[currentTheme];
  }
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
          const cached = claudeSessionsCache.find(s => s.id === session.claudeSessionId);
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
      case 'L': // Claude 会话
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
document.getElementById('btn-theme').addEventListener('click', toggleTheme);
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
        session.term.focus();
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

function createFileNode(parentEl, entry, level) {
  const fileRow = document.createElement('div');
  fileRow.className = 'tree-item';
  fileRow.style.paddingLeft = (level * 16 + 24) + 'px';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📄';

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
    // 尝试找到对应文件夹的 children 容器
    const allItems = fileTreeEl.querySelectorAll('.tree-item');
    for (const item of allItems) {
      const nameEl = item.querySelector('.tree-name');
      if (nameEl && item.nextElementSibling && item.nextElementSibling.classList.contains('tree-folder-children')) {
        // 检查路径匹配（通过 contextmenu 传入的 parentDir）
        targetContainer = item.nextElementSibling;
        // 确保展开
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
  // 找到对应的 tree-item 元素
  const allItems = fileTreeEl.querySelectorAll('.tree-item');
  const itemName = itemPath.split('\\').pop() || itemPath.split('/').pop();
  const parentDir = itemPath.substring(0, itemPath.length - itemName.length - 1);

  for (const row of allItems) {
    const nameEl = row.querySelector('.tree-name');
    if (!nameEl || nameEl.textContent !== itemName) continue;

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
    break;
  }
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

// ============ Claude 会话管理 UI ============
const claudeDropdown = document.getElementById('claude-dropdown');
let claudeSessionsCache = [];

function toggleClaudeDropdown() {
  if (claudeDropdown.classList.contains('hidden')) {
    showClaudeDropdown();
  } else {
    claudeDropdown.classList.add('hidden');
  }
}

async function showClaudeDropdown() {
  claudeDropdown.innerHTML = '';

  if (!currentRootPath) {
    claudeDropdown.innerHTML = '<div class="claude-empty">请先打开一个文件夹</div>';
    claudeDropdown.classList.remove('hidden');
    return;
  }

  claudeSessionsCache = await window.termAPI.listClaudeSessions({ rootPath: currentRootPath });
  // 置顶优先，置顶内部 + 非置顶均按时间倒序
  claudeSessionsCache.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActive.localeCompare(a.lastActive);
  });
  claudeDropdown.innerHTML = '';

  // 头部
  const header = document.createElement('div');
  header.className = 'claude-header';
  header.innerHTML = `<span>Claude 会话 (${claudeSessionsCache.length})</span>`;
  claudeDropdown.appendChild(header);

  // 搜索框
  const searchInput = document.createElement('input');
  searchInput.className = 'claude-search-input';
  searchInput.placeholder = '搜索会话...';
  searchInput.addEventListener('input', () => {
    renderClaudeList(listEl, searchInput.value.trim().toLowerCase());
  });
  searchInput.addEventListener('keydown', (e) => e.stopPropagation());
  claudeDropdown.appendChild(searchInput);

  // 列表容器
  const listEl = document.createElement('div');
  listEl.className = 'claude-list';
  claudeDropdown.appendChild(listEl);

  renderClaudeList(listEl, '');
  claudeDropdown.classList.remove('hidden');

  // 聚焦搜索框
  requestAnimationFrame(() => searchInput.focus());
}

function renderClaudeList(listEl, filter) {
  listEl.innerHTML = '';

  const filtered = filter
    ? claudeSessionsCache.filter(s =>
        (s.customName && s.customName.toLowerCase().includes(filter)) ||
        s.summary.toLowerCase().includes(filter) ||
        s.projectName.toLowerCase().includes(filter) ||
        s.id.toLowerCase().includes(filter))
    : claudeSessionsCache;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="claude-empty">${filter ? '无匹配结果' : '未找到 Claude 会话'}</div>`;
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

    // 项目 + 时间
    const meta = document.createElement('div');
    meta.className = 'claude-session-meta';
    meta.textContent = `${session.projectName} | ${formatTime(session.lastActive)}`;
    meta.title = session.projectName;

    info.appendChild(nameEl);
    info.appendChild(meta);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'claude-session-actions';

    // 置顶按钮
    const pinBtn = document.createElement('button');
    pinBtn.className = 'claude-pin-btn' + (session.pinned ? ' pinned' : '');
    pinBtn.textContent = session.pinned ? '★' : '☆';
    pinBtn.title = session.pinned ? '取消置顶' : '置顶';
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newPinned = !session.pinned;
      await window.termAPI.pinClaudeSession({
        projectPath: session.projectPath,
        sessionId: session.id,
        pinned: newPinned,
      });
      session.pinned = newPinned;
      // 重新排序并渲染
      claudeSessionsCache.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.lastActive.localeCompare(a.lastActive);
      });
      const searchInput = claudeDropdown.querySelector('.claude-search-input');
      const filter = searchInput ? searchInput.value.trim().toLowerCase() : '';
      renderClaudeList(listEl, filter);
    });

    // 重命名按钮
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎';
    renameBtn.title = '重命名';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startClaudeSessionRename(session, nameEl);
    });

    // 复制 ID 按钮
    const copyIdBtn = document.createElement('button');
    copyIdBtn.textContent = '⎘';
    copyIdBtn.title = '复制 claude -r 命令';
    copyIdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(`claude -r ${session.id}`).then(() => {
        copyIdBtn.textContent = '✓';
        setTimeout(() => { copyIdBtn.textContent = '⎘'; }, 1500);
      });
    });

    // 删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = '删除会话';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除此会话？')) return;
      await window.termAPI.deleteClaudeSession({ projectPath: session.projectPath, sessionId: session.id });
      claudeSessionsCache = claudeSessionsCache.filter(s => s.id !== session.id);
      const searchInput = claudeDropdown.querySelector('.claude-search-input');
      const filter = searchInput ? searchInput.value.trim().toLowerCase() : '';
      renderClaudeList(listEl, filter);
    });

    actions.appendChild(pinBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(copyIdBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(info);
    row.appendChild(actions);

    // 点击整行 → 创建新终端并执行 resume（cwd 设为会话原始目录）
    row.addEventListener('click', async () => {
      claudeDropdown.classList.add('hidden');
      const claudeName = session.customName || (session.summary ? session.summary.slice(0, 50) : null);
      const newSessionId = await createSession(null, {
        cwd: session.cwd || undefined,
        claudeSessionId: session.id,
        claudeProjectPath: session.projectPath,
        claudeName,
      });
      if (!newSessionId) return;
      setTimeout(() => {
        window.termAPI.write({ id: newSessionId, data: `claude --resume ${session.id}\r` });
      }, 300);
    });

    listEl.appendChild(row);
  }
}

function startClaudeSessionRename(session, nameEl) {
  if (nameEl.querySelector('.claude-inline-rename')) return;

  const currentName = session.customName || '';
  const input = document.createElement('input');
  input.className = 'claude-inline-rename';
  input.value = currentName;
  input.placeholder = '输入会话名称';

  const commit = async () => {
    const newName = input.value.trim();
    await window.termAPI.renameClaudeSession({
      projectPath: session.projectPath,
      sessionId: session.id,
      name: newName,
    });
    session.customName = newName || null;
    // 更新显示
    if (newName) {
      nameEl.className = 'claude-session-name';
      nameEl.textContent = newName;
    } else {
      nameEl.className = 'claude-session-summary';
      nameEl.textContent = session.summary ? session.summary.slice(0, 50) : '(空会话)';
    }
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
      if (!s) { resolve('exited'); return; }

      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) { resolve('timeout'); return; }

      const currentLen = (s.outputBuffer || '').length;
      if (currentLen !== lastBufferLen) {
        lastBufferLen = currentLen;
        stableStart = Date.now();
      } else if ((Date.now() - stableStart) >= 30000) {
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

    // 7. 收集输出摘要
    const s = allSessions.get(sessionId);
    if (s) {
      const plain = stripAnsi(s.outputBuffer || '');
      summary = plain.slice(-500).trim();
    }

    log('Result: ' + result);

    status = result === 'exited' ? 'failed' : 'success';
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

  // 任务完成后，将焦点交回给终端，让用户可以继续输入
  if (finishedSessionId && allSessions.has(finishedSessionId)) {
    focusSession(finishedSessionId);
  }
}

// 注册执行引擎：主进程调度 + 立即运行按钮
window.termAPI.onSchedulerExecute(executeSchedulerTask);
window._schedulerExecuteHandler = executeSchedulerTask;

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
  typeSelect.innerHTML = '<option value="daily">每天定时</option><option value="interval">固定间隔</option><option value="once">一次性执行</option>';
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

  const updateParamVisibility = () => {
    if (typeSelect.value === 'daily') {
      timeInput.style.display = '';
      intervalInput.style.display = 'none';
      onceDateTimeInput.style.display = 'none';
      paramLabel.textContent = '执行时间';
    } else if (typeSelect.value === 'interval') {
      timeInput.style.display = 'none';
      intervalInput.style.display = '';
      onceDateTimeInput.style.display = 'none';
      paramLabel.textContent = '间隔(小时)';
    } else if (typeSelect.value === 'once') {
      timeInput.style.display = 'none';
      intervalInput.style.display = 'none';
      onceDateTimeInput.style.display = '';
      paramLabel.textContent = '执行时间';
    }
  };
  typeSelect.addEventListener('change', updateParamVisibility);
  updateParamVisibility();

  paramDiv.appendChild(paramLabel);
  paramDiv.appendChild(timeInput);
  paramDiv.appendChild(intervalInput);
  paramDiv.appendChild(onceDateTimeInput);

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
let globalFontSize = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

container.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  globalFontSize = Math.min(Math.max(globalFontSize + delta, MIN_FONT_SIZE), MAX_FONT_SIZE);
  for (const [, session] of allSessions) {
    session.term.options.fontSize = globalFontSize;
  }
  fitAllSessions();
}, { passive: false });

// ============ 初始化 ============
(async function init() {
  const tabId = createTab('默认');

  // 恢复上次打开的文件夹
  const lastFolder = await window.termAPI.getLastFolder();
  if (lastFolder) {
    try {
      await openFolderByPath(lastFolder);
    } catch { /* ignore */ }
  }
})();

// ============ 自动更新 ============
(function initUpdater() {
  if (!window.termAPI.onUpdaterEvent) return;

  // 创建更新通知条
  const updateBar = document.createElement('div');
  updateBar.id = 'update-bar';
  updateBar.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#1a3a5c;color:#a0d4ff;padding:8px 16px;font-size:13px;display:none;align-items:center;gap:10px;';
  document.body.appendChild(updateBar);

  let downloadStarted = false;

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
        showBar(`发现新版本 <strong>v${data.version}</strong>，是否下载？`, [
          { label: '立即下载', primary: true, onClick: () => {
            downloadStarted = true;
            window.termAPI.updaterDownloadUpdate();
            showBar('正在下载更新... 0%');
          }},
          { label: '忽略', onClick: hideBar },
        ]);
        break;
      case 'update-not-available':
        showBar('当前已是最新版本');
        setTimeout(hideBar, 3000);
        break;
      case 'download-progress':
        if (downloadStarted) showBar(`正在下载更新... ${data.percent}%`);
        break;
      case 'update-downloaded':
        showBar('更新已下载完成，重启后生效', [
          { label: '立即重启安装', primary: true, onClick: () => window.termAPI.updaterInstallUpdate() },
          { label: '稍后', onClick: hideBar },
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
    <div style="background:#0f1923;border:1px solid #1e3a5a;border-radius:8px;width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #1e3a5a;">
        <span style="color:#a0d4ff;font-size:14px;font-weight:600;">版本更新说明</span>
        <button id="changelog-close" style="background:none;border:none;color:#607080;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
      <div id="changelog-body" style="overflow-y:auto;padding:16px 18px;flex:1;"></div>
      <div style="padding:12px 18px;border-top:1px solid #1e3a5a;display:flex;justify-content:flex-end;gap:8px;">
        <button id="changelog-check-update" style="padding:5px 16px;background:#0099ee;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">检查更新</button>
        <button id="changelog-close-btn" style="padding:5px 16px;background:#1e3a5a;color:#a0d4ff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">关闭</button>
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
        <span style="color:#00c8b0;font-size:14px;font-weight:700;">v${version}</span>
        <span style="color:#405060;font-size:12px;">${date}</span>
      </div>
      <ul style="margin:0;padding-left:18px;color:#8090a0;font-size:13px;line-height:1.8;">
        ${notes.map(n => `<li>${n}</li>`).join('')}
      </ul>`;
    changelogBody.appendChild(block);
  });

  function showChangelog() {
    changelogModal.style.display = 'flex';
  }
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

  // 工具栏加"更新"按钮
  const toolbarActions = document.getElementById('toolbar-actions');
  if (toolbarActions) {
    const btnUpdate = document.createElement('button');
    btnUpdate.id = 'btn-check-update';
    btnUpdate.title = '版本更新说明';
    btnUpdate.textContent = '⬆ 更新';
    btnUpdate.addEventListener('click', showChangelog);
    toolbarActions.appendChild(btnUpdate);
  }
})();
