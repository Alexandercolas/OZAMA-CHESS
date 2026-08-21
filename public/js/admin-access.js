'use strict';

(() => {
  const accessLinks = [...document.querySelectorAll('[data-admin-access]')];
  if (!accessLinks.length) return;

  let user = null;
  try { user = JSON.parse(localStorage.getItem('ozama-user') || 'null'); }
  catch (_) {}
  const token = localStorage.getItem('ozama-token')
    || user?.token
    || user?.jwt
    || user?.accessToken
    || '';
  if (!token) return;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  fetch('/api/admin/verify', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: controller.signal,
  })
    .then((response) => {
      if (response.status === 401) {
        localStorage.removeItem('ozama-token');
        localStorage.removeItem('ozama-user');
      }
      if (!response.ok) throw new Error('ADMIN_DENIED');
      return response.json();
    })
    .then((data) => {
      if (!data?.admin?.isAdmin) return;
      accessLinks.forEach((link) => {
        link.hidden = false;
        link.removeAttribute('aria-hidden');
      });
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(timeout));
})();
