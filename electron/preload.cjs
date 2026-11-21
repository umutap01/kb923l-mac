const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kb', {
  getStatus: () => ipcRenderer.invoke('kb:getStatus'),
  onStatus: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('kb:status', fn);
    return () => ipcRenderer.removeListener('kb:status', fn);
  },
  readLed: () => ipcRenderer.invoke('kb:readLed'),
  writeLed: (bytes) => ipcRenderer.invoke('kb:writeLed', bytes),
  writeCustom: (colors) => ipcRenderer.invoke('kb:writeCustom', colors),
  getRemap: () => ipcRenderer.invoke('kb:getRemap'),
  applyRemap: (pairs) => ipcRenderer.invoke('kb:applyRemap', pairs),
  getLogin: () => ipcRenderer.invoke('kb:getLogin'),
  setLogin: (v) => ipcRenderer.invoke('kb:setLogin', v),
  factoryReset: () => ipcRenderer.invoke('kb:factoryReset'),
  syncNow: () => ipcRenderer.invoke('kb:syncNow'),
  setAutoSync: (v) => ipcRenderer.invoke('kb:setAutoSync', v),
  relaunch: () => ipcRenderer.invoke('kb:relaunch'),
  openPrivacy: () => ipcRenderer.invoke('kb:openPrivacy'),
});
