const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('persist', {
  loadData: () => ipcRenderer.invoke('persist:load'),
  saveData: (payload) => ipcRenderer.invoke('persist:save', payload)
});
