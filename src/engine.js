/* Football Shirt Colour Matching Game — shared engine (Node + browser).
 *
 *  1. colours  : hex -> everyday colour family (basic / detailed schemes)
 *  2. pool     : real teams x kits -> weighted card pool (assumptions are parameters)
 *  3. game     : exact rules simulation (2 players, sets, reorder between sets)
 *  4. strategy : ordering strategies, incl. an exact set-win optimiser
 *  5. analysis : match probability, set-win formulas, tournaments
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 1. COLOURS ---------------- */
  const SCHEMES = {
    detailed: ['white', 'black', 'grey', 'red', 'claret', 'orange', 'brown', 'yellow', 'green', 'sky', 'blue', 'navy', 'purple', 'pink'],
    basic: ['white', 'black', 'grey', 'red', 'orange', 'brown', 'yellow', 'green', 'blue', 'purple', 'pink'],
  };
  const BASIC_OF = { claret: 'red', sky: 'blue', navy: 'blue' };
  const SWATCH = { white: '#f4f4f4', black: '#111111', grey: '#8a8a8a', red: '#d7191c', claret: '#7a1131', orange: '#f28c28',
    brown: '#7b4a26', yellow: '#f6d32d', green: '#1a8a3a', sky: '#6cb4e4', blue: '#1f4fbf', navy: '#14224d', purple: '#6a2c91', pink: '#f49ac2' };

  function hexToDetailed(hex) {
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn, l = (mx + mn) / 2;
    if (c < 0.12) return l > 0.8 ? 'white' : l < 0.22 ? 'black' : 'grey';
    if (l >= 0.88 && c < 0.35) return 'white'; // cream / off-white
    if (mx < 0.18) return 'black';
    let h;
    if (mx === r) h = 60 * (((g - b) / c) % 6); else if (mx === g) h = 60 * ((b - r) / c + 2); else h = 60 * ((r - g) / c + 4);
    if (h < 0) h += 360;
    if ((h >= 290 || h < 8) && l > 0.7) return 'pink';
    if (h >= 335 || h < 8) return mx < 0.62 ? 'claret' : 'red';
    if (h < 40) return mx < 0.55 ? 'brown' : 'orange';
    if (h < 70) return mx < 0.55 ? 'brown' : 'yellow';
    if (h < 170) return 'green';
    if (h < 200) return mx < 0.5 ? 'green' : 'sky';
    if (h < 250) return mx < 0.45 ? 'navy' : l > 0.6 ? 'sky' : 'blue';
    if (h < 290) return 'purple';
    return l > 0.6 ? 'pink' : (h > 315 ? 'claret' : 'purple');
  }
  function familyOf(hex, scheme) {
    const d = hexToDetailed(hex);
    return scheme === 'basic' ? (BASIC_OF[d] || d) : d;
  }
  /** Default tie-break order for the "one colour per card" rule: chromatic colours before white/black/grey,
   *  because people call a red-and-white striped shirt "red". */
  const DEFAULT_PRIORITY = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'claret', 'navy', 'sky', 'brown', 'black', 'grey', 'white'];
  /** kit colours [[hex,share],...] -> bitmask of colour families.
   *  rule 'dominant' (default, the original game): exactly ONE colour = the family covering most of the shirt;
   *     families within tie_tolerance of the top share are a tie, broken by tie_priority.
   *  rule 'all': every family covering >= min_share of the shirt.                                              */
  function kitMask(kit, scheme, minShare, colourCfg) {
    if (!kit) return 0;
    const fams = SCHEMES[scheme], acc = {};
    for (const [hex, s] of kit) { const f = familyOf(hex, scheme); acc[f] = (acc[f] || 0) + s; }
    const cc = colourCfg || {};
    if ((cc.rule || 'dominant') === 'dominant') {
      const tol = cc.tie_tolerance ?? 0.05, pri = (cc.tie_priority || DEFAULT_PRIORITY).map((f) => scheme === 'basic' ? (BASIC_OF[f] || f) : f);
      let top = 0; for (const f in acc) top = Math.max(top, acc[f]);
      const tied = Object.keys(acc).filter((f) => acc[f] >= top - tol - 1e-9);
      tied.sort((a, b) => { const ia = pri.indexOf(a), ib = pri.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || acc[b] - acc[a]; });
      return 1 << fams.indexOf(tied[0]);
    }
    let m = 0;
    for (const f in acc) if (acc[f] >= minShare) m |= 1 << fams.indexOf(f);
    return m;
  }
  const popcount = (x) => { let n = 0; while (x) { x &= x - 1; n++; } return n; };
  const maskNames = (m, scheme) => SCHEMES[scheme].filter((_, i) => m >> i & 1);

  /* ---------------- 2. POOL ---------------- */
  /** data = processed teams.json; cfg = assumptions (see config/assumptions.json); overrides = per-team kit usage
   *  returns {entries:[{team,kit,mask,w}], masks:Map(mask->prob), teams:n} */
  function buildPool(data, cfg, overrides = {}) {
    const C = data.confederations, pop = cfg.popularity, dp = cfg.deck_population;
    const scheme = cfg.colour.scheme, minShare = cfg.colour.min_share, ku = cfg.kit_usage, mps = cfg.matches_per_season;
    let teams = data.teams.filter((t) => {
      const [, type, cls, , , cf] = t;
      if (type === 'c' && !dp.clubs) return false;
      if (type === 'n' && !dp.national) return false;
      if (cls === 'w' && !dp.women) return false;
      if (cls === 'y' && !dp.youth_other) return false;
      const conf = cf >= 0 ? C[cf] : null;
      if (type === 'n' && conf === 'Non-FIFA / other' && !dp.non_fifa_national) return false;
      if (dp.confederations && dp.confederations.length && conf && conf !== 'Non-FIFA / other' && !dp.confederations.includes(conf)) return false;
      if (dp.countries && dp.countries.length && !dp.countries.includes(data.countries[t[3]])) return false;
      if (dp.leagues && dp.leagues.length && !dp.leagues.includes(data.leagues[t[6]])) return false;
      return true;
    });
    if (pop.top_n && pop.top_n > 0) teams = teams.slice().sort((a, b) => b[8] - a[8]).slice(0, pop.top_n);
    const entries = [];
    for (const t of teams) {
      const [name, type, , , , , , level, sl] = t;
      const matches = type === 'n' ? mps.national : (mps.club_level[level] ?? mps.club_level.default);
      const popW = pop.enabled ? Math.pow(Math.max(1, sl), pop.exponent) : 1;
      const tw = matches * popW;
      const use = overrides[name] || ku;
      const shares = [use.home, use.away, use.third];
      const masks = t[10].map((k) => kitMask(k, scheme, minShare, cfg.colour));
      let tot = 0; masks.forEach((m, i) => { if (m) tot += shares[i]; });
      if (!tot) continue;
      masks.forEach((m, i) => { if (m && shares[i] > 0) entries.push({ team: name, kit: i, mask: m, w: tw * shares[i] / tot }); });
    }
    const W = entries.reduce((s, e) => s + e.w, 0);
    const masks = new Map();
    for (const e of entries) { e.p = e.w / W; masks.set(e.mask, (masks.get(e.mask) || 0) + e.p); }
    return { entries, masks, teams: teams.length, scheme, F: SCHEMES[scheme].length };
  }

  /** pool from the history sample (seasons), optional year range */
  function buildHistoryPool(data, cfg, fromYear, toYear) {
    const fake = { ...data, teams: data.history.filter((h) => h[1] >= fromYear && h[1] <= toYear)
      .map((h) => [h[0] + ' ' + h[2].match(/^\S+/)[0], 'c', 'm', -1, -1, -1, -1, 1, 1, h[1], h[3]]) };
    const c2 = JSON.parse(JSON.stringify(cfg));
    c2.popularity.enabled = false; c2.popularity.top_n = 0; c2.deck_population.confederations = [];
    return buildPool(fake, c2);
  }

  /* ---------------- maths helpers ---------------- */
  /** d[x] = P(random card from dist shares NO colour with mask x)   (subset-sum / zeta transform) */
  function missTable(dist, F) {
    const N = 1 << F, f = new Float64Array(N);
    for (const [m, p] of dist) f[m] += p;
    for (let i = 0; i < F; i++) for (let S = 0; S < N; S++) if (S >> i & 1) f[S] += f[S ^ (1 << i)];
    const d = new Float64Array(N), full = N - 1;
    for (let x = 0; x < N; x++) d[x] = f[full ^ x];
    return d;
  }
  /** probability two independent random cards share a colour */
  function matchProbability(pool) {
    const d = missTable(pool.masks, pool.F); let s = 0;
    for (const [m, p] of pool.masks) s += p * (1 - d[m]);
    return s;
  }
  function familyFrequencies(pool) {
    const fr = new Array(pool.F).fill(0);
    for (const [m, p] of pool.masks) for (let i = 0; i < pool.F; i++) if (m >> i & 1) fr[i] += p;
    return SCHEMES[pool.scheme].map((n, i) => ({ name: n, p: fr[i] }));
  }

  /* ---------------- RNG + sampling ---------------- */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function sampler(pool) {
    const cum = []; let acc = 0; for (const e of pool.entries) { acc += e.p; cum.push(acc); }
    return (R) => { const u = R() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = lo + hi >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; } return pool.entries[lo]; };
  }
  function shuffle(a, R) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------------- 3. SET-WIN FORMULA ---------------- */
  /** Exact outcome of one set for MY order `a` (masks), opponent cards iid with miss-table d.
   *  Returns {win, lose, swing}: probabilities and expected card swing for me.
   *  Starter sequence: a1 b1 a2 b2 ...   b_k checked against a_k (opp attack), a_k against b_{k-1} (my attack).
   *  Key identity: P(b misses a_{k-1} and hits a_k) = d(a_{k-1}) - d(a_{k-1}|a_k).                        */
  function setOutcome(a, d, starter, oppLen) {
    let alive = 1, win = 0, lose = 0, swing = 0, prev = -1; // prev = my previous card mask (opp's current card is conditioned on missing it)
    const n = a.length;
    let myPlayed = 0, oppPlayed = 0;
    const oppTurn = () => { // opponent plays a fresh card, attacks my last card
      if (oppPlayed >= oppLen) { win += alive; swing += alive * (myPlayed > 0 ? oppPlayed : 0); alive = 0; return; } // opp ran out => game won
      oppPlayed++;
      if (myPlayed > 0) { const pHit = 1 - d[a[myPlayed - 1]]; lose += alive * pHit; swing -= alive * pHit * myPlayed; alive *= (1 - pHit); prev = a[myPlayed - 1]; }
      else prev = 0; // opponent opened the set: nothing to attack yet
    };
    const myTurn = () => {
      if (myPlayed >= n) { lose += alive; swing -= alive * n; alive = 0; return; }
      const x = a[myPlayed]; myPlayed++;
      if (oppPlayed > 0) { // attack opp's last card, which is known to miss `prev`
        const dp = prev === 0 ? 1 : d[prev];
        const pHit = dp > 0 ? (dp - d[prev | x]) / dp : 0;
        win += alive * pHit; swing += alive * pHit * oppPlayed; alive *= (1 - pHit);
      }
    };
    if (starter) { while (alive > 1e-9) { myTurn(); if (alive <= 1e-9) break; oppTurn(); } }
    else { while (alive > 1e-9) { oppTurn(); if (alive <= 1e-9) break; myTurn(); } }
    return { win, lose, swing };
  }

  /** Same model as setOutcome, but returns every way the set can end:
   *  [{p, win:true|false, mine: my cards laid, theirs: their cards laid}]  (used by risk/tempo/value strategies) */
  function setDist(a, d, starter, oppLen) {
    const ev = []; let alive = 1, prev = -1, myPlayed = 0, oppPlayed = 0; const n = a.length;
    const oppTurn = () => { if (oppPlayed >= oppLen) { ev.push({ p: alive, win: true, mine: myPlayed, theirs: oppPlayed, out: true }); alive = 0; return; }
      oppPlayed++; if (myPlayed > 0) { const ph = 1 - d[a[myPlayed - 1]]; if (ph > 0) ev.push({ p: alive * ph, win: false, mine: myPlayed, theirs: oppPlayed }); alive *= 1 - ph; prev = a[myPlayed - 1]; } else prev = 0; };
    const myTurn = () => { if (myPlayed >= n) { ev.push({ p: alive, win: false, mine: n, theirs: oppPlayed, out: true }); alive = 0; return; }
      const x = a[myPlayed]; myPlayed++; if (oppPlayed > 0) { const dp = prev === 0 ? 1 : d[prev]; const ph = dp > 0 ? (dp - d[prev | x]) / dp : 0; if (ph > 0) ev.push({ p: alive * ph, win: true, mine: myPlayed, theirs: oppPlayed }); alive *= 1 - ph; } };
    let guard = 0;
    if (starter) { while (alive > 1e-7 && guard++ < 400) { myTurn(); if (alive <= 1e-7) break; oppTurn(); } }
    else { while (alive > 1e-7 && guard++ < 400) { oppTurn(); if (alive <= 1e-7) break; myTurn(); } }
    return ev;
  }
  /** Value of going second instead of first in a set (in cards), under random play: chess "tempo". */
  const tempoCache = new WeakMap();
  function tempoValue(popDist, F, popD) {
    if (tempoCache.has(popD)) return tempoCache.get(popD);
    const pe = setLengthLaw({ masks: popDist, F }, 60); let eStart = 0;
    for (let L = 2; L < pe.length; L++) eStart += pe[L] * (L % 2 === 1 ? (L - 1) / 2 : -(L / 2));
    const v = -2 * eStart; tempoCache.set(popD, v); return v;
  }
  function zigzagAfter(first, rest, d) { const left = rest.slice(), out = [first]; let prev = first.mask;
    while (left.length) { let bi = 0, bs = -1; for (let i = 0; i < left.length; i++) { const x = left[i].mask, dp = d[prev]; const g = dp > 0 ? (dp - d[prev | x]) / dp : 0; if (g > bs) { bs = g; bi = i; } }
      const c = left.splice(bi, 1)[0]; out.push(c); prev = c.mask; } return out; }
  function histDist(masks, popDist, prior = 3) { // smoothed empirical distribution of an opponent's habit
    const dist = new Map(); const n = masks.length + prior;
    for (const m of masks) dist.set(m, (dist.get(m) || 0) + 1 / n);
    for (const [m, pr] of popDist) dist.set(m, (dist.get(m) || 0) + pr * prior / n);
    return dist; }
  /* ---------------- 4. STRATEGIES ----------------
   * Each strategy: (ctx) -> new order of ctx.hand (array of card objects {id, mask}).
   * ctx = {hand, starter, oppLen, popD (miss table of the population), countD (miss table using remembered cards),
   *        F, R, pHit(mask, d)}                                                                                 */
  const pHitOf = (m, d) => 1 - d[m];
  function optimise(ctx, d, objective) {
    const h = shuffle(ctx.hand.slice(), ctx.R);
    // greedy start: alternate attack/defence aware, then 2-opt swaps on the set objective
    h.sort((x, y) => pHitOf(y.mask, d) - pHitOf(x.mask, d));
    const score = typeof objective === 'function' ? (arr) => objective(arr.map((c) => c.mask)) : (arr) => { const o = setOutcome(arr.map((c) => c.mask), d, ctx.starter, ctx.oppLen); return objective === 'win' ? o.win - o.lose : o.swing; };
    let best = score(h), improved = true, guard = 0;
    const K = Math.min(h.length, 14); // sets rarely last longer; only the prefix matters
    while (improved && guard++ < 30) {
      improved = false;
      for (let i = 0; i < K; i++) for (let j = i + 1; j < h.length; j++) {
        if (h[i].mask === h[j].mask) continue;
        [h[i], h[j]] = [h[j], h[i]];
        const s = score(h);
        if (s > best + 1e-12) { best = s; improved = true; } else [h[i], h[j]] = [h[j], h[i]];
      }
    }
    return h;
  }
  function diversifyChain(ctx, d) {
    // greedy path: next card adds the most NEW attacking power given the previous card (graph path on 'disjointness')
    const left = shuffle(ctx.hand.slice(), ctx.R), out = [];
    let prev = 0;
    while (left.length) {
      let bi = 0, bs = -1;
      for (let i = 0; i < left.length; i++) {
        const x = left[i].mask, dp = prev ? d[prev] : 1;
        const gain = dp > 0 ? (dp - d[prev | x]) / dp : 0; // attack prob vs a card that missed prev
        const s = gain - 0.5 * pHitOf(x, d);            // minus exposure to counter-attack
        if (s > bs) { bs = s; bi = i; }
      }
      const c = left.splice(bi, 1)[0]; out.push(c); prev = c.mask;
    }
    return out;
  }
  function shieldZigzag(ctx, d) {
    // 1) open with the rarest shirt (a 'shield': hard to hit), 2) each next card = the one most likely to hit
    //    an opponent card that has just MISSED my previous card (so: switch colour camp every card)
    const left = shuffle(ctx.hand.slice(), ctx.R).sort((a, b) => pHitOf(a.mask, d) - pHitOf(b.mask, d));
    const out = [left.shift()]; let prev = out[0].mask;
    while (left.length) {
      let bi = 0, bs = -1;
      for (let i = 0; i < left.length; i++) { const x = left[i].mask, dp = d[prev]; const g = dp > 0 ? (dp - d[prev | x]) / dp : 0; if (g > bs) { bs = g; bi = i; } }
      const c = left.splice(bi, 1)[0]; out.push(c); prev = c.mask;
    }
    return out;
  }
  /** "Blackjack-style" simple count: the player only tracks how many cards of a few colours (e.g. just white)
   *  are known to be in the opponent's hand. Everything else is assumed to follow average football.
   *  P(next card has colour c) = (known c + unseen × p_c) / hand size for counted colours; the remaining
   *  probability is spread over the other card types in their usual proportions.                         */
  function simpleCountDist(opp, revealed, popDist, colours, scheme) {
    const fams = SCHEMES[scheme], bits = colours.map((c) => 1 << fams.indexOf(c)).filter((b) => b > 0);
    const n = opp.length || 1; let unknown = 0; const known = bits.map(() => 0);
    for (const c of opp) { if (revealed[c.id]) bits.forEach((b, i) => { if (c.mask & b) known[i]++; }); else unknown++; }
    const counted = new Map(); let rest = 0, restPop = 0;
    for (const [m, pr] of popDist) { const i = bits.findIndex((b) => (m & b) === b && m === b); if (i < 0) { restPop += pr; } }
    let used = 0;
    bits.forEach((b, i) => { const pc = popDist.get(b) || 0; const v = Math.min(1, (known[i] + unknown * pc) / n); counted.set(b, v); used += v; });
    rest = Math.max(0, 1 - used);
    const dist = new Map(counted);
    for (const [m, pr] of popDist) if (!counted.has(m)) dist.set(m, (dist.get(m) || 0) + (restPop > 0 ? pr / restPop * rest : 0));
    return dist;
  }
  const STRATEGIES = {
    random:        { label: 'Random shuffle', info: 'none', fn: (c) => shuffle(c.hand.slice(), c.R),
                     why: 'Baseline: no thinking at all.' },
    keep:          { label: 'Never reorder', info: 'none', fn: (c) => c.hand.slice(),
                     why: 'Just append won cards to the bottom (classic “War” behaviour).' },
    colourful:     { label: 'Colourful first', info: 'none', fn: (c) => shuffle(c.hand.slice(), c.R).sort((x, y) => popcount(y.mask) - popcount(x.mask)),
                     why: 'Multi-colour shirts hit more, so lead with them.' },
    plain:         { label: 'Plain first', info: 'none', fn: (c) => shuffle(c.hand.slice(), c.R).sort((x, y) => popcount(x.mask) - popcount(y.mask)),
                     why: 'Single-colour shirts are harder to hit — defend first.' },
    common:        { label: 'Common colours first', info: 'population', fn: (c) => shuffle(c.hand.slice(), c.R).sort((x, y) => pHitOf(y.mask, c.popD) - pHitOf(x.mask, c.popD)),
                     why: 'Uses real colour frequencies: lead with shirts most likely to share a colour.' },
    rare:          { label: 'Rare colours first', info: 'population', fn: (c) => shuffle(c.hand.slice(), c.R).sort((x, y) => pHitOf(x.mask, c.popD) - pHitOf(y.mask, c.popD)),
                     why: 'Lead with shirts nobody can match (pure defence), keep hitters for later.' },
    role:          { label: 'Role-aware opener', info: 'population', fn: (c) => {
                       const h = shuffle(c.hand.slice(), c.R).sort((x, y) => pHitOf(y.mask, c.popD) - pHitOf(x.mask, c.popD));
                       if (c.starter) { const r = h.pop(); h.unshift(r); } return h; },
                     why: 'As starter your first card can only be hit, never hit — open with the rarest; otherwise open with the most common.' },
    diversify:     { label: 'Diversify consecutive cards', info: 'population', fn: (c) => diversifyChain(c, c.popD),
                     why: 'Your card k+1 can only beat an opponent card that already missed card k, so repeating colours wastes attacks.' },
    zigzag:        { label: 'Shield + zig-zag', info: 'population', fn: (c) => shieldZigzag(c, c.popD),
                     why: 'A rule a kid can use: open with your rarest shirt, then keep switching colour camp (white/red ↔ blue/black ↔ …).' },
    whitecount:    { label: 'White count (1 number)', info: 'count', countColours: ['white'], fn: (c) => shieldZigzag(c, c.countD),
                     why: 'Blackjack-style: keep one running count of white cards in their hand, then play shield + zig-zag using it.' },
    twocount:      { label: 'White + red count (2 numbers)', info: 'count', countColours: ['white', 'red'], fn: (c) => shieldZigzag(c, c.countD),
                     why: 'Two running counts, for the two most common colours, then shield + zig-zag.' },
    fullzz:        { label: 'Full count + zig-zag', info: 'memory', fn: (c) => shieldZigzag(c, c.countD),
                     why: 'Remembers every revealed card (all colours), but orders with the simple shield + zig-zag rule.' },
    mixzz:         { label: 'Balanced opener (poker)', info: 'memory', fn: (c) => {
                       const h = shuffle(c.hand.slice(), c.R).sort((x, y) => pHitOf(x.mask, c.countD) - pHitOf(y.mask, c.countD));
                       const k = Math.min(3, h.length), i = Math.floor(c.R() * k); const first = h.splice(i, 1)[0];
                       return zigzagAfter(first, h, c.countD); },
                     why: 'Poker’s balanced play: pick the opener at random among your three safest cards, so a counting opponent can’t predict it.' },
    exploit:       { label: 'Opponent reader (poker)', info: 'memory', fn: (c) => {
                       const h = shuffle(c.hand.slice(), c.R); const hist = c.history || [];
                       const theirOpeners = hist.filter((s) => s.starter !== c.me && s.first[1 - c.me] >= 0).map((s) => s.first[1 - c.me]);
                       const theirReplies = hist.filter((s) => s.starter === c.me && s.first[1 - c.me] >= 0).map((s) => s.first[1 - c.me]);
                       let first;
                       if (c.starter) { const D = missTable(histDist(theirReplies, c.popDist), c.F); h.sort((x, y) => (pHitOf(x.mask, D) + pHitOf(x.mask, c.countD)) - (pHitOf(y.mask, D) + pHitOf(y.mask, c.countD))); first = h.shift(); }
                       else { const D = missTable(histDist(theirOpeners, c.popDist), c.F); h.sort((x, y) => pHitOf(y.mask, D) - pHitOf(x.mask, D)); first = h.shift(); }
                       return zigzagAfter(first, h, c.countD); },
                     why: 'Poker’s player reading: learn which colours this opponent likes to open and reply with, then aim your first card at those habits.' },
    gambit:        { label: 'Gambit for tempo (chess)', info: 'memory', fn: (c) => {
                       const h = shuffle(c.hand.slice(), c.R);
                       if (c.starter && c.hand.length >= c.oppLen) { h.sort((x, y) => pHitOf(y.mask, c.countD) - pHitOf(x.mask, c.countD)); const first = h.shift(); return zigzagAfter(first, h, c.countD); }
                       return shieldZigzag(c, c.countD); },
                     why: 'Chess gambit: when ahead and forced to start, sacrifice one card on purpose (an easy-to-match opener) to go second next set.' },
    riskaware:     { label: 'Risk by score (backgammon)', info: 'memory', fn: (c) => {
                       const lead = (c.hand.length - c.oppLen) / (c.hand.length + c.oppLen || 1); const k = lead > 0.1 ? -0.6 : lead < -0.1 ? 0.6 : 0;
                       return optimise(c, c.countD, (a) => { const ev = setDist(a, c.countD, c.starter, c.oppLen); let m = 0, m2 = 0; for (const e of ev) { const x = e.win ? e.theirs : -e.mine; m += e.p * x; m2 += e.p * x * x; } return m + k * Math.sqrt(Math.max(0, m2 - m * m)); }); },
                     why: 'Backgammon’s score-aware play: when ahead, prefer safe orders with small swings; when behind, take risks for big piles.' },
    tempo:         { label: 'Tempo lookahead (chess)', info: 'memory', fn: (c) => {
                       const V = tempoValue(c.popDist, c.F, c.popD);
                       return optimise(c, c.countD, (a) => { const o = setOutcome(a, c.countD, c.starter, c.oppLen); return o.swing + V / 2 * (o.lose - o.win); }); },
                     why: 'Chess/backgammon equity: count not just the cards in this set, but the value of going second in the next one (losing a set gives you the better seat).' },
    rackleave:     { label: 'Keep your shields (Scrabble)', info: 'memory', fn: (c) => {
                       const val = (m) => 1 + 0.8 * c.popD[m]; // rare cards (often missed) are future shields: worth more
                       let avgOpp = 0; for (const [m, p] of c.popDist) avgOpp += p * val(m);
                       return optimise(c, c.countD, (a) => { const ev = setDist(a, c.countD, c.starter, c.oppLen); let s = 0; for (const e of ev) { if (e.win) s += e.p * e.theirs * avgOpp; else { let lost = 0; for (let i = 0; i < e.mine; i++) lost += val(a[i]); s -= e.p * lost; } } return s; }); },
                     why: 'Scrabble’s “rack leave”: judge an order by the value of the cards you keep, not just how many. Rare shields are worth protecting.' },
    optimal:       { label: 'Set optimiser', info: 'population', fn: (c) => optimise(c, c.popD, 'swing'),
                     why: 'Exact formula for expected card swing of the next set + local search over orders.' },
    counter:       { label: 'Card counter + optimiser', info: 'memory', fn: (c) => optimise(c, c.countD, 'swing'),
                     why: 'Remembers every revealed card, so knows much of the opponent’s hand composition.' },
  };

  /* ---------------- 3b. GAME SIMULATION ---------------- */
  /** deck: array of masks. Returns {winner:0|1|-1, sets, cards:[n0,n1], setLengths:[]} */
  function playGame(deck, sA, sB, opts) {
    const R = opts.R, F = opts.F, popD = opts.popD, popDist = opts.popDist;
    const cards = deck.map((m, id) => ({ id, mask: m }));
    shuffle(cards, R);
    const hands = [[], []];
    cards.forEach((c, i) => hands[i % 2].push(c));
    const strat = [STRATEGIES[sA], STRATEGIES[sB]];
    const revealed = new Uint8Array(cards.length);
    let starter = R() < 0.5 ? 0 : 1, sets = 0;
    const setLengths = [];
    const ctxFor = (p) => {
      const opp = hands[1 - p];
      let countD = popD;
      if (strat[p].info === 'memory') {
        const known = new Map(); let unknown = 0;
        for (const c of opp) if (revealed[c.id]) known.set(c.mask, (known.get(c.mask) || 0) + 1); else unknown++;
        const dist = new Map(); const n = opp.length || 1;
        for (const [m, k] of known) dist.set(m, (dist.get(m) || 0) + k / n);
        if (unknown) for (const [m, pr] of popDist) dist.set(m, (dist.get(m) || 0) + pr * unknown / n);
        countD = missTable(dist, F);
      } else if (strat[p].info === 'count') {
        countD = missTable(simpleCountDist(opp, revealed, popDist, strat[p].countColours, opts.scheme || 'basic'), F);
      }
      return { hand: hands[p], starter: starter === p, oppLen: opp.length, popD, countD, F, R, popDist, me: p, history: setsLog };
    };
    const setsLog = [];
    // initial ordering before the first set
    for (const p of [0, 1]) hands[p] = strat[p].fn(ctxFor(p));
    while (sets < opts.maxSets) {
      sets++;
      const pile = []; let turn = starter, prev = -1, len = 0, setWinner = -1; const firsts = [-1, -1];
      const rec = opts.trace ? { starter, plays: [], winner: -1 } : null;
      while (true) {
        if (!hands[turn].length) { if (rec) { rec.ranOut = turn; opts.trace.push(rec); } return { winner: 1 - turn, sets, cards: [hands[0].length, hands[1].length], setLengths, how: 'ran out mid-set' }; }
        const c = hands[turn].shift(); revealed[c.id] = 1; len++;
        if (rec) rec.plays.push([turn, c.id]);
        if (firsts[turn] < 0) firsts[turn] = c.mask;
        if (prev >= 0 && (c.mask & prev)) { hands[turn].push(...pile, c); setWinner = turn; break; }
        pile.push(c); prev = c.mask; turn = 1 - turn;
      }
      setLengths.push(len); setsLog.push({ starter, first: firsts, winner: setWinner });
      if (rec) { rec.winner = setWinner; rec.after = [hands[0].length, hands[1].length]; opts.trace.push(rec); }
      if (!hands[1 - setWinner].length) return { winner: setWinner, sets, cards: [hands[0].length, hands[1].length], setLengths, how: 'opponent emptied' };
      starter = setWinner;
      for (const p of [0, 1]) hands[p] = strat[p].fn(ctxFor(p));
    }
    return { winner: -1, sets, cards: [hands[0].length, hands[1].length], setLengths, how: 'max sets' };
  }

  function makeDeckFactory(pool, deckSize) {
    const draw = sampler(pool);
    return (R) => Array.from({ length: deckSize }, () => draw(R).mask);
  }

  /** round-robin tournament. returns matrix[i][j] = win rate of strategy i vs j (draws count half) */
  function tournament(pool, names, games, deckSize, seed, maxSets = 3000) {
    const R = rng(seed), F = pool.F, popDist = pool.masks, popD = missTable(popDist, F), mk = makeDeckFactory(pool, deckSize);
    const M = names.map(() => names.map(() => 0)), L = names.map(() => names.map(() => 0));
    for (let i = 0; i < names.length; i++) for (let j = 0; j < names.length; j++) {
      if (j < i) { M[i][j] = 1 - M[j][i]; L[i][j] = L[j][i]; continue; }
      let w = 0, sets = 0;
      for (let g = 0; g < games; g++) {
        const r = playGame(mk(R), names[i], names[j], { R, F, popD, popDist, maxSets, scheme: pool.scheme });
        w += r.winner === 0 ? 1 : r.winner === -1 ? 0.5 : 0; sets += r.sets;
      }
      M[i][j] = w / games; L[i][j] = sets / games;
    }
    return { names, winRate: M, avgSets: L };
  }


  /* ---------------- 5. EXACT MATHS ---------------- */
  /** Law of the set length under random play: pEnd[L] = P(the set ends with card L). Markov chain on the last card. */
  function setLengthLaw(pool, Lmax = 60) {
    const masks = [...pool.masks]; let dist = new Map(masks); const pEnd = [0, 0];
    for (let L = 2; L <= Lmax; L++) {
      const nd = new Map(); let hit = 0;
      for (const [m, p] of dist) for (const [x, px] of masks) { if (m & x) hit += p * px; else nd.set(x, (nd.get(x) || 0) + p * px); }
      pEnd[L] = hit; dist = nd;
    }
    return pEnd;
  }
  /** Markov chain on (cards held by player A, who starts the set), random play, N cards in total.
   *  Returns per k: P(A wins game) and expected number of sets, by solving (I-Q)x = b (absorbing chain). */
  function cardChain(pEnd, N) {
    const Lmax = pEnd.length - 1, id = (k, st) => (k - 1) * 2 + st, n = 2 * (N - 1);
    const Q = Array.from({ length: n }, () => new Float64Array(n)), absA = new Float64Array(n);
    for (let k = 1; k < N; k++) for (const st of [0, 1]) {
      const i = id(k, st), sC = st === 0 ? k : N - k, oC = N - sC; let rem = 1;
      for (let L = 2; L <= Lmax; L++) {
        if (Math.ceil(L / 2) > sC || Math.floor(L / 2) > oC) break;
        const p = pEnd[L]; rem -= p;
        const gain = L % 2 === 1 ? (L - 1) / 2 : -(L / 2), winner = L % 2 === 1 ? st : 1 - st;
        const kA = st === 0 ? sC + gain : oC - gain;
        if (kA >= N) absA[i] += p; else if (kA > 0) Q[i][id(kA, winner)] += p;
      }
      if (rem > 1e-12) { for (let L = 2; L < 1000; L++) { if (Math.ceil(L / 2) > sC) { if (st === 1) absA[i] += rem; break; } if (Math.floor(L / 2) > oC) { if (st === 0) absA[i] += rem; break; } } }
    }
    const solve = (b) => {
      const M = Q.map((r, i) => { const row = Array.from(r, (v, j) => (i === j ? 1 : 0) - v); row.push(b[i]); return row; });
      for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
        for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; } }
      return M.map((r, i) => r[n] / r[i]);
    };
    const W = solve(absA), T = solve(new Float64Array(n).fill(1)), out = [];
    for (let k = 1; k < N; k++) out.push({ k, winIfStarter: W[id(k, 0)], winIfSecond: W[id(k, 1)], setsIfStarter: T[id(k, 0)], setsIfSecond: T[id(k, 1)] });
    return out;
  }
  /** colour co-occurrence: co[i][j] = P(card shows colours i and j) */
  function colourGraph(pool) {
    const F = pool.F, co = Array.from({ length: F }, () => new Array(F).fill(0));
    for (const [m, p] of pool.masks) for (let i = 0; i < F; i++) if (m >> i & 1) for (let j = 0; j < F; j++) if (m >> j & 1) co[i][j] += p;
    return { names: SCHEMES[pool.scheme], co };
  }

  return { setDist, tempoValue, simpleCountDist, DEFAULT_PRIORITY, setLengthLaw, cardChain, colourGraph, SCHEMES, SWATCH, hexToDetailed, familyOf, kitMask, popcount, maskNames, buildPool, buildHistoryPool,
           missTable, matchProbability, familyFrequencies, rng, sampler, shuffle, setOutcome, STRATEGIES, playGame,
           makeDeckFactory, tournament };
});
