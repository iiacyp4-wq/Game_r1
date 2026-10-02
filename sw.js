// 오프라인에서도 열리게 파일을 저장. 인터넷이 되면 항상 최신 파일을 받음
const CACHE = 'blockdefense-v2';
const FILES = ['./', 'index.html', 'style.css', 'game.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const net = fetch(e.request, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; });
    const cached = await c.match(e.request, { ignoreSearch: true });
    if (!cached) return net;
    return Promise.race([net.catch(() => cached), new Promise((r) => setTimeout(() => r(cached), 3000))]);
  }));
});
