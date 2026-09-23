const { getDbClient } = require('./db.js');
const client = getDbClient();

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
