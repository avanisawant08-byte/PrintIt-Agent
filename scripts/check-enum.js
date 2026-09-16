const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

async function checkEnum() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
  });
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
