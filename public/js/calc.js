// Stat math shared by the UI and the optimizer worker.
import { STAT_KEYS, STAT_MAP, SLOTS } from './data.js';

export function emptyStats() {
  const o = {};
  for (const k of STAT_KEYS) o[k] = 0;
  return o;
}

export function addStats(target, src, mult = 1) {
  if (!src) return target;
  for (const k of STAT_KEYS) {
    const v = Number(src[k]);
    if (v) target[k] += v * mult;
  }
  return target;
}

export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Bonus stats a set grants at `count` equipped pieces. */
export function setBonusFor(set, count) {
  const stats = emptyStats();
  const active = [];
  if (!set || !Array.isArray(set.bonuses)) return { stats, active };
  const tiers = set.bonuses.filter((t) => t && t.pieces > 0).sort((a, b) => a.pieces - b.pieces);
  if (set.cumulative !== false) {
    for (const t of tiers) {
      if (count >= t.pieces) {
        addStats(stats, t.stats);
        active.push(t);
      }
    }
  } else {
    let best = null;
    for (const t of tiers) if (count >= t.pieces) best = t;
    if (best) {
      addStats(stats, best.stats);
      active.push(best);
    }
  }
  return { stats, active };
}

/** Full stat breakdown for a loadout ({slotId: itemId}). */
export function computeBuild(base, equipped, itemsById, setsById) {
  const fromItems = emptyStats();
  const fromSets = emptyStats();
  const setCounts = {};
  const equippedItems = [];
  for (const slot of SLOTS) {
    const id = equipped && equipped[slot.id];
    const item = id && itemsById[id];
    if (!item) continue;
    equippedItems.push({ slot, item });
    addStats(fromItems, item.stats);
    if (item.set) setCounts[item.set] = (setCounts[item.set] || 0) + 1;
  }
  const setInfo = [];
  for (const [id, count] of Object.entries(setCounts)) {
    const set = setsById[id];
    const { stats, active } = setBonusFor(set, count);
    addStats(fromSets, stats);
    setInfo.push({ id, set, count, active });
  }
  setInfo.sort((a, b) => b.count - a.count);
  const gear = addStats(addStats(emptyStats(), fromItems), fromSets);
  const total = addStats(addStats(emptyStats(), base), gear);
  return { total, gear, fromItems, fromSets, setInfo, equippedItems };
}

/** Score of a final stat block under the optimizer settings (weights, caps). */
export function scoreStats(total, opt) {
  let s = 0;
  for (const k of STAT_KEYS) {
    const w = Number(opt.weights?.[k]) || 0;
    if (!w) continue;
    let v = total[k];
    const cap = num(opt.caps?.[k]);
    if (w > 0 && cap !== null) v = Math.min(v, cap);
    s += w * v;
  }
  return s;
}

/** Plain weighted sum of a stat block (no caps) — used as an item's "value". */
export function linearValue(stats, weights) {
  let s = 0;
  if (!stats) return 0;
  for (const k of STAT_KEYS) s += (Number(weights?.[k]) || 0) * (Number(stats[k]) || 0);
  return s;
}

export function unmetMins(total, opt) {
  const out = [];
  for (const k of STAT_KEYS) {
    const m = num(opt.mins?.[k]);
    if (m !== null && total[k] < m - 1e-9) out.push({ key: k, need: m, have: total[k] });
  }
  return out;
}

export function fmt(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  return String(Object.is(n, -0) ? 0 : n);
}

export function fmtStat(key, v) {
  return fmt(v) + (STAT_MAP[key]?.unit || '');
}

export function fmtDelta(key, v) {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  if (!n) return '';
  return (n > 0 ? '+' : '') + fmt(n) + (STAT_MAP[key]?.unit || '');
}
