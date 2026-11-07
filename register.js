if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
  const url = new URL('sw.js', document.currentScript.src);
  window.addEventListener('load', () => navigator.serviceWorker.register(url).catch(console.warn));
}
