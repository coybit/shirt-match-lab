// Exact maths: set-length law, Markov chain on card counts, colour graph, threshold curve, orthogonality view
const E=require('./engine'); const fs=require('fs');
const data=JSON.parse(fs.readFileSync(__dirname+'/../data/processed/teams.json')); const cfg=JSON.parse(fs.readFileSync(__dirname+'/../config/assumptions.json'));
const pool=E.buildPool(data,cfg); const masks=[...pool.masks]; const out={};
// 1. set length distribution (random play, unlimited hands): Markov chain on last card's mask
const Lmax=60; let dist=new Map(masks); const pEnd=[0,0]; // pEnd[L] = P(set ends exactly at card L)
for(let L=2;L<=Lmax;L++){ const nd=new Map(); let hit=0; for(const [m,p] of dist) for(const [x,px] of masks){ if(m&x) hit+=p*px; else nd.set(x,(nd.get(x)||0)+p*px);} pEnd[L]=hit; dist=nd; }
out.setLength=pEnd; out.pSecondWins=pEnd.reduce((s,p,L)=>s+(L%2===0?p:0),0); out.meanSetLength=pEnd.reduce((s,p,L)=>s+p*L,0);
// 2. Markov chain on (A's cards k, who starts) for N cards total, random play. Starter plays card 1.
//    set ends at L: if L even -> second player wins, gains L/2 ; if L odd -> starter wins, gains (L-1)/2.
//    run-out: if starter has s cards and set would need card from starter beyond s -> starter loses game (similarly for second).
function chain(N){
  const S=[]; for(let k=1;k<N;k++) for(const st of [0,1]) S.push([k,st]); const id=(k,st)=>(k-1)*2+st; const n=S.length;
  const Q=Array.from({length:n},()=>new Float64Array(n)); const absA=new Float64Array(n), absB=new Float64Array(n);
  for(const [k,st] of S){ const i=id(k,st); const cardsA=k, cardsB=N-k; const sC=st===0?cardsA:cardsB, oC=st===0?cardsB:cardsA;
    let rem=1;
    for(let L=2;L<=Lmax;L++){ const p=pEnd[L]; // card L is played by starter if L odd
      const needS=Math.ceil(L/2), needO=Math.floor(L/2);
      if(needS>sC||needO>oC){ // someone ran out before card L: the one who needed to play
        break; }
      rem-=p; let gainStarter = L%2===1 ? (L-1)/2 : -(L/2); // cards moved to starter
      let newStarterCards=sC+gainStarter, newOther=oC-gainStarter, winner = L%2===1? st : 1-st;
      let kA = st===0? newStarterCards : newOther;
      if(kA<=0) absB[i]+=p; else if(kA>=N) absA[i]+=p; else Q[i][id(kA,winner)]+=p;
    }
    // remaining mass: set reached a run-out. who runs out first? starter needs card at odd positions: run-out happens at first L where need exceeds
    if(rem>1e-12){ let L=2; while(true){ const needS=Math.ceil(L/2), needO=Math.floor(L/2); if(needS>sC){ (st===0?absB:absA)[i]+=rem; break;} if(needO>oC){ (st===0?absA:absB)[i]+=rem; break;} L++; if(L>500) break; } }
  }
  // solve (I-Q) x = absA  and (I-Q) t = 1  via Gauss
  const solve=(b)=>{ const M=Q.map((r,i)=>{ const row=Array.from(r,(v,j)=>(i===j?1:0)-v); row.push(b[i]); return row; });
    for(let c=0;c<n;c++){ let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r; [M[c],M[p]]=[M[p],M[c]]; for(let r=0;r<n;r++) if(r!==c){ const f=M[r][c]/M[c][c]; if(f) for(let j=c;j<=n;j++) M[r][j]-=f*M[c][j]; } }
    return M.map((r,i)=>r[n]/r[i]); };
  const winA=solve(absA), T=solve(new Float64Array(n).fill(1));
  const res=[]; for(let k=1;k<N;k++) res.push({k, winIfStarter:winA[id(k,0)], winIfSecond:winA[id(k,1)], setsIfStarter:T[id(k,0)], setsIfSecond:T[id(k,1)]});
  return res;
}
out.chain40=chain(40); out.chain20=chain(20);
// 3. colour graph: nodes = colours (freq), edges = P(card has both)
const F=pool.F, names=E.SCHEMES[pool.scheme]; const co=Array.from({length:F},()=>new Array(F).fill(0));
for(const [m,p] of masks) for(let i=0;i<F;i++) if(m>>i&1) for(let j=0;j<F;j++) if(m>>j&1) co[i][j]+=p;
out.colourGraph={names, co};
// 4. compatibility matrix between the 15 commonest card types + its eigen-structure (power iteration)
const top=masks.slice().sort((a,b)=>b[1]-a[1]).slice(0,15); const K=top.map(([a])=>top.map(([b])=>(a&b)?1:0));
out.cardTypes=top.map(([m,p])=>({combo:E.maskNames(m,pool.scheme).join('+'),p})); out.compat=K;
// weighted matrix W_ij = sqrt(p_i p_j) [i~j]; P(match) = p^T K p
let v=top.map(()=>1); for(let it=0;it<200;it++){ const w=K.map(r=>r.reduce((s,x,j)=>s+x*v[j],0)); const nrm=Math.hypot(...w); v=w.map(x=>x/nrm);} const lam=K.map(r=>r.reduce((s,x,j)=>s+x*v[j],0)).reduce((s,x,i)=>s+x*v[i],0);
out.spectral={lambdaMax:lam, perron:v.map((x,i)=>[out.cardTypes[i].combo,+x.toFixed(3)])};
// 5. threshold curve P(match) vs min_share, and scheme
out.threshold=[]; for(const t of [0.02,0.04,0.06,0.08,0.1,0.12,0.15,0.2,0.25,0.3,0.4,0.5]){ const c=JSON.parse(JSON.stringify(cfg)); c.colour.min_share=t; const pb=E.buildPool(data,c); c.colour.scheme='detailed'; const pd=E.buildPool(data,c); out.threshold.push({t, basic:E.matchProbability(pb), detailed:E.matchProbability(pd)}); }
// 6. orthogonality: P(match) = 1 - P(x.y=0); count share of orthogonal pairs by number of colours
fs.writeFileSync('out/math.json',JSON.stringify(out));
console.log('P(second wins set)',out.pSecondWins.toFixed(4),'mean set length',out.meanSetLength.toFixed(3));
for(const r of out.chain40.filter(r=>[1,5,10,15,20,25,30,35,39].includes(r.k))) console.log('k',r.k,'win|start',r.winIfStarter.toFixed(3),'win|second',r.winIfSecond.toFixed(3),'sets',r.setsIfStarter.toFixed(1));
console.log('lambda',lam.toFixed(3), out.spectral.perron.slice(0,6));
console.log(out.threshold.map(x=>x.t+':'+x.basic.toFixed(2)+'/'+x.detailed.toFixed(2)).join(' '));
