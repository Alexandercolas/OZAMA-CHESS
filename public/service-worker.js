'use strict';

const CACHE_VERSION = 'ozama-pwa-v2';
const PUBLIC_NAVIGATION = new Set([
  '/',
  '/index.html',
  '/login.html',
  '/leaderboard.html',
  '/offline.html',
]);
const PRECACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/leaderboard.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/pwa.js',
  '/style.css',
  '/favicon.ico',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/assets/brand/ozama-knight-icon.png',
  '/assets/brand/ozama-hero-brutal.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isPrivateRequest(request, url) {
  return request.headers.has('authorization') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/');
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && PUBLIC_NAVIGATION.has(url.pathname)) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        if (PUBLIC_NAVIGATION.has(url.pathname)) {
          const cached = await caches.match(request);
          if (cached) return cached;
        }
        return caches.match('/offline.html');
      }
    })());
    return;
  }

  if (/\.(?:js|css|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (/\.(?:png|jpe?g|webp|svg|ico|mp3|woff2?)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
