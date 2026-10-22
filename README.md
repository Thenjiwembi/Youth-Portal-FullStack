# Youth Portal Service Request Management System

This project upgrades the original Youth Portal career-resources prototype into a full-stack Youth Service Request Management System while preserving the existing warm Youth Portal branding, responsive opportunity discovery, career resources, profile experience, and scam-awareness content.

## Two separate dashboards

Registered users access the **User Dashboard** at `dashboard.html`. It shows only their database-backed request counts and recent requests, supports new submissions with a persisted `YSP-########` reference number, and provides own-request search, filters, details, replies, status history, permitted edits, and cancellation.

Authorized administrators access the separate **Admin Dashboard** at `admin.html`. It shows all-user statistics, request management with search/sort/date/category/status/priority filters, user contact information needed for service delivery, replies, persisted status changes, internal notes, assignment, category management, and user-role management. Backend page gates and API authorization prevent an administrator from opening user-only dashboard pages and prevent a user from opening administrator pages.

The login page offers User Login and Admin Login modes, but the backend determines the account’s actual role. New registrations always receive the `youth` role. Staff retain a separate assigned-workspace role and cannot access user-only pages.

## What is included

The application provides secure registration, login modes, logout, session-backed profiles, role separation, request references, request messages, administrator replies, internal-note privacy, request status history, staff updates, administrator assignment, category/user management, validation, safe API errors, ownership isolation, and reliable refetch-after-mutation behavior. Public opportunity and career-resource pages remain available without login.

The PostgreSQL schema and additive migration are in `db/schema.sql`; the Express API uses Supabase through the `pg` driver, with server-side protection in `server.js`. The root HTML/CSS/JavaScript files serve the preserved portal and new user/admin workspaces.

## Run locally or in Preview

```bash
pnpm install
pnpm migrate
pnpm check
pnpm dev
```

Set `DATABASE_URL` to the Session pooler URI shown in the Supabase Connect dialog. Copy `.env.example` when configuring another environment and never commit real credentials. Supabase connections use TLS by default. `COOKIE_SECURE=true` is required for HTTPS Preview and production; use `false` only for plain HTTP local testing.

## Security model

Passwords are hashed with bcryptjs and are never returned to the browser. Sessions use random server-side tokens stored as SHA-256 hashes in the database and are delivered through the `webdev_app_session` HttpOnly cookie. State-changing API requests require a server-issued CSRF token. User Registration always receives the user/youth role. Admin Registration is available as a separate mode only when `ADMIN_SIGNUP_CODE` is configured as a managed runtime secret and the code matches; otherwise an existing administrator must promote the account. Role-aware HTML middleware and API authorization enforce dashboard separation, ownership, assignment, and administrator-only actions. Queries are parameterized, rendered message content is escaped, and internal administrator notes are filtered from ordinary users. All page behavior is loaded through external scripts under a strict `script-src 'self'` policy.

New accounts remain pending until the user enters a six-digit email verification code. Password resets use single-use links. Both flows send mail through configured SMTP settings; set `APP_BASE_URL` to the deployed HTTPS origin so emailed reset links return to the correct site. See [`docs/SETUP.md`](docs/SETUP.md) for provider configuration and expiry details.

## Deployment

Use the included `Dockerfile`, expose port 3000, inject `DATABASE_URL` as a protected runtime value, and use `/api/health` as the unauthenticated health check. See [`docs/SETUP.md`](docs/SETUP.md) for migration, administrator bootstrap, and deployment instructions.

## Verification

The checked-in report is [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md). Syntax, route-manifest, local-reference, health, additive migration, role separation, ownership, conversation privacy, CSRF, invitation-gated administrator registration, direct admin status updates, opportunity add/delete synchronization, staff, and administrator checks were executed. The expanded live API suite completed with `LIVE_API_TESTS_PASSED=48`. An authenticated Sandbox Preview pass also verified the Admin Dashboard and User Dashboard rendered their live data and controls.

## Assignment materials

- [`plan.md`](plan.md): implementation approach and design direction.
- [`TODO.md`](TODO.md): explicit acceptance outcomes from the assignment prompt.
- [`docs/CAPACITI-SUMMARY.md`](docs/CAPACITI-SUMMARY.md): concise implementation summary.
- [`docs/SETUP.md`](docs/SETUP.md): environment, migration, deployment, and administrator setup.
- [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md): executed results and evidence placeholders.
