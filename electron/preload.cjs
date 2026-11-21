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
  applyRemap: (arg) => ipcRenderer.invoke('kb:applyRemap', arg),
  uploadScreen: (frames, delay) => ipcRenderer.invoke('kb:uploadScreen', frames, delay),
  cancelScreen: () => ipcRenderer.invoke('kb:cancelScreen'),
  onScreenProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on('kb:screenProgress', fn);
    return () => ipcRenderer.removeListener('kb:screenProgress', fn);
  },
  getSoftvol: () => ipcRenderer.invoke('kb:getSoftvol'),
  setSoftvol: (p) => ipcRenderer.invoke('kb:setSoftvol', p),
  openAudioPrivacy: () => ipcRenderer.invoke('kb:openAudioPrivacy'),
  onSoftvol: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('kb:softvol', fn);
    return () => ipcRenderer.removeListener('kb:softvol', fn);
  },
  getMacros: () => ipcRenderer.invoke('kb:getMacros'),
  setMacros: (list) => ipcRenderer.invoke('kb:setMacros', list),
  macroState: () => ipcRenderer.invoke('kb:macroState'),
  macroRecord: (on) => ipcRenderer.invoke('kb:macroRecord', on),
  macroPlay: (id) => ipcRenderer.invoke('kb:macroPlay', id),
  macroStop: () => ipcRenderer.invoke('kb:macroStop'),
  macroTrust: (prompt) => ipcRenderer.invoke('kb:macroTrust', prompt),
  openAccessibility: () => ipcRenderer.invoke('kb:openAccessibility'),
  onMacroState: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('kb:macroState', fn);
    return () => ipcRenderer.removeListener('kb:macroState', fn);
  },
  onMacroKey: (cb) => {
    const fn = (_e, k) => cb(k);
    ipcRenderer.on('kb:macroKey', fn);
    return () => ipcRenderer.removeListener('kb:macroKey', fn);
  },
  getLogin: () => ipcRenderer.invoke('kb:getLogin'),
  setLogin: (v) => ipcRenderer.invoke('kb:setLogin', v),
  factoryReset: () => ipcRenderer.invoke('kb:factoryReset'),
  syncNow: () => ipcRenderer.invoke('kb:syncNow'),
  setAutoSync: (v) => ipcRenderer.invoke('kb:setAutoSync', v),
  relaunch: () => ipcRenderer.invoke('kb:relaunch'),
  openPrivacy: () => ipcRenderer.invoke('kb:openPrivacy'),
});
