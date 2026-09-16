const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

const client = new Client({
  connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
});

async function main() {
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
