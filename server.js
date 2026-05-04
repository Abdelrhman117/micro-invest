/* ================================================================
   server.js — Micro-Invest Backend (Node.js + Express + JSON FS)
   ----------------------------------------------------------------
   Author  : BIS Graduation Project
   Purpose : RESTful API server using local database.json (No SQLite)
             Features: Auth, Round-Up Simulation, Admin Panel.
   ================================================================ */

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = 3000;

// ── مسار قاعدة البيانات ──────────────────────────────────────────
// على Vercel الـ filesystem محمي — نكتب على /tmp
const DB_PATH = process.env.VERCEL
  ? '/tmp/database.json'
  : path.join(__dirname, 'database.json');

// دوال قراءة وكتابة البيانات في الملف
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

/* ================================================================
   1. تهيئة قاعدة البيانات (DATABASE INITIALISATION)
   ================================================================ */
function initDatabase() {
  // لو الملف مش موجود، نكريته ببيانات فاضية
  if (!fs.existsSync(DB_PATH)) {
    writeDB({ users: [], transactions: [] });
  }

  const db = readDB();
  
  // التأكد من وجود حساب الأدمن الافتراضي
  const adminExists = db.users.find(u => u.role === 'admin');
  if (!adminExists) {
    db.users.push({
      id: 1,
      name: 'Admin',
      email: 'admin@microinvest.eg',
      password_hash: hashPassword('admin123'),
      role: 'admin',
      total_balance: 0.0,
      gold_balance: 0.0,
      tbill_balance: 0.0,
      created_at: new Date().toISOString()
    });
    writeDB(db);
    console.log('✅ Default admin seeded — email: admin@microinvest.eg | password: admin123');
  }

  console.log('✅ Database initialised using JSON at:', DB_PATH);
}

/* ================================================================
   2. إعدادات السيرفر (MIDDLEWARE)
   ================================================================ */
app.use(cors());
app.use(express.json());
// تقديم ملفات الواجهة الأمامية من فولدر public
app.use(express.static(path.join(__dirname, 'public')));

/* ================================================================
   3. دوال الحماية والتشفير (AUTH HELPERS)
   ================================================================ */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'micro_invest_salt_2025').digest('hex');
}

const sessions = new Map();

function createSession(userId, role) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  sessions.set(token, { userId, role, expiresAt });
  return token;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No session token provided. Please log in.' });
  }
  const token   = authHeader.split(' ')[1];
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  req.user = { userId: session.userId, role: session.role };
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
}

/* ================================================================
   4. مسارات تسجيل الدخول (AUTH ROUTES)
   ================================================================ */
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, initialDeposit } = req.body;

  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  
  const deposit = parseFloat(initialDeposit) || 0;
  if (deposit < 0) return res.status(400).json({ error: 'Initial deposit cannot be negative.' });

  const db = readDB();
  
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const newId = db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
  const newUser = {
    id: newId,
    name,
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    role: 'user',
    total_balance: deposit,
    gold_balance: 0.0,
    tbill_balance: 0.0,
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDB(db);

  const token = createSession(newUser.id, 'user');
  return res.status(201).json({
    message : 'Account created successfully!',
    token,
    user    : { id: newUser.id, name, email, role: 'user' }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const db = readDB();
  const user = db.users.find(u => u.email === email.toLowerCase());

  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = createSession(user.id, user.role);
  return res.status(200).json({
    message : 'Login successful!',
    token,
    user    : { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  sessions.delete(token);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

/* ================================================================
   5. مسارات المستخدم (USER ROUTES)
   ================================================================ */
app.get('/api/user/data', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Exclude password hash from response
  const { password_hash, ...safeUser } = user;
  
  const transactions = db.transactions
    .filter(t => t.user_id === req.user.userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return res.status(200).json({ user: safeUser, transactions });
});

app.post('/api/user/deposit', requireAuth, (req, res) => {
  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount < 10) return res.status(400).json({ error: 'Minimum deposit is 10 EGP.' });

  const db = readDB();
  const userIndex = db.users.findIndex(u => u.id === req.user.userId);
  db.users[userIndex].total_balance += amount;
  writeDB(db);

  return res.status(200).json({
    message        : `${amount} EGP deposited to your main balance.`,
    updatedBalances: { total_balance: db.users[userIndex].total_balance, gold_balance: db.users[userIndex].gold_balance, tbill_balance: db.users[userIndex].tbill_balance }
  });
});

/* ================================================================
   6. مسارات العمليات (TRANSACTION ROUTES - BIS CORE LOGIC)
   ================================================================ */
app.post('/api/transaction/simulate', requireAuth, (req, res) => {
  const { itemName, originalPrice, asset } = req.body;
  const db = readDB();
  const userIndex = db.users.findIndex(u => u.id === req.user.userId);

  if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });
  if (!itemName || typeof itemName !== 'string' || itemName.trim().length === 0) return res.status(400).json({ error: 'Item name is required.' });
  
  const price = parseFloat(originalPrice);
  if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'Please provide a valid price greater than 0.' });
  if (!['gold', 'tbill'].includes(asset)) return res.status(400).json({ error: "Asset must be 'gold' or 'tbill'." });

  // ── معادلة التقريب لأقرب 10 جنيهات (مثال: 45 تقرب إلى 50) ──
  const roundedAmount  = Math.ceil(price / 10) * 10;
  const investedAmount = parseFloat((roundedAmount - price).toFixed(2));

  if (investedAmount === 0) {
    return res.status(400).json({ error: `${price} EGP is already a multiple of 10. No round-up to invest!` });
  }

  const user = db.users[userIndex];
  if (user.total_balance < roundedAmount) {
    return res.status(400).json({ error: `Insufficient balance. You need ${roundedAmount} EGP but have ${user.total_balance.toFixed(2)} EGP.` });
  }

  // تحديث الأرصدة
  user.total_balance -= roundedAmount;
  if (asset === 'gold') user.gold_balance += investedAmount;
  else user.tbill_balance += investedAmount;

  // تسجيل العملية
  const newTxId = db.transactions.length > 0 ? Math.max(...db.transactions.map(t => t.id)) + 1 : 1;
  const newTx = {
    id: newTxId,
    user_id: user.id,
    item_name: itemName.trim(),
    original_price: price,
    rounded_amount: roundedAmount,
    invested_amount: investedAmount,
    asset: asset,
    type: 'purchase',
    created_at: new Date().toISOString()
  };

  db.transactions.push(newTx);
  db.users[userIndex] = user;
  writeDB(db); 

  return res.status(201).json({
    message        : `Round-up of ${investedAmount} EGP invested in ${asset === 'gold' ? 'Digital Gold' : 'T-Bills'}! 🎉`,
    roundedAmount,
    investedAmount,
    transaction    : newTx,
    updatedBalances: { total_balance: user.total_balance, gold_balance: user.gold_balance, tbill_balance: user.tbill_balance }
  });
});

app.post('/api/transaction/withdraw', requireAuth, (req, res) => {
  const { amount, source } = req.body;
  const db = readDB();
  const userIndex = db.users.findIndex(u => u.id === req.user.userId);
  const user = db.users[userIndex];
  const withdrawAmount = parseFloat(amount);

  if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ error: 'Invalid amount.' });
  if (!['gold', 'tbill', 'all'].includes(source)) return res.status(400).json({ error: "Invalid source." });

  let available = source === 'gold' ? user.gold_balance : source === 'tbill' ? user.tbill_balance : user.gold_balance + user.tbill_balance;
  if (withdrawAmount > available) return res.status(400).json({ error: `Insufficient ${source} balance.` });

  if (source === 'gold') user.gold_balance -= withdrawAmount;
  else if (source === 'tbill') user.tbill_balance -= withdrawAmount;
  else {
    const total = user.gold_balance + user.tbill_balance;
    const goldShare = parseFloat((withdrawAmount * (user.gold_balance / total)).toFixed(2));
    user.gold_balance -= goldShare;
    user.tbill_balance -= (withdrawAmount - goldShare);
  }

  user.total_balance += withdrawAmount;

  const newTxId = db.transactions.length > 0 ? Math.max(...db.transactions.map(t => t.id)) + 1 : 1;
  db.transactions.push({
    id: newTxId,
    user_id: user.id,
    item_name: source === 'gold' ? 'Gold Withdrawal' : source === 'tbill' ? 'T-Bills Withdrawal' : 'Full Withdrawal',
    original_price: withdrawAmount,
    rounded_amount: withdrawAmount,
    invested_amount: -withdrawAmount,
    asset: source === 'all' ? 'gold' : source,
    type: 'withdrawal',
    created_at: new Date().toISOString()
  });

  db.users[userIndex] = user;
  writeDB(db);

  return res.status(200).json({
    message        : `Withdrawal of ${withdrawAmount} EGP complete!`,
    updatedBalances: { total_balance: user.total_balance, gold_balance: user.gold_balance, tbill_balance: user.tbill_balance }
  });
});

/* ================================================================
   7. مسارات الأدمن (ADMIN ROUTES)
   ================================================================ */
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const db = readDB();
  
  const users = db.users
    .filter(u => u.role !== 'admin')
    .map(({ password_hash, ...safeUser }) => safeUser)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total_users = users.length;
  const total_aum = users.reduce((sum, u) => sum + u.gold_balance + u.tbill_balance, 0);
  const userIds = users.map(u => u.id);
  
  const allUserTxs = db.transactions.filter(t => userIds.includes(t.user_id));
  const total_transactions = allUserTxs.length;
  const total_invested = allUserTxs.filter(t => t.type === 'purchase').reduce((sum, t) => sum + t.invested_amount, 0);

  const recentActivity = db.transactions
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20)
    .map(t => {
      const u = db.users.find(user => user.id === t.user_id);
      return { ...t, user_name: u ? u.name : 'Unknown', user_email: u ? u.email : 'Unknown' };
    });

  return res.status(200).json({
    users,
    stats: { total_users, total_aum, total_transactions, total_invested },
    recentActivity
  });
});

/* ================================================================
   8. تشغيل السيرفر (SERVER START)
   ================================================================ */
initDatabase();

// Vercel serverless: export app بدل app.listen
// محلياً: شغّل السيرفر عادي
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║       Micro-Invest Server  v3.0  Running          ║');
    console.log('║       (JSON File Storage - Clean Version)         ║');
    console.log(`║       http://localhost:${PORT}                       ║`);
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('  Default admin  →  admin@microinvest.eg  /  admin123');
    console.log('  Database file  →  database.json');
    console.log('');
  });
}

module.exports = app;