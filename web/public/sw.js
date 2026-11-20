// GEN-MOD: 最小 Service Worker，仅用于 PWA 可安装性；不缓存业务数据
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })))
})
