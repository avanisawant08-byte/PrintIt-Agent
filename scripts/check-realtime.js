const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();

  const job = await client.query("SELECT * FROM print_jobs WHERE order_id = 'Eaa0025'");
  console.log('Job Eaa0025:', JSON.stringify(job.rows, null, 2));

  const order = await client.query("SELECT * FROM orders WHERE order_id = 'Eaa0025'");
  console.log('Order Eaa0025:', JSON.stringify(order.rows, null, 2));

  await client.end();
}

main().catch(console.error);
