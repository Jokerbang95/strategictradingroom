require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1); // necessario dietro il proxy HTTPS di Render

app.use(express.json({ limit: '2mb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'cambia-questo-segreto-in-produzione',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,          // cookie via HTTPS in produzione
    sameSite: 'lax',
    // NESSUN maxAge: è un "session cookie" — il browser lo cancella da solo
    // quando l'intero browser viene chiuso, senza bisogno di specificare una
    // durata. Riaprendo il link dopo aver chiuso il browser, la sessione non
    // c'è più e si torna sempre alla schermata di login.
  },
}));

// limite di richieste sulle rotte di autenticazione, per rallentare tentativi automatizzati
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi. Riprova tra qualche minuto.' },
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non autenticato.' });
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ============================================================
   AUTENTICAZIONE
   ============================================================ */
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Inserisci un indirizzo email valido.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri.' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailNorm]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Esiste già un account con questa email.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id, email, display_name',
      [emailNorm, hash, displayName || null]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, displayName: user.display_name });
  } catch (err) {
    console.error('Errore in /api/register:', err);
    res.status(500).json({ error: 'Errore del server durante la registrazione.' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email e password sono obbligatorie.' });
    const emailNorm = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT id, email, password_hash, display_name FROM users WHERE email = $1', [emailNorm]);
    const user = result.rows[0];
    // messaggio identico sia per email inesistente che per password errata: non riveliamo quale delle due è sbagliata
    if (!user) return res.status(401).json({ error: 'Email o password non corretti.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email o password non corretti.' });
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, displayName: user.display_name });
  } catch (err) {
    console.error('Errore in /api/login:', err);
    res.status(500).json({ error: 'Errore del server durante il login.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const result = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user) return res.json({ user: null });
    res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error('Errore in /api/me:', err);
    res.status(500).json({ error: 'Errore del server.' });
  }
});

/* ============================================================
   DATI — tutte protette da requireAuth, filtrate per user_id
   ============================================================ */

// --- trades: elenco completo / sostituzione completa (il frontend gestisce la fusione) ---
app.get('/api/trades', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM trades WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows.map(r => r.data));
});

app.put('/api/trades', requireAuth, async (req, res) => {
  const trades = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM trades WHERE user_id = $1', [req.session.userId]);
    for (const t of trades) {
      if (!t || !t.id) continue;
      await client.query(
        'INSERT INTO trades (id, user_id, data) VALUES ($1,$2,$3)',
        [String(t.id), req.session.userId, t]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: trades.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore in PUT /api/trades:', err);
    res.status(500).json({ error: 'Errore salvando le operazioni.' });
  } finally {
    client.release();
  }
});

// --- settings: oggetto singolo per utente ---
app.get('/api/settings', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM settings WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows[0] ? result.rows[0].data : null);
});

app.put('/api/settings', requireAuth, async (req, res) => {
  await pool.query(
    `INSERT INTO settings (user_id, data) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`,
    [req.session.userId, req.body || {}]
  );
  res.json({ ok: true });
});

// --- options: stesso pattern di trades ---
app.get('/api/options', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM options WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows.map(r => r.data));
});

app.put('/api/options', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM options WHERE user_id = $1', [req.session.userId]);
    for (const o of list) {
      if (!o || !o.id) continue;
      await client.query('INSERT INTO options (id, user_id, data) VALUES ($1,$2,$3)', [String(o.id), req.session.userId, o]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: list.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore in PUT /api/options:', err);
    res.status(500).json({ error: 'Errore salvando le opzioni.' });
  } finally {
    client.release();
  }
});

// --- notifications: stesso pattern ---
app.get('/api/notifications', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM notifications WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows.map(r => r.data));
});

app.put('/api/notifications', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM notifications WHERE user_id = $1', [req.session.userId]);
    for (const n of list) {
      if (!n || !n.id) continue;
      await client.query('INSERT INTO notifications (id, user_id, data) VALUES ($1,$2,$3)', [String(n.id), req.session.userId, n]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: list.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore in PUT /api/notifications:', err);
    res.status(500).json({ error: 'Errore salvando le notifiche.' });
  } finally {
    client.release();
  }
});

// --- conti multipli: stesso pattern di trades/options ---
app.get('/api/accounts', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM accounts WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows.map(r => r.data));
});

app.put('/api/accounts', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM accounts WHERE user_id = $1', [req.session.userId]);
    for (const a of list) {
      if (!a || !a.id) continue;
      await client.query('INSERT INTO accounts (id, user_id, data) VALUES ($1,$2,$3)', [String(a.id), req.session.userId, a]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: list.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore in PUT /api/accounts:', err);
    res.status(500).json({ error: 'Errore salvando i conti.' });
  } finally {
    client.release();
  }
});

// --- storico check-in 🧠: stesso pattern ---
app.get('/api/checkins', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT data FROM checkins WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows.map(r => r.data));
});

app.put('/api/checkins', requireAuth, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM checkins WHERE user_id = $1', [req.session.userId]);
    for (const c of list) {
      if (!c || !c.id) continue;
      await client.query('INSERT INTO checkins (id, user_id, data) VALUES ($1,$2,$3)', [String(c.id), req.session.userId, c]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: list.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Errore in PUT /api/checkins:', err);
    res.status(500).json({ error: 'Errore salvando lo storico dei check-in.' });
  } finally {
    client.release();
  }
});

// --- pannelli ridotti: piccolo array di id ---
app.get('/api/collapsed-panels', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT panel_ids FROM collapsed_panels WHERE user_id = $1', [req.session.userId]);
  res.json(result.rows[0] ? result.rows[0].panel_ids : []);
});

app.put('/api/collapsed-panels', requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body) ? req.body : [];
  await pool.query(
    `INSERT INTO collapsed_panels (user_id, panel_ids) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET panel_ids = EXCLUDED.panel_ids`,
    [req.session.userId, JSON.stringify(ids)]
  );
  res.json({ ok: true });
});

/* ============================================================
   FRONTEND STATICO
   ============================================================ */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Non trovato.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`StrategicTradingRoom in ascolto sulla porta ${PORT}`);
});
