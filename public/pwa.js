'use strict';

(() => {
  const offerPaths = new Set(['/', '/index.html', '/login.html', '/lobby.html']);
  const isNative = Boolean(window.OZAMA_RUNTIME?.native);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || window.matchMedia('(max-width: 760px)').matches;
  let installPrompt = null;
  let installCard = null;
  let showingInstructions = false;

  function wasDismissed() {
    try {
      return localStorage.getItem('ozama-install-dismissed') === '1';
    } catch (_) {
      return false;
    }
  }

  function rememberDismissal() {
    try {
      localStorage.setItem('ozama-install-dismissed', '1');
    } catch (_) {}
  }

  function closeInstallCard({ remember = true } = {}) {
    if (remember) rememberDismissal();
    installCard?.remove();
    installCard = null;
  }

  function installInstructions() {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      return 'En Safari, pulsa Compartir y luego Agregar a pantalla de inicio.';
    }
    if (/Android/i.test(navigator.userAgent)) {
      return 'Abre el menu del navegador y elige Instalar aplicacion o Agregar a pantalla de inicio.';
    }
    return 'Usa la opcion Instalar de la barra de direcciones de tu navegador.';
  }

  function addInstallStyles() {
    if (document.querySelector('style[data-ozama-install]')) return;
    const styles = document.createElement('style');
    styles.dataset.ozamaInstall = 'true';
    styles.textContent = `
      .oz-install-card {
        position: fixed;
        right: 18px;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
        z-index: 1200;
        width: min(430px, calc(100vw - 32px));
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr) auto 32px;
        align-items: center;
        gap: 14px;
        padding: 14px;
        color: #E9E4DA;
        background:
          linear-gradient(150deg, rgba(200,152,60,0.10), transparent 44%),
          #131008;
        border: 1px solid rgba(200,152,60,0.62);
        border-radius: 4px;
        box-shadow: 0 18px 54px rgba(0,0,0,0.72), inset 0 0 0 1px rgba(255,255,255,0.03);
        font-family: Inter, Arial, sans-serif;
        animation: oz-install-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .oz-install-card::before {
        content: '';
        position: absolute;
        inset: -1px auto auto -1px;
        width: 18px;
        height: 18px;
        border-top: 2px solid #E2B960;
        border-left: 2px solid #E2B960;
        pointer-events: none;
      }
      .oz-install-icon {
        width: 54px;
        height: 54px;
        display: block;
        border-radius: 50%;
        border: 1px solid rgba(226,185,96,0.50);
        object-fit: cover;
        box-shadow: 0 0 18px rgba(200,152,60,0.18);
      }
      .oz-install-copy { min-width: 0; }
      .oz-install-title {
        display: block;
        margin-bottom: 4px;
        color: #E2B960;
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-size: 19px;
        font-weight: 700;
        line-height: 1.05;
        letter-spacing: 0;
      }
      .oz-install-text {
        display: block;
        color: rgba(233,228,218,0.68);
        font-size: 12px;
        line-height: 1.45;
        letter-spacing: 0;
      }
      .oz-install-action {
        min-height: 42px;
        padding: 0 15px;
        border: 1px solid #E2B960;
        border-radius: 2px;
        color: #0D0B08;
        background: linear-gradient(180deg, #E2B960, #A9771C);
        font: 800 10px/1 Inter, Arial, sans-serif;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: filter 220ms ease, box-shadow 220ms ease, transform 220ms ease;
      }
      .oz-install-action:hover {
        filter: brightness(1.08);
        box-shadow: 0 0 24px rgba(200,152,60,0.22);
        transform: translateY(-1px);
      }
      .oz-install-close {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 0;
        color: rgba(233,228,218,0.58);
        background: transparent;
        font: 400 25px/1 Arial, sans-serif;
        cursor: pointer;
      }
      .oz-install-close:hover { color: #E2B960; }
      @keyframes oz-install-in {
        from { opacity: 0; transform: translateY(18px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 560px) {
        .oz-install-card {
          left: 12px;
          right: 12px;
          bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          width: auto;
          grid-template-columns: 48px minmax(0, 1fr) 30px;
          gap: 11px;
          padding: 12px;
        }
        .oz-install-icon { width: 48px; height: 48px; }
        .oz-install-action { grid-column: 2 / 4; width: 100%; }
        .oz-install-close { grid-column: 3; grid-row: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .oz-install-card { animation: none; }
      }
    `;
    document.head.appendChild(styles);
  }

  function showInstallCard() {
    if (installCard || isNative || isStandalone || wasDismissed() || !offerPaths.has(location.pathname)) return;

    addInstallStyles();
    installCard = document.createElement('aside');
    installCard.className = 'oz-install-card';
    installCard.setAttribute('aria-label', 'Instalar OZAMA CHESS');
    installCard.innerHTML = `
      <img class="oz-install-icon" src="/assets/brand/ozama-knight-icon.png" alt="">
      <div class="oz-install-copy" aria-live="polite">
        <strong class="oz-install-title">Lleva OZAMA contigo</strong>
        <span class="oz-install-text">Instala el juego gratis y abrelo como una app.</span>
      </div>
      <button class="oz-install-action" type="button">Instalar app</button>
      <button class="oz-install-close" type="button" aria-label="Cerrar">&times;</button>
    `;

    const copy = installCard.querySelector('.oz-install-text');
    const action = installCard.querySelector('.oz-install-action');
    installCard.querySelector('.oz-install-close')?.addEventListener('click', () => closeInstallCard());
    action?.addEventListener('click', async () => {
      if (showingInstructions) {
        closeInstallCard();
        return;
      }

      if (installPrompt) {
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        installPrompt = null;
        if (outcome === 'accepted') closeInstallCard({ remember: false });
        return;
      }

      showingInstructions = true;
      if (copy) copy.textContent = installInstructions();
      action.textContent = 'Entendido';
    });

    document.body.appendChild(installCard);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    showInstallCard();
  });

  window.addEventListener('appinstalled', () => closeInstallCard({ remember: false }));

  window.addEventListener('DOMContentLoaded', () => {
    if (isMobile) showInstallCard();
  }, { once: true });

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('[PWA] No se pudo registrar el modo instalable.', error);
    }
  });
})();
