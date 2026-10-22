window.YouthPortalAPI = {
  csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)webdev_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  },
  async request(url, options = {}) {
    const method = options.method || 'GET';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = this.csrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const response = await fetch(url, { method, credentials: 'include', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const result = await response.json().catch(() => ({ error: 'The server returned an invalid response.' }));
    if (!response.ok) throw new Error(result.message || result.error || `Request failed (${response.status})`);
    return result;
  },
  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
};
