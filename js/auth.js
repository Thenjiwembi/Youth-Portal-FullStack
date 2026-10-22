(() => {
  const api = window.YouthPortalAPI;
  const formMessage = (form, message, isError = true) => {
    let status = form.querySelector('.form-status');
    if (!status) { status = document.createElement('p'); status.className = 'form-status'; status.setAttribute('role', 'status'); form.prepend(status); }
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };
  const homeFor = (user) => user.role === 'admin' ? 'admin.html' : user.role === 'staff' ? 'staff.html' : 'dashboard.html';
  const safeNext = (next, user) => {
    if (user.role !== 'youth' || !next) return homeFor(user);
    const value = String(next);
    const normalized = value.startsWith('/') ? value : `/${value}`;
    const allowed = ['/dashboard.html', '/request-new.html', '/request-detail.html', '/profile.html'];
    if (normalized.startsWith('//') || normalized.includes('://') || !allowed.some((path) => normalized === path || normalized.startsWith(`${path}?`))) return homeFor(user);
    return normalized;
  };

  async function setupSignup() {
    const form = document.getElementById('signup-form'); if (!form) return;
    const hiddenType = form.elements.namedItem('accountType'); const label = document.getElementById('signup-mode-label'); const description = document.getElementById('signup-mode-description'); const codeGroup = document.getElementById('admin-signup-code-group'); const codeField = form.elements.namedItem('adminSignupCode'); const buttons = [...document.querySelectorAll('[data-signup-mode]')];
    const footer = document.querySelector('.auth-footer-text');
    if (footer) { footer.append(document.createTextNode(' ')); const link = document.createElement('a'); link.href = 'verify-email.html'; link.textContent = 'Verify an existing account'; footer.append(link); }
    const setMode = (mode) => { const value = mode === 'admin' ? 'admin' : 'user'; hiddenType.value = value; buttons.forEach((button) => { const active = button.dataset.signupMode === value; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }); if (label) label.textContent = value === 'admin' ? 'Administrator registration' : 'User registration'; if (description) description.textContent = value === 'admin' ? 'Create an administrator account with an invitation code configured by the project owner.' : 'Create a secure user account to ask for help and track progress.'; if (codeGroup) codeGroup.hidden = value !== 'admin'; if (codeField) codeField.required = value === 'admin'; };
    setMode(new URLSearchParams(location.search).get('mode') || 'user'); buttons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.signupMode)));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]'); button.disabled = true; const payload = Object.fromEntries(new FormData(form).entries());
      if (payload.password !== payload.passwordConfirmation) { formMessage(form, 'Passwords do not match.'); button.disabled = false; return; }
      try {
        const result = await api.request('/api/auth/register', { method: 'POST', body: payload });
        if (result.verificationRequired) return window.location.href = `verify-email.html?email=${encodeURIComponent(result.email)}`;
        window.location.href = homeFor(result.user);
      } catch (error) { formMessage(form, error.message); button.disabled = false; }
    });
  }

  async function setupVerifyEmail() {
    const form = document.getElementById('verify-email-form'); if (!form) return;
    const email = form.elements.namedItem('email');
    email.value = new URLSearchParams(location.search).get('email') || '';
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try { const result = await api.request('/api/auth/verify-email', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) }); window.location.href = homeFor(result.user); }
      catch (error) { formMessage(form, error.message); button.disabled = false; }
    });
    form.querySelector('#resend-verification-code').addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { const result = await api.request('/api/auth/resend-verification', { method: 'POST', body: { email: email.value } }); formMessage(form, result.message, false); }
      catch (error) { formMessage(form, error.message); }
      finally { button.disabled = false; }
    });
  }

  async function setupLogin() {
    const form = document.getElementById('login-form'); if (!form) return;
    const hiddenMode = form.elements.namedItem('loginType'); const label = document.getElementById('login-mode-label'); const description = document.getElementById('login-mode-description'); const buttons = [...document.querySelectorAll('[data-login-mode]')];
    const setMode = (mode) => { const value = mode === 'admin' ? 'admin' : 'user'; hiddenMode.value = value; buttons.forEach((button) => { const active = button.dataset.loginMode === value; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }); if (label) label.textContent = value === 'admin' ? 'Administrator / staff login' : 'User login'; if (description) description.textContent = value === 'admin' ? 'For authorized administrators and service staff.' : 'For registered Youth Portal users.'; };
    setMode(new URLSearchParams(location.search).get('mode') || 'user'); buttons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.loginMode)));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try { const result = await api.request('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) }); window.location.href = safeNext(new URLSearchParams(location.search).get('next'), result.user); } catch (error) { formMessage(form, error.message); if (error.message === 'Verify your email address before logging in.') { const status = form.querySelector('.form-status'); const link = document.createElement('a'); link.href = `verify-email.html?email=${encodeURIComponent(form.elements.namedItem('email').value)}`; link.textContent = 'Enter your verification code'; status.append(document.createTextNode(' '), link); } button.disabled = false; }
    });
  }

  async function setupForgotPassword() {
    const form = document.getElementById('forgot-password-form'); if (!form) return;
    form.addEventListener('submit', async (event) => { event.preventDefault(); if (!form.reportValidity()) return; const button = form.querySelector('button[type="submit"]'); button.disabled = true; try { const result = await api.request('/api/auth/forgot-password', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) }); formMessage(form, result.message, false); } catch (error) { formMessage(form, error.message); } finally { button.disabled = false; } });
  }

  async function setupResetPassword() {
    const form = document.getElementById('reset-password-form'); if (!form) return;
    const token = new URLSearchParams(location.search).get('token') || '';
    if (!token) { formMessage(form, 'This password reset link is invalid. Request a new one.'); form.querySelector('button[type="submit"]').disabled = true; return; }
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      if (values.password !== values.passwordConfirmation) { formMessage(form, 'Passwords do not match.'); return; }
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try { const result = await api.request('/api/auth/reset-password', { method: 'POST', body: { token, password: values.password } }); formMessage(form, result.message, false); }
      catch (error) { formMessage(form, error.message); }
      finally { button.disabled = false; }
    });
  }

  async function setupProfile() {
    const form = document.getElementById('profile-edit-form'); if (!form) return;
    const editButton = document.getElementById('edit-profile-btn'); const cancelButton = document.getElementById('cancel-profile-btn'); const setEditMode = (editing) => { form.hidden = !editing; editButton.setAttribute('aria-expanded', String(editing)); document.getElementById('edit-profile-label').textContent = editing ? 'Close editor' : 'Edit profile'; }; editButton?.addEventListener('click', () => setEditMode(form.hidden)); cancelButton?.addEventListener('click', () => setEditMode(false));
    form.addEventListener('submit', async (event) => { event.preventDefault(); if (!form.reportValidity()) return; const button = form.querySelector('button[type="submit"]'); button.disabled = true; try { const result = await api.request('/api/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(form).entries()) }); document.getElementById('profile-display-name').textContent = result.user.fullName; document.getElementById('profile-display-email').textContent = result.user.email; formMessage(form, 'Your profile has been saved.', false); setEditMode(false); } catch (error) { formMessage(form, error.message); } finally { button.disabled = false; } });
    try { const result = await api.request('/api/auth/me'); if (!result.user || result.user.role !== 'youth') return window.location.replace(result.user ? 'admin.html' : 'login.html?next=profile.html'); const user = result.user; for (const [name, value] of Object.entries(user)) { const field = form.elements.namedItem(name); if (field && typeof value === 'string') field.value = value; } document.getElementById('profile-display-name').textContent = user.fullName; document.getElementById('profile-display-email').textContent = user.email; document.getElementById('profile-member-note').textContent = `Account role: ${user.roleLabel}`; for (const [id, value] of [['profile-display-location', user.location], ['profile-display-phone', user.phone], ['profile-display-qualification', user.qualification], ['profile-display-about', user.about]]) { const target = document.getElementById(id); if (target) target.textContent = value || 'Not added yet'; } } catch (error) { formMessage(form, error.message); }
  }

  document.getElementById('logout-btn')?.addEventListener('click', async () => { try { await api.request('/api/auth/logout', { method: 'POST' }); } finally { window.location.href = 'login.html'; } });
  window.addEventListener('DOMContentLoaded', () => { setupSignup(); setupVerifyEmail(); setupLogin(); setupForgotPassword(); setupResetPassword(); setupProfile(); });
})();
