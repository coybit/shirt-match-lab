// usage: node src/run_tournament.js <games> <deckSize> <scheme> <popularity on|off> <outfile> [strategies,comma]
const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const cfg=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const [games='200',deck='40',scheme='basic',popOn='on',out='out/tourn.json',strs]=process.argv.slice(2);
cfg.colour.scheme=scheme; cfg.popularity.enabled=popOn==='on'; if(popOn!=='on') cfg.popularity.top_n=0;
const pool=E.buildPool(data,cfg);
const names=strs?strs.split(','):Object.keys(E.STRATEGIES);
const t=Date.now();
const T=E.tournament(pool,names,+games,+deck,12345,+(process.env.MAXSETS||1000));
T.meta={games:+games,deck:+deck,scheme,pop:popOn,pMatch:E.matchProbability(pool),teams:pool.teams,ms:Date.now()-t};
fs.writeFileSync(out,JSON.stringify(T));
const avg=T.winRate.map(r=>r.reduce((a,b)=>a+b,0)/r.length);
names.map((n,i)=>[n,avg[i]]).sort((a,b)=>b[1]-a[1]).forEach(([n,a])=>console.log(n.padEnd(12),a.toFixed(3)));
console.log(T.meta);
