const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
});

async function main() {
  await client.connect();
  const shopId = '0aada7cf-7b91-4a60-9a31-d520ff5dd02d'; // Pr xerox shop

  // Verify shop name
  const shopRes = await client.query('SELECT shop_id, name, address FROM shops WHERE shop_id = $1', [shopId]);
  if (shopRes.rows.length === 0) {
    throw new Error('Shop not found!');
  }
  const shop = shopRes.rows[0];
  console.log(`Configuring device for shop: ${shop.name} (${shop.shop_id})`);

  // Check or create device
  const devRes = await client.query('SELECT id, device_name, status FROM agent_devices WHERE shop_id = $1', [shopId]);
  let deviceId;
  if (devRes.rows.length > 0) {
    deviceId = devRes.rows[0].id;
    console.log(`Using existing agent_devices record: ${deviceId}`);
    await client.query("UPDATE agent_devices SET status = 'ONLINE', last_seen_at = NOW() WHERE id = $1", [deviceId]);
  } else {
    const insertQuery = `
      INSERT INTO agent_devices (id, shop_id, device_name, status, last_seen_at, pairing_code_expires_at)
      VALUES (gen_random_uuid(), $1, $2, 'ONLINE', NOW(), NOW() + INTERVAL '30 days')
      RETURNING id
    `;
    const insertRes = await client.query(insertQuery, [shopId, 'Counter-Station-1']);
    deviceId = insertRes.rows[0].id;
    console.log(`Created new agent_devices record: ${deviceId}`);
  }

  await client.end();

  // Update APPDATA configuration
  const configPath = path.join(process.env.APPDATA, 'printit-remote-agent', 'agent-config.json');
  console.log(`Updating config at: ${configPath}`);

  let currentConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing config, creating fresh.');
    }
  }

  const updatedConfig = {
    ...currentConfig,
    shopId: shopId,
    deviceId: deviceId,
    deviceName: currentConfig.deviceName || 'Counter-Station-1'
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
  console.log('Successfully written updated config:');
  console.log(JSON.stringify(updatedConfig, null, 2));
}

main().catch(err => {
  console.error('Error switching shop:', err);
  process.exit(1);
});
