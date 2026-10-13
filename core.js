// Pure archive calculations shared by the interface and validation checks.
export const PHASES = ['regular_season', 'playoffs', 'unconfirmed'];
export const PHASE_LABELS = {all:'All recorded games', regular_season:'Regular season', playoffs:'Playoffs', unconfirmed:'Phase unconfirmed'};
export const outcome = (a,b) => a > b ? 'Win' : a < b ? 'Loss' : 'Tie';
export const record = s => `${s.wins}–${s.losses}–${s.ties}`;
export const emptyStats = () => ({games:0,wins:0,losses:0,ties:0,pf:0,pa:0,pct:null,avg:null});
export function stats(games, manager) {
  const s = emptyStats();
  for (const g of games) {
    const a = g.a.manager === manager;
    if (!a && g.b.manager !== manager) continue;
    const pf = a ? g.a.score : g.b.score, pa = a ? g.b.score : g.a.score;
    s.games++; s.pf += pf; s.pa += pa;
    if (pf > pa) s.wins++; else if (pf < pa) s.losses++; else s.ties++;
  }
  if (s.games) {s.pct = (s.wins + s.ties / 2) / s.games; s.avg = s.pf / s.games;}
  return s;
}
export function filterGames(archive, {season='all',phase='all',week='all',manager='all'}={}) {
  return archive.games.filter(g => (season === 'all' || g.season === String(season)) && (phase === 'all' || g.phase === phase) && (week === 'all' || g.week === Number(week)) && (manager === 'all' || g.a.manager === manager || g.b.manager === manager));
}
export function standings(archive, season, phase='regular_season') {
  const games = filterGames(archive,{season,phase});
  const rows = archive.seasons[season].teams.map(t=>({...t,...stats(games,t.manager)}));
  rows.sort((a,b)=>(b.pct ?? -1)-(a.pct ?? -1) || b.pf-a.pf || a.manager.localeCompare(b.manager));
  rows.forEach((r,i)=>{r.rank = !r.games ? null : i && r.pct === rows[i-1].pct && r.pf === rows[i-1].pf ? rows[i-1].rank : i+1;});
  return rows;
}
export function headToHead(archive, managerA, managerB, filters={}) {
  const games = filterGames(archive,filters).filter(g=>[g.a.manager,g.b.manager].includes(managerA) && [g.a.manager,g.b.manager].includes(managerB) && managerA!==managerB);
  return {games,a:stats(games,managerA),b:stats(games,managerB)};
}
export function normalize(raw) {
  const issues = [], games = [], seasons = {}, aliases = new Map();
  for (const [year, season] of Object.entries(raw.seasons || {})) {
    const teams = [], byId = new Map();
    for (const t of season.teams || []) {
      const id = String(t.team_id), manager = typeof t.manager === 'string' ? t.manager.trim() : '';
      if (!manager || byId.has(id) || typeof t.team_name !== 'string') {issues.push({season:year,message:`Invalid or duplicate team ${id}; excluded.`}); continue;}
      const team = {...t,id,manager,season:year}; teams.push(team); byId.set(id,team);
      if (!aliases.has(manager)) aliases.set(manager,[]);
      aliases.get(manager).push(team);
    }
    seasons[year] = {...season,teams};
    const unique = new Map(), conflicts = new Set();
    for (const [index,g] of (season.games || []).entries()) {
      const ta = byId.get(String(g.team_id)), tb = byId.get(String(g.opponent_id));
      if (!ta || !tb || ta.id === tb.id || ta.manager === tb.manager || !Number.isInteger(g.week) || g.week < 1 || !Number.isFinite(g.score) || !Number.isFinite(g.opponent_score) || !PHASES.includes(g.phase)) {
        issues.push({season:year,message:`Invalid matchup row ${index+1}; excluded.`}); continue;
      }
      const key = `${year}|${g.week}|${JSON.stringify([ta.id,tb.id].sort())}`;
      const flip = ta.id > tb.id;
      const match = {id:key,season:year,week:g.week,phase:g.phase,a:{...(flip?tb:ta),score:flip?g.opponent_score:g.score},b:{...(flip?ta:tb),score:flip?g.score:g.opponent_score},source:g.source || null,round:g.round || null,weekInferred:!!g.week_inferred,confirmedBy:[...new Set((g.confirmed_by_team_ids || []).map(String))]};
      if (g.result && g.result !== outcome(g.score,g.opponent_score)) issues.push({season:year,message:`Week ${g.week}: stored result disagrees with scores; result calculated from scores.`});
      const previous = unique.get(key);
      if (previous && (previous.a.score !== match.a.score || previous.b.score !== match.b.score || previous.phase !== match.phase)) {conflicts.add(key); issues.push({season:year,message:`Week ${g.week}: conflicting rows for ${ta.manager} vs ${tb.manager}; excluded.`});}
      else if (previous) previous.confirmedBy = [...new Set([...previous.confirmedBy,...match.confirmedBy])];
      else unique.set(key,match);
    }
    const bookings = new Map();
    for (const g of unique.values()) for (const t of [g.a,g.b]) {
      const key = `${g.week}|${t.id}`;
      if (bookings.has(key) && bookings.get(key)!==g.id) {conflicts.add(g.id); conflicts.add(bookings.get(key)); issues.push({season:year,message:`Week ${g.week}: ${t.manager} has multiple opponents; those rows excluded.`});}
      else bookings.set(key,g.id);
    }
    games.push(...[...unique.values()].filter(g=>!conflicts.has(g.id)));
  }
  games.sort((a,b)=>Number(a.season)-Number(b.season) || a.week-b.week || a.a.manager.localeCompare(b.a.manager));
  return {league:raw.league || 'League history',seasons,games,aliases,managers:[...aliases.keys()].sort(),issues};
}
export const GAME_RECORDS = {
 high_team:'Highest team score',low_team:'Lowest team score',high_total:'Highest combined score',low_total:'Lowest combined score',biggest:'Biggest winning margin',closest:'Closest decided game',ties:'Tied games'
};
export function gameRecords(archive,{category='high_team',season='all',phase='all',query=''}={}) {
 const q=query.trim().toLocaleLowerCase();
 const games=filterGames(archive,{season,phase}).filter(g=>!q||[g.a.manager,g.b.manager,g.a.team_name,g.b.team_name].some(s=>s.toLocaleLowerCase().includes(q)));
 const cents=n=>Math.round(n*100);let rows=[];
 for(const g of games){const a=cents(g.a.score),b=cents(g.b.score),margin=Math.abs(a-b);
  if(category==='closest'&&!margin||category==='ties'&&margin)continue;
  if(category.endsWith('_team'))for(const t of [g.a,g.b]){if(q&&![t.manager,t.team_name].some(s=>s.toLocaleLowerCase().includes(q)))continue;rows.push({game:g,manager:t.manager,value:cents(t.score)});}
  else rows.push({game:g,manager:null,value:category.endsWith('_total')?a+b:margin});
 }
 const asc=['low_team','low_total','closest','ties'].includes(category);
 rows.sort((a,b)=>(asc?a.value-b.value:b.value-a.value)||Number(a.game.season)-Number(b.game.season)||a.game.week-b.game.week||a.game.id.localeCompare(b.game.id)||(a.manager||'').localeCompare(b.manager||''));
 return rows.map((r,i)=>({...r,rank:i&&r.value===rows[i-1].value?rows.slice(0,i).findIndex(x=>x.value===r.value)+1:i+1,value:r.value/100}));
}
export function rivalryRecords(archive,{season='all',phase='all',minimum=3,query='',order='best'}={}) {
 const q=query.trim().toLocaleLowerCase(),rows=[];
 const games=filterGames(archive,{season,phase}),pairs=new Map();
 for(const g of games){const names=[g.a.manager,g.b.manager].sort(),key=JSON.stringify(names);if(!pairs.has(key))pairs.set(key,{names,games:[]});pairs.get(key).games.push(g);}
 for(const {names,games:gs} of pairs.values())for(const [manager,opponent] of [names,[...names].reverse()]){
  if(q&&![manager,opponent,...archive.aliases.get(manager).map(t=>t.team_name),...archive.aliases.get(opponent).map(t=>t.team_name)].some(s=>s.toLocaleLowerCase().includes(q)))continue;
  const totals=stats(gs,manager);if(totals.games>=minimum)rows.push({manager,opponent,...totals});
 }
 rows.sort((a,b)=>(order==='worst'?a.pct-b.pct:b.pct-a.pct)||b.games-a.games||a.manager.localeCompare(b.manager)||a.opponent.localeCompare(b.opponent));
 return rows;
}
export function validateWeeklyPairs(pairs) {
 const bookings=new Map();for(const p of pairs)for(const n of [p.a,p.b])if(n)bookings.set(n,(bookings.get(n)||0)+1);
 return pairs.map(p=>!p.a||!p.b?'Select both managers.':p.a===p.b?'Choose two different managers.':bookings.get(p.a)>1||bookings.get(p.b)>1?'A manager appears in more than one matchup.':'');
}
export function divisionStandings(archive,season) {
 const groups=new Map();for(const t of standings(archive,String(season))){if(!t.division)continue;if(!groups.has(t.division))groups.set(t.division,[]);groups.get(t.division).push(t);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([division,teams])=>({division,teams,winner:teams[0]?.manager,titleConfirmed:archive.seasons[season].division_titles_confirmed===true}));
}
export function divisionTitles(archive,manager,years=Object.keys(archive.seasons)) {
 return years.flatMap(y=>divisionStandings(archive,y).filter(d=>d.titleConfirmed&&d.winner===manager).map(d=>({season:y,division:d.division})));
}
export function pearson(pairs) {
 const n=pairs.length;if(n<3)return null;
 const mx=pairs.reduce((s,p)=>s+p[0],0)/n,my=pairs.reduce((s,p)=>s+p[1],0)/n;let xy=0,xx=0,yy=0;
 for(const [x,y] of pairs){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2;}
 return xx&&yy?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null;
}
export function activityRows(archive,season='all',query='') {
 const q=query.trim().toLocaleLowerCase();return Object.keys(archive.seasons).filter(y=>(season==='all'||season===y)&&archive.seasons[y].status!=='in_progress').flatMap(y=>standings(archive,y).filter(t=>t.games&&(!q||[t.manager,t.team_name].some(n=>n.toLocaleLowerCase().includes(q)))).map(t=>({...t,season:y})));
}
// Historical rates are observed outcomes, not simulated probabilities.
export function historicalStarts(archive,week=4) {
 const samples=[];
 for(const [year,s] of Object.entries(archive.seasons)){
  if(s.status==='in_progress')continue;
  const playoffs=filterGames(archive,{season:year,phase:'playoffs'}),qualifiers=new Set(playoffs.flatMap(g=>[g.a.manager,g.b.manager]));
  // Match the current 12-team/six-qualifier format, excluding earlier four-team playoffs.
  if(s.teams.length!==12||qualifiers.size!==6)continue;
  const starts=filterGames(archive,{season:year,phase:'regular_season'}).filter(g=>g.week<=week);
  for(const t of s.teams){const st=stats(starts,t.manager);if(st.games!==week)continue;samples.push({season:year,manager:t.manager,team:t.team_name,record:record(st),qualified:qualifiers.has(t.manager)});}
 }
 return samples;
}
export function startingRecordRate(samples,startRecord){
 const rows=samples.filter(s=>s.record===startRecord),made=rows.filter(s=>s.qualified).length;
 return {games:rows.length,made,rate:rows.length?made/rows.length:null,samples:rows};
}
export function simulatePlayoffs(archive,{season='2026',iterations=20000,seed=20261010}={}) {
 const s=archive.seasons[season],teams=standings(archive,season),index=new Map(teams.map((t,i)=>[String(t.team_id),i]));
 const schedule=s.remaining_schedule.map(g=>[index.get(String(g.team_id)),index.get(String(g.opponent_id))]);
 if(schedule.some(([a,b])=>a==null||b==null)||teams.some(t=>!t.games))throw new Error('Complete team identities and current scoring averages are required.');
 // Pooled within-manager scoring residuals from the recent decimal-scoring era.
 let ss=0,df=0;
 for(const y of Object.keys(archive.seasons).filter(y=>Number(y)>=2021&&y<season&&archive.seasons[y].status!=='in_progress')){
  const gs=filterGames(archive,{season:y,phase:'regular_season'});
  for(const t of archive.seasons[y].teams){const values=gs.filter(g=>g.a.manager===t.manager||g.b.manager===t.manager).map(g=>g.a.manager===t.manager?g.a.score:g.b.score);if(values.length<2)continue;const mean=values.reduce((a,b)=>a+b,0)/values.length;ss+=values.reduce((a,b)=>a+(b-mean)**2,0);df+=values.length-1;}
 }
 const sd=Math.sqrt(ss/df);if(!Number.isFinite(sd)||sd<=0)throw new Error('Historical scoring variability is unavailable.');
 let rng=seed>>>0;const uniform=()=>{rng=(Math.imul(1664525,rng)+1013904223)>>>0;return (rng+.5)/4294967296;};
 const normal=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
 const totals=teams.map(t=>({manager:t.manager,playoff:0,division:0,bye:0,wins:0}));
 const divisions=[...new Set(teams.map(t=>t.division))];
 for(let run=0;run<iterations;run++){
  const means=teams.map(t=>Math.max(0,t.avg+sd/Math.sqrt(t.games)*normal()));
  const sim=teams.map((t,i)=>({i,wins:t.wins,losses:t.losses,ties:t.ties,pf:Math.round(t.pf*100),division:t.division}));
  for(const [a,b] of schedule){const x=Math.round(Math.max(0,means[a]+sd*normal())*100),y=Math.round(Math.max(0,means[b]+sd*normal())*100);sim[a].pf+=x;sim[b].pf+=y;if(x>y){sim[a].wins++;sim[b].losses++;}else if(y>x){sim[b].wins++;sim[a].losses++;}else{sim[a].ties++;sim[b].ties++;}}
  // Every team plays 14 games. Half credit for ties is equivalent to win percentage.
  const cmp=(a,b)=>(b.wins+.5*b.ties)-(a.wins+.5*a.ties)||b.pf-a.pf||a.i-b.i;
  const leaders=divisions.map(d=>sim.filter(t=>t.division===d).sort(cmp)[0]).sort(cmp),ids=new Set(leaders.map(t=>t.i));
  const wild=sim.filter(t=>!ids.has(t.i)).sort(cmp).slice(0,3);
  for(const t of [...leaders,...wild])totals[t.i].playoff++;
  for(const t of leaders)totals[t.i].division++;
  for(const t of leaders.slice(0,2))totals[t.i].bye++;
  for(const t of sim)totals[t.i].wins+=t.wins;
 }
 return {iterations,sd,variabilityDegreesOfFreedom:df,rows:totals.map((r,i)=>({...teams[i],playoffChance:r.playoff/iterations,divisionChance:r.division/iterations,byeChance:r.bye/iterations,projectedWins:r.wins/iterations}))};
}

// Comparable cumulative totals require a complete league scoreboard in every week.
export function completeRegularWeeks(archive, season) {
 const teams=archive.seasons[season].teams,expected=new Set(teams.map(t=>t.manager)),weeks=new Map();
 for(const g of filterGames(archive,{season,phase:'regular_season'})){if(!weeks.has(g.week))weeks.set(g.week,[]);weeks.get(g.week).push(g);}
 return new Map([...weeks].filter(([,gs])=>{const names=gs.flatMap(g=>[g.a.manager,g.b.manager]);return names.length===expected.size&&new Set(names).size===expected.size&&names.every(n=>expected.has(n));}));
}
export function seasonFinish(archive,season,manager){
 const s=archive.seasons[season];
 if(s.status==='in_progress')return 'In progress';
 if(s.champion_manager===manager)return '1st · Champion';
 if(s.runner_up_manager===manager)return '2nd · Runner-up';
 const gs=filterGames(archive,{season,phase:'playoffs',manager});
 if(!gs.length)return s.champion_manager?'Did not qualify':'Not recorded';
 const last=gs.slice().sort((a,b)=>b.week-a.week)[0];
 return String(last.round).toLowerCase()==='semifinal'?'Semifinal exit · place not recorded':String(last.round).toLowerCase()==='quarterfinal'?'Quarterfinal exit · place not recorded':'Playoff qualifier · place not recorded';
}
export function cumulativePfRecords(archive,{week=4,season='all',order='highest',query=''}={}){
 const rows=[],q=query.trim().toLowerCase();week=Number(week);
 for(const [year,s] of Object.entries(archive.seasons)){
  if(season!=='all'&&String(season)!==year)continue;
  const complete=completeRegularWeeks(archive,year);
  if(!Array.from({length:week},(_,i)=>i+1).every(w=>complete.has(w)))continue;
  const games=Array.from({length:week},(_,i)=>complete.get(i+1)).flat(),final=standings(archive,year);
  for(const t of s.teams){if(q&&![t.manager,t.team_name].some(x=>x.toLowerCase().includes(q)))continue;
   const total=stats(games,t.manager);rows.push({season:year,manager:t.manager,team:t.team_name,...total,pf:Math.round(total.pf*100)/100,finish:seasonFinish(archive,year,t.manager),regularRank:final.find(r=>r.manager===t.manager)?.rank});
  }
 }
 rows.sort((a,b)=>(order==='lowest'?a.pf-b.pf:b.pf-a.pf)||Number(a.season)-Number(b.season)||a.manager.localeCompare(b.manager));
 return rows.map((r,i)=>({...r,rank:i&&r.pf===rows[i-1].pf?rows.findIndex(x=>x.pf===r.pf)+1:i+1}));
}
export function toughOpponentSeasons(archive,{season='all',query='',metric='combined'}={}){
 const rows=[],q=query.trim().toLowerCase();
 for(const [year,s] of Object.entries(archive.seasons)){
  if(season!=='all'&&String(season)!==year)continue;
  const weeks=completeRegularWeeks(archive,year),byManager=new Map(s.teams.map(t=>[t.manager,{season:year,manager:t.manager,team:t.team_name,highest:0,second:0,combined:0,weeks:weeks.size,details:[],finish:seasonFinish(archive,year,t.manager)}]));
  for(const [week,gs] of weeks){const scores=gs.flatMap(g=>[g.a,g.b]).map(t=>Math.round(t.score*100));
   for(const g of gs)for(const [t,opp] of [[g.a,g.b],[g.b,g.a]]){
    // Competition ranks: 1,1,3 for a tie at the top; all tied teams count.
    const rank=1+scores.filter(n=>n>Math.round(opp.score*100)).length;
    if(rank>2)continue;const r=byManager.get(t.manager);r[rank===1?'highest':'second']++;r.combined++;r.details.push({week,opponent:opp.manager,opponentTeam:opp.team_name,score:opp.score,rank,result:outcome(t.score,opp.score)});
   }
  }
  rows.push(...[...byManager.values()].filter(r=>r.weeks&&(!q||[r.manager,r.team].some(x=>x.toLowerCase().includes(q)))));
 }
 rows.sort((a,b)=>b[metric]-a[metric]||Number(a.season)-Number(b.season)||a.manager.localeCompare(b.manager));
 return rows.map((r,i)=>({...r,rank:i&&r[metric]===rows[i-1][metric]?rows.findIndex(x=>x[metric]===r[metric])+1:i+1}));
}
