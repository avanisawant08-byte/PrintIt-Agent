const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();

  const oRes = await client.query("SELECT order_id, shop_id, status, files FROM orders WHERE order_id = 'Eaa0026' LIMIT 1");
  const order = oRes.rows[0];
  console.log('Order Eaa0026:', order);

  try {
    await client.query('BEGIN');
    // Try updating status
    const updateRes = await client.query("UPDATE orders SET status = 'accepted' WHERE order_id = $1 RETURNING order_id, status", [order.order_id]);
    console.log('Update success:', updateRes.rows);
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('Update FAILED with error:');
    console.error(err);
    await client.query('ROLLBACK');
  }

  // Now test with another order
  const anyOrderRes = await client.query("SELECT order_id, shop_id, status, files FROM orders WHERE order_id != 'Eaa0026' LIMIT 1");
  if (anyOrderRes.rows.length > 0) {
    const anyOrder = anyOrderRes.rows[0];
    console.log('Other order:', anyOrder);
    try {
      await client.query('BEGIN');
      const updateRes = await client.query("UPDATE orders SET status = 'accepted' WHERE order_id = $1 RETURNING order_id, status", [anyOrder.order_id]);
      console.log('Other order update success:', updateRes.rows);
      await client.query('ROLLBACK');
    } catch (err) {
      console.error('Other order update FAILED with error:');
      console.error(err);
      await client.query('ROLLBACK');
    }
  }

  await client.end();
}

main().catch(console.error);
