const fs = require('fs');
const path = require('path');

const filePath = 'C:/Users/avani/Downloads/print it/print it/backend/src/routes/shopRoutes.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix device status check in dispatch-to-agent
const oldCheck = "if (device.status !== 'ONLINE') {";
const newCheck = "if (!['ONLINE', 'READY', 'PRINTING'].includes(device.status)) {";
if (content.includes(oldCheck)) {
  content = content.replace(oldCheck, newCheck);
  console.log('Fixed device status check in dispatch-to-agent.');
}

// 2. Add /agent/test-print endpoint if not already added
if (!content.includes('/agent/test-print')) {
  const insertMarker = "router.post('/orders/:id/dispatch-to-agent'";
  const testPrintCode = `/**
 * @route   POST /api/shop/agent/test-print
 * @desc    Trigger a diagnostic hardware test print page on the shop's linked agent
 * @access  Private (Shop Owner Only)
 */
router.post('/agent/test-print', async (req, res) => {
    const { printer_name } = req.body;
    try {
        const deviceRes = await pool.query(
            "SELECT id, status, selected_printer, selected_printer_bw, selected_printer_color FROM agent_devices WHERE shop_id = $1 ORDER BY updated_at DESC LIMIT 1",
            [req.shop_id]
        );
        const device = deviceRes.rows[0];
        if (!device) {
            return res.status(400).json({ error: 'No print agent is paired with this shop. Please pair your PrintIt Agent desktop app first.' });
        }
        if (!['ONLINE', 'READY', 'PRINTING'].includes(device.status)) {
            return res.status(503).json({ error: \`Print agent is currently \${device.status || 'OFFLINE'}. Please start the PrintIt Agent on your shop PC.\` });
        }

        const targetPrinter = printer_name || device.selected_printer || device.selected_printer_bw || null;
        const testJobId = 'TEST-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        await pool.query(\`
            CREATE TABLE IF NOT EXISTS agent_print_jobs (
                id           SERIAL PRIMARY KEY,
                shop_id      TEXT NOT NULL,
                order_id     TEXT NOT NULL,
                file_index   INT NOT NULL DEFAULT 0,
                storage_path TEXT,
                storage_paths JSONB,
                print_options JSONB,
                status       TEXT NOT NULL DEFAULT 'pending',
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                acked_at     TIMESTAMPTZ
            )
        \`);

        const jobRes = await pool.query(
            \`INSERT INTO agent_print_jobs (shop_id, order_id, file_index, storage_path, print_options, status)
             VALUES ($1, $2, 0, 'diagnostic://test_page.pdf', $3::jsonb, 'pending')
             RETURNING id\`,
            [
                req.shop_id,
                testJobId,
                JSON.stringify({
                    is_test_page: true,
                    printer_name: targetPrinter,
                    copies: 1
                })
            ]
        );

        return res.json({
            success: true,
            job_id: jobRes.rows[0].id,
            target_printer: targetPrinter || 'Default System Spooler',
            message: \`Diagnostic test page queued for silent printing on "\${targetPrinter || 'Default System Spooler'}"\`
        });
    } catch (err) {
        console.error('Error queuing test print:', err);
        res.status(500).json({ error: 'Failed to queue diagnostic test print: ' + err.message });
    }
});

`;
  content = content.replace(insertMarker, testPrintCode + insertMarker);
  console.log('Added /agent/test-print endpoint.');
}

// 3. Add /orders/walk-in endpoint if not already added
if (!content.includes('/orders/walk-in')) {
  const insertMarker = 'module.exports = router;';
  const walkInCode = `/**
 * @route   POST /api/shop/orders/walk-in
 * @desc    Create a counter walk-in print order and immediately dispatch to agent
 * @access  Private (Shop Owner Only)
 */
router.post('/orders/walk-in', async (req, res) => {
    const { files, print_options, customer_phone, amount_total } = req.body;
    try {
        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'At least one file is required for a print job.' });
        }

        const { generateOrderId } = require('../utils/orderIdGenerator');
        const orderId = await generateOrderId(pool, 'express');

        const shopRes = await pool.query('SELECT owner_id FROM shops WHERE shop_id = $1', [req.shop_id]);
        const ownerId = shopRes.rows[0]?.owner_id || req.user_id;

        const effectiveOptions = print_options || {};
        const totalAmount = amount_total ? parseFloat(amount_total) : 0;

        const orderInsert = await pool.query(
            \`INSERT INTO orders (
                order_id, customer_id, shop_id, files, print_options, customer_phone,
                amount_total, payment_status, status, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4::jsonb, $5::jsonb, $6,
                $7, 'captured', 'processing', NOW(), NOW()
             ) RETURNING *\`,
            [
                orderId,
                ownerId,
                req.shop_id,
                JSON.stringify(files),
                JSON.stringify(effectiveOptions),
                customer_phone || null,
                totalAmount
            ]
        );

        // Queue directly to agent_print_jobs so the agent prints it immediately
        const deviceRes = await pool.query(
            "SELECT id, status FROM agent_devices WHERE shop_id = $1 ORDER BY updated_at DESC LIMIT 1",
            [req.shop_id]
        );
        const device = deviceRes.rows[0];
        let agentDispatched = false;

        if (device && ['ONLINE', 'READY', 'PRINTING'].includes(device.status)) {
            const getStoragePath = (rawFile) => {
                const fileInfo = (rawFile && rawFile.file_info && typeof rawFile.file_info === 'object')
                    ? rawFile.file_info
                    : rawFile;
                return fileInfo && (fileInfo.public_id || fileInfo.s3_key || fileInfo.url || null);
            };

            await pool.query(\`
                CREATE TABLE IF NOT EXISTS agent_print_jobs (
                    id           SERIAL PRIMARY KEY,
                    shop_id      TEXT NOT NULL,
                    order_id     TEXT NOT NULL,
                    file_index   INT NOT NULL DEFAULT 0,
                    storage_path TEXT,
                    storage_paths JSONB,
                    print_options JSONB,
                    status       TEXT NOT NULL DEFAULT 'pending',
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    acked_at     TIMESTAMPTZ
                )
            \`);

            if (effectiveOptions.multi_file_grid && files.length > 1) {
                const allPaths = files.map(getStoragePath).filter(Boolean);
                await pool.query(
                    \`INSERT INTO agent_print_jobs (shop_id, order_id, file_index, storage_path, storage_paths, print_options, status)
                     VALUES ($1, $2, 0, $3, $4::jsonb, $5, 'pending')\`,
                    [req.shop_id, orderId, allPaths[0] || null, JSON.stringify(allPaths), effectiveOptions]
                );
            } else {
                for (let idx = 0; idx < files.length; idx++) {
                    const sPath = getStoragePath(files[idx]);
                    const fileOpts = files[idx]?.print_options || effectiveOptions;
                    await pool.query(
                        \`INSERT INTO agent_print_jobs (shop_id, order_id, file_index, storage_path, print_options, status)
                         VALUES ($1, $2, $3, $4, $5, 'pending')\`,
                        [req.shop_id, orderId, idx, sPath, fileOpts]
                    );
                }
            }
            agentDispatched = true;
        }

        res.status(201).json({
            message: 'Walk-in print order created successfully',
            order: orderInsert.rows[0],
            agent_dispatched: agentDispatched
        });

    } catch (err) {
        console.error('Error creating walk-in order:', err);
        res.status(500).json({ error: 'Failed to create walk-in order: ' + err.message });
    }
});

`;
  content = content.replace(insertMarker, walkInCode + insertMarker);
  console.log('Added /orders/walk-in endpoint.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated shopRoutes.js');
