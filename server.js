const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieSession = require('cookie-session');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';
const SESSION_SECRET = process.env.SESSION_SECRET || 'cutbg-secret-change-me';

const DATA_FILE = path.join(__dirname, 'data', 'stats.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieSession({
  name: 'cutbg-admin-session',
  secret: SESSION_SECRET,
  maxAge: 24 * 60 * 60 * 1000
}));

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { totalUses: 0, byDate: {}, byDevice: {}, byBrowser: {}, byReferrer: {}, byFeature: {}, errors: 0, completions: 0, starts: 0 };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { totalUses: 0, byDate: {}, byDevice: {}, byBrowser: {}, byReferrer: {}, byFeature: {}, errors: 0, completions: 0, starts: 0 };
  }
}
function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function detectDevice(ua) {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}
function detectBrowser(ua) {
  if (/edg/i.test(ua)) return 'Edge';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Other';
}
function detectSource(referrer) {
  if (!referrer) return 'direct';
  if (/google\./i.test(referrer)) return 'google';
  if (/facebook\.|fb\.com/i.test(referrer)) return 'facebook';
  if (/wa\.me|whatsapp/i.test(referrer)) return 'whatsapp';
  return 'other';
}

app.post('/api/track', (req, res) => {
  const { event, feature } = req.body || {};
  const ua = req.headers['user-agent'] || '';
  const referrer = req.headers['referer'] || '';
  const device = detectDevice(ua);
  const browser = detectBrowser(ua);
  const source = detectSource(referrer);
  const date = todayKey();

  const data = loadData();

  if (event === 'start') {
    data.starts = (data.starts || 0) + 1;
  } else if (event === 'complete') {
    data.totalUses = (data.totalUses || 0) + 1;
    data.completions = (data.completions || 0) + 1;
    data.byDate[date] = (data.byDate[date] || 0) + 1;
    data.byDevice[device] = (data.byDevice[device] || 0) + 1;
    data.byBrowser[browser] = (data.byBrowser[browser] || 0) + 1;
    data.byReferrer[source] = (data.byReferrer[source] || 0) + 1;
    if (feature) data.byFeature[feature] = (data.byFeature[feature] || 0) + 1;
  } else if (event === 'error') {
    data.errors = (data.errors || 0) + 1;
  }

  saveData(data);
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Wrong password' });
});
app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ ok: false, error: 'Not logged in' });
}

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const data = loadData();

  const today = todayKey();
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last30.push({ date: key, count: data.byDate[key] || 0 });
  }
  const thisWeek = last30.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const thisMonth = last30.reduce((sum, d) => sum + d.count, 0);
  const todayCount = data.byDate[today] || 0;
  const bounceRate = data.starts > 0
    ? Math.round(((data.starts - data.completions) / data.starts) * 100)
    : 0;

  res.json({
    totalUses: data.totalUses || 0,
    today: todayCount,
    thisWeek,
    thisMonth,
    last30,
    byDevice: data.byDevice,
    byBrowser: data.byBrowser,
    byReferrer: data.byReferrer,
    byFeature: data.byFeature,
    errors: data.errors || 0,
    starts: data.starts || 0,
    completions: data.completions || 0,
    bounceRate
  });
});

app.get('/api/admin/export', requireAdmin, (req, res) => {
  const data = loadData();
  let csv = 'date,count\n';
  Object.keys(data.byDate).sort().forEach(d => {
    csv += `${d},${data.byDate[d]}\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cutbg-stats.csv"');
  res.send(csv);
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`CutBG server running on port ${PORT}`);
});
