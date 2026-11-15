// Shared by the offline queue and the Firestore listener.
const syncState = (() => {
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(key => Object.hasOwn(b,key) && equal(a[key],b[key]));
  }
  function changes(before, after) {
    const result = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!equal(before[key], after[key])) {
        result[key] = after[key] ?? null;
      }
    }
    return result;
  }
  function patch(before, after) {
    const cards = changes(before.cards, after.cards);
    const bookmarks = changes(before.bookmarks || {}, after.bookmarks || {});
    const days = {};
    for (const day of Object.keys(changes(before.days, after.days))) {
      const old = before.days[day] || {}, next = after.days[day] || {};
      days[day] = {};
      for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
        const delta = (next[field] || 0) - (old[field] || 0);
        if (delta) days[day][field] = delta;
      }
    }
    if (after.reset > before.reset) return { kind: 'reset', ...after };
    if (Object.keys(cards).length || Object.keys(days).length || Object.keys(bookmarks).length) return {kind:'patch', cards, days, reset:after.reset, ...(Object.keys(bookmarks).length ? {bookmarks} : {})};
  }
  function replay(events) {
    const state = {cards:{}, days:{}, reset:0};
    const versions = new Map();
    const ordered = [...new Map(events.map(event => [event.id,event])).values()]
      .sort((a,b) => a.at-b.at || a.id.localeCompare(b.id));
    for (const event of ordered) {
      if(event.bookmarks){
        const flags = state.bookmarks ||= {};
        for(const [id, value] of Object.entries(event.bookmarks)){
          if(event.kind !== 'seed' || !Object.hasOwn(flags,id)) flags[id] = !!value;
        }
      }
      if (event.at < state.reset || (event.reset != null && event.reset < state.reset)) continue;
      if (event.kind === 'reset' || (event.kind === 'seed' && event.reset > state.reset)) {
        Object.assign(state, {cards:{...event.cards}, days:JSON.parse(JSON.stringify(event.days)), reset:event.reset});
        versions.clear();
        for (const id of Object.keys(state.cards)) versions.set(id,event.at);
        continue;
      }
      if (event.kind === 'seed') {
        // Legacy snapshots have no event provenance. Merge their overlapping day
        // totals by maximum, at their position in history, rather than counting
        // earlier journal entries again. Independent legacy histories cannot be
        // distinguished exactly from overlapping backups.
        for (const [id,card] of Object.entries(event.cards)) {
          const updated = card.last || 0;
          if (updated >= state.reset && (!versions.has(id) || updated > versions.get(id))) {
            state.cards[id] = card;
            versions.set(id,updated);
          }
        }
        for (const [day,total] of Object.entries(event.days)) {
          const current = state.days[day] ||= {};
          for (const [field,value] of Object.entries(total)) current[field] = Math.max(current[field] || 0,value);
        }
        continue;
      }
      for (const [id, card] of Object.entries(event.cards)) {
        if (card) state.cards[id] = card;
        else delete state.cards[id];
        versions.set(id,event.at);
      }
      for (const [day, delta] of Object.entries(event.days)) {
        const total = state.days[day] ||= {};
        for (const [field, n] of Object.entries(delta)) total[field] = Math.max(0, (total[field] || 0) + n);
      }
    }
    return state;
  }
  return {equal, patch, replay};
})();
