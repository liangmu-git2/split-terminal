const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('termAPI', {
  createSession: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (opts) => ipcRenderer.send('pty:write', opts),
  resize: (opts) => ipcRenderer.send('pty:resize', opts),
  kill: (opts) => ipcRenderer.send('pty:kill', opts),
  onData: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },
  onExit: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },
  // 历史记录 API
  saveHistory: (record) => ipcRenderer.invoke('history:save', record),
  updateHistory: (id, record) => ipcRenderer.invoke('history:update', { id, record }),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getHistory: (id) => ipcRenderer.invoke('history:get', id),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  // 文件系统 API
  openFolderDialog: () => ipcRenderer.invoke('fs:openFolder'),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  createFile: (filePath) => ipcRenderer.invoke('fs:createFile', filePath),
  createFolder: (dirPath) => ipcRenderer.invoke('fs:createFolder', dirPath),
  showInExplorer: (filePath) => ipcRenderer.invoke('fs:showInExplorer', filePath),
  openFile: (filePath) => ipcRenderer.invoke('fs:openFile', filePath),
  watchDir: (dirPath) => ipcRenderer.invoke('fs:watch', dirPath),
  unwatchDir: () => ipcRenderer.invoke('fs:unwatch'),
  onFsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('fs:changed', listener);
    return () => ipcRenderer.removeListener('fs:changed', listener);
  },
  rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
  delete: (targetPath, isDirectory) => ipcRenderer.invoke('fs:delete', { targetPath, isDirectory }),
  pasteFiles: (targetDir) => ipcRenderer.invoke('fs:pasteFiles', { targetDir }),
  // 路径验证 API
  validatePath: (path) => ipcRenderer.invoke('fs:validatePath', path),
  // 最近文件夹 API
  getRecentFolders: () => ipcRenderer.invoke('recentFolders:get'),
  saveRecentFolders: (list) => ipcRenderer.invoke('recentFolders:save', list),
  getLastFolder: () => ipcRenderer.invoke('lastFolder:get'),
  saveLastFolder: (folderPath) => ipcRenderer.invoke('lastFolder:save', folderPath),
  // Claude 会话 API
  listClaudeSessions: (opts) => ipcRenderer.invoke('claude:listSessions', opts),
  renameClaudeSession: (opts) => ipcRenderer.invoke('claude:renameSession', opts),
  pinClaudeSession: (opts) => ipcRenderer.invoke('claude:pinSession', opts),
  deleteClaudeSession: (opts) => ipcRenderer.invoke('claude:deleteSession', opts),
  findLatestClaudeSession: (opts) => ipcRenderer.invoke('claude:findLatestSession', opts),
  getClaudeSessionDetail: (opts) => ipcRenderer.invoke('claude:getSessionDetail', opts),
  // 定时任务 API
  schedulerGetTasks: () => ipcRenderer.invoke('scheduler:getTasks'),
  schedulerSaveTask: (task) => ipcRenderer.invoke('scheduler:saveTask', task),
  schedulerDeleteTask: (taskId) => ipcRenderer.invoke('scheduler:deleteTask', taskId),
  schedulerToggleTask: (opts) => ipcRenderer.invoke('scheduler:toggleTask', opts),
  schedulerGetLogs: (taskId) => ipcRenderer.invoke('scheduler:getLogs', taskId),
  schedulerClearLogs: (taskId) => ipcRenderer.invoke('scheduler:clearLogs', taskId),
  onSchedulerExecute: (callback) => {
    const listener = (event, task) => callback(task);
    ipcRenderer.on('scheduler:execute', listener);
    return () => ipcRenderer.removeListener('scheduler:execute', listener);
  },
  schedulerReportResult: (result) => ipcRenderer.send('scheduler:reportResult', result),
  onSchedulerShowPanel: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('scheduler:showPanel', listener);
    return () => ipcRenderer.removeListener('scheduler:showPanel', listener);
  },
  // 系统操作 API
  systemPostAction: (action) => ipcRenderer.invoke('system:postAction', action),
  // 自动更新 API
  updaterCheckForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  updaterDownloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
  updaterInstallUpdate: () => ipcRenderer.invoke('updater:installUpdate'),
  updaterCheckPending: () => ipcRenderer.invoke('updater:checkPending'),
  updaterClearPending: () => ipcRenderer.invoke('updater:clearPending'),
  onUpdaterEvent: (callback) => {
    const events = ['updater:checking', 'updater:update-available', 'updater:update-not-available', 'updater:download-progress', 'updater:update-downloaded', 'updater:error', 'updater:pending-install'];
    const listeners = events.map(evt => {
      const listener = (event, data) => callback(evt.replace('updater:', ''), data);
      ipcRenderer.on(evt, listener);
      return { evt, listener };
    });
    return () => listeners.forEach(({ evt, listener }) => ipcRenderer.removeListener(evt, listener));
  },
  // 布局持久化 API
  saveLayout: (layout) => ipcRenderer.invoke('layout:save', layout),
  loadLayout: () => ipcRenderer.invoke('layout:load'),
});
