// Connessione al database Postgres — funziona sia in locale (DATABASE_URL punta
// al Postgres locale) sia in produzione (DATABASE_URL punta a Neon/Render).
// Neon e la maggior parte dei provider gestiti richiedono SSL: lo attiviamo
// automaticamente a meno che non siamo esplicitamente in locale.
const { Pool } = require('pg');

const isLocal = (process.env.DATABASE_URL || '').includes('localhost')
  || (process.env.DATABASE_URL || '').includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Errore imprevisto sul client Postgres inattivo', err);
});

module.exports = { pool };
