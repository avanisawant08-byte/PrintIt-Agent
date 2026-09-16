const fs = require('fs');
const targetFile = 'c:/Users/avani/Downloads/print it/print it/backend/src/routes/index.js';

let content = fs.readFileSync(targetFile, 'utf8');

if (!content.includes('/agent/pair')) {
  const pairRoute = `
// POST /api/agent/pair â€” Agent Device Pairing by 6-character code
router.post('/agent/pair', async (req, res) => {
  const { pairingCode, deviceName = 'Counter-Station' } = req.body;
  const pool = require('../config/db');
  try {
    const code = (pairingCode || '').trim().toUpperCase();
    const result = await pool.query(
      'SELECT id, shop_id, pairing_code_expires_at FROM agent_devices WHERE pairing_code = $1 AND pairing_code_expires_at > NOW()',
      [code]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Pairing code expired or invalid.' });
    }
    const device = result.rows[0];
    const token = 'agent-jwt-' + device.id + '-' + Date.now();
    await pool.query(
      "UPDATE agent_devices SET device_name = $1, status = 'ONLINE', pairing_code = NULL, auth_token = $2, last_seen_at = NOW() WHERE id = $3",
      [deviceName, token, device.id]
    );
    return res.json({ shopId: device.shop_id, deviceId: device.id, token });
  } catch (err) {
    console.error('Agent pairing error:', err);
    return res.status(500).json({ error: 'Failed to pair agent device' });
  }
});

module.exports = router;`;

  content = content.replace('module.exports = router;', pairRoute);
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log('Successfully mounted /api/agent/pair route in index.js');
}
