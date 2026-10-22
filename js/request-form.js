window.addEventListener('DOMContentLoaded', async () => {
  const api = window.YouthPortalAPI;
  const form = document.getElementById('request-form');
  const category = document.getElementById('request-category');
  const status = document.getElementById('form-status');
  const success = document.getElementById('request-success');
  const show = (message, error = true) => { status.hidden = false; status.textContent = message; status.classList.toggle('is-error', error); };
  try {
    const me = await api.request('/api/auth/me');
    if (!me.user || me.user.role !== 'youth') return window.location.replace(me.user ? 'admin.html' : 'login.html?next=request-new.html');
    const result = await api.request('/api/categories');
    category.innerHTML = '<option value="">Choose a category</option>' + result.categories.map((item) => `<option value="${item.id}">${api.escape(item.name)}</option>`).join('');
  } catch (error) { show(error.message); return; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Submitting…';
    try {
      const result = await api.request('/api/requests', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
      form.hidden = true; success.hidden = false; success.innerHTML = `<strong>Request submitted.</strong><p>Your reference number is <b>${api.escape(result.request.reference_number)}</b>. Keep it for follow-up.</p><div class="success-actions"><a class="btn-primary" href="request-detail.html?id=${encodeURIComponent(result.request.id)}">View request</a><a class="btn-secondary" href="dashboard.html">Back to dashboard</a></div>`;
    } catch (error) { show(error.message); button.disabled = false; button.innerHTML = 'Submit request <span aria-hidden="true">↗</span>'; }
  });
});
