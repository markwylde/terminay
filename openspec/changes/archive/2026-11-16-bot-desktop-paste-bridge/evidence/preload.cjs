const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hostBridge', {
	read: () => ipcRenderer.invoke('read-clipboard'),
});
