(() => {
  const status = document.getElementById('catalogStatus');
  const container = document.getElementById('deckCatalog');
  const search = document.getElementById('deckSearch');
  const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let catalog = [];
  const key = id => 'ivan-anki-' + id + '-progress-v1';
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    container.innerHTML = catalog.filter(deck => [deck.title,...deck.sections.map(s => s.name)].some(s => s.toLocaleLowerCase().includes(query)))
      .map(deck => {
        const url = 'flashcards.html?root=' + deck.id;
        const sections = deck.sections.filter(s => !query || deck.title.toLocaleLowerCase().includes(query) || s.name.toLocaleLowerCase().includes(query));
        return '<details class="topic"><summary><b>'+esc(deck.title)+'</b> · '+deck.count+' карточек</summary>'+
          '<p><a href="'+url+'">Учить всю колоду</a></p>'+
          sections.map(s => '<p>'+ (s.count ? '<a href="'+url+'&section='+encodeURIComponent(s.name)+'">'+esc(s.name)+'</a> · '+s.count : esc(s.name)+' · пустая колода')+'</p>').join('')+'</details>';
      }).join('') || '<p>Колода не найдена</p>';
  }
  search.oninput = render;
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
          const statsKey = 'ivan-anki-'+deck.id+'-stats-v1';
          const stats = JSON.parse(localStorage.getItem(statsKey) || '{}');
          for (const [day,total] of Object.entries(data.stats[deck.id])) {
            if (!Number.isFinite(total.reviews) || !Number.isFinite(total.again)) throw Error('Некорректная статистика');
            if (!stats[day] || total.reviews > stats[day].reviews) stats[day] = total;
          }
          updates.push([statsKey,JSON.stringify(stats)]);
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
      const daily = localStorage.getItem('ivan-anki-'+deck.id+'-stats-v1');
      if (daily) stats[deck.id] = JSON.parse(daily);
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'ivan-anki-progress-v1',decks,stats})],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'ivan-progress.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  fetch('catalog.json').then(r => {if(!r.ok) throw Error('Каталог недоступен');return r.json();})
    .then(data => {catalog=data; status.textContent=catalog.reduce((n,d)=>n+d.count,0)+' карточек · '+catalog.length+' основных колод';render();})
    .catch(e => {status.textContent=e.message;});
})();
