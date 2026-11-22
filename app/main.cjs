// Desktop wrapper: opens the self-contained simulator page in a native window.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
function create() {
  const win = new BrowserWindow({ width: 1500, height: 900, backgroundColor: '#14171c', title: 'Deep History', webPreferences: { contextIsolation: true, sandbox: true } });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
