const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();

  const policies = await client.query("SELECT policyname, roles, cmd, qual FROM pg_policies WHERE tablename = 'shops'");
  console.log('Current policies on shops:', policies.rows);

  // Allow anon to read shops
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'shops' AND policyname = 'Allow public select on shops'
      ) THEN
        CREATE POLICY "Allow public select on shops" ON shops FOR SELECT TO anon, authenticated USING (true);
      END IF;
    END $$;
  `);

  console.log('Granted SELECT on shops to anon role.');
  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
