// Minimal Electron host shaped like Terminay: an Edit menu with role paste and
// a preload bridge whose read runs Electron's clipboard in the main process,
// as electron/main.ts readTerminalClipboardForUpload does.
const { app, BrowserWindow, Menu, clipboard, ipcMain } = require('electron');
const path = require('node:path');

app.commandLine.appendSwitch('no-sandbox');
ipcMain.handle('read-clipboard', async () => {
	const text = await clipboard.readText();
	return text.length > 0 ? { kind: 'text', text } : { kind: 'empty' };
});
app.whenReady().then(() => {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{ label: 'Edit', submenu: [{ role: 'paste' }, { role: 'selectAll' }] },
		]),
	);
	const win = new BrowserWindow({
		width: 600,
		height: 400,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			sandbox: false,
		},
	});
	win.loadFile(path.join(__dirname, 'page.html'));
});
