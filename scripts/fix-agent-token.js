const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_URL = 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const deviceId = '4b6e9dfd-c2da-4196-a265-2a2a2d5a8b0a';
  const shopId = '0aada7cf-7b91-4a60-9a31-d520ff5dd02d';
  const authToken = `agent-jwt-${deviceId}-${crypto.randomBytes(16).toString('hex')}`;

  // 1. Update database agent_devices record
  await client.query(`
    UPDATE agent_devices 
    SET auth_token = $1, status = 'ONLINE', last_seen_at = NOW() 
    WHERE id = $2
  `, [authToken, deviceId]);

  console.log('✅ Updated agent_devices in database with valid auth_token:');
  console.log('   Device ID:', deviceId);
  console.log('   Auth Token:', authToken);

  await client.end();

  // 2. Update agent-config.json in %APPDATA%
  const configPath = path.join(process.env.APPDATA, 'printit-remote-agent', 'agent-config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  config.shopId = shopId;
  config.deviceId = deviceId;
  config.authToken = authToken;
  config.backendApiUrl = 'http://localhost:3000';
  config.selectedPrinter = 'Virtual Test Printer (Save to Disk)';

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('✅ Updated agent-config.json at:', configPath);
}

main().catch(console.error);
