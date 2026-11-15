(() => {
  const status = document.getElementById('cloudStatus');
  const button = document.getElementById('cloudLogin');
  const studyStatus = document.getElementById('studySync');
  const studyLogin = document.getElementById('studyLogin');
  function report(summary, detail, login = false) {
    if (progressStorage.failed) {
      summary = 'Ошибка сохранения на устройстве';
      detail = 'Локальная копия не обновлена. Скачайте резервную копию или повторите сохранение через предупреждение на экране.';
    }
    status.textContent = detail;
    if (studyStatus) studyStatus.textContent = summary;
    if (studyLogin) studyLogin.hidden = !login;
  }
  if (studyLogin) studyLogin.onclick = () => button.click();
  const capture = () => JSON.parse(JSON.stringify({cards:progress, days:stats, reset:settings.resetAt || 0, ...(window.cardBookmarks ? {bookmarks:window.cardBookmarks} : {})}));
  const prefix = KEY + ':cloud:';
  const queuePrefix = prefix + 'event:';
  const pending = new Map();
  function owner() {
    try {return localStorage.getItem(prefix+'owner');}
    catch {progressStorage.fail('sync-read');return undefined;}
  }
  function readQueue() {
    try {
      const events = Object.keys(localStorage).filter(k => k.startsWith(queuePrefix))
        .map(k => JSON.parse(localStorage.getItem(k)));
      progressStorage.recovered('sync-read');
      return [...new Map([...events,...pending.values()].map(e => [e.id,e])).values()];
    } catch {
      progressStorage.fail('sync-read');
      return null;
    }
  }
  let before = capture(), lastTime = progressStorage.read(prefix+'clock',0) || 0;
  let ownerId = owner();
  let upload, auth, api, provider, started = false;
  function rememberOwner() {
    if (!ownerId) return;
    try {
      localStorage.setItem(prefix+'owner',ownerId);
      progressStorage.recovered('sync-owner');
    } catch {progressStorage.fail('sync-owner');}
  }
  function persistPending() {
    if (!pending.size) return;
    const entries = Object.fromEntries([...pending.values()].map(e => [queuePrefix+e.id,e]));
    entries[prefix+'clock'] = lastTime;
    progressStorage.write(entries,'sync-queue');
  }
  function enqueue(data) {
    const at = Math.max(Date.now(), lastTime+1);
    const event = {...data, at, id:crypto.randomUUID()};
    pending.set(event.id,event);
    lastTime = at;
    persistPending();
    upload?.();
  }
  window.addEventListener('progress-saved', () => {
    const after = capture();
    if (ownerId === undefined) ownerId = owner();
    if (ownerId === undefined) return;
    if (ownerId) {
      rememberOwner();
      const edit = syncState.patch(before, after);
      if (edit) enqueue(edit);
      else {persistPending();upload?.();}
    }
    before = after;
  });
  if (location.protocol === 'file:') {
    report('Сохранение на устройстве', 'Облачная синхронизация доступна в опубликованной версии тренажёра.');
    return;
  }
  async function start() {
    const config = window.FLASHCARDS_FIREBASE || await fetch('/__/firebase/init.json').then(r => r.json());
    const base = 'https://www.gstatic.com/firebasejs/13.2.0/';
    const [app, authApi, dbApi] = await Promise.all(['app','auth','firestore'].map(n => import(base+'firebase-'+n+'.js')));
    const project = app.initializeApp(config);
    api = authApi;
    auth = api.getAuth(project);
    provider = new api.GoogleAuthProvider();
    const db = dbApi.getFirestore(project);
    api.onAuthStateChanged(auth, user => {
      if (!user) {
        report('Прогресс на устройстве', 'Для синхронизации войди на обоих устройствах с одним аккаунтом Google.', true);
        button.hidden = false;
        return;
      }
      button.hidden = true;
      const storedOwner = owner();
      if (storedOwner === undefined) return;
      if (storedOwner && storedOwner !== user.uid) {
        report('Аккаунт не совпадает', 'Прогресс в этом браузере связан с другим аккаунтом. Открой тренажёр в его профиле браузера.');
        return;
      }
      if (started) return;
      started = true;
      ownerId = user.uid;
      if (!storedOwner) {
        enqueue({kind:'seed', ...capture()});
        rememberOwner();
      }
      const collection = dbApi.collection(db,'users',user.uid,'decks',KEY,'events');
      const sending = new Set();
      upload = () => {
        const queue = readQueue();
        if (!queue) return;
        for (const event of queue) {
          if (sending.has(event.id)) continue;
          sending.add(event.id);
          report('Ожидает синхронизации', 'Изменения ожидают подтверждения облака.');
          dbApi.setDoc(dbApi.doc(collection,event.id),event).then(() => {
            pending.delete(event.id);
            try {localStorage.removeItem(queuePrefix+event.id);}
            catch {progressStorage.fail('sync-queue');}
            const remaining = readQueue();
            if (remaining && !remaining.length) {
              progressStorage.recovered('sync-queue');
              if (navigator.onLine) report('Синхронизировано', 'Синхронизировано · '+user.email);
            }
          }).catch(e => { report('Ошибка синхронизации · прогресс на устройстве', 'Ошибка записи. Прогресс сохранён на устройстве. '+e.code); })
            .finally(() => sending.delete(event.id));
        }
      };
      dbApi.onSnapshot(collection,{includeMetadataChanges:true},snapshot => {
        if (snapshot.metadata.fromCache) return;
        const queue = readQueue();
        if (!queue) return;
        const events = new Map(snapshot.docs.map(doc => [doc.id,doc.data()]));
        for (const event of queue) events.set(event.id,event);
        for (const event of events.values()) lastTime = Math.max(lastTime,event.at);
        const result = syncState.replay([...events.values()]);
        if(window.cardBookmarks) result.bookmarks ||= {};
        if (!syncState.equal(before,result)) {
          undoStack = before.reset !== result.reset ? [] : undoStack.filter(entry =>
            syncState.equal(before.cards[entry.id],result.cards[entry.id]));
          if(window.cardBookmarks){
            window.cardBookmarks = result.bookmarks || {};
            progressStorage.write({[KEY + ':bookmarks']:window.cardBookmarks});
          }
          progress = result.cards;
          stats = result.days;
          settings.resetAt = result.reset;
          const today = dayKey(Date.now());
          settings.newDay = {date:today,count:stats[today]?.new || 0};
          before = capture();
          saveLocal();
          scheduleWrite();
          refreshAll({preserveCard:true});
        }
        if (!queue.length && !snapshot.metadata.hasPendingWrites) report('Синхронизировано', 'Синхронизировано · '+user.email);
      }, e => { report('Ошибка чтения из облака', 'Ошибка чтения облака. '+e.code); });
      upload();
      window.addEventListener('online',upload);
      window.addEventListener('offline',() => {
        report('Без сети · прогресс на устройстве', 'Сейчас без сети. Ответы сохраняются на этом устройстве.');
      });
    });
  }
  button.onclick = async () => {
    try { await api.signInWithPopup(auth,provider); }
    catch(e) { report('Вход не выполнен', 'Вход не выполнен. '+e.code, true); }
  };
  function connect() {
    start().catch(() => {
      report('Облако недоступно · прогресс на устройстве', 'Облако недоступно. Ответы сохраняются на устройстве. После подключения к сети синхронизация возобновится.');
      window.addEventListener('online',connect,{once:true});
    });
  }
  connect();
})();
