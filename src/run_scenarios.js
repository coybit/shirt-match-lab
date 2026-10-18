const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const base=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const clone=o=>JSON.parse(JSON.stringify(o));
const summ=(pool)=>({teams:pool.teams, pMatch:+E.matchProbability(pool).toFixed(4), avgColours:+[...pool.masks].reduce((s,[m,p])=>s+p*E.popcount(m),0).toFixed(3),
  freq:Object.fromEntries(E.familyFrequencies(pool).map(f=>[f.name,+f.p.toFixed(4)])),
  topCombos:[...pool.masks].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([m,p])=>[E.maskNames(m,pool.scheme).join('+'),+p.toFixed(4)])});
const res={scenarios:{}, confed:{}, leagues:{}, decades:{}, theory:{}};
const sc=(name,f)=>{ const c=clone(base); f(c); res.scenarios[name]=summ(E.buildPool(data,c)); };
sc('Sticker deck (default: top 300 by fame, pop^1)',c=>{});
sc('Top 100 most famous',c=>{c.popularity.top_n=100;});
sc('Whole football world (all men\'s teams, no fame weight)',c=>{c.popularity.enabled=false;c.popularity.top_n=0;});
sc('All men\'s teams, fame weighted',c=>{c.popularity.top_n=0;});
sc('Fame weight squared (top 300)',c=>{c.popularity.exponent=2;});
sc('Clubs only (top 300)',c=>{c.deck_population.national=false;});
sc('National teams only (FIFA men)',c=>{c.deck_population.clubs=false;c.popularity.top_n=0;c.popularity.enabled=false;});
sc('Women\'s teams only',c=>{c.deck_population.women=true;c.popularity.top_n=0;c.popularity.enabled=false; c._womenOnly=true;});
sc('Home kits only',c=>{c.kit_usage={home:1,away:0,third:0};});
sc('Detailed colour names',c=>{c.colour.scheme='detailed';});
sc('Variant: every colour counts (>=12% of shirt)',c=>{c.colour.rule='all';});
sc('Ties go to white/black first',c=>{c.colour.tie_priority=['white','black','grey','red','blue','green','yellow','orange','purple','pink','claret','navy','sky','brown'];});
sc('No tie tolerance (strict largest share)',c=>{c.colour.tie_tolerance=0;});
// women only needs filter: quick hack
{ const c=clone(base); c.deck_population.women=true; c.popularity.top_n=0; c.popularity.enabled=false; const d2={...data,teams:data.teams.filter(t=>t[2]==='w')}; res.scenarios["Women's teams only"]=summ(E.buildPool(d2,c)); }
for (const cf of ['UEFA','CONMEBOL','CONCACAF','CAF','AFC','OFC']) for (const typ of ['clubs','national']) {
  const c=clone(base); c.popularity.enabled=false; c.popularity.top_n=0; c.deck_population.confederations=[cf];
  if(typ==='clubs') c.deck_population.national=false; else c.deck_population.clubs=false;
  const d2={...data,teams:data.teams.filter(t=>t[5]>=0&&data.confederations[t[5]]===cf)};
  res.confed[cf+' '+typ]=summ(E.buildPool(d2,c)); }
for (const lg of ['Premier League','La Liga','Serie A','Bundesliga','Ligue 1','Eredivisie','Primeira Liga','Süper Lig','Scottish Premiership','Campeonato Brasileiro Série A','Argentine Primera División','Liga MX','Major League Soccer','J1 League','K League 1','Saudi Pro League','Persian Gulf Pro League','Egyptian Premier League','A-League Men','Russian Premier League']) {
  const c=clone(base); c.popularity.enabled=false; c.popularity.top_n=0; c.deck_population.national=false; c.deck_population.confederations=[]; c.deck_population.leagues=[lg];
  const p=E.buildPool(data,c); if(p.teams>=6) res.leagues[lg]=summ(p); }
for (let dec=1880; dec<=2020; dec+=10) { const p=E.buildHistoryPool(data,base,dec,dec+9); res.decades[dec+'s']=summ(p); res.decades[dec+'s'].seasons=data.history.filter(h=>h[1]>=dec&&h[1]<dec+10).length; }
// Theory check: second-mover advantage per set with random play
{ const c=clone(base); const pool=E.buildPool(data,c); const q=E.matchProbability(pool); const R=E.rng(99); const mk=E.makeDeckFactory(pool,40);
  let setsTot=0, secondWins=0, lens={}; const popD=E.missTable(pool.masks,pool.F);
  // simulate many independent sets (fresh shuffled cards each set) to compare with 1/(2-q)
  const draw=E.sampler(pool);
  for(let s=0;s<200000;s++){ let prev=-1, turn=0, len=0; while(true){ const m=draw(R).mask; len++; if(prev>=0&&(m&prev)){ if(turn===1) secondWins++; break;} prev=m; turn^=1; if(len>200)break;} setsTot++; lens[len]=(lens[len]||0)+1; }
  // exact formula with independent cards: P(second wins)= q / (1-(1-q)^2) is NOT exact because consecutive comparisons share a card; use transfer computation
  res.theory={pMatch:q, simSecondWinsSet:secondWins/setsTot, naiveIndependent:1/(2-q), setLength:Object.fromEntries(Object.entries(lens).slice(0,15).map(([k,v])=>[k,+(v/setsTot).toFixed(4)]))};
  // exact (Markov on last card) : iterate distribution
  const masks=[...pool.masks]; let dist=new Map(masks); let alive=1, pSecond=0, turn=0; // after first card played by player 0
  for(let step=0;step<400;step++){ turn^=1; const nd=new Map(); let hit=0; for(const [m,p] of dist){ for(const [x,px] of masks){ if(m&x) hit+=p*px; else nd.set(x,(nd.get(x)||0)+p*px);} } if(turn===1) pSecond+=hit; dist=nd; }
  res.theory.exactSecondWinsSet=pSecond;
}
fs.writeFileSync('out/scenarios.json',JSON.stringify(res,null,1));
for (const k of ['scenarios','confed','leagues','decades']) { console.log('== '+k); for (const [n,s] of Object.entries(res[k])) console.log(n.padEnd(48),'teams',String(s.teams).padStart(5),'P(match)',s.pMatch,'avgCol',s.avgColours,' top:',s.topCombos.slice(0,3).map(x=>x.join(' ')).join(', ')); }
console.log(res.theory);
