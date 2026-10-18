// Turns tooltip readings (from read_tooltips.py, checked on the Items page) into item and set changes.
// Only English tooltips are imported.

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const statsObj = (lines) => Object.fromEntries(lines.filter((l) => l.value).map((l) => [l.key, l.value]));
const fmtStats = (s) =>
  Object.entries(s || {})
    .sort(([a], [b]) => a.localeCompare(b)) // the same stats in another order are not a change
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'none';
const sameStats = (a = {}, b = {}) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Number(a[k]) === Number(b[k]));
const fmtBonuses = (b) => (b || []).map((t) => `[${t.pieces}] ${fmtStats(t.stats)}${t.effect ? ` · ${t.effect}` : ''}`).join('  ');

function changes(before, after, fields) {
  return fields
    .map(([field, get]) => ({ field, before: before ? get(before) ?? '' : '', after: get(after) ?? '' }))
    .filter((c) => String(c.before) !== String(c.after));
}

/**
 * readings: [{ file, reading } | { file, error }]; reading.target ("new" or an item id) overrides which item it saves to.
 * Returns { sets: [{ key, id?, before?, body, changes }], items: [{ file, id?, before?, body, changes, sameName }],
 * skipped: [{ file, name, reason }] }, where sameName lists the existing items with that name.
 * New sets get key "new:<name>"; item bodies refer to sets by id or by that key until applyPlan saves them.
 */
export function planImport(readings, items, sets) {
  const setPlans = new Map();
  const itemPlans = [];
  const skipped = [];

  for (const { file, reading: r, error } of readings) {
    if (error || !r) {
      skipped.push({ file, name: '', reason: error || 'not read' });
      continue;
    }
    if (r.language !== 'en') {
      skipped.push({ file, name: r.name, reason: r.language === 'fr' ? 'French screenshot' : 'not an English screenshot' });
      continue;
    }
    if (r.kind === 'other') {
      skipped.push({ file, name: r.name, reason: 'not equipment' });
      continue;
    }
    // Several items may share a name (different versions of an item). r.target picks one: "new" adds
    // another, an id updates that item. By default the one with the same stats is updated (the same
    // item seen again); with different stats the tooltip becomes a new item.
    const sameName = items.filter((i) => norm(i.name) === norm(r.name) || (r.existing_item && norm(i.name) === norm(r.existing_item)));
    const existing =
      r.target === 'new' ? null : r.target ? items.find((i) => i.id === r.target) || null : sameName.find((i) => sameStats(i.stats, statsObj(r.stats))) || null;
    let setKey = existing ? existing.set : null;
    if (r.set) {
      // the same set by name, else the set of this item or of items with its name (renamed to the
      // tooltip's name), else a set this import already renames or creates under that name
      const set =
        sets.find((s) => norm(s.name) === norm(r.set.existing_set) || norm(s.name) === norm(r.set.name)) ||
        sets.find((s) => s.id === existing?.set) ||
        sets.find((s) => sameName.some((i) => i.set === s.id));
      const planned = [...setPlans.values()].find((p) => norm(p.body.name) === norm(r.set.name));
      setKey = set ? set.id : planned ? planned.key : `new:${norm(r.set.name)}`;
      if (!setPlans.has(setKey)) {
        const body = {
          ...(set || { cumulative: true, notes: '' }),
          name: r.set.name,
          bonuses: r.set.bonuses.map((t) => ({ pieces: t.pieces, stats: statsObj(t.stats), effect: t.unmapped.join(', ') })),
        };
        setPlans.set(setKey, {
          key: setKey,
          id: set?.id,
          before: set,
          body,
          changes: set ? changes(set, body, [['name', (x) => x.name], ['bonuses', (x) => fmtBonuses(x.bonuses)]]) : [],
        });
      }
    }
    const body = {
      ...(existing || { notes: '', effect: '' }),
      name: r.name,
      slot: r.slot || (r.kind === 'rune' ? 'rune' : existing?.slot || 'artifact'),
      rarity: r.rarity,
      level: r.level,
      stats: statsObj(r.stats),
      set: setKey,
      ...(r.unmapped.length ? { effect: r.unmapped.join(', ') } : {}),
    };
    itemPlans.push({ file, id: existing?.id, before: existing, body, sameName });
  }

  const setName = (key) => setPlans.get(key)?.body.name ?? sets.find((s) => s.id === key)?.name ?? key;
  const itemFields = [
    ['name', (x) => x.name],
    ['slot', (x) => x.slot],
    ['rarity', (x) => x.rarity],
    ['level', (x) => x.level],
    ['stats', (x) => fmtStats(x.stats)],
    ['set', (x) => (x.set ? setName(x.set) : '')],
    ['effect', (x) => x.effect],
  ];
  for (const it of itemPlans) it.changes = it.before ? changes(it.before, it.body, itemFields) : [];
  return { sets: [...setPlans.values()], items: itemPlans, skipped };
}

/** Number of saves the plan would make (unchanged entries are left alone). */
export const planSize = (plan) => [...plan.sets, ...plan.items].filter((x) => !x.before || x.changes.length).length;

/** Saves the plan through the app API. call(method, route, body) must resolve to the JSON reply. */
export async function applyPlan(plan, call) {
  const setIds = new Map();
  for (const s of plan.sets) {
    if (s.before && !s.changes.length) {
      setIds.set(s.key, s.id);
      continue;
    }
    const saved = s.id ? await call('PUT', `/api/sets/${encodeURIComponent(s.id)}`, s.body) : await call('POST', '/api/sets', s.body);
    setIds.set(s.key, saved.id);
  }
  for (const it of plan.items) {
    if (it.before && !it.changes.length) continue;
    const body = { ...it.body, set: it.body.set ? setIds.get(it.body.set) || it.body.set : null };
    if (it.id) await call('PUT', `/api/items/${encodeURIComponent(it.id)}`, body);
    else await call('POST', '/api/items', body);
  }
}
