const cacheName = 'memory-cards-shell-v6';
const assets = ['./','./index.html','./library.css','./app.webmanifest','./register.js',
  './progress-storage.js','./sync-state.js','./cloud-sync.js','./autosave.js','./icon-192.png','./icon-512.png',
  './android/flashcards.html','./android/cards.js','./eng/flashcards.html','./eng/cards.js','./finance/flashcards.html','./finance/cards.js','./lesson5/flashcards.html','./lesson5/cards.js'];
const paths = new Set(assets.map(asset => new URL(asset,self.registration.scope).href));
const ivanAssets = ['index.html','flashcards.html','catalog.js','catalog.css','batman-theme.css','catalog.json','extra-decks.json','load-deck.js',
  'art/reading.png','art/celebrate.png','art/pause.png','art/rest.png'];
assets.push(...ivanAssets.map(name => './ivan/'+name));
for (const name of ivanAssets) paths.add(new URL('./ivan/'+name,self.registration.scope).href);
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
  const url = new URL(event.request.url);
  const ivanBase = new URL('./ivan/',self.registration.scope).href;
  const path = url.origin + url.pathname;
  const ivanData = path.startsWith(ivanBase) && /\/(decks\/[0-9a-f]{16}\.js|media\/[0-9a-f]{24}\.jpg)$/.test(url.pathname);
  if (event.request.method !== 'GET' || (!paths.has(path) && !ivanData)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(event.request, {cache:'no-cache'});
      if (response.ok) await cache.put(path,response.clone());
      return response;
    } catch (error) {
      return await cache.match(path) || Response.error();
    }
  })());
});
