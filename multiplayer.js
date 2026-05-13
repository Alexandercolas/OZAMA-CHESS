'use strict';

// ================================================================
//  OZAMA CHESS — multiplayer.js
//  Cargado en index.html DESPUÉS de script.js
// ================================================================

(function () {

  const roomCode = sessionStorage.getItem('ozama-room');
  const myColor  = sessionStorage.getItem('ozama-color');
  const isOnline = !!(roomCode && myColor);

  if (!isOnline) return;

  const socket = io();

  let receivingOpponentMove  = false;
  let suppressPromoDialog    = false;   // BUG FIX #2: evita mostrar el diálogo al recibir una promoción del rival
  let pendingMoveForPromotion = null;

  // ── Banner de estado ──────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'online-banner';
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0',
    padding: '7px 20px',
    background: 'rgba(212,175,55,0.12)',
    borderBottom: '1px solid rgba(212,175,55,0.25)',
    textAlign: 'center', fontSize: '11px', fontWeight: '700',
    letterSpacing: '2px', color: '#D4AF37', zIndex: '100',
    transition: 'all 0.3s',
  });
  banner.textContent = `SALA: ${roomCode}  ·  Juegas con ${myColor === 'w' ? '⚪ BLANCAS' : '⚫ NEGRAS'}`;
  document.body.prepend(banner);
  document.body.style.paddingTop = '34px';

  function setBannerStatus(msg, isError = false) {
    banner.textContent         = msg;
    banner.style.background    = isError ? 'rgba(239,68,68,0.12)'  : 'rgba(212,175,55,0.12)';
    banner.style.borderColor   = isError ? 'rgba(239,68,68,0.3)'   : 'rgba(212,175,55,0.25)';
    banner.style.color         = isError ? '#ef4444'               : '#D4AF37';
  }

  // ── BUG FIX #1: emitir 'rejoin' al conectar ──────────────────
  // El evento 'connect' puede dispararse antes de que el handler
  // esté registrado si la conexión es muy rápida (localhost).
  // La solución es registrar el handler Y también emitir de inmediato
  // si ya estamos conectados.
  function sendRejoin() {
    socket.emit('rejoin', { roomCode, color: myColor });
  }

  socket.on('connect', sendRejoin);

  // Emitir inmediatamente si ya estaba conectado
  if (socket.connected) sendRejoin();

  // ── Bloquear clicks en el turno del rival ─────────────────────
  const _origClick = window.handleSquareClick;
  window.handleSquareClick = function (row, col) {
    if (state.turn !== myColor) {
      const sq = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (sq) {
        sq.style.outline = '2px solid rgba(239,68,68,0.6)';
        setTimeout(() => { sq.style.outline = ''; }, 300);
      }
      return;
    }
    _origClick(row, col);
  };

  // ── BUG FIX #2: suprimir el diálogo de promoción cuando viene del rival
  const _origShowPromoDialog = window.showPromotionDialog;
  window.showPromotionDialog = function (row, col, color) {
    if (suppressPromoDialog) return; // No mostrar el diálogo al recibir la promoción del rival
    _origShowPromoDialog(row, col, color);
  };

  // ── Interceptar executeMove — emitir al servidor ──────────────
  const _origExecuteMove = window.executeMove;
  window.executeMove = function (from, to) {
    _origExecuteMove(from, to);

    if (!receivingOpponentMove) {
      if (state.promotionPending) {
        // Guardar la movida — se emite con la pieza elegida en applyPromotion
        pendingMoveForPromotion = { from, to };
      } else {
        socket.emit('move', { from, to });
      }
    }
  };

  // ── Interceptar applyPromotion — emitir la pieza elegida ──────
  const _origApplyPromotion = window.applyPromotion;
  window.applyPromotion = function (row, col, color, chosenType) {
    _origApplyPromotion(row, col, color, chosenType);

    if (!receivingOpponentMove && pendingMoveForPromotion) {
      socket.emit('move', { ...pendingMoveForPromotion, promotion: chosenType });
      pendingMoveForPromotion = null;
    }
  };

  // ── Recibir movida del rival ──────────────────────────────────
  socket.on('opponent-move', ({ from, to, promotion }) => {
    receivingOpponentMove = true;

    // Si la movida incluye promoción, suprimir el diálogo local
    if (promotion) suppressPromoDialog = true;

    _origExecuteMove(from, to);

    // Aplicar la promoción automáticamente sin mostrar el diálogo
    if (promotion && state.promotionPending) {
      const { row, col, color } = state.promotionPending;
      _origApplyPromotion(row, col, color, promotion);
    }

    suppressPromoDialog    = false;
    receivingOpponentMove  = false;
  });

  // ── BUG FIX #3: deshabilitar "New Game" en modo online ───────
  // Si un jugador reinicia el tablero localmente, el rival sigue
  // viendo el tablero anterior — el juego se desincroniza.
  const newGameBtn = document.getElementById('new-game-btn');
  if (newGameBtn) {
    newGameBtn.style.opacity = '0.35';
    newGameBtn.style.cursor  = 'not-allowed';
    newGameBtn.title         = 'No disponible en partida online';
    newGameBtn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      setBannerStatus('New Game no disponible en partida online', true);
      setTimeout(() => {
        setBannerStatus(`SALA: ${roomCode}  ·  ${myColor === 'w' ? '⚪ BLANCAS' : '⚫ NEGRAS'}`);
      }, 2000);
    }, true);
  }

  // ── Eventos de conexión ───────────────────────────────────────
  socket.on('opponent-disconnected', () => {
    setBannerStatus('Tu rival se desconectó. Esperando reconexión…', true);
  });

  socket.on('opponent-reconnected', () => {
    setBannerStatus(`SALA: ${roomCode}  ·  ${myColor === 'w' ? '⚪ BLANCAS' : '⚫ NEGRAS'}  ·  Rival reconectado ✓`);
  });

  socket.on('connect_error', () => {
    setBannerStatus('Sin conexión con el servidor', true);
  });

  // BUG FIX #1 también aplica a reconexiones automáticas
  socket.on('connect', sendRejoin);

  // ── Botón volver al lobby ────────────────────────────────────
  const backBtn = document.createElement('button');
  backBtn.textContent = '← Lobby';
  Object.assign(backBtn.style, {
    position: 'fixed', top: '5px', right: '12px',
    background: 'transparent', border: 'none',
    color: 'rgba(212,175,55,0.5)', fontSize: '11px',
    fontWeight: '700', letterSpacing: '1px', cursor: 'pointer',
    zIndex: '101', padding: '4px 8px', borderRadius: '4px',
    transition: 'color 0.2s',
  });
  backBtn.onmouseover = () => { backBtn.style.color = '#D4AF37'; };
  backBtn.onmouseout  = () => { backBtn.style.color = 'rgba(212,175,55,0.5)'; };
  backBtn.onclick = () => {
    sessionStorage.removeItem('ozama-room');
    sessionStorage.removeItem('ozama-color');
    window.location.href = '/lobby.html';
  };
  document.body.appendChild(backBtn);

})();