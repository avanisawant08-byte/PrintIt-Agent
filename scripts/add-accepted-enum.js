const { getDbClient } = require('./db.js');

async function addEnumValues() {
  const client = getDbClient();
  await client.connect();

  console.log('Adding accepted to order_status enum...');
  try {
    await client.query("ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'accepted' BEFORE 'processing';");
    console.log('Successfully added accepted to order_status enum!');
  } catch (err) {
    console.error('Error adding enum value:', err);
  }

  // Also check if 'completed' or 'printed' might be used
  try {
    await client.query("ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'completed';");
    console.log('Successfully added completed to order_status enum!');
  } catch (err) {
    console.warn('Completed enum note:', err.message);
  }

  const res = await client.query(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status'
    ORDER BY e.enumsortorder;
  `);
  console.log('Updated order_status enum values:', res.rows.map(r => r.enumlabel));

  await client.end();
}

addEnumValues().catch(console.error);
