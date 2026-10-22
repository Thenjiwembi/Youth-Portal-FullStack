window.addEventListener('DOMContentLoaded', async () => {
  const api = window.YouthPortalAPI;
  const id = new URLSearchParams(location.search).get('id');
  const detail = document.getElementById('request-detail'); const history = document.getElementById('request-history'); const messages = document.getElementById('request-messages'); const status = document.getElementById('detail-status');
  const show = (message, error = true) => { status.hidden = false; status.textContent = message; status.classList.toggle('is-error', error); };
  const statusClass = (value) => `status-${String(value).toLowerCase().replace(/\s+/g, '-')}`;
  const formatDate = (value, withTime = false) => new Intl.DateTimeFormat('en-ZA', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
  try {
    const me = await api.request('/api/auth/me');
    if (!me.user) return window.location.replace(`login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    const result = await api.request(`/api/requests/${encodeURIComponent(id)}`); const request = result.request;
    detail.innerHTML = `<div class="detail-header"><div><p class="section-kicker">${api.escape(request.category_name)}</p><h1>${api.escape(request.title)}</h1></div><span class="status-pill ${statusClass(request.status)}">${api.escape(request.status)}</span></div><p class="detail-copy">${api.escape(request.description)}</p><dl class="detail-data"><div><dt>Reference</dt><dd>${api.escape(request.reference_number)}</dd></div><div><dt>Priority</dt><dd>${api.escape(request.priority)}</dd></div><div><dt>Submitted</dt><dd>${formatDate(request.created_at)}</dd></div><div><dt>Last updated</dt><dd>${formatDate(request.updated_at)}</dd></div><div><dt>Assigned staff</dt><dd>${api.escape(request.assignee_name || 'Not assigned yet')}</dd></div><div><dt>Requester</dt><dd>${api.escape(request.requester_name)}</dd></div></dl>`;
    history.innerHTML = result.updates.length ? result.updates.map((item) => `<article class="timeline-item"><strong>${api.escape(item.new_status || 'Update')}</strong><p>${api.escape(item.update_message)}</p><time>${api.escape(item.actor_name)} · ${formatDate(item.created_at, true)}</time></article>`).join('') : '<p class="empty-state">No status updates yet.</p>';
    const visibleMessages = result.messages || [];
    messages.innerHTML = visibleMessages.length ? visibleMessages.map((item) => `<article class="message-bubble ${Number(item.sender_id) === Number(me.user.id) ? 'message-own' : ''} ${item.is_internal ? 'message-internal' : ''}"><div class="message-meta"><strong>${api.escape(item.sender_name)}</strong><span>${api.escape(item.sender_role || 'Participant')}</span><time>${formatDate(item.created_at, true)}</time></div><p>${api.escape(item.message)}</p>${item.is_internal ? '<small>Internal administrator note</small>' : ''}</article>`).join('') : '<p class="empty-state">No replies yet. Your request conversation will appear here.</p>';

    const canReply = me.user.role === 'admin' || (me.user.role === 'youth' && Number(request.user_id) === Number(me.user.id)) || (me.user.role === 'staff' && Number(request.assigned_staff_id) === Number(me.user.id));
    if (canReply) {
      const replyForm = document.getElementById('reply-form'); const internalWrap = document.getElementById('internal-note-wrap'); const replyLabel = document.getElementById('reply-label'); replyForm.hidden = false;
      if (me.user.role === 'admin') { replyLabel.textContent = 'Administrator reply'; internalWrap.hidden = false; } else if (me.user.role === 'staff') replyLabel.textContent = 'Service agent reply'; else replyLabel.textContent = 'Your reply';
      replyForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!replyForm.reportValidity()) return; const button = replyForm.querySelector('button'); button.disabled = true; try { await api.request(`/api/requests/${request.id}/messages`, { method: 'POST', body: { message: document.getElementById('reply-message').value, isInternal: Boolean(document.getElementById('reply-internal')?.checked) } }); window.location.reload(); } catch (error) { show(error.message); button.disabled = false; } });
    }

    if (me.user.role === 'youth' && Number(request.user_id) === Number(me.user.id) && request.status === 'Pending') {
      const panel = document.getElementById('owner-edit-panel'); const form = document.getElementById('owner-edit-form'); const category = document.getElementById('owner-edit-category'); panel.hidden = false; document.getElementById('owner-edit-title').value = request.title; document.getElementById('owner-edit-description').value = request.description; document.getElementById('owner-edit-priority').value = request.priority; const categories = await api.request('/api/categories'); category.innerHTML = categories.categories.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(request.category_id) ? 'selected' : ''}>${api.escape(item.name)}</option>`).join('');
      form.addEventListener('submit', async (event) => { event.preventDefault(); if (!form.reportValidity()) return; const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; try { await api.request(`/api/requests/${request.id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(form).entries()) }); window.location.reload(); } catch (error) { show(error.message); button.disabled = false; } });
      document.getElementById('cancel-request-btn').addEventListener('click', async () => { if (!window.confirm('Cancel this pending request?')) return; try { await api.request(`/api/requests/${request.id}`, { method: 'PATCH', body: { status: 'Cancelled' } }); window.location.reload(); } catch (error) { show(error.message); } });
    }

    if (['staff', 'admin'].includes(me.user.role)) {
      const panel = document.getElementById('staff-update-panel'); panel.hidden = false; document.getElementById('update-status').value = request.status === 'Cancelled' ? 'Pending' : request.status;
      document.getElementById('staff-update-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { await api.request(`/api/requests/${request.id}/updates`, { method: 'POST', body: Object.fromEntries(new FormData(event.target).entries()) }); window.location.reload(); } catch (error) { show(error.message); button.disabled = false; } });
    }
  } catch (error) { detail.innerHTML = ''; history.innerHTML = ''; messages.innerHTML = ''; show(error.message); }
});
