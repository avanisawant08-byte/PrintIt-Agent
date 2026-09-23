const { getDbClient } = require('./db.js');

async function checkEnum() {
  const client = getDbClient();
  await client.connect();

  const res = await client.query(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status'
    ORDER BY e.enumsortorder;
  `);

  console.log('Valid order_status enum values:', res.rows.map(r => r.enumlabel));
  await client.end();
}

checkEnum().catch(console.error);
