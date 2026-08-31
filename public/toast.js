'use strict';

// Toast compartido (Fase 20, "OZAMA Torneos + Experiencia Visual") --
// reemplaza alert() y los toasts ad-hoc por pagina (tournaments.html
// tenia el suyo, otras usaban alert()). Un solo lugar, mismo estilo
// visual en toda la app (ver #oz-toast-stack / .oz-toast en theme.css).
//
// Uso: window.ozToast('Mensaje', 'success' | 'error' | 'info' | 'unlock')
// El tipo es opcional (default 'info').
(function () {
  const ICONS = { success: '✓', error: '✕', info: 'ℹ', unlock: '🔓' };

  // Algunos mensajes vienen de err.message (errores del servidor),
  // que en teoria podrian reflejar texto ingresado por el usuario --
  // se escapa siempre, nunca se confia en el contenido.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }

  function ensureStack() {
    let stack = document.getElementById('oz-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'oz-toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function ozToast(message, type = 'info', opts = {}) {
    if (!message) return;
    const { icon, durationMs = 3200 } = opts;
    const stack = ensureStack();
    const el = document.createElement('div');
    el.className = `oz-toast ${type}`;
    el.innerHTML = `<span class="ot-icon">${icon || ICONS[type] || ICONS.info}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    }, durationMs);
  }

  // Feedback de desbloqueo (Fase 17, "OZAMA Torneos + Experiencia
  // Visual"): compara los logros desbloqueados contra un baseline
  // guardado en localStorage y muestra un toast "¡Desbloqueado!" solo
  // por los que son NUEVOS desde la ultima vez. La primera vez que
  // corre en un navegador (sin baseline todavia) solo establece el
  // baseline sin mostrar nada -- si no, un jugador con cuenta vieja
  // veria un alud de toasts por logros que ya tenia de antes.
  function ozCheckNewUnlocks(achievements) {
    if (!Array.isArray(achievements)) return;
    const CACHE_KEY = 'ozama-seen-achievements';
    const unlockedKeys = achievements.filter((a) => a.unlocked).map((a) => a.key);
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) {}
    if (!Array.isArray(seen)) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(unlockedKeys)); } catch (_) {}
      return;
    }
    const seenSet = new Set(seen);
    const newOnes = achievements.filter((a) => a.unlocked && !seenSet.has(a.key));
    newOnes.forEach((a, i) => {
      setTimeout(() => ozToast(`¡Desbloqueado! ${a.name}`, 'unlock', { icon: a.icon }), i * 700);
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(unlockedKeys)); } catch (_) {}
  }

  window.ozToast = ozToast;
  window.ozCheckNewUnlocks = ozCheckNewUnlocks;
})();
