const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false)
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      spk TEXT NOT NULL,
      xfd DATE NOT NULL,
      qty INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT now(),
      created_by TEXT,
      planning_done BOOLEAN DEFAULT false,
      planning_date DATE
    );
    CREATE TABLE IF NOT EXISTS wh_ready_history (
      id SERIAL PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      date DATE NOT NULL,
      by_role TEXT
    );
    CREATE TABLE IF NOT EXISTS pengambilan_history (
      id SERIAL PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      date DATE NOT NULL,
      by_role TEXT
    );
    CREATE TABLE IF NOT EXISTS returan (
      id TEXT PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      reason TEXT,
      date DATE NOT NULL,
      by_role TEXT,
      status TEXT DEFAULT 'pending',
      confirmed_by TEXT,
      confirmed_date DATE
    );
  `);
  console.log('Database siap.');
}

// ---------- Auth ----------
// Passcode diambil dari environment variable Railway (Settings -> Variables).
// Kalau tidak diset, pakai default di bawah (SEBAIKNYA diganti saat deploy).
const ROLE_PASS = {
  PPIC: process.env.PASS_PPIC || 'ppic123',
  WH: process.env.PASS_WH || 'wh123',
  SF: process.env.PASS_SF || 'sf123'
};
const SECRET = process.env.AUTH_SECRET || 'ganti-secret-ini-di-railway';

function makeToken(role) {
  const sig = crypto.createHmac('sha256', SECRET).update(role).digest('hex');
  return Buffer.from(`${role}.${sig}`).toString('base64');
}
function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [role, sig] = decoded.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(role).digest('hex');
    if (sig === expected && ROLE_PASS[role]) return role;
    return null;
  } catch (e) {
    return null;
  }
}
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  const role = token ? verifyToken(token) : null;
  req.role = role; // null kalau tidak login / view-only
  next();
}
const PERMS = {
  planning: ['PPIC'],
  whReady: ['PPIC', 'WH'],
  pengambilan: ['PPIC', 'SF'],
  returanAdd: ['PPIC', 'WH', 'SF'],
  returanConfirm: ['WH']
};
function requirePerm(key) {
  return (req, res, next) => {
    if (!req.role || !PERMS[key].includes(req.role)) {
      return res.status(403).json({ error: 'Akses ditolak untuk peran ini.' });
    }
    next();
  };
}

app.use(authMiddleware);

app.post('/api/login', (req, res) => {
  const { role, passcode } = req.body || {};
  if (!ROLE_PASS[role] || passcode !== ROLE_PASS[role]) {
    return res.status(401).json({ error: 'Passcode salah.' });
  }
  res.json({ token: makeToken(role), role });
});

// ---------- Helpers ----------
async function getFullItems() {
  const items = (await pool.query('SELECT * FROM items ORDER BY created_at DESC')).rows;
  const wh = (await pool.query('SELECT * FROM wh_ready_history ORDER BY date ASC')).rows;
  const peng = (await pool.query('SELECT * FROM pengambilan_history ORDER BY date ASC')).rows;
  const ret = (await pool.query('SELECT * FROM returan ORDER BY date DESC')).rows;

  return items.map(it => ({
    id: it.id,
    spk: it.spk,
    xfd: it.xfd,
    qty: it.qty,
    createdAt: it.created_at,
    createdBy: it.created_by,
    planning: { done: it.planning_done, date: it.planning_date },
    whReady: { history: wh.filter(h => h.item_id === it.id).map(h => ({ qty: h.qty, date: h.date, by: h.by_role })) },
    pengambilan: { history: peng.filter(h => h.item_id === it.id).map(h => ({ qty: h.qty, date: h.date, by: h.by_role })) },
    returan: ret.filter(r => r.item_id === it.id).map(r => ({
      id: r.id, qty: r.qty, reason: r.reason, date: r.date, by: r.by_role,
      status: r.status, confirmedBy: r.confirmed_by, confirmedDate: r.confirmed_date
    }))
  }));
}

// ---------- Routes ----------
app.get('/api/items', async (req, res) => {
  try {
    res.json(await getFullItems());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data.' });
  }
});

app.post('/api/items', requirePerm('planning'), async (req, res) => {
  const { spk, xfd, qty } = req.body || {};
  if (!spk || !xfd || !qty || qty <= 0) return res.status(400).json({ error: 'SPK, XFD, dan QTY wajib diisi.' });
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO items (id, spk, xfd, qty, created_by) VALUES ($1,$2,$3,$4,$5)',
    [id, spk, xfd, qty, req.role]
  );
  res.json(await getFullItems());
});

app.post('/api/items/:id/planning', requirePerm('planning'), async (req, res) => {
  await pool.query('UPDATE items SET planning_done = true, planning_date = CURRENT_DATE WHERE id=$1', [req.params.id]);
  res.json(await getFullItems());
});

app.post('/api/items/:id/wh-ready', requirePerm('whReady'), async (req, res) => {
  const { qty, date } = req.body || {};
  if (!qty || qty <= 0 || !date) return res.status(400).json({ error: 'Qty dan tanggal wajib diisi.' });
  await pool.query('INSERT INTO wh_ready_history (item_id, qty, date, by_role) VALUES ($1,$2,$3,$4)', [req.params.id, qty, date, req.role]);
  res.json(await getFullItems());
});

app.post('/api/items/:id/pengambilan', requirePerm('pengambilan'), async (req, res) => {
  const { qty, date } = req.body || {};
  if (!qty || qty <= 0 || !date) return res.status(400).json({ error: 'Qty dan tanggal wajib diisi.' });
  await pool.query('INSERT INTO pengambilan_history (item_id, qty, date, by_role) VALUES ($1,$2,$3,$4)', [req.params.id, qty, date, req.role]);
  res.json(await getFullItems());
});

app.post('/api/items/:id/returan', requirePerm('returanAdd'), async (req, res) => {
  const { qty, reason } = req.body || {};
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Qty wajib diisi.' });
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO returan (id, item_id, qty, reason, date, by_role) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)',
    [id, req.params.id, qty, reason || '', req.role]
  );
  res.json(await getFullItems());
});

app.post('/api/returan/:retId/confirm', requirePerm('returanConfirm'), async (req, res) => {
  await pool.query(
    "UPDATE returan SET status='confirmed', confirmed_by=$1, confirmed_date=CURRENT_DATE WHERE id=$2",
    [req.role, req.params.retId]
  );
  res.json(await getFullItems());
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`)))
  .catch(err => {
    console.error('Gagal konek database:', err);
    process.exit(1);
  });
