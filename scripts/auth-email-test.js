require('dotenv').config();
const { spawn } = require('child_process');
const net = require('net');
const { Client } = require('pg');
const { SMTPServer } = require('smtp-server');

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function call(base, route, body) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the auth email integration test.');
  const smtpMessages = [];
  const testStamp = `${Date.now()}-${process.pid}`;
  const testEmails = [`auth-email-user-${testStamp}@example.test`, `auth-email-admin-${testStamp}@example.test`];
  const smtpServer = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, session, callback) {
      let message = '';
      stream.on('data', (chunk) => { message += chunk.toString(); });
      stream.on('end', () => { smtpMessages.push(message); callback(null); });
    }
  });
  const smtpPort = await freePort();
  const appPort = await freePort();
  let appProcess;
  let db;

  try {
    await new Promise((resolve, reject) => {
      smtpServer.once('error', reject);
      smtpServer.listen(smtpPort, '127.0.0.1', resolve);
    });
    appProcess = spawn(process.execPath, ['server.js'], {
      cwd: require('path').join(__dirname, '..'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(appPort),
        COOKIE_SECURE: 'false',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtpPort),
        SMTP_SECURE: 'false',
        SMTP_REQUIRE_TLS: 'false',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        EMAIL_FROM: 'Youth Portal Test <no-reply@example.test>',
        APP_BASE_URL: `http://127.0.0.1:${appPort}`
      }
    });
    const base = `http://127.0.0.1:${appPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (appProcess.exitCode !== null) throw new Error('Auth test server exited before becoming ready.');
      try {
        const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (health.status === 200) { ready = true; break; }
      } catch {}
      await wait(250);
    }
    if (!ready) throw new Error('Auth test server did not become database-ready.');

    const registration = await call(base, '/api/auth/register', {
      fullName: 'Email Test User',
      email: testEmails[0],
      password: 'TestPass9User',
      accountType: 'user'
    });
    assert(registration.status === 202 && registration.body.verificationRequired, 'registration creates a pending account and requests email verification');
    assert(smtpMessages.length === 1, 'signup sends one verification email');
    const code = smtpMessages[0].match(/verification code is (\d{6})/i)?.[1];
    assert(Boolean(code), 'verification email contains the six-digit code');

    const blockedLogin = await call(base, '/api/auth/login', { email: testEmails[0], password: 'TestPass9User', loginType: 'user' });
    assert(blockedLogin.status === 403 && blockedLogin.body.error === 'email_not_verified', 'pending account cannot log in before email verification');

    const invalidCode = await call(base, '/api/auth/verify-email', { email: testEmails[0], code: '000000' === code ? '000001' : '000000' });
    assert(invalidCode.status === 400, 'incorrect verification code is rejected');
    const verification = await call(base, '/api/auth/verify-email', { email: testEmails[0], code });
    assert(verification.status === 200 && verification.body.user.accountStatus === 'active', 'correct code activates the account');
    const login = await call(base, '/api/auth/login', { email: testEmails[0], password: 'TestPass9User', loginType: 'user' });
    assert(login.status === 200 && login.body.user.role === 'youth', 'verified user can log in');

    const resetRequest = await call(base, '/api/auth/forgot-password', { email: testEmails[0] });
    assert(resetRequest.status === 200 && smtpMessages.length === 2, 'password reset request sends an email');
    const resetEmail = smtpMessages[1].replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
    const resetToken = resetEmail.match(/reset-password\.html\?token=([a-f0-9]{64})/i)?.[1];
    assert(Boolean(resetToken), 'reset email contains a single-use reset link');
    const reset = await call(base, '/api/auth/reset-password', { token: resetToken, password: 'ChangedPass9' });
    assert(reset.status === 200, 'valid reset link updates the password');
    const reusedReset = await call(base, '/api/auth/reset-password', { token: resetToken, password: 'ChangedPass9' });
    assert(reusedReset.status === 400, 'reset link cannot be reused');
    const newPasswordLogin = await call(base, '/api/auth/login', { email: testEmails[0], password: 'ChangedPass9', loginType: 'user' });
    assert(newPasswordLogin.status === 200, 'updated password works after reset');

    if (process.env.ADMIN_SIGNUP_CODE) {
      const adminRegistration = await call(base, '/api/auth/register', {
        fullName: 'Email Test Admin',
        email: testEmails[1],
        password: 'TestPass9Admin',
        accountType: 'admin',
        adminSignupCode: process.env.ADMIN_SIGNUP_CODE
      });
      assert(adminRegistration.status === 202, 'admin registration sends verification when invitation is valid');
      const adminCode = smtpMessages.at(-1).match(/verification code is (\d{6})/i)?.[1];
      const adminVerification = await call(base, '/api/auth/verify-email', { email: testEmails[1], code: adminCode });
      assert(adminVerification.status === 200 && adminVerification.body.user.role === 'admin', 'verified administrator receives admin access');
    }
  } finally {
    if (appProcess && appProcess.exitCode === null) appProcess.kill();
    await new Promise((resolve) => smtpServer.close(resolve));
    db = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
    await db.connect();
    try { await db.query('DELETE FROM users WHERE email = ANY($1::text[])', [testEmails]); }
    finally { await db.end(); }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});