/**
 * KEN Traders Master OS — Service Worker
 *
 * STRATEGY: Network-first for the main app file (so updates land
 * automatically), cache-first for everything else (icons, libraries)
 * so the app works offline.
 *
 * AUTO-UPDATE FLOW:
 *   1. User opens the app
 *   2. SW fetches latest index.html from GitHub in the background
 *   3. If changed, the new SW installs and waits
 *   4. On NEXT open (or if no tabs are open), the new version activates
 *   5. Staff never need to manually update anything
 */

// ⚠️ BUMP THIS on every release — must match APP_VERSION in index.html.
// This is the actual mechanism that makes "new version available" detectable:
// a changed CACHE_NAME means the browser sees this as a genuinely different
// service worker file, triggering the install/updatefound/waiting flow that
// index.html's updatefound listener picks up and turns into the orange banner.
const CACHE_NAME = 'ken-traders-beta-vbeta14';
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// ── INSTALL: pre-cache the app shell ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_FILES).catch(err => {
        // If one external resource fails (e.g. offline), still install —
        // the app will try to load it on next use.
        console.warn('SW: Some shell files not cached:', err);
      });
    }).then(() => {
      // Skip waiting so the new SW activates immediately when there are
      // no other tabs open — this is the key to near-instant auto-updates.
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: delete old caches ───────────────────────────────────────────
// ── MESSAGE: respond to SKIP_WAITING from the update banner ──────────────
// Without this, a waiting SW only activates once every open tab is closed —
// which could mean a person never sees the update if they keep the app
// open all day. The banner's "tap to update" sends this message to force
// immediate activation instead.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => { console.log('SW: Deleting old cache:', key); return caches.delete(key); })
      )
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── FETCH: network-first for HTML, cache-first for assets ─────────────────
self.addEventListener('fetch', event => {
  let url = event.request.url;

  // Never intercept Apps Script calls — those must always go to the network.
  // Caching them would break the cloud sync entirely.
  if (url.includes('script.google.com') || url.includes('googleapis.com')) {
    return; // let the browser handle it normally
  }

  // vBeta13: removed the old "Google Fonts — cache-first" branch that used to
  // sit here (matching fonts.googleapis.com/fonts.gstatic.com). Two things,
  // now moot together: (1) Lato is self-hosted inline in index.html as base64
  // now, so the app never requests either host at all; (2) that branch was
  // dead code anyway — fonts.googleapis.com always matched the plain
  // "googleapis.com" check right above first, so it never even reached the
  // font-caching logic, and its would-be caching never covered the first
  // (or offline) load in the first place. See index.html's font-face comment
  // for the actual device-inconsistency bug this was contributing to.

  // For the main HTML file — network-first so updates land automatically.
  // Falls back to cache if offline.
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            let clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // For everything else (icons, js bundles) — cache-first, fall back to network.
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.ok) {
          let clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
