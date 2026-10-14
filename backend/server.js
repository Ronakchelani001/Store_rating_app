require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'store_rating',
  multipleStatements: true,
  decimalNumbers: true,
});
const SECRET = process.env.JWT_SECRET || 'dev_secret';
const app = express();
app.use(cors());
app.use(express.json());

const q = async (sql, p) => (await pool.query(sql, p))[0];
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' });
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  });


const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASS = /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,16}$/;
function validate({ name, email, address, password }, needPassword = true) {
  if (!name || name.length < 20 || name.length > 60) throw bad('Name must be 20-60 characters');
  if (!EMAIL.test(email || '')) throw bad('Invalid email');
  if ((address || '').length > 400) throw bad('Address max 400 characters');
  if (needPassword && !PASS.test(password || ''))
    throw bad('Password: 8-16 chars, 1 uppercase, 1 special character');
}


const auth = (...roles) => (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(token, SECRET);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
};


function filterSort(req, filters, sorts, params = []) {
  const where = [];
  for (const k in filters) {
    if (req.query[k]) {
      params.push(`%${req.query[k]}%`);
      where.push(`${filters[k]} LIKE ?`);
    }
  }
  const col = sorts[req.query.sort] || Object.values(sorts)[0];
  const dir = req.query.order === 'desc' ? 'DESC' : 'ASC';
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', order: `ORDER BY ${col} ${dir}`, params };
}

const createUser = async (b, role) => {
  validate(b);
  const hash = await bcrypt.hash(b.password, 10);
  const r = await q('INSERT INTO users(name,email,password,address,role) VALUES(?,?,?,?,?)',
    [b.name, b.email, hash, b.address || '', role]);
  return { id: r.insertId, name: b.name, email: b.email, address: b.address || '', role };
};


app.post('/api/signup', wrap(async (req, res) => res.status(201).json(await createUser(req.body, 'USER'))));

app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const u = (await q('SELECT * FROM users WHERE email=?', [email]))[0];
  if (!u || !(await bcrypt.compare(password || '', u.password))) throw bad('Invalid credentials', 401);
  const token = jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
}));

app.put('/api/password', auth(), wrap(async (req, res) => {
  if (!PASS.test(req.body.password || '')) throw bad('Password: 8-16 chars, 1 uppercase, 1 special character');
  await q('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(req.body.password, 10), req.user.id]);
  res.json({ message: 'Password updated' });
}));


app.get('/api/admin/stats', auth('ADMIN'), wrap(async (req, res) => {
  const c = async (t) => (await q(`SELECT COUNT(*) AS c FROM ${t}`))[0].c;
  res.json({ users: await c('users'), stores: await c('stores'), ratings: await c('ratings') });
}));

app.post('/api/admin/users', auth('ADMIN'), wrap(async (req, res) => {
  const role = ['ADMIN', 'USER', 'OWNER'].includes(req.body.role) ? req.body.role : 'USER';
  res.status(201).json(await createUser(req.body, role));
}));

app.post('/api/admin/stores', auth('ADMIN'), wrap(async (req, res) => {
  const { name, email, address, ownerId } = req.body;
  validate({ name, email, address }, false);
  if (!address) throw bad('Address required');
  const r = await q('INSERT INTO stores(name,email,address,owner_id) VALUES(?,?,?,?)',
    [name, email, address, ownerId || null]);
  res.status(201).json({ id: r.insertId, name, email, address });
}));

app.get('/api/admin/users', auth('ADMIN'), wrap(async (req, res) => {
  const f = { name: 'u.name', email: 'u.email', address: 'u.address', role: 'u.role' };
  const rating = `(SELECT ROUND(AVG(r.rating),1) FROM ratings r JOIN stores s ON s.id=r.store_id WHERE s.owner_id=u.id)`;
  const { where, order, params } = filterSort(req, f, { ...f, rating });
  res.json(await q(`SELECT u.id,u.name,u.email,u.address,u.role,
    CASE WHEN u.role='OWNER' THEN ${rating} END AS rating FROM users u ${where} ${order}`, params));
}));

app.get('/api/admin/stores', auth('ADMIN'), wrap(async (req, res) => {
  const f = { name: 's.name', email: 's.email', address: 's.address' };
  const { where, order, params } = filterSort(req, f, { ...f, rating: 'rating' });
  res.json(await q(`SELECT s.id,s.name,s.email,s.address,COALESCE(ROUND(AVG(r.rating),1),0) AS rating
    FROM stores s LEFT JOIN ratings r ON r.store_id=s.id ${where} GROUP BY s.id ${order}`, params));
}));


app.get('/api/stores', auth('USER'), wrap(async (req, res) => {
  const f = { name: 's.name', address: 's.address' };
  const { where, order, params } = filterSort(req, f, { ...f, rating: 'rating' }, [req.user.id]);
  res.json(await q(`SELECT s.id,s.name,s.address,
    COALESCE(ROUND(AVG(r.rating),1),0) AS rating,
    (SELECT rating FROM ratings WHERE user_id=? AND store_id=s.id) AS my_rating
    FROM stores s LEFT JOIN ratings r ON r.store_id=s.id ${where} GROUP BY s.id ${order}`, params));
}));


app.post('/api/stores/:id/rating', auth('USER'), wrap(async (req, res) => {
  const rating = +req.body.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Rating must be 1 to 5');
  await q(`INSERT INTO ratings(user_id,store_id,rating) VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE rating=VALUES(rating)`, [req.user.id, req.params.id, rating]);
  res.json({ message: 'Rating saved' });
}));


app.get('/api/owner/dashboard', auth('OWNER'), wrap(async (req, res) => {
  const raters = await q(`SELECT u.name,u.email,s.name AS store,r.rating FROM ratings r
    JOIN users u ON u.id=r.user_id JOIN stores s ON s.id=r.store_id WHERE s.owner_id=?`, [req.user.id]);
  const avg = await q(`SELECT ROUND(AVG(r.rating),1) AS average FROM ratings r
    JOIN stores s ON s.id=r.store_id WHERE s.owner_id=?`, [req.user.id]);
  res.json({ average: avg[0].average || 0, raters });
}));


(async () => {
  await q(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
  const email = 'admin@example.com';
  if (!(await q('SELECT 1 FROM users WHERE email=?', [email])).length) {
    await q("INSERT INTO users(name,email,password,address,role) VALUES(?,?,?,'HQ','ADMIN')",
      ['System Administrator Account', email, await bcrypt.hash('Admin@123', 10)]);
    console.log('Default admin created: admin@example.com / Admin@123');
  }
  app.listen(process.env.PORT || 5000, () => console.log('API running'));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
