'use strict';

(() => {
  const storedUser = (() => {
    try { return JSON.parse(localStorage.getItem('ozama-user') || 'null'); }
    catch (_) { return null; }
  })();
  let token = '';

  const state = {
    admin: null,
    stats: null,
    users: [],
    userPage: 1,
    userPages: 1,
    userQuery: '',
    matches: [],
    matchPage: 1,
    matchPages: 1,
    matchQuery: '',
    loaded: new Set(),
    confirmResolver: null,
    toastTimer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      if (response.status === 401) {
        await window.OZAMA_RUNTIME?.clearAuthToken?.().catch(() => {});
        localStorage.removeItem('ozama-user');
      }
      throw Object.assign(new Error(data.error || 'Acceso no autorizado.'), { authFailure: true });
    }
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
    return data;
  }

  function redirectUnauthorized(message) {
    const title = $('#gate-title');
    const copy = $('#gate-copy');
    const loader = $('#gate-loader');
    if (title) title.textContent = 'Acceso restringido';
    if (copy) copy.textContent = message || 'Esta cuenta no tiene permisos administrativos.';
    if (loader) loader.hidden = true;
    window.setTimeout(() => window.location.replace('/index.html'), 900);
  }

  function showToast(message, type = '') {
    const toast = $('#toast');
    if (!toast) return;
    window.clearTimeout(state.toastTimer);
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    toast.hidden = false;
    state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function actionButton(label, type = 'secondary', handler) {
    const button = element('button', `${type}-button`, label);
    button.type = 'button';
    if (handler) button.addEventListener('click', handler);
    return button;
  }

  function tableCell(label, content, className = '') {
    const cell = element('td', className);
    cell.dataset.label = label;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content === null || content === undefined ? '--' : String(content);
    return cell;
  }

  function badge(text, type = '') {
    return element('span', `badge ${type}`.trim(), text);
  }

  function formatDate(value, fallback = 'Sin registro') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat('es-DO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function formatUptime(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds || 0));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days} d ${hours} h` : `${hours} h ${minutes} min`;
  }

  function emptyState(title, copy) {
    const wrapper = element('div', 'empty-state');
    const block = element('div');
    block.append(element('strong', '', title), element('span', '', copy));
    wrapper.appendChild(block);
    return wrapper;
  }

  function pulseRow(label, value, { status } = {}) {
    const row = element('div', 'pulse-row');
    const labelNode = element('span', 'pulse-label');
    if (status !== undefined) labelNode.appendChild(element('span', `status-dot ${status ? '' : 'off'}`.trim()));
    labelNode.append(document.createTextNode(label));
    row.append(labelNode, element('span', 'pulse-value', value));
    return row;
  }

  function debounce(fn, delay = 320) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('button, input, select, textarea')?.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (!$$('.modal').some((item) => !item.hidden)) document.body.style.overflow = '';
  }

  function confirmAction(title, copy, label = 'Confirmar') {
    $('#confirm-title').textContent = title;
    $('#confirm-copy').textContent = copy;
    $('#confirm-action').textContent = label;
    openModal($('#confirm-modal'));
    return new Promise((resolve) => { state.confirmResolver = resolve; });
  }

  function resolveConfirmation(value) {
    closeModal($('#confirm-modal'));
    const resolve = state.confirmResolver;
    state.confirmResolver = null;
    resolve?.(value);
  }

  function activateTab(tabName) {
    $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
    $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
    loadTab(tabName).catch((err) => showToast(err.message, 'error'));
  }

  async function loadTab(tabName, force = false) {
    if (!force && state.loaded.has(tabName)) return;
    const loaders = {
      dashboard: loadDashboard,
      users: loadUsers,
      rooms: loadRooms,
      matches: loadMatches,
      events: loadEvents,
      system: loadSystem,
    };
    if (!loaders[tabName]) return;
    await loaders[tabName]();
    state.loaded.add(tabName);
  }

  async function loadDashboard() {
    const data = await api('/api/admin/stats');
    state.stats = data;
    $('#kpi-users').textContent = data.users.total;
    $('#kpi-users-detail').textContent = `${data.users.activeAccounts} cuentas activas`;
    $('#kpi-online').textContent = data.users.online;
    $('#kpi-sockets-detail').textContent = `${data.sockets.connections} conexiones abiertas`;
    $('#kpi-rooms').textContent = data.rooms.active;
    $('#kpi-queue-detail').textContent = `${data.rooms.waitingPlayers} esperando rival`;
    $('#kpi-matches').textContent = data.matches.total;
    $('#kpi-matches-detail').textContent = `${data.matches.finished} finalizadas`;
    $('#kpi-events').textContent = data.events.active;

    const pulse = $('#pulse-list');
    pulse.replaceChildren(
      pulseRow('Cuentas habilitadas', data.users.activeAccounts),
      pulseRow('Jugadores en Socket.IO', data.users.online, { status: true }),
      pulseRow('Partidas en curso', data.matches.active),
      pulseRow('Cola de juego rápido', data.rooms.waitingPlayers),
    );
  }

  function playerIdentity(user) {
    const wrapper = element('div', 'user-cell');
    const avatar = element('span', 'avatar');
    if (user.avatarImage) {
      const image = document.createElement('img');
      image.src = user.avatarImage;
      image.alt = '';
      avatar.appendChild(image);
    } else {
      avatar.textContent = String(user.username || '?').charAt(0).toUpperCase();
    }
    const copy = element('span');
    copy.append(element('strong', 'user-name', user.username || 'Jugador'), element('span', 'user-email', user.email || ''));
    wrapper.append(avatar, copy);
    return wrapper;
  }

  async function updateUser(user, payload, successMessage) {
    const data = await api(`/api/admin/users/${encodeURIComponent(user._id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const index = state.users.findIndex((item) => item._id === user._id);
    if (index >= 0) state.users[index] = data.user;
    renderUsers();
    state.loaded.delete('dashboard');
    state.loaded.delete('system');
    showToast(successMessage, 'success');
  }

  function renderUsers() {
    const body = $('#user-table');
    body.replaceChildren();
    for (const user of state.users) {
      const row = document.createElement('tr');
      const status = user.isActive ? badge('Activo', 'good') : badge('Suspendido', 'bad');
      const plan = user.isPremium ? badge('Premium', 'warn') : badge('Gratis');
      const stats = user.stats || {};
      const results = element('span', 'mono', `${stats.wins || 0}V / ${stats.losses || 0}D / ${stats.draws || 0}T`);
      const actions = element('div', 'action-row');
      const self = String(user._id) === String(state.admin?.id);

      const activeButton = actionButton(user.isActive ? 'Suspender' : 'Activar', user.isActive ? 'danger' : 'secondary', async () => {
        const accepted = await confirmAction(
          user.isActive ? 'Suspender cuenta' : 'Activar cuenta',
          user.isActive
            ? `Se cerrarán las sesiones de ${user.username} y no podrá entrar hasta ser activado.`
            : `${user.username} podrá volver a iniciar sesión y jugar.`,
          user.isActive ? 'Suspender' : 'Activar',
        );
        if (!accepted) return;
        try { await updateUser(user, { isActive: !user.isActive }, 'Estado de la cuenta actualizado.'); }
        catch (err) { showToast(err.message, 'error'); }
      });
      activeButton.disabled = self;

      const premiumButton = actionButton(user.isPremium ? 'Revocar Premium' : 'Conceder Premium', 'secondary', async () => {
        try { await updateUser(user, { isPremium: !user.isPremium }, 'Membresía actualizada.'); }
        catch (err) { showToast(err.message, 'error'); }
      });

      const logoutButton = actionButton('Cerrar sesiones', 'danger', async () => {
        const accepted = await confirmAction('Cerrar sesiones', `Todos los dispositivos de ${user.username} tendrán que iniciar sesión nuevamente.`, 'Cerrar sesiones');
        if (!accepted) return;
        try { await updateUser(user, { invalidateSessions: true }, 'Sesiones revocadas.'); }
        catch (err) { showToast(err.message, 'error'); }
      });
      logoutButton.disabled = self;
      actions.append(activeButton, premiumButton, logoutButton);

      row.append(
        tableCell('Jugador', playerIdentity(user), 'user-column'),
        tableCell('Estado', status),
        tableCell('Plan', plan),
        tableCell('ELO', user.elo || 1200, 'mono'),
        tableCell('Resultados', results),
        tableCell('Última actividad', formatDate(user.lastSeenAt)),
        tableCell('Acciones', actions),
      );
      body.appendChild(row);
    }
    if (!state.users.length) {
      const row = document.createElement('tr');
      const cell = tableCell('', 'No se encontraron usuarios.');
      cell.colSpan = 7;
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  async function loadUsers() {
    const params = new URLSearchParams({ page: state.userPage, limit: 20 });
    if (state.userQuery) params.set('q', state.userQuery);
    const data = await api(`/api/admin/users?${params}`);
    state.users = data.users || [];
    state.userPage = data.page || 1;
    state.userPages = data.pages || 1;
    renderUsers();
    $('#user-page-label').textContent = `Página ${state.userPage} de ${state.userPages} · ${data.total || 0} usuarios`;
    $('#user-prev').disabled = state.userPage <= 1;
    $('#user-next').disabled = state.userPage >= state.userPages;
  }

  function playerBlock(player, color) {
    const block = element('div', 'player-block');
    block.append(
      element('div', 'player-name', player?.name || `${color} disponible`),
      element('div', 'player-meta', player ? `${player.country || 'DO'} · ELO ${player.elo || 1200}${player.connected ? ' · conectado' : ' · ausente'}` : 'Esperando jugador'),
    );
    return block;
  }

  async function loadRooms() {
    const data = await api('/api/admin/rooms/active');
    const grid = $('#room-grid');
    grid.replaceChildren();
    if (!data.rooms?.length) {
      grid.appendChild(emptyState('Sin salas activas', 'No hay partidas ni salas privadas vivas en este momento.'));
      return;
    }
    for (const room of data.rooms) {
      const card = element('article', 'room-card');
      const top = element('div', 'room-top');
      top.append(element('strong', 'room-code', room.code), badge(room.status === 'playing' ? 'En partida' : 'Esperando', room.status === 'playing' ? 'good' : 'warn'));
      const versus = element('div', 'versus');
      versus.append(playerBlock(room.white, 'Blancas'), element('span', 'versus-mark', 'VS'), playerBlock(room.black, 'Negras'));
      const meta = element('div', 'room-meta');
      meta.append(
        element('span', '', `Turno: ${room.turn === 'w' ? 'blancas' : 'negras'}`),
        element('span', 'mono', `${formatClock(room.clockW)} / ${formatClock(room.clockB)}`),
        element('span', '', `${room.connected} conexiones`),
      );
      const actions = element('div', 'room-actions');
      actions.appendChild(actionButton('Cierre de emergencia', 'danger', async () => {
        const accepted = await confirmAction('Cerrar sala', `La sala ${room.code} terminará como abandonada y ambos jugadores regresarán al lobby. Esta acción queda auditada.`, 'Cerrar sala');
        if (!accepted) return;
        try {
          await api(`/api/admin/rooms/${encodeURIComponent(room.code)}`, { method: 'DELETE' });
          showToast(`Sala ${room.code} cerrada.`, 'success');
          state.loaded.delete('dashboard');
          state.loaded.delete('system');
          await loadRooms();
        } catch (err) { showToast(err.message, 'error'); }
      }));
      card.append(top, versus, meta, actions);
      grid.appendChild(card);
    }
  }

  function resultLabel(match) {
    if (match.result === 'white_win') return 'Ganan blancas';
    if (match.result === 'black_win') return 'Ganan negras';
    if (match.result === 'draw') return 'Tablas';
    return 'Abandonada';
  }

  function renderMatches() {
    const body = $('#match-table');
    body.replaceChildren();
    for (const match of state.matches) {
      const row = document.createElement('tr');
      const pgnButton = actionButton('Ver PGN', 'secondary', () => {
        $('#pgn-modal-title').textContent = `PGN · ${match.roomCode}`;
        $('#pgn-content').textContent = match.pgn || 'Esta partida no tiene un registro PGN disponible.';
        openModal($('#pgn-modal'));
      });
      pgnButton.disabled = !match.pgn;
      row.append(
        tableCell('Sala', match.roomCode, 'mono'),
        tableCell('Blancas', `${match.whitePlayer?.name || '--'} · ${match.whitePlayer?.elo || 1200}`),
        tableCell('Negras', `${match.blackPlayer?.name || '--'} · ${match.blackPlayer?.elo || 1200}`),
        tableCell('Resultado', badge(resultLabel(match), match.result === 'abandoned' ? 'bad' : 'good')),
        tableCell('Movimientos', match.moveCount || 0, 'mono'),
        tableCell('Finalizada', formatDate(match.endedAt || match.createdAt)),
        tableCell('Registro', pgnButton),
      );
      body.appendChild(row);
    }
    if (!state.matches.length) {
      const row = document.createElement('tr');
      const cell = tableCell('', 'No se encontraron partidas finalizadas.');
      cell.colSpan = 7;
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  async function loadMatches() {
    const params = new URLSearchParams({ page: state.matchPage, limit: 20 });
    if (state.matchQuery) params.set('q', state.matchQuery);
    const data = await api(`/api/admin/matches?${params}`);
    state.matches = data.matches || [];
    state.matchPage = data.page || 1;
    state.matchPages = data.pages || 1;
    renderMatches();
    $('#match-page-label').textContent = `Página ${state.matchPage} de ${state.matchPages} · ${data.total || 0} partidas`;
    $('#match-prev').disabled = state.matchPage <= 1;
    $('#match-next').disabled = state.matchPage >= state.matchPages;
  }

  const eventStatusLabels = {
    draft: 'Borrador',
    active: 'Activo',
    finished: 'Finalizado',
    cancelled: 'Cancelado',
    published: 'Publicado',
    closed: 'Cerrado',
  };

  async function loadEvents() {
    const data = await api('/api/admin/events');
    const grid = $('#event-grid');
    grid.replaceChildren();
    if (!data.events?.length) {
      grid.appendChild(emptyState('Sin eventos', 'Crea el primer torneo, anuncio o mantenimiento programado.'));
      return;
    }
    for (const event of data.events) {
      const card = element('article', 'event-card');
      const top = element('div', 'event-top');
      top.append(element('strong', 'event-name', event.title), badge(eventStatusLabels[event.status] || event.status, event.status === 'active' || event.status === 'published' ? 'good' : ''));
      const description = element('p', 'modal-copy', event.description || 'Sin descripción.');
      description.style.marginTop = '14px';
      const meta = element('div', 'event-meta');
      meta.style.marginTop = '14px';
      meta.append(
        element('span', '', `Tipo: ${event.type}`),
        element('span', '', `Inicio: ${formatDate(event.startsAt, 'Sin fecha')}`),
        element('span', '', `${event.participants?.length || 0}/${event.maxPlayers || 16} inscritos`),
      );
      const actions = element('div', 'event-actions');
      const select = element('select', 'inline-select');
      for (const status of ['draft', 'active', 'finished', 'cancelled']) {
        const option = element('option', '', eventStatusLabels[status]);
        option.value = status;
        option.selected = status === event.status || (event.status === 'published' && status === 'active') || (event.status === 'closed' && status === 'finished');
        select.appendChild(option);
      }
      actions.append(select, actionButton('Guardar estado', 'secondary', async () => {
        try {
          await api(`/api/admin/events/${encodeURIComponent(event._id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: select.value }),
          });
          showToast('Estado del evento actualizado.', 'success');
          state.loaded.delete('dashboard');
          state.loaded.delete('system');
          await loadEvents();
        } catch (err) { showToast(err.message, 'error'); }
      }));
      card.append(top, description, meta, actions);
      grid.appendChild(card);
    }
  }

  async function loadSystem() {
    const data = await api('/api/admin/system');
    const system = data.system || {};
    const systemList = $('#system-list');
    systemList.replaceChildren(
      pulseRow('MongoDB Atlas', system.database === 'connected' ? 'Conectado' : 'Sin conexión', { status: system.database === 'connected' }),
      pulseRow('Tiempo activo', formatUptime(system.uptimeSeconds)),
      pulseRow('Memoria del servidor', `${system.memoryMb || 0} MB`),
      pulseRow('Motor Node.js', system.node || '--'),
      pulseRow('Conexiones Socket.IO', system.runtime?.socketConnections || 0),
    );

    const list = $('#audit-list');
    list.replaceChildren();
    for (const log of data.logs || []) {
      const row = element('div', 'audit-row');
      const copy = element('span', 'audit-action');
      copy.append(element('strong', 'user-name', log.action), element('span', 'user-email', `${log.actor?.username || 'Administrador'} · ${log.targetType}${log.targetId ? ` ${log.targetId}` : ''}`));
      row.append(copy, element('span', 'pulse-value', formatDate(log.createdAt)));
      list.appendChild(row);
    }
    if (!data.logs?.length) list.appendChild(element('div', 'pulse-row', 'Todavía no hay acciones administrativas registradas.'));
  }

  function openEventForm() {
    $('#event-form').reset();
    $('#event-max').value = 16;
    openModal($('#event-modal'));
  }

  async function createEvent(event) {
    event.preventDefault();
    const payload = {
      title: $('#event-title').value.trim(),
      type: $('#event-type').value,
      status: $('#event-status').value,
      startsAt: $('#event-start').value || null,
      endsAt: $('#event-end').value || null,
      maxPlayers: Number($('#event-max').value || 16),
      description: $('#event-description').value.trim(),
    };
    try {
      await api('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
      closeModal($('#event-modal'));
      showToast('Evento creado correctamente.', 'success');
      state.loaded.delete('dashboard');
      state.loaded.delete('system');
      await loadEvents();
      state.loaded.add('events');
      activateTab('events');
    } catch (err) { showToast(err.message, 'error'); }
  }

  function bindUi() {
    $$('.tab-button').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
    $$('[data-go-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.goTab)));
    $$('[data-refresh]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await loadTab(button.dataset.refresh, true);
        showToast('Información actualizada.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
      finally { button.disabled = false; }
    }));
    $$('[data-open-event]').forEach((button) => button.addEventListener('click', openEventForm));
    $$('[data-close-event]').forEach((button) => button.addEventListener('click', () => closeModal($('#event-modal'))));
    $$('[data-close-pgn]').forEach((button) => button.addEventListener('click', () => closeModal($('#pgn-modal'))));
    $$('[data-close-confirm]').forEach((button) => button.addEventListener('click', () => resolveConfirmation(false)));
    $('#confirm-action').addEventListener('click', () => resolveConfirmation(true));
    $('#event-form').addEventListener('submit', createEvent);

    $('#user-search').addEventListener('input', debounce(async (event) => {
      state.userQuery = event.target.value.trim();
      state.userPage = 1;
      try { await loadUsers(); } catch (err) { showToast(err.message, 'error'); }
    }));
    $('#match-search').addEventListener('input', debounce(async (event) => {
      state.matchQuery = event.target.value.trim();
      state.matchPage = 1;
      try { await loadMatches(); } catch (err) { showToast(err.message, 'error'); }
    }));
    $('#user-prev').addEventListener('click', async () => { state.userPage -= 1; await loadUsers(); });
    $('#user-next').addEventListener('click', async () => { state.userPage += 1; await loadUsers(); });
    $('#match-prev').addEventListener('click', async () => { state.matchPage -= 1; await loadMatches(); });
    $('#match-next').addEventListener('click', async () => { state.matchPage += 1; await loadMatches(); });

    $$('.modal').forEach((modal) => modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      if (modal.id === 'confirm-modal') resolveConfirmation(false);
      else closeModal(modal);
    }));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = $$('.modal').find((modal) => !modal.hidden);
      if (!open) return;
      if (open.id === 'confirm-modal') resolveConfirmation(false);
      else closeModal(open);
    });
  }

  function handleNativeBack() {
    const open = $$('.modal').find((modal) => !modal.hidden);
    if (open) {
      if (open.id === 'confirm-modal') resolveConfirmation(false);
      else closeModal(open);
      return true;
    }
    window.location.href = '/lobby.html';
    return true;
  }

  async function start() {
    await window.OZAMA_RUNTIME?.ready;
    token = window.OZAMA_RUNTIME?.getAuthToken?.() || '';
    if (!token && window.OZAMA_RUNTIME?.native) {
      redirectUnauthorized('Inicia sesión con tu cuenta administradora para continuar.');
      return;
    }
    try {
      const data = await api('/api/admin/verify');
      state.admin = data.admin;
      $('#admin-name').textContent = data.admin.username || 'Administrador';
      $('#admin-email').textContent = data.admin.email || '';
      $('#auth-gate').hidden = true;
      $('#admin-app').hidden = false;
      bindUi();
      window.OZAMA_HANDLE_NATIVE_BACK = handleNativeBack;
      await loadDashboard();
      state.loaded.add('dashboard');
    } catch (err) {
      redirectUnauthorized(err.message);
    }
  }

  start();
})();
