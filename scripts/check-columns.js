const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');
const client = new Client({ connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });

async function checkColumns() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'print_jobs' AND column_name = 'id'
  `);
  console.log('print_jobs.id info:', res.rows);
  await client.end();
}

checkColumns().catch(console.error);
