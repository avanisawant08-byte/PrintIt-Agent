const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
  });
  await client.connect();

  const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'print_jobs'");
  console.log('Columns in print_jobs:');
  console.table(cols.rows);

  await client.end();
}

main().catch(console.error);
