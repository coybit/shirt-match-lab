// Ideas borrowed from other games, tested head to head
const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const cfg=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const pool=E.buildPool(data,cfg);
const names=['random','zigzag','twocount','fullzz','counter','mixzz','exploit','gambit','riskaware','tempo','rackleave'];
const T=E.tournament(pool,names,200,40,777,1000);
fs.writeFileSync('out/crossgame.json',JSON.stringify(T));
const avg=T.winRate.map(r=>r.reduce((a,b)=>a+b,0)/names.length);
names.map((n,i)=>[n,i]).sort((a,b)=>avg[b[1]]-avg[a[1]]).forEach(([n,i])=>console.log(n.padEnd(10),(100*avg[i]).toFixed(1).padStart(5),'| vs random',(100*T.winRate[i][0]).toFixed(0),' vs zigzag',(100*T.winRate[i][1]).toFixed(0),' vs fullzz',(100*T.winRate[i][3]).toFixed(0),' vs counter',(100*T.winRate[i][4]).toFixed(0)));
