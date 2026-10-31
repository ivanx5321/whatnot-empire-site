const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { pool, one, q, migrate } = require('./db');
const { layout, esc } = require('./views');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production');
  process.exit(1);
}

app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  name: 'lsc.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

// Basic security headers.
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// CSRF protection: state-changing requests must come from this site.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin') || req.get('referer') || '';
  if (!origin) return next(); // some privacy browsers strip both; session cookie is SameSite=Lax
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch { /* fall through */ }
  return res.status(403).send('Blocked: cross-site request');
});

// Load user + flash.
app.use(async (req, res, next) => {
  try {
    res.locals.flash = req.session.flash; delete req.session.flash;
    if (req.session.uid) {
      req.user = await one('SELECT id, email, name, role FROM users WHERE id=$1', [req.session.uid]);
      if (req.user && req.user.role === 'student') {
        req.student = await one('SELECT * FROM students WHERE user_id=$1', [req.user.id]);
      }
    }
    res.page = (title, body, extra = {}) => res.send(layout({ title, user: req.user, path: (req.baseUrl + req.path).replace(/\/$/, '') || '/', body, flash: res.locals.flash, ...extra }));
    req.flash = (msg, type = 'ok') => { req.session.flash = { msg, type }; };
    next();
  } catch (e) { next(e); }
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Auth ----------
const attempts = new Map();
function limited(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, a);
  return a.length >= 8;
}

function authPage(title, inner) {
  return `<section class="auth card">${inner}</section>`;
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'coach' ? '/coach' : '/');
  res.page('Log in', authPage('Log in', `
<h1>Log in</h1>
<form method="post" action="/login" class="stack">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button class="btn">Log in</button>
</form>
<p class="muted small">Forgot your password? Text Levi and he'll send you a new login link.</p>`));
});

app.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  if (limited(key)) { req.flash('Too many tries. Wait 15 minutes.', 'err'); return res.redirect('/login'); }
  const u = await one('SELECT * FROM users WHERE email=$1', [email]);
  const ok = u && u.password_hash && await bcrypt.compare(String(req.body.password || ''), u.password_hash);
  if (!ok) {
    attempts.get(key).push(Date.now());
    req.flash('Wrong email or password.', 'err');
    return res.redirect('/login');
  }
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.uid = u.id;
    res.redirect(u.role === 'coach' ? '/coach' : '/');
  });
}));

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// First-time coach setup. Needs SETUP_CODE (set in Render) and only works for ADMIN_EMAIL.
app.get('/setup', wrap(async (req, res) => {
  const coach = await one("SELECT id FROM users WHERE role='coach' LIMIT 1");
  if (coach) return res.redirect('/login');
  res.page('Set up', authPage('Set up', `
<h1>Set up your coach account</h1>
<form method="post" action="/setup" class="stack">
  <label>Your name<input name="name" required value="Levi Salas"></label>
  <label>Email<input name="email" type="email" required></label>
  <label>Setup code<input name="code" required autocomplete="off"></label>
  <label>Choose a password (10+ characters)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
  <button class="btn">Create coach account</button>
</form>`));
}));

app.post('/setup', wrap(async (req, res) => {
  const coach = await one("SELECT id FROM users WHERE role='coach' LIMIT 1");
  if (coach) return res.redirect('/login');
  const email = String(req.body.email || '').trim().toLowerCase();
  const codeOk = process.env.SETUP_CODE && req.body.code === process.env.SETUP_CODE;
  const emailOk = !process.env.ADMIN_EMAIL || email === process.env.ADMIN_EMAIL.toLowerCase();
  if (!codeOk || !emailOk || String(req.body.password || '').length < 10) {
    req.flash('Setup code, email or password not valid.', 'err');
    return res.redirect('/setup');
  }
  const hash = await bcrypt.hash(req.body.password, 12);
  const u = await one("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,'coach') RETURNING id", [email, req.body.name || 'Coach', hash]);
  req.session.uid = u.id;
  res.redirect('/coach');
}));

// Student joins from the invite link Levi texts them.
app.get('/join/:token', wrap(async (req, res) => {
  const s = await one('SELECT * FROM students WHERE invite_token=$1', [req.params.token]);
  if (!s) return res.page('Link expired', authPage('', '<h1>This link has expired</h1><p>Text Levi for a new one.</p>'));
  res.page('Welcome', authPage('Welcome', `
<h1>Welcome, ${esc(s.name.split(' ')[0])} 👋</h1>
<p class="muted">Set your password to get into your coaching portal.</p>
<form method="post" action="/join/${esc(req.params.token)}" class="stack">
  <label>Email<input name="email" type="email" required value="${esc(s.email || '')}" autocomplete="email"></label>
  <label>Choose a password (8+ characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
  <button class="btn">Get started</button>
</form>`));
}));

app.post('/join/:token', wrap(async (req, res) => {
  const s = await one('SELECT * FROM students WHERE invite_token=$1', [req.params.token]);
  if (!s) return res.redirect('/login');
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (pw.length < 8 || !email.includes('@')) { req.flash('Use a valid email and 8+ character password.', 'err'); return res.redirect(`/join/${req.params.token}`); }
  const hash = await bcrypt.hash(pw, 12);
  let uid = s.user_id;
  if (uid) {
    await q('UPDATE users SET email=$1, password_hash=$2 WHERE id=$3', [email, hash, uid]);
  } else {
    const taken = await one('SELECT id FROM users WHERE email=$1', [email]);
    if (taken) { req.flash('That email already has an account. Log in instead.', 'err'); return res.redirect('/login'); }
    uid = (await one("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,'student') RETURNING id", [email, s.name, hash])).id;
  }
  await q('UPDATE students SET user_id=$1, email=$2, invite_token=NULL WHERE id=$3', [uid, email, s.id]);
  req.session.regenerate(() => { req.session.uid = uid; res.redirect('/'); });
}));

app.get('/healthz', (req, res) => res.send('ok'));

// ---------- Routes ----------
const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== role) return res.redirect(req.user.role === 'coach' ? '/coach' : '/');
  if (role === 'student' && !req.student) return res.status(403).send('No student profile linked. Text Levi.');
  next();
};

app.use('/coach', requireRole('coach'), require('./routes/coach')(wrap));
app.use('/', requireRole('student'), require('./routes/student')(wrap));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send(layout({ title: 'Error', user: req.user, body: '<section class="card"><h1>Something went wrong</h1><p>Try again. If it keeps happening, text Levi.</p></section>' }));
});

const newToken = () => crypto.randomBytes(18).toString('base64url');
module.exports = { app, newToken };

if (require.main === module) {
  const port = process.env.PORT || 3000;
  migrate().then(() => app.listen(port, () => console.log(`Coach app on :${port}`))).catch((e) => { console.error(e); process.exit(1); });
}
