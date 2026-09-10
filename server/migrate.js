// Esegue schema.sql sul database puntato da DATABASE_URL.
// Uso: npm run migrate  (va lanciato una volta, sia in locale che dopo il deploy)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Schema applicato correttamente.');
  } catch (err) {
    console.error('❌ Errore applicando lo schema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
