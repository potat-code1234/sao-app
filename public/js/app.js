import {
  STATS, STAT_KEYS, STAT_MAP, SLOT_TYPES, SLOT_TYPE_KEYS, SLOTS, SLOT_MAP,
  RARITIES, RARITY_MAP, PRESETS, DEFAULT_BASE_STATS,
  TEXTURE_PACKS, TEXTURE_MULTI_PREFIXES, TEXTURE_PREFIX_LABELS,
} from './data.js';
import { computeBuild, scoreStats, linearValue, unmetMins, setBonusFor, fmt, fmtStat, fmtDelta, num } from './calc.js';
import { statIcon, slotIcon, uiIcon } from './icons.js';

// ---------------------------------------------------------------- utilities
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function localGet(key) {
  try {
    return localStorage.getItem(`saogear.${key}`);
  } catch {
    return null;
  }
}
function localSet(key, value) {
  try {
    localStorage.setItem(`saogear.${key}`, value);
  } catch {
    /* storage unavailable */
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login'; // session expired or logged out
    throw new Error('Login required');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-bar"></span><span class="toast-msg">${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.classList.add('out'), type === 'err' ? 6000 : 2800);
  setTimeout(() => el.remove(), type === 'err' ? 6500 : 3300);
}

// ---------------------------------------------------------------- state
const NAV = [
  { id: 'equipment', label: 'Equipment', icon: 'equip' },
  { id: 'items', label: 'Items', icon: 'items' },
  { id: 'sets', label: 'Sets', icon: 'sets' },
  { id: 'optimizer', label: 'Optimizer', icon: 'optimizer' },
  { id: 'profile', label: 'Base Stats', icon: 'profile' },
];

function defaultProfile() {
  return {
    version: 1,
    baseStats: { ...DEFAULT_BASE_STATS },
    equipped: {},
    locked: {},
    optimizer: {
      preset: 'balanced',
      weights: { ...PRESETS.balanced.weights },
      mins: {},
      caps: { critChance: 100 },
      onlyOwned: true,
      includeArmor: false,
      allowDuplicates: false,
      respectLocks: true,
      oneOccult: false,
      timeLimitSec: 8,
    },
    builds: [],
  };
}

function normalizeProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  const o = p.optimizer || {};
  return {
    ...d,
    ...p,
    baseStats: { ...d.baseStats, ...(p.baseStats || {}) },
    equipped: { ...(p.equipped || {}) },
    locked: { ...(p.locked || {}) },
    optimizer: {
      ...d.optimizer,
      ...o,
      weights: { ...(o.weights || d.optimizer.weights) },
      mins: { ...(o.mins || {}) },
      caps: { ...(o.caps || d.optimizer.caps) },
    },
    builds: Array.isArray(p.builds) ? p.builds : [],
  };
}

const state = {
  items: [],
  sets: [],
  itemsById: {},
  setsById: {},
  profile: defaultProfile(),
  paths: null,
  errors: [],
  loaded: false,
  view: [location.hash.slice(1), localGet('view')].find((v) => NAV.some((n) => n.id === v)) || 'equipment',
  filters: { q: '', slot: 'all', set: 'all', owned: 'all', sort: 'value' },
  opt: { running: false, progress: null, result: null },
  me: { role: 'admin', auth: false, user: null }, // from /api/me; "viewer" = read-only login
};

const canEdit = () => state.me.role === 'admin';

function indexData() {
  state.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  state.sets.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  state.itemsById = Object.fromEntries(state.items.map((i) => [i.id, i]));
  state.setsById = Object.fromEntries(state.sets.map((s) => [s.id, s]));
}

function upsert(list, obj) {
  const i = list.findIndex((x) => x.id === obj.id);
  if (i >= 0) list[i] = obj;
  else list.push(obj);
  indexData();
}

// The read-only login keeps its own profile (base stats, equipped, optimizer settings) in this browser.
let saveTimer = null;
function saveProfile() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!canEdit()) return localSet('viewerProfile', JSON.stringify(state.profile));
    api('PUT', '/api/profile', state.profile).catch((e) => toast(`Could not save profile: ${e.message}`, 'err'));
  }, 350);
}

const currentBuild = (equipped = state.profile.equipped) =>
  computeBuild(state.profile.baseStats, equipped, state.itemsById, state.setsById);

const rarityOf = (item) => RARITY_MAP[item?.rarity] || RARITY_MAP.common;
// Small textures (Minecraft-style 16x16) are scaled up with crisp pixels.
const PX = ` onload="if(this.naturalWidth<=64)this.classList.add('px')"`;
const imgUrl = (item) => `/item-images/${encodeURIComponent(item.image)}?v=${item.imageVersion || 0}`;
const thumb = (item) =>
  item.image && !item.imageMissing
    ? `<img src="${imgUrl(item)}" alt="" loading="lazy" draggable="false"${PX}>`
    : slotIcon(item.slot);
const sortedTiers = (set) =>
  (Array.isArray(set?.bonuses) ? set.bonuses : []).filter((t) => t && t.pieces > 0).sort((a, b) => a.pieces - b.pieces);

// ---------------------------------------------------------------- shared fragments
const panelHead = (title, right = '') =>
  `<header class="panel-head"><span class="ph-diamond"></span><h2>${title}</h2><div class="ph-right">${right}</div></header>`;

const empty = (msg) => `<div class="empty">${uiIcon('info')}<p>${msg}</p></div>`;

function statChips(stats, { delta = false } = {}) {
  const keys = STAT_KEYS.filter((k) => Number(stats?.[k]));
  if (!keys.length) return '';
  return `<span class="chips">${keys
    .map((k) => {
      const v = Number(stats[k]);
      const cls = delta ? (v > 0 ? 'pos' : 'neg') : '';
      return `<span class="chip ${cls}" style="--c:${STAT_MAP[k].color}"><i>${statIcon(k)}</i>${fmtDelta(k, v)} ${STAT_MAP[k].label}</span>`;
    })
    .join('')}</span>`;
}

function tierRow(t, on) {
  return `<li class="tier ${on ? 'on' : ''}"><span class="tier-n">${t.pieces}</span><span class="tier-body">${
    statChips(t.stats) || (t.effect ? '' : '<span class="muted">No bonus</span>')
  }${t.effect ? `<span class="effect">${esc(t.effect)}</span>` : ''}</span></li>`;
}

function statIco(key, size = '') {
  return `<span class="stat-ico ${size}" style="--c:${STAT_MAP[key].color}">${statIcon(key)}</span>`;
}

// ---------------------------------------------------------------- shell
function renderNav() {
  $('#nav').innerHTML = NAV.map(
    (n) => `<button class="nav-btn" data-nav="${n.id}" title="${n.label}">
      <span class="nav-orb">${uiIcon(n.icon)}</span><span class="nav-label">${n.label}</span></button>`
  ).join('');
}

function renderTopbar() {
  const owned = state.items.filter((i) => i.owned !== false).length;
  const errs = state.errors.length
    ? `<span class="tb-chip warn" title="${esc(state.errors.join('\n'))}">${uiIcon('info')} ${state.errors.length} unreadable file${state.errors.length > 1 ? 's' : ''}</span>`
    : '';
  const who = state.me.auth
    ? `<span class="tb-chip ${canEdit() ? '' : 'ro'}" title="Logged in as ${esc(state.me.user)}">${uiIcon(canEdit() ? 'edit' : 'lock')} ${canEdit() ? 'Admin' : 'Read-only'}</span>`
    : '';
  $('#topbar-status').innerHTML = `
    <span class="tb-chip"><b>${state.items.length}</b> items <span class="muted">(${owned} owned)</span></span>
    <span class="tb-chip"><b>${state.sets.length}</b> sets</span>${errs}${who}`;
  $('#logout').hidden = !state.me.auth;
}

let lastView = null;
function render() {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === state.view));
  const view = $('#view');
  const sameView = lastView === state.view;
  const scrollY = window.scrollY;
  view.innerHTML = VIEWS[state.view]();
  if (sameView) window.scrollTo(0, scrollY);
  else {
    window.scrollTo(0, 0);
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  }
  lastView = state.view;
  renderTopbar();
}

function go(viewId) {
  state.view = viewId;
  localSet('view', viewId);
  if (location.hash.slice(1) !== viewId) history.replaceState(null, '', `#${viewId}`);
  render();
}

// ---------------------------------------------------------------- equipment view
function slotTile(s) {
  const item = state.itemsById[state.profile.equipped[s.id]];
  const locked = !!state.profile.locked[s.id];
  const r = item ? rarityOf(item) : null;
  const hasImg = item && item.image && !item.imageMissing;
  return `<div class="slot-cell" style="grid-area:${s.id}">
    <div class="slot-tile ${item ? 'filled' : ''} ${locked ? 'locked' : ''}" ${r ? `style="--r:${r.color}"` : ''}
      data-action="open-slot" data-slot="${s.id}" tabindex="0" role="button" title="${esc(item ? `${item.name} — ${s.label}` : s.label)}">
      ${hasImg ? `<img class="slot-img" src="${imgUrl(item)}" alt="" draggable="false"${PX}>` : `<span class="slot-glyph">${slotIcon(s.type)}</span>`}
      ${hasImg ? `<span class="slot-badge">${slotIcon(s.type)}</span>` : ''}
      <button class="slot-lock" data-action="toggle-lock" data-slot="${s.id}" title="${locked ? 'Locked: the optimizer keeps this slot as is' : 'Lock this slot for the optimizer'}">${uiIcon(locked ? 'lock' : 'unlock')}</button>
    </div>
    <div class="slot-caption ${item ? '' : 'muted'}">${esc(item ? item.name : s.label)}</div>
  </div>`;
}

function statRow(st, build) {
  const k = st.key;
  const gear = build.gear[k];
  const base = Number(state.profile.baseStats[k]) || 0;
  const tip = `Base ${fmtStat(k, base)}  ·  Items ${fmtDelta(k, build.fromItems[k]) || '0'}  ·  Sets ${fmtDelta(k, build.fromSets[k]) || '0'}`;
  return `<li class="stat-row" title="${tip}">
    ${statIco(k)}
    <span class="stat-label">${st.label}:</span>
    <span class="stat-val">${fmtStat(k, build.total[k])}</span>
    <span class="stat-delta ${gear > 0 ? 'pos' : gear < 0 ? 'neg' : ''}">${fmtDelta(k, gear)}</span>
  </li>`;
}

function renderSetBonusList(build) {
  if (!build.setInfo.length) return empty('No set pieces equipped.');
  return build.setInfo
    .map(({ id, set, count, active }) => {
      if (!set) return `<div class="setb missing"><b>Unknown set “${esc(id)}”</b> <span class="muted">${count} piece(s) — the set file is missing.</span></div>`;
      const pieces = state.items.filter((i) => i.set === id).length;
      return `<div class="setb">
        <div class="setb-head"><span class="setb-name">${esc(set.name)}</span><span class="setb-count">${count}<small>/${pieces}</small></span></div>
        <ul class="tier-list">${sortedTiers(set).map((t) => tierRow(t, active.includes(t))).join('')}</ul>
      </div>`;
    })
    .join('');
}

function renderEffects(build) {
  const rows = [];
  for (const { slot, item } of build.equippedItems) {
    if (item.effect) rows.push(`<li><span class="eff-src">${esc(item.name)}</span><span class="effect">${esc(item.effect)}</span></li>`);
  }
  for (const { set, active } of build.setInfo) {
    for (const t of active) if (t.effect) rows.push(`<li><span class="eff-src">${esc(set.name)} · ${t.pieces}pc</span><span class="effect">${esc(t.effect)}</span></li>`);
  }
  return rows.length ? `<ul class="eff-list">${rows.join('')}</ul>` : '';
}

function renderBuildList() {
  const builds = state.profile.builds;
  if (!builds.length) return empty('Save your current loadout to switch back to it later.');
  const o = state.profile.optimizer;
  return `<ul class="build-list">${builds
    .map((bd, i) => {
      const b = currentBuild(bd.equipped || {});
      return `<li class="build-row">
        <div class="build-info"><b>${esc(bd.name)}</b><small>${b.equippedItems.length} items · score ${fmt(scoreStats(b.total, o))}</small></div>
        <div class="row-actions">
          <button class="btn sm" data-action="load-build" data-index="${i}">Equip</button>
          <button class="icon-btn danger" data-action="delete-build" data-index="${i}" title="Delete build">${uiIcon('trash')}</button>
        </div></li>`;
    })
    .join('')}</ul>`;
}

function renderEquipment() {
  const p = state.profile;
  const build = currentBuild();
  const score = scoreStats(build.total, p.optimizer);
  const unmet = unmetMins(build.total, p.optimizer);
  const effects = renderEffects(build);
  return `<div class="layout-equip">
    <section class="panel panel-equip">
      ${panelHead('Equipment', `<span class="muted">${build.equippedItems.length}/${SLOTS.length}</span>`)}
      <div class="slot-stage"><div class="slot-grid">${SLOTS.map(slotTile).join('')}</div></div>
      <div class="equip-foot">
        <div class="score-box" title="Score of this build with the optimizer weights">
          <span class="score-label">Build score</span><span class="score-val">${fmt(score)}</span>
          ${unmet.length ? `<span class="score-warn" title="${esc(unmet.map((u) => `${STAT_MAP[u.key].label}: ${fmt(u.have)} / ${fmt(u.need)}`).join('\n'))}">${unmet.length} min not met</span>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn" data-action="unequip-all">Unequip all</button>
          <button class="btn btn-primary" data-action="save-build">${uiIcon('save')} Save build</button>
        </div>
      </div>
      <p class="hint pad">Click a slot to equip an item. ${uiIcon('lock')} locks a slot so the optimizer keeps it.</p>
    </section>
    <section class="panel panel-status">
      ${panelHead('Status', '<span class="muted">total · <span class="pos">gear</span></span>')}
      ${
        STAT_KEYS.some((k) => Number(p.baseStats[k]))
          ? ''
          : `<div class="base-missing">${uiIcon('info')}<span>Base stats are empty — totals show gear only.</span>
              <button class="btn sm" data-nav="profile">Enter base stats</button></div>`
      }
      <ul class="stat-list">${STATS.filter((st) => !st.extra || build.total[st.key] || build.gear[st.key])
        .map((st) => statRow(st, build))
        .join('')}</ul>
    </section>
    <div class="col-stack">
      <section class="panel">${panelHead('Set bonuses')}<div class="panel-body">${renderSetBonusList(build)}</div></section>
      ${effects ? `<section class="panel">${panelHead('Special effects')}<div class="panel-body">${effects}</div></section>` : ''}
      <section class="panel">${panelHead('Saved builds')}<div class="panel-body">${renderBuildList()}</div></section>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- items view
function filteredItems() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const w = state.profile.optimizer.weights;
  const list = state.items.filter((it) => {
    if (f.slot !== 'all' && it.slot !== f.slot) return false;
    if (f.set === 'none' && it.set) return false;
    if (f.set !== 'all' && f.set !== 'none' && it.set !== f.set) return false;
    if (f.owned === 'owned' && it.owned === false) return false;
    if (f.owned === 'missing' && it.owned !== false) return false;
    if (q) {
      const hay = [it.name, it.effect, it.notes, state.setsById[it.set]?.name, SLOT_TYPES[it.slot]?.label, rarityOf(it).label]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const rIdx = (it) => RARITIES.indexOf(rarityOf(it));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const sorters = {
    value: (a, b) => linearValue(b.stats, w) - linearValue(a.stats, w) || byName(a, b),
    name: byName,
    slot: (a, b) => SLOT_TYPE_KEYS.indexOf(a.slot) - SLOT_TYPE_KEYS.indexOf(b.slot) || byName(a, b),
    rarity: (a, b) => rIdx(b) - rIdx(a) || byName(a, b),
  };
  return list.sort(sorters[f.sort] || sorters.value);
}

function itemCard(it) {
  const r = rarityOf(it);
  const set = it.set ? state.setsById[it.set] : null;
  const val = linearValue(it.stats, state.profile.optimizer.weights);
  const where = SLOTS.filter((s) => state.profile.equipped[s.id] === it.id).map((s) => s.label);
  const id = esc(it.id);
  return `<article class="item-card ${it.owned === false ? 'not-owned' : ''}" style="--r:${r.color}">
    <div class="item-thumb">${thumb(it)}</div>
    <div class="item-main">
      <div class="item-top">
        <h3 class="item-name" title="${esc(it.name)}">${esc(it.name)}</h3>
        <span class="item-value" title="Value with the current optimizer weights">${fmt(val)}</span>
        <button class="owned-toggle ${it.owned !== false ? 'on' : ''}" data-action="toggle-owned" data-id="${id}" title="${it.owned !== false ? 'Owned — click to mark as not owned' : 'Not owned — click to mark as owned'}">${uiIcon('check')}</button>
      </div>
      <div class="item-meta">
        <span class="tag">${SLOT_TYPES[it.slot]?.label || esc(it.slot || 'No slot')}</span>
        <span class="tag rarity">${r.label}</span>
        ${set ? `<span class="tag set">${esc(set.name)}</span>` : it.set ? '<span class="tag warn">missing set</span>' : ''}
        ${where.length ? `<span class="tag eq">Equipped · ${where.join(', ')}</span>` : ''}
        ${it.owned === false ? '<span class="tag dim">not owned</span>' : ''}
      </div>
      ${statChips(it.stats) || '<span class="muted small">No stats</span>'}
      ${it.effect ? `<p class="effect">${esc(it.effect)}</p>` : ''}
    </div>
    <div class="item-actions">
      <button class="btn sm ghost" data-action="equip-item" data-id="${id}" title="Equip in a matching slot">${uiIcon('equip')} Equip</button>
      <span class="spacer"></span>
      <button class="icon-btn sm admin-only" data-action="edit-item" data-id="${id}" title="Edit">${uiIcon('edit')}</button>
      <button class="icon-btn sm admin-only" data-action="dup-item" data-id="${id}" title="Duplicate">${uiIcon('copy')}</button>
      <button class="icon-btn sm danger admin-only" data-action="delete-item" data-id="${id}" title="Delete">${uiIcon('trash')}</button>
    </div>
  </article>`;
}

function renderItemList() {
  if (!state.items.length) {
    return empty('No items yet. Click <b>New item</b> to add your first accessory — it is saved as a JSON file in <code>Items/Accessories</code>.');
  }
  const list = filteredItems();
  if (!list.length) return empty('No items match these filters.');
  return list.map(itemCard).join('');
}

function renderItems() {
  const f = state.filters;
  const counts = {};
  for (const it of state.items) counts[it.slot] = (counts[it.slot] || 0) + 1;
  return `<div class="layout-single">
    <section class="panel">
      ${panelHead('Item storage', `<button class="btn btn-primary admin-only" data-action="new-item">${uiIcon('plus')} New item</button>`)}
      <div class="toolbar">
        <label class="search">${uiIcon('search')}<input id="item-search" data-filter="q" value="${esc(f.q)}" placeholder="Search name, set, effect…"></label>
        <select data-filter="set" title="Set">
          <option value="all">All sets</option><option value="none" ${f.set === 'none' ? 'selected' : ''}>No set</option>
          ${state.sets.map((s) => `<option value="${esc(s.id)}" ${f.set === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
        <select data-filter="owned" title="Owned">
          <option value="all">Owned + not owned</option>
          <option value="owned" ${f.owned === 'owned' ? 'selected' : ''}>Owned only</option>
          <option value="missing" ${f.owned === 'missing' ? 'selected' : ''}>Not owned</option>
        </select>
        <select data-filter="sort" title="Sort">
          ${[['value', 'Sort: value'], ['name', 'Sort: name'], ['slot', 'Sort: slot'], ['rarity', 'Sort: rarity']]
            .map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </div>
      <div class="seg slot-filter">
        <button class="seg-btn ${f.slot === 'all' ? 'on' : ''}" data-action="filter-slot" data-value="all">All <small>${state.items.length}</small></button>
        ${SLOT_TYPE_KEYS.map(
          (t) => `<button class="seg-btn ${f.slot === t ? 'on' : ''}" data-action="filter-slot" data-value="${t}">
            <i>${slotIcon(t)}</i>${SLOT_TYPES[t].label}<small>${counts[t] || 0}</small></button>`
        ).join('')}
      </div>
      <div id="item-list" class="item-grid">${renderItemList()}</div>
    </section>
  </div>`;
}

function refreshItemList() {
  const el = $('#item-list');
  if (el) el.innerHTML = renderItemList();
}

// ---------------------------------------------------------------- sets view
function setCard(set) {
  const pieces = state.items.filter((i) => i.set === set.id);
  const eqCount = currentBuild().setInfo.find((s) => s.id === set.id)?.count || 0;
  const { active } = setBonusFor(set, eqCount);
  const id = esc(set.id);
  return `<article class="set-card">
    <header class="set-card-head">
      <div><h3>${esc(set.name)}</h3>
        <span class="muted">${pieces.length} piece${pieces.length === 1 ? '' : 's'} · ${set.cumulative !== false ? 'bonuses stack' : 'highest tier only'} · ${eqCount} equipped</span></div>
      <div class="row-actions admin-only">
        <button class="icon-btn" data-action="new-item-in-set" data-id="${id}" title="Add an item to this set">${uiIcon('plus')}</button>
        <button class="icon-btn" data-action="edit-set" data-id="${id}" title="Edit set">${uiIcon('edit')}</button>
        <button class="icon-btn danger" data-action="delete-set" data-id="${id}" title="Delete set">${uiIcon('trash')}</button>
      </div>
    </header>
    <div class="set-pieces">${
      pieces
        .map(
          (p) => `<button class="piece" style="--r:${rarityOf(p).color}" data-action="edit-item" data-id="${esc(p.id)}" title="${esc(p.name)} (${SLOT_TYPES[p.slot]?.label || p.slot})">
          <span class="piece-thumb">${thumb(p)}</span><span class="piece-name">${esc(p.name)}</span></button>`
        )
        .join('') || '<span class="muted small">No items in this set yet.</span>'
    }</div>
    <ul class="tier-list">${sortedTiers(set).map((t) => tierRow(t, active.includes(t))).join('') || '<li class="muted small">No bonuses defined.</li>'}</ul>
  </article>`;
}

function renderSets() {
  return `<div class="layout-single">
    <section class="panel">
      ${panelHead('Sets', `<button class="btn btn-primary admin-only" data-action="new-set">${uiIcon('plus')} New set</button>`)}
      <div class="set-grid">${state.sets.length ? state.sets.map(setCard).join('') : empty('No sets yet. Create one here or straight from the item editor. Sets are saved in <code>Items/Sets</code>.')}</div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------- optimizer view
function optimizeSlotFilter() {
  const o = state.profile.optimizer;
  return (s) => {
    if (!o.includeArmor && SLOT_TYPES[s.type].group === 'armor') return false;
    if (o.respectLocks && state.profile.locked[s.id]) return false;
    return true;
  };
}

// Occult (Shadow Neophyte) pieces: wearing 2+ costs health regen and halves healing received.
const isOccult = (it) => /occult/i.test(it.name) || /occult|shadow neophyte/i.test(state.setsById[it.set]?.name || '');

function buildOptPayload() {
  const p = state.profile;
  const o = p.optimizer;
  const isOpt = optimizeSlotFilter();
  const slots = SLOTS.filter(isOpt).map((s) => ({ id: s.id, type: s.type }));
  const fixed = SLOTS.filter((s) => !isOpt(s))
    .map((s) => ({ slot: s.id, item: state.itemsById[p.equipped[s.id]] }))
    .filter((f) => f.item);
  const fixedIds = new Set(fixed.map((f) => f.item.id));
  const types = new Set(slots.map((s) => s.type));
  const slim = (it) => ({ id: it.id, slot: it.slot, set: it.set || null, stats: it.stats || {} });
  const items = state.items
    .filter((it) => types.has(it.slot) && (!o.onlyOwned || it.owned !== false) && (!fixedIds.has(it.id) || (o.allowDuplicates && wornTwice(it.slot))))
    .map(slim);
  const occultIds = o.oneOccult ? state.items.filter(isOccult).map((it) => it.id) : [];
  return {
    base: p.baseStats,
    fixed: fixed.map((f) => ({ slot: f.slot, item: slim(f.item) })),
    slots,
    items,
    sets: state.sets.map((s) => ({ id: s.id, cumulative: s.cumulative, bonuses: s.bonuses })),
    weights: o.weights,
    mins: o.mins,
    caps: o.caps,
    allowDuplicates: !!o.allowDuplicates,
    limits: occultIds.length ? [{ items: occultIds, max: 1 }] : [],
    topK: 5,
    timeLimitMs: Math.max(1, Number(o.timeLimitSec) || 8) * 1000,
  };
}

function optSummary() {
  const pl = buildOptPayload();
  const fixedCount = pl.fixed.length;
  return `<b>${pl.slots.length}</b> slot${pl.slots.length === 1 ? '' : 's'} to fill from <b>${pl.items.length}</b> candidate item${pl.items.length === 1 ? '' : 's'}${
    fixedCount ? ` · <b>${fixedCount}</b> kept as equipped` : ''
  }${pl.limits.length ? ' · max <b>1</b> Occult item' : ''}`;
}

function toggle(flag, label, checked, hint = '') {
  return `<label class="toggle" ${hint ? `title="${esc(hint)}"` : ''}><input type="checkbox" data-optflag="${flag}" ${checked ? 'checked' : ''}><span class="toggle-ui"></span><span>${label}</span></label>`;
}

// Weight = slider (0 to WEIGHT_MAX) plus a number box for exact or out-of-range values.
const WEIGHT_MAX = 5;
const weightPct = (v) => (Math.min(Math.max(Number(v) || 0, 0), WEIGHT_MAX) / WEIGHT_MAX) * 100;

function weightSlider(key, value) {
  const label = esc(STAT_MAP[key].label);
  return `<div class="wt-slider" style="--p:${weightPct(value)}%">
    <input type="range" min="0" max="${WEIGHT_MAX}" step="0.05" data-opt="weights" data-key="${key}" value="${Math.max(0, Number(value) || 0)}" aria-label="${label} weight">
    <input type="number" step="0.05" data-opt="weights" data-key="${key}" value="${value ?? ''}" placeholder="0" aria-label="${label} weight value">
  </div>`;
}

function renderOptimizer() {
  const o = state.profile.optimizer;
  const val = (obj, k) => (obj?.[k] === undefined || obj?.[k] === null ? '' : esc(obj[k]));
  return `<div class="layout-opt">
    <section class="panel panel-weights">
      ${panelHead('Priorities')}
      <div class="panel-body">
        <div class="seg preset-row">
          ${Object.entries(PRESETS).map(([k, pr]) => `<button class="seg-btn ${o.preset === k ? 'on' : ''}" data-action="preset" data-value="${k}">${pr.label}</button>`).join('')}
          <span class="seg-btn passive ${o.preset === 'custom' ? 'on' : ''}" data-preset-custom>Custom</span>
        </div>
        <p class="hint"><b>Weight</b> = what 1 point of the stat is worth to you (0 = ignore). <b>Min</b> = the build must reach this total.
          <b>Cap</b> = points above this total are worth nothing (e.g. crit chance at 100).</p>
        <table class="weights">
          <thead><tr><th>Stat</th><th>Weight</th><th>Min</th><th>Cap</th></tr></thead>
          <tbody>${STATS.map(
            (st) => `<tr class="${Number(o.weights?.[st.key]) ? '' : 'off'}">
              <td><span class="wt-stat">${statIco(st.key, 'sm')}${st.label}</span></td>
              <td class="wt-cell">${weightSlider(st.key, o.weights?.[st.key])}</td>
              <td><input type="number" step="any" data-opt="mins" data-key="${st.key}" value="${val(o.mins, st.key)}" placeholder="—"></td>
              <td><input type="number" step="any" data-opt="caps" data-key="${st.key}" value="${val(o.caps, st.key)}" placeholder="—"></td>
            </tr>`
          ).join('')}</tbody>
        </table>
      </div>
    </section>
    <div class="col-stack">
      <section class="panel">
        ${panelHead('Search')}
        <div class="panel-body opt-options">
          ${toggle('onlyOwned', 'Only use items I own', o.onlyOwned)}
          ${toggle('includeArmor', 'Also optimize armor &amp; offhand', o.includeArmor, 'When off, helmet/chest/legs/boots/offhand stay as currently equipped')}
          ${toggle('respectLocks', 'Keep locked slots as they are', o.respectLocks)}
          ${toggle('allowDuplicates', 'Allow the same ring twice', o.allowDuplicates, 'Rings are the only items you can wear twice. Turn on if you own two copies of a ring.')}
          ${state.items.some(isOccult) ? toggle('oneOccult', 'Only one Occult item', o.oneOccult, 'Wearing 2+ Shadow Neophyte pieces costs 0.6/s health regen per piece and halves healing received') : ''}
          <label class="field inline-field"><span>Time limit (s)</span><input type="number" min="1" max="120" data-optnum="timeLimitSec" value="${esc(o.timeLimitSec)}"></label>
          <div class="opt-summary" id="opt-summary">${optSummary()}</div>
          <button class="btn btn-primary btn-xl" data-action="run-opt" ${state.opt.running ? 'disabled' : ''}>${uiIcon('play')} Find best gear</button>
        </div>
      </section>
      <section class="panel">
        ${panelHead('Results', '<span class="muted">top 5 builds</span>')}
        <div class="panel-body" id="opt-results">${renderOptResults()}</div>
      </section>
    </div>
  </div>`;
}

function resultEquipped(res) {
  const eq = { ...state.profile.equipped };
  for (const pk of res.picks) eq[pk.slot] = pk.itemId;
  return eq;
}

function resultCard(res, i, cur, curScore) {
  const o = state.profile.optimizer;
  const eq = resultEquipped(res);
  const b = currentBuild(eq);
  const score = scoreStats(b.total, o);
  const diff = score - curScore;
  const unmet = unmetMins(b.total, o);
  const deltas = {};
  for (const k of STAT_KEYS) deltas[k] = b.total[k] - cur.total[k];
  const changed = res.picks.filter((pk) => (state.profile.equipped[pk.slot] || null) !== pk.itemId).length;
  const slotRows = res.picks
    .map((pk) => {
      const it = state.itemsById[pk.itemId];
      const isChanged = (state.profile.equipped[pk.slot] || null) !== pk.itemId;
      return `<li class="rs ${isChanged ? 'changed' : ''}" ${it ? `style="--r:${rarityOf(it).color}"` : ''}>
        <span class="rs-thumb">${it ? thumb(it) : slotIcon(SLOT_MAP[pk.slot].type)}</span>
        <span class="rs-slot">${SLOT_MAP[pk.slot].label}</span>
        <span class="rs-name">${it ? esc(it.name) : '<span class="muted">empty</span>'}</span>
      </li>`;
    })
    .join('');
  const sets = b.setInfo
    .filter((s) => s.set && s.active.length)
    .map((s) => `<span class="tag set">${esc(s.set.name)} ${s.count}pc</span>`)
    .join('');
  return `<article class="result ${i === 0 ? 'best' : ''}">
    <header class="result-head">
      <span class="rank">${i + 1}</span>
      <div class="result-score"><b>${fmt(score)}</b><span class="${diff > 0.0001 ? 'pos' : diff < -0.0001 ? 'neg' : 'muted'}">${diff >= 0 ? '+' : ''}${fmt(diff)} vs current</span></div>
      <span class="muted small">${changed ? `${changed} change${changed > 1 ? 's' : ''}` : 'same as current'}</span>
      <button class="btn btn-primary sm" data-action="equip-result" data-index="${i}">Equip</button>
    </header>
    ${unmet.length ? `<div class="warn-line">Misses min: ${unmet.map((u) => `${STAT_MAP[u.key].label} ${fmt(u.have)}/${fmt(u.need)}`).join(', ')}</div>` : ''}
    <ul class="result-slots">${slotRows}</ul>
    ${sets ? `<div class="result-sets">${sets}</div>` : ''}
    <div class="result-deltas">${statChips(deltas, { delta: true }) || '<span class="muted small">No stat change</span>'}</div>
  </article>`;
}

function renderOptResults() {
  const s = state.opt;
  if (s.running) {
    const pg = s.progress;
    return `<div class="scanning">
      <div class="scan-ring"></div>
      <p>Scanning combinations…${pg ? `<br><small>${pg.nodes.toLocaleString()} nodes · ${(pg.elapsed / 1000).toFixed(1)} s${pg.best !== null ? ` · best ${fmt(pg.best)}` : ''}</small>` : ''}</p>
      <button class="btn sm" data-action="cancel-opt">Cancel</button>
    </div>`;
  }
  if (!s.result) return empty('Set your priorities, then press <b>Find best gear</b>. The 5 best builds appear here.');
  const r = s.result;
  if (!r.results.length) return empty('No build found. Do you have candidate items for the slots being optimized?');
  const cur = currentBuild();
  const curScore = scoreStats(cur.total, state.profile.optimizer);
  const notes = [];
  if (r.relaxed) notes.push('<div class="warn-line">No build can reach every <b>Min</b> — showing the best builds without them.</div>');
  if (r.truncated) notes.push('<div class="warn-line">Time limit reached — these are the best builds found so far. Raise the time limit for an exhaustive search.</div>');
  return `<p class="search-meta">${r.truncated ? 'Partial' : 'Exhaustive'} search · ${r.nodes.toLocaleString()} nodes in ${fmt(r.elapsed)} ms · ${r.candidateCount} candidates${
    r.pruned ? ` (${r.pruned} skipped as strictly worse)` : ''
  }</p>${notes.join('')}${r.results.map((res, i) => resultCard(res, i, cur, curScore)).join('')}`;
}

function refreshOptResults() {
  const el = $('#opt-results');
  if (el) el.innerHTML = renderOptResults();
  const btn = $('[data-action="run-opt"]');
  if (btn) btn.disabled = state.opt.running;
}

let worker = null;
let jobId = 0;
function runOptimizer() {
  if (state.opt.running) return;
  const o = state.profile.optimizer;
  const payload = buildOptPayload();
  if (!payload.slots.length) return toast('Nothing to optimize — every slot is locked or excluded.', 'warn');
  if (!payload.items.length) return toast('No candidate items. Add items (and mark them as owned) first.', 'warn');
  if (!STAT_KEYS.some((k) => Number(o.weights[k]))) toast('All weights are 0 — every build will score the same.', 'warn');
  if (!worker) worker = new Worker('js/optimizer.js', { type: 'module' });
  const id = ++jobId;
  state.opt = { running: true, progress: null, result: null };
  refreshOptResults();
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.type === 'progress') {
      state.opt.progress = m;
      refreshOptResults();
    } else if (m.type === 'done') {
      state.opt = { running: false, progress: null, result: m.result };
      refreshOptResults();
    } else if (m.type === 'error') {
      state.opt = { running: false, progress: null, result: null };
      refreshOptResults();
      toast(`Optimizer error: ${m.message}`, 'err');
    }
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    worker?.terminate();
    worker = null;
    state.opt = { running: false, progress: null, result: null };
    refreshOptResults();
    toast(`Optimizer crashed: ${e.message || 'unknown error'}`, 'err');
  };
  worker.postMessage({ id, payload });
}

function cancelOptimizer() {
  worker?.terminate();
  worker = null;
  state.opt = { running: false, progress: null, result: null };
  refreshOptResults();
}

// ---------------------------------------------------------------- profile view
function renderProfile() {
  const b = state.profile.baseStats;
  const paths = state.paths;
  return `<div class="layout-profile">
    <section class="panel">
      ${panelHead('Base stats', '<span class="muted">your stats with no gear</span>')}
      <div class="panel-body">
        <p class="hint">Enter your character's stats <b>without</b> any of the gear tracked here — they depend on your class and the
          points in your skill tree. Update them whenever you switch class or respec. Changes save automatically.</p>
        <div class="stat-inputs">${STATS.map(
          (st) => `<label class="stat-input">${statIco(st.key, 'sm')}<span class="si-label">${st.label}</span>
            <input type="number" step="any" data-base="${st.key}" value="${Number(b[st.key]) ? esc(b[st.key]) : ''}" placeholder="0"><em>${st.unit}</em></label>`
        ).join('')}</div>
      </div>
    </section>
    <section class="panel">
      ${panelHead('Data files')}
      <div class="panel-body">
        <p class="hint">Everything is stored as plain JSON next to the app — you can edit, back up or share these folders. Press <b>Reload</b> after editing files by hand.</p>
        ${
          paths
            ? `<dl class="paths">
          <dt>Items</dt><dd><code>${esc(paths.items)}</code></dd>
          <dt>Item images</dt><dd><code>${esc(paths.images)}</code></dd>
          <dt>Textures</dt><dd><code>${esc(paths.textures)}</code></dd>
          <dt>Sets</dt><dd><code>${esc(paths.sets)}</code></dd>
          <dt>Profile</dt><dd><code>${esc(paths.profile)}</code></dd></dl>`
            : ''
        }
        ${state.errors.length ? `<div class="warn-line">Could not read:<br>${state.errors.map(esc).join('<br>')}</div>` : ''}
      </div>
    </section>
  </div>`;
}

const VIEWS = {
  equipment: renderEquipment,
  items: renderItems,
  sets: renderSets,
  optimizer: renderOptimizer,
  profile: renderProfile,
};

// ---------------------------------------------------------------- modals
const modalStack = [];

function openModal(html, cls = '', { dismissable = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal-backdrop"></div><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').appendChild(wrap);
  const entry = { wrap, modal: wrap.querySelector('.modal'), onClose: null, onPaste: null };
  modalStack.push(entry);
  if (dismissable) wrap.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(entry));
  entry.modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal(entry);
  });
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    const f = entry.modal.querySelector('[autofocus]') || entry.modal.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
    f?.focus();
  });
  return entry;
}

function closeModal(entry = modalStack[modalStack.length - 1]) {
  const i = modalStack.indexOf(entry);
  if (i < 0) return;
  modalStack.splice(i, 1);
  entry.onClose?.();
  entry.wrap.classList.add('closing');
  setTimeout(() => entry.wrap.remove(), 200);
  if (!modalStack.length) document.body.classList.remove('modal-open');
}

function confirmDialog(title, messageHtml) {
  return new Promise((resolve) => {
    let ok = false;
    const entry = openModal(
      `<div class="sao-dialog">
        <div class="sao-dialog-title">${esc(title)}</div>
        <div class="sao-dialog-msg">${messageHtml}</div>
        <div class="sao-dialog-btns">
          <button class="sao-round ok" data-yes title="Confirm" autofocus><span class="ring"></span></button>
          <button class="sao-round no" data-close title="Cancel">${uiIcon('close')}</button>
        </div>
      </div>`,
      'modal-dialog',
      { dismissable: true }
    );
    entry.modal.querySelector('[data-yes]').addEventListener('click', () => {
      ok = true;
      closeModal(entry);
    });
    entry.onClose = () => resolve(ok);
  });
}

function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    let result = null;
    const entry = openModal(
      `<div class="sao-dialog">
        <div class="sao-dialog-title">${esc(title)}</div>
        <form class="sao-dialog-msg" data-form><label class="field"><span>${esc(label)}</span><input name="v" value="${esc(value)}" autofocus required></label></form>
        <div class="sao-dialog-btns">
          <button class="sao-round ok" data-yes title="OK"><span class="ring"></span></button>
          <button class="sao-round no" data-close title="Cancel">${uiIcon('close')}</button>
        </div>
      </div>`,
      'modal-dialog',
      { dismissable: true }
    );
    const form = entry.modal.querySelector('[data-form]');
    const submit = () => {
      const v = form.elements.v.value.trim();
      if (!v) return form.elements.v.focus();
      result = v;
      closeModal(entry);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    entry.modal.querySelector('[data-yes]').addEventListener('click', submit);
    entry.onClose = () => resolve(result);
  });
}

// ---- image helper: read a File/Blob, shrink big images, return a data URL
async function fileToDataUrl(file) {
  const url = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Could not read file'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('That file is not an image'));
    i.src = url;
  });
  const MAX = 256;
  if (img.naturalWidth <= MAX && img.naturalHeight <= MAX && /^data:image\/(png|jpeg|gif|webp);/.test(url)) return url;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ---- texture picker: textures copied from the server resource pack by import-textures.js
let texturePacks = null; // cached GET /api/textures, cleared on reload
const texUrl = (id) => `/textures/${id.split('/').map(encodeURIComponent).join('/')}.png`;

function texturePrefix(name) {
  const multi = TEXTURE_MULTI_PREFIXES.find((p) => name === p || name.startsWith(`${p}_`));
  return multi || name.split('_')[0].replace(/\d+$/, '') || name;
}

function prefixLabel(pre) {
  const label = TEXTURE_PREFIX_LABELS[pre];
  return label && label.toLowerCase() !== pre ? label : '';
}

// Packs in TEXTURE_PACKS order, each split into prefix groups sorted A–Z.
async function loadTextureGroups() {
  if (!texturePacks) texturePacks = (await api('GET', '/api/textures')).packs || [];
  const order = Object.keys(TEXTURE_PACKS);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...texturePacks]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map((p) => {
      const groups = new Map();
      for (const name of p.textures) {
        const pre = texturePrefix(name);
        if (!groups.has(pre)) groups.set(pre, []);
        groups.get(pre).push(name);
      }
      return {
        id: p.id,
        label: TEXTURE_PACKS[p.id] || p.id,
        groups: [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pre, names]) => ({
            key: `${p.id}:${pre}`,
            pre,
            label: prefixLabel(pre),
            names: names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
          })),
      };
    });
}

async function openTexturePicker(current, onPick) {
  let packs;
  try {
    packs = await loadTextureGroups();
  } catch (e) {
    return toast(`Could not load textures: ${e.message}`, 'err');
  }
  const entry = openModal(
    `<header class="modal-head"><span class="ph-diamond"></span><h2>Textures</h2>
      <div class="ph-right"><button class="icon-btn" data-close title="Close">${uiIcon('close')}</button></div></header>
    <div class="picker-tools">
      <label class="search">${uiIcon('search')}<input data-q placeholder="Search textures… e.g. anneau, gloves, onyx" autofocus></label>
    </div>
    <div class="tex-layout">
      <nav class="tex-side" aria-label="Texture prefixes"></nav>
      <div class="modal-body tex-main"></div>
    </div>`,
    'modal-textures',
    { dismissable: true }
  );
  const m = entry.modal;
  const side = m.querySelector('.tex-side');
  const main = m.querySelector('.tex-main');
  let q = '';

  const paint = () => {
    const hit = (p, g, name) => !q || `${name} ${g.label} ${p.label}`.toLowerCase().includes(q);
    const shown = packs
      .map((p) => ({ ...p, groups: p.groups.map((g) => ({ ...g, names: g.names.filter((n) => hit(p, g, n)) })).filter((g) => g.names.length) }))
      .filter((p) => p.groups.length);
    if (!shown.length) {
      side.innerHTML = '';
      main.innerHTML = empty(
        packs.length ? 'No textures match the search.' : 'No textures found. Run <code>node import-textures.js</code> in the app folder, then try again.'
      );
      return;
    }
    side.innerHTML = shown
      .map(
        (p) => `<div class="tex-pack">${esc(p.label)}</div>${p.groups
          .map(
            (g) => `<button type="button" class="tex-pre" data-jump="${esc(g.key)}"><span>${esc(g.pre)}</span>${g.label ? `<em>${esc(g.label)}</em>` : ''}<small>${g.names.length}</small></button>`
          )
          .join('')}`
      )
      .join('');
    main.innerHTML = shown
      .map(
        (p) => `<h3 class="tex-pack-head">${esc(p.label)}</h3>${p.groups
          .map(
            (g) => `<section class="tex-group" data-group="${esc(g.key)}">
              <div class="section-label">${esc(g.pre)}${g.label ? ` <small>${esc(g.label)}</small>` : ''}<span class="spacer"></span><small>${g.names.length}</small></div>
              <div class="tex-grid">${g.names
                .map((n) => {
                  const id = `${p.id}/${n}`;
                  return `<button type="button" class="tex-cell${id === current ? ' current' : ''}" data-tex="${esc(id)}" title="${esc(n)}">
                    <img src="${texUrl(id)}" alt="" loading="lazy" draggable="false"><span>${esc(n.replace(/_/g, ' '))}</span></button>`;
                })
                .join('')}</div>
            </section>`
          )
          .join('')}`
      )
      .join('');
  };

  // Highlight the prefix whose group is at the top of the grid, and keep it visible in the sidebar.
  const reveal = (el) => {
    if (el.offsetTop < side.scrollTop) side.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > side.scrollTop + side.clientHeight) side.scrollTop = el.offsetTop + el.offsetHeight - side.clientHeight;
    if (el.offsetLeft < side.scrollLeft) side.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > side.scrollLeft + side.clientWidth) side.scrollLeft = el.offsetLeft + el.offsetWidth - side.clientWidth;
  };
  let syncQueued = false;
  const syncSide = () => {
    syncQueued = false;
    const y = main.scrollTop + 12;
    const cur = $$('[data-group]', main).find((g) => g.offsetTop + g.offsetHeight > y);
    let on = null;
    for (const b of $$('.tex-pre', side)) {
      b.classList.toggle('on', b.dataset.jump === cur?.dataset.group);
      if (b.dataset.jump === cur?.dataset.group) on = b;
    }
    if (on) reveal(on);
  };
  const groupEl = (key) => $$('[data-group]', main).find((g) => g.dataset.group === key);

  paint();
  const cur = main.querySelector('.tex-cell.current');
  const last = groupEl(localGet('texGroup'));
  if (cur) main.scrollTop = cur.offsetTop - main.clientHeight / 2 + cur.offsetHeight / 2;
  else if (last) main.scrollTop = last.offsetTop - 4;
  syncSide();

  main.addEventListener(
    'scroll',
    () => {
      if (!syncQueued) {
        syncQueued = true;
        requestAnimationFrame(syncSide);
      }
    },
    { passive: true }
  );
  m.querySelector('[data-q]').addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    paint();
    main.scrollTop = 0;
    syncSide();
  });
  side.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    const g = b && groupEl(b.dataset.jump);
    if (g) main.scrollTo({ top: g.offsetTop - 4, behavior: 'smooth' });
  });
  main.addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-tex]');
    if (!cell) return;
    try {
      const res = await fetch(texUrl(cell.dataset.tex));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const dataUrl = await fileToDataUrl(await res.blob());
      localSet('texGroup', cell.closest('[data-group]').dataset.group);
      onPick(cell.dataset.tex, dataUrl);
      closeModal(entry);
    } catch (err) {
      toast(`Could not load texture: ${err.message}`, 'err');
    }
  });
}

// ---- item editor
function setOptions(selected) {
  return `<option value="">— No set —</option>${state.sets
    .map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`)
    .join('')}`;
}

function openItemEditor(item, preset = {}) {
  const isNew = !item?.id;
  const draft = item
    ? structuredClone(item)
    : { name: '', slot: preset.slot || 'ring', set: preset.set || null, rarity: preset.rarity || 'common', owned: true, stats: {}, effect: '', notes: '' };
  let imageData; // undefined = keep, string = new image, null = remove
  let texture = draft.texture || null; // "pack/name" when the image came from the texture picker
  const hasImg = () => (imageData === undefined ? !!(draft.image && !draft.imageMissing) : !!imageData);
  const previewSrc = () => (imageData ? imageData : imageData === null ? null : draft.image && !draft.imageMissing ? imgUrl(draft) : null);

  const entry = openModal(
    `<header class="modal-head"><span class="ph-diamond"></span><h2>${isNew ? 'New item' : 'Edit item'}</h2>
      <button class="icon-btn" data-close title="Close">${uiIcon('close')}</button></header>
    <form class="modal-body item-form" autocomplete="off">
      <div class="form-top">
        <div class="img-col">
          <div class="img-drop" tabindex="0" title="Click, drop or paste (Ctrl+V) an image">
            <div class="img-preview"></div>
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
            <button type="button" class="img-remove" title="Remove image">${uiIcon('close')}</button>
          </div>
          <button type="button" class="btn sm" data-texture>${uiIcon('image')} Choose texture</button>
        </div>
        <div class="form-fields">
          <label class="field"><span>Name</span><input name="name" value="${esc(draft.name)}" placeholder="e.g. Ring of the Black Swordsman" autofocus></label>
          <div class="field-row">
            <label class="field"><span>Slot</span><select name="slot">${SLOT_TYPE_KEYS.map((t) => `<option value="${t}" ${draft.slot === t ? 'selected' : ''}>${SLOT_TYPES[t].label}</option>`).join('')}</select></label>
            <label class="field"><span>Rarity</span><select name="rarity">${RARITIES.map((r) => `<option value="${r.key}" ${draft.rarity === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
          </div>
          <div class="field"><span>Set</span><div class="inline"><select name="set">${setOptions(draft.set)}</select>
            <button type="button" class="btn sm" data-new-set>${uiIcon('plus')} New set</button></div></div>
          <label class="toggle"><input type="checkbox" name="owned" ${draft.owned !== false ? 'checked' : ''}><span class="toggle-ui"></span><span>I own this item</span></label>
        </div>
      </div>
      <div class="section-label">Stats <small>empty = 0 · negatives allowed · % stats are entered as points (5 = 5%)</small></div>
      <div class="stat-inputs">${STATS.map(
        (st) => `<label class="stat-input">${statIco(st.key, 'sm')}<span class="si-label">${st.label}</span>
          <input type="number" step="any" name="stat:${st.key}" value="${esc(draft.stats?.[st.key] ?? '')}" placeholder="0"><em>${st.unit}</em></label>`
      ).join('')}</div>
      <label class="field"><span>Special effect <small>(shown in the overview, not calculated)</small></span><textarea name="effect" rows="2" placeholder="e.g. 10% chance to ignite on hit">${esc(draft.effect)}</textarea></label>
      <label class="field"><span>Notes</span><input name="notes" value="${esc(draft.notes)}" placeholder="Where to get it, upgrade level…"></label>
      <button type="submit" hidden></button>
    </form>
    <footer class="modal-foot">
      ${isNew ? '' : `<button class="btn danger" data-delete>${uiIcon('trash')} Delete</button>`}
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      ${isNew ? '<button class="btn" data-save-new>Save &amp; add another</button>' : ''}
      <button class="btn btn-primary" data-save>${uiIcon('check')} Save</button>
    </footer>`,
    'modal-item'
  );
  const m = entry.modal;
  const form = m.querySelector('form');
  const F = form.elements;
  const drop = m.querySelector('.img-drop');
  const fileInput = drop.querySelector('input[type=file]');

  const paintImage = () => {
    const src = previewSrc();
    drop.classList.toggle('has-img', hasImg());
    drop.querySelector('.img-preview').innerHTML = src
      ? `<img src="${src}" alt=""${PX}>`
      : `<span class="img-ph">${slotIcon(F.slot.value)}<small>Click, drop<br>or paste image</small></span>`;
  };
  const takeFile = async (file) => {
    if (!file) return;
    try {
      imageData = await fileToDataUrl(file);
      texture = null;
      paintImage();
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  paintImage();

  drop.addEventListener('click', (e) => {
    if (e.target.closest('.img-remove')) {
      e.stopPropagation();
      imageData = null;
      texture = null;
      paintImage();
      return;
    }
    fileInput.click();
  });
  m.querySelector('[data-texture]').addEventListener('click', () =>
    openTexturePicker(texture, (id, dataUrl) => {
      imageData = dataUrl;
      texture = id;
      paintImage();
    })
  );
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => takeFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    takeFile([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
  });
  entry.onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      takeFile(file);
    }
  };
  F.slot.addEventListener('change', paintImage);

  m.querySelector('[data-new-set]').addEventListener('click', () =>
    openSetEditor(null, {
      onSaved: (set) => {
        F.set.innerHTML = setOptions(set.id);
      },
    })
  );

  let busy = false;
  const save = async (andNew) => {
    if (busy) return;
    const name = F.name.value.trim();
    if (!name) {
      F.name.focus();
      return toast('Give the item a name first.', 'warn');
    }
    const data = {
      name,
      slot: F.slot.value,
      rarity: F.rarity.value,
      set: F.set.value || null,
      owned: F.owned.checked,
      stats: {},
      effect: F.effect.value.trim(),
      notes: F.notes.value.trim(),
    };
    if (draft.image) data.image = draft.image;
    if (texture) data.texture = texture;
    for (const k of STAT_KEYS) {
      const v = num(F[`stat:${k}`].value);
      if (v) data.stats[k] = v;
    }
    if (imageData !== undefined) data.imageData = imageData;
    busy = true;
    try {
      const saved = isNew ? await api('POST', '/api/items', data) : await api('PUT', `/api/items/${encodeURIComponent(item.id)}`, data);
      upsert(state.items, saved);
      toast(`Saved “${saved.name}”`);
      closeModal(entry);
      render();
      if (andNew) openItemEditor(null, { slot: data.slot, set: data.set, rarity: data.rarity });
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'err');
    } finally {
      busy = false;
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(false);
  });
  m.querySelector('[data-save]').addEventListener('click', () => save(false));
  m.querySelector('[data-save-new]')?.addEventListener('click', () => save(true));
  m.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (await deleteItem(item.id)) closeModal(entry);
  });
}

async function deleteItem(id) {
  const it = state.itemsById[id];
  if (!it) return false;
  const ok = await confirmDialog('Delete item', `Delete <b>${esc(it.name)}</b>?<br><small>Its JSON file${it.image ? ' and image' : ''} will be removed.</small>`);
  if (!ok) return false;
  try {
    await api('DELETE', `/api/items/${encodeURIComponent(id)}`);
    state.items = state.items.filter((x) => x.id !== id);
    indexData();
    let touched = false;
    for (const s of SLOTS) {
      if (state.profile.equipped[s.id] === id) {
        state.profile.equipped[s.id] = null;
        touched = true;
      }
    }
    if (touched) saveProfile();
    toast(`Deleted “${it.name}”`);
    render();
    return true;
  } catch (e) {
    toast(`Delete failed: ${e.message}`, 'err');
    return false;
  }
}

// ---- set editor
function openSetEditor(set, { onSaved } = {}) {
  const isNew = !set?.id;
  const tiers = (set ? sortedTiers(set) : [{ pieces: 2 }, { pieces: 4 }]).map((t) => ({
    pieces: t.pieces,
    effect: t.effect || '',
    lines: Object.entries(t.stats || {}).map(([stat, value]) => ({ stat, value })),
  }));
  for (const t of tiers) if (!t.lines.length) t.lines.push({ stat: 'attackDamage', value: '' });

  const entry = openModal(
    `<header class="modal-head"><span class="ph-diamond"></span><h2>${isNew ? 'New set' : 'Edit set'}</h2>
      <button class="icon-btn" data-close title="Close">${uiIcon('close')}</button></header>
    <form class="modal-body set-form" autocomplete="off">
      <label class="field"><span>Set name</span><input name="name" value="${esc(set?.name || '')}" placeholder="e.g. Midnight Coat Set" autofocus></label>
      <div class="field"><span>How bonuses apply</span>
        <div class="seg">
          <label class="seg-btn radio"><input type="radio" name="mode" value="stack" ${set?.cumulative !== false ? 'checked' : ''}>Stack (2pc + 4pc both active)</label>
          <label class="seg-btn radio"><input type="radio" name="mode" value="highest" ${set?.cumulative === false ? 'checked' : ''}>Highest tier only</label>
        </div>
      </div>
      <div class="section-label">Bonuses per number of equipped pieces</div>
      <div class="tiers-edit"></div>
      <button type="button" class="btn sm" data-add-tier>${uiIcon('plus')} Add tier</button>
      ${
        isNew
          ? ''
          : `<div class="section-label">Pieces</div><div class="set-pieces">${
              state.items
                .filter((i) => i.set === set.id)
                .map((p) => `<span class="piece static" style="--r:${rarityOf(p).color}"><span class="piece-thumb">${thumb(p)}</span><span class="piece-name">${esc(p.name)}</span></span>`)
                .join('') || '<span class="muted small">No items use this set yet — pick it in the item editor.</span>'
            }</div>`
      }
      <button type="submit" hidden></button>
    </form>
    <footer class="modal-foot">
      ${isNew ? '' : `<button class="btn danger" data-delete>${uiIcon('trash')} Delete</button>`}
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" data-save>${uiIcon('check')} Save set</button>
    </footer>`,
    'modal-set'
  );
  const m = entry.modal;
  const form = m.querySelector('form');
  const F = form.elements;
  const box = m.querySelector('.tiers-edit');

  const statSelect = (sel) =>
    `<select data-lf="stat">${STATS.map((s) => `<option value="${s.key}" ${s.key === sel ? 'selected' : ''}>${s.label}</option>`).join('')}</select>`;
  const paint = () => {
    box.innerHTML = tiers
      .map(
        (t, ti) => `<div class="tier-edit" data-t="${ti}">
          <div class="tier-edit-head">
            <label class="pieces-in"><input type="number" min="1" max="13" step="1" data-tf="pieces" value="${esc(t.pieces)}"><span>pieces</span></label>
            <button type="button" class="icon-btn danger" data-del-tier title="Remove tier">${uiIcon('trash')}</button>
          </div>
          <div class="tier-lines">${t.lines
            .map(
              (l, li) => `<div class="tier-line" data-l="${li}">${statSelect(l.stat)}
                <input type="number" step="any" data-lf="value" value="${esc(l.value)}" placeholder="0">
                <button type="button" class="icon-btn" data-del-line title="Remove">${uiIcon('close')}</button></div>`
            )
            .join('')}</div>
          <div class="tier-edit-foot">
            <button type="button" class="btn sm ghost" data-add-line>${uiIcon('plus')} Stat</button>
            <input class="grow" data-tf="effect" value="${esc(t.effect)}" placeholder="Special effect (optional)">
          </div>
        </div>`
      )
      .join('');
  };
  paint();

  box.addEventListener('input', (e) => {
    const tEl = e.target.closest('[data-t]');
    if (!tEl) return;
    const t = tiers[+tEl.dataset.t];
    if (e.target.dataset.tf) t[e.target.dataset.tf] = e.target.value;
    const lEl = e.target.closest('[data-l]');
    if (lEl && e.target.dataset.lf) t.lines[+lEl.dataset.l][e.target.dataset.lf] = e.target.value;
  });
  box.addEventListener('click', (e) => {
    const tEl = e.target.closest('[data-t]');
    if (!tEl) return;
    const ti = +tEl.dataset.t;
    if (e.target.closest('[data-del-tier]')) tiers.splice(ti, 1);
    else if (e.target.closest('[data-add-line]')) {
      const used = new Set(tiers[ti].lines.map((l) => l.stat));
      tiers[ti].lines.push({ stat: STAT_KEYS.find((k) => !used.has(k)) || 'health', value: '' });
    } else if (e.target.closest('[data-del-line]')) tiers[ti].lines.splice(+e.target.closest('[data-l]').dataset.l, 1);
    else return;
    paint();
  });
  m.querySelector('[data-add-tier]').addEventListener('click', () => {
    const next = Math.min(13, (tiers.reduce((mx, t) => Math.max(mx, Number(t.pieces) || 0), 0) || 1) + 1);
    tiers.push({ pieces: next, effect: '', lines: [{ stat: 'attackDamage', value: '' }] });
    paint();
  });

  const save = async () => {
    // sync <select> values (change events on selects already update, but be safe)
    $$('[data-t]', box).forEach((tEl) => {
      const t = tiers[+tEl.dataset.t];
      $$('[data-l]', tEl).forEach((lEl) => {
        t.lines[+lEl.dataset.l].stat = lEl.querySelector('[data-lf=stat]').value;
        t.lines[+lEl.dataset.l].value = lEl.querySelector('[data-lf=value]').value;
      });
    });
    const name = F.name.value.trim();
    if (!name) {
      F.name.focus();
      return toast('Give the set a name first.', 'warn');
    }
    const data = {
      name,
      cumulative: F.mode.value !== 'highest',
      bonuses: tiers.map((t) => {
        const stats = {};
        for (const l of t.lines) {
          const v = num(l.value);
          if (v) stats[l.stat] = (stats[l.stat] || 0) + v;
        }
        return { pieces: Math.max(1, Math.round(Number(t.pieces) || 1)), stats, effect: String(t.effect || '').trim() };
      }),
      notes: set?.notes || '',
    };
    try {
      const saved = isNew ? await api('POST', '/api/sets', data) : await api('PUT', `/api/sets/${encodeURIComponent(set.id)}`, data);
      upsert(state.sets, saved);
      toast(`Saved set “${saved.name}”`);
      closeModal(entry);
      render();
      onSaved?.(saved);
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'err');
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  m.querySelector('[data-save]').addEventListener('click', save);
  m.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (await deleteSet(set.id)) closeModal(entry);
  });
}

async function deleteSet(id) {
  const set = state.setsById[id];
  if (!set) return false;
  const users = state.items.filter((i) => i.set === id);
  const ok = await confirmDialog(
    'Delete set',
    `Delete the set <b>${esc(set.name)}</b>?${users.length ? `<br><small>${users.length} item(s) will be unlinked from it (the items are kept).</small>` : ''}`
  );
  if (!ok) return false;
  try {
    await api('DELETE', `/api/sets/${encodeURIComponent(id)}`);
    for (const it of users) {
      const saved = await api('PUT', `/api/items/${encodeURIComponent(it.id)}`, { ...it, set: null });
      upsert(state.items, saved);
    }
    state.sets = state.sets.filter((s) => s.id !== id);
    indexData();
    toast(`Deleted set “${set.name}”`);
    render();
    return true;
  } catch (e) {
    toast(`Delete failed: ${e.message}`, 'err');
    return false;
  }
}

// ---- slot picker
const wornTwice = (slotType) => !!SLOT_TYPES[slotType]?.duplicates;

// Slot already holding this item: with another artifact etc. the two slots swap; a ring can sit in both ring slots.
const swapSlotFor = (eq, slotId, itemId) =>
  wornTwice(SLOT_MAP[slotId].type) ? null : SLOTS.find((s) => s.id !== slotId && eq[s.id] === itemId) || null;

function equipItem(slotId, itemId) {
  const eq = state.profile.equipped;
  const other = swapSlotFor(eq, slotId, itemId);
  if (other) eq[other.id] = eq[slotId] || null;
  eq[slotId] = itemId;
  saveProfile();
}

// Only rings can be worn twice: clear repeats of any other item (the first slot keeps it). Returns how many were cleared.
function dedupeEquipped(eq) {
  const seen = new Set();
  let cleared = 0;
  for (const s of SLOTS) {
    const id = eq[s.id];
    if (!id) continue;
    if (seen.has(id) && !wornTwice(s.type)) {
      eq[s.id] = null;
      cleared++;
    }
    seen.add(id);
  }
  return cleared;
}

function openSlotPicker(slotId) {
  const slot = SLOT_MAP[slotId];
  let q = '';
  let ownedOnly = localGet('pickerOwned') === '1';
  const entry = openModal(
    `<header class="modal-head"><span class="ph-diamond"></span><h2>${slot.label}</h2>
      <div class="ph-right"><button class="icon-btn" data-close title="Close">${uiIcon('close')}</button></div></header>
    <div class="picker-tools">
      <label class="search">${uiIcon('search')}<input data-q placeholder="Search ${SLOT_TYPES[slot.type].label.toLowerCase()}s…" autofocus></label>
      <label class="toggle"><input type="checkbox" data-owned ${ownedOnly ? 'checked' : ''}><span class="toggle-ui"></span><span>Owned only</span></label>
    </div>
    <div class="modal-body picker-list"></div>
    <footer class="modal-foot">
      <button class="btn admin-only" data-new>${uiIcon('plus')} New ${SLOT_TYPES[slot.type].label.toLowerCase()}</button>
      <span class="spacer"></span>
      <button class="btn" data-unequip>Leave empty</button>
    </footer>`,
    'modal-picker',
    { dismissable: true }
  );
  const m = entry.modal;
  const listEl = m.querySelector('.picker-list');
  const paint = () => {
    const o = state.profile.optimizer;
    const eq = state.profile.equipped;
    const cur = currentBuild();
    const curScore = scoreStats(cur.total, o);
    const rows = state.items
      .filter((it) => it.slot === slot.type)
      .filter((it) => !ownedOnly || it.owned !== false)
      .filter((it) => !q || [it.name, it.effect, state.setsById[it.set]?.name].join(' ').toLowerCase().includes(q))
      .map((it) => {
        const next = { ...eq };
        const other = swapSlotFor(next, slotId, it.id);
        if (other) next[other.id] = eq[slotId] || null;
        next[slotId] = it.id;
        const alsoIn = wornTwice(slot.type) ? SLOTS.find((s) => s.id !== slotId && eq[s.id] === it.id) : null;
        const b = currentBuild(next);
        const d = {};
        for (const k of STAT_KEYS) d[k] = b.total[k] - cur.total[k];
        return { it, d, ds: scoreStats(b.total, o) - curScore, other, alsoIn };
      })
      .sort((a, b) => b.ds - a.ds);
    if (!rows.length) {
      listEl.innerHTML = empty(`No ${ownedOnly ? 'owned ' : ''}items for this slot${q ? ' match the search' : ''}.`);
      return;
    }
    listEl.innerHTML = rows
      .map(({ it, d, ds, other, alsoIn }) => {
        const isCur = eq[slotId] === it.id;
        const set = state.setsById[it.set];
        const where = isCur
          ? ' <span class="tag eq">equipped</span>'
          : other
            ? ` <span class="tag">in ${other.label} · swap</span>`
            : alsoIn
              ? ` <span class="tag">also in ${alsoIn.label}</span>`
              : '';
        return `<button class="pick-row ${isCur ? 'current' : ''} ${it.owned === false ? 'not-owned' : ''}" data-pick="${esc(it.id)}" style="--r:${rarityOf(it).color}">
          <span class="pick-thumb">${thumb(it)}</span>
          <span class="pick-main">
            <span class="pick-name">${esc(it.name)}${where}${set ? ` <span class="tag set">${esc(set.name)}</span>` : ''}${it.owned === false ? ' <span class="tag dim">not owned</span>' : ''}</span>
            ${isCur ? statChips(it.stats) : statChips(d, { delta: true }) || '<span class="muted small">No stat change</span>'}
          </span>
          <span class="pick-score ${ds > 0.0001 ? 'pos' : ds < -0.0001 ? 'neg' : 'muted'}">${isCur ? '—' : `${ds >= 0 ? '+' : ''}${fmt(ds)}`}<small>score</small></span>
        </button>`;
      })
      .join('');
  };
  paint();
  m.querySelector('[data-q]').addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    paint();
  });
  m.querySelector('[data-owned]').addEventListener('change', (e) => {
    ownedOnly = e.target.checked;
    localSet('pickerOwned', ownedOnly ? '1' : '0');
    paint();
  });
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    equipItem(slotId, row.dataset.pick);
    closeModal(entry);
    render();
  });
  m.querySelector('[data-unequip]').addEventListener('click', () => {
    state.profile.equipped[slotId] = null;
    saveProfile();
    closeModal(entry);
    render();
  });
  m.querySelector('[data-new]').addEventListener('click', () => {
    closeModal(entry);
    openItemEditor(null, { slot: slot.type });
  });
}

// ---------------------------------------------------------------- actions
const ACTIONS = {
  reload: () => loadData(true),
  'open-slot': (el) => openSlotPicker(el.dataset.slot),
  'toggle-lock': (el) => {
    const id = el.dataset.slot;
    state.profile.locked[id] = !state.profile.locked[id];
    saveProfile();
    render();
  },
  'unequip-all': async () => {
    if (!Object.values(state.profile.equipped).some(Boolean)) return;
    if (!(await confirmDialog('Unequip all', 'Remove every item from the equipment slots?'))) return;
    state.profile.equipped = {};
    saveProfile();
    render();
  },
  'save-build': async () => {
    const name = await promptDialog('Save build', 'Build name', `Build ${state.profile.builds.length + 1}`);
    if (!name) return;
    const existing = state.profile.builds.findIndex((b) => b.name === name);
    const build = { name, equipped: { ...state.profile.equipped }, savedAt: new Date().toISOString() };
    if (existing >= 0) state.profile.builds[existing] = build;
    else state.profile.builds.push(build);
    saveProfile();
    render();
    toast(`Build “${name}” saved`);
  },
  'load-build': (el) => {
    const b = state.profile.builds[+el.dataset.index];
    if (!b) return;
    state.profile.equipped = { ...b.equipped };
    dedupeEquipped(state.profile.equipped);
    saveProfile();
    render();
    toast(`Equipped “${b.name}”`);
  },
  'delete-build': async (el) => {
    const i = +el.dataset.index;
    const b = state.profile.builds[i];
    if (!b || !(await confirmDialog('Delete build', `Delete the saved build <b>${esc(b.name)}</b>?`))) return;
    state.profile.builds.splice(i, 1);
    saveProfile();
    render();
  },
  'new-item': () => openItemEditor(null, { slot: state.filters.slot !== 'all' ? state.filters.slot : undefined }),
  'new-item-in-set': (el) => openItemEditor(null, { set: el.dataset.id }),
  'edit-item': (el) => state.itemsById[el.dataset.id] && openItemEditor(state.itemsById[el.dataset.id]),
  'dup-item': (el) => {
    const it = state.itemsById[el.dataset.id];
    if (!it) return;
    const copy = structuredClone(it);
    delete copy.id;
    delete copy.image;
    delete copy.imageVersion;
    copy.name = `${it.name} (copy)`;
    openItemEditor(null, {});
    // fill the new editor with the copied values
    const m = modalStack[modalStack.length - 1].modal;
    const F = m.querySelector('form').elements;
    F.name.value = copy.name;
    F.slot.value = copy.slot;
    F.slot.dispatchEvent(new Event('change'));
    F.rarity.value = copy.rarity || 'common';
    F.set.value = copy.set || '';
    F.owned.checked = copy.owned !== false;
    F.effect.value = copy.effect || '';
    F.notes.value = copy.notes || '';
    for (const k of STAT_KEYS) F[`stat:${k}`].value = copy.stats?.[k] ?? '';
  },
  'delete-item': (el) => deleteItem(el.dataset.id),
  'toggle-owned': async (el) => {
    const it = state.itemsById[el.dataset.id];
    if (!it) return;
    try {
      const saved = await api('PUT', `/api/items/${encodeURIComponent(it.id)}`, { ...it, owned: it.owned === false });
      upsert(state.items, saved);
      refreshItemList();
      renderTopbar();
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'err');
    }
  },
  'equip-item': (el) => {
    const it = state.itemsById[el.dataset.id];
    if (!it) return;
    const slots = SLOTS.filter((s) => s.type === it.slot);
    if (!slots.length) return toast('This item has no valid slot.', 'warn');
    const eq = state.profile.equipped;
    if (slots.some((s) => eq[s.id] === it.id)) return toast(`${it.name} is already equipped.`, 'warn');
    const target = slots.find((s) => !eq[s.id]) || slots[0];
    equipItem(target.id, it.id);
    refreshItemList();
    toast(`Equipped ${it.name} → ${target.label}`);
  },
  'filter-slot': (el) => {
    state.filters.slot = el.dataset.value;
    $$('.slot-filter .seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.value === state.filters.slot));
    refreshItemList();
  },
  'new-set': () => openSetEditor(null),
  'edit-set': (el) => state.setsById[el.dataset.id] && openSetEditor(state.setsById[el.dataset.id]),
  'delete-set': (el) => deleteSet(el.dataset.id),
  preset: (el) => {
    const k = el.dataset.value;
    state.profile.optimizer.preset = k;
    state.profile.optimizer.weights = { ...PRESETS[k].weights };
    saveProfile();
    render();
  },
  'run-opt': runOptimizer,
  'cancel-opt': cancelOptimizer,
  logout: async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  },
  'equip-result': (el) => {
    const res = state.opt.result?.results[+el.dataset.index];
    if (!res) return;
    state.profile.equipped = resultEquipped(res);
    saveProfile();
    toast('Build equipped');
    go('equipment');
  },
};

// Actions that change items or sets on the server.
const ADMIN_ACTIONS = new Set(['new-item', 'new-item-in-set', 'edit-item', 'dup-item', 'delete-item', 'toggle-owned', 'new-set', 'edit-set', 'delete-set']);

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) return go(nav.dataset.nav);
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn && ADMIN_ACTIONS.has(el.dataset.action) && !canEdit()) {
    e.preventDefault();
    return toast('This login is read-only. Log in as admin to change items and sets.', 'warn');
  }
  if (fn) {
    e.preventDefault();
    e.stopPropagation();
    fn(el, e);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    e.preventDefault();
    closeModal();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.slot-tile')) {
    e.preventDefault();
    openSlotPicker(e.target.dataset.slot);
  }
});

document.addEventListener('paste', (e) => {
  const top = modalStack[modalStack.length - 1];
  top?.onPaste?.(e);
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.closest('.modal')) return;
  if (t.dataset.filter) {
    state.filters[t.dataset.filter] = t.value;
    refreshItemList();
  } else if (t.dataset.base) {
    state.profile.baseStats[t.dataset.base] = num(t.value) ?? 0;
    saveProfile();
  } else if (t.dataset.opt) {
    const o = state.profile.optimizer;
    const bag = o[t.dataset.opt];
    const v = num(t.value);
    if (v === null) delete bag[t.dataset.key];
    else bag[t.dataset.key] = v;
    if (t.dataset.opt === 'weights') {
      // keep the slider and its number box in step
      const box = t.closest('.wt-slider');
      for (const other of $$('input', box)) if (other !== t) other.value = other.type === 'range' ? Math.max(0, v ?? 0) : v ?? '';
      box.style.setProperty('--p', `${weightPct(v)}%`);
      t.closest('tr').classList.toggle('off', !v);
      if (o.preset !== 'custom') {
        o.preset = 'custom';
        $$('.preset-row .seg-btn').forEach((b) => b.classList.toggle('on', b.hasAttribute('data-preset-custom')));
      }
    }
    saveProfile();
  } else if (t.dataset.optnum) {
    state.profile.optimizer[t.dataset.optnum] = num(t.value) ?? 8;
    saveProfile();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.closest('.modal')) return;
  if (t.dataset.optflag) {
    state.profile.optimizer[t.dataset.optflag] = t.checked;
    saveProfile();
    const s = $('#opt-summary');
    if (s) s.innerHTML = optSummary();
  } else if (t.dataset.filter && t.tagName === 'SELECT') {
    state.filters[t.dataset.filter] = t.value;
    refreshItemList();
  }
});

// ---------------------------------------------------------------- boot
async function loadData(announce = false) {
  try {
    const [me, d] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/data')]);
    state.me = me;
    document.body.classList.toggle('read-only', !canEdit());
    texturePacks = null;
    state.items = d.items || [];
    state.sets = d.sets || [];
    indexData();
    let profile = d.profile;
    if (!canEdit()) {
      try {
        profile = JSON.parse(localGet('viewerProfile')) || profile;
      } catch {
        /* keep the shared profile */
      }
    }
    state.profile = normalizeProfile(profile);
    state.paths = d.paths;
    state.errors = d.errors || [];
    state.loaded = true;
    const cleared = [state.profile.equipped, ...state.profile.builds.map((bd) => bd.equipped || {})].reduce((n, eq) => n + dedupeEquipped(eq), 0);
    if (!d.profile || cleared) saveProfile();
    if (cleared) toast(`Removed ${cleared} duplicate item${cleared > 1 ? 's' : ''} from your equipment and saved builds. Only rings can be worn twice.`, 'warn');
    render();
    if (announce) toast('Data reloaded from disk');
    if (state.errors.length) toast(`${state.errors.length} file(s) could not be read — see Base Stats › Data files`, 'warn');
  } catch (e) {
    $('#view').innerHTML = `<div class="layout-single"><section class="panel">${panelHead('Connection lost')}
      <div class="panel-body">${empty(`Cannot reach the local server (${esc(e.message)}).<br>Start the app with <b>start.bat</b> (or <code>node server.js</code>) and open <code>http://localhost:3077</code>.`)}</div></section></div>`;
  }
}

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v !== state.view && NAV.some((n) => n.id === v)) go(v);
});

renderNav();
loadData();
