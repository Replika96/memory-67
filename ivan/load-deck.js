(() => {
  const id = new URLSearchParams(location.search).get('root');
  if (!/^[0-9a-f]{16}$/.test(id || '')) {
    location.replace('index.html');
    return;
  }
  window.IVAN_ROOT = id;
  // A fixed hexadecimal identifier selects a generated data file before the study script runs.
  document.write('<script src="decks/'+id+'.js"><\/script>');
})();
