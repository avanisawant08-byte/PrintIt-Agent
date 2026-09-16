const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
  });
  await client.connect();

  const job = await client.query("SELECT * FROM print_jobs WHERE order_id = 'Eaa0025'");
  console.log('Job Eaa0025:', JSON.stringify(job.rows, null, 2));

  const order = await client.query("SELECT * FROM orders WHERE order_id = 'Eaa0025'");
  console.log('Order Eaa0025:', JSON.stringify(order.rows, null, 2));

  await client.end();
}

main().catch(console.error);
