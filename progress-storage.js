const progressStorage = (() => {
  const failures = new Set();
  let warning;
  function render() {
    if (!warning && failures.size) {
      warning = document.createElement('div');
      warning.className = 'save-warning';
      warning.setAttribute('role','alert');
      const text = document.createElement('p');
      text.textContent = 'Не удалось обновить сохранение на устройстве. Скачайте резервную копию или повторите сохранение.';
      const retry = document.createElement('button');
      retry.className = 'btn';
      retry.textContent = 'Повторить сохранение';
      retry.onclick = () => save();
      const backup = document.createElement('button');
      backup.className = 'btn';
      backup.textContent = 'Скачать резервную копию';
      backup.onclick = () => document.getElementById('exportBtn').click();
      warning.append(text,retry,backup);
      document.querySelector('main').prepend(warning);
    }
    if (warning) warning.hidden = failures.size === 0;
  }
  function fail(scope) { failures.add(scope); render(); }
  function recovered(scope) { failures.delete(scope); render(); }
  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      const result = value == null ? fallback : JSON.parse(value);
      recovered('read:'+key);
      return result;
    } catch {
      fail('read:'+key);
      return fallback;
    }
  }
  function write(values, scope = 'progress') {
    const previous = new Map(), touched = [];
    try {
      const entries = Object.entries(values).map(([key,value]) => [key,JSON.stringify(value)]);
      for (const [key] of entries) previous.set(key,localStorage.getItem(key));
      for (const [key,value] of entries) {
        localStorage.setItem(key,value);
        touched.push(key);
      }
      for (const [key] of entries) failures.delete('read:'+key);
      recovered(scope);
      return true;
    } catch {
      // Free newly allocated values before restoring the previous snapshot.
      for (const key of touched) { try {localStorage.removeItem(key);} catch {} }
      for (const key of touched) {
        try {if (previous.get(key) != null) localStorage.setItem(key,previous.get(key));} catch {}
      }
      fail(scope);
      return false;
    }
  }
  return {read, write, fail, recovered, get failed() {return failures.size > 0;}};
})();
