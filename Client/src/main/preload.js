const { contextBridge, ipcRenderer } = require('electron');

// Define allowed IPC channels for security
const ALLOWED_CHANNELS = [
  'user:login',
  'user:register', 
  'user:logout',
  'files:get',
  'files:sync',
  'file:add',
  'file:addPath',
  'file:download',
  'file:delete',
  'file:share',
  'audit:get',
  'dialog:openFile',
  'dialog:saveFile',
  'app:getUserInfo',
  'app:getSyncStatus'
];

// Expose a safe subset of ipcRenderer to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Main invoke method for all IPC calls
  invoke: (channel, ...args) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Channel ${channel} is not allowed`);
  },
  
  // Event listeners for real-time updates
  on: (channel, listener) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, listener);
    }
  },
  
  removeListener: (channel, listener) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.removeListener(channel, listener);
    }
  },

  // Convenience methods for common operations
  user: {
    login: (credentials) => ipcRenderer.invoke('user:login', credentials),
    register: (userData) => ipcRenderer.invoke('user:register', userData),
    logout: () => ipcRenderer.invoke('user:logout'),
    getInfo: () => ipcRenderer.invoke('app:getUserInfo')
  },
  
  files: {
    get: () => ipcRenderer.invoke('files:get'),
    sync: () => ipcRenderer.invoke('files:sync'),
    add: (options) => ipcRenderer.invoke('file:add', options),
    addPath: (options) => ipcRenderer.invoke('file:addPath', options),
    download: (fileId, password) => ipcRenderer.invoke('file:download', { fileId, password }),
    delete: (fileId) => ipcRenderer.invoke('file:delete', { fileId }),
    share: (fileId, userIds) => ipcRenderer.invoke('file:share', { fileId, userIds })
  },
  
  audit: {
    get: (filters) => ipcRenderer.invoke('audit:get', filters)
  },
  
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options)
  },
  
  app: {
    getSyncStatus: () => ipcRenderer.invoke('app:getSyncStatus')
  }
});
