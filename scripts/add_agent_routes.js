const fs = require('fs');
const path = require('path');

const targetFile = 'c:/Users/avani/Downloads/print it/print it/backend/src/routes/shopRoutes.js';

if (!fs.existsSync(targetFile)) {
  console.error('Target file not found:', targetFile);
  process.exit(1);
}

let content = fs.readFileSync(targetFile, 'utf8');

if (content.includes('/agent/pairing-code')) {
  console.log('Agent routes already exist in shopRoutes.js');
  process.exit(0);
}

const snippet = `
/**
 * @route   GET /api/shop/agent
 * @desc    Get connected print agent device and pairing status
 * @access  Private (Shop Owner Only)
 */
router.get('/agent', async (req, res) => {
    try {
        const result = await pool.query(
            \`SELECT id, device_name, pairing_code, pairing_code_expires_at, 
                    selected_printer, agent_version, status, last_seen_at, updated_at
             FROM agent_devices 
             WHERE shop_id = $1 
             ORDER BY updated_at DESC LIMIT 1\`,
            [req.shop_id]
        );
        res.json({ device: result.rows[0] || null });
    } catch (err) {
        console.error('Error fetching agent device:', err);
        res.status(500).json({ error: 'Failed to fetch agent device' });
    }
});

/**
 * @route   POST /api/shop/agent/pairing-code
 * @desc    Generate a new 6-character pairing code for the shop
 * @access  Private (Shop Owner Only)
 */
router.post('/agent/pairing-code', async (req, res) => {
    const { device_name = 'Counter-Station' } = req.body;
    try {
        const codeResult = await pool.query(
            'SELECT generate_pairing_code($1, $2) AS code',
            [req.shop_id, device_name]
        );
        const code = codeResult.rows[0]?.code;
        res.json({
            pairing_code: code,
            expires_in_minutes: 15,
            message: 'Pairing code generated successfully'
        });
    } catch (err) {
        console.error('Error generating pairing code:', err);
        res.status(500).json({ error: 'Failed to generate pairing code' });
    }
});

module.exports = router;`;

content = content.replace('module.exports = router;', snippet);
fs.writeFileSync(targetFile, content, 'utf8');
console.log('Successfully added agent endpoints to shopRoutes.js');
