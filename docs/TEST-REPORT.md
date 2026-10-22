# Youth Portal verification report

Date: 20 October 2026

The results below distinguish source checks from live database API tests. A test is marked **PASS** only when it was executed against the running application.

| ID | Test case | Expected result | Actual result | Status |
|---|---|---|---|---|
| T01 | JavaScript and route-manifest syntax | Server, migration, client scripts parse and route manifest is valid JSON | `node --check` passed for all JavaScript files and `python3 -m json.tool manus-routes.json` passed | PASS |
| T02 | Local HTML asset/link integrity | All local page references resolve | Automated HTML reference scan found 0 missing local targets | PASS |
| T03 | Additive migration and health | Existing schema remains usable, new message/reference structures migrate, health reports ready | Updated server startup completed; `/api/health` returned HTTP 200 with `database: ready` | PASS |
| T04 | User registration/default role | New registration creates a session and standard youth/user role | Live suite passed registration for four QA users and verified `role=youth` | PASS |
| T05 | Login modes and invalid credentials | Wrong password is rejected; user/admin modes honor backend role | Live suite passed invalid login, user-mode login, admin-mode login, and wrong-mode 403 checks | PASS |
| T06 | Unauthenticated protection | Anonymous visitors cannot access either dashboard or private request API | Live suite passed API 401 and both dashboard 302 checks | PASS |
| T07 | Strict dashboard separation | User cannot open Admin Dashboard; administrator cannot open User Dashboard | Live suite passed both wrong-dashboard backend redirect checks | PASS |
| T08 | Request creation/reference/status | User request is persisted for owner, starts Pending, and receives a unique reference | Live suite verified HTTP 201, `YSP-########`, Pending, list visibility, and immediate admin availability | PASS |
| T09 | Validation and cancellation | Invalid request data is rejected; only a pending owner request can be cancelled | Live suite passed backend validation and pending cancellation | PASS |
| T10 | Ownership isolation | A different user cannot read the owner’s request by changing its ID | Live suite returned HTTP 404 for the other user | PASS |
| T11 | User conversation | User can reply on an own request and read own history | Live suite persisted a user reply and returned it on detail read | PASS |
| T12 | Administrator reply/internal privacy | Admin can reply; internal notes persist for admins but never appear to users | Live suite passed public reply, internal note, admin visibility, and user filtering checks | PASS |
| T13 | Persisted status synchronization | Admin changes Pending to In Progress/Resolved and user sees the same database state | Live suite passed both status mutations and fresh user reads after each change | PASS |
| T14 | Staff assignment/update | Admin can assign staff; assigned staff can update status; staff sees assigned work | Live suite passed assignment, staff list visibility, and progress update checks | PASS |
| T15 | Administrator management | Admin can list users and change another role; self-promotion/self-demotion is blocked | Live suite passed user listing, self-role protection, and role-change checks | PASS |
| T16 | Admin request management | Admin sees all requests and required user contact information | Live suite passed sorted all-request read with requester email | PASS |
| T17 | Browser/Preview interaction | Login, separate dashboards, filters, live request data, and logout render interactively | Authenticated Sandbox Preview pass loaded Admin Dashboard metrics/filters/requests/assignment/roles and User Dashboard scoped metrics/requests; administrator logout and user login were also verified | PASS |

The live API suite completed with `LIVE_API_TESTS_PASSED=48`, including the administrator-registration invitation gate, direct administrator status changes reflected after user refetch, and opportunity add/delete synchronization to the public user side.

## Evidence placeholders

- `[ ]` Database schema screenshot: `docs/evidence/schema.png`
- `[ ]` User and role records screenshot: `docs/evidence/users.png`
- `[ ]` User/Admin login screenshots: `docs/evidence/auth.png`
- `[ ]` User Dashboard screenshot: `docs/evidence/user-dashboard.png`
- `[ ]` Admin Dashboard screenshot: `docs/evidence/admin-dashboard.png`
- `[ ]` Conversation and internal-note privacy screenshot: `docs/evidence/conversation.png`
- `[ ]` Protected-route and ownership-isolation screenshot: `docs/evidence/protected-routes.png`
- `[ ]` API request/response capture: `docs/evidence/api.png`
- `[ ]` Frontend and backend validation screenshots: `docs/evidence/validation.png`

The browser pass also verified that dashboard initialization works with `script-src 'self'`; preserved public inline scripts were extracted to external files. The live QA run used uniquely prefixed accounts and request records in the shared managed database; no destructive cleanup was performed.
