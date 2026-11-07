// Shared by the offline queue and the Firestore listener.
const syncState = (() => {
  function changes(before, after) {
    const result = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        result[key] = after[key] ?? null;
      }
    }
    return result;
  }
  function patch(before, after) {
    const cards = changes(before.cards, after.cards);
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
    if (Object.keys(cards).length || Object.keys(days).length) return {kind:'patch', cards, days};
  }
  function replay(events) {
    const state = {cards:{}, days:{}, reset:0};
    // Seeds describe pre-sync history. Overlapping backups must only count once.
    for (const event of events.filter(e => e.kind === 'seed').sort((a,b) => a.reset-b.reset)) {
      if (event.reset > state.reset) Object.assign(state, {cards:{}, days:{}, reset:event.reset});
      for (const [id, card] of Object.entries(event.cards)) {
        if (!state.cards[id] || card.last > state.cards[id].last) state.cards[id] = card;
      }
      for (const [day, stats] of Object.entries(event.days)) {
        if (!state.days[day] || stats.reviews > state.days[day].reviews) state.days[day] = {...stats};
      }
    }
    const edits = events.filter(e => e.kind !== 'seed').sort((a,b) => a.at-b.at || a.id.localeCompare(b.id));
    for (const event of edits) {
      if (event.at < state.reset) continue;
      if (event.kind === 'reset') {
        Object.assign(state, {cards:{...event.cards}, days:JSON.parse(JSON.stringify(event.days)), reset:event.reset});
        continue;
      }
      for (const [id, card] of Object.entries(event.cards)) {
        if (card) state.cards[id] = card;
        else delete state.cards[id];
      }
      for (const [day, delta] of Object.entries(event.days)) {
        const total = state.days[day] ||= {};
        for (const [field, n] of Object.entries(delta)) total[field] = Math.max(0, (total[field] || 0) + n);
      }
    }
    return state;
  }
  return {patch, replay};
})();
