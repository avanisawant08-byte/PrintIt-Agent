const fs = require('fs');
const path = require('path');
const { getDbClient } = require('./db.js');

async function main() {
  // 1. Update DB pairing codes so both A29C63 and AD2E74 are valid for 24h
  const db = getDbClient();
  await db.connect();

  const update1 = await db.query(
    "UPDATE agent_devices SET pairing_code_expires_at = NOW() + INTERVAL '24 hours', status = 'OFFLINE' WHERE pairing_code = 'A29C63' RETURNING id, shop_id, device_name, pairing_code, pairing_code_expires_at"
  );
  console.log('Renewed A29C63 in DB:', update1.rows);

  const update2 = await db.query(
    "UPDATE agent_devices SET pairing_code_expires_at = NOW() + INTERVAL '24 hours' WHERE pairing_code = 'AD2E74' RETURNING id, shop_id, device_name, pairing_code, pairing_code_expires_at"
  );
  console.log('Renewed AD2E74 in DB:', update2.rows);

  await db.end();

  // 2. Update agent-config.json in AppData to fix the placeholder Supabase URL and key
  const appDataDir = path.join(process.env.APPDATA, 'PrintIt Remote Agent');
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  const configPath = path.join(appDataDir, 'agent-config.json');
  let currentConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing config:', e);
    }
  }

  const updatedConfig = {
    ...currentConfig,
    deviceName: currentConfig.deviceName || 'Sawant',
    supabaseUrl: 'https://ncasateooojzdxyxszfn.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jYXNhdGVvb29qemR4eXhzemZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTY3NjcsImV4cCI6MjA5MzYzMjc2N30.Inq_6jnWP-6KlNWu6IPE-pBI5MHgJ3p4ndIRm1m3E2I',
    backendApiUrl: 'http://localhost:3000'
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf8');
  console.log('Updated agent-config.json at:', configPath);
  console.log('Config contents:', JSON.stringify(updatedConfig, null, 2));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
