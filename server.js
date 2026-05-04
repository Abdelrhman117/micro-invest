/* ================================================================
   server.js — Micro-Invest v4.0 (Firebase Firestore Edition)
   ================================================================ */

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');
const admin   = require('firebase-admin');

const app  = express();
const PORT = 3000;

/* ================================================================
   1. FIREBASE INIT
   ================================================================ */
if (!admin.apps.length) {
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT
    ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : admin.credential.applicationDefault();

  admin.initializeApp({ credential, projectId: 'micro-41ee6' });
}

const db      = admin.firestore();
const usersCol = db.collection('users');
const txCol    = db.collection('transactions');

/* ================================================================
   2. MIDDLEWARE
   ================================================================ */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ================================================================
   3. AUTH HELPERS
   ================================================================ */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'micro_invest_salt_2025').digest('hex');
}

const sessions = new Map();

function createSession(userId, role) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
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
   4. DATABASE SEED — ينشئ حساب الأدمن لو مش موجود
   ================================================================ */
async function initDatabase() {
  const adminSnap = await usersCol.where('role', '==', 'admin').limit(1).get();
  if (adminSnap.empty) {
    await usersCol.doc('admin').set({
      id           : 'admin',
      name         : 'Admin',
      email        : 'admin@microinvest.eg',
      password_hash: hashPassword('admin123'),
      role         : 'admin',
      total_balance: 0,
      gold_balance : 0,
      tbill_balance: 0,
      created_at   : new Date().toISOString()
    });
    console.log('✅ Default admin seeded — admin@microinvest.eg / admin123');
  }
  console.log('✅ Firestore connected — project: micro-41ee6');
}

/* ================================================================
   5. AUTH ROUTES
   ================================================================ */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, initialDeposit } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const deposit = parseFloat(initialDeposit) || 0;
    if (deposit < 0)
      return res.status(400).json({ error: 'Initial deposit cannot be negative.' });

    const existing = await usersCol.where('email', '==', email.toLowerCase()).limit(1).get();
    if (!existing.empty)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const newRef  = usersCol.doc();
    const newUser = {
      id           : newRef.id,
      name,
      email        : email.toLowerCase(),
      password_hash: hashPassword(password),
      role         : 'user',
      total_balance: deposit,
      gold_balance : 0,
      tbill_balance: 0,
      created_at   : new Date().toISOString()
    };
    await newRef.set(newUser);

    const token = createSession(newRef.id, 'user');
    return res.status(201).json({
      message: 'Account created successfully!',
      token,
      user   : { id: newRef.id, name, email: newUser.email, role: 'user' }
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const snap = await usersCol.where('email', '==', email.toLowerCase()).limit(1).get();
    if (snap.empty || snap.docs[0].data().password_hash !== hashPassword(password))
      return res.status(401).json({ error: 'Invalid email or password.' });

    const userDoc = snap.docs[0];
    const user    = userDoc.data();
    const token   = createSession(userDoc.id, user.role);

    return res.status(200).json({
      message: 'Login successful!',
      token,
      user   : { id: userDoc.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers.authorization.split(' ')[1]);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

/* ================================================================
   6. USER ROUTES
   ================================================================ */
app.get('/api/user/data', requireAuth, async (req, res) => {
  try {
    const userDoc = await usersCol.doc(req.user.userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found.' });

    const { password_hash, ...safeUser } = userDoc.data();

    const txSnap = await txCol
      .where('user_id', '==', req.user.userId)
      .orderBy('created_at', 'desc')
      .get();
    const transactions = txSnap.docs.map(d => d.data());

    return res.status(200).json({ user: safeUser, transactions });
  } catch (err) {
    console.error('user/data error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/user/deposit', requireAuth, async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount < 10)
      return res.status(400).json({ error: 'Minimum deposit is 10 EGP.' });

    const userRef = usersCol.doc(req.user.userId);
    await userRef.update({ total_balance: admin.firestore.FieldValue.increment(amount) });
    const updated = (await userRef.get()).data();

    return res.status(200).json({
      message        : `${amount} EGP deposited to your main balance.`,
      updatedBalances: {
        total_balance: updated.total_balance,
        gold_balance : updated.gold_balance,
        tbill_balance: updated.tbill_balance
      }
    });
  } catch (err) {
    console.error('deposit error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ================================================================
   7. TRANSACTION ROUTES
   ================================================================ */
app.post('/api/transaction/simulate', requireAuth, async (req, res) => {
  try {
    const { itemName, originalPrice, asset } = req.body;

    if (!itemName || typeof itemName !== 'string' || !itemName.trim())
      return res.status(400).json({ error: 'Item name is required.' });

    const price = parseFloat(originalPrice);
    if (isNaN(price) || price <= 0)
      return res.status(400).json({ error: 'Please provide a valid price greater than 0.' });
    if (!['gold', 'tbill'].includes(asset))
      return res.status(400).json({ error: "Asset must be 'gold' or 'tbill'." });

    const roundedAmount  = Math.ceil(price / 10) * 10;
    const investedAmount = parseFloat((roundedAmount - price).toFixed(2));

    if (investedAmount === 0)
      return res.status(400).json({ error: `${price} EGP is already a multiple of 10. No round-up to invest!` });

    const userRef = usersCol.doc(req.user.userId);
    const user    = (await userRef.get()).data();

    if (user.total_balance < roundedAmount)
      return res.status(400).json({
        error: `Insufficient balance. You need ${roundedAmount} EGP but have ${user.total_balance.toFixed(2)} EGP.`
      });

    const balanceUpdate = {
      total_balance: admin.firestore.FieldValue.increment(-roundedAmount),
      ...(asset === 'gold'
        ? { gold_balance : admin.firestore.FieldValue.increment(investedAmount) }
        : { tbill_balance: admin.firestore.FieldValue.increment(investedAmount) })
    };

    const txRef = txCol.doc();
    const newTx = {
      id             : txRef.id,
      user_id        : req.user.userId,
      item_name      : itemName.trim(),
      original_price : price,
      rounded_amount : roundedAmount,
      invested_amount: investedAmount,
      asset,
      type           : 'purchase',
      created_at     : new Date().toISOString()
    };

    const batch = db.batch();
    batch.update(userRef, balanceUpdate);
    batch.set(txRef, newTx);
    await batch.commit();

    const updatedUser = (await userRef.get()).data();
    return res.status(201).json({
      message        : `Round-up of ${investedAmount} EGP invested in ${asset === 'gold' ? 'Digital Gold' : 'T-Bills'}! 🎉`,
      roundedAmount,
      investedAmount,
      transaction    : newTx,
      updatedBalances: {
        total_balance: updatedUser.total_balance,
        gold_balance : updatedUser.gold_balance,
        tbill_balance: updatedUser.tbill_balance
      }
    });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/transaction/withdraw', requireAuth, async (req, res) => {
  try {
    const { amount, source } = req.body;
    const withdrawAmount = parseFloat(amount);

    if (isNaN(withdrawAmount) || withdrawAmount <= 0)
      return res.status(400).json({ error: 'Invalid amount.' });
    if (!['gold', 'tbill', 'all'].includes(source))
      return res.status(400).json({ error: 'Invalid source.' });

    const userRef = usersCol.doc(req.user.userId);
    const user    = (await userRef.get()).data();

    const available = source === 'gold'  ? user.gold_balance
      : source === 'tbill' ? user.tbill_balance
      : user.gold_balance + user.tbill_balance;

    if (withdrawAmount > available)
      return res.status(400).json({ error: `Insufficient ${source} balance.` });

    let balanceUpdate = { total_balance: admin.firestore.FieldValue.increment(withdrawAmount) };
    if (source === 'gold') {
      balanceUpdate.gold_balance = admin.firestore.FieldValue.increment(-withdrawAmount);
    } else if (source === 'tbill') {
      balanceUpdate.tbill_balance = admin.firestore.FieldValue.increment(-withdrawAmount);
    } else {
      const total     = user.gold_balance + user.tbill_balance;
      const goldShare = parseFloat((withdrawAmount * (user.gold_balance / total)).toFixed(2));
      balanceUpdate.gold_balance  = admin.firestore.FieldValue.increment(-goldShare);
      balanceUpdate.tbill_balance = admin.firestore.FieldValue.increment(-(withdrawAmount - goldShare));
    }

    const txRef = txCol.doc();
    const newTx = {
      id             : txRef.id,
      user_id        : req.user.userId,
      item_name      : source === 'gold' ? 'Gold Withdrawal' : source === 'tbill' ? 'T-Bills Withdrawal' : 'Full Withdrawal',
      original_price : withdrawAmount,
      rounded_amount : withdrawAmount,
      invested_amount: -withdrawAmount,
      asset          : source === 'all' ? 'gold' : source,
      type           : 'withdrawal',
      created_at     : new Date().toISOString()
    };

    const batch = db.batch();
    batch.update(userRef, balanceUpdate);
    batch.set(txRef, newTx);
    await batch.commit();

    const updatedUser = (await userRef.get()).data();
    return res.status(200).json({
      message        : `Withdrawal of ${withdrawAmount} EGP complete!`,
      updatedBalances: {
        total_balance: updatedUser.total_balance,
        gold_balance : updatedUser.gold_balance,
        tbill_balance: updatedUser.tbill_balance
      }
    });
  } catch (err) {
    console.error('withdraw error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ================================================================
   8. ADMIN ROUTES
   ================================================================ */
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const usersSnap = await usersCol
      .where('role', '==', 'user')
      .orderBy('created_at', 'desc')
      .get();

    const users = usersSnap.docs.map(d => {
      const { password_hash, ...safeUser } = d.data();
      return safeUser;
    });

    const total_users = users.length;
    const total_aum   = users.reduce((sum, u) => sum + (u.gold_balance || 0) + (u.tbill_balance || 0), 0);

    const txSnap  = await txCol.orderBy('created_at', 'desc').get();
    const allTxs  = txSnap.docs.map(d => d.data());
    const userIds = new Set(users.map(u => u.id));

    const userTxs         = allTxs.filter(t => userIds.has(t.user_id));
    const total_transactions = userTxs.length;
    const total_invested  = userTxs
      .filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + t.invested_amount, 0);

    // Build map for recent activity user lookup
    const usersMap = {};
    usersSnap.docs.forEach(d => { usersMap[d.id] = d.data(); });

    const recentActivity = allTxs.slice(0, 20).map(t => {
      const u = usersMap[t.user_id];
      return { ...t, user_name: u ? u.name : 'Unknown', user_email: u ? u.email : 'Unknown' };
    });

    return res.status(200).json({
      users,
      stats: { total_users, total_aum, total_transactions, total_invested },
      recentActivity
    });
  } catch (err) {
    console.error('admin/users error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/* ================================================================
   9. START
   ================================================================ */
initDatabase().catch(console.error);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║    Micro-Invest Server  v4.0  (Firestore)         ║');
    console.log(`║    http://localhost:${PORT}                          ║`);
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');
    console.log('  Default admin  →  admin@microinvest.eg  /  admin123');
    console.log('');
  });
}

module.exports = app;
