# Youth Portal setup and deployment

## Runtime

The application is an Express server serving the preserved Youth Portal HTML/CSS/JavaScript experience and JSON endpoints under `/api`. It uses PostgreSQL through the `pg` driver and Supabase connection string supplied through `DATABASE_URL`. The browser receives only an HttpOnly session cookie; password hashes and database credentials never enter frontend code.

The User Dashboard is `dashboard.html`; the Admin Dashboard is `admin.html`. Server-side page middleware denies wrong-role dashboard access and redirects the account to its permitted workspace. Request detail pages are shared only for records the authenticated role is authorized to view.

New accounts remain pending until the user enters a six-digit code emailed to the address on signup. Verification codes expire after 10 minutes and are limited to five attempts. Password-reset links are single-use and expire after 30 minutes. Both flows require the SMTP settings below.

Copy `.env.example` to an environment configuration managed by the hosting provider and set `DATABASE_URL` to the **Session pooler** URI shown in Supabase's Connect dialog. Keep the username, host, and port exactly as shown there; the `aws-0-REGION` host in `.env.example` is only a placeholder. The direct database host may resolve only over IPv6, so use the Session pooler on networks without IPv6. Supabase passwords containing reserved URL characters must be percent-encoded. Do not commit `.env` or real database credentials. `DATABASE_SSL=true` enables TLS for Supabase; use `false` only for a local non-TLS PostgreSQL server. `COOKIE_SECURE=true` is required for the HTTPS Preview iframe and production. For plain HTTP local testing only, set it to `false`.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` using credentials from your mail provider. For port 587, use `SMTP_SECURE=false` and `SMTP_REQUIRE_TLS=true`; for port 465, use `SMTP_SECURE=true`. Set `APP_BASE_URL` to the public HTTPS origin so reset links point to the deployed site. Keep mail credentials in protected runtime secrets, never in source control. Restart the server after changing these settings.

## Install and migrate

```bash
pnpm install
pnpm migrate
pnpm check
pnpm dev
```

The additive schema creates `request_messages`, verification-code and reset-token tables, adds a unique `YSP-########` request reference, seeds roles/permissions/categories, and preserves existing data. The migration runner tolerates already-applied tables, columns, and indexes. The server also checks the schema at startup. The project database is shared by development and published runtime, so do not run destructive SQL against it.

## First administrator

New registrations stay pending until email verification and then receive the selected permitted role. To bootstrap the first administrator, enable a strong `ADMIN_SIGNUP_CODE` secret, register using Admin Registration, verify the email, and then use the account. Alternatively, register and verify a normal account and run this protected, provider-managed SQL operation once:

```sql
UPDATE user_roles SET role_id = 'admin' WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.org');
```

Replace the example email with the administrator account and execute it only against the intended project database. Subsequent role changes should use the Admin Dashboard/API. Administrators cannot change their own administrator role through the UI.

## Deployment

Use a server-capable deployment with the included `Dockerfile`, expose port `3000`, inject database and SMTP settings as protected runtime variables, set `APP_BASE_URL` to the deployed HTTPS origin, and configure `/api/health` as the unauthenticated health check. Keep the existing static pages and `/api/*` on the same origin.

The managed Webdev configuration enables `server` and `database`. A published deployment should use the checkpointed source, install dependencies from the manifest, run `node server.js`, and preserve the same database URL. Use HTTPS in production.

## Security notes

Sessions are random server-side tokens stored as SHA-256 hashes. Passwords use bcryptjs with a cost factor of 12. State-changing API requests require the browser-readable `webdev_csrf` token paired with the session. API queries are parameterized, request access is filtered by role and ownership/assignment, sensitive fields are not returned to the browser, internal notes are filtered from users, and server errors return generic JSON messages. The application uses `webdev_app_session`; `Secure; SameSite=None` is used for public HTTPS embedding. Page behavior is loaded through external scripts so the strict `script-src 'self'` policy does not block preserved public features or dashboard initialization.

### Creating an administrator account

The default **User Registration** mode always creates a `youth` account. The separate **Admin Registration** mode is intentionally disabled unless the runtime has an `ADMIN_SIGNUP_CODE` secret. Configure a strong code as a managed runtime secret, restart the server, then use the Admin Registration form and share the code only through a trusted channel. If no code is configured, create a normal account and have an existing administrator change its role from the Admin Dashboard; do not add a public role selector or hard-code an administrator password.
