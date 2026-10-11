const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pianoNative', Object.freeze({
  vstHost: Object.freeze({
    available: true,
    start: () => ipcRenderer.invoke('vst-host:start'),
    request: (payload) => ipcRenderer.invoke('vst-host:request', payload),
    stop: () => ipcRenderer.invoke('vst-host:stop'),
    onEvent: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('vst-host:event', listener);
      return () => ipcRenderer.removeListener('vst-host:event', listener);
    },
  }),
}));
