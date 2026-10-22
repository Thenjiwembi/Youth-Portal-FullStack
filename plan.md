# Youth Portal Two-Dashboard Upgrade Plan

## Scope

Extend the restored Youth Portal into a secure Youth Service Request Management System with two strictly separate authenticated experiences: a User Dashboard for registered youth users and an Admin Dashboard for authorized administrators. Preserve the existing Youth Portal branding, colours, logo, public opportunity discovery, career resources, profile, and contact/report pages.

## Implementation approach

- Preserve the existing root-served public portal and warm chocolate/coral/cream visual language.
- Keep the Express backend and database-backed sessions, using PostgreSQL through Supabase.
- Enforce dashboard separation server-side: youth users may access only user pages; administrators may access only admin pages; wrong-role requests redirect to the permitted dashboard; unauthenticated requests redirect to login.
- Add explicit User Login and Admin Login modes in the UI while keeping the backend authoritative for actual role verification. Registration always assigns the `youth` role; only an authorized administrator can promote another account.
- Add a request-message conversation model. Users can read administrator replies and respond on their own requests where permitted; administrators can reply to all authorized requests. Internal notes remain administrator-only if used.
- Keep status transitions, history, references, ownership, and replies in the shared database so both dashboards read the same persisted records.
- Add reliable refetching after mutations rather than claiming real-time subscriptions; every success/error state is visible in the UI.
- Retain parameterized queries, secure server sessions, CSP/security headers, escaped rendering, validation, duplicate-submit prevention, and non-sensitive error responses.

## Data model

Keep `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `request_categories`, `service_requests`, and `request_updates`; add `request_messages` with request ID, sender ID, message, internal flag, and timestamp. Add reference numbers and indexes for ownership, status, category, priority, assignment, and timestamps. Use foreign keys, unique email, required fields, and status/priority constraints.

## Project structure

- Root HTML/CSS/JavaScript/assets: preserved public portal plus dedicated user/admin pages.
- `server.js`: authentication, role-aware page gates, API endpoints, validation, ownership checks, messages, status history, and static serving.
- `db/schema.sql`: additive schema and seed data.
- `js/auth.js`, `js/dashboard.js`, `js/request-detail.js`: role-aware login, separate dashboards, conversation rendering, and mutation/refetch behavior.
- `scripts/`: migration and live acceptance tests.
- `docs/`: setup, testing evidence, deployment, and CAPACITI summary.

## Verification and delivery

Run syntax/link/route checks, migration and health checks, then live API tests for registration, role separation, ownership isolation, request persistence, admin visibility, replies, status synchronization, profile rules, and protected routes. Verify Preview homepage and both dashboard routes. Record only executed results. Commit to canonical main; do not publish unless requested.

## Design

### Alternatives considered

- **Brand-preserving editorial portal** (0.06): retain the warm Youth Portal identity and extend it into two calm operational workspaces.
- **Civic service console** (0.04): more utilitarian tables and denser administration views.
- **Youth-first progress journal** (0.03): softer milestones and more personal request progress cues.

### Selected direction: brand-preserving editorial portal

**Design Movement:** Contemporary South African editorial utility with expressive headlines, warm earth tones, and practical service cards.

**Core Principles:** Preserve recognition; make status and role boundaries obvious; keep actions calm and guided; use progressive disclosure for message history.

**Color Philosophy:** Deep chocolate grounds trust, coral signals action, cream keeps the portal open, and restrained status colours preserve accessibility.

**Layout Paradigm:** Editorial public pages; a focused user rail and a denser admin operations surface with separate navigation language.

**Signature Elements:** Coral arrow affordances, warm rounded cards, and short eyebrow labels.

**Interaction Philosophy:** Every action confirms what changed and who can see it; wrong-role access explains and redirects rather than exposing data.

**Animation:** Short, subtle transitions for feedback and status changes; no motion that blocks keyboard access.

**Typography System:** Preserve supplied display typography with compact sans-serif operational labels and readable message text.

**Brand Essence:** A practical first step for young South Africans who need opportunities and support; clear, warm, capable.

**Brand Voice:** Direct, encouraging, and scam-aware. Example lines: “Track your next step.” and “Your request is with the right team.”

**Wordmark & Logo:** Preserve the YouthPortal wordmark and coral arrow mark.

**Signature Brand Color:** Coral orange for primary actions and progress cues.
