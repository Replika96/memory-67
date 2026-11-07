(() => {
  const status = document.getElementById('cloudStatus');
  const button = document.getElementById('cloudLogin');
  const capture = () => JSON.parse(JSON.stringify({cards:progress, days:stats, reset:settings.resetAt || 0}));
  const prefix = KEY + ':cloud:';
  const queuePrefix = prefix + 'event:';
  const readQueue = () => Object.keys(localStorage).filter(k => k.startsWith(queuePrefix))
    .map(k => JSON.parse(localStorage.getItem(k)));
  let before = capture(), lastTime = Number(localStorage.getItem(prefix+'clock')) || 0;
  let upload, auth, api, provider, started = false;
  function enqueue(data) {
    const at = Math.max(Date.now(), lastTime+1);
    const event = {...data, at, id:crypto.randomUUID()};
    localStorage.setItem(queuePrefix+event.id, JSON.stringify(event));
    localStorage.setItem(prefix+'clock', String(at));
    lastTime = at;
    upload?.();
  }
  window.addEventListener('progress-saved', () => {
    const after = capture();
    if (localStorage.getItem(prefix+'owner')) {
      const edit = syncState.patch(before, after);
      if (edit) enqueue(edit);
    }
    before = after;
  });
  if (location.protocol === 'file:') {
    status.textContent = 'Облачная синхронизация доступна в опубликованной версии тренажёра.';
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
        status.textContent = 'Для синхронизации войди на обоих устройствах с одним аккаунтом Google.';
        button.hidden = false;
        return;
      }
      button.hidden = true;
      const owner = localStorage.getItem(prefix+'owner');
      if (owner && owner !== user.uid) {
        status.textContent = 'Прогресс в этом браузере связан с другим аккаунтом. Открой тренажёр в его профиле браузера.';
        return;
      }
      if (started) return;
      started = true;
      if (!owner) {
        enqueue({kind:'seed', ...capture()});
        localStorage.setItem(prefix+'owner', user.uid);
      }
      const collection = dbApi.collection(db,'users',user.uid,'decks',KEY,'events');
      const sending = new Set();
      upload = () => {
        for (const event of readQueue()) {
          if (sending.has(event.id)) continue;
          sending.add(event.id);
          status.textContent = 'Изменения сохранены на устройстве, ожидается синхронизация.';
          dbApi.setDoc(dbApi.doc(collection,event.id),event).then(() => {
            localStorage.removeItem(queuePrefix+event.id);
            if (!readQueue().length) status.textContent = 'Синхронизировано · '+user.email;
          }).catch(e => { status.textContent = 'Ошибка записи. Прогресс сохранён на устройстве. '+e.code; })
            .finally(() => sending.delete(event.id));
        }
      };
      dbApi.onSnapshot(collection,{includeMetadataChanges:true},snapshot => {
        if (snapshot.metadata.fromCache) return;
        const events = new Map(snapshot.docs.map(doc => [doc.id,doc.data()]));
        for (const event of readQueue()) events.set(event.id,event);
        for (const event of events.values()) lastTime = Math.max(lastTime,event.at);
        const result = syncState.replay([...events.values()]);
        if (JSON.stringify(before) !== JSON.stringify(result)) {
          progress = result.cards;
          stats = result.days;
          settings.resetAt = result.reset;
          const today = dayKey(Date.now());
          settings.newDay = {date:today,count:stats[today]?.new || 0};
          before = capture();
          if (current && Object.hasOwn(result.cards,current.id)) flipped = false;
          undoStack = [];
          saveLocal();
          scheduleWrite();
          refreshAll();
        }
        if (!readQueue().length && !snapshot.metadata.hasPendingWrites) status.textContent = 'Синхронизировано · '+user.email;
      }, e => { status.textContent = 'Ошибка чтения облака. '+e.code; });
      upload();
      window.addEventListener('online',upload);
      window.addEventListener('offline',() => {
        status.textContent = 'Сейчас без сети. Ответы сохраняются на этом устройстве.';
      });
    });
  }
  button.onclick = async () => {
    try { await api.signInWithPopup(auth,provider); }
    catch(e) { status.textContent = 'Вход не выполнен. '+e.code; }
  };
  function connect() {
    start().catch(() => {
      status.textContent = 'Облако недоступно. Ответы сохраняются на устройстве. После подключения к сети синхронизация возобновится.';
      window.addEventListener('online',connect,{once:true});
    });
  }
  connect();
})();
