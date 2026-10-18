const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const base=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const clone=o=>JSON.parse(JSON.stringify(o));
const scen={ 'Sticker deck (default)':c=>{}, 'Detailed colours':c=>{c.colour.scheme='detailed';}, 'Whole football world':c=>{c.popularity.enabled=false;c.popularity.top_n=0;}, 'National teams only':c=>{c.deck_population.clubs=false;c.popularity.top_n=0;}, 'Every colour counts (variant)':c=>{c.colour.rule='all';} };
const strs=Object.keys(E.STRATEGIES).filter(s=>s!=='random'); const out={};
for(const [name,f] of Object.entries(scen)){ const c=clone(base); f(c); const pool=E.buildPool(data,c); const R=E.rng(77); const mk=E.makeDeckFactory(pool,40); const o={R,F:pool.F,popD:E.missTable(pool.masks,pool.F),popDist:pool.masks,maxSets:1000};
  out[name]={pMatch:E.matchProbability(pool)}; for(const s of strs){ let w=0,dr=0,sets=0; const G=300; for(let g=0;g<G;g++){ const r=E.playGame(mk(R),s,'random',o); w+=r.winner===0; dr+=r.winner<0; sets+=r.sets;} out[name][s]={win:w/G,draw:dr/G,sets:sets/G}; }
  console.log(name, 'P(match)',out[name].pMatch.toFixed(3), strs.map(s=>s+':'+(100*out[name][s].win).toFixed(0)).join(' ')); }
// deck size effect for counter vs random
out.deckSize={}; { const pool=E.buildPool(data,base); const R=E.rng(5); for(const N of [10,20,40,80]){ const mk=E.makeDeckFactory(pool,N); const o={R,F:pool.F,popD:E.missTable(pool.masks,pool.F),popDist:pool.masks,maxSets:1000}; let w=0,s=0; for(let g=0;g<300;g++){ const r=E.playGame(mk(R),'counter','random',o); w+=r.winner===0; s+=r.sets;} const pe=E.setLengthLaw(pool); const ch=E.cardChain(pe,N); out.deckSize[N]={counterVsRandom:w/300, sets:s/300, randomExpectedSets:ch[N/2-1].setsIfStarter}; console.log('N',N,out.deckSize[N]); } }
fs.writeFileSync('out/vs_random.json',JSON.stringify(out,null,1));
