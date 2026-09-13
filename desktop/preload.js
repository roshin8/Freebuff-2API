const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freebuffDesktop', {
  openLogin: () => ipcRenderer.invoke('open-login'),
  captureCookie: () => ipcRenderer.invoke('capture-cookie'),
  isDesktop: true,
});
