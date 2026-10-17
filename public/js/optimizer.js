// Gear optimizer — exact branch & bound search, runs inside a Web Worker.
import { STAT_KEYS, SLOT_TYPES } from './data.js';
import { setBonusFor, num } from './calc.js';

const NS = STAT_KEYS.length;
const EPS = 1e-9;
const now = () => performance.now();

if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { id, payload } = e.data;
    try {
      const result = optimize(payload, (p) => self.postMessage({ id, type: 'progress', ...p }));
      self.postMessage({ id, type: 'done', result });
    } catch (err) {
      self.postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
    }
  };
}

/**
 * payload: { base, fixed: [{slot, item}], slots: [{id, type}], items, sets,
 *            weights, mins, caps, allowDuplicates (rings only), topK, timeLimitMs,
 *            limits: [{items: [itemId], max}] }   (at most `max` of those items in a build)
 */
export function optimize(P, onProgress = () => {}) {
  const first = search(P, true, onProgress);
  if (first.results.length || !first.hasMins) return first;
  // No build can reach the minimums: return the best builds ignoring them, flagged.
  const relaxed = search(P, false, onProgress);
  relaxed.relaxed = true;
  return relaxed;
}

function search(P, useMins, onProgress) {
  const t0 = now();
  const timeLimit = P.timeLimitMs ?? 8000;
  const K = Math.max(1, P.topK ?? 5);
  // The same item may fill several slots of a group only for slot types that allow it (rings).
  const dupType = (t) => !!P.allowDuplicates && !!SLOT_TYPES[t]?.duplicates;

  // ---- objective ----
  const W = new Float64Array(NS);
  const CAP = new Float64Array(NS).fill(Infinity);
  const MIN = new Float64Array(NS).fill(-Infinity);
  let hasCaps = false;
  let hasMins = false;
  const minIdx = [];
  STAT_KEYS.forEach((k, i) => {
    W[i] = Number(P.weights?.[k]) || 0;
    const c = num(P.caps?.[k]);
    if (c !== null && W[i] > 0) {
      CAP[i] = c;
      hasCaps = true;
    }
    const m = num(P.mins?.[k]);
    if (useMins && m !== null) {
      MIN[i] = m;
      hasMins = true;
      minIdx.push(i);
    }
  });

  const vec = (stats) => {
    const v = new Float64Array(NS);
    if (stats) STAT_KEYS.forEach((k, i) => (v[i] = Number(stats[k]) || 0));
    return v;
  };
  const lin = (v) => {
    let s = 0;
    for (let i = 0; i < NS; i++) s += W[i] * v[i];
    return s;
  };

  // ---- sets ----
  const setsArr = P.sets || [];
  const NSET = setsArr.length;
  const setIndex = new Map(setsArr.map((s, i) => [s.id, i]));
  const MAXC = Math.max(1, (P.slots?.length || 0) + (P.fixed?.length || 0));
  const bonusVec = setsArr.map((s) => Array.from({ length: MAXC + 1 }, (_, c) => vec(setBonusFor(s, c).stats)));
  const bonusLin = bonusVec.map((arr) => arr.map(lin));
  const setStatMax = new Float64Array(NS);
  const setStatMin = new Float64Array(NS);
  for (const arr of bonusVec) {
    for (let i = 0; i < NS; i++) {
      let mx = 0;
      let mn = 0;
      for (const v of arr) {
        if (v[i] > mx) mx = v[i];
        if (v[i] < mn) mn = v[i];
      }
      setStatMax[i] += mx;
      setStatMin[i] += mn;
    }
  }

  // ---- piece limits (e.g. only one Occult item) ----
  const limits = (P.limits || []).filter((l) => l?.items?.length);
  const limitOf = new Map();
  limits.forEach((l, li) => l.items.forEach((itemId) => limitOf.set(itemId, li)));
  const limMax = Int32Array.from(limits, (l) => Math.max(0, Math.floor(Number(l.max) || 0)));
  const limCnt = new Int32Array(limits.length);

  // ---- locked items ----
  const baseVec = vec(P.base);
  const cnt0 = new Int32Array(NSET);
  for (const f of P.fixed || []) {
    const v = vec(f.item.stats);
    for (let i = 0; i < NS; i++) baseVec[i] += v[i];
    const si = setIndex.get(f.item.set);
    if (si !== undefined) cnt0[si]++;
    const li = limitOf.get(f.item.id);
    if (li !== undefined) limCnt[li]++;
  }

  // ---- slots & candidates ----
  const types = [];
  for (const s of P.slots || []) if (!types.includes(s.type)) types.push(s.type);
  const order = [];
  for (const t of types) for (const s of P.slots) if (s.type === t) order.push(s);
  const D = order.length;

  const dir = new Int8Array(NS); // 1 higher is better, -1 lower is better, 2 must match, 0 irrelevant
  for (let i = 0; i < NS; i++) {
    const hasMin = MIN[i] > -Infinity;
    if (W[i] > 0) dir[i] = 1;
    else if (W[i] < 0) dir[i] = hasMin ? 2 : -1;
    else dir[i] = hasMin ? 1 : 0;
  }

  const candByType = {};
  const typeSetCount = {};
  let pruned = 0;
  let candidateCount = 0;
  for (const t of types) {
    const m = order.filter((s) => s.type === t).length;
    let list = (P.items || [])
      .filter((it) => it.slot === t)
      .map((it) => {
        const v = vec(it.stats);
        const lim = limitOf.has(it.id) ? limitOf.get(it.id) : -1;
        return { item: it, v, set: setIndex.has(it.set) ? setIndex.get(it.set) : -1, lim, lin: lin(v) };
      });
    const before = list.length;
    list = pruneDominated(list, dupType(t) ? 1 : m, dir);
    pruned += before - list.length;
    candidateCount += list.length;
    list.sort((a, b) => b.lin - a.lin);
    const sc = new Int32Array(NSET);
    for (const c of list) if (c.set >= 0) sc[c.set]++;
    typeSetCount[t] = sc;
    list.push({ item: null, v: new Float64Array(NS), set: -1, lim: -1, lin: 0 }); // "leave empty"
    candByType[t] = list;
  }

  const cands = order.map((s) => candByType[s.type]);
  const groupPos = order.map((s, i) => {
    let k = 0;
    for (let j = i - 1; j >= 0 && order[j].type === s.type; j--) k++;
    return k;
  });
  const groupEnd = order.map((s, i) => {
    let e = i;
    while (e < D && order[e].type === s.type) e++;
    return e;
  });
  const sameNext = order.map((s, i) => i + 1 < D && order[i + 1].type === s.type);
  const dupAt = order.map((s) => dupType(s.type));

  // Static per-slot upper bounds. Candidates are sorted by value and picks inside a
  // group (rings, artifacts) are non-decreasing, so the k-th slot of a group can do
  // no better than the k-th best candidate.
  const linSuffix = new Float64Array(D + 1);
  for (let d = D - 1; d >= 0; d--) {
    const list = cands[d];
    const k = dupAt[d] ? 0 : groupPos[d];
    linSuffix[d] = linSuffix[d + 1] + Math.max(list[Math.min(k, list.length - 1)].lin, 0);
  }
  const statMaxSuf = Array.from({ length: D + 1 }, () => new Float64Array(NS));
  const statMinSuf = Array.from({ length: D + 1 }, () => new Float64Array(NS));
  for (let d = D - 1; d >= 0; d--) {
    for (let i = 0; i < NS; i++) {
      let mx = -Infinity;
      let mn = Infinity;
      for (const c of cands[d]) {
        if (c.v[i] > mx) mx = c.v[i];
        if (c.v[i] < mn) mn = c.v[i];
      }
      statMaxSuf[d][i] = statMaxSuf[d + 1][i] + mx;
      statMinSuf[d][i] = statMinSuf[d + 1][i] + mn;
    }
  }
  // Most pieces of each set that slots d.. can still hold: r open slots of a group can
  // take at most min(r, #set candidates) distinct pieces (or r copies with duplicates).
  const piecesFit = (r, available, dup) => (available <= 0 ? 0 : dup ? r : Math.min(r, available));
  const fullGroupsFrom = Array.from({ length: D + 1 }, () => new Int32Array(NSET));
  for (let d = D - 1; d >= 0; d--) {
    if (groupPos[d] !== 0) {
      fullGroupsFrom[d] = fullGroupsFrom[d + 1];
      continue;
    }
    const sc = typeSetCount[order[d].type];
    const e = groupEnd[d];
    for (let s = 0; s < NSET; s++) fullGroupsFrom[d][s] = fullGroupsFrom[e][s] + piecesFit(e - d, sc[s], dupAt[d]);
  }
  const setRem = Array.from({ length: D + 1 }, () => new Int32Array(NSET));
  for (let d = 0; d < D; d++) {
    const sc = typeSetCount[order[d].type];
    const e = groupEnd[d];
    for (let s = 0; s < NSET; s++) setRem[d][s] = fullGroupsFrom[e][s] + piecesFit(e - d, sc[s], dupAt[d]);
  }
  const relSets = [];
  for (let s = 0; s < NSET; s++) if (cnt0[s] > 0 || setRem[0][s] > 0) relSets.push(s);

  // ---- search ----
  const cur = Float64Array.from(baseVec);
  const cnt = Int32Array.from(cnt0);
  const pick = new Int32Array(D);
  const leafTotal = new Float64Array(NS);
  const results = [];
  let threshold = -Infinity;
  let nodes = 0;
  let leaves = 0;
  let truncated = false;
  const deadline = t0 + timeLimit;
  let lastProgress = t0;

  function evalLeaf() {
    leaves++;
    leafTotal.set(cur);
    for (const s of relSets) {
      const c = cnt[s];
      if (!c) continue;
      const bv = bonusVec[s][Math.min(c, MAXC)];
      for (let i = 0; i < NS; i++) leafTotal[i] += bv[i];
    }
    for (const i of minIdx) if (leafTotal[i] < MIN[i] - EPS) return;
    let score = 0;
    for (let i = 0; i < NS; i++) {
      const w = W[i];
      if (!w) continue;
      score += w * (w > 0 ? Math.min(leafTotal[i], CAP[i]) : leafTotal[i]);
    }
    if (results.length >= K && score <= threshold + EPS) return;
    results.push({ score, picks: Array.from(pick) });
    results.sort((a, b) => b.score - a.score);
    if (results.length > K) results.length = K;
    if (results.length >= K) threshold = results[K - 1].score;
  }

  function bound(d, start, curLin) {
    let b = curLin;
    const list = cands[d];
    const last = list.length - 1;
    const e = groupEnd[d];
    const r = e - d;
    if (dupAt[d]) b += r * Math.max(list[Math.min(start, last)].lin, 0);
    else for (let j = 0; j < r; j++) b += Math.max(list[Math.min(start + j, last)].lin, 0);
    b += linSuffix[e];
    const rem = setRem[d];
    for (const s of relSets) {
      const lo = cnt[s];
      const hi = Math.min(lo + rem[s], MAXC);
      const bl = bonusLin[s];
      let mx = bl[lo];
      for (let c = lo + 1; c <= hi; c++) if (bl[c] > mx) mx = bl[c];
      b += mx;
    }
    if (hasCaps) {
      let sb = 0;
      const mxs = statMaxSuf[d];
      const mns = statMinSuf[d];
      for (let i = 0; i < NS; i++) {
        const w = W[i];
        if (!w) continue;
        if (w > 0) sb += w * Math.min(cur[i] + mxs[i] + setStatMax[i], CAP[i]);
        else sb += w * (cur[i] + mns[i] + setStatMin[i]);
      }
      if (sb < b) b = sb;
    }
    return b;
  }

  function canReachMins(d) {
    const mxs = statMaxSuf[d];
    for (const i of minIdx) if (cur[i] + mxs[i] + setStatMax[i] < MIN[i] - EPS) return false;
    return true;
  }

  function dfs(d, start, curLin) {
    if (truncated) return;
    nodes++;
    if ((nodes & 8191) === 0) {
      const t = now();
      if (t > deadline) {
        truncated = true;
        return;
      }
      if (t - lastProgress > 250) {
        lastProgress = t;
        onProgress({ nodes, best: results.length ? results[0].score : null, elapsed: t - t0 });
      }
    }
    if (d === D) return evalLeaf();
    if (results.length >= K && bound(d, start, curLin) <= threshold + EPS) return;
    if (hasMins && !canReachMins(d)) return;

    const list = cands[d];
    const last = list.length - 1;
    const next = sameNext[d];
    for (let j = start; j <= last; j++) {
      const c = list[j];
      if (c.lim >= 0 && limCnt[c.lim] >= limMax[c.lim]) continue;
      if (c.item) {
        for (let i = 0; i < NS; i++) cur[i] += c.v[i];
        if (c.set >= 0) cnt[c.set]++;
        if (c.lim >= 0) limCnt[c.lim]++;
      }
      pick[d] = j;
      const ns = next ? (c.item ? (dupAt[d] ? j : j + 1) : last) : 0;
      dfs(d + 1, ns, curLin + c.lin);
      if (c.item) {
        for (let i = 0; i < NS; i++) cur[i] -= c.v[i];
        if (c.set >= 0) cnt[c.set]--;
        if (c.lim >= 0) limCnt[c.lim]--;
      }
      if (truncated) return;
    }
  }

  dfs(0, 0, lin(baseVec));

  return {
    results: results.map((r) => ({
      score: r.score,
      picks: order.map((s, d) => ({ slot: s.id, itemId: cands[d][r.picks[d]].item?.id ?? null })),
    })),
    nodes,
    leaves,
    elapsed: now() - t0,
    truncated,
    pruned,
    candidateCount,
    hasMins: STAT_KEYS.some((k) => num(P.mins?.[k]) !== null),
  };
}

// Drop set-less, unlimited items that can never beat `need` other such items of the same
// slot type on every stat that matters (they could always be swapped for one of those).
function pruneDominated(list, need, dir) {
  const free = (c) => c.set < 0 && c.lim < 0;
  const keep = [];
  for (let a = 0; a < list.length; a++) {
    const A = list[a];
    if (!free(A)) {
      keep.push(A);
      continue;
    }
    let dominators = 0;
    for (let b = 0; b < list.length && dominators < need; b++) {
      if (b === a || !free(list[b])) continue;
      if (dominates(list[b], A, dir, b < a)) dominators++;
    }
    if (dominators < need) keep.push(A);
  }
  return keep;
}

function dominates(B, A, dir, tieWins) {
  let strict = false;
  for (let i = 0; i < NS; i++) {
    const d = dir[i];
    if (!d) continue;
    const x = B.v[i];
    const y = A.v[i];
    if (d === 1) {
      if (x < y) return false;
      if (x > y) strict = true;
    } else if (d === -1) {
      if (x > y) return false;
      if (x < y) strict = true;
    } else if (x !== y) return false;
  }
  return strict || tieWins;
}
