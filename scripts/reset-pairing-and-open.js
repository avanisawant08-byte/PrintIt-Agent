const { ConfigManager } = require('../dist/config');

// Clear local saved pairing so the agent displays the pairing screen
const config = ConfigManager.getInstance();
config.clearPairing();
console.log('✅ Local agent pairing cleared.');
console.log('Now launch the agent (npm start) or right-click the tray icon to see the pairing screen!');
