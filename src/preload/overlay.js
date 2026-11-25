'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const STATE = 'overlay:state';
const CONFIG = 'overlay:config';

contextBridge.exposeInMainWorld('lastTrainingOverlay', {
  state: () => ipcRenderer.invoke(STATE),
  onConfig: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, config) => callback(config);
    ipcRenderer.on(CONFIG, listener);
    return () => ipcRenderer.removeListener(CONFIG, listener);
  }
});
