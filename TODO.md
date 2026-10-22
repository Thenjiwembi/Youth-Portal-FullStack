# Youth Portal Two-Dashboard Upgrade TODO

## 1. Preserve the existing portal and entry experience
- Keep the existing Youth Portal branding, colours, layout, logo, useful opportunity listings, career resources, profile, contact/report pages, responsive behavior, and supplied assets wherever possible.
- Keep the public welcome page professional, with clear login and registration entry points.
- Keep protected pages out of public access and provide separate user and administrator navigation.

## 2. Implement secure authentication and role separation
- Provide User Login, Admin Login, User Registration, Forgot Password guidance/configuration, and Logout.
- Verify credentials and the account’s actual role on the backend and database; do not use a public role selector to grant admin access.
- User Registration automatically assigns the standard registered-user/youth role.
- Admin Registration is a separate form mode and may create an administrator only when the server has a configured invitation code and the submitted code matches it; without that code, an existing administrator must promote the account. Users cannot promote themselves through URLs, browser JavaScript, or profile edits.
- An unauthenticated visitor cannot access either private dashboard. A user cannot access Admin Dashboard, and an admin cannot access User Dashboard or user-only routes. Wrong-role access is denied and redirected to the permitted dashboard or login.
- Logout invalidates the authenticated session and protected pages cannot be reopened through browser navigation.
- Store no plaintext passwords; use secure server-side sessions and Preview-compatible HttpOnly, Secure, SameSite=None cookies.

## 3. Build the User Dashboard
- Show the logged-in user’s name, database-backed total/pending/in-progress/resolved counts, recent requests, loading states, empty states, and errors.
- Provide request submission with title, category, detailed description, priority, and submission date. Validate required fields in the frontend and backend.
- On submission, save the request for the authenticated user, assign Pending, generate a unique reference number, show a success message/reference, and make it immediately available to the administrator.
- Users cannot set Resolved, assign administrators, or change protected status fields themselves.
- Provide My Requests with reference number, title, category, submission date, priority, status, last updated date, details action, search, and status/category filters.
- Users see only their own requests and can open request details with replies, history, latest status, and last-updated information.
- Users may respond or provide additional information only on requests they own and only where permitted.
- Users may update permitted profile fields such as full name and contact details, but never role or administrative settings.

## 4. Build the separate Admin Dashboard
- Restrict the Admin Dashboard to authorized administrators and never treat navigation hiding as security.
- Show database-backed total, pending, in-progress, resolved, rejected, newly submitted, and recent-activity views.
- Provide an admin request-management page for all users’ requests with reference, user name/email as needed, title, category, description, priority, submission date, status, last updated date, details/manage action, search, sorting, and filters by status/category/priority/date.
- Let administrators open any authorized request, review full details/history, reply, change status, manage users/roles, and optionally assign staff.
- Provide a direct administrator status control on request-management cards; persist the change, record status history, and make the new status appear on the user dashboard after refetch/refresh.
- Status changes must be backend-validated, persisted, update `updated_at`, record previous/new status, administrator ID, and timestamp, and appear in both dashboards after refetch/refresh.
- Replies must persist message, sender, request, timestamp, and visibility; users may see only replies for their own requests. Internal notes, if used, remain hidden from users.
- Administrators cannot impersonate users or access user-only functions as though they were the user.

## 5. Implement shared relational backend and policies
- Use the existing secure relational database with profiles/users, requests, request messages, request status history, roles/permissions, sessions, and categories.
- Define primary keys, foreign keys, required fields, unique email, indexes, reference numbers, validation constraints, and ownership relationships.
- Enforce policies/server authorization so users read only their own profile/requests, create only for themselves, cannot self-promote or alter protected status, admins manage authorized records, internal notes remain private, and unauthenticated visitors cannot access private records.
- Expose secure authentication, create/list/read request, reply, status/history, profile, and admin-management operations with appropriate status codes and safe errors.
- Do not use static samples or localStorage as the primary data store; test records must be identifiable.
- Store opportunities in the managed database; administrators can add or delete listings, and public user-facing opportunity pages load the same active records after refresh.

## 6. Deliver responsive UX and synchronization
- Keep separate user/admin navigation, summary cards, status badges, request tables/lists, detail pages, conversation layout, confirmation messages, loading indicators, empty states, and friendly validation/errors.
- Make desktop, tablet, and mobile layouts usable.
- Use reliable refetching/polling after updates if real-time subscriptions are unavailable, and document that choice.

## 7. Verify and document the assignment
- Execute and report registration/default role, user login/dashboard, user-to-admin denial, IDOR/ownership isolation, request submission/My Requests, admin visibility, admin reply/user visibility, Pending→In Progress, cross-dashboard status synchronization, Resolved/Rejected, admin-to-user denial, unauthenticated protection, frontend/backend validation, persistence after refresh/new login, and internal-note privacy if implemented.
- Record expected result, actual result, and pass/fail; never mark unperformed tests as passed.
- Maintain setup, deployment, database migration, evidence placeholders, and CAPACITI summary documentation.
