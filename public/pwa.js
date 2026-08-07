'use strict';

(() => {
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
