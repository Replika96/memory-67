const cacheName = 'memory-cards-shell-v2';
const assets = ['./','./index.html','./library.css','./app.webmanifest','./register.js',
  './sync-state.js','./cloud-sync.js','./autosave.js','./icon-192.png','./icon-512.png',
  './android/flashcards.html','./android/cards.js','./eng/flashcards.html','./eng/cards.js'];
const paths = new Set(assets.map(asset => new URL(asset,self.registration.scope).href));
self.addEventListener('install',event => {
  event.waitUntil(caches.open(cacheName)
    .then(cache => cache.addAll(assets.map(path => new Request(path, {cache:'reload'}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('memory-cards-shell-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch',event => {
  if (event.request.method !== 'GET' || !paths.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(event.request, {cache:'no-cache'});
      if (response.ok) await cache.put(event.request,response.clone());
      return response;
    } catch (error) {
      return await cache.match(event.request) || Response.error();
    }
  })());
});
