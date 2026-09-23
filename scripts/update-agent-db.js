const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();
  const res = await client.query(
    "UPDATE agent_devices SET status = 'ONLINE', device_name = 'Counter-Station-1', auth_token = 'agent-jwt-fce26a9b-c79f-4e19-b291-1f1fe16bb172-token', last_seen_at = NOW() WHERE id = 'fce26a9b-c79f-4e19-b291-1f1fe16bb172'"
  );
  console.log('Updated rows in agent_devices:', res.rowCount);
  await client.end();
}

main().catch(console.error);
