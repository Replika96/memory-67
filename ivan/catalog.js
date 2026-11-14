(() => {
  const status = document.getElementById('catalogStatus');
  const container = document.getElementById('deckCatalog');
  const search = document.getElementById('deckSearch');
  const sort = document.getElementById('deckSort');
  const navigation = document.getElementById('subjectNav');
  const results = document.getElementById('catalogResults');
  const subjects = [
    {id:'italian', title:'Итальянский', color:'#73916a'},
    {id:'english', title:'Английский', color:'#6e91a4'},
    {id:'military', title:'Военный перевод', color:'#a28a57'},
    {id:'finance', title:'Финансы и учёт', color:'#8a80a3'},
    {id:'economics', title:'Экономика и управление', color:'#b08872'},
    {id:'history', title:'История и география', color:'#949375'},
    {id:'other', title:'Другие колоды', color:'#8c9289'},
  ];
  const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const plural = (n, one, few, many) => n%10===1 && n%100!==11 ? one
    : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? few : many;
  const count = (n, forms) => n.toLocaleString('ru-RU')+' '+plural(n,...forms);
  const deckCount = n => count(n,['колода','колоды','колод']);
  const cardCount = n => count(n,['карточка','карточки','карточек']);
  const collator = new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
  const formatter = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'});
  function preference(name, fallback) {
    try {return localStorage.getItem(name) || fallback;} catch {return fallback;}
  }
  function remember(name, value) {
    try {localStorage.setItem(name,value);} catch {}
  }
  let selectedSubject = preference('batman-catalog-subject','all');
  if (!subjects.some(s => s.id===selectedSubject)) selectedSubject = 'all';
  sort.value = preference('batman-catalog-sort','newest');
  if (!sort.value) sort.value = 'newest';
  let catalog = [];
  const key = id => catalog.find(deck => deck.id===id)?.progressKey || 'ivan-anki-' + id + '-progress-v1';
  const statsKey = id => catalog.find(deck => deck.id===id)?.statsKey || 'ivan-anki-'+id+'-stats-v1';
  function compare(a,b) {
    if (sort.value !== 'title') {
      if (a.createdAt == null && b.createdAt != null) return 1;
      if (b.createdAt == null && a.createdAt != null) return -1;
      const difference = (a.createdAt || 0)-(b.createdAt || 0);
      if (difference) return sort.value==='newest' ? -difference : difference;
    }
    return collator.compare(a.displayTitle || a.title || a.name,b.displayTitle || b.title || b.name);
  }
  function sectionTree(sections) {
    const roots = new Map();
    for (const section of sections) {
      const parts = section.name.split('::');
      let nodes = roots;
      for (let i=0;i<parts.length;i++) {
        const name = parts[i], path = parts.slice(0,i+1).join('::');
        if (!nodes.has(name)) nodes.set(name,{name,path,count:0,createdAt:null,children:new Map()});
        const node = nodes.get(name);
        if (i===parts.length-1) Object.assign(node,{count:section.count,createdAt:section.createdAt,url:section.url});
        nodes = node.children;
      }
    }
    return [...roots.values()].flatMap(node => [...node.children.values()]);
  }
  function treeHtml(nodes, url, query, rootMatches) {
    const items = nodes.sort(compare).map(node => {
      const matches = rootMatches || node.path.toLocaleLowerCase().includes(query);
      const children = treeHtml([...node.children.values()],url,query,matches);
      if (!matches && !children) return '';
      const label = node.count ? '<a href="'+esc(node.url || url+'&section='+encodeURIComponent(node.path))+'">'+esc(node.name)+'</a>' : esc(node.name);
      return '<li>'+label+'<span class="tree-count">'+(node.count ? node.count.toLocaleString('ru-RU') : 'пусто')+'</span>'+children+'</li>';
    }).join('');
    return items ? '<ul class="deck-tree">'+items+'</ul>' : '';
  }
  function cardHtml(deck, query, openRoots) {
    const url = deck.url || 'flashcards.html?root='+deck.id;
    const title = deck.displayTitle || deck.title;
    const rootMatches = [deck.title,title].some(s => s.toLocaleLowerCase().includes(query));
    const tree = treeHtml(sectionTree(deck.sections),url,query,rootMatches);
    const date = deck.createdAt ? 'Создана '+formatter.format(deck.createdAt) : 'Дата создания не указана';
    const original = title!==deck.title.trim() ? '<p class="deck-original">'+esc(deck.title)+'</p>' : '';
    return '<article class="catalog-card" data-deck="'+deck.id+'"><time class="deck-date"'+
      (deck.createdAt ? ' datetime="'+new Date(deck.createdAt).toISOString()+'"' : '')+'>'+date+'</time>'+
      '<h3 class="deck-title"><a href="'+url+'">'+esc(title)+'</a></h3>'+original+
      '<div class="deck-card-bottom"><span>'+cardCount(deck.count)+'</span>'+
      (deck.count ? '<a class="deck-study" href="'+url+'">Учить →</a>' : '')+'</div>'+
      (tree ? '<details class="deck-sections" data-root="'+deck.id+'"'+(query || openRoots.has(deck.id) ? ' open' : '')+
        '><summary>Уроки и подколоды</summary>'+tree+'</details>' : '')+'</article>';
  }
  function renderSubjects() {
    navigation.innerHTML = [{id:'all',title:'Все предметы'},...subjects].map(subject => {
      const decks = catalog.filter(d => subject.id==='all' || (d.subject || 'other')===subject.id);
      if (!decks.length) return '';
      return '<button type="button" class="subject-choice" data-subject="'+subject.id+'" style="--subject-color:'+
        (subject.color || '#596753')+'" aria-pressed="'+(selectedSubject===subject.id)+'">'+
        '<span class="subject-mark" aria-hidden="true"></span><span>'+subject.title+'</span>'+
        '<span class="subject-count" aria-label="'+deckCount(decks.length)+'">'+decks.length+'</span></button>';
    }).join('');
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const openRoots = new Set([...container.querySelectorAll('details[data-root][open]')].map(d => d.dataset.root));
    const matching = catalog.filter(deck => (selectedSubject==='all' || (deck.subject || 'other')===selectedSubject) &&
      [deck.title,deck.displayTitle || '',...deck.sections.map(s => s.name)].some(s => s.toLocaleLowerCase().includes(query)));
    container.innerHTML = subjects.filter(s => selectedSubject==='all' || s.id===selectedSubject).map(subject => {
      const decks = matching.filter(d => (d.subject || 'other')===subject.id).sort(compare);
      if (!decks.length) return '';
      return '<section class="subject-section" data-category="'+subject.id+'" style="--subject-color:'+subject.color+'">'+
        '<div class="subject-heading"><h2>'+subject.title+'</h2><span>'+deckCount(decks.length)+'</span></div>'+
        '<div class="catalog-cards">'+decks.map(d => cardHtml(d,query,openRoots)).join('')+'</div></section>';
    }).join('') || '<p class="catalog-empty">Ничего не найдено. Попробуй другой запрос или предмет.</p>';
    results.textContent = deckCount(matching.length)+' · '+cardCount(matching.reduce((n,d)=>n+d.count,0));
    for (const choice of navigation.querySelectorAll('[data-subject]')) choice.setAttribute('aria-pressed',String(choice.dataset.subject===selectedSubject));
  }
  search.oninput = render;
  sort.onchange = () => {remember('batman-catalog-sort',sort.value);render();};
  navigation.onclick = event => {
    const choice = event.target.closest('[data-subject]');
    if (!choice) return;
    selectedSubject = choice.dataset.subject;
    remember('batman-catalog-subject',selectedSubject);
    render();
  };
  document.getElementById('progressImport').onchange = async e => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      if (data.format !== 'ivan-anki-progress-v1' || !data.decks) throw Error('Нужен файл ivan-progress.json');
      const updates = [];
      for (const deck of catalog) {
        const incoming = data.decks[deck.id];
        if (!incoming) continue;
        if (localStorage.getItem(key(deck.id)+':cloud:owner')) throw Error('Для уже синхронизированной колоды используй импорт в её вкладке «Прогресс».');
        const existing = JSON.parse(localStorage.getItem(key(deck.id)) || '{}');
        for (const [id,p] of Object.entries(incoming)) {
          if (!p || !Number.isFinite(p.last) || !Number.isFinite(p.due)) throw Error('Некорректная запись прогресса');
          if (!existing[id] || p.last > existing[id].last) existing[id] = p;
        }
        updates.push([key(deck.id),JSON.stringify(existing)]);
        if (data.stats?.[deck.id]) {
          const storageKey = statsKey(deck.id);
          const stats = JSON.parse(localStorage.getItem(storageKey) || '{}');
          for (const [day,total] of Object.entries(data.stats[deck.id])) {
            if (!Number.isFinite(total.reviews) || !Number.isFinite(total.again)) throw Error('Некорректная статистика');
            if (!stats[day] || total.reviews > stats[day].reviews) stats[day] = total;
          }
          updates.push([storageKey,JSON.stringify(stats)]);
        }
      }
      const previous = updates.map(([name]) => [name,localStorage.getItem(name)]);
      try {
        for (const [name,value] of updates) localStorage.setItem(name,value);
      } catch(error) {
        for (const [name,value] of previous) {
          if (value === null) localStorage.removeItem(name); else localStorage.setItem(name,value);
        }
        throw error;
      }
      status.textContent = 'Прогресс загружен. Можно начинать занятия.';
    } catch(error) { status.textContent = 'Импорт остановлен: '+error.message; }
    e.target.value = '';
  };
  document.getElementById('progressExport').onclick = () => {
    const decks = {}, stats = {};
    for (const deck of catalog) {
      const progress = localStorage.getItem(key(deck.id));
      if (progress) decks[deck.id] = JSON.parse(progress);
      const daily = localStorage.getItem(statsKey(deck.id));
      if (daily) stats[deck.id] = JSON.parse(daily);
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'ivan-anki-progress-v1',decks,stats})],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'ivan-progress.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  Promise.all(['catalog.json','extra-decks.json'].map(path =>
    fetch(path).then(r => {if(!r.ok) throw Error('Каталог недоступен');return r.json();})))
    .then(groups => {
      catalog = groups.flat();
      const total = catalog.reduce((n,d)=>n+d.count,0);
      const nodes = catalog.reduce((n,d)=>n+d.sections.length,0);
      document.getElementById('catalogTotals').innerHTML = '<div><strong>'+total.toLocaleString('ru-RU')+'</strong><span>карточек</span></div>'+
        '<div><strong>'+nodes+'</strong><span>колод и разделов</span></div>';
      document.getElementById('progressImport').disabled = false;
      document.getElementById('progressExport').disabled = false;
      renderSubjects();
      render();
    })
    .catch(e => {results.textContent=e.message;document.getElementById('catalogTotals').textContent='Каталог недоступен';});
})();
