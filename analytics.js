// Calculations for the current-season analysis pages. No network dependencies.
export const SLOTS=['QB','RB','WR','TE','FLEX','K','DEF'];
export function positionAverages(season,{from=1,to=9}={}) {
 return season.teams.map(t=>{const boxes=season.starter_box_scores.filter(b=>String(b.team_id)===String(t.team_id)&&b.week>=from&&b.week<=to);const totals=Object.fromEntries(SLOTS.map(p=>[p,0]));for(const b of boxes)for(const p of SLOTS)totals[p]+=b.slot_totals[p];return {...t,games:boxes.length,totals,averages:Object.fromEntries(SLOTS.map(p=>[p,boxes.length?totals[p]/boxes.length:0])),avgTotal:boxes.length?boxes.reduce((n,b)=>n+b.reported_total,0)/boxes.length:0};});
}
export function observedPlayers(season) {
 const map=new Map();for(const b of season.starter_box_scores)for(const s of b.starters){if(!map.has(s.player))map.set(s.player,{name:s.player,position:s.position,samples:[],lastWeek:0,owner:null});const p=map.get(s.player);p.samples.push({week:b.week,points:s.points,manager:b.manager});if(b.week>=p.lastWeek){p.lastWeek=b.week;p.owner=b.manager;}}
 return [...map.values()].map(p=>({...p,ppg:p.samples.reduce((n,s)=>n+s.points,0)/p.samples.length}));
}
export function latestLineup(season,manager) {const boxes=season.starter_box_scores.filter(b=>b.manager===manager).sort((a,b)=>b.week-a.week),players=observedPlayers(season);return boxes.length?boxes[0].starters.map(s=>({...players.find(p=>p.name===s.player)})):[];}
export function bestLineup(players) {
 const unique=[...new Map(players.map(p=>[p.name,p])).values()].map(p=>({...p,ppg:Number(p.ppg)||0}));let selected=[],missing=[];
 for(const [pos,n] of [['QB',1],['RB',1],['WR',2],['TE',1],['K',1],['DEF',1]]){const pool=unique.filter(p=>p.position===pos).sort((a,b)=>b.ppg-a.ppg);for(let i=0;i<n;i++){if(pool[i])selected.push({...pool[i],slot:pos});else missing.push(pos);}}
 const used=new Set(selected.map(p=>p.name));const flex=unique.filter(p=>['RB','WR','TE'].includes(p.position)&&!used.has(p.name)).sort((a,b)=>b.ppg-a.ppg);for(let i=0;i<2;i++){if(flex[i])selected.push({...flex[i],slot:'FLEX'});else missing.push('FLEX');}
 return {players:selected,missing,total:selected.reduce((n,p)=>n+p.ppg,0)};
}
export function evaluateTrade(a,b,giveA,giveB) {
 if(a.some(p=>b.some(q=>q.name===p.name)))throw new Error('A player cannot be on both rosters.');
 const sa=new Set(giveA),sb=new Set(giveB),aOut=a.filter(p=>sa.has(p.name)),bOut=b.filter(p=>sb.has(p.name));
 if(aOut.length!==sa.size||bOut.length!==sb.size)throw new Error('Selected player is missing from the roster.');
 const beforeA=bestLineup(a),beforeB=bestLineup(b),afterA=bestLineup([...a.filter(p=>!sa.has(p.name)),...bOut]),afterB=bestLineup([...b.filter(p=>!sb.has(p.name)),...aOut]);
 return {beforeA,beforeB,afterA,afterB,deltaA:afterA.total-beforeA.total,deltaB:afterB.total-beforeB.total};
}
export const seededRandom=seed=>{let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return (s+.5)/4294967296;};};
export function finalSeeds(teams) {
 const cmp=(a,b)=>(b.wins+.5*b.ties)-(a.wins+.5*a.ties)||b.pf-a.pf||a.manager.localeCompare(b.manager);
 const sorted=[...teams].sort(cmp),divisions=[...new Set(teams.map(t=>t.division))];
 const leaders=divisions.map(d=>sorted.find(t=>t.division===d)).sort(cmp),ids=new Set(leaders.map(t=>t.manager));
 return [...leaders,...sorted.filter(t=>!ids.has(t.manager)).slice(0,3)];
}
export function remainingGames(season) {return [...season.remaining_schedule].sort((a,b)=>a.week-b.week||Number(a.team_id)-Number(b.team_id));}
export function fixtureKey(g){return `${g.week}:${g.team_id}:${g.opponent_id}`;}
export function simulateFinish(archive,{iterations=10000,seed=12345,locks={},exampleTarget='Mike',exampleGoal='division',adjustments={}}={}) {
 const s=archive.seasons['2026'],boxes=s.starter_box_scores;
 const teams=s.teams.map(t=>{const own=boxes.filter(b=>String(b.team_id)===String(t.team_id));const scores=own.map(b=>b.reported_total),mean=scores.reduce((n,v)=>n+v,0)/scores.length;const games=archive.games.filter(g=>g.season==='2026'&&(g.a.manager===t.manager||g.b.manager===t.manager));let wins=0,losses=0,ties=0;for(const g of games){const [a,b]=g.a.manager===t.manager?[g.a.score,g.b.score]:[g.b.score,g.a.score];wins+=a>b;losses+=a<b;ties+=a===b;}const variance=scores.reduce((n,v)=>n+(v-mean)**2,0)/Math.max(1,scores.length-1);return {...t,wins,losses,ties,pf:Math.round(scores.reduce((n,v)=>n+v,0)*100),mean:mean+(Number(adjustments[t.manager])||0),sd:Math.sqrt((variance*(scores.length-1)+900*4)/(scores.length+3)),games:scores.length};});
 const schedule=remainingGames(s),byId=new Map(teams.map((t,i)=>[String(t.team_id),i])),rng=seededRandom(seed),normal=()=>Math.sqrt(-2*Math.log(rng()))*Math.cos(2*Math.PI*rng());
 for(const g of schedule){if(!byId.has(String(g.team_id))||!byId.has(String(g.opponent_id)))throw new Error('Unmapped schedule team');const lock=locks[fixtureKey(g)];if(lock&&(!Number.isFinite(lock.a)||!Number.isFinite(lock.b)||lock.a<0||lock.b<0))throw new Error('Locked scores must be nonnegative numbers.');}
 const totals=teams.map(t=>({...t,playoff:0,divisionWins:0,bye:0,champion:0,winSum:0,seedSum:0}));let example=null;let successCount=0;
 for(let run=0;run<iterations;run++){
  const sim=teams.map((t,i)=>({...t,i})),means=teams.map(t=>Math.max(0,t.mean+t.sd/Math.sqrt(t.games)*normal()));
  const score=i=>Math.round(Math.max(0,means[i]+teams[i].sd*normal())*100);const fixtures=[];
  for(const g of schedule){const ai=byId.get(String(g.team_id)),bi=byId.get(String(g.opponent_id)),a=sim[ai],b=sim[bi],lock=locks[fixtureKey(g)],x=lock?Math.round(lock.a*100):score(ai),y=lock?Math.round(lock.b*100):score(bi);a.pf+=x;b.pf+=y;if(x>y){a.wins++;b.losses++;}else if(y>x){b.wins++;a.losses++;}else{a.ties++;b.ties++;}fixtures.push({...g,a:a.manager,b:b.manager,scoreA:x/100,scoreB:y/100});}
  const seeds=finalSeeds(sim);for(const [i,t] of seeds.entries()){totals[t.i].playoff++;totals[t.i].seedSum+=i+1;if(i<3)totals[t.i].divisionWins++;if(i<2)totals[t.i].bye++;}
  const play=(a,b)=>{const x=score(a.i),y=score(b.i);return x>y?a:y>x?b:seeds.indexOf(a)<seeds.indexOf(b)?a:b;};const q1=play(seeds[2],seeds[5]),q2=play(seeds[3],seeds[4]);const survivors=[q1,q2].sort((a,b)=>seeds.indexOf(a)-seeds.indexOf(b));const champion=play(play(seeds[0],survivors[1]),play(seeds[1],survivors[0]));totals[champion.i].champion++;
  for(const t of sim)totals[t.i].winSum+=t.wins;
  const target=seeds.findIndex(t=>t.manager===exampleTarget),success=exampleGoal==='division'?target>=0&&target<3:exampleGoal==='bye'?target>=0&&target<2:exampleGoal==='champion'?champion.manager===exampleTarget:target>=0;
  if(success){successCount++;if(!example)example={fixtures,seeds:seeds.map(t=>({...t,pf:t.pf/100})),standings:sim.map(t=>({...t,pf:t.pf/100})),champion:champion.manager};}
 }
 return {iterations,seed,successCount,example,rows:totals.map(t=>({...t,pf:t.pf/100,playoffChance:t.playoff/iterations,divisionChance:t.divisionWins/iterations,byeChance:t.bye/iterations,championChance:t.champion/iterations,projectedWins:t.winSum/iterations,averageSeed:t.playoff?t.seedSum/t.playoff:null}))};
}
// Exhaust all win/loss outcomes affecting one division, without guessing future PF.
export function divisionPaths(archive,manager) {
 const s=archive.seasons['2026'],members=s.teams.filter(t=>t.division===s.teams.find(t=>t.manager===manager)?.division),ids=new Set(members.map(t=>String(t.team_id))),schedule=remainingGames(s).filter(g=>ids.has(String(g.team_id))||ids.has(String(g.opponent_id)));
 if(schedule.length>22)return null;
 const current=members.map(t=>{const bs=s.starter_box_scores.filter(b=>b.manager===t.manager);let wins=0,ties=0;for(const b of bs){const m=archive.games.find(g=>g.season==='2026'&&g.week===b.week&&(g.a.manager===t.manager||g.b.manager===t.manager));const other=m.a.manager===t.manager?m.b.score:m.a.score;wins+=b.reported_total>other;ties+=b.reported_total===other;}return {...t,wins:wins+ties*.5};});
 const target=current.findIndex(t=>t.manager===manager),index=new Map(current.map((t,i)=>[String(t.team_id),i])),ownGames=schedule.filter(g=>[String(g.team_id),String(g.opponent_id)].includes(String(current[target].team_id))).length;
 const groups=Array.from({length:ownGames+1},(_,wins)=>({wins,paths:0,outright:0,tied:0,behind:0}));
 function visit(k,counts,ownWins){if(k===schedule.length){const g=groups[ownWins],top=Math.max(...counts),me=counts[target];g.paths++;if(me<top)g.behind++;else if(counts.filter(v=>v===top).length>1)g.tied++;else g.outright++;return;}const game=schedule[k],a=index.get(String(game.team_id)),b=index.get(String(game.opponent_id));for(const winner of [a,b]){if(winner!==undefined)counts[winner]++;visit(k+1,counts,ownWins+(winner===target?1:0));if(winner!==undefined)counts[winner]--;}}
 visit(0,current.map(t=>t.wins),0);
 return {groups,schedule,current,ownGames,manager,division:current[target].division};
}
