// Head-to-head study of counting systems
const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const cfg=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const pool=E.buildPool(data,cfg); const names=['random','zigzag','whitecount','twocount','fullzz','optimal','counter'];
const T=E.tournament(pool,names,300,40,4242,1000);
fs.writeFileSync('out/counting.json',JSON.stringify(T));
names.forEach((n,i)=>console.log(n.padEnd(11),names.map((m,j)=>i===j?'  · ':(100*T.winRate[i][j]).toFixed(0).padStart(4)).join(''),'  avg',(100*T.winRate[i].reduce((a,b)=>a+b,0)/names.length).toFixed(1)));
