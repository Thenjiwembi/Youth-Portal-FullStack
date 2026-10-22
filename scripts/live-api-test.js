require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now();
const users = {
  owner: { fullName: 'QA Owner', email: `qa.owner.${stamp}@example.test`, password: 'QaPass9Owner' },
  viewer: { fullName: 'QA Viewer', email: `qa.viewer.${stamp}@example.test`, password: 'QaPass9Viewer' },
  other: { fullName: 'QA Other', email: `qa.other.${stamp}@example.test`, password: 'QaPass9Other' },
  candidate: { fullName: 'QA Candidate', email: `qa.candidate.${stamp}@example.test`, password: 'QaPass9Candidate' }
};
let passCount = 0;
function assert(condition, message) { if (!condition) throw new Error(`FAIL: ${message}`); passCount += 1; console.log(`PASS: ${message}`); }
async function call(path, options = {}, cookie = '') {
  const existingCsrf = cookie.match(/webdev_csrf=([^;]+)/)?.[1] || '';
  const headers = { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method || 'GET') && existingCsrf && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = existingCsrf;
  const response = await fetch(`${base}${path}`, { redirect: options.redirect || 'follow', signal: AbortSignal.timeout(10000), ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const body = await response.json().catch(() => null); const setCookie = response.headers.get('set-cookie') || ''; const token = setCookie.match(/webdev_app_session=([^;]+)/)?.[1]; const csrf = setCookie.match(/webdev_csrf=([^;]+)/)?.[1] || existingCsrf;
  return { response, body, cookie: token ? `webdev_app_session=${token}; webdev_csrf=${csrf}` : cookie };
}
async function main() {
  const health = await call('/api/health'); assert(health.response.status === 200 && health.body.database === 'ready', 'database health is ready');
  const anon = await call('/api/requests'); assert(anon.response.status === 401, 'anonymous request API is protected');
  const anonUserPage = await call('/dashboard.html', { redirect: 'manual' }); const anonAdminPage = await call('/admin.html', { redirect: 'manual' }); assert(anonUserPage.response.status === 302 && anonAdminPage.response.status === 302, 'unauthenticated visitors cannot access either dashboard');

  const gatedAdmin = await call('/api/auth/register', { method: 'POST', body: { ...users.owner, email: `qa.gated-admin.${stamp}@example.test`, accountType: 'admin', adminSignupCode: 'wrong-code' } }); assert([403, 503].includes(gatedAdmin.response.status), 'administrator registration requires server-side invitation configuration');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for role setup');
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await db.connect();
  const seededUsers = {};
  try {
    for (const [key, user] of Object.entries(users)) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      const result = await db.query("INSERT INTO users (full_name, email, password_hash, account_status) VALUES ($1, $2, $3, 'active') RETURNING id", [user.fullName, user.email, passwordHash]);
      seededUsers[key] = result.rows[0].id;
      await db.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'youth')", [seededUsers[key]]);
    }
  } finally { await db.end(); }
  const owner = await call('/api/auth/login', { method: 'POST', body: { email: users.owner.email, password: users.owner.password, loginType: 'user' } }); assert(owner.response.status === 200 && owner.body.user.role === 'youth', 'verified user can log in with the standard role');
  const viewer = await call('/api/auth/login', { method: 'POST', body: { email: users.viewer.email, password: users.viewer.password, loginType: 'user' } }); assert(viewer.response.status === 200 && viewer.body.user.role === 'youth', 'second verified user can log in');
  const other = await call('/api/auth/login', { method: 'POST', body: { email: users.other.email, password: users.other.password, loginType: 'user' } }); assert(other.response.status === 200, 'third verified user can log in');
  const candidate = await call('/api/auth/login', { method: 'POST', body: { email: users.candidate.email, password: users.candidate.password, loginType: 'user' } }); assert(candidate.response.status === 200, 'fourth verified user can log in');
  const badLogin = await call('/api/auth/login', { method: 'POST', body: { email: users.owner.email, password: 'wrong-password', loginType: 'user' } }); assert(badLogin.response.status === 401, 'invalid login is rejected');
  const wrongMode = await call('/api/auth/login', { method: 'POST', body: { email: users.owner.email, password: users.owner.password, loginType: 'admin' } }); assert(wrongMode.response.status === 403, 'user account cannot use administrator login mode');
  const me = await call('/api/auth/me', {}, owner.cookie); assert(me.response.status === 200 && me.body.user.email === users.owner.email && !('password_hash' in me.body.user), 'session identifies user without exposing password hash');
  const categories = await call('/api/categories', {}, owner.cookie); assert(categories.response.status === 200 && categories.body.categories.length > 0, 'authenticated user can read active categories');
  const invalid = await call('/api/requests', { method: 'POST', body: { title: 'bad', description: 'too short', categoryId: categories.body.categories[0].id, priority: 'Medium' } }, owner.cookie); assert(invalid.response.status === 400, 'backend validation rejects invalid request payload');
  const created = await call('/api/requests', { method: 'POST', body: { title: 'QA request for service support', description: 'This request verifies durable persistence and the update history flow.', categoryId: categories.body.categories[0].id, priority: 'High' } }, owner.cookie); assert(created.response.status === 201 && /^YSP-\d{8}$/.test(created.body.request.reference_number) && created.body.request.status === 'Pending', 'user request is persisted with Pending status and a unique reference');
  const requestId = created.body.request.id;
  const listed = await call('/api/requests', {}, owner.cookie); assert(listed.response.status === 200 && listed.body.requests.some((item) => item.id === requestId && item.reference_number === created.body.request.reference_number), 'user can list the persisted request and reference');
  const detail = await call(`/api/requests/${requestId}`, {}, owner.cookie); assert(detail.response.status === 200 && detail.body.updates.length === 1 && detail.body.messages.length === 0, 'user can read own request history and empty conversation');
  const userMessage = await call(`/api/requests/${requestId}/messages`, { method: 'POST', body: { message: 'Additional context from the requester.' } }, owner.cookie); assert(userMessage.response.status === 201, 'user can send a reply on an own request');
  const cancellable = await call('/api/requests', { method: 'POST', body: { title: 'QA request for cancellation', description: 'This request verifies that a requester can cancel pending work.', categoryId: categories.body.categories[0].id, priority: 'Low' } }, owner.cookie); assert(cancellable.response.status === 201, 'second request is created for cancellation testing');
  const cancelled = await call(`/api/requests/${cancellable.body.request.id}`, { method: 'PATCH', body: { status: 'Cancelled' } }, owner.cookie); assert(cancelled.response.status === 200 && cancelled.body.request.status === 'Cancelled', 'user can cancel only a pending request');
  const forbiddenDetail = await call(`/api/requests/${requestId}`, {}, viewer.cookie); assert(forbiddenDetail.response.status === 404, 'another user cannot access the request by changing its ID');
  const forbiddenAdmin = await call('/api/admin/users', {}, owner.cookie); assert(forbiddenAdmin.response.status === 403, 'user cannot access administrator APIs');

  const roleDb = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await roleDb.connect();
  try { await roleDb.query("UPDATE user_roles SET role_id = 'admin' WHERE user_id = $1", [seededUsers.owner]); await roleDb.query("UPDATE user_roles SET role_id = 'staff' WHERE user_id = $1", [seededUsers.other]); await roleDb.query("UPDATE user_roles SET role_id = 'staff' WHERE user_id = $1", [seededUsers.candidate]); } finally { await roleDb.end(); }
  const adminLogin = await call('/api/auth/login', { method: 'POST', body: { email: users.owner.email, password: users.owner.password, loginType: 'admin' } }); assert(adminLogin.response.status === 200 && adminLogin.body.user.role === 'admin', 'administrator can use administrator login mode');
  const adminStatusChange = await call(`/api/requests/${requestId}`, { method: 'PATCH', body: { status: 'In Progress', updateMessage: 'Administrator changed status from the dashboard.' } }, adminLogin.cookie); assert(adminStatusChange.response.status === 200 && adminStatusChange.body.request.status === 'In Progress', 'administrator can change request status from the dashboard');
  const userLogin = await call('/api/auth/login', { method: 'POST', body: { email: users.viewer.email, password: users.viewer.password, loginType: 'user' } }); assert(userLogin.response.status === 200 && userLogin.body.user.role === 'youth', 'user can use user login mode');
  const syncedAdminStatus = await call(`/api/requests/${requestId}`, {}, owner.cookie); assert(syncedAdminStatus.response.status === 200 && syncedAdminStatus.body.request.status === 'In Progress', 'user request view reflects administrator status changes after refetch');
  const adminOnUserMode = await call('/api/auth/login', { method: 'POST', body: { email: users.owner.email, password: users.owner.password, loginType: 'user' } }); assert(adminOnUserMode.response.status === 403, 'administrator cannot use user login mode');
  const adminDashboardFromUser = await call('/dashboard.html', { redirect: 'manual' }, adminLogin.cookie); const userDashboardFromAdmin = await call('/admin.html', { redirect: 'manual' }, userLogin.cookie); assert(adminDashboardFromUser.response.status === 302 && userDashboardFromAdmin.response.status === 302, 'wrong-dashboard routes redirect by backend role');
  const adminUsers = await call('/api/admin/users', {}, adminLogin.cookie); assert(adminUsers.response.status === 200, 'administrator can list users');
  const selfRole = await call(`/api/admin/users/${owner.body.user.id}/role`, { method: 'PATCH', body: { role: 'staff' } }, adminLogin.cookie); assert(selfRole.response.status === 400, 'administrator self-demotion is blocked');
  const roleChange = await call(`/api/admin/users/${candidate.body.user.id}/role`, { method: 'PATCH', body: { role: 'staff' } }, adminLogin.cookie); assert(roleChange.response.status === 204, 'administrator can change another user role');

  const viewerRequest = await call('/api/requests', { method: 'POST', body: { title: 'Viewer request for admin reply', description: 'This request verifies shared status and conversation persistence.', categoryId: categories.body.categories[1].id, priority: 'Medium' } }, userLogin.cookie); assert(viewerRequest.response.status === 201, 'user request is immediately available for administrator management');
  const viewerRequestId = viewerRequest.body.request.id;
  const viewerUserMessage = await call(`/api/requests/${viewerRequestId}/messages`, { method: 'POST', body: { message: 'Here is additional information for the service team.' } }, userLogin.cookie); assert(viewerUserMessage.response.status === 201, 'user conversation reply is persisted');
  const adminReply = await call(`/api/requests/${viewerRequestId}/messages`, { method: 'POST', body: { message: 'Thank you. We are reviewing your request.' } }, adminLogin.cookie); assert(adminReply.response.status === 201, 'administrator can reply to a user request');
  const internal = await call(`/api/requests/${viewerRequestId}/messages`, { method: 'POST', body: { message: 'Internal triage note for administrators.', isInternal: true } }, adminLogin.cookie); assert(internal.response.status === 201, 'administrator can save an internal note');
  const adminDetail = await call(`/api/requests/${viewerRequestId}`, {}, adminLogin.cookie); assert(adminDetail.response.status === 200 && adminDetail.body.messages.length === 3, 'administrator sees public replies and internal notes');
  const userDetail = await call(`/api/requests/${viewerRequestId}`, {}, userLogin.cookie); assert(userDetail.response.status === 200 && userDetail.body.messages.length === 2 && !userDetail.body.messages.some((item) => item.is_internal), 'user sees public conversation but never internal notes');
  const progress = await call(`/api/requests/${viewerRequestId}/updates`, { method: 'POST', body: { status: 'In Progress', updateMessage: 'Administrator has started reviewing this request.' } }, adminLogin.cookie); assert(progress.response.status === 201 && progress.body.request.status === 'In Progress', 'administrator can persist an In Progress status change');
  const syncedProgress = await call(`/api/requests/${viewerRequestId}`, {}, userLogin.cookie); assert(syncedProgress.response.status === 200 && syncedProgress.body.request.status === 'In Progress', 'user dashboard data reflects the shared persisted status');
  const resolved = await call(`/api/requests/${viewerRequestId}/updates`, { method: 'POST', body: { status: 'Resolved', updateMessage: 'Administrator resolved the request after review.' } }, adminLogin.cookie); assert(resolved.response.status === 201 && resolved.body.request.status === 'Resolved', 'administrator can persist a Resolved status');
  const refreshedUserDetail = await call(`/api/requests/${viewerRequestId}`, {}, userLogin.cookie); assert(refreshedUserDetail.response.status === 200 && refreshedUserDetail.body.request.status === 'Resolved' && refreshedUserDetail.body.messages.length === 2, 'status, replies, and history persist after a fresh user read');

  const assignment = await call(`/api/admin/requests/${requestId}/assignment`, { method: 'PATCH', body: { staffId: other.body.user.id } }, adminLogin.cookie); assert(assignment.response.status === 200 && assignment.body.request.assigned_staff_id === other.body.user.id, 'administrator can assign a request to staff');
  const staffList = await call('/api/requests', {}, other.cookie); assert(staffList.response.status === 200 && staffList.body.requests.some((item) => item.id === requestId), 'staff can see assigned requests only');
  const update = await call(`/api/requests/${requestId}/updates`, { method: 'POST', body: { status: 'In Progress', updateMessage: 'QA progress note: request received and under review.' } }, other.cookie); assert(update.response.status === 201 && update.body.request.status === 'In Progress', 'assigned staff can add a progress update');
  const allRequests = await call('/api/requests?sort=created', {}, adminLogin.cookie); assert(allRequests.response.status === 200 && allRequests.body.requests.some((item) => item.id === viewerRequestId && item.requester_email === users.viewer.email), 'administrator can see all requests and necessary user contact data');
  const opportunityPayload = { title: 'QA Managed Opportunity', organisation: 'QA Youth Services', category: 'Jobs', location: 'Cape Town', experienceLevel: 'Entry Level / Graduate', closingDate: '2099-12-31', shortDescription: 'A managed opportunity used for synchronization testing.', fullDescription: 'This listing verifies that administrator opportunity changes are visible on the public user-facing opportunities page.' };
  const addedOpportunity = await call('/api/admin/opportunities', { method: 'POST', body: opportunityPayload }, adminLogin.cookie); assert(addedOpportunity.response.status === 201, 'administrator can add an opportunity');
  const publicWithOpportunity = await call('/api/opportunities'); assert(publicWithOpportunity.response.status === 200 && publicWithOpportunity.body.opportunities.some((item) => item.id === addedOpportunity.body.opportunity.id), 'new opportunity is visible to the public user side');
  const deletedOpportunity = await call(`/api/admin/opportunities/${encodeURIComponent(addedOpportunity.body.opportunity.id)}`, { method: 'DELETE' }, adminLogin.cookie); assert(deletedOpportunity.response.status === 204, 'administrator can delete an opportunity');
  const publicAfterDelete = await call('/api/opportunities'); assert(publicAfterDelete.response.status === 200 && !publicAfterDelete.body.opportunities.some((item) => item.id === addedOpportunity.body.opportunity.id), 'deleted opportunity is removed from the public user side');
  console.log(`LIVE_API_TESTS_PASSED=${passCount}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
