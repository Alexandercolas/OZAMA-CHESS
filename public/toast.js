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

  function ozToast(message, type = 'info', durationMs = 3200) {
    if (!message) return;
    const stack = ensureStack();
    const el = document.createElement('div');
    el.className = `oz-toast ${type}`;
    el.innerHTML = `<span class="ot-icon">${ICONS[type] || ICONS.info}</span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 220);
    }, durationMs);
  }

  window.ozToast = ozToast;
})();
