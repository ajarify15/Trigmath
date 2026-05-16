// ============================================
//  TrigMaster PWA — Service Worker
//  Cache-First for static, Network-First for fonts
// ============================================

const APP_VERSION = 'v1.0.0';
const CACHE_STATIC = `trigmaster-static-${APP_VERSION}`;
const CACHE_FONTS  = `trigmaster-fonts-${APP_VERSION}`;

// Static assets to pre-cache on install
const STATIC_ASSETS = [
  './trigmaster.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-apple.png',
];

// Font origins to cache separately
const FONT_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ──────────────────────────────────────────
//  INSTALL — pre-cache all static assets
// ──────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing TrigMaster', APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed (some assets may be missing):', err))
  );
});

// ──────────────────────────────────────────
//  ACTIVATE — clean up old caches
// ──────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', APP_VERSION);
  const allowedCaches = [CACHE_STATIC, CACHE_FONTS];
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name => !allowedCaches.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────
//  FETCH — smart routing strategy
// ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // ── FONT REQUESTS: Stale-While-Revalidate ──
  if (FONT_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // ── NAVIGATION (HTML pages): Cache-First with network fallback ──
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./trigmaster.html')
        .then(cached => {
          if (cached) {
            // Background revalidate
            fetch(request).then(res => {
              if (res.ok) {
                caches.open(CACHE_STATIC).then(c => c.put(request, res));
              }
            }).catch(() => {});
            return cached;
          }
          return fetch(request).catch(() => caches.match('./trigmaster.html'));
        })
    );
    return;
  }

  // ── STATIC ASSETS: Cache-First ──
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_STATIC)
                .then(cache => cache.put(request, clone))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => {
            // Offline fallback for images
            if (request.destination === 'image') {
              return new Response(
                `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">
                  <rect width="192" height="192" fill="#0D1330"/>
                  <text x="96" y="110" text-anchor="middle" font-size="80">📐</text>
                </svg>`,
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }
          });
      })
  );
});

// ──────────────────────────────────────────
//  HELPER: Stale-While-Revalidate
// ──────────────────────────────────────────
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
}

// ──────────────────────────────────────────
//  MESSAGE: force update
// ──────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
