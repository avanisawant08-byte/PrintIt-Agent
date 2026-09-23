const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();

  const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'print_jobs'");
  console.log('Columns in print_jobs:');
  console.table(cols.rows);

  await client.end();
}

main().catch(console.error);
