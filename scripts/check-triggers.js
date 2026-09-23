const { getDbClient } = require('./db.js');
const client = getDbClient();

async function checkTrigger() {
  await client.connect();

  // Check all triggers on orders table
  const trgRes = await client.query(`
    SELECT trigger_name, event_manipulation, action_statement, action_timing
    FROM information_schema.triggers
    WHERE event_object_table = 'orders'
  `);
  console.log('Triggers on orders:');
  console.log(JSON.stringify(trgRes.rows, null, 2));

  // Get function definitions
  const fnRes = await client.query(`
    SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%order%'
  `);
  console.log('Order-related functions:');
  for (const row of fnRes.rows) {
    console.log(`--- ${row.proname} ---`);
    console.log(row.prosrc);
  }

  await client.end();
}

checkTrigger().catch(console.error);
