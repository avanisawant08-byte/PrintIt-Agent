const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
let Client;
try {
  Client = require('pg').Client;
} catch {
  try {
    Client = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg').Client;
  } catch {
    // pg not found
  }
}

function getDbClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set in .env');
  }
  if (!Client) {
    throw new Error('PostgreSQL client (pg) is not available. Please run npm install pg or set NODE_PATH.');
  }
  return new Client({ connectionString });
}

module.exports = { getDbClient };
