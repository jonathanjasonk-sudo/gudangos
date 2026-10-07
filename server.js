const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const crypto = require('crypto');
const buildExportWorkbook = require('./exportWorkbook');
const buildSpkTemplateWorkbook = buildExportWorkbook.buildSpkTemplate;
const ACCOUNTS = require('./accounts');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  // Run each CREATE TABLE separately — pg driver may fail on multi-statement strings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      spk TEXT NOT NULL,
      customer TEXT NOT NULL DEFAULT '',
      materials TEXT[] NOT NULL DEFAULT ARRAY['Shoe Box', 'Size Label', 'Karton Label', 'Marking'],
      xfd DATE NOT NULL,
      qty INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT now(),
      created_by TEXT,
      planning_done BOOLEAN DEFAULT false,
      planning_date DATE
    )
  `);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS customer TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS materials TEXT[] NOT NULL DEFAULT ARRAY['Shoe Box', 'Size Label', 'Karton Label', 'Marking']`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS building TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS items_building_idx ON items (building)`);
  await pool.query(`UPDATE items SET spk = upper(btrim(spk)) WHERE spk <> upper(btrim(spk))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spk_master (
      spk TEXT PRIMARY KEY,
      style TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      xfd DATE NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spk_import_history (
      id BIGSERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      imported_by TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      total_spks INTEGER NOT NULL,
      new_spks INTEGER NOT NULL,
      updated_spks INTEGER NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE spk_import_history ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`
    INSERT INTO spk_master (spk, style, customer, xfd, qty)
    SELECT DISTINCT ON (spk) spk, style, customer, xfd, qty
    FROM (
      SELECT upper(btrim(spk)) AS spk, style, customer, xfd, qty, created_at
      FROM items WHERE btrim(spk) <> ''
    ) legacy
    ORDER BY spk, created_at DESC
    ON CONFLICT (spk) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wh_ready_history (
      id SERIAL PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      date DATE NOT NULL,
      by_role TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pengambilan_history (
      id SERIAL PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      date DATE NOT NULL,
      by_role TEXT
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`ALTER TABLE returan ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'gudang'`);
  await pool.query(`ALTER TABLE wh_ready_history ADD COLUMN IF NOT EXISTS pic TEXT`);
  await pool.query(`ALTER TABLE wh_ready_history ADD COLUMN IF NOT EXISTS material TEXT DEFAULT 'IP'`);
  await pool.query(`ALTER TABLE wh_ready_history ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE pengambilan_history ADD COLUMN IF NOT EXISTS pic TEXT`);
  await pool.query(`ALTER TABLE pengambilan_history ADD COLUMN IF NOT EXISTS material TEXT DEFAULT 'IP'`);
  await pool.query(`ALTER TABLE pengambilan_history ADD COLUMN IF NOT EXISTS notes TEXT`);
  console.log('Database siap.');
}

// ---------- Auth ----------
// Password akun wajib disediakan melalui environment variables.
const ROLE_PASS = Object.fromEntries(Object.entries(ACCOUNTS).map(([role, account])=>[
  role,
  role === 'PRODUKSI' ? null : process.env[account.passwordEnv]
]));
const SECRET = process.env.AUTH_SECRET || 'ganti-secret-ini-di-railway';
const MATERIALS = ['Shoe Box', 'Size Label', 'Karton Label', 'Marking'];
const BUILDINGS = ['C', 'D', 'I', 'E', 'F', 'H'];
const BUILDING_PASS = Object.fromEntries(BUILDINGS.map(building=>[
  building,
  process.env[`${ACCOUNTS.PRODUKSI.passwordEnvPrefix}${building}`]
]));

function normalizeSpk(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function excelCellText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  return String(value).trim();
}

function excelDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const text = excelCellText(value);
  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return '';
  const iso = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : '';
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function makeToken(role, building=null) {
  const identity = building ? `${role}:${building}` : role;
  const sig = crypto.createHmac('sha256', SECRET).update(identity).digest('hex');
  return Buffer.from(`${identity}.${sig}`).toString('base64');
}
function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const separator = decoded.lastIndexOf('.');
    if (separator < 1) return null;
    const identity = decoded.slice(0, separator);
    const sig = decoded.slice(separator + 1);
    const [role, building] = identity.split(':');
    const expected = crypto.createHmac('sha256', SECRET).update(identity).digest('hex');
    const validProduction = role === 'PRODUKSI' && BUILDINGS.includes(building) && BUILDING_PASS[building];
    const validOtherRole = role !== 'PRODUKSI' && !building && ROLE_PASS[role];
    if (sig === expected && (validProduction || validOtherRole)) return { role, building: building || null };
    return null;
  } catch (e) {
    return null;
  }
}
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  const identity = token ? verifyToken(token) : null;
  req.role = identity?.role || null; // null kalau tidak login / view-only
  req.building = identity?.building || null;
  next();
}
const PERMS = {};
for (const [role, account] of Object.entries(ACCOUNTS)) {
  for (const permission of account.apiPermissions) {
    if (!PERMS[permission]) PERMS[permission] = [];
    PERMS[permission].push(role);
  }
}
function requirePerm(key) {
  return (req, res, next) => {
    if (!req.role || !PERMS[key].includes(req.role)) {
      return res.status(403).json({ error: 'Akses ditolak untuk peran ini.' });
    }
    next();
  };
}

app.use(authMiddleware);

app.get('/api/roles', (req, res) => {
  const roles = Object.fromEntries(Object.entries(ACCOUNTS).map(([role, account])=>[
    role,
    {label: account.label, full: account.full, uiPermissions: account.uiPermissions, buildings: role === 'PRODUKSI' ? BUILDINGS : []}
  ]));
  res.json(roles);
});

app.post('/api/login', (req, res) => {
  const { role, building, passcode } = req.body || {};
  if (role === 'PRODUKSI') {
    if (!BUILDINGS.includes(building)) return res.status(400).json({ error: 'Pilih gedung Produksi terlebih dahulu.' });
    const buildingPass = BUILDING_PASS[building];
    if (!buildingPass) return res.status(503).json({ error: `Password Gedung ${building} belum disetel di Railway (${ACCOUNTS.PRODUKSI.passwordEnvPrefix}${building}).` });
    if (passcode !== buildingPass) return res.status(401).json({ error: 'Passcode salah.' });
    return res.json({ token: makeToken(role, building), role, building });
  }
  if (!ROLE_PASS[role] || passcode !== ROLE_PASS[role]) {
    return res.status(401).json({ error: 'Passcode salah.' });
  }
  res.json({ token: makeToken(role), role });
});

// ---------- Helpers ----------
async function getFullItems(req=null) {
  const productionScope=req?.role==='PRODUKSI';
  const fullAccess=!req?.role||['MARKETING','MASTER'].includes(req.role);
  const accessFilter=productionScope?"WHERE items.building=$1 OR items.created_by IN ('MARKETING','MASTER')":fullAccess?'':'WHERE false';
  const items = (await pool.query(`
    SELECT items.*, spk_master.style AS master_style, spk_master.customer AS master_customer,
      spk_master.xfd AS master_xfd, spk_master.qty AS master_qty
    FROM items LEFT JOIN spk_master ON spk_master.spk = items.spk
    ${accessFilter}
    ORDER BY items.created_at DESC
  `,productionScope?[req.building]:[])).rows;
  const wh = (await pool.query('SELECT * FROM wh_ready_history ORDER BY date ASC')).rows;
  const peng = (await pool.query('SELECT * FROM pengambilan_history ORDER BY date ASC')).rows;
  const ret = (await pool.query('SELECT * FROM returan ORDER BY date DESC')).rows;

  return items.map(it => ({
    id: it.id,
    spk: it.spk,
    building: it.building || null,
    style: it.master_style || it.style || '',
    customer: it.master_customer || it.customer || '',
    materials: it.materials || MATERIALS,
    xfd: it.master_xfd || it.xfd,
    qty: it.master_qty || it.qty,
    createdAt: it.created_at,
    createdBy: it.created_by,
    planning: { done: it.planning_done, date: it.planning_date },
    whReady: { history: wh.filter(h => h.item_id === it.id).map(h => ({ qty: h.qty, date: h.date, by: h.by_role, pic: h.pic, material: h.material || 'IP', notes: h.notes })) },
    pengambilan: { history: peng.filter(h => h.item_id === it.id).map(h => ({ id: h.id, qty: h.qty, date: h.date, by: h.by_role, pic: h.pic, material: h.material || 'IP', notes: h.notes })) },
    returan: ret.filter(r => r.item_id === it.id).map(r => ({
      id: r.id, qty: r.qty, reason: r.reason, date: r.date, by: r.by_role,
      type: r.type || 'gudang',
      status: r.status, confirmedBy: r.confirmed_by, confirmedDate: r.confirmed_date
    }))
  }));
}

// ---------- Routes ----------
app.get('/api/items', async (req, res) => {
  try {
    res.json(await getFullItems(req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil data.' });
  }
});

app.get('/api/spk', requirePerm('addItem'), async (req, res) => {
  try {
    const search = normalizeSpk(req.query.search || '');
    if (!search) return res.json([]);
    const masters = (await pool.query(
      'SELECT spk, style, customer, xfd, qty FROM spk_master WHERE spk ILIKE $1 ORDER BY CASE WHEN spk=$2 THEN 0 WHEN spk ILIKE $3 THEN 1 ELSE 2 END, spk LIMIT 20',
      [`%${search}%`, search, `${search}%`]
    )).rows;
    if (!masters.length) return res.json([]);
    const requested = (await pool.query(
      'SELECT spk, materials FROM items WHERE spk = ANY($1::text[])',
      [masters.map(master => master.spk)]
    )).rows;
    const requestedBySpk = new Map();
    for (const row of requested) {
      if (!requestedBySpk.has(row.spk)) requestedBySpk.set(row.spk, new Set());
      for (const material of row.materials || []) requestedBySpk.get(row.spk).add(material);
    }
    res.json(masters.map(master => ({
      ...master,
      requestedMaterials: [...(requestedBySpk.get(master.spk) || [])]
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mencari SPK.' });
  }
});

app.post('/api/spk/lookup', requirePerm('addItem'), async (req, res) => {
  try {
    const spks = Array.isArray(req.body?.spks) ? [...new Set(req.body.spks.map(normalizeSpk).filter(Boolean))].slice(0, 200) : [];
    if (!spks.length) return res.status(400).json({ error: 'Isi minimal satu SPK untuk dicari.' });
    const masters = (await pool.query(
      'SELECT spk, style, customer, xfd, qty FROM spk_master WHERE spk = ANY($1::text[])',
      [spks]
    )).rows;
    const requested = (await pool.query(
      'SELECT spk, materials FROM items WHERE spk = ANY($1::text[])',
      [spks]
    )).rows;
    const requestedBySpk = new Map();
    for (const row of requested) {
      if (!requestedBySpk.has(row.spk)) requestedBySpk.set(row.spk, new Set());
      for (const material of row.materials || []) requestedBySpk.get(row.spk).add(material);
    }
    res.json({
      results: masters.map(master => ({
        ...master,
        requestedMaterials: [...(requestedBySpk.get(master.spk) || [])]
      })),
      missing: spks.filter(spk => !masters.some(master => master.spk === spk))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mencari SPK.' });
  }
});

app.get('/api/spk/import-history', requirePerm('importSpk'), async (req, res) => {
  try {
    const history = (await pool.query(
      'SELECT id, file_name, imported_by, imported_at, total_spks, new_spks, updated_spks FROM spk_import_history ORDER BY imported_at DESC LIMIT 200'
    )).rows;
    res.json(history);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal mengambil riwayat impor.' });
  }
});

app.get('/api/spk/import-history/:id/details', requirePerm('importSpk'), async (req, res) => {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'ID riwayat import tidak valid.'});
  try {
    const row=(await pool.query('SELECT details FROM spk_import_history WHERE id=$1',[id])).rows[0];
    if(!row) return res.status(404).json({error:'Riwayat import tidak ditemukan.'});
    res.json({details:row.details||[]});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'Gagal mengambil detail import.'});
  }
});

app.get('/api/spk/template.xlsx', requirePerm('exportFile'), async (req, res) => {
  try {
    const workbook = await buildSpkTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Template-Master-SPK.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat template Excel.' });
  }
});

app.post('/api/spk/import', requirePerm('importSpk'), express.raw({
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  limit: '15mb'
}), async (req, res) => {
  let client;
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Pilih file Excel .xlsx terlebih dahulu.' });
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.body);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      return res.status(400).json({ error: 'File Excel belum berisi data SPK.' });
    }
    const headerColumns = {};
    worksheet.getRow(1).eachCell((cell, column) => {
      headerColumns[excelCellText(cell.value).toUpperCase()] = column;
    });
    const requiredHeaders = ['SPK', 'STYLE', 'CUSTOMER', 'XFD', 'QTY'];
    const missingHeaders = requiredHeaders.filter(header => !headerColumns[header]);
    if (missingHeaders.length) {
      return res.status(400).json({ error: `Kolom wajib tidak ditemukan: ${missingHeaders.join(', ')}.` });
    }
    const records = new Map();
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const values = Object.fromEntries(requiredHeaders.map(header => [header, row.getCell(headerColumns[header]).value]));
      if (requiredHeaders.every(header => excelCellText(values[header]) === '')) continue;
      const record = {
        spk: normalizeSpk(excelCellText(values.SPK)),
        style: excelCellText(values.STYLE),
        customer: excelCellText(values.CUSTOMER),
        xfd: excelDate(values.XFD),
        qty: Number(values.QTY)
      };
      if (!record.spk || !record.style || !record.customer || !validDate(record.xfd) || !Number.isInteger(record.qty) || record.qty <= 0) {
        return res.status(400).json({ error: `Data baris ${rowNumber} tidak valid. Isi SPK, STYLE, CUSTOMER, XFD, dan QTY dengan benar.` });
      }
      records.set(record.spk, record);
      if (records.size > 10000) return res.status(400).json({ error: 'Maksimal 10.000 SPK per file.' });
    }
    if (!records.size) return res.status(400).json({ error: 'Tidak ada baris SPK yang dapat diimpor.' });

    client = await pool.connect();
    await client.query('BEGIN');
    let newSpks = 0;
    let updatedSpks = 0;
    const importDetails=[];
    for (const record of records.values()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [record.spk]);
      const saved = await client.query(
        `INSERT INTO spk_master (spk, style, customer, xfd, qty, updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (spk) DO UPDATE SET style=EXCLUDED.style, customer=EXCLUDED.customer,
           xfd=EXCLUDED.xfd, qty=EXCLUDED.qty, updated_at=now()
         RETURNING (xmax = 0) AS inserted`,
        [record.spk, record.style, record.customer, record.xfd, record.qty]
      );
      const inserted=saved.rows[0].inserted;
      if (inserted) newSpks++;
      else updatedSpks++;
      importDetails.push({...record, status:inserted?'Baru':'Diperbarui'});
    }
    let fileName = req.headers['x-file-name'] || 'Import-SPK.xlsx';
    try { fileName = decodeURIComponent(fileName); } catch (e) { fileName = 'Import-SPK.xlsx'; }
    fileName = fileName.split(/[\\/]/).pop().replace(/[\r\n]/g, '').slice(0, 200) || 'Import-SPK.xlsx';
    await client.query(
      'INSERT INTO spk_import_history (file_name, imported_by, total_spks, new_spks, updated_spks, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [fileName, req.role, records.size, newSpks, updatedSpks, JSON.stringify(importDetails)]
    );
    await client.query('COMMIT');
    res.json({ imported: records.size, newSpks, updatedSpks });
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error(e);
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Gagal mengimpor data SPK.' });
  } finally {
    if (client) client.release();
  }
});

app.get('/api/export.xlsx', requirePerm('exportFile'), async (req, res) => {
  try {
    const workbook = await buildExportWorkbook(await getFullItems(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Marketing-System.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat file Excel.' });
  }
});

async function createRequest(client, role, building, item) {
  const spk = normalizeSpk(item.spk);
  const requestedMaterials = Array.isArray(item.materials) ? [...new Set(item.materials)] : [];
  if (!spk || !requestedMaterials.length || requestedMaterials.some(material => !MATERIALS.includes(material))) {
    const error = new Error('SPK dan minimal satu material yang valid wajib dipilih.');
    error.status = 400;
    throw error;
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [spk]);
  let master = (await client.query('SELECT * FROM spk_master WHERE spk=$1', [spk])).rows[0];
  if (!master) {
    const style = typeof item.style === 'string' ? item.style.trim() : '';
    const customer = typeof item.customer === 'string' ? item.customer.trim() : '';
    const xfd = item.xfd;
    const qty = Number(item.qty);
    if (!style || !customer || !validDate(xfd) || !Number.isInteger(qty) || qty <= 0) {
      const error = new Error('SPK baru wajib dilengkapi STYLE, CUSTOMER, XFD, dan QTY yang valid.');
      error.status = 400;
      throw error;
    }
    master = (await client.query(
      'INSERT INTO spk_master (spk, style, customer, xfd, qty) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [spk, style, customer, xfd, qty]
    )).rows[0];
  }
  const existing = (await client.query('SELECT materials FROM items WHERE spk=$1', [spk])).rows;
  const usedMaterials = new Set(existing.flatMap(row => row.materials || []));
  const duplicates = requestedMaterials.filter(material => usedMaterials.has(material));
  if (duplicates.length) {
    const error = new Error(`Material sudah pernah diminta untuk ${spk}: ${duplicates.join(', ')}.`);
    error.status = 409;
    throw error;
  }
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO items (id, spk, style, customer, materials, xfd, qty, created_by, building, planning_done, planning_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,CURRENT_DATE)`,
    [id, spk, master.style, master.customer, requestedMaterials, master.xfd, master.qty, role, role==='PRODUKSI'?building:null]
  );
  return id;
}

async function requireBuildingOwnership(req, res, next) {
  if(req.role!=='PRODUKSI') return next();
  try{
    const item=await pool.query('SELECT 1 FROM items WHERE id=$1 AND building=$2',[req.params.id,req.building]);
    if(!item.rowCount) return res.status(404).json({error:'Request tidak ditemukan untuk gedung ini.'});
    next();
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Gagal memeriksa akses request.'});
  }
}

async function requireTakenAccess(req, res, next) {
  if(req.role!=='PRODUKSI') return next();
  try{
    const item=await pool.query("SELECT 1 FROM items WHERE id=$1 AND (building=$2 OR created_by IN ('MARKETING','MASTER'))",[req.params.id,req.building]);
    if(!item.rowCount) return res.status(404).json({error:'Request tidak ditemukan atau tidak dapat diakses.'});
    next();
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Gagal memeriksa akses request.'});
  }
}

app.post('/api/items', requirePerm('addItem'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createRequest(client, req.role, req.building, req.body || {});
    await client.query('COMMIT');
    res.json(await getFullItems(req));
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan request.' });
  } finally {
    client.release();
  }
});

app.post('/api/items/bulk', requirePerm('addItem'), async (req, res) => {
  let client;
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Array items wajib diisi.' });
    const limited = items.slice(0, 200);
    client = await pool.connect();
    await client.query('BEGIN');
    for (const item of limited) {
      await createRequest(client, req.role, req.building, item || {});
    }
    await client.query('COMMIT');
    res.json(await getFullItems(req));
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan data.' });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/items/:id/planning', requirePerm('planning'), requireBuildingOwnership, async (req, res) => {
  await pool.query('UPDATE items SET planning_done = true, planning_date = CURRENT_DATE WHERE id=$1', [req.params.id]);
  res.json(await getFullItems(req));
});

app.post('/api/items/:id/wh-ready', requirePerm('whReady'), requireBuildingOwnership, async (req, res) => {
  const { qty, date, pic, material, notes } = req.body || {};
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0 || !date || !MATERIALS.includes(material)) {
    return res.status(400).json({ error: 'Qty, tanggal, dan material yang valid wajib diisi.' });
  }
  const item = (await pool.query('SELECT qty, materials FROM items WHERE id=$1', [req.params.id])).rows[0];
  if (!item) return res.status(404).json({ error: 'Request tidak ditemukan.' });
  if (!item.materials.includes(material)) return res.status(400).json({ error: 'Material ini tidak diminta pada request.' });
  const used = (await pool.query('SELECT COALESCE(SUM(qty),0)::int AS total FROM wh_ready_history WHERE item_id=$1 AND material=$2', [req.params.id, material])).rows[0].total;
  if (Number(used) + Number(qty) > item.qty) return res.status(400).json({ error: `Qty melebihi sisa material (${item.qty - Number(used)}).` });
  await pool.query('INSERT INTO wh_ready_history (item_id, qty, date, by_role, pic, material, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.params.id, Number(qty), date, req.role, pic || null, material, notes || null]);
  res.json(await getFullItems(req));
});

app.post('/api/items/:id/pengambilan', requirePerm('pengambilan'), requireTakenAccess, async (req, res) => {
  const { qty, date, pic, material, notes } = req.body || {};
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0 || !date || !MATERIALS.includes(material)) {
    return res.status(400).json({ error: 'Qty, tanggal, dan material yang valid wajib diisi.' });
  }
  const item = (await pool.query('SELECT qty, materials FROM items WHERE id=$1', [req.params.id])).rows[0];
  if (!item) return res.status(404).json({ error: 'Request tidak ditemukan.' });
  if (!item.materials.includes(material)) return res.status(400).json({ error: 'Material ini tidak diminta pada request.' });
  const used = (await pool.query('SELECT COALESCE(SUM(qty),0)::int AS total FROM pengambilan_history WHERE item_id=$1 AND material=$2', [req.params.id, material])).rows[0].total;
  if (Number(used) + Number(qty) > item.qty) return res.status(400).json({ error: `Qty melebihi sisa material (${item.qty - Number(used)}).` });
  await pool.query('INSERT INTO pengambilan_history (item_id, qty, date, by_role, pic, material, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.params.id, Number(qty), date, req.role, pic || null, material, notes || null]);
  res.json(await getFullItems(req));
});

app.delete('/api/items/:id/pengambilan/:historyId', requirePerm('deletePengambilan'), async (req, res) => {
  const historyId = Number(req.params.historyId);
  if (!Number.isSafeInteger(historyId) || historyId <= 0) {
    return res.status(400).json({ error: 'ID riwayat Taken tidak valid.' });
  }
  try {
    const result = await pool.query(
      'DELETE FROM pengambilan_history WHERE id=$1 AND item_id=$2 RETURNING id',
      [historyId, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Riwayat Taken tidak ditemukan.' });
    res.json(await getFullItems(req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menghapus riwayat Taken.' });
  }
});

app.post('/api/items/:id/returan', requirePerm('returanAdd'), requireBuildingOwnership, async (req, res) => {
  const { qty, reason, type } = req.body || {};
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Qty wajib diisi.' });
  const validType = type === 'closing' ? 'closing' : 'gudang';
  const id = crypto.randomUUID();
  if (validType === 'closing') {
    // Closingan = auto-confirmed — indicates material has been replaced
    await pool.query(
      "INSERT INTO returan (id, item_id, qty, reason, date, by_role, type, status, confirmed_by, confirmed_date) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,'confirmed',$7,CURRENT_DATE)",
      [id, req.params.id, qty, reason || '', req.role, 'closing', req.role]
    );
  } else {
    await pool.query(
      'INSERT INTO returan (id, item_id, qty, reason, date, by_role, type) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6)',
      [id, req.params.id, qty, reason || '', req.role, 'gudang']
    );
  }
  res.json(await getFullItems(req));
});

app.post('/api/returan/:retId/confirm', requirePerm('returanConfirm'), async (req, res) => {
  await pool.query(
    "UPDATE returan SET status='confirmed', confirmed_by=$1, confirmed_date=CURRENT_DATE WHERE id=$2",
    [req.role, req.params.retId]
  );
  res.json(await getFullItems(req));
});

app.delete('/api/items/:id', requirePerm('planning'), requireBuildingOwnership, async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id=$1', [req.params.id]);
    res.json(await getFullItems(req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menghapus item.' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDb();
  } catch (err) {
    console.error('Gagal init database:', err.message);
    // Tetap lanjut listen agar Railway tidak anggap crash saat DB belum siap
    // Railway akan restart container jika proses mati
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Server jalan di port ${PORT}`));
}

startServer();
