const { app, Tray, nativeImage, Menu } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  console.log('[TEST] App ready');
  const pIco = path.join(__dirname, '..', 'assets', 'icon.ico');
  const pPng = path.join(__dirname, '..', 'assets', 'icon32.png');

  console.log('[TEST] Checking ICO:', pIco);
  const imgIco = nativeImage.createFromPath(pIco);
  console.log('[TEST] ICO empty:', imgIco.isEmpty(), 'size:', imgIco.getSize());

  console.log('[TEST] Checking PNG:', pPng);
  const imgPng = nativeImage.createFromPath(pPng);
  console.log('[TEST] PNG empty:', imgPng.isEmpty(), 'size:', imgPng.getSize());

  try {
    const tray = new Tray(imgPng);
    tray.setToolTip('PrintIt Test Tray');
    const menu = Menu.buildFromTemplate([{ label: 'PrintIt Running' }, { label: 'Quit', click: () => app.quit() }]);
    tray.setContextMenu(menu);
    console.log('[TEST] Tray created successfully with PNG!');
  } catch (e) {
    console.error('[TEST] Tray creation failed:', e);
  }

  setTimeout(() => {
    console.log('[TEST] Exiting test after 3s');
    app.quit();
  }, 3000);
});
