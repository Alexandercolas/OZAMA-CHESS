'use strict';

// Centro de notificaciones (Fase 8 del roadmap PRO) -- modulo
// compartido, mismo patron que preferences.js/toast.js: una pagina
// que quiera la campanita solo necesita cargar este script, poner el
// markup de #hd-bell-btn/#hd-bell-badge/#hd-bell-dropdown/#hd-bell-list
// en su header, y llamar OZAMA_NOTIFS.init({token, socket}). Arranca
// solo en lobby.html (el hub principal) -- sumarlo a otras paginas
// despues es copiar el mismo markup + llamar init(), sin tocar este
// archivo.
const OZAMA_NOTIFS = (() => {
  let _token = '';
  let _items = [];
  let _unreadCount = 0;
  let _open = false;
  let _loaded = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0) return 'ahora';
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `hace ${days}d`;
    return new Date(dateStr).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
  }

  function authHeaders() {
    // Igual que el resto de la app: se manda el bearer SI hay uno,
    // pero nunca es obligatorio -- una sesion web ya migrada a cookie
    // no tiene _token y el fetch funciona igual via cookie
    // (middleware/session.js: bearerToken() vacio cae a cookieToken()).
    return _token ? { Authorization: `Bearer ${_token}` } : {};
  }

  function setBadge(count) {
    _unreadCount = Math.max(0, count);
    const badge = document.getElementById('hd-bell-badge');
    if (!badge) return;
    badge.textContent = _unreadCount > 9 ? '9+' : String(_unreadCount);
    badge.classList.toggle('hidden', _unreadCount <= 0);
  }

  function renderList() {
    const list = document.getElementById('hd-bell-list');
    if (!list) return;
    if (!_items.length) {
      list.innerHTML = '<div class="hd-notif-empty">Sin notificaciones todavia.</div>';
      return;
    }
    list.innerHTML = _items.map((n) => {
      const id = n.id || n._id;
      const href = n.link ? escapeHtml(n.link) : '#';
      return `
        <a class="hd-notif-row${n.read ? '' : ' unread'}" href="${href}" onclick="OZAMA_NOTIFS.onClickItem('${id}')">
          <span class="hd-notif-icon">${n.icon || '🔔'}</span>
          <span class="hd-notif-body">
            <span class="hd-notif-title">${escapeHtml(n.title)}</span>
            <span class="hd-notif-time">${timeAgo(n.createdAt)}</span>
          </span>
        </a>
      `;
    }).join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/user/notifications?limit=20', { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      _items = data.notifications || [];
      setBadge(data.unreadCount || 0);
      _loaded = true;
      renderList();
    } catch (_) { /* silencioso -- la campanita simplemente no muestra nada nuevo */ }
  }

  function toggle() {
    _open = !_open;
    document.getElementById('hd-bell-dropdown')?.classList.toggle('hidden', !_open);
    if (_open && !_loaded) load();
  }

  function close() {
    if (!_open) return;
    _open = false;
    document.getElementById('hd-bell-dropdown')?.classList.add('hidden');
  }

  async function markAllRead() {
    try {
      await fetch('/api/user/notifications/read-all', { method: 'POST', headers: authHeaders() });
      _items = _items.map((n) => ({ ...n, read: true }));
      setBadge(0);
      renderList();
    } catch (_) {}
  }

  function onClickItem(id) {
    fetch(`/api/user/notifications/${id}/read`, { method: 'POST', headers: authHeaders() }).catch(() => {});
  }

  // Empujado en vivo por server.js (services/notifications.js) cuando
  // hay un socket conectado -- no reemplaza la carga por HTTP, solo la
  // adelanta mientras la pestaña esta abierta.
  function receiveLive(payload) {
    _items = [payload, ...(_items || [])].slice(0, 20);
    setBadge(_unreadCount + 1);
    _loaded = true;
    renderList();
  }

  function init({ token = '', socket = null } = {}) {
    _token = token;
    load();
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('hd-bell-wrap');
      if (_open && wrap && !wrap.contains(e.target)) close();
    });
    if (socket) socket.on('notification', receiveLive);
  }

  return { init, toggle, markAllRead, onClickItem };
})();
window.OZAMA_NOTIFS = OZAMA_NOTIFS;
