/* ================================================================
   script.js — Micro-Invest v3.1  (UI Upgrade Edition)
   ----------------------------------------------------------------
   v3.1 additions (no API changes):
     • animateCountUp()   — smooth number count-up on dashboard load
     • renderProfitCard() — 14.5% simulated ROI card logic
     • showView() upgraded with fade+slide CSS transition
     • All existing endpoints, auth, admin, chart logic preserved
   ================================================================ */


/* ================================================================
   1. APP STATE
   ================================================================ */
const App = {
  token    : sessionStorage.getItem('mi_token') || null,
  user     : null,
  lang     : localStorage.getItem('mi_lang')  || 'en',
  theme    : localStorage.getItem('mi_theme') || 'light',
  chartInst: null,
};

const API_BASE = '/api';


/* ================================================================
   2. API CLIENT
   ================================================================ */
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(App.token ? { 'Authorization': `Bearer ${App.token}` } : {})
  };
  const response = await fetch(`${API_BASE}${endpoint}`, { headers, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
  return data;
}


/* ================================================================
   3. SPA ROUTER — with fade+slide transition
   ================================================================ */
function showView(viewName) {
  ['auth', 'dashboard', 'admin'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (!el) return;

    if (v === viewName) {
      el.style.display = 'block';
      // Trigger CSS transition: remove class → force reflow → add class
      el.classList.remove('view-fade-in');
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add('view-fade-in');
    } else {
      el.style.display = 'none';
      el.classList.remove('view-fade-in');
    }
  });

  const navbar = document.getElementById('navbar');
  navbar.style.display = viewName === 'auth' ? 'none' : 'flex';

  document.querySelectorAll('.nav-item-user').forEach(el => {
    el.style.display = viewName === 'dashboard' ? 'inline-flex' : 'none';
  });
  document.querySelectorAll('.nav-item-admin').forEach(el => {
    el.style.display = viewName === 'admin' ? 'inline-flex' : 'none';
  });
}

function showSection(sectionId) {
  const allSections = ['overview', 'simulate', 'history', 'admin-overview', 'admin-users'];
  allSections.forEach(s => {
    const el = document.getElementById(`section-${s}`);
    if (el) el.style.display = s === sectionId ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.section === sectionId);
  });
}


/* ================================================================
   4. AUTH HANDLERS
   ================================================================ */
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginForm').style.display    = isLogin ? 'flex'  : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none'  : 'flex';
  document.getElementById('tabLogin').classList.toggle('active',  isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').style.flexDirection    = 'column';
  document.getElementById('registerForm').style.flexDirection = 'column';
}

async function handleLogin(event) {
  event.preventDefault();
  const errorEl = document.getElementById('loginError');
  errorEl.style.display = 'none';

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  setButtonLoading('loginSubmit', true, t('signingIn'));

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body  : JSON.stringify({ email, password })
    });

    App.token = data.token;
    App.user  = data.user;
    sessionStorage.setItem('mi_token', data.token);
    showToast(`${t('welcome')}, ${data.user.name}! 🎉`, 'success');

    if (data.user.role === 'admin') {
      await loadAdminData();
      showView('admin');
      showSection('admin-overview');
    } else {
      await loadDashboardData();
      showView('dashboard');
      showSection('overview');
    }
    updateNavUser();

  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  } finally {
    setButtonLoading('loginSubmit', false, t('signIn'));
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const errorEl = document.getElementById('registerError');
  errorEl.style.display = 'none';

  const name           = document.getElementById('regName').value.trim();
  const email          = document.getElementById('regEmail').value.trim();
  const password       = document.getElementById('regPassword').value;
  const initialDeposit = parseFloat(document.getElementById('regDeposit').value) || 0;

  setButtonLoading('registerSubmit', true, t('creatingAccount'));

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body  : JSON.stringify({ name, email, password, initialDeposit })
    });

    App.token = data.token;
    App.user  = data.user;
    sessionStorage.setItem('mi_token', data.token);
    showToast(`${t('accountCreated')}, ${data.user.name}! 🎉`, 'success');
    await loadDashboardData();
    showView('dashboard');
    showSection('overview');
    updateNavUser();

  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  } finally {
    setButtonLoading('registerSubmit', false, t('createAccount'));
  }
}

async function handleLogout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (_) {}

  App.token = null;
  App.user  = null;
  sessionStorage.removeItem('mi_token');
  if (App.chartInst) { App.chartInst.destroy(); App.chartInst = null; }
  showView('auth');
  showToast(t('loggedOut'), 'info');
}

function updateNavUser() {
  if (!App.user) return;
  const navUser   = document.getElementById('navUser');
  const navAvatar = document.getElementById('navAvatar');
  const navName   = document.getElementById('navUserName');
  navUser.style.display = 'flex';
  navAvatar.textContent = App.user.name.charAt(0).toUpperCase();
  navName.textContent   = App.user.name.split(' ')[0];
}


/* ================================================================
   5. DASHBOARD LOADER
   ================================================================ */
async function loadDashboardData() {
  try {
    const data = await apiFetch('/user/data');
    App.user = { ...App.user, ...data.user };
    renderBalanceCards(data.user);
    renderTransactionTable(data.transactions);
    renderGrowthChart(data.transactions);
    renderWelcomeHeader(data.user);
  } catch (err) {
    showToast(err.message, 'error');
    if (err.message.includes('log in')) handleLogout();
  }
}

function renderWelcomeHeader(user) {
  const el = document.getElementById('welcomeName');
  if (el) el.textContent = user.name;
}

/**
 * Render balance cards with count-up animation and ROI card.
 */
function renderBalanceCards(user) {
  const totalInvested = roundTo2dp((user.gold_balance || 0) + (user.tbill_balance || 0));

  // Count-up animated number reveals
  countUp('mainBalDisplay',  user.total_balance  || 0, 'EGP', 1100);
  countUp('goldBalDisplay',  user.gold_balance   || 0, 'EGP', 1100);
  countUp('tbillBalDisplay', user.tbill_balance  || 0, 'EGP', 1100);
  countUp('totalInvDisplay', totalInvested,             'EGP', 1100, true /* accent */);

  // Progress bars
  if (totalInvested > 0) {
    const goldPct  = (user.gold_balance  / totalInvested) * 100;
    const tbillPct = (user.tbill_balance / totalInvested) * 100;
    document.getElementById('goldBarFill').style.width  = `${goldPct.toFixed(1)}%`;
    document.getElementById('tbillBarFill').style.width = `${tbillPct.toFixed(1)}%`;
  } else {
    document.getElementById('goldBarFill').style.width  = '0%';
    document.getElementById('tbillBarFill').style.width = '0%';
  }

  // Render the profit / ROI card
  renderProfitCard(totalInvested);
}

/**
 * ── NEW v3.1: Render simulated ROI/Profit card ──────────────────
 * Uses a fixed 14.5% annual growth rate applied to total invested.
 * Numbers animate from 0 using countUpRaw().
 */
function renderProfitCard(totalInvested) {
  const banner = document.getElementById('profitBanner');
  if (!banner) return;

  const ROI_RATE = 0.145; // 14.5% simulated annual return
  const profit   = roundTo2dp(totalInvested * ROI_RATE);

  if (totalInvested <= 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';

  // Animate profit number
  const profitEl = document.getElementById('profitValue');
  countUpRaw(profitEl, profit, 1400, '+', '');

  // Update ROI % display
  const pctEl = document.getElementById('profitPct');
  if (pctEl) pctEl.textContent = `+${(ROI_RATE * 100).toFixed(2)}%`;
}


/* ================================================================
   6. TRANSACTION HANDLERS
   ================================================================ */
let selectedAsset = 'gold';

function handlePricePreview() {
  const price = parseFloat(document.getElementById('txPrice').value);
  if (isNaN(price) || price <= 0) {
    setText('rpOriginal', '—'); setText('rpRounded', '—'); setText('rpInvested', '—');
    return;
  }
  const rounded  = Math.ceil(price / 10) * 10;
  const invested = roundTo2dp(rounded - price);
  setText('rpOriginal', `${fmt(price)} EGP`);
  setText('rpRounded',  `${fmt(rounded)} EGP`);
  setText('rpInvested', invested > 0 ? `+${fmt(invested)} EGP` : t('alreadyMultiple'));
}

function quickFill(name, price) {
  document.getElementById('txItemName').value = name;
  document.getElementById('txPrice').value    = price;
  handlePricePreview();
}

async function handlePay() {
  const itemName = document.getElementById('txItemName').value.trim();
  const price    = parseFloat(document.getElementById('txPrice').value);

  if (!itemName) { showToast(t('enterItem'), 'error'); return; }
  if (isNaN(price) || price <= 0) { showToast(t('enterPrice'), 'error'); return; }

  const payBtn = document.getElementById('payBtn');
  payBtn.disabled    = true;
  payBtn.textContent = '⏳ ' + t('processing');

  try {
    const data = await apiFetch('/transaction/simulate', {
      method: 'POST',
      body  : JSON.stringify({ itemName, originalPrice: price, asset: selectedAsset })
    });
    showToast(data.message, 'success');
    renderBalanceCards(data.updatedBalances);
    document.getElementById('txItemName').value = '';
    document.getElementById('txPrice').value    = '';
    setText('rpOriginal', '—'); setText('rpRounded', '—'); setText('rpInvested', '—');
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    payBtn.disabled    = false;
    payBtn.textContent = '💰 ' + t('payAndInvest');
  }
}

async function handleWithdraw() {
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const source = document.getElementById('withdrawSource').value;

  if (isNaN(amount) || amount <= 0) { showToast(t('enterWithdraw'), 'error'); return; }

  try {
    const data = await apiFetch('/transaction/withdraw', {
      method: 'POST',
      body  : JSON.stringify({ amount, source })
    });
    showToast(data.message, 'success');
    document.getElementById('withdrawAmount').value = '';
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openDepositModal() {
  document.getElementById('depositModal').style.display = 'flex';
}
function closeDepositModal(event) {
  if (!event || event.target === document.getElementById('depositModal')) {
    document.getElementById('depositModal').style.display = 'none';
  }
}

async function handleDeposit() {
  const amount = parseFloat(document.getElementById('depositAmount').value);
  if (isNaN(amount) || amount < 10) { showToast(t('enterDeposit'), 'error'); return; }

  try {
    const data = await apiFetch('/user/deposit', {
      method: 'POST',
      body  : JSON.stringify({ amount })
    });
    showToast(data.message, 'success');
    closeDepositModal();
    renderBalanceCards(data.updatedBalances);
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


/* ================================================================
   7. ADMIN LOADER
   ================================================================ */
async function loadAdminData() {
  try {
    const data = await apiFetch('/admin/users');
    renderAdminStats(data.stats);
    renderAdminUserTable(data.users);
    renderAdminActivity(data.recentActivity);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderAdminStats(stats) {
  if (!stats) return;
  setText('adminTotalUsers',    stats.total_users || 0);
  setText('adminTotalAUM',      `${fmt(stats.total_aum || 0)} EGP`);
  setText('adminTotalTx',       stats.total_transactions || 0);
  setText('adminTotalInvested', `${fmt(stats.total_invested || 0)} EGP`);
}

function renderAdminUserTable(users) {
  const tbody = document.getElementById('adminUsersBody');
  const empty = document.getElementById('adminUsersEmpty');
  tbody.innerHTML = '';
  if (!users || users.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  users.forEach(u => {
    const invested = roundTo2dp((u.gold_balance || 0) + (u.tbill_balance || 0));
    const joined   = new Date(u.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const rolePill = u.role === 'admin'
      ? `<span class="asset-pill pill-admin">🛡 Admin</span>`
      : `<span class="asset-pill pill-withdraw">👤 User</span>`;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="col-name">#${u.id}</td>
      <td class="col-name">${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${rolePill}</td>
      <td class="col-spent">${fmt(u.total_balance)} EGP</td>
      <td class="col-roundup">${fmt(invested)} EGP</td>
      <td>${joined}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderAdminActivity(activity) {
  const tbody = document.getElementById('adminActivityBody');
  const empty = document.getElementById('adminActivityEmpty');
  tbody.innerHTML = '';
  if (!activity || activity.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  activity.forEach(tx => {
    const isWithdraw = tx.type === 'withdrawal';
    let pillClass, pillLabel;
    if (isWithdraw) { pillClass = 'pill-withdraw'; pillLabel = `🏧 ${t('withdrawal')}`; }
    else if (tx.asset === 'gold') { pillClass = 'pill-gold'; pillLabel = `🥇 ${t('gold')}`; }
    else { pillClass = 'pill-tbill'; pillLabel = `📜 ${t('tbill')}`; }
    const dateStr = new Date(tx.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="col-name">${escapeHtml(tx.user_name)}</td>
      <td>${escapeHtml(tx.item_name)}</td>
      <td class="col-spent">${fmt(tx.original_price)} EGP</td>
      <td class="${isWithdraw ? 'col-neg' : 'col-roundup'}">
        ${isWithdraw ? '-' : '+'}${fmt(Math.abs(tx.invested_amount))} EGP
      </td>
      <td><span class="asset-pill ${pillClass}">${pillLabel}</span></td>
      <td>${dateStr}</td>
    `;
    tbody.appendChild(row);
  });
}


/* ================================================================
   8. TRANSACTION TABLE RENDERER
   ================================================================ */
function renderTransactionTable(transactions) {
  const tbody = document.getElementById('txTableBody');
  const empty = document.getElementById('txEmpty');
  tbody.innerHTML = '';

  if (!transactions || transactions.length === 0) {
    empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';

  const purchases = transactions.filter(tx => tx.type === 'purchase');
  const countLabel = document.getElementById('roundupCountLabel');
  if (countLabel) {
    countLabel.textContent = `${t('from')} ${purchases.length} ${t('roundUps')}`;
  }

  transactions.forEach(tx => {
    const row        = document.createElement('tr');
    const isWithdraw = tx.type === 'withdrawal';

    let pillClass, pillLabel;
    if (isWithdraw)          { pillClass = 'pill-withdraw'; pillLabel = `🏧 ${t('withdrawal')}`; }
    else if (tx.asset === 'gold') { pillClass = 'pill-gold';    pillLabel = `🥇 ${t('gold')}`; }
    else                     { pillClass = 'pill-tbill';   pillLabel = `📜 ${t('tbill')}`; }

    const investedCell = isWithdraw
      ? `<td class="col-neg">-${fmt(Math.abs(tx.invested_amount))} EGP</td>`
      : `<td class="col-roundup">+${fmt(tx.invested_amount)} EGP</td>`;

    const dateStr = new Date(tx.created_at).toLocaleDateString(
      App.lang === 'ar' ? 'ar-EG' : 'en-GB',
      { day:'2-digit', month:'short', year:'numeric' }
    );

    row.innerHTML = `
      <td class="col-name">${escapeHtml(tx.item_name)}</td>
      <td class="col-spent">${fmt(tx.original_price)} EGP</td>
      <td>${fmt(tx.rounded_amount)} EGP</td>
      ${investedCell}
      <td><span class="asset-pill ${pillClass}">${pillLabel}</span></td>
      <td>${dateStr}</td>
    `;
    tbody.appendChild(row);
  });
}


/* ================================================================
   9. CHART.JS
   ================================================================ */
function renderGrowthChart(transactions) {
  const canvas = document.getElementById('growthChart');
  const empty  = document.getElementById('chartEmpty');

  const purchases = (transactions || [])
    .filter(tx => tx.type === 'purchase')
    .slice().reverse();

  if (purchases.length === 0) {
    empty.style.display = 'flex';
    if (App.chartInst) { App.chartInst.destroy(); App.chartInst = null; }
    return;
  }
  empty.style.display = 'none';

  let cumTotal = 0, cumGold = 0;
  const labels = [], totalData = [], goldData = [];

  purchases.forEach(tx => {
    cumTotal = roundTo2dp(cumTotal + tx.invested_amount);
    if (tx.asset === 'gold') cumGold = roundTo2dp(cumGold + tx.invested_amount);
    const label = tx.item_name.length > 10 ? tx.item_name.substring(0, 10) + '…' : tx.item_name;
    labels.push(label);
    totalData.push(cumTotal);
    goldData.push(roundTo2dp(cumGold));
  });

  const isDark    = App.theme === 'dark';
  const navyLine  = isDark ? 'rgba(96,165,250,1)'   : 'rgba(0,86,210,1)';
  const navyFill  = isDark ? 'rgba(96,165,250,0.10)' : 'rgba(0,86,210,0.07)';
  const goldLine  = isDark ? 'rgba(245,200,66,1)'    : 'rgba(201,152,29,1)';
  const goldFill  = isDark ? 'rgba(245,200,66,0.08)' : 'rgba(201,152,29,0.08)';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(26,43,74,0.07)';
  const tickColor = isDark ? 'rgba(136,146,174,0.9)'  : 'rgba(75,85,99,0.9)';
  const tooltipBg = isDark ? 'rgba(14,18,32,0.97)'    : 'rgba(26,43,74,0.96)';

  if (App.chartInst) { App.chartInst.destroy(); }
  App.chartInst = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label          : App.lang === 'ar' ? 'إجمالي المستثمر (جنيه)' : 'Total Invested (EGP)',
          data           : totalData,
          borderColor    : navyLine, backgroundColor: navyFill,
          borderWidth    : 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: navyLine, pointRadius: 4, pointHoverRadius: 7,
        },
        {
          label          : App.lang === 'ar' ? 'ذهب (جنيه)' : 'Gold (EGP)',
          data           : goldData,
          borderColor    : goldLine, backgroundColor: goldFill,
          borderWidth    : 2, fill: true, tension: 0.4, borderDash: [5,3],
          pointBackgroundColor: goldLine, pointRadius: 3, pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: tickColor, font: { family: "'Inter', sans-serif", size: 12 }, boxWidth: 12, padding: 20 } },
        tooltip: {
          backgroundColor: tooltipBg, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          titleColor: '#FFFFFF', bodyColor: 'rgba(255,255,255,0.72)', padding: 12,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} EGP` }
        }
      },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 11 }, maxRotation: 30 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { size: 11 }, callback: v => `${v} EGP` }, grid: { color: gridColor }, beginAtZero: true }
      },
      animation: { duration: 700, easing: 'easeOutQuart' },
    },
  });
}


/* ================================================================
   10. LANGUAGE SYSTEM
   ================================================================ */
const i18n = {
  en: {
    welcome        : 'Welcome back',
    signIn         : 'Sign In',
    signingIn      : 'Signing In…',
    createAccount  : 'Create Account',
    creatingAccount: 'Creating account…',
    accountCreated : 'Account created! Welcome',
    loggedOut      : 'Logged out successfully.',
    from           : 'from',
    roundUps       : 'round-ups',
    gold           : 'Gold',
    tbill          : 'T-Bills',
    withdrawal     : 'Withdrawal',
    payAndInvest   : 'Pay & Invest Round-Up',
    processing     : 'Processing…',
    alreadyMultiple: 'Already a multiple of 10!',
    enterItem      : 'Please enter an item name.',
    enterPrice     : 'Please enter a valid price.',
    enterWithdraw  : 'Please enter a withdrawal amount.',
    enterDeposit   : 'Minimum deposit is 10 EGP.',
  },
  ar: {
    welcome        : 'مرحباً بعودتك',
    signIn         : 'دخول',
    signingIn      : 'جارٍ الدخول…',
    createAccount  : 'إنشاء الحساب',
    creatingAccount: 'جارٍ الإنشاء…',
    accountCreated : 'تم إنشاء الحساب! أهلاً',
    loggedOut      : 'تم الخروج بنجاح.',
    from           : 'من',
    roundUps       : 'تقريب',
    gold           : 'ذهب',
    tbill          : 'أذون',
    withdrawal     : 'سحب',
    payAndInvest   : 'ادفع واستثمر التقريب',
    processing     : 'جارٍ المعالجة…',
    alreadyMultiple: 'السعر مضاعف لـ 10!',
    enterItem      : 'أدخل اسم الصنف.',
    enterPrice     : 'أدخل سعراً صحيحاً.',
    enterWithdraw  : 'أدخل مبلغ السحب.',
    enterDeposit   : 'الحد الأدنى للإيداع 10 جنيه.',
  }
};

function t(key) {
  return (i18n[App.lang] && i18n[App.lang][key]) || i18n['en'][key] || key;
}

function handleLangToggle() {
  App.lang = App.lang === 'en' ? 'ar' : 'en';
  localStorage.setItem('mi_lang', App.lang);
  applyLanguage();
}

function applyLanguage() {
  const isAr = App.lang === 'ar';
  const html  = document.documentElement;
  html.setAttribute('lang', App.lang);
  html.setAttribute('dir',  isAr ? 'rtl' : 'ltr');

  document.querySelectorAll('[data-en]').forEach(el => {
    const val = el.getAttribute(`data-${App.lang}`);
    if (val !== null) el.textContent = val;
  });

  const label = isAr ? 'English' : 'عربي';
  const langLabel     = document.getElementById('langLabel');
  const langLabelAuth = document.getElementById('langLabelAuth');
  if (langLabel)     langLabel.textContent     = label;
  if (langLabelAuth) langLabelAuth.textContent = label;

  if (App.user) {
    if (document.getElementById('view-dashboard').style.display !== 'none') loadDashboardData();
    if (document.getElementById('view-admin').style.display     !== 'none') loadAdminData();
  }
}


/* ================================================================
   11. DARK MODE
   ================================================================ */
function handleThemeToggle() {
  App.theme = App.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('mi_theme', App.theme);
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', App.theme);
  const isDark = App.theme === 'dark';
  const icon     = document.getElementById('themeIcon');
  const iconAuth = document.getElementById('themeIconAuth');
  if (icon)     icon.textContent     = isDark ? '☀️' : '🌙';
  if (iconAuth) iconAuth.textContent = isDark ? '☀️' : '🌙';
  if (App.chartInst && App.user) loadDashboardData();
}


/* ================================================================
   12. UTILITY FUNCTIONS
   ================================================================ */
function showToast(message, type = 'info') {
  const toast       = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

function fmt(num) {
  if (num === null || num === undefined || isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-EG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function roundTo2dp(num) { return Math.round(num * 100) / 100; }

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setButtonLoading(id, state, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled    = state;
  btn.textContent = label;
}


/* ================================================================
   COUNT-UP ANIMATION HELPERS (new in v3.1)
   ================================================================ */

/**
 * Animate a balance card value from 0 → target.
 * Writes: "1,234.56 <span>EGP</span>"
 * @param {string}  id       — element id
 * @param {number}  target   — final numeric value
 * @param {string}  suffix   — currency suffix
 * @param {number}  duration — ms
 * @param {boolean} accent   — add 'accent' class to value
 */
function countUp(id, target, suffix = 'EGP', duration = 1200, accent = false) {
  const el = document.getElementById(id);
  if (!el) return;

  // Keep accent class state
  if (accent) el.classList.add('accent');

  if (target === 0) {
    el.innerHTML = `0.00 <span>${suffix}</span>`;
    return;
  }

  const startTime = performance.now();

  function frame(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out quartic
    const eased    = 1 - Math.pow(1 - progress, 4);
    const current  = target * eased;
    el.innerHTML   = `${fmt(current)} <span>${suffix}</span>`;
    if (progress < 1) requestAnimationFrame(frame);
    else el.innerHTML = `${fmt(target)} <span>${suffix}</span>`;
  }
  requestAnimationFrame(frame);
}

/**
 * Animate a raw DOM element's textContent from 0 → target.
 * Used for the profit card value.
 * @param {HTMLElement} el       — target element
 * @param {number}      target   — final value
 * @param {number}      duration — ms
 * @param {string}      prefix   — e.g. "+"
 * @param {string}      suffix   — e.g. " EGP"
 */
function countUpRaw(el, target, duration = 1400, prefix = '', suffix = '') {
  if (!el) return;
  if (target === 0) { el.textContent = `${prefix}0.00${suffix}`; return; }

  const startTime = performance.now();

  function frame(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 4);
    const current  = target * eased;
    el.textContent = `${prefix}${fmt(current)}${suffix}`;
    if (progress < 1) requestAnimationFrame(frame);
    else el.textContent = `${prefix}${fmt(target)}${suffix}`;
  }
  requestAnimationFrame(frame);
}


/* ================================================================
   13. INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', async () => {

  // ── Step 1: Apply persisted preferences ───────────────────────
  applyTheme();
  applyLanguage();

  // ── Step 2: Wire nav section links ────────────────────────────
  document.querySelectorAll('.nav-links a[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      showSection(section);
      if (section === 'admin-users' || section === 'admin-overview') loadAdminData();
      if (section === 'history') loadDashboardData();
    });
  });

  // ── Step 3: Logout button ────────────────────────────────────
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // ── Step 4: Asset toggle ─────────────────────────────────────
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedAsset = btn.dataset.asset;
    });
  });

  // ── Step 5: Navbar theme + lang toggles ──────────────────────
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', handleThemeToggle);
  const langBtn = document.getElementById('langToggle');
  if (langBtn)  langBtn.addEventListener('click', handleLangToggle);

  // ── Step 6: Top-Up button ────────────────────────────────────
  const depositBtn = document.getElementById('depositBtn');
  if (depositBtn) depositBtn.addEventListener('click', openDepositModal);

  // ── Step 7: Session restoration ──────────────────────────────
  if (App.token) {
    try {
      const data = await apiFetch('/user/data');
      App.user = data.user;

      if (App.user.role === 'admin') {
        await loadAdminData();
        showView('admin');
        showSection('admin-overview');
      } else {
        renderBalanceCards(data.user);
        renderTransactionTable(data.transactions);
        renderGrowthChart(data.transactions);
        renderWelcomeHeader(data.user);
        showView('dashboard');
        showSection('overview');
      }
      updateNavUser();

    } catch (_) {
      App.token = null;
      sessionStorage.removeItem('mi_token');
      showView('auth');
    }
  } else {
    showView('auth');
  }

  console.info(
    '%c Micro-Invest v3.1 — UI Upgrade Edition loaded ✓',
    'color: #F5C842; font-weight:bold; font-size:13px; background:#1A2B4A; padding:4px 8px; border-radius:4px;'
  );
});