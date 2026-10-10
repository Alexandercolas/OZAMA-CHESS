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
  let currentBuild = '';
  let checkingBuild = false;
  let updateNotice = null;
  let dismissedBuild = '';

  const autoRefreshPaths = new Set(['/', '/index.html', '/leaderboard.html', '/privacy.html', '/terms.html', '/support.html', '/account-deletion.html']);
  const activeGamePaths = new Set(['/game.html', '/damas.html']);

  function showUpdateNotice(version) {
    if (updateNotice || dismissedBuild === version || activeGamePaths.has(location.pathname)) return;
    closeInstallCard({ remember: false });
    if (!document.querySelector('style[data-ozama-update]')) {
      const style = document.createElement('style');
      style.dataset.ozamaUpdate = 'true';
      style.textContent = `
      .oz-update-notice {
        position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        z-index: 1201; display: flex; align-items: center; gap: 12px;
        width: min(420px, calc(100vw - 32px)); padding: 12px 14px;
        border: 1px solid rgba(200,152,60,0.62); border-radius: 4px;
        background: #131008; color: #E9E4DA;
        box-shadow: 0 14px 40px rgba(0,0,0,0.65);
        font: 600 12px/1.4 Inter, Arial, sans-serif;
      }
      .oz-update-notice span { flex: 1; min-width: 0; }
      .oz-update-notice button {
        flex: 0 0 auto; min-height: 36px; padding: 0 12px;
        border: 1px solid #E2B960; border-radius: 2px;
        background: #C8983C; color: #0D0B08;
        font: 800 10px Inter, Arial, sans-serif; cursor: pointer;
      }
      .oz-update-notice .oz-update-close {
        width: 28px; min-height: 28px; padding: 0;
        border: 0; background: transparent; color: #E9E4DA;
        font: 22px/1 Arial, sans-serif;
      }
    `;
      document.head.appendChild(style);
    }
    updateNotice = document.createElement('aside');
    updateNotice.className = 'oz-update-notice';
    updateNotice.setAttribute('role', 'status');
    updateNotice.innerHTML = '<span>Hay una nueva versión de OZAMA.</span><button type="button" class="oz-update-action">Actualizar</button><button type="button" class="oz-update-close" aria-label="Más tarde" title="Más tarde">&times;</button>';
    updateNotice.querySelector('.oz-update-action').addEventListener('click', () => location.reload());
    updateNotice.querySelector('.oz-update-close').addEventListener('click', () => {
      dismissedBuild = version;
      updateNotice.remove();
      updateNotice = null;
    });
    document.body.appendChild(updateNotice);
  }

  async function checkBuildVersion() {
    if (checkingBuild || document.visibilityState === 'hidden') return;
    checkingBuild = true;
    try {
      const response = await fetch('/api/app-version', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) return;
      const version = String((await response.json()).version || '');
      if (!version) return;
      if (currentBuild && currentBuild !== version) {
        if (autoRefreshPaths.has(location.pathname)) location.reload();
        else showUpdateNotice(version);
        return;
      }
      currentBuild = version;
    } catch (_) {
      // Sin red se conserva la version actual hasta la proxima comprobacion.
    } finally {
      checkingBuild = false;
    }
  }

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

  window.addEventListener('load', async () => {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        registration.update().catch(() => {});
      } catch (error) {
        console.warn('[PWA] No se pudo registrar el modo instalable.', error);
      }
    }
    checkBuildVersion();
  });
  window.addEventListener('ozama:resume', checkBuildVersion);
  window.addEventListener('focus', checkBuildVersion);
  window.setInterval(checkBuildVersion, 5 * 60 * 1000);
})();
