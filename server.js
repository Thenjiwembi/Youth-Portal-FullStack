require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const sessionCookie = 'webdev_app_session';
const sessionDays = 7;
const cookieSecure = process.env.COOKIE_SECURE !== 'false';
const adminSignupCode = String(process.env.ADMIN_SIGNUP_CODE || '');
const emailFrom = String(process.env.EMAIL_FROM || '');
const appBaseUrl = String(process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const mailTransport = process.env.SMTP_HOST && emailFrom ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
  ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } } : {})
}) : null;
const allowedStatuses = new Set(['Pending', 'In Progress', 'Resolved', 'Rejected', 'Cancelled']);
const allowedPriorities = new Set(['Low', 'Medium', 'High', 'Urgent']);
const allowedRoles = new Set(['youth', 'staff', 'admin']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const databasePool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
}) : null;
let databaseReady = false;

async function queryExecutor(executor, sql, values = []) {
  let index = 0;
  const statement = sql.replace(/\?/g, () => `$${++index}`);
  const result = await executor.query(statement, values);
  const metadata = { insertId: result.rows[0]?.id, affectedRows: result.rowCount };
  return result.command === 'SELECT' ? [result.rows, metadata] : [metadata, result.rows];
}

const pool = databasePool ? {
  query: (sql, values = []) => queryExecutor(databasePool, sql, values),
  getConnection: async () => {
    const client = await databasePool.connect();
    return {
      query: (sql, values = []) => queryExecutor(client, sql, values),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release()
    };
  }
} : null;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self' https://*.manus.computer");
  next();
});

async function ensureSchema() {
  if (!databasePool) return;
  await databasePool.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
  databaseReady = true;
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => { const index = part.indexOf('='); if (index < 0) return cookies; const key = part.slice(0, index).trim(); cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); return cookies; }, {});
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function newVerificationCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
async function sendVerificationEmail(email, code) {
  await mailTransport.sendMail({ from: emailFrom, to: email, subject: 'Verify your Youth Portal account', text: `Your Youth Portal verification code is ${code}. It expires in 10 minutes. If you did not create this account, you can ignore this email.` });
}
async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${appBaseUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  await mailTransport.sendMail({ from: emailFrom, to: email, subject: 'Reset your Youth Portal password', text: `Use this link to reset your Youth Portal password. It expires in 30 minutes and can be used once:\n\n${resetUrl}\n\nIf you did not request a reset, you can ignore this email.` });
}
function cookieAttributes(httpOnly = false, maxAge = null) { const attributes = ['Path=/']; if (httpOnly) attributes.push('HttpOnly'); if (maxAge !== null) attributes.push(`Max-Age=${maxAge}`); if (cookieSecure) attributes.push('Secure', 'SameSite=None'); else attributes.push('SameSite=Lax'); return attributes; }
function setSessionCookie(res, token) { const csrf = newToken(); res.setHeader('Set-Cookie', [`${sessionCookie}=${encodeURIComponent(token)}; ${cookieAttributes(true, sessionDays * 86400).join('; ')}`, `webdev_csrf=${encodeURIComponent(csrf)}; ${cookieAttributes(false, sessionDays * 86400).join('; ')}`]); }
function clearSessionCookie(res) { res.setHeader('Set-Cookie', [`${sessionCookie}=; ${cookieAttributes(true, 0).join('; ')}`, `webdev_csrf=; ${cookieAttributes(false, 0).join('; ')}`]); }
function publicUser(row) { return { id: row.id, fullName: row.full_name, email: row.email, role: row.role_id || 'youth', roleLabel: row.role_name || 'Youth / Registered User', accountStatus: row.account_status, location: row.location || '', phone: row.phone || '', qualification: row.qualification || '', about: row.about || '', skills: row.skills || '', interests: row.interests || '' }; }
function jsonError(res, status, message, code = 'request_error') { return res.status(status).json({ error: code, message }); }
function requireDatabase(req, res, next) { if (!pool || !databaseReady) return jsonError(res, 503, 'The service database is not ready. Try again shortly.', 'database_unavailable'); next(); }

async function loadUserBySession(req) {
  if (!pool) return null;
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (!token) return null;
  const [rows] = await pool.query(`SELECT u.*, r.id AS role_id, r.name AS role_name
    FROM sessions s JOIN users u ON u.id = s.user_id
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.account_status = 'active' ORDER BY CASE r.id WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END LIMIT 1`, [tokenHash(token)]);
  return rows[0] || null;
}
async function attachUser(req, res, next) { try { req.user = await loadUserBySession(req); next(); } catch (error) { next(error); } }
function requireAuth(req, res, next) { if (!req.user) return jsonError(res, 401, 'Please log in to continue.', 'unauthorized'); next(); }
function requireRole(...roles) { return (req, res, next) => { if (!req.user) return jsonError(res, 401, 'Please log in to continue.', 'unauthorized'); if (!roles.includes(req.user.role_id)) return jsonError(res, 403, 'You do not have permission to perform this action.', 'forbidden'); next(); }; }
function requireCsrf(req, res, next) { if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || ['/auth/login', '/auth/register', '/auth/verify-email', '/auth/resend-verification', '/auth/forgot-password', '/auth/reset-password'].includes(req.path)) return next(); const cookies = parseCookies(req.headers.cookie); const header = req.get('X-CSRF-Token'); if (!cookies.webdev_csrf || !header || header !== cookies.webdev_csrf) return jsonError(res, 403, 'Your security token is missing or expired. Refresh and try again.', 'csrf_failed'); next(); }
function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validPassword(password) { return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password); }
function validateRegistration(body) { const fullName = cleanString(body.fullName, 100); const email = cleanString(body.email, 254).toLowerCase(); const password = typeof body.password === 'string' ? body.password : ''; if (fullName.length < 2) return 'Enter your full name.'; if (!emailPattern.test(email)) return 'Enter a valid email address.'; if (!validPassword(password)) return 'Use at least 8 characters with an uppercase letter, lowercase letter, and number.'; return null; }
function validateRequestPayload(body, partial = false) { const result = {}; if (!partial || body.title !== undefined) { result.title = cleanString(body.title, 120); if (result.title.length < 5) return { error: 'Title must be 5 to 120 characters.' }; } if (!partial || body.description !== undefined) { result.description = cleanString(body.description, 5000); if (result.description.length < 20) return { error: 'Description must be 20 to 5,000 characters.' }; } if (!partial || body.categoryId !== undefined) { result.categoryId = Number(body.categoryId); if (!Number.isInteger(result.categoryId) || result.categoryId < 1) return { error: 'Choose a valid category.' }; } if (!partial || body.priority !== undefined) { result.priority = cleanString(body.priority, 20); if (!allowedPriorities.has(result.priority)) return { error: 'Choose a valid priority.' }; } return { value: result }; }
function hasRequestAccess(user, record) { return user.role_id === 'admin' || (user.role_id === 'staff' && record.assigned_staff_id === user.id) || (user.role_id === 'youth' && record.user_id === user.id); }
function roleHome(role) { return role === 'admin' ? '/admin.html' : role === 'staff' ? '/staff.html' : '/dashboard.html'; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }

app.get('/api/health', (req, res) => res.status(pool && databaseReady ? 200 : 503).json({ ok: Boolean(pool && databaseReady), database: databaseReady ? 'ready' : 'not_ready' }));
app.use('/api', attachUser);
app.use('/api', requireCsrf);

app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
app.post('/api/auth/register', requireDatabase, async (req, res, next) => {
  const error = validateRegistration(req.body || {}); if (error) return jsonError(res, 400, error, 'validation_error');
  const accountType = cleanString(req.body.accountType || 'user', 20);
  if (!['user', 'admin'].includes(accountType)) return jsonError(res, 400, 'Choose a valid account type.', 'validation_error');
  if (accountType === 'admin') {
    const submittedCode = typeof req.body.adminSignupCode === 'string' ? req.body.adminSignupCode : '';
    const submittedBuffer = Buffer.from(submittedCode); const expectedBuffer = Buffer.from(adminSignupCode);
    const codeMatches = Boolean(adminSignupCode) && submittedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(submittedBuffer, expectedBuffer);
    if (!adminSignupCode) return jsonError(res, 503, 'Administrator registration is not enabled. Ask an existing administrator to promote this account or configure an administrator invitation code.', 'admin_signup_not_configured');
    if (!codeMatches) return jsonError(res, 403, 'The administrator invitation code is invalid.', 'invalid_admin_signup_code');
  }
  if (!mailTransport) return jsonError(res, 503, 'Email delivery is not configured. Contact the site administrator.', 'email_delivery_not_configured');
  const fullName = cleanString(req.body.fullName, 100); const email = cleanString(req.body.email, 254).toLowerCase(); const passwordHash = await bcrypt.hash(req.body.password, 12); const code = newVerificationCode(); const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); const [existing] = await connection.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) { await connection.rollback(); return jsonError(res, 409, 'An account with this email already exists.', 'email_exists'); }
    const [insert] = await connection.query("INSERT INTO users (full_name, email, password_hash, location, account_status) VALUES (?, ?, ?, ?, 'pending') RETURNING id", [fullName, email, passwordHash, cleanString(req.body.location, 100) || null]);
    await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [insert.insertId, accountType === 'admin' ? 'admin' : 'youth']);
    await connection.query("INSERT INTO email_verification_codes (user_id, code_hash, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '10 minutes')", [insert.insertId, await bcrypt.hash(code, 10)]);
    await connection.commit();
    try { await sendVerificationEmail(email, code); } catch (mailError) { await pool.query('DELETE FROM email_verification_codes WHERE user_id = ?', [insert.insertId]); console.error('Verification email delivery failed:', mailError.message); return jsonError(res, 503, 'We could not send the verification email. Try again later.', 'email_delivery_failed'); }
    return res.status(202).json({ verificationRequired: true, email });
  } catch (dbError) { await connection.rollback(); next(dbError); } finally { connection.release(); }
});
app.post('/api/auth/verify-email', requireDatabase, async (req, res, next) => {
  const email = cleanString(req.body?.email, 254).toLowerCase(); const code = cleanString(req.body?.code, 6);
  if (!emailPattern.test(email) || !/^\d{6}$/.test(code)) return jsonError(res, 400, 'Enter the email address and six-digit verification code.', 'validation_error');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT u.*, r.id AS role_id, r.name AS role_name, v.code_hash, v.attempts FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id JOIN email_verification_codes v ON v.user_id = u.id WHERE u.email = ? AND u.account_status = 'pending' AND v.expires_at > CURRENT_TIMESTAMP AND v.attempts < 5 LIMIT 1 FOR UPDATE OF u, v`, [email]);
    const record = rows[0];
    if (!record) { await connection.rollback(); return jsonError(res, 400, 'The verification code is invalid or expired.', 'invalid_verification_code'); }
    if (!(await bcrypt.compare(code, record.code_hash))) {
      const attempts = Number(record.attempts) + 1;
      if (attempts >= 5) await connection.query('DELETE FROM email_verification_codes WHERE user_id = ?', [record.id]);
      else await connection.query('UPDATE email_verification_codes SET attempts = ? WHERE user_id = ?', [attempts, record.id]);
      await connection.commit();
      return jsonError(res, 400, attempts >= 5 ? 'Too many incorrect codes. Request a new verification code.' : 'The verification code is incorrect.', 'invalid_verification_code');
    }
    await connection.query("UPDATE users SET account_status = 'active' WHERE id = ?", [record.id]);
    await connection.query('DELETE FROM email_verification_codes WHERE user_id = ?', [record.id]);
    const token = newToken(); await connection.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '7 days')", [tokenHash(token), record.id]);
    await connection.commit(); record.account_status = 'active'; setSessionCookie(res, token);
    return res.json({ user: publicUser(record) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
app.post('/api/auth/resend-verification', requireDatabase, async (req, res, next) => {
  const email = cleanString(req.body?.email, 254).toLowerCase();
  if (!emailPattern.test(email)) return jsonError(res, 400, 'Enter a valid email address.', 'validation_error');
  if (!mailTransport) return jsonError(res, 503, 'Email delivery is not configured. Contact the site administrator.', 'email_delivery_not_configured');
  try {
    const [rows] = await pool.query("SELECT u.id FROM users u WHERE u.email = ? AND u.account_status = 'pending' LIMIT 1", [email]);
    if (!rows[0]) return res.status(202).json({ message: 'If this account needs verification, check for a recent code or try again after one minute.' });
    const [recent] = await pool.query("SELECT user_id FROM email_verification_codes WHERE user_id = ? AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'", [rows[0].id]);
    if (recent.length) return res.status(202).json({ message: 'If this account needs verification, check for a recent code or try again after one minute.' });
    const code = newVerificationCode();
    await pool.query("INSERT INTO email_verification_codes (user_id, code_hash, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '10 minutes') ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = CURRENT_TIMESTAMP", [rows[0].id, await bcrypt.hash(code, 10)]);
    try { await sendVerificationEmail(email, code); } catch (mailError) { await pool.query('DELETE FROM email_verification_codes WHERE user_id = ?', [rows[0].id]); console.error('Verification email delivery failed:', mailError.message); return jsonError(res, 503, 'We could not send the verification email. Try again later.', 'email_delivery_failed'); }
    return res.status(202).json({ message: 'If this account needs verification, a new code will be sent.' });
  } catch (error) { next(error); }
});
app.post('/api/auth/login', requireDatabase, async (req, res, next) => {
  const email = cleanString(req.body?.email, 254).toLowerCase(); const password = typeof req.body?.password === 'string' ? req.body.password : ''; const loginType = cleanString(req.body?.loginType || 'user', 20);
  if (!emailPattern.test(email) || !password || !['user', 'admin'].includes(loginType)) return jsonError(res, 400, 'Enter your email, password, and login type.', 'validation_error');
  try {
    const [rows] = await pool.query(`SELECT u.*, r.id AS role_id, r.name AS role_name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.email = ? LIMIT 1`, [email]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return jsonError(res, 401, 'Email or password is incorrect.', 'invalid_credentials');
    if (rows[0].account_status === 'pending') return jsonError(res, 403, 'Verify your email address before logging in.', 'email_not_verified');
    if (rows[0].account_status !== 'active') return jsonError(res, 403, 'This account is not active. Contact the site administrator.', 'account_inactive');
    const allowed = loginType === 'admin' ? ['admin', 'staff'] : ['youth'];
    if (!allowed.includes(rows[0].role_id)) return jsonError(res, 403, loginType === 'admin' ? 'This account does not have administrator or staff access.' : 'This account does not have user dashboard access.', 'role_mismatch');
    const token = newToken(); await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '7 days')", [tokenHash(token), rows[0].id]); setSessionCookie(res, token); res.json({ user: publicUser(rows[0]) });
  } catch (error) { next(error); }
});
app.post('/api/auth/forgot-password', requireDatabase, async (req, res, next) => {
  const email = cleanString(req.body?.email, 254).toLowerCase();
  if (!emailPattern.test(email)) return jsonError(res, 400, 'Enter a valid email address.', 'validation_error');
  if (!mailTransport) return jsonError(res, 503, 'Password reset email is not configured. Contact the site administrator.', 'email_delivery_not_configured');
  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE email = ? AND account_status = 'active' LIMIT 1", [email]);
    if (rows[0]) {
      const [recent] = await pool.query("SELECT user_id FROM password_reset_tokens WHERE user_id = ? AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'", [rows[0].id]);
      if (!recent.length) {
        const token = newToken();
        await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL '30 minutes') ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, created_at = CURRENT_TIMESTAMP", [rows[0].id, tokenHash(token)]);
        try { await sendPasswordResetEmail(email, token); } catch (mailError) { await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [rows[0].id]); console.error('Password reset email delivery failed:', mailError.message); return jsonError(res, 503, 'We could not send the reset email. Try again later.', 'email_delivery_failed'); }
      }
    }
    res.json({ message: 'If an account exists for that address, password reset instructions have been sent.' });
  } catch (error) { next(error); }
});
app.post('/api/auth/reset-password', requireDatabase, async (req, res, next) => {
  const token = cleanString(req.body?.token, 128); const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^[a-f0-9]{64}$/i.test(token) || !validPassword(password)) return jsonError(res, 400, 'Use a valid reset link and a password with at least 8 characters, an uppercase letter, a lowercase letter, and a number.', 'validation_error');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT u.id FROM password_reset_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > CURRENT_TIMESTAMP AND u.account_status = 'active' LIMIT 1 FOR UPDATE OF t, u", [tokenHash(token)]);
    if (!rows[0]) { await connection.rollback(); return jsonError(res, 400, 'This reset link is invalid or expired. Request a new one.', 'invalid_reset_token'); }
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].id]);
    await connection.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [rows[0].id]);
    await connection.query('DELETE FROM sessions WHERE user_id = ?', [rows[0].id]);
    await connection.commit();
    res.json({ message: 'Your password has been reset. You can now log in.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
app.post('/api/auth/logout', requireDatabase, async (req, res, next) => { try { const token = parseCookies(req.headers.cookie)[sessionCookie]; if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]); clearSessionCookie(res); res.status(204).end(); } catch (error) { next(error); } });

app.patch('/api/profile', requireDatabase, requireRole('youth'), async (req, res, next) => {
  const fullName = cleanString(req.body?.fullName, 100); const email = cleanString(req.body?.email, 254).toLowerCase(); if (fullName.length < 2 || !emailPattern.test(email)) return jsonError(res, 400, 'Enter a valid name and email address.', 'validation_error');
  const values = [fullName, email, cleanString(req.body.location, 100) || null, cleanString(req.body.phone, 30) || null, cleanString(req.body.qualification, 120) || null, cleanString(req.body.about, 500) || null, cleanString(req.body.skills, 500) || null, cleanString(req.body.interests, 400) || null, req.user.id];
  try { const [conflict] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, req.user.id]); if (conflict.length) return jsonError(res, 409, 'That email address is already in use.', 'email_exists'); await pool.query('UPDATE users SET full_name = ?, email = ?, location = ?, phone = ?, qualification = ?, about = ?, skills = ?, interests = ? WHERE id = ?', values); const [rows] = await pool.query(`SELECT u.*, r.id AS role_id, r.name AS role_name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ?`, [req.user.id]); res.json({ user: publicUser(rows[0]) }); } catch (error) { next(error); }
});
app.get('/api/categories', requireDatabase, requireAuth, async (req, res, next) => { try { const [rows] = await pool.query('SELECT id, name, description FROM request_categories WHERE is_active = TRUE ORDER BY name'); res.json({ categories: rows }); } catch (error) { next(error); } });

function mapOpportunity(row) { const parse = (value) => Array.isArray(value) ? value : JSON.parse(value || '[]'); return { id: row.id, title: row.title, organisation: row.organisation, category: row.category, location: row.location, experienceLevel: row.experience_level, closingDate: row.closing_date instanceof Date ? row.closing_date.toISOString().slice(0, 10) : String(row.closing_date).slice(0, 10), shortDescription: row.short_description, fullDescription: row.full_description, imageUrl: row.image_url || '', imageAlt: row.image_alt || '', requirements: parse(row.requirements), documentsRequired: parse(row.documents_required), applicationLink: row.application_link || '', sourceUrl: row.source_url || '', sourceName: row.source_name || '', verificationStatus: row.verification_status, verifiedAt: row.verified_at ? String(row.verified_at).slice(0, 10) : '', updatedDate: row.updated_date ? String(row.updated_date).slice(0, 10) : '' }; }
app.get('/api/opportunities', requireDatabase, async (req, res, next) => { try { const [rows] = await pool.query('SELECT * FROM opportunities WHERE is_active = TRUE ORDER BY closing_date ASC, title ASC'); res.json({ opportunities: rows.map(mapOpportunity) }); } catch (error) { next(error); } });
app.get('/api/admin/opportunities', requireDatabase, requireRole('admin'), async (req, res, next) => { try { const [rows] = await pool.query('SELECT * FROM opportunities ORDER BY updated_at DESC, title ASC'); res.json({ opportunities: rows.map((row) => ({ ...mapOpportunity(row), isActive: Boolean(row.is_active) })) }); } catch (error) { next(error); } });
app.post('/api/admin/opportunities', requireDatabase, requireRole('admin'), async (req, res, next) => { const body = req.body || {}; const id = cleanString(body.id || `admin-${crypto.randomBytes(8).toString('hex')}`, 80).replace(/[^A-Za-z0-9_-]/g, '-'); const title = cleanString(body.title, 180); const organisation = cleanString(body.organisation, 180); const category = cleanString(body.category, 100); const location = cleanString(body.location, 180); const experienceLevel = cleanString(body.experienceLevel, 100); const closingDate = cleanString(body.closingDate, 10); const shortDescription = cleanString(body.shortDescription, 500); const fullDescription = cleanString(body.fullDescription, 5000); if (!title || !organisation || !category || !location || !experienceLevel || !/^\d{4}-\d{2}-\d{2}$/.test(closingDate) || shortDescription.length < 10 || fullDescription.length < 10) return jsonError(res, 400, 'Complete the required opportunity fields with valid values.', 'validation_error'); try { await pool.query('INSERT INTO opportunities (id, title, organisation, category, location, experience_level, closing_date, short_description, full_description, image_url, image_alt, requirements, documents_required, application_link, source_url, source_name, verification_status, verified_at, updated_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, title, organisation, category, location, experienceLevel, closingDate, shortDescription, fullDescription, cleanString(body.imageUrl, 500) || null, cleanString(body.imageAlt, 255) || null, JSON.stringify(Array.isArray(body.requirements) ? body.requirements.slice(0, 20).map((item) => cleanString(item, 300)) : []), JSON.stringify(Array.isArray(body.documentsRequired) ? body.documentsRequired.slice(0, 20).map((item) => cleanString(item, 300)) : []), cleanString(body.applicationLink, 500) || null, cleanString(body.sourceUrl, 500) || null, cleanString(body.sourceName, 180) || null, 'sample', null, new Date().toISOString().slice(0, 10)]); const [rows] = await pool.query('SELECT * FROM opportunities WHERE id = ?', [id]); res.status(201).json({ opportunity: mapOpportunity(rows[0]) }); } catch (error) { if (error.code === '23505') return jsonError(res, 409, 'An opportunity with that ID already exists.', 'opportunity_exists'); next(error); } });
app.delete('/api/admin/opportunities/:id', requireDatabase, requireRole('admin'), async (req, res, next) => { try { const [result] = await pool.query('UPDATE opportunities SET is_active = FALSE WHERE id = ?', [cleanString(req.params.id, 80)]); if (!result.affectedRows) return jsonError(res, 404, 'Opportunity not found.', 'not_found'); res.status(204).end(); } catch (error) { next(error); } });

async function requestRecord(id) { const [rows] = await pool.query(`SELECT sr.*, c.name AS category_name, u.full_name AS requester_name, u.email AS requester_email, s.full_name AS assignee_name FROM service_requests sr JOIN request_categories c ON c.id = sr.category_id JOIN users u ON u.id = sr.user_id LEFT JOIN users s ON s.id = sr.assigned_staff_id WHERE sr.id = ?`, [id]); return rows[0] || null; }
async function visibleRequest(req, id) { const record = await requestRecord(id); return record && hasRequestAccess(req.user, record) ? record : null; }

app.get('/api/dashboard/stats', requireDatabase, requireRole('youth', 'staff', 'admin'), async (req, res, next) => {
  try { const condition = req.user.role_id === 'admin' ? '' : req.user.role_id === 'staff' ? ' AND assigned_staff_id = ?' : ' AND user_id = ?'; const params = req.user.role_id === 'admin' ? [] : [req.user.id]; const [rows] = await pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'Pending') AS pending, COUNT(*) FILTER (WHERE status = 'In Progress') AS "inProgress", COUNT(*) FILTER (WHERE status = 'Resolved') AS resolved, COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected, COUNT(*) FILTER (WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days') AS "newlySubmitted" FROM service_requests WHERE TRUE${condition}`, params); res.json({ stats: { total: Number(rows[0].total || 0), pending: Number(rows[0].pending || 0), inProgress: Number(rows[0].inProgress || 0), resolved: Number(rows[0].resolved || 0), rejected: Number(rows[0].rejected || 0), newlySubmitted: Number(rows[0].newlySubmitted || 0) } }); } catch (error) { next(error); }
});

app.get('/api/requests', requireDatabase, requireRole('youth', 'staff', 'admin'), async (req, res, next) => {
  try {
    const clauses = []; const params = [];
    if (req.user.role_id === 'youth') { clauses.push('sr.user_id = ?'); params.push(req.user.id); }
    if (req.user.role_id === 'staff') { clauses.push('sr.assigned_staff_id = ?'); params.push(req.user.id); }
    if (req.query.status && allowedStatuses.has(req.query.status)) { clauses.push('sr.status = ?'); params.push(req.query.status); }
    if (req.query.priority && allowedPriorities.has(req.query.priority)) { clauses.push('sr.priority = ?'); params.push(req.query.priority); }
    if (req.query.categoryId && Number.isInteger(Number(req.query.categoryId))) { clauses.push('sr.category_id = ?'); params.push(Number(req.query.categoryId)); }
    if (validDate(req.query.createdFrom)) { clauses.push('DATE(sr.created_at) >= ?'); params.push(req.query.createdFrom); }
    if (validDate(req.query.createdTo)) { clauses.push('DATE(sr.created_at) <= ?'); params.push(req.query.createdTo); }
    const search = cleanString(req.query.search, 100); if (search) { clauses.push('(sr.title LIKE ? OR sr.description LIKE ? OR sr.reference_number LIKE ? OR u.full_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    const sortMap = { updated: 'sr.updated_at DESC', created: 'sr.created_at DESC', priority: "CASE sr.priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END", status: "CASE sr.status WHEN 'Pending' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Resolved' THEN 3 WHEN 'Rejected' THEN 4 ELSE 5 END, sr.updated_at DESC" }; const orderBy = sortMap[req.query.sort] || sortMap.updated;
    const [rows] = await pool.query(`SELECT sr.id, sr.reference_number, sr.title, sr.description, sr.priority, sr.status, sr.created_at, sr.updated_at, sr.user_id, sr.assigned_staff_id, c.name AS category_name, u.full_name AS requester_name, u.email AS requester_email, s.full_name AS assignee_name FROM service_requests sr JOIN request_categories c ON c.id = sr.category_id JOIN users u ON u.id = sr.user_id LEFT JOIN users s ON s.id = sr.assigned_staff_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${orderBy} LIMIT 100`, params); res.json({ requests: rows });
  } catch (error) { next(error); }
});

app.post('/api/requests', requireDatabase, requireRole('youth'), async (req, res, next) => {
  const parsed = validateRequestPayload(req.body || {}); if (parsed.error) return jsonError(res, 400, parsed.error, 'validation_error');
  try {
    const [category] = await pool.query('SELECT id FROM request_categories WHERE id = ? AND is_active = TRUE', [parsed.value.categoryId]); if (!category.length) return jsonError(res, 400, 'Choose an active request category.', 'validation_error');
    const temporaryReference = `TMP-${crypto.randomBytes(8).toString('hex')}`; const [insert] = await pool.query('INSERT INTO service_requests (reference_number, title, description, category_id, priority, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', [temporaryReference, parsed.value.title, parsed.value.description, parsed.value.categoryId, parsed.value.priority, req.user.id]); const reference = `YSP-${String(insert.insertId).padStart(8, '0')}`; await pool.query('UPDATE service_requests SET reference_number = ? WHERE id = ?', [reference, insert.insertId]); await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, NULL, ?)', [insert.insertId, req.user.id, 'Request submitted.', 'Pending']); res.status(201).json({ request: await requestRecord(insert.insertId) });
  } catch (error) { next(error); }
});

app.get('/api/requests/:id', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const record = await visibleRequest(req, Number(req.params.id)); if (!record) return jsonError(res, 404, 'Request not found.', 'not_found');
    const [updates] = await pool.query(`SELECT ru.id, ru.update_message, ru.previous_status, ru.new_status, ru.created_at, u.full_name AS actor_name, r.name AS actor_role FROM request_updates ru JOIN users u ON u.id = ru.actor_user_id LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE ru.request_id = ? ORDER BY ru.created_at ASC`, [record.id]);
    const visibility = req.user.role_id === 'admin' ? '' : ' AND rm.is_internal = FALSE'; const [messages] = await pool.query(`SELECT rm.id, rm.sender_id, rm.message, rm.is_internal, rm.created_at, u.full_name AS sender_name, r.name AS sender_role FROM request_messages rm JOIN users u ON u.id = rm.sender_id LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE rm.request_id = ?${visibility} ORDER BY rm.created_at ASC`, [record.id]);
    res.json({ request: record, updates, messages });
  } catch (error) { next(error); }
});

app.patch('/api/requests/:id', requireDatabase, requireAuth, async (req, res, next) => {
  try {
    const record = await visibleRequest(req, Number(req.params.id)); if (!record) return jsonError(res, 404, 'Request not found.', 'not_found'); const parsed = validateRequestPayload(req.body || {}, true); if (parsed.error) return jsonError(res, 400, parsed.error, 'validation_error');
    const isOwnerEdit = req.user.role_id === 'youth' && record.user_id === req.user.id; const canManage = req.user.role_id === 'admin'; const canStaffUpdate = req.user.role_id === 'staff' && record.assigned_staff_id === req.user.id;
    if ((isOwnerEdit || canManage) && parsed.value.categoryId !== undefined) { const [category] = await pool.query('SELECT id FROM request_categories WHERE id = ? AND is_active = TRUE', [parsed.value.categoryId]); if (!category.length) return jsonError(res, 400, 'Choose an active request category.', 'validation_error'); }
    if (isOwnerEdit && record.status !== 'Pending') return jsonError(res, 409, 'Only pending requests can be edited.', 'request_locked'); if (!isOwnerEdit && !canManage && !canStaffUpdate) return jsonError(res, 403, 'You cannot update this request.', 'forbidden');
    if (isOwnerEdit && req.body.status !== undefined && req.body.status !== 'Cancelled') return jsonError(res, 403, 'Users cannot change protected request statuses.', 'forbidden');
    if (isOwnerEdit && req.body.status === 'Cancelled') { await pool.query('UPDATE service_requests SET status = ? WHERE id = ?', ['Cancelled', record.id]); await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, ?, ?)', [record.id, req.user.id, 'Request cancelled by the requester.', record.status, 'Cancelled']); }
    else if (isOwnerEdit || canManage) { const values = parsed.value; const updates = []; const params = []; for (const field of ['title', 'description', 'categoryId', 'priority']) if (values[field] !== undefined) { updates.push(`${field === 'categoryId' ? 'category_id' : field} = ?`); params.push(values[field]); } if (canManage && req.body.status !== undefined) { if (!allowedStatuses.has(req.body.status)) return jsonError(res, 400, 'Choose a valid status.', 'validation_error'); updates.push('status = ?'); params.push(req.body.status); } if (!updates.length) return jsonError(res, 400, 'No editable fields were supplied.', 'validation_error'); params.push(record.id); await pool.query(`UPDATE service_requests SET ${updates.join(', ')} WHERE id = ?`, params); const newStatus = req.body.status || record.status; await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, ?, ?)', [record.id, req.user.id, cleanString(req.body.updateMessage, 1000) || 'Request details updated.', record.status, newStatus]); }
    else if (canStaffUpdate) { const status = cleanString(req.body.status, 20); const message = cleanString(req.body.updateMessage, 1000); if (!allowedStatuses.has(status) || !message) return jsonError(res, 400, 'Choose a valid status and add a progress note.', 'validation_error'); await pool.query('UPDATE service_requests SET status = ? WHERE id = ?', [status, record.id]); await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, ?, ?)', [record.id, req.user.id, message, record.status, status]); }
    res.json({ request: await requestRecord(record.id) });
  } catch (error) { next(error); }
});

app.post('/api/requests/:id/updates', requireDatabase, requireAuth, async (req, res, next) => {
  try { const record = await visibleRequest(req, Number(req.params.id)); if (!record || req.user.role_id === 'youth') return jsonError(res, 403, 'Only staff or administrators can add progress notes.', 'forbidden'); const message = cleanString(req.body?.updateMessage, 1000); const status = cleanString(req.body?.status || record.status, 20); if (!message || !allowedStatuses.has(status)) return jsonError(res, 400, 'Add a progress note and choose a valid status.', 'validation_error'); if (req.user.role_id === 'staff' && record.assigned_staff_id !== req.user.id) return jsonError(res, 403, 'You can update only requests assigned to you.', 'forbidden'); await pool.query('UPDATE service_requests SET status = ? WHERE id = ?', [status, record.id]); const [insert] = await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, ?, ?) RETURNING id', [record.id, req.user.id, message, record.status, status]); res.status(201).json({ updateId: insert.insertId, request: await requestRecord(record.id) }); } catch (error) { next(error); }
});

app.post('/api/requests/:id/messages', requireDatabase, requireAuth, async (req, res, next) => {
  try { const record = await visibleRequest(req, Number(req.params.id)); if (!record) return jsonError(res, 404, 'Request not found.', 'not_found'); const message = cleanString(req.body?.message, 2000); if (message.length < 1) return jsonError(res, 400, 'Write a message before sending.', 'validation_error'); const canReply = req.user.role_id === 'admin' || (req.user.role_id === 'youth' && record.user_id === req.user.id) || (req.user.role_id === 'staff' && record.assigned_staff_id === req.user.id); if (!canReply) return jsonError(res, 403, 'You cannot reply to this request.', 'forbidden'); const isInternal = req.user.role_id === 'admin' && req.body?.isInternal === true; const [insert] = await pool.query('INSERT INTO request_messages (request_id, sender_id, message, is_internal) VALUES (?, ?, ?, ?) RETURNING id', [record.id, req.user.id, message, isInternal]); res.status(201).json({ messageId: insert.insertId }); } catch (error) { next(error); }
});

app.get('/api/admin/users', requireDatabase, requireRole('admin'), async (req, res, next) => { try { const [rows] = await pool.query(`SELECT u.id, u.full_name, u.email, u.account_status, u.registration_date, r.id AS role, r.name AS role_label FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id ORDER BY u.registration_date DESC LIMIT 200`); res.json({ users: rows }); } catch (error) { next(error); } });
app.patch('/api/admin/users/:id/role', requireDatabase, requireRole('admin'), async (req, res, next) => { const role = cleanString(req.body?.role, 20); const userId = Number(req.params.id); if (!allowedRoles.has(role)) return jsonError(res, 400, 'Choose a valid role.', 'validation_error'); if (userId === req.user.id) return jsonError(res, 400, 'You cannot change your own administrator role.', 'validation_error'); const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [user] = await connection.query('SELECT id FROM users WHERE id = ?', [userId]); if (!user.length) { await connection.rollback(); return jsonError(res, 404, 'User not found.', 'not_found'); } await connection.query('DELETE FROM user_roles WHERE user_id = ?', [userId]); await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role]); await connection.commit(); res.status(204).end(); } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); } });
app.get('/api/admin/staff', requireDatabase, requireRole('admin'), async (req, res, next) => { try { const [rows] = await pool.query(`SELECT u.id, u.full_name, u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_id = 'staff' AND u.account_status = 'active' ORDER BY u.full_name`); res.json({ staff: rows }); } catch (error) { next(error); } });
app.patch('/api/admin/requests/:id/assignment', requireDatabase, requireRole('admin'), async (req, res, next) => { const staffId = req.body?.staffId === null || req.body?.staffId === '' ? null : Number(req.body?.staffId); if (staffId !== null && !Number.isInteger(staffId)) return jsonError(res, 400, 'Choose a valid staff member.', 'validation_error'); try { const record = await requestRecord(Number(req.params.id)); if (!record) return jsonError(res, 404, 'Request not found.', 'not_found'); if (staffId !== null) { const [staff] = await pool.query(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE u.id = ? AND ur.role_id = 'staff' AND u.account_status = 'active'`, [staffId]); if (!staff.length) return jsonError(res, 400, 'Choose an active staff account.', 'validation_error'); } await pool.query('UPDATE service_requests SET assigned_staff_id = ? WHERE id = ?', [staffId, record.id]); await pool.query('INSERT INTO request_updates (request_id, actor_user_id, update_message, previous_status, new_status) VALUES (?, ?, ?, ?, ?)', [record.id, req.user.id, staffId ? 'Request assigned to a staff service agent.' : 'Request assignment cleared.', record.status, record.status]); res.json({ request: await requestRecord(record.id) }); } catch (error) { next(error); } });
app.post('/api/admin/categories', requireDatabase, requireRole('admin'), async (req, res, next) => { const name = cleanString(req.body?.name, 80); const description = cleanString(req.body?.description, 255); if (name.length < 3) return jsonError(res, 400, 'Category name must be at least 3 characters.', 'validation_error'); try { const [result] = await pool.query('INSERT INTO request_categories (name, description) VALUES (?, ?) RETURNING id', [name, description || null]); res.status(201).json({ category: { id: result.insertId, name, description } }); } catch (error) { if (error.code === '23505') return jsonError(res, 409, 'That category already exists.', 'category_exists'); next(error); } });

function protectRolePage(roles) { return async (req, res, next) => { try { const user = await loadUserBySession(req); if (!user) return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`); if (!roles.includes(user.role_id)) return res.redirect(roleHome(user.role_id)); req.user = user; next(); } catch (error) { next(error); } }; }
const protectUserPage = (req, res, next) => protectRolePage(['youth'])(req, res, next);
const protectAdminPage = (req, res, next) => protectRolePage(['admin'])(req, res, next);
const protectStaffPage = (req, res, next) => protectRolePage(['staff', 'admin'])(req, res, next);
const protectRequestPage = (req, res, next) => protectRolePage(['youth', 'staff', 'admin'])(req, res, next);
app.get(['/dashboard', '/dashboard.html', '/request-new', '/request-new.html', '/profile', '/profile.html'], protectUserPage);
app.get(['/request-detail', '/request-detail.html'], protectRequestPage);
app.get(['/staff', '/staff.html'], protectStaffPage);
app.get(['/admin', '/admin.html'], protectAdminPage);
app.use((req, res, next) => { const blocked = /^(?:\/db(?:\/|$)|\/docs(?:\/|$)|\/scripts(?:\/|$)|\/(?:server\.js|package\.json|pnpm-lock\.yaml|Dockerfile|\.env(?:\.|$)|plan\.md|TODO\.md|TESTING\.md|README\.md|VERIFICATION_SOURCES\.md|app\.config\.ts))/i; if (blocked.test(req.path)) return res.status(404).end(); next(); });
app.use(express.static(root, { extensions: ['html'] }));
app.use((req, res, next) => { if (req.path.startsWith('/api/')) return jsonError(res, 404, 'API endpoint not found.', 'not_found'); next(); });
app.use((error, req, res, next) => { console.error(error.message); if (req.path.startsWith('/api/')) return jsonError(res, 500, 'Something went wrong on the server.', 'server_error'); res.status(500).send('Something went wrong.'); });

ensureSchema().catch((error) => console.error('Database initialization failed:', error.message));
app.listen(port, '0.0.0.0', () => console.log(`Youth Portal listening on ${port}`));
