'use strict';

(function configureOzamaRuntime() {
  const productionOrigin = 'https://ozama-chess.onrender.com';
  const capacitor = window.Capacitor;
  const native = Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform());
  const root = document.documentElement;

  root.classList.toggle('ozama-native', native);

  if (native) {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !viewport.content.includes('viewport-fit=cover')) {
      viewport.content = `${viewport.content}, viewport-fit=cover`;
    }

    const mobileStyles = document.createElement('style');
    mobileStyles.dataset.ozamaRuntime = 'mobile';
    mobileStyles.textContent = `
      :root {
        --ozama-safe-top: env(safe-area-inset-top, 0px);
        --ozama-safe-right: env(safe-area-inset-right, 0px);
        --ozama-safe-bottom: env(safe-area-inset-bottom, 0px);
        --ozama-safe-left: env(safe-area-inset-left, 0px);
        --ozama-keyboard-height: 0px;
        --ozama-viewport-height: 100dvh;
      }
      html.ozama-native,
      html.ozama-native body {
        min-height: var(--ozama-viewport-height);
        background: #0D0B08;
      }
      html.ozama-native body {
        padding-top: var(--ozama-safe-top);
        padding-right: var(--ozama-safe-right);
        padding-bottom: var(--ozama-safe-bottom);
        padding-left: var(--ozama-safe-left);
      }
      html.ozama-native input,
      html.ozama-native textarea,
      html.ozama-native select {
        scroll-margin-top: calc(var(--ozama-safe-top) + 24px);
        scroll-margin-bottom: calc(var(--ozama-keyboard-height) + var(--ozama-safe-bottom) + 24px);
      }
      html.ozama-native .board,
      html.ozama-native .square,
      html.ozama-native .piece {
        -webkit-touch-callout: none;
      }
    `;
    document.head.appendChild(mobileStyles);
  }

  window.OZAMA_RUNTIME = Object.freeze({
    native,
    apiOrigin: native ? productionOrigin : '',
    socketOrigin: native ? productionOrigin : undefined,
  });

  let lastResumeAt = 0;

  function announceResume(source) {
    const now = Date.now();
    if (now - lastResumeAt < 500) return;
    lastResumeAt = now;
    window.dispatchEvent(new CustomEvent('ozama:resume', { detail: { source } }));
  }

  function updateViewportMetrics() {
    if (!native) return;
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight);
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    const keyboardHeight = Math.max(0, Math.round(window.innerHeight - height - offsetTop));

    root.style.setProperty('--ozama-viewport-height', `${height}px`);
    root.style.setProperty('--ozama-keyboard-height', `${keyboardHeight}px`);
    root.classList.toggle('ozama-keyboard-open', keyboardHeight > 120);
  }

  function isTextControl(element) {
    return element instanceof HTMLElement
      && Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function setupNativeLifecycle() {
    if (!native) return;

    updateViewportMetrics();
    window.visualViewport?.addEventListener('resize', updateViewportMetrics);
    window.visualViewport?.addEventListener('scroll', updateViewportMetrics);
    window.addEventListener('orientationchange', () => setTimeout(updateViewportMetrics, 150));

    document.addEventListener('focusin', (event) => {
      if (!isTextControl(event.target)) return;
      setTimeout(() => {
        event.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 280);
    });

    document.addEventListener('contextmenu', (event) => {
      if (event.target instanceof Element && event.target.closest('.board')) event.preventDefault();
    });
    document.addEventListener('dragstart', (event) => {
      if (event.target instanceof Element && event.target.closest('.board')) event.preventDefault();
    });
    document.addEventListener('gesturestart', (event) => {
      if (event.target instanceof Element && event.target.closest('.board')) event.preventDefault();
    });

    const app = capacitor?.Plugins?.App;
    if (!app?.addListener) return;

    app.addListener('appStateChange', ({ isActive } = {}) => {
      if (isActive) announceResume('native');
    }).catch(() => {});

    app.addListener('backButton', async ({ canGoBack } = {}) => {
      if (isTextControl(document.activeElement)) {
        document.activeElement.blur();
        return;
      }

      let handled = false;
      try {
        handled = Boolean(await window.OZAMA_HANDLE_NATIVE_BACK?.({ canGoBack }));
      } catch (error) {
        console.warn('[OZAMA] No se pudo procesar el botón Atrás:', error);
      }
      if (handled) return;

      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else if (typeof app.minimizeApp === 'function') {
        app.minimizeApp();
      }
    }).catch(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') announceResume('visibility');
  });
  window.addEventListener('pageshow', () => announceResume('pageshow'));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNativeLifecycle, { once: true });
  } else {
    setupNativeLifecycle();
  }

  if (!native || typeof window.fetch !== 'function') return;

  const originalFetch = window.fetch.bind(window);
  const localOrigin = window.location.origin;

  function apiUrl(value) {
    const url = new URL(value, localOrigin);
    if (url.origin !== localOrigin || !url.pathname.startsWith('/api/')) return null;
    return `${productionOrigin}${url.pathname}${url.search}${url.hash}`;
  }

  window.fetch = function ozamaFetch(input, init) {
    if (typeof input === 'string' || input instanceof URL) {
      const remoteUrl = apiUrl(String(input));
      return originalFetch(remoteUrl || input, init);
    }

    if (input instanceof Request) {
      const remoteUrl = apiUrl(input.url);
      if (remoteUrl) return originalFetch(new Request(remoteUrl, input), init);
    }

    return originalFetch(input, init);
  };
})();
