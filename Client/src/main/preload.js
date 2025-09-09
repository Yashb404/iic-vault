const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe subset of ipcRenderer to the renderer
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
  },
  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
});

// Log that preload script loaded successfully
console.log('Preload script loaded successfully');
