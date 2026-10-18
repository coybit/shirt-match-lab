/* Simulation worker: runs match-ups and tournaments off the main thread. */
importScripts('engine.js');
onmessage = (ev) => {
  const { cmd, pool, games, deckSize, names, seed, maxSets } = ev.data;
  const E = self.Engine, R = E.rng(seed || 1), F = pool.F;
  const popDist = pool.masks, popD = E.missTable(popDist, F), mk = E.makeDeckFactory(pool, deckSize);
  const opts = { R, F, popD, popDist, maxSets: maxSets || 3000, scheme: pool.scheme };
  if (cmd === 'matchup') {
    const [a, b] = names; let w = 0, l = 0, d = 0; const sets = [], setLens = new Array(21).fill(0);
    for (let g = 0; g < games; g++) {
      const r = E.playGame(mk(R), a, b, opts);
      if (r.winner === 0) w++; else if (r.winner === 1) l++; else d++;
      sets.push(r.sets); for (const L of r.setLengths) setLens[Math.min(L, 20)]++;
      if (g % 20 === 0) postMessage({ type: 'progress', done: g, total: games });
    }
    postMessage({ type: 'matchup', a, b, w, l, d, sets, setLens });
  } else if (cmd === 'tournament') {
    const n = names.length, M = names.map(() => names.map(() => 0)), S = names.map(() => names.map(() => 0));
    const pairs = []; for (let i = 0; i < n; i++) for (let j = i; j < n; j++) pairs.push([i, j]);
    let done = 0;
    for (const [i, j] of pairs) {
      let w = 0, s = 0;
      for (let g = 0; g < games; g++) { const r = E.playGame(mk(R), names[i], names[j], opts); w += r.winner === 0 ? 1 : r.winner === -1 ? 0.5 : 0; s += r.sets; }
      M[i][j] = w / games; M[j][i] = 1 - M[i][j]; S[i][j] = S[j][i] = s / games;
      postMessage({ type: 'progress', done: ++done, total: pairs.length });
    }
    postMessage({ type: 'tournament', names, winRate: M, avgSets: S, games, deckSize });
  } else if (cmd === 'trace') {
    const deck = []; const draw = E.sampler(pool); const ent = [];
    for (let i = 0; i < deckSize; i++) { const e = draw(R); deck.push(e.mask); ent.push(e); }
    const trace = []; const r = E.playGame(deck, names[0], names[1], { ...opts, trace });
    postMessage({ type: 'trace', result: r, trace, cards: ent.map((e) => ({ team: e.team, kit: e.kit, mask: e.mask })) });
  }
};
