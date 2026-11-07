// слияние: по каждой карточке берём более свежую запись (по времени последнего ответа)
function mergeIn(d){
  const resetAt = Math.max(settings.resetAt || 0, d.resetAt || 0);
  settings.resetAt = resetAt;
  let taken = 0;
  for(const [id, p] of Object.entries(d.progress || {})){
    if(!p || (p.last || 0) < resetAt) continue;
    const mine = progress[id];
    if(!mine || (p.last || 0) > (mine.last || 0)){ progress[id] = p; taken++; }
  }
  for(const id of Object.keys(progress)) if((progress[id].last || 0) < resetAt) delete progress[id];
  for(const [day, s] of Object.entries(d.stats || {})){
    if(!stats[day] || (s.reviews || 0) > (stats[day].reviews || 0)) stats[day] = s;
  }
  return taken;
}
// ================== автосохранение в файл (File System Access API: Chrome / Edge) ==================
const FS_OK = typeof window.showSaveFilePicker === 'function' && 'indexedDB' in window;
const JSON_TYPES = [{ description: 'Прогресс карточек', accept: { 'application/json': ['.json'] } }];
let fileHandle = null, fileState = FS_OK ? 'none' : 'unsupported', fileErr = '', lastWrite = 0;
let writeTimer = null, writing = false, dirty = false, permPending = false;

// хендл файла живёт в IndexedDB, чтобы не выбирать файл при каждом запуске
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(FILE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req.result); tx.onerror = () => rej(tx.error);
  }));
  return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k)) };
})();

const fmtTime = ts => new Date(ts).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
function setFileState(s, err = ''){ fileState = s; fileErr = err; renderFileUi(); }
function renderFileUi(){
  const b = document.getElementById('fileBtn'), info = document.getElementById('fileInfo');
  const name = esc(fileHandle?.name || 'progress.json');
  const chip = {
    none:  ['💾 Подключить файл прогресса', 'warn', 'Прогресс сейчас только в браузере — нажми, чтобы сохранять его в progress.json'],
    perm:  ['💾 Разрешить сохранение', 'warn', 'Браузер просит подтвердить доступ к файлу после перезапуска'],
    ok:    [`💾 ${name} ✓`, 'ok', lastWrite ? `Сохранено в ${fmtTime(lastWrite)}. Нажми, чтобы сохранить сейчас` : 'Файл подключён'],
    error: ['💾 Ошибка сохранения', 'err', fileErr],
  }[fileState];
  b.className = 'filechip' + (chip ? ' ' + chip[1] : ' hidden');
  if(chip){ b.textContent = chip[0]; b.title = chip[2]; }
  const texts = {
    unsupported: 'Этот браузер не умеет писать в файлы напрямую — автосохранение работает в <b>Chrome</b> и <b>Edge</b>. Здесь используй экспорт вручную.',
    none: 'Файл не подключён. Нажми «Выбрать / создать progress.json…» и сохрани его в папку колоды рядом с этой страницей — дальше прогресс будет писаться туда сам после каждого ответа. Если файл уже есть (старый экспорт), выбери «Подключить существующий» — прогресс из него сольётся с текущим.',
    perm: `Подключён <b>${name}</b>, но после перезапуска браузер просит подтвердить доступ. Это спросится при первом клике или нажатии клавиши (в Chrome можно выбрать «Разрешать всегда»).`,
    ok: `Прогресс автоматически сохраняется в <b>${name}</b>${lastWrite ? ` — последний раз в ${fmtTime(lastWrite)}` : ''}. При открытии страницы файл и браузер сливаются: по каждой карточке берётся более свежая запись.`,
    error: `Не получилось работать с файлом: ${esc(fileErr)}. Подключи файл заново.`,
  };
  info.innerHTML = texts[fileState] || '';
  document.getElementById('fileNewBtn').classList.toggle('hidden', !FS_OK);
  document.getElementById('fileOpenBtn').classList.toggle('hidden', !FS_OK);
  document.getElementById('fileOffBtn').classList.toggle('hidden', !fileHandle);
}

function scheduleWrite(){
  if(!fileHandle || fileState !== 'ok') return;
  dirty = true; flushWrite();
}
async function flushWrite(){
  clearTimeout(writeTimer);
  if(!dirty || !fileHandle || fileState !== 'ok') return;
  if(writing){ writeTimer = setTimeout(flushWrite, 300); return; }
  writing = true; dirty = false;
  try{
    const w = await fileHandle.createWritable();
    await w.write(JSON.stringify(buildExport(), null, 2));
    await w.close();
    lastWrite = Date.now(); renderFileUi();
  }catch(e){ dirty = true; setFileState('error', e.message || String(e)); }
  finally{ writing = false; }
}
// прочитать файл, слить с браузером, записать результат обратно
async function syncWithFile(){
  try{
    const text = (await (await fileHandle.getFile()).text()).trim();
    if(text){
      let d;
      try{ d = JSON.parse(text); }catch(_){ throw new Error('файл не похож на progress.json (не JSON)'); }
      checkFormat(d);
      mergeIn(d); saveLocal();
    }
    fileState = 'ok'; dirty = true;
    await flushWrite();
    renderFileUi(); refreshAll({preserveCard:true});
  }catch(e){
    setFileState('error', e.name === 'NotFoundError' ? 'файл не найден (переместили или удалили?)' : (e.message || String(e)));
  }
}
async function connectFile(existing){
  if(!FS_OK) return;
  try{
    let h;
    if(existing){
      [h] = await window.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
      if(await h.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('нет разрешения на запись');
    } else {
      h = await window.showSaveFilePicker({ suggestedName: FILE_NAME, types: JSON_TYPES });
    }
    fileHandle = h;
    try{ await idb.set('progressFile', h); }catch(_){}
    await syncWithFile();
  }catch(e){ if(e.name !== 'AbortError') setFileState('error', e.message || String(e)); }
}
async function requestPerm(){
  if(!fileHandle || permPending) return;
  permPending = true;
  try{
    const r = await fileHandle.requestPermission({ mode: 'readwrite' });
    if(r === 'granted') await syncWithFile(); else setFileState('perm');
  }catch(e){ setFileState('error', e.message || String(e)); }
  finally{ permPending = false; }
}
async function disconnectFile(){
  await flushWrite();
  fileHandle = null; lastWrite = 0;
  try{ await idb.del('progressFile'); }catch(_){}
  setFileState(FS_OK ? 'none' : 'unsupported');
}
async function initFile(){
  if(!FS_OK){ setFileState('unsupported'); return; }
  try{ fileHandle = await idb.get('progressFile') || null; }catch(_){ fileHandle = null; }
  if(!fileHandle){ setFileState('none'); return; }
  let perm = 'prompt';
  try{ perm = await fileHandle.queryPermission({ mode: 'readwrite' }); }catch(_){}
  if(perm === 'granted'){ await syncWithFile(); return; }
  setFileState('perm');
  // разрешение можно запросить только по действию пользователя — ловим первый клик/клавишу
  const onGesture = e => {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    if(fileState === 'perm' && e.target?.id !== 'fileBtn') requestPerm();
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}
document.getElementById('fileBtn').onclick = () => {
  if(fileState === 'perm') requestPerm();
  else if(fileState === 'ok'){ dirty = true; flushWrite(); }
  else connectFile(false);
};
document.getElementById('fileNewBtn').onclick = () => connectFile(false);
document.getElementById('fileOpenBtn').onclick = () => connectFile(true);
document.getElementById('fileOffBtn').onclick = () => disconnectFile();
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushWrite(); });

initFile();
