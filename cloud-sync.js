(() => {
  const status = document.getElementById('cloudStatus');
  const button = document.getElementById('cloudLogin');
  const studyStatus = document.getElementById('studySync');
  const studyLogin = document.getElementById('studyLogin');
  function report(summary, detail, login = false) {
    status.textContent = detail;
    if (studyStatus) studyStatus.textContent = summary;
    if (studyLogin) studyLogin.hidden = !login;
  }
  if (studyLogin) studyLogin.onclick = () => button.click();
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
      const owner = localStorage.getItem(prefix+'owner');
      if (owner && owner !== user.uid) {
        report('Аккаунт не совпадает', 'Прогресс в этом браузере связан с другим аккаунтом. Открой тренажёр в его профиле браузера.');
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
          report('Сохранено на устройстве · ожидает синхронизации', 'Изменения сохранены на устройстве, ожидается синхронизация.');
          dbApi.setDoc(dbApi.doc(collection,event.id),event).then(() => {
            localStorage.removeItem(queuePrefix+event.id);
            if (navigator.onLine && !readQueue().length) report('Синхронизировано', 'Синхронизировано · '+user.email);
          }).catch(e => { report('Ошибка синхронизации · прогресс на устройстве', 'Ошибка записи. Прогресс сохранён на устройстве. '+e.code); })
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
        if (!readQueue().length && !snapshot.metadata.hasPendingWrites) report('Синхронизировано', 'Синхронизировано · '+user.email);
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
