/**
 * Keep the app usable without a network.
 *
 * The service worker caches every same-origin file that the app reads: the
 * page, the bundle, the styles, and the icons. A second visit reads the cache
 * first and asks the network at the same time, so the app starts fast and the
 * cache stays fresh.
 *
 * The Google Sheets requests are cross-origin and go straight to the network.
 * A sheet that fails keeps its snapshot rows, so the app works offline with
 * the data of the last build.
 */

const CACHE = 'berlin-shape-note-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', './index.html']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true })),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)

      return cached || fresh
    }),
  )
})
