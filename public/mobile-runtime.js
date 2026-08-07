'use strict';

(function configureOzamaRuntime() {
  const productionOrigin = 'https://ozama-chess.onrender.com';
  const capacitor = window.Capacitor;
  const native = Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform());

  window.OZAMA_RUNTIME = Object.freeze({
    native,
    apiOrigin: native ? productionOrigin : '',
    socketOrigin: native ? productionOrigin : undefined,
  });

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
