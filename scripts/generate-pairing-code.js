const { getDbClient } = require('./db.js');

async function main() {
  const db = getDbClient();
  await db.connect();

  const shopId = '0aada7cf-7b91-4a60-9a31-d520ff5dd02d'; // Pr xerox shop
  const deviceName = 'Counter-Station-1';

  // Generate 6-char pairing code
  const res = await db.query(
    'SELECT generate_pairing_code($1::uuid, $2::varchar) AS code',
    [shopId, deviceName]
  );

  const code = res.rows[0]?.code;
  console.log('----------------------------------------------------');
  console.log('✅ FRESH PAIRING CODE GENERATED:');
  console.log(`   CODE: ${code}`);
  console.log('   SHOP: Pr xerox shop (' + shopId + ')');
  console.log('   VALID FOR: 15 minutes');
  console.log('----------------------------------------------------');

  await db.end();
}

main().catch(console.error);
