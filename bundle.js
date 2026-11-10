(async()=>{
// Pure archive calculations shared by the interface and validation checks.
const PHASES = ['regular_season', 'playoffs', 'unconfirmed'];
const PHASE_LABELS = {all:'All recorded games', regular_season:'Regular season', playoffs:'Playoffs', unconfirmed:'Phase unconfirmed'};
const outcome = (a,b) => a > b ? 'Win' : a < b ? 'Loss' : 'Tie';
const record = s => `${s.wins}–${s.losses}–${s.ties}`;
const emptyStats = () => ({games:0,wins:0,losses:0,ties:0,pf:0,pa:0,pct:null,avg:null});
function stats(games, manager) {
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
function filterGames(archive, {season='all',phase='all',week='all',manager='all'}={}) {
  return archive.games.filter(g => (season === 'all' || g.season === String(season)) && (phase === 'all' || g.phase === phase) && (week === 'all' || g.week === Number(week)) && (manager === 'all' || g.a.manager === manager || g.b.manager === manager));
}
function standings(archive, season, phase='regular_season') {
  const games = filterGames(archive,{season,phase});
  const rows = archive.seasons[season].teams.map(t=>({...t,...stats(games,t.manager)}));
  rows.sort((a,b)=>(b.pct ?? -1)-(a.pct ?? -1) || b.pf-a.pf || a.manager.localeCompare(b.manager));
  rows.forEach((r,i)=>{r.rank = !r.games ? null : i && r.pct === rows[i-1].pct && r.pf === rows[i-1].pf ? rows[i-1].rank : i+1;});
  return rows;
}
function headToHead(archive, managerA, managerB, filters={}) {
  const games = filterGames(archive,filters).filter(g=>[g.a.manager,g.b.manager].includes(managerA) && [g.a.manager,g.b.manager].includes(managerB) && managerA!==managerB);
  return {games,a:stats(games,managerA),b:stats(games,managerB)};
}
function normalize(raw) {
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
const GAME_RECORDS = {
 high_team:'Highest team score',low_team:'Lowest team score',high_total:'Highest combined score',low_total:'Lowest combined score',biggest:'Biggest winning margin',closest:'Closest decided game',ties:'Tied games'
};
function gameRecords(archive,{category='high_team',season='all',phase='all',query=''}={}) {
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
function rivalryRecords(archive,{season='all',phase='all',minimum=3,query='',order='best'}={}) {
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
function validateWeeklyPairs(pairs) {
 const bookings=new Map();for(const p of pairs)for(const n of [p.a,p.b])if(n)bookings.set(n,(bookings.get(n)||0)+1);
 return pairs.map(p=>!p.a||!p.b?'Select both managers.':p.a===p.b?'Choose two different managers.':bookings.get(p.a)>1||bookings.get(p.b)>1?'A manager appears in more than one matchup.':'');
}
function divisionStandings(archive,season) {
 const groups=new Map();for(const t of standings(archive,String(season))){if(!t.division)continue;if(!groups.has(t.division))groups.set(t.division,[]);groups.get(t.division).push(t);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([division,teams])=>({division,teams,winner:teams[0]?.manager,titleConfirmed:archive.seasons[season].division_titles_confirmed===true}));
}
function divisionTitles(archive,manager,years=Object.keys(archive.seasons)) {
 return years.flatMap(y=>divisionStandings(archive,y).filter(d=>d.titleConfirmed&&d.winner===manager).map(d=>({season:y,division:d.division})));
}
function pearson(pairs) {
 const n=pairs.length;if(n<3)return null;
 const mx=pairs.reduce((s,p)=>s+p[0],0)/n,my=pairs.reduce((s,p)=>s+p[1],0)/n;let xy=0,xx=0,yy=0;
 for(const [x,y] of pairs){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2;}
 return xx&&yy?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null;
}
function activityRows(archive,season='all',query='') {
 const q=query.trim().toLocaleLowerCase();return Object.keys(archive.seasons).filter(y=>(season==='all'||season===y)&&archive.seasons[y].status!=='in_progress').flatMap(y=>standings(archive,y).filter(t=>t.games&&(!q||[t.manager,t.team_name].some(n=>n.toLocaleLowerCase().includes(q)))).map(t=>({...t,season:y})));
}
// Historical rates are observed outcomes, not simulated probabilities.
function historicalStarts(archive,week=4) {
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
function startingRecordRate(samples,startRecord){
 const rows=samples.filter(s=>s.record===startRecord),made=rows.filter(s=>s.qualified).length;
 return {games:rows.length,made,rate:rows.length?made/rows.length:null,samples:rows};
}
function simulatePlayoffs(archive,{season='2026',iterations=20000,seed=20261010}={}) {
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
function completeRegularWeeks(archive, season) {
 const teams=archive.seasons[season].teams,expected=new Set(teams.map(t=>t.manager)),weeks=new Map();
 for(const g of filterGames(archive,{season,phase:'regular_season'})){if(!weeks.has(g.week))weeks.set(g.week,[]);weeks.get(g.week).push(g);}
 return new Map([...weeks].filter(([,gs])=>{const names=gs.flatMap(g=>[g.a.manager,g.b.manager]);return names.length===expected.size&&new Set(names).size===expected.size&&names.every(n=>expected.has(n));}));
}
function seasonFinish(archive,season,manager){
 const s=archive.seasons[season];
 if(s.status==='in_progress')return 'In progress';
 if(s.champion_manager===manager)return '1st · Champion';
 if(s.runner_up_manager===manager)return '2nd · Runner-up';
 const gs=filterGames(archive,{season,phase:'playoffs',manager});
 if(!gs.length)return s.champion_manager?'Did not qualify':'Not recorded';
 const last=gs.slice().sort((a,b)=>b.week-a.week)[0];
 return String(last.round).toLowerCase()==='semifinal'?'Semifinal exit · place not recorded':String(last.round).toLowerCase()==='quarterfinal'?'Quarterfinal exit · place not recorded':'Playoff qualifier · place not recorded';
}
function cumulativePfRecords(archive,{week=4,season='all',order='highest',query=''}={}){
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
function toughOpponentSeasons(archive,{season='all',query='',metric='combined'}={}){
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

function activityAverages(archive,{season='all',query='',sort='avgMoves'}={}){
 const source=activityRows(archive,season),totals={moves:0,trades:0},groups=new Map(),q=query.trim().toLowerCase();
 for(const t of source){
  if(!groups.has(t.manager))groups.set(t.manager,{manager:t.manager,teams:[],seasons:0,moves:0,trades:0,moveSeasons:0,tradeSeasons:0,wins:0,losses:0,ties:0,games:0});
  const r=groups.get(t.manager);r.teams.push(t.team_name);r.seasons++;for(const key of ['wins','losses','ties','games'])r[key]+=t[key];
  for(const [key,count] of [['moves','moveSeasons'],['trades','tradeSeasons']])if(Number.isFinite(t[key])){r[key]+=t[key];r[count]++;totals[key]+=t[key];}
 }
 const rows=[...groups.values()].filter(r=>!q||[r.manager,...r.teams].some(n=>n.toLowerCase().includes(q))).map(r=>({...r,avgMoves:r.moveSeasons?r.moves/r.moveSeasons:null,avgTrades:r.tradeSeasons?r.trades/r.tradeSeasons:null,moveShare:r.moveSeasons&&totals.moves?r.moves/totals.moves:null,tradeShare:r.tradeSeasons&&totals.trades?r.trades/totals.trades:null,pct:r.games?(r.wins+r.ties/2)/r.games:null}));
 rows.sort((a,b)=>(b[sort]??-1)-(a[sort]??-1)||a.manager.localeCompare(b.manager));return {rows,totals};
}

function sortRecordHistory(archive,rows,key='season',direction='asc'){
 const enriched=rows.map(r=>({...r,finalStats:stats(filterGames(archive,{season:r.season,phase:'regular_season'}),r.manager)}));
 const finishOrder=r=>r.finish.startsWith('1st')?1:r.finish.startsWith('2nd')?2:r.finish.startsWith('Semifinal')?3:r.finish.startsWith('Quarterfinal')?4:r.finish.startsWith('Playoff qualifier')?5:r.finish==='Did not qualify'?6:r.finish==='In progress'?8:7;
 const compareStats=(a,b)=>(a.pct??-1)-(b.pct??-1)||a.wins-b.wins||a.ties-b.ties;
 const compare=(a,b)=>key==='manager'?a.manager.localeCompare(b.manager)||a.team.localeCompare(b.team):key==='record'?compareStats(a,b):key==='pf'?a.pf-b.pf:key==='finalRecord'?compareStats(a.finalStats,b.finalStats):key==='regularRank'?(a.regularRank??999)-(b.regularRank??999):key==='finish'?finishOrder(a)-finishOrder(b):Number(a.season)-Number(b.season);
 return enriched.sort((a,b)=>(direction==='desc'?-1:1)*compare(a,b)||Number(a.season)-Number(b.season)||a.manager.localeCompare(b.manager));
}

// Editorial power index, not a probability: 45% season scoring, 35% all-play,
// 20% recent scoring. Percentile components share a 0–1 scale.
function powerRankings(archive,{season='2026',week=null}={}){
 const complete=completeRegularWeeks(archive,season),weeks=[...complete.keys()].filter(w=>week==null||w<=Number(week)).sort((a,b)=>a-b);
 if(!weeks.length)return [];
 const games=weeks.flatMap(w=>complete.get(w)),last=weeks.slice(-3),teams=archive.seasons[season].teams;
 const rows=teams.map(t=>{const total=stats(games,t.manager),recent=stats(last.flatMap(w=>complete.get(w)),t.manager);let wins=0,ties=0,comparisons=0;
  for(const w of weeks){const scores=complete.get(w).flatMap(g=>[g.a,g.b]),own=scores.find(s=>s.manager===t.manager);for(const other of scores){if(other.manager===t.manager)continue;comparisons++;const a=Math.round(own.score*100),b=Math.round(other.score*100);if(a>b)wins++;else if(a===b)ties++;}}
  return {...t,...total,recentAvg:recent.avg,recentWeeks:last.length,allPlayWins:wins,allPlayTies:ties,allPlayGames:comparisons,allPlayRate:(wins+ties/2)/comparisons,throughWeek:weeks.at(-1)};
 });
 const percentile=(r,key)=>rows.length<2?.5:rows.filter(o=>o!==r).reduce((n,o)=>n+(Math.round(r[key]*100)>Math.round(o[key]*100)?1:Math.round(r[key]*100)===Math.round(o[key]*100)?.5:0),0)/(rows.length-1);
 for(const r of rows){r.scoringPercentile=percentile(r,'avg');r.recentPercentile=percentile(r,'recentAvg');r.powerScore=100*(.45*r.scoringPercentile+.35*r.allPlayRate+.20*r.recentPercentile);}
 rows.sort((a,b)=>b.powerScore-a.powerScore||b.pf-a.pf||a.manager.localeCompare(b.manager));
 rows.forEach((r,i)=>{r.powerRank=i&&Math.abs(r.powerScore-rows[i-1].powerScore)<1e-9?rows[i-1].powerRank:i+1;});
 return rows;
}

// Calculations for the current-season analysis pages. No network dependencies.
const SLOTS=['QB','RB','WR','TE','FLEX','K','DEF'];
function positionAverages(season,{from=1,to=9}={}) {
 return season.teams.map(t=>{const boxes=season.starter_box_scores.filter(b=>String(b.team_id)===String(t.team_id)&&b.week>=from&&b.week<=to);const totals=Object.fromEntries(SLOTS.map(p=>[p,0]));for(const b of boxes)for(const p of SLOTS)totals[p]+=b.slot_totals[p];return {...t,games:boxes.length,totals,averages:Object.fromEntries(SLOTS.map(p=>[p,boxes.length?totals[p]/boxes.length:0])),avgTotal:boxes.length?boxes.reduce((n,b)=>n+b.reported_total,0)/boxes.length:0};});
}
function observedPlayers(season) {
 const map=new Map();for(const b of season.starter_box_scores)for(const s of b.starters){if(!map.has(s.player))map.set(s.player,{name:s.player,position:s.position,samples:[],lastWeek:0,owner:null});const p=map.get(s.player);p.samples.push({week:b.week,points:s.points,manager:b.manager});if(b.week>=p.lastWeek){p.lastWeek=b.week;p.owner=b.manager;}}
 return [...map.values()].map(p=>({...p,ppg:p.samples.reduce((n,s)=>n+s.points,0)/p.samples.length}));
}
function latestLineup(season,manager) {const boxes=season.starter_box_scores.filter(b=>b.manager===manager).sort((a,b)=>b.week-a.week),players=observedPlayers(season);return boxes.length?boxes[0].starters.map(s=>({...players.find(p=>p.name===s.player)})):[];}
function bestLineup(players) {
 const unique=[...new Map(players.map(p=>[p.name,p])).values()].map(p=>({...p,ppg:Number(p.ppg)||0}));let selected=[],missing=[];
 for(const [pos,n] of [['QB',1],['RB',1],['WR',2],['TE',1],['K',1],['DEF',1]]){const pool=unique.filter(p=>p.position===pos).sort((a,b)=>b.ppg-a.ppg);for(let i=0;i<n;i++){if(pool[i])selected.push({...pool[i],slot:pos});else missing.push(pos);}}
 const used=new Set(selected.map(p=>p.name));const flex=unique.filter(p=>['RB','WR','TE'].includes(p.position)&&!used.has(p.name)).sort((a,b)=>b.ppg-a.ppg);for(let i=0;i<2;i++){if(flex[i])selected.push({...flex[i],slot:'FLEX'});else missing.push('FLEX');}
 return {players:selected,missing,total:selected.reduce((n,p)=>n+p.ppg,0)};
}
function evaluateTrade(a,b,giveA,giveB) {
 if(a.some(p=>b.some(q=>q.name===p.name)))throw new Error('A player cannot be on both rosters.');
 const sa=new Set(giveA),sb=new Set(giveB),aOut=a.filter(p=>sa.has(p.name)),bOut=b.filter(p=>sb.has(p.name));
 if(aOut.length!==sa.size||bOut.length!==sb.size)throw new Error('Selected player is missing from the roster.');
 const beforeA=bestLineup(a),beforeB=bestLineup(b),afterA=bestLineup([...a.filter(p=>!sa.has(p.name)),...bOut]),afterB=bestLineup([...b.filter(p=>!sb.has(p.name)),...aOut]);
 return {beforeA,beforeB,afterA,afterB,deltaA:afterA.total-beforeA.total,deltaB:afterB.total-beforeB.total};
}
const seededRandom=seed=>{let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return (s+.5)/4294967296;};};
function finalSeeds(teams) {
 const cmp=(a,b)=>(b.wins+.5*b.ties)-(a.wins+.5*a.ties)||b.pf-a.pf||a.manager.localeCompare(b.manager);
 const sorted=[...teams].sort(cmp),divisions=[...new Set(teams.map(t=>t.division))];
 const leaders=divisions.map(d=>sorted.find(t=>t.division===d)).sort(cmp),ids=new Set(leaders.map(t=>t.manager));
 return [...leaders,...sorted.filter(t=>!ids.has(t.manager)).slice(0,3)];
}
function remainingGames(season) {return [...season.remaining_schedule].sort((a,b)=>a.week-b.week||Number(a.team_id)-Number(b.team_id));}
function fixtureKey(g){return `${g.week}:${g.team_id}:${g.opponent_id}`;}
function simulateFinish(archive,{iterations=10000,seed=12345,locks={},exampleTarget='Mike',exampleGoal='division',adjustments={}}={}) {
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
function divisionPaths(archive,manager) {
 const s=archive.seasons['2026'],members=s.teams.filter(t=>t.division===s.teams.find(t=>t.manager===manager)?.division),ids=new Set(members.map(t=>String(t.team_id))),schedule=remainingGames(s).filter(g=>ids.has(String(g.team_id))||ids.has(String(g.opponent_id)));
 if(schedule.length>22)return null;
 const current=members.map(t=>{const bs=s.starter_box_scores.filter(b=>b.manager===t.manager);let wins=0,ties=0;for(const b of bs){const m=archive.games.find(g=>g.season==='2026'&&g.week===b.week&&(g.a.manager===t.manager||g.b.manager===t.manager));const other=m.a.manager===t.manager?m.b.score:m.a.score;wins+=b.reported_total>other;ties+=b.reported_total===other;}return {...t,wins:wins+ties*.5};});
 const target=current.findIndex(t=>t.manager===manager),index=new Map(current.map((t,i)=>[String(t.team_id),i])),ownGames=schedule.filter(g=>[String(g.team_id),String(g.opponent_id)].includes(String(current[target].team_id))).length;
 const groups=Array.from({length:ownGames+1},(_,wins)=>({wins,paths:0,outright:0,tied:0,behind:0}));
 function visit(k,counts,ownWins){if(k===schedule.length){const g=groups[ownWins],top=Math.max(...counts),me=counts[target];g.paths++;if(me<top)g.behind++;else if(counts.filter(v=>v===top).length>1)g.tied++;else g.outright++;return;}const game=schedule[k],a=index.get(String(game.team_id)),b=index.get(String(game.opponent_id));for(const winner of [a,b]){if(winner!==undefined)counts[winner]++;visit(k+1,counts,ownWins+(winner===target?1:0));if(winner!==undefined)counts[winner]--;}}
 visit(0,current.map(t=>t.wins),0);
 return {groups,schedule,current,ownGames,manager,division:current[target].division};
}

// Rendered inside the archive shell; shared helpers are defined by app.js.
let lab={from:1,to:9,mode:'averages',sort:'avgTotal',team:'all',a:'Josh',b:'Mark',giveA:new Set(),giveB:new Set(),edits:{},extras:{},target:'Mike',goal:'division',seed:20261110,iterations:10000,locks:{},adjustments:{},result:null,pathCache:{},error:''};
const seasonNow=()=>archive.seasons['2026'];
const labTeams=()=>seasonNow().teams.map(t=>[t.manager,`${t.manager} · ${t.team_name}`]);
function labSelect(label,key,items,value){return `<label>${escape(label)}<select data-lab="${key}">${options(items,value)}</select></label>`;}
function labNumber(label,key,value,min=0,max=500){return `<label>${escape(label)}<input type="number" min="${min}" max="${max}" step="0.1" data-lab="${key}" value="${escape(value)}"></label>`;}
function analysisTable(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function slotView(){
 const s=seasonNow(),rows=positionAverages(s,{from:lab.from,to:lab.to}),field=lab.mode;
 const sorted=[...rows].sort((a,b)=>lab.sort==='avgTotal'?b.avgTotal-a.avgTotal:(b[field][lab.sort]-a[field][lab.sort]));
 const means=Object.fromEntries(SLOTS.map(p=>[p,rows.reduce((n,r)=>n+r.averages[p],0)/rows.length]));
 const selected=lab.team==='all'?null:s.teams.find(t=>t.manager===lab.team);
 return heading('SCORING LAB','Where your points come from.',`2026 · Verified starter box scores through Week 9. Compare teams by starting slot.`,false)+
 `<div class="filters">${labSelect('From week','from',Array.from({length:9},(_,i)=>[i+1,`Week ${i+1}`]),lab.from)}${labSelect('Through week','to',Array.from({length:9},(_,i)=>[i+1,`Week ${i+1}`]),lab.to)}${labSelect('Show','mode',[['averages','Weekly averages'],['totals','Total points']],lab.mode)}${labSelect('Sort by','sort',[['avgTotal','Total per week'],...SLOTS.map(p=>[p,p])],lab.sort)}<button class="secondary" data-lab-action="export">Download CSV ↓</button></div>`+
 `<section class="metrics">${metric('Weeks in range',lab.to-lab.from+1,'Every team has a complete box score')}${metric('Teams',12,'All starters included')}${metric('Starting lineup','9 slots','1 QB · 1 RB · 2 WR · 1 TE · 2 FLEX · K · DEF')}${metric('FLEX','Separate','Both W/R/T slots combined')}</section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Points by team and lineup slot</h2><p>WR combines the two WR slots. FLEX combines the two FLEX slots, regardless of player position. Zero scores stay in the averages.</p></div></div>`+
 analysisTable(['Team','Weeks',...SLOTS,lab.mode==='totals'?'Total':'Avg total'],sorted.map(r=>`<tr><td class="team-cell">${escape(r.team_name)}<small>${escape(r.manager)}</small></td><td>${r.games}</td>${SLOTS.map(p=>`<td class="num ${r.averages[p]>=means[p]?'slot-above':'slot-below'}">${number(r[field][p])}</td>`).join('')}<td class="num record">${number(lab.mode==='totals'?r.avgTotal*r.games:r.avgTotal)}</td></tr>`))+
 `<div class="panel-footnote">Blue values meet or exceed the league average for that slot; amber values fall below it. Teams can use different positions in FLEX, so slot averages alone do not measure total RB or WR depth.</div></section>`+
 `<div class="filters">${labSelect('Weekly breakdown','team',[['all','Select a team'],...labTeams()],lab.team)}</div>`+
 (selected?`<section class="panel"><div class="panel-heading"><h2>${escape(selected.team_name)} · Weekly points</h2></div>${analysisTable(['Week',...SLOTS,'Total'],s.starter_box_scores.filter(b=>b.manager===lab.team&&b.week>=lab.from&&b.week<=lab.to).map(b=>`<tr><td>${b.week}</td>${SLOTS.map(p=>`<td class="num">${number(b.slot_totals[p])}</td>`).join('')}<td class="num">${number(b.reported_total)}</td></tr>`))}</section><section class="panel"><div class="panel-heading"><h2>Starter details</h2></div><div class="roster-list">${s.starter_box_scores.filter(b=>b.manager===lab.team&&b.week>=lab.from&&b.week<=lab.to).map(b=>`<details><summary>Week ${b.week} · ${number(b.reported_total)} points</summary>${analysisTable(['Slot','Player','Position','Points'],b.starters.map(p=>`<tr><td>${p.slot==='W/R/T'?'FLEX':escape(p.slot)}</td><td>${escape(p.player)}</td><td>${escape(p.position)}</td><td>${number(p.points)}</td></tr>`))}</details>`).join('')}</div></section>`:'');
}
function tradeRoster(manager){return [...latestLineup(seasonNow(),manager),...(lab.extras[manager]||[])].map(p=>({...p,ppg:lab.edits[`${manager}|${p.name}`]??p.ppg}));}
function rosterEditor(manager,side){const players=tradeRoster(manager),chosen=side==='a'?lab.giveA:lab.giveB;
 return `<section class="panel"><div class="panel-heading"><div><h2>${escape(manager)} · ${escape(seasonNow().teams.find(t=>t.manager===manager).team_name)}</h2><p>Check players to send. Edit expected points per game.</p></div></div>${analysisTable(['Send','Player','Pos','Observed avg','Expected PPG'],players.map(p=>`<tr><td><input type="checkbox" aria-label="Trade ${escape(p.name)}" data-trade-side="${side}" data-player="${escape(p.name)}" ${chosen.has(p.name)?'checked':''}></td><td class="team-cell">${escape(p.name)}<small>${p.samples?`${p.samples.length} observed starts · last seen W${p.lastWeek}`:'Manual replacement / bench player'}</small></td><td>${escape(p.position)}</td><td>${p.samples?number(p.samples.reduce((n,v)=>n+v.points,0)/p.samples.length):'—'}</td><td><input class="ppg-input" type="number" min="-20" max="100" step="0.1" aria-label="Expected PPG for ${escape(p.name)}" data-projection-manager="${escape(manager)}" data-player="${escape(p.name)}" value="${Number(p.ppg).toFixed(2)}"></td></tr>`))}<div class="add-player"><h3>Add a bench player or replacement</h3><label>Name<input id="extra-${side}-name" maxlength="80" placeholder="Player name"></label><label>Position<select id="extra-${side}-pos">${options(SLOTS.filter(p=>p!=='FLEX').map(p=>[p,p]),'RB')}</select></label><label>Expected PPG<input id="extra-${side}-ppg" type="number" min="-20" max="100" step="0.1" value="8"></label><button class="secondary" data-lab-action="add-${side}">Add player</button></div></section>`;
}
function tradeView(){const rows=positionAverages(seasonNow()),mine=rows.find(t=>t.manager===lab.a),avg=Object.fromEntries(SLOTS.map(p=>[p,rows.reduce((n,r)=>n+r.averages[p],0)/rows.length]));const weak=['RB','WR','TE'].sort((a,b)=>(mine.averages[a]-avg[a])-(mine.averages[b]-avg[b]))[0],strong=['RB','WR','TE'].sort((a,b)=>(mine.averages[b]-avg[b])-(mine.averages[a]-avg[a]))[0];
 let comparison='';try{const r=evaluateTrade(tradeRoster(lab.a),tradeRoster(lab.b),[...lab.giveA],[...lab.giveB]);const picked=lab.giveA.size+lab.giveB.size>0;comparison=`<section class="metrics">${metric(`${lab.a} before`,number(r.beforeA.total),'Best lineup at expected PPG')}${metric(`${lab.a} after`,number(r.afterA.total),`${r.deltaA>=0?'+':''}${number(r.deltaA)} points / week`)}${metric(`${lab.b} before`,number(r.beforeB.total),'Best lineup at expected PPG')}${metric(`${lab.b} after`,number(r.afterB.total),`${r.deltaB>=0?'+':''}${number(r.deltaB)} points / week`)}</section><div class="notice"><strong>${!picked?'Select players on both sides to evaluate a trade.':r.deltaA>0&&r.deltaB>0?'Both starting lineups improve under these estimates.':r.deltaA>0?`${escape(lab.a)} gains starting points under these estimates.`:r.deltaB>0?`${escape(lab.b)} gains starting points under these estimates.`:'This deal does not increase either team’s expected starting score.'}</strong> ${r.afterA.missing.length||r.afterB.missing.length?`Missing slots count as zero: ${escape(lab.a)} (${r.afterA.missing.join(', ')||'none'}); ${escape(lab.b)} (${r.afterB.missing.join(', ')||'none'}). Add replacements before judging the deal.`:'All starting slots are filled.'}</div><div class="analytics-grid">${[[lab.a,r.afterA],[lab.b,r.afterB]].map(([manager,lineup])=>`<section class="panel"><div class="panel-heading"><h2>${escape(manager)} · After-trade lineup</h2></div>${analysisTable(['Slot','Player','Expected PPG'],lineup.players.map(p=>`<tr><td>${p.slot}</td><td>${escape(p.name)}</td><td>${number(p.ppg)}</td></tr>`))}</section>`).join('')}</div>`;}catch(e){comparison=`<div class="notice">${escape(e.message)}</div>`;}
 const partners=rows.filter(t=>t.manager!==lab.a).map(t=>({...t,fit:(t.averages[weak]-avg[weak])+(avg[strong]-t.averages[strong])})).sort((a,b)=>b.fit-a.fit).slice(0,4);
 return heading('TRADE LAB','Trade depth for starting points.', 'Test a deal against both teams’ best legal starting lineups, including two FLEX spots.',false)+
 `<div class="notice">Default pools contain each team’s <strong>Week 9 starters only</strong>. They are not complete current rosters. Add bench players and replacements, and correct ownership before evaluating. Defaults use average points in observed starts across Weeks 1–9, including zeros; they are not rest-of-season projections. Editable expectations let you account for role changes, injuries and byes. No live player data is used.</div>`+
 `<div class="filters">${labSelect('Your team','a',labTeams(),lab.a)}${labSelect('Trade partner','b',labTeams(),lab.b)}<button class="secondary" data-lab-action="reset-trade">Reset trade</button></div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Potential complementary partners</h2><p>${escape(lab.a)}’s strongest relative slot is ${strong}; weakest is ${weak}. This is a starting point for exploring deals, not a player valuation. WR is two slots and FLEX is excluded.</p></div></div>${analysisTable(['Team',`${weak} vs league / week`,`${strong} vs league / week`,'Explore'],partners.map(t=>`<tr><td>${escape(t.team_name)}</td><td>${number(t.averages[weak]-avg[weak])}</td><td>${number(t.averages[strong]-avg[strong])}</td><td><button class="text-button" data-trade-partner="${escape(t.manager)}">Compare ↗</button></td></tr>`))}</section>`+
 `<div class="analytics-grid">${rosterEditor(lab.a,'a')}${rosterEditor(lab.b,'b')}</div>${lab.error?`<div role="alert" class="notice">${escape(lab.error)}</div>`:''}${comparison}<div class="panel-footnote">The optimizer fills QB, RB, WR, WR, TE, FLEX, FLEX, K and DEF. Each player counts once. This estimates lineup scoring value only; it does not price dynasty picks, contracts or future seasons. Added players and edits last until you reload.</div>`;
}
function runLab(){lab.result=simulateFinish(archive,{iterations:lab.iterations,seed:lab.seed,locks:lab.locks,exampleTarget:lab.target,exampleGoal:lab.goal,adjustments:lab.adjustments});}
function oddsTable(result){return analysisTable(['Team','Record','Avg PF','Projected wins','Playoffs','Division','Bye','Champion'],[...result.rows].sort((a,b)=>b.playoffChance-a.playoffChance).map(t=>`<tr><td class="team-cell">${escape(t.team_name)}<small>${escape(t.manager)}</small></td><td>${t.wins}–${t.losses}–${t.ties}</td><td>${number(t.mean)}</td><td>${t.projectedWins.toFixed(1)}</td>${['playoffChance','divisionChance','byeChance','championChance'].map(k=>`<td class="num">${pct(t[k])}</td>`).join('')}</tr>`));}
function simulatorView(){if(!lab.result)runLab();const r=lab.result,teams=new Map(seasonNow().teams.map(t=>[String(t.team_id),t]));
 return heading('PLAYOFF LAB','Five weeks. Every possibility.', 'Simulate Weeks 10–14, playoff qualification and a three-round championship bracket.',false)+
 `<div class="filters">${labSelect('Simulated seasons','iterations',[[2000,'2,000 · quick'],[10000,'10,000'],[20000,'20,000']],lab.iterations)}${labNumber('Random seed','seed',lab.seed,1,4294967295)}<button class="primary" data-lab-action="rerun">Run simulation</button><button class="secondary" data-lab-action="clear-locks">Clear scores & adjustments</button></div>`+
 `<section class="metrics">${metric('Completed',54,'All Week 1–9 matchups verified')}${metric('Remaining',30,'Actual fantasy schedule · Weeks 10–14')}${metric('Playoff field',6,'3 division winners + 3 wild cards')}${metric('Locked games',Object.keys(lab.locks).length,`${number(r.iterations)} simulations · seed ${r.seed}`)}</section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Playoff and championship probabilities</h2><p>Results reflect the fixed scores and scoring adjustments below. A simulated 0% or 100% is not a mathematical guarantee.</p></div></div>${oddsTable(r)}</section>`+
 `<details class="method-details"><summary>Model and playoff assumptions</summary><p>Each team’s expected score is its Week 1–9 average. Weekly scores follow an independent normal distribution, floored at zero and rounded to cents. Team variability uses its observed sample variance shrunk toward a 30-point standard deviation with four prior games. Each run also varies scoring strength by team standard deviation divided by √9. Future PF is accumulated for tiebreaks. This model does not include player news, NFL matchups, injuries or bye weeks.</p><p>Qualification uses your saved rules: three division winners plus three wild cards, ranked by overall record, then season PF. Division winners occupy seeds 1–3; the top two receive byes. Championship estimates assume single-week rounds in Weeks 15–17, with the top seed facing the lowest surviving seed after round one. Equal simulated playoff scores advance the better seed. These bracket assumptions are editable in code; confirm them against Yahoo before treating championship odds as official.</p></details>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Change expected team scoring</h2><p>Points per week added to or subtracted from the historical average. Use for a trade, injury or your own forecast.</p></div></div><div class="adjustment-grid">${seasonNow().teams.map(t=>`<label>${escape(t.manager)}<input aria-label="Scoring adjustment for ${escape(t.manager)}" type="number" min="-100" max="100" step="0.5" data-adjustment="${escape(t.manager)}" value="${lab.adjustments[t.manager]||0}"></label>`).join('')}</div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Remaining schedule · Lock a scenario</h2><p>Enter both final scores to lock a game. Clear both to simulate it. Score locks apply to all simulations and the scenario generator.</p></div></div>${analysisTable(['Week','Team A','Score A','Score B','Team B'],remainingGames(seasonNow()).map(g=>{const k=fixtureKey(g),a=teams.get(String(g.team_id)),b=teams.get(String(g.opponent_id)),lock=lab.locks[k];return `<tr><td>${g.week}${g.rivalry_week?' · Rivalry':''}</td><td>${escape(a.team_name)}</td><td><input class="score-input" type="number" min="0" max="500" step="0.01" aria-label="Week ${g.week} score for ${escape(a.manager)}" data-score-key="${k}" data-score-side="a" value="${lock?.a??''}" placeholder="Auto"></td><td><input class="score-input" type="number" min="0" max="500" step="0.01" aria-label="Week ${g.week} score for ${escape(b.manager)}" data-score-key="${k}" data-score-side="b" value="${lock?.b??''}" placeholder="Auto"></td><td>${escape(b.team_name)}</td></tr>`;}))}</section><div id="lab-validation" role="alert" class="notice" hidden></div><button class="primary" data-lab-action="apply-scores">Apply scores & simulate</button>`;
}
function scenariosView(){if(!lab.result)runLab();const r=lab.result,key=lab.target;if(!lab.pathCache[key])lab.pathCache[key]=divisionPaths(archive,lab.target);const path=lab.pathCache[key],ex=r.example,target=r.rows.find(t=>t.manager===lab.target),goalLabel={division:'win the division',playoffs:'make the playoffs',bye:'earn a bye',champion:'win the championship'}[lab.goal];
 return heading('SCENARIO GENERATOR','What needs to happen?', 'Choose a team and a goal. Explore exact division paths and a concrete simulated finish.',false)+
 `<div class="filters">${labSelect('Team','target',labTeams(),lab.target)}${labSelect('Goal','goal',[['division','Win the division'],['playoffs','Make playoffs'],['bye','Earn a first-round bye'],['champion','Win championship']],lab.goal)}<button class="primary" data-lab-action="new-example">Generate another scenario</button></div>`+
 `<section class="metrics">${metric('Current record',`${target.wins}–${target.losses}–${target.ties}`,target.division)}${metric('Goal probability',pct(r.successCount/r.iterations),`${r.successCount} of ${number(r.iterations)} simulated finishes`)}${metric('Scoring tiebreaker','Season PF','Overall record first; future PF can change')}${metric('Goal',lab.goal==='division'?'Division':lab.goal==='bye'?'Bye':lab.goal==='champion'?'Champion':'Playoffs',`For ${lab.target}`)}</section>`+
 (path?`<section class="panel"><div class="panel-heading"><div><h2>${escape(lab.target)}’s division paths by remaining wins</h2><p>Exhaustive win/loss outcomes for games affecting ${escape(path.division)}. Future ties are excluded; these counts are possibilities, not weighted probabilities. This table ignores score locks and adjustments.</p></div></div>${analysisTable(['Wins in final 5','Outright first paths','Tied for first paths','Behind paths','Meaning'],path.groups.map(g=>`<tr><td>${g.wins}–${path.ownGames-g.wins}</td><td>${number(g.outright)}</td><td>${number(g.tied)}</td><td>${number(g.behind)}</td><td>${g.outright===g.paths?'Guarantees outright first under win/loss outcomes':!g.behind?'At least tied for first; PF may decide':g.outright||g.tied?'Needs other results / possibly PF':'Cannot finish first on record'}</td></tr>`))}<div class="panel-footnote">“Guarantees” above applies to record under win/loss outcomes only. A record tie requires total season PF; the simulation models future PF. No alphabetical tiebreak is presented as a confirmed Yahoo rule.</div></section>`:'')+
 `<section class="panel"><div class="panel-heading"><div><h2>${ex?`One way for ${escape(lab.target)} to ${goalLabel}`:'No matching finish found in this simulation'}</h2><p>${ex?'This is one sufficient example with specific final scores, not a list of necessary outcomes. Change score locks in Playoff simulator to test your own path.':'Try another seed or adjust expected scores. No sampled success does not prove mathematical elimination.'}</p></div><button class="text-button" data-view="simulator">Edit scenario scores ↗</button></div>`+
 (ex?analysisTable(['Week','Team A','Score','Team B','Score'],ex.fixtures.filter(g=>g.a===lab.target||g.b===lab.target||seasonNow().teams.find(t=>t.manager===g.a).division===target.division||seasonNow().teams.find(t=>t.manager===g.b).division===target.division).map(g=>`<tr><td>${g.week}</td><td>${escape(g.a)}</td><td>${number(g.scoreA)}</td><td>${escape(g.b)}</td><td>${number(g.scoreB)}</td></tr>`)):'')+`</section>`+
 (ex?`<section class="panel"><div class="panel-heading"><div><h2>Resulting playoff field</h2><p>Simulated champion: ${escape(ex.champion)}. Full results for all 30 remaining games are included in the downloadable scenario.</p></div><button class="text-button" data-lab-action="download-scenario">Download scenario ↓</button></div>${analysisTable(['Seed','Team','Record','Final PF','Berth'],ex.seeds.map((t,i)=>`<tr><td>${i+1}</td><td>${escape(t.team_name)}</td><td>${t.wins}–${t.losses}–${t.ties}</td><td>${number(t.pf)}</td><td>${i<2?'Division winner · Bye':i===2?'Division winner':'Wild card'}</td></tr>`))}</section>`:'');
}
function labDownload(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('change',e=>{
 const t=e.target;if(!archive)return;
 if(t.dataset.lab){const k=t.dataset.lab;let v=['from','to','seed','iterations'].includes(k)?Number(t.value):t.value;if(k==='seed')v=Math.max(1,Math.min(4294967295,Math.floor(v||1)));lab[k]=v;if(lab.from>lab.to){if(k==='from')lab.to=lab.from;else lab.from=lab.to;}if(k==='a'||k==='b'){if(lab.a===lab.b)lab[k==='a'?'b':'a']=labTeams().find(([m])=>m!==v)[0];lab.giveA.clear();lab.giveB.clear();lab.error='';}if(['target','goal','iterations','seed'].includes(k))runLab();render();}
 else if(t.dataset.tradeSide){const set=t.dataset.tradeSide==='a'?lab.giveA:lab.giveB;t.checked?set.add(t.dataset.player):set.delete(t.dataset.player);render();}
 else if(t.dataset.projectionManager){const v=Number(t.value);if(Number.isFinite(v)&&v>=-20&&v<=100){lab.edits[`${t.dataset.projectionManager}|${t.dataset.player}`]=v;render();}}
 else if(t.dataset.adjustment){const v=Number(t.value);if(Number.isFinite(v)&&v>=-100&&v<=100){lab.adjustments[t.dataset.adjustment]=v;runLab();render();}}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||!archive)return;if(b.dataset.tradePartner){lab.b=b.dataset.tradePartner;lab.giveA.clear();lab.giveB.clear();render();return;}const action=b.dataset.labAction;if(!action)return;
 if(action==='export'){const rows=positionAverages(seasonNow(),{from:lab.from,to:lab.to});const cell=v=>'"'+String(v).replace(/"/g,'""')+'"';labDownload('Budzik_Position_Points.csv',[['Manager','Team','Weeks',...SLOTS,'Total'],...rows.map(r=>[r.manager,r.team_name,r.games,...SLOTS.map(p=>r[lab.mode][p].toFixed(2)),(lab.mode==='totals'?r.avgTotal*r.games:r.avgTotal).toFixed(2)])].map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv');return;}
 if(action==='download-scenario'){labDownload('Budzik_Playoff_Scenario.json',JSON.stringify({target:lab.target,goal:lab.goal,seed:lab.seed,locks:lab.locks,example:lab.result.example},null,2),'application/json');return;}
 if(action.startsWith('add-')){const side=action.slice(4),manager=lab[side],name=document.getElementById(`extra-${side}-name`).value.trim(),position=document.getElementById(`extra-${side}-pos`).value,ppg=Number(document.getElementById(`extra-${side}-ppg`).value);if(!name||!Number.isFinite(ppg)||ppg < -20||ppg>100){lab.error='Enter a name and expected PPG between −20 and 100.';}else if([...tradeRoster(lab.a),...tradeRoster(lab.b)].some(p=>p.name.toLowerCase()===name.toLowerCase())){lab.error='That player is already in one of these rosters.';}else{(lab.extras[manager]??=[]).push({name,position,ppg});lab.error='';}}
 if(action==='reset-trade'){lab.giveA.clear();lab.giveB.clear();lab.edits={};lab.extras={};lab.error='';}
 if(action==='new-example'){lab.seed++;runLab();}
 if(action==='rerun'){runLab();}
 if(action==='clear-locks'){lab.locks={};lab.adjustments={};runLab();}
 if(action==='apply-scores'){const next={};for(const g of remainingGames(seasonNow())){const key=fixtureKey(g),els=[...document.querySelectorAll('[data-score-key]')].filter(x=>x.dataset.scoreKey===key),a=els.find(x=>x.dataset.scoreSide==='a').value,b=els.find(x=>x.dataset.scoreSide==='b').value;if(a===''&&b==='')continue;if(a===''||b===''||![a,b].every(v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=500)){const el=document.getElementById('lab-validation');el.hidden=false;el.textContent=`Week ${g.week}: enter both scores between 0 and 500, or clear both.`;el.scrollIntoView({block:'center'});return;}next[key]={a:Number(a),b:Number(b)};}lab.locks=next;runLab();}
 render();
});


const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => n == null ? '—' : new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const pct = n => n == null ? '—' : `${(n*100).toFixed(1)}%`;
const initials = name => name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').replace('.','');
const content = document.getElementById('content');
let archive;
let playoffEstimate;
let state;
let weeklyPlans={};
let planStorageAvailable=false;
try {const saved=JSON.parse(window.localStorage?.getItem('budzik-weekly-plans-2026')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))weeklyPlans=saved;planStorageAvailable=!!window.localStorage;}catch{}
function plannedPairs(){const season=archive.seasons['2026'],id=new Map((season?.teams||[]).map(t=>[String(t.team_id),t.manager]));const supplied=[...(season?.games||[]),...(season?.remaining_schedule||[])].filter(g=>g.week===Number(state.plannerWeek)).map(g=>({a:id.get(String(g.team_id)),b:id.get(String(g.opponent_id))}));const saved=weeklyPlans[state.plannerWeek]||supplied;return Array.from({length:6},(_,i)=>({a:archive.managers.includes(saved?.[i]?.a)?saved[i].a:'',b:archive.managers.includes(saved?.[i]?.b)?saved[i].b:''}));}
function savePlan(pairs){weeklyPlans[state.plannerWeek]=pairs;try{window.localStorage?.setItem('budzik-weekly-plans-2026',JSON.stringify(weeklyPlans));planStorageAvailable=!!window.localStorage;}catch{planStorageAvailable=false;}}

const views = ['positions','trades','simulator','scenarios','power','season','matchups','playoffs','h2h','records','weeklyrecords','highlights','planner','rivalries','divisions','activity','predictions','managers','profile','archive'];
const defaultState = {view:'positions',season:'2015',scope:'all',phase:'all',week:'all',manager:'all',a:'Josh',b:'Taylor',profile:'Josh',q:'',sort:'wins',category:'high_team',plannerWeek:'1',minimum:'3',order:'best',forecastWeek:'7',startRecord:'0–6–0',recordWeek:'6',recordLimit:'10',pfOrder:'highest',opponentMetric:'combined',activitySort:'avgMoves',historyRecord:'all',historyYears:'all',historySort:'season',historyDirection:'asc',powerWeek:'latest'};

function currentWeek(){return Math.max(0,...(archive.seasons['2026'].completed_weeks||[]));}
function readState() {
  const p = new URLSearchParams(location.hash.slice(1));
  state = {...defaultState,...Object.fromEntries(p.entries())};
  if (!views.includes(state.view)) state.view='season';
  if (!archive.seasons[state.season]) state.season=Object.keys(archive.seasons)[0];
  if (state.scope!=='all' && !archive.seasons[state.scope]) state.scope='all';
  if (!Object.hasOwn(PHASE_LABELS,state.phase)) state.phase='all';
  for (const key of ['a','b','profile']) if (!archive.managers.includes(state[key])) state[key]=defaultState[key];
  if (state.a===state.b) state.b=archive.managers.find(n=>n!==state.a);
  if (state.manager!=='all' && !archive.managers.includes(state.manager)) state.manager='all';
  if (state.week!=='all' && (!/^\d+$/.test(state.week) || +state.week<1 || +state.week>30)) state.week='all';
  if(!Object.hasOwn(GAME_RECORDS,state.category))state.category='high_team';
  if(!/^([1-9]|1[0-8])$/.test(state.plannerWeek))state.plannerWeek='1';
  if(!['1','3','5','10'].includes(state.minimum))state.minimum='3';
  if(!['best','worst'].includes(state.order))state.order='best';
  if(!archive.seasons['2026'].remaining_schedule.some(g=>g.week===Number(state.forecastWeek)))state.forecastWeek=String(currentWeek()+1);
  if(!/^([0-9]|1[0-4])–([0-9]|1[0-4])–([0-9]|1[0-4])$/.test(state.startRecord)||state.startRecord.split('–').reduce((n,v)=>n+Number(v),0)!==currentWeek())state.startRecord=`0–${currentWeek()}–0`;
  if(!/^(1[0-4]|[1-9])$/.test(state.recordWeek))state.recordWeek='4';
  if(!['5','10','all'].includes(state.recordLimit))state.recordLimit='10';
  if(!['highest','lowest'].includes(state.pfOrder))state.pfOrder='highest';
  if(!['highest','second','combined'].includes(state.opponentMetric))state.opponentMetric='combined';
  if(!['avgMoves','avgTrades','moveShare','tradeShare','moves','trades','pct'].includes(state.activitySort))state.activitySort='avgMoves';
  const validRecords=state.historyRecord.split(',').filter(r=>/^([0-9]|1[0-4])–([0-9]|1[0-4])–([0-9]|1[0-4])$/.test(r));
  state.historyRecord=state.historyRecord==='all'||!validRecords.length?'all':[...new Set(validRecords)].join(',');
  const validYears=state.historyYears.split(',').filter(y=>Object.hasOwn(archive.seasons,y));
  state.historyYears=state.historyYears==='all'||!validYears.length?'all':[...new Set(validYears)].join(',');
  if(!['season','manager','record','pf','finalRecord','regularRank','finish'].includes(state.historySort))state.historySort='season';
  if(!['asc','desc'].includes(state.historyDirection))state.historyDirection='asc';
  if(state.powerWeek!=='latest'&&(!/^\d+$/.test(state.powerWeek)||Number(state.powerWeek)<1||Number(state.powerWeek)>currentWeek()))state.powerWeek='latest';
  state.q=state.q.slice(0,100);
}
function update(changes,replace=false) {
  const p = new URLSearchParams({...state,...changes});
  const target = `#${p.toString()}`;
  if (replace) {history.replaceState(null,'',target);readState();render();}
  else if (location.hash===target) {readState();render();}
  else location.hash=target;
}
function options(items,value) {return items.map(([id,label])=>`<option value="${escape(id)}"${String(value)===String(id)?' selected':''}>${escape(label)}</option>`).join('');}
function select(label,key,items,value=state[key]) {return `<label>${escape(label)}<select id="filter-${key}" data-state="${key}" aria-label="${escape(label)}">${options(items,value)}</select></label>`;}
function multiSelect(label,key,items){const selected=state[key].split(',');return `<div class="multi-filter"><span class="multi-label">${escape(label)}</span><div class="multi-options" role="group" aria-label="${escape(label)}">${items.map(([id,label])=>`<label class="multi-choice"><input type="checkbox" data-multi="${key}" value="${escape(id)}"${selected.includes(String(id))?' checked':''}><span>${escape(label)}</span></label>`).join('')}</div></div>`;}
const seasonOptions = () => Object.keys(archive.seasons).map(y=>[y,y]);
const managerOptions = () => archive.managers.map(n=>[n,n]);
function heading(kicker,title,subtitle,season=true) {return `<div class="page-heading"><div><p class="kicker">${escape(kicker)}</p><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${season?`<div class="season-select">${select('SEASON','season',seasonOptions())}</div>`:''}</div>`;}
function metric(label,value,note,icon='') {return `<div class="metric"><span class="metric-label">${escape(label)}<span class="mini">${escape(icon)}</span></span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`;}
function managerLink(manager) {return `<button class="manager-link" data-profile="${escape(manager)}">${escape(manager)}</button>`;}
function empty(title,message) {return `<div class="panel"><div class="empty"><strong>${escape(title)}</strong>${escape(message)}</div></div>`;}
function badge(phase) {return `<span class="badge ${phase==='unconfirmed'?'amber':''}">${escape(PHASE_LABELS[phase])}</span>`;}
function totalsTable(rows,{rank=true,activity=false}={}) {
  return `<div class="table-wrap"><table><thead><tr>${rank?'<th scope="col">Rank</th>':''}<th scope="col">Manager / team</th><th scope="col" class="num">GP</th><th scope="col" class="num">W–L–T</th><th scope="col" class="num">Win %</th><th scope="col" class="num">PF</th><th scope="col" class="num">PA</th>${activity?'<th scope="col" class="num">Moves</th><th scope="col" class="num">Trades*</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr>${rank?`<td><span class="rank ${r.rank && r.rank<=3?'top':''}">${r.rank??'—'}</span></td>`:''}<td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team_name)}</small></td><td class="num">${r.games||'—'}</td><td class="num record">${r.games?record(r):'—'}</td><td class="num">${pct(r.pct)}</td><td class="num">${r.games?number(r.pf):'—'}</td><td class="num">${r.games?number(r.pa):'—'}</td>${activity?`<td class="num">${r.moves??'—'}</td><td class="num">${r.trades??'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function seasonView() {
  const year=state.season,s=archive.seasons[year],regular=filterGames(archive,{season:year,phase:'regular_season'}),unknown=filterGames(archive,{season:year,phase:'unconfirmed'}),post=filterGames(archive,{season:year,phase:'playoffs'}),all=filterGames(archive,{season:year});
  const expected = s.regular_season_weeks?.length*s.teams.length/2;
  const complete = expected>0 && regular.length===expected;
  const champ=s.teams.find(t=>t.manager===s.champion_manager);
  const statsPhase=regular.length?'regular_season':'unconfirmed';
  const rows=standings(archive,year,statsPhase);
  return heading('THE SEASON BOOK',`${year}. The story so far.`, 'Revisit the scores, the standings, and the teams that made the season.')+
    `<section class="hero"><div><p class="kicker">BUDZIK INVITATIONAL · ${year}</p><h2>${champ?`${escape(champ.manager)} took the crown.`:'Another chapter in the league.'}</h2><p>${champ?`${escape(champ.team_name)} won the saved championship final, ${number(post.find(g=>g.round==='final')?.a.manager===champ.manager?post.find(g=>g.round==='final')?.a.score:post.find(g=>g.round==='final')?.b.score)}–${number(post.find(g=>g.round==='final')?.a.manager===champ.manager?post.find(g=>g.round==='final')?.b.score:post.find(g=>g.round==='final')?.a.score)}. Explore every captured result below.`:'The season is in progress. Completed final scores count toward records; remaining games are kept in the schedule.'}</p></div><div class="hero-mark">${champ?'♜':year.slice(2)}<small>${champ?'CHAMPION':'SEASON ARCHIVE'}</small></div></section>`+
    `<section class="metrics" aria-label="Season summary">${metric('Teams',s.teams.length,'Mapped to their managers','◎')}${metric('Recorded matchups',all.length,`${regular.length} regular · ${post.length} playoff · ${unknown.length} unconfirmed`,'↔')}${metric('Regular season',complete?`${regular.length} / ${expected}`:regular.length?regular.length:'Pending',complete?'All regular-season games captured':s.status==='in_progress'?`Complete through Week ${Math.max(...s.completed_weeks)}`:'Phase classification needs confirmation')}${metric('Champion',s.champion_manager||'Pending',s.runner_up_manager?`Runner-up: ${s.runner_up_manager}`:'Playoff finish not yet supplied','♜')}</section>`+
    (unknown.length?`<div class="notice"><strong>${year} Weeks 1–14 are fully captured.</strong> These ${unknown.length} games still need season-phase confirmation. The totals below cover those weeks and exclude the separately recorded championship playoffs.</div>`:'')+
    `<section class="panel"><div class="panel-heading"><div><h2>${regular.length?'Regular-season standings':'Recorded-game totals'}</h2><p>${regular.length?'Calculated from saved regular-season scores. Playoffs excluded.':'Season phase unconfirmed · Alphabetical display · Complete Weeks 1–14'}</p></div><button class="text-button" data-goto="matchups" data-phase="${statsPhase}">Browse scores ↗</button></div>${totalsTable(regular.length?rows:rows.sort((a,b)=>a.manager.localeCompare(b.manager)),{rank:!!regular.length,activity:true})}<div class="panel-footnote">${regular.length?'Ranked by (wins + ½ ties) / games, then points for. These are calculated standings, not imported Yahoo seeds.':'GP, records, PF, and PA reflect captured games only. No standings ranks are assigned.'} *Trades are each manager’s participation count, not distinct league transactions.</div></section>`+
    `<section class="panel"><div class="panel-heading"><div><h2>What’s in this chapter</h2><p>${escape(s.notes?.join(' ')||'No source notes supplied.')}</p></div><button class="text-button" data-goto="archive">Archive notes ↗</button></div></section>`;
}
function gameCard(g) {
  const winner = g.a.score>g.b.score?'a':g.b.score>g.a.score?'b':null;
  const scoreRow=(t,key)=>`<div class="score-row ${winner===key?'winner':''}"><div class="name">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></div><span class="score">${number(t.score)}</span></div>`;
  const total=Math.max(Math.abs(g.a.score)+Math.abs(g.b.score),1);
  return `<article class="game-card"><div class="game-top">${badge(g.phase)}<span class="meta">${g.round==='final'?'Championship final':g.phase==='playoffs'?'Championship bracket':`${g.season} · Week ${g.week}`}</span></div>${scoreRow(g.a,'a')}${scoreRow(g.b,'b')}<div class="scorebar" aria-hidden="true"><span class="${winner==='a'?'winner':''}" style="flex:${Math.abs(g.a.score)/total}"></span><span class="${winner==='b'?'winner':''}" style="flex:${Math.abs(g.b.score)/total}"></span></div><div class="game-bottom"><span>${winner?`${escape(g[winner].manager)} by ${number(Math.abs(g.a.score-g.b.score))}`:'Tied matchup'}</span><span>${g.weekInferred?'Week inferred':g.confirmedBy.length>=2?'Both schedules supplied':'Saved result'}</span></div></article>`;
}
function gamesList(games) {
  if (!games.length) return empty('No matchups in this view','Try another phase, week, manager, or season. No missing scores are filled in.');
  const groups = new Map();
  games.forEach(g=>{const key=`${g.season}|${g.week}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);});
  return [...groups.values()].map(gs=>`<section class="matchweek"><div class="week-heading"><h2>${gs[0].season} · Week ${gs[0].week}${gs.some(g=>g.weekInferred)?' (inferred)':''}</h2><span>${gs.length} ${gs.length===1?'matchup':'matchups'}</span></div><div class="game-grid">${gs.map(gameCard).join('')}</div></section>`).join('');
}
function matchupView() {
  const games=filterGames(archive,{season:state.season,phase:state.phase,week:state.week,manager:state.manager});
  const weeks=[...new Set(filterGames(archive,{season:state.season}).map(g=>g.week))].sort((a,b)=>a-b);
  const managers=archive.seasons[state.season].teams.map(t=>[t.manager,t.manager]).sort((a,b)=>a[0].localeCompare(b[0]));
  return heading('THE SCOREBOARD','Every matchup. Every margin.','Filter the captured results by phase, week, or manager.')+
    `<div class="filters">${select('Season phase','phase',Object.entries(PHASE_LABELS))}${select('Week','week',[['all','All weeks'],...weeks.map(w=>[w,`Week ${w}`])])}${select('Manager','manager',[['all','All managers'],...managers])}<span class="spacer"></span><span class="count">${games.length} results</span><button class="secondary" data-export="matchups">Export CSV ↓</button></div>`+
    (state.season==='2016'&&filterGames(archive,{season:'2016',phase:'unconfirmed'}).length?'<div class="notice">2016 Weeks 1–14 still need season-phase confirmation. Choose “Phase unconfirmed” for those 70 games. The “Playoffs” filter shows the separately supplied Week 15 semifinals and Week 16 final.</div>':'')+gamesList(games);
}
function playoffView() {
  const s=archive.seasons[state.season],games=filterGames(archive,{season:state.season,phase:'playoffs'});
  return heading('THE POSTSEASON','The road to the crown.','Confirmed finishes stay separate from regular-season standings.')+
    (s.champion_manager?`<div class="podium">${[[1,s.champion_manager,'Champion'],[2,s.runner_up_manager,'Runner-up']].map(([rank,name,title])=>`<article class="finish-card ${rank===1?'first':''}"><div class="finish-number">${rank}</div><div><p class="kicker">${title}</p><h2>${escape(name)}</h2><p>${escape(s.teams.find(t=>t.manager===name)?.team_name||'')}</p></div></article>`).join('')}</div>`:'')+
    `<div class="notice">${games.length?`${games.length} championship-bracket games are saved. ${games.some(g=>g.weekInferred)?'Inferred week labels are marked on the matchups. ':''}Byes and projections are excluded. Other playoff games and finishes were not supplied; semifinal losses do not establish third or fourth place.`:s.status==='in_progress'?'The 2026 season is in progress. Playoff results and finishes will appear after those games are completed.':'No confirmed playoff games or finishes are available for this season.'}</div>`+
    (games.length?gamesList(games):empty('Postseason still to be compiled','The archive will show playoff finishes when confirmed results are supplied.'));
}
function h2hView() {
  const filters={season:state.scope,phase:state.phase},pair=headToHead(archive,state.a,state.b,filters),total=pair.games.length;
  return heading('THE RIVALRY ROOM','Settle it on the scoreboard.','All-time means all captured seasons. Change the phase to compare regular-season or playoff records.',false)+
    `<div class="filters">${select('Manager','a',managerOptions())}${select('Opponent','b',managerOptions().filter(([n])=>n!==state.a))}${select('Seasons','scope',[['all','All compiled seasons'],...seasonOptions()])}${select('Season phase','phase',Object.entries(PHASE_LABELS))}<button class="secondary" data-swap>Swap ⇄</button></div>`+
    `<div class="notice">The archive covers ${Object.keys(archive.seasons)[0]}–${Object.keys(archive.seasons).at(-1)}. 2016 Weeks 1–14 are confirmed regular season. Phase filters separate regular-season and playoff games. Renamed teams use their saved manager identity.</div>`+
    `<section class="versus" aria-label="Head-to-head comparison"><div><span class="avatar">${escape(initials(state.a))}</span><h2>${escape(state.a)}</h2><div class="big-number">${pair.a.wins}</div><div class="big-label">WINS</div><small>${total?number(pair.a.pf):'—'} points for · ${pct(pair.a.pct)}</small></div><div class="vs">vs<span class="tied">${pair.a.ties} tied</span><span class="tied">${total} ${total===1?'game':'games'}</span></div><div><span class="avatar gold">${escape(initials(state.b))}</span><h2>${escape(state.b)}</h2><div class="big-number">${pair.b.wins}</div><div class="big-label">WINS</div><small>${total?number(pair.b.pf):'—'} points for · ${pct(pair.b.pct)}</small></div></section>`+
    (total?`<div class="h2h-bars" aria-hidden="true"><span style="flex:${pair.a.wins}"></span>${pair.a.ties?`<span class="ties" style="flex:${pair.a.ties}"></span>`:''}<span class="opponent" style="flex:${pair.b.wins}"></span></div>`:'')+
    `<section class="panel"><div class="panel-heading"><div><h2>The complete rivalry grid</h2><p>Each cell is the row manager’s wins–losses–ties. Select a cell to compare the pair.</p></div><span class="badge">${escape(PHASE_LABELS[state.phase])}</span></div>${matrix(filters)}</section>`+
    `<div class="panel-heading"><div><h2>${escape(state.a)} vs ${escape(state.b)}</h2><p>${total} captured results · ${escape(state.scope==='all'?'All compiled seasons':state.scope)}</p></div><button class="text-button" data-export="h2h">Export CSV ↓</button></div>`+gamesList(pair.games);
}
function matrix(filters) {
  const managers=state.scope==='all'?archive.managers:archive.seasons[state.scope].teams.map(t=>t.manager).sort();
  return `<div class="table-wrap"><table class="matrix"><thead><tr><th scope="col">Manager ↓ / Opponent →</th>${managers.map(n=>`<th scope="col">${escape(n)}</th>`).join('')}</tr></thead><tbody>${managers.map(a=>`<tr><th scope="row">${escape(a)}</th>${managers.map(b=>{if(a===b)return '<td aria-label="Same manager">—</td>';const s=headToHead(archive,a,b,filters).a;return `<td><button class="matrix-button ${s.wins>s.losses?'positive':s.losses>s.wins?'negative':''}" data-pair-a="${escape(a)}" data-pair-b="${escape(b)}" aria-label="${escape(a)} vs ${escape(b)}: ${s.games?`${s.wins} wins, ${s.losses} losses, ${s.ties} ties`:'no captured games'}">${s.games?record(s):'—'}</button></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function divisionsView() {
 const years=state.scope==='all'?Object.keys(archive.seasons):[state.scope],q=state.q.toLocaleLowerCase();
 return heading('THE DIVISION BOOK','Titles earned over the years.','Division winners use overall regular-season win percentage, then points for. Playoff finish and division-only record do not decide the title.',false)+
 `<div class="filters">${select('Seasons','scope',[['all','All seasons'],...seasonOptions()])}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Search division history…" maxlength="100"></label></div>`+
 years.map(y=>{const groups=divisionStandings(archive,y).filter(d=>d.teams.some(t=>[t.manager,t.team_name].some(n=>n.toLocaleLowerCase().includes(q))));if(!groups.length)return '';return `<section class="panel"><div class="panel-heading"><div><h2>${y} divisions</h2><p>${archive.seasons[y].status==='in_progress'?`Current leaders through Week ${currentWeek()} · No division titles awarded`:'Final regular-season division winners'}</p></div></div><div class="table-wrap"><table><thead><tr><th>Division</th><th>Manager / team</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">PF</th><th>Status</th></tr></thead><tbody>${groups.flatMap(d=>d.teams.map(t=>`<tr><td>${escape(d.division)}</td><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td class="num">${record(t)}</td><td class="num">${pct(t.pct)}</td><td class="num">${number(t.pf)}</td><td>${t.manager===d.winner?`<span class="badge">${d.titleConfirmed?'Division winner':'Current leader'}</span>`:'—'}</td></tr>`)).join('')}</tbody></table></div></section>`;}).join('');
}
function scatter(rows,key) {
 const usable=rows.filter(r=>Number.isFinite(r[key])),max=Math.max(1,...usable.map(r=>r[key]));
 return `<svg class="activity-chart" viewBox="0 0 600 270" role="img" aria-label="${key} versus regular-season win percentage"><line x1="55" y1="225" x2="575" y2="225" stroke="#64736e"/><line x1="55" y1="25" x2="55" y2="225" stroke="#64736e"/>${[0,.5,1].map(v=>`<text x="45" y="${230-200*v}" text-anchor="end">${v*100}%</text><line x1="55" y1="${225-200*v}" x2="575" y2="${225-200*v}" stroke="#e1e6dc"/>`).join('')}${usable.map(r=>`<circle cx="${55+r[key]/max*510}" cy="${225-r.pct*200}" r="4" fill="#285e47" opacity=".65"><title>${escape(r.manager)} · ${r.season}: ${r[key]} ${key}, ${pct(r.pct)} wins</title></circle>`).join('')}<text x="55" y="246">0</text><text x="565" y="246" text-anchor="end">${max}</text><text x="310" y="266" text-anchor="middle">${escape(key)} per season</text></svg>`;
}
function activityView() {
 const averages=activityAverages(archive,{season:state.scope,query:state.q,sort:state.activitySort});
 const rows=activityRows(archive,state.scope,state.q),cor=(key,target)=>pearson(rows.filter(r=>Number.isFinite(r[key])).map(r=>[r[key],r[target]])),fmt=n=>n==null?'Not enough variation':n.toFixed(3);
 return heading('ACTIVITY & RESULTS','Does more activity mean more wins?','Compare moves and trade participation with regular-season results. Completed seasons only.',false)+
 `<div class="filters">${select('Completed seasons','scope',[['all','All completed seasons'],...seasonOptions().filter(([y])=>archive.seasons[y].status!=='in_progress')])}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Compare a manager’s seasons…" maxlength="100"></label></div>`+
 `<div class="notice">Pearson r ranges from −1 to +1: negative means more activity is associated with fewer wins; positive means more activity is associated with more wins. Correlation does not establish cause. Each dot is a manager-season. All-seasons results pool different league sizes and season lengths; use the season filter for within-year comparisons. 2026 is excluded because partial-season activity cannot be compared with completed seasons. Trades count manager participation, not distinct league transactions. Missing activity values are omitted.</div>`+
 `<section class="panel" style="margin-bottom:22px"><div class="panel-heading"><div><h2>Average activity by manager</h2><p>Season averages and percentage of all recorded activity in the selected years.</p></div></div><div class="filters">${select('Sort highest first','activitySort',[['avgMoves','Average moves per season'],['avgTrades','Average trades per season'],['moveShare','Share of league moves'],['tradeShare','Share of trade participation'],['moves','Total moves'],['trades','Total trade participation'],['pct','Win percentage']])}</div><div class="table-wrap"><table><thead><tr><th>Manager</th><th class="num">Seasons</th><th class="num">Total moves</th><th class="num">Avg moves</th><th class="num">Moves %</th><th class="num">Total trades*</th><th class="num">Avg trades*</th><th class="num">Trades %*</th><th class="num">Win %</th></tr></thead><tbody>${averages.rows.map(r=>`<tr><td>${managerLink(r.manager)}</td><td class="num">${r.seasons}</td><td class="num">${r.moveSeasons?number(r.moves):'—'}</td><td class="num record">${number(r.avgMoves)}<small class="record-owner">${r.moveSeasons}/${r.seasons} seasons supplied</small></td><td class="num">${pct(r.moveShare)}</td><td class="num">${r.tradeSeasons?number(r.trades):'—'}</td><td class="num record">${number(r.avgTrades)}<small class="record-owner">${r.tradeSeasons}/${r.seasons} seasons supplied</small></td><td class="num">${pct(r.tradeShare)}</td><td class="num">${pct(r.pct)}</td></tr>`).join('')}</tbody></table></div>${!averages.rows.length?empty('No matching manager','Change the search or season filter.'):''}<div class="panel-footnote">Average = total ÷ seasons with a supplied count; missing counts are not zeros. Moves % = manager moves ÷ all ${number(averages.totals.moves)} recorded moves in the selected years. Trades % = manager trade participation ÷ all ${number(averages.totals.trades)} recorded participations. Search does not change these league denominators. *A two-manager trade counts once for each participant. Completed seasons only; managers with longer careers can have larger total shares.</div></section>`+
 `<section class="metrics">${metric('Moves vs win %',fmt(cor('moves','pct')),`${rows.filter(r=>Number.isFinite(r.moves)).length} manager-seasons`)}${metric('Trades vs win %',fmt(cor('trades','pct')),`${rows.filter(r=>Number.isFinite(r.trades)).length} manager-seasons`)}${metric('Moves vs wins',fmt(cor('moves','wins')),'Regular-season wins')}${metric('Trades vs wins',fmt(cor('trades','wins')),'Regular-season wins')}</section>`+
 `<div class="planner-grid"><section class="panel"><div class="panel-heading"><h2>Moves vs win percentage</h2></div>${scatter(rows,'moves')}</section><section class="panel"><div class="panel-heading"><h2>Trades vs win percentage</h2></div>${scatter(rows,'trades')}</section></div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Season activity and results</h2><p>${rows.length} completed manager-seasons</p></div></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Manager / team</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">Moves</th><th class="num">Trades</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team_name)}</small></td><td class="num">${record(r)}</td><td class="num">${pct(r.pct)}</td><td class="num">${r.moves??'—'}</td><td class="num">${r.trades??'—'}</td></tr>`).join('')}</tbody></table></div>${!rows.length?'<div class="empty"><strong>No completed seasons match</strong>Try another season or search.</div>':''}</section>`;
}
function powerView(){
 const week=state.powerWeek==='latest'?currentWeek():Number(state.powerWeek),rows=powerRankings(archive,{week}),previous=powerRankings(archive,{week:week-1}),old=new Map(previous.map(r=>[r.manager,r.powerRank]));
 const explanation=r=>{const signals=[];signals.push(`${number(r.avg)} PF per game puts season scoring at the ${Math.round(r.scoringPercentile*100)}th comparison percentile in this league.`);signals.push(`Outscored ${pct(r.allPlayRate)} of other-team weekly scores, with ties worth half credit.`);signals.push(`Last ${r.recentWeeks} games averaged ${number(r.recentAvg)} PF, ${Math.abs(r.recentAvg-r.avg).toFixed(2)} ${r.recentAvg>=r.avg?'above':'below'} the season average.`);signals.push(`${record(r)} in actual matchups; wins and losses do not directly enter this scoring-based index.`);return signals.join(' ');};
 return heading('THE POWER BOARD','Who is playing the strongest?','A transparent scoring-based ranking of the current league, updated from saved final results.',false)+
 `<div class="filters">${select('Through week','powerWeek',[['latest',`Latest · Week ${currentWeek()}`],...Array.from({length:currentWeek()},(_,i)=>[String(i+1),`Week ${i+1}`])])}</div>`+
 `<div class="notice"><strong>How we rank:</strong> 45% season-average PF comparison percentile + 35% all-play win rate + 20% last-three-game scoring comparison percentile, multiplied by 100. A comparison percentile is the share of the other 11 teams a team beats on that metric; ties receive half credit. All-play compares a team’s score with every other team’s score in each completed week, regardless of its scheduled opponent. Recent scoring uses up to three games. Weights are editorial choices, not fitted or validated predictions. The index is not a playoff probability. Player projections, injuries and roster changes are not modeled.</div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>2026 power rankings · Week ${week}</h2><p>Movement compares with Week ${week-1}. Final scores only; incomplete league weeks are excluded.</p></div></div><div class="table-wrap"><table><thead><tr><th>Power rank</th><th>Change</th><th>Manager / team</th><th class="num">Power index / 100</th><th>Record</th><th class="num">Avg PF</th><th class="num">All-play win %</th><th class="num">Recent avg PF</th></tr></thead><tbody>${rows.map(r=>{const delta=old.has(r.manager)?old.get(r.manager)-r.powerRank:null;return `<tr><td><span class="rank ${r.powerRank<=3?'top':''}">${r.powerRank}</span></td><td>${delta==null?'New':delta>0?`↑ ${delta}`:delta<0?`↓ ${-delta}`:'—'}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team_name)}</small></td><td class="num record">${r.powerScore.toFixed(1)}</td><td>${record(r)}</td><td class="num">${number(r.avg)}</td><td class="num">${pct(r.allPlayRate)}</td><td class="num">${number(r.recentAvg)}</td></tr>`;}).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><h2>Why each team is ranked here</h2></div><div class="power-explanations">${rows.map(r=>`<article><h3>#${r.powerRank} · ${escape(r.team_name)} <small>${escape(r.manager)}</small></h3><p>${escape(explanation(r))}</p><p class="power-components">Index contributions: season scoring ${(45*r.scoringPercentile).toFixed(1)} / 45 · all-play ${(35*r.allPlayRate).toFixed(1)} / 35 · recent scoring ${(20*r.recentPercentile).toFixed(1)} / 20.</p></article>`).join('')}</div></section>`;
}
function predictionsView() {
 const s=archive.seasons['2026'],rows=standings(archive,'2026'),byId=new Map(s.teams.map(t=>[String(t.team_id),t])),groups=divisionStandings(archive,'2026'),leaders=rows.filter(t=>groups.some(d=>d.winner===t.manager)),wild=rows.filter(t=>!leaders.some(l=>l.manager===t.manager)).slice(0,3),qualified=[...leaders,...wild];
 const estimate=playoffEstimate||(playoffEstimate=simulatePlayoffs(archive)),history=historicalStarts(archive,currentWeek()),baseline=startingRecordRate(history,state.startRecord);
 const chance=n=>n<.001?'Less than 0.1%':n>.999?'Over 99.9%':pct(n);
 const schedule=s.remaining_schedule.filter(g=>g.week===Number(state.forecastWeek));
 return heading('THE PLAYOFF PICTURE','2026: the road ahead.',`Results through Week ${currentWeek()}, the remaining fantasy schedule, and your saved roster snapshots.`,false)+
 `<div class="notice"><strong>PF-based playoff estimates are live.</strong> We simulate ${number(estimate.iterations)} finishes using each team’s average PF through Week ${currentWeek()} and the supplied Weeks ${currentWeek()+1}–14 schedule. Weekly scoring variation comes from 2021–2025 regular-season scores (pooled within-team standard deviation: ${number(estimate.sd)} points). Each simulated season also varies team scoring strength by ${number(estimate.sd/Math.sqrt(currentWeek()))} points of standard deviation to reflect having ${currentWeek()} games of evidence. The model assumes scoring strength stays constant, scores vary independently week to week, and uses your division / wild-card / bye rules. These are estimates, not guarantees; injuries, future roster changes, NFL byes, and player projections are not modeled.</div>`+
 `<section class="metrics">${metric('Completed matchups',filterGames(archive,{season:'2026'}).length,`Weeks 1–${currentWeek()} only`)}${metric('Remaining matchups',s.remaining_schedule.length,`Weeks ${currentWeek()+1}–14`)}${metric('Playoff spots',6,'3 division winners + 3 wild cards')}${metric('First-round byes',2,'Top two division winners')}</section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Estimated playoff chances</h2><p>PF scoring model and historical starting-record rates are shown separately. The observed rate is a reference, not a second probability blended into the simulation.</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th class="num">Current record</th><th class="num">Avg PF</th><th class="num">Projected wins</th><th class="num">Make playoffs</th><th class="num">Win division</th><th class="num">Earn bye</th><th>Past teams with this start</th></tr></thead><tbody>${[...estimate.rows].sort((a,b)=>b.playoffChance-a.playoffChance).map(t=>{const past=startingRecordRate(history,record(t));return `<tr><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td class="num">${record(t)}</td><td class="num">${number(t.avg)}</td><td class="num">${t.projectedWins.toFixed(1)}</td><td class="num record">${chance(t.playoffChance)}</td><td class="num">${chance(t.divisionChance)}</td><td class="num">${chance(t.byeChance)}</td><td>${pct(past.rate)}<small class="record-owner">${past.made} of ${past.games} qualified</small></td></tr>`;}).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>What happened after that start?</h2><p>2017–2025 · 12 teams and six playoff qualifiers · Records after ${currentWeek()} games · ${history.length} manager-seasons. Earlier four-team playoff formats are excluded.</p></div></div><div class="filters">${select(`Starting record after Week ${currentWeek()}`,'startRecord',[...new Set(history.map(r=>r.record))].sort().map(r=>[r,r]))}</div><div class="notice"><strong>${baseline.made} of ${baseline.games} teams starting ${escape(state.startRecord)} made the playoffs (${pct(baseline.rate)}).</strong> Small samples are noisy. An observed 0% does not mean a current team has no chance. Qualification is identified from the saved championship brackets.</div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Manager / team</th><th>Start</th><th>Made playoffs?</th></tr></thead><tbody>${baseline.samples.map(r=>`<tr><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team)}</small></td><td>${escape(r.record)}</td><td>${r.qualified?'Yes':'No'}</td></tr>`).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>If the season ended today</h2><p>Division winners qualify automatically. Other spots use overall win percentage, then points for.</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th>Division</th><th class="num">Record</th><th class="num">PF</th><th>Current position</th><th>PF-based playoff chance</th></tr></thead><tbody>${rows.map(t=>`<tr><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td>${escape(t.division)}</td><td class="num">${record(t)}</td><td class="num">${number(t.pf)}</td><td>${leaders.slice(0,2).some(l=>l.manager===t.manager)?'Division leader · Bye':leaders.some(l=>l.manager===t.manager)?'Division leader':qualified.some(l=>l.manager===t.manager)?'Wild card':'Outside current field'}</td><td>${chance(estimate.rows.find(r=>r.manager===t.manager).playoffChance)}</td></tr>`).join('')}</tbody></table></div></section>`+
 `<div class="filters">${select('Remaining schedule week','forecastWeek',[...new Set(s.remaining_schedule.map(g=>g.week))].sort((a,b)=>a-b).map(w=>[String(w),`Week ${w}`]))}</div><section class="panel"><div class="panel-heading"><h2>Week ${state.forecastWeek} matchups</h2></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th>Opponent / team</th><th>Week type</th></tr></thead><tbody>${schedule.map(g=>{const a=byId.get(String(g.team_id)),b=byId.get(String(g.opponent_id));return `<tr><td class="team-cell">${managerLink(a.manager)}<small>${escape(a.team_name)}</small></td><td class="team-cell">${managerLink(b.manager)}<small>${escape(b.team_name)}</small></td><td>${g.rivalry_week?'Rivalry Week':'Regular week'}</td></tr>`;}).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>All 12 roster snapshots</h2><p>Supplied October 10, 2026 · Injury labels are from the supplied snapshot, not live updates. Starter placement is ignored for the future best-projected-lineup model.</p></div></div><div class="roster-list">${s.teams.map(t=>`<details><summary>${escape(t.manager)} · ${escape(t.team_name)} <span>${s.rosters[t.manager].length} players / defenses</span></summary><ul>${s.rosters[t.manager].map(n=>`<li>${escape(n)}</li>`).join('')}</ul></details>`).join('')}</div></section>`;
}
function plannerView() {
 const pairs=plannedPairs(),errors=validateWeeklyPairs(pairs),latest=Object.keys(archive.seasons).at(-1);
 const current=archive.seasons[latest].teams.map(t=>t.manager).sort();
 const choices=[['','Choose a manager'],...current.map(n=>[n,`${n} · ${archive.aliases.get(n).at(-1).team_name}`]),...archive.managers.filter(n=>!current.includes(n)).map(n=>[n,`${n} · Past manager`])];
 return heading('THIS WEEK’S RIVALRIES','2026 matchup planner.','Enter this week’s opponents to see how each rivalry has played out across the archive.',false)+
 `<div class="filters">${select('Week','plannerWeek',Array.from({length:18},(_,i)=>[String(i+1),`Week ${i+1}`]))}${select('Historical seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Historical game phase','phase',Object.entries(PHASE_LABELS))}</div>`+
 `<div class="notice">${planStorageAvailable?'Matchup selections save automatically in this browser.':'Matchup selections are kept for this visit; browser storage is unavailable.'} Each week has its own matchups. Historical records include final results through 2026 Week ${currentWeek()}; entering opponents does not add a scored game. Manager choices show their latest known team names.</div>`+
 `<div class="planner-grid">${pairs.map((p,i)=>{const pair=!errors[i]?headToHead(archive,p.a,p.b,{season:state.scope,phase:state.phase}):null;return `<section class="panel planner-card"><div class="panel-heading"><h2>Matchup ${i+1}</h2></div><div class="filters"><label>Manager<select data-plan-index="${i}" data-plan-side="a" aria-label="Matchup ${i+1} manager">${options(choices,p.a)}</select></label><label>Opponent<select data-plan-index="${i}" data-plan-side="b" aria-label="Matchup ${i+1} opponent">${options(choices,p.b)}</select></label></div>${pair?`<div class="planner-comparison"><div><strong>${escape(p.a)}</strong><span>${record(pair.a)}</span><small>Head to head: ${pct(pair.a.pct)} · ${number(pair.a.pf)} PF</small><small>Overall: ${record(stats(filterGames(archive,{season:state.scope,phase:state.phase}),p.a))}</small></div><div><strong>${escape(p.b)}</strong><span>${record(pair.b)}</span><small>Head to head: ${pct(pair.b.pct)} · ${number(pair.b.pf)} PF</small><small>Overall: ${record(stats(filterGames(archive,{season:state.scope,phase:state.phase}),p.b))}</small></div></div><p class="planner-note">${pair.games.length} historical games · ${pair.games.length?`${escape(pair.a.wins>pair.b.wins?p.a:pair.b.wins>pair.a.wins?p.b:'Neither manager')} ${pair.a.wins===pair.b.wins?'leads; wins are even.':'leads the series.'}`:'First recorded meeting.'}</p><button class="text-button" data-pair-a="${escape(p.a)}" data-pair-b="${escape(p.b)}">View every past matchup ↗</button>`:`<p class="planner-note" role="status">${escape(errors[i])}</p>`}</section>`;}).join('')}</div>`;
}
function rivalriesView() {
 const rows=rivalryRecords(archive,{season:state.scope,phase:state.phase,minimum:Number(state.minimum),query:state.q,order:state.order});
 return heading('THE RIVALRY LEADERBOARD','Who has whose number?','Rank manager-versus-opponent records by win percentage, with ties counting as half a win.',false)+
 `<div class="filters">${select('Ranking','order',[['best','Best records'],['worst','Worst records']])}${select('Minimum meetings','minimum',[['1','1 game'],['3','3 games'],['5','5 games'],['10','10 games']])}${select('Seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Season phase','phase',Object.entries(PHASE_LABELS))}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Try Josh or Montana…" maxlength="100"></label></div>`+
 `<div class="notice">Each row is the manager’s record against that opponent. Equal win percentages sort by most meetings, then manager name. Both sides of a rivalry may appear. The minimum-games filter avoids ranking a single meeting alongside a long rivalry.</div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>${state.order==='worst'?'Worst':'Best'} head-to-head records</h2><p>${rows.length} qualifying records</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager</th><th>Opponent</th><th class="num">GP</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">PF</th><th class="num">PA</th><th>History</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${managerLink(r.manager)}</td><td>${managerLink(r.opponent)}</td><td class="num">${r.games}</td><td class="num record">${record(r)}</td><td class="num">${pct(r.pct)}</td><td class="num">${number(r.pf)}</td><td class="num">${number(r.pa)}</td><td><button class="text-button" data-pair-a="${escape(r.manager)}" data-pair-b="${escape(r.opponent)}">Compare ↗</button></td></tr>`).join('')}</tbody></table></div>${!rows.length?'<div class="empty"><strong>No qualifying rivalries</strong>Lower the minimum meetings or change the filters.</div>':''}</section>`;
}
function highlightsView() {
 const rows=gameRecords(archive,{category:state.category,season:state.scope,phase:state.phase,query:state.q});
 const shown=rows.filter(r=>r.rank<=25);
 return heading('THE LEAGUE RECORDS','Scores worth remembering.','The highs, the lows, the blowouts, and the games decided by almost nothing.',false)+
 `<div class="filters">${select('Record','category',Object.entries(GAME_RECORDS))}${select('Seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Season phase','phase',Object.entries(PHASE_LABELS))}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Search any past team name…" maxlength="100"></label></div>`+
 `<div class="notice">Team scores are individual performances; combined scores add both teams. Closest decided games exclude ties, which have their own category. Rankings reflect the selected filters. Ties share a rank. Scoring formats changed across seasons, so use the season filter for comparisons within one year.</div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>${escape(GAME_RECORDS[state.category])}</h2><p>${rows.length} matching ${state.category.endsWith('_team')?'performances':'games'} · Top 25 ranks, including tied records</p></div></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th class="num">${state.category.endsWith('_team')?'Team score':state.category.endsWith('_total')?'Combined points':'Margin'}</th><th>Matchup / final score</th><th>Season / week</th><th>Phase</th></tr></thead><tbody>${shown.map(r=>{const g=r.game;return `<tr><td><span class="rank ${r.rank<=3?'top':''}">${r.rank}</span></td><td class="num record">${number(r.value)}${r.manager?`<small class="record-owner">${managerLink(r.manager)}</small>`:''}</td><td class="team-cell">${managerLink(g.a.manager)} ${number(g.a.score)} — ${number(g.b.score)} ${managerLink(g.b.manager)}<small>${escape(g.a.team_name)} vs ${escape(g.b.team_name)}</small></td><td>${g.season} · Week ${g.week}${g.weekInferred?' (inferred)':''}</td><td>${badge(g.phase)}</td></tr>`;}).join('')}</tbody></table></div>${!rows.length?'<div class="empty"><strong>No matching records</strong>Try another category, season, phase, or search.</div>':''}</section>`;
}
function weeklyRecordsView(){
 const pf=cumulativePfRecords(archive,{week:state.recordWeek,season:state.scope,order:state.pfOrder,query:state.q});
 const recordPool=cumulativePfRecords(archive,{week:state.recordWeek,season:'all',query:state.q});
 const selectedYears=state.historyYears.split(','),selectedRecords=state.historyRecord.split(',');
 const yearRows=recordPool.filter(r=>state.historyYears==='all'||selectedYears.includes(r.season));
 const recordOptions=[...new Set(yearRows.map(r=>record(r)))].sort((a,b)=>Number(b.split('–')[0])-Number(a.split('–')[0])||a.localeCompare(b));
 const matching=sortRecordHistory(archive,yearRows.filter(r=>state.historyRecord==='all'||selectedRecords.includes(record(r))),state.historySort,state.historyDirection);
 const sortHeader=(key,label,numeric=false)=>`<th${numeric?' class="num"':''} aria-sort="${state.historySort===key?(state.historyDirection==='asc'?'ascending':'descending'):'none'}"><button class="column-sort" data-history-sort="${key}">${label} <span aria-hidden="true">${state.historySort===key?(state.historyDirection==='asc'?'↑':'↓'):'↕'}</span></button></th>`;
 const opponents=toughOpponentSeasons(archive,{season:state.scope,query:state.q,metric:state.opponentMetric});
 const limit=rows=>state.recordLimit==='all'?rows:rows.filter(r=>r.rank<=Number(state.recordLimit));
 return heading('WEEK BY WEEK','Season scoring & tough opponents.','Compare cumulative regular-season PF at the same point in each season, and count matchups against the top weekly scorers.',false)+
 `<div class="filters">${select('Seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Show','recordLimit',[['5','Top 5'],['10','Top 10'],['all','All results']])}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Try Josh or Fluff…" maxlength="100"></label></div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Cumulative points for</h2><p>Weeks 1–${state.recordWeek} · Tied ranks are included at the cutoff.</p></div></div><div class="filters">${select('Through week','recordWeek',Array.from({length:14},(_,i)=>[String(i+1),`Week ${i+1}`]))}${select('Ranking','pfOrder',[['highest','Highest total PF'],['lowest','Lowest total PF']])}</div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Season</th><th>Manager / team</th><th class="num">Total PF</th><th>Record through week</th><th>Regular-season rank</th><th>Final finish</th></tr></thead><tbody>${limit(pf).map(r=>`<tr><td>${r.rank}</td><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team)}</small></td><td class="num record">${number(r.pf)}</td><td>${record(r)}</td><td>${r.season==='2026'?'Current ':''}${r.regularRank}</td><td>${escape(r.finish)}</td></tr>`).join('')}</tbody></table></div>${!pf.length?empty('No complete totals for this week','Select an earlier week or another season.'):''}<div class="panel-footnote">A season is included only when every team has a saved final score in every week through the selected week. Playoffs and partial scores are excluded. Different scoring rules across years can affect comparisons. Exact final places beyond champion and runner-up were not supplied.</div></section>`+
 `<section class="panel" style="margin-top:22px"><div class="panel-heading"><div><h2>Teams with this record through Week ${state.recordWeek}</h2><p>Every matching historical team · ${matching.length} results · Top 5/10 limits do not apply to this lookup.</p></div></div><div class="filters">${select('Through week','recordWeek',Array.from({length:14},(_,i)=>[String(i+1),`Week ${i+1}`]))}${multiSelect('Years','historyYears',[['all','All years'],...seasonOptions()])}${multiSelect('W–L–T records','historyRecord',[['all','All records'],...[...new Set([...recordOptions,...selectedRecords.filter(r=>r!=='all')])].map(r=>[r,r])])}</div><div class="table-wrap"><table><thead><tr>${sortHeader('season','Season')}${sortHeader('manager','Manager / team')}${sortHeader('record','Record through week')}${sortHeader('pf','PF through week',true)}${sortHeader('finalRecord','Final regular-season record')}${sortHeader('regularRank','Regular-season rank')}${sortHeader('finish','Final finish')}</tr></thead><tbody>${matching.map(r=>{const final=r.finalStats;return `<tr><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team)}</small></td><td class="record">${record(r)}</td><td class="num">${number(r.pf)}</td><td>${record(final)}${archive.seasons[r.season].status==='in_progress'?' · current':''}</td><td>${archive.seasons[r.season].status==='in_progress'?'Current ':''}${r.regularRank}</td><td>${escape(r.finish)}</td></tr>`;}).join('')}</tbody></table></div>${!matching.length?empty('No teams match this record','Change the record, week, season, or search.'):''}<div class="panel-footnote">Check as many years and records as you want. Both filters apply together. Checking “All” resets that filter. These year selections are independent of the season filter above; the search still applies. Click a column heading to sort; click again to reverse. Records sort by win percentage, then wins and ties. Final finish sorts by confirmed place or playoff round; unknown and ongoing finishes follow. Only final regular-season scores count. Ongoing seasons show current results; precise unsupplied playoff places are not inferred.</div></section>`+
 `<section class="panel" style="margin-top:22px"><div class="panel-heading"><div><h2>Most games against top scorers</h2><p>Each opponent is ranked against all teams scoring that week, including your own team.</p></div></div><div class="filters">${select('Rank by','opponentMetric',[['combined','Highest or second-highest'],['highest','Highest scorer'],['second','Second-highest scorer']])}</div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Season</th><th>Manager / team</th><th class="num">Faced #1</th><th class="num">Faced #2</th><th class="num">Combined</th><th class="num">Weeks counted</th><th>Final finish</th><th>Qualifying matchups</th></tr></thead><tbody>${limit(opponents).map(r=>`<tr><td>${r.rank}</td><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team)}</small></td><td class="num">${r.highest}</td><td class="num">${r.second}</td><td class="num record">${r.combined}</td><td class="num">${r.weeks}${r.season==='2026'?' · ongoing':''}</td><td>${escape(r.finish)}</td><td><details><summary>View ${r.combined} games</summary>${r.details.map(d=>`<div>Week ${d.week}: ${escape(d.opponent)} · ${number(d.score)} PF · #${d.rank} · ${d.result}</div>`).join('')||'None'}</details></td></tr>`).join('')}</tbody></table></div>${!opponents.length?empty('No matching seasons','Change the search or season filter.'):''}<div class="panel-footnote">Regular season only. Incomplete league scoreboards are excluded. Tied scorers share competition rank: 1, 1, 3; two teams tied for first both count as #1, and there is no #2 that week. The ongoing season is counted only through saved final weeks.</div></section>`;
}
function recordsView() {
  const games=filterGames(archive,{season:state.scope,phase:state.phase});
  const years=state.scope==='all'?Object.keys(archive.seasons):[state.scope];
  const query=state.q.toLocaleLowerCase();
  const rows=archive.managers.map(manager=>{
    const aliases=archive.aliases.get(manager).filter(t=>years.includes(t.season));
    return {manager,aliases,...stats(games,manager),divisionTitles:divisionTitles(archive,manager,years).length,moves:aliases.reduce((n,t)=>n+(t.moves??0),0),trades:aliases.reduce((n,t)=>n+(t.trades??0),0),tradeSeasons:aliases.filter(t=>Number.isFinite(t.trades)).length,titles:years.filter(y=>archive.seasons[y].champion_manager===manager).length};
  }).filter(r=>r.aliases.length && (r.manager.toLocaleLowerCase().includes(query)||r.aliases.some(t=>t.team_name.toLocaleLowerCase().includes(query))));
  rows.sort((a,b)=>state.sort==='wins'?b.wins-a.wins || (b.pct??0)-(a.pct??0):state.sort==='points'?b.pf-a.pf:state.sort==='titles'?b.titles-a.titles || b.wins-a.wins:state.sort==='division'?b.divisionTitles-a.divisionTitles||b.wins-a.wins:state.sort==='moves'?b.moves-a.moves:state.sort==='trades'?b.trades-a.trades:state.sort==='name'?a.manager.localeCompare(b.manager):(b.pct??-1)-(a.pct??-1)||b.wins-a.wins);
  return heading('THE ALL-TIME RECORD BOOK','Every season adds up.','Search by manager or any past team name. Compare career records, scoring, and championships.',false)+
    `<div class="filters"><label class="grow">Search manager or team<input id="alias-search" type="search" placeholder="Try Josh, Phony, or Montana…" value="${escape(state.q)}" maxlength="100"></label>${select('Seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Season phase','phase',Object.entries(PHASE_LABELS))}${select('Sort by','sort',[['wins','Most wins'],['pct','Win percentage'],['points','Points for'],['titles','Championships'],['division','Division titles'],['moves','Moves'],['trades','Trades'],['name','Manager name']],state.sort||'wins')}</div>`+
    `<div class="notice">All recorded games includes final results through 2026 Week ${currentWeek()}. Current division leaders are not counted as titles. Moves include the supplied 2026 partial totals; 2026 trade counts are not supplied. Championships count saved finals in the selected seasons regardless of the game-phase filter. Win percentage gives ties half credit.</div>`+
    `<section class="panel"><div class="panel-heading"><div><h2>All-time manager records</h2><p>${rows.length} managers · ${games.length} unique matchups in the selected scope</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager</th><th class="num">Seasons</th><th class="num">GP</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">PF</th><th class="num">PA</th><th class="num">Avg PF</th><th class="num">Titles</th><th class="num">Division titles</th><th class="num">Moves</th><th class="num">Trades*</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${managerLink(r.manager)}</td><td class="num">${r.aliases.length}</td><td class="num">${r.games}</td><td class="num record">${record(r)}</td><td class="num">${pct(r.pct)}</td><td class="num">${number(r.pf)}</td><td class="num">${number(r.pa)}</td><td class="num">${number(r.avg)}</td><td class="num">${r.titles}</td><td class="num">${r.divisionTitles}</td><td class="num">${r.moves}</td><td class="num">${r.tradeSeasons?r.trades:'—'}<small class="record-owner">${r.tradeSeasons}/${r.aliases.length} seasons supplied</small></td></tr>`).join('')}</tbody></table></div>${!rows.length?'<div class="empty"><strong>No matching manager or team</strong>Try another name or a shorter search.</div>':''}</section>`;
}
function managerView() {
  const query=state.q.toLocaleLowerCase(),managers=archive.managers.filter(n=>n.toLocaleLowerCase().includes(query)||archive.aliases.get(n).some(t=>t.team_name.toLocaleLowerCase().includes(query)));
  return heading('SAME MANAGER. DIFFERENT JERSEY.','Names change. Records stay.','Saved mappings connect each season’s team name to one manager, so rivalries survive every rename.',false)+
    `<div class="filters"><label class="grow">Find a manager or team alias<input id="alias-search" type="search" placeholder="Try Josh, Winnie, or Beckham…" value="${escape(state.q)}" maxlength="100"></label><span class="count">${managers.length} managers · ${Object.values(archive.seasons).reduce((n,s)=>n+s.teams.length,0)} season entries</span></div>`+
    `<div class="alias-grid">${managers.map(n=>`<article class="alias-card"><div class="alias-title"><span class="avatar">${escape(initials(n))}</span><div><h2>${escape(n)}</h2><p>${archive.aliases.get(n).length} ${archive.aliases.get(n).length===1?'season':'seasons'} in the archive</p></div></div>${archive.aliases.get(n).map(t=>`<div class="alias-row"><span class="alias-year">${t.season}</span><div class="alias-name">${escape(t.team_name)}<small>Saved manager mapping: ${escape(n)}</small></div></div>`).join('')}<button class="text-button" data-profile="${escape(n)}">View manager history ↗</button></article>`).join('')}</div>`+
    (!managers.length?empty('No matching manager or alias','Try a shorter name or another team name.'):``);
}
function profileView() {
  const n=state.profile,aliases=archive.aliases.get(n),games=filterGames(archive,{manager:n}),regular=games.filter(g=>g.phase==='regular_season'),post=games.filter(g=>g.phase==='playoffs'),unknown=games.filter(g=>g.phase==='unconfirmed'),rs=stats(regular,n),ps=stats(post,n),us=stats(unknown,n);
  return `<button class="text-button back-button" data-goto="managers">← All managers</button>`+heading('THE MANAGER FILE',n,'Every mapped team, every captured season. Phase totals remain separate.',false)+
    `<section class="metrics">${metric('Compiled seasons',aliases.length,aliases.map(t=>t.season).join(' · '))}${metric('Regular-season record',rs.games?record(rs):'—',`${rs.games} captured games`)}${metric('Playoff record',ps.games?record(ps):'—',`${ps.games} captured games`)}${metric('Phase-unconfirmed record',us.games?record(us):'—',`${us.games} captured games`)}</section>`+
    `<section class="panel"><div class="panel-heading"><div><h2>Team-name timeline</h2><p>These saved mappings are the basis for all-time comparisons.</p></div><button class="text-button" data-compare="${escape(n)}">Compare with another manager ↗</button></div><div class="profile-aliases">${aliases.map(t=>`<div><span class="badge">${t.season}</span>${escape(t.team_name)}</div>`).join('')}</div></section>`+
    `<div class="panel-heading"><div><h2>Captured matchup history</h2><p>${games.length} results, across all phases</p></div></div>`+gamesList(games);
}
function archiveView() {
  return heading('ABOUT THE RECORD BOOK','An honest league archive.','A snapshot of the history you compiled. Saved scores drive the calculations; missing history stays visible.',false)+
    `<section class="metrics">${metric('Seasons',Object.keys(archive.seasons).length,`${Object.keys(archive.seasons)[0]}–${Object.keys(archive.seasons).at(-1)}`)}${metric('Unique matchups',archive.games.length,'Each fixture counted once')}${metric('Managers',archive.managers.length,'Joined by saved mappings')}${metric('Validation issues',archive.issues.length,archive.issues.length?'Review issues below':'No score or identity conflicts detected')}</section>`+
    `<div class="source-grid">${Object.entries(archive.seasons).map(([y,s])=>`<section class="source-card"><h2>${y} coverage</h2>${['regular_season','playoffs','unconfirmed'].map(phase=>`<span class="badge ${phase==='unconfirmed'?'amber':''}">${filterGames(archive,{season:y,phase}).length} ${PHASE_LABELS[phase].toLowerCase()}</span>`).join('')}<ul>${(s.notes||[]).map(n=>`<li>${escape(n)}</li>`).join('')}</ul><button class="text-button" data-select-season="${y}">Open season ↗</button></section>`).join('')}</div>`+
    `<section class="panel" style="margin-top:22px"><div class="panel-heading"><div><h2>How the numbers work</h2><p>Calculated consistently across seasons, managers, and rivalry views.</p></div></div><div class="validation-list"><div><span>01</span>A game is keyed by season, week, and the two season-specific team IDs. Matching reverse entries are counted once.</div><div><span>02</span>Wins, losses, and ties come from final scores. A tie counts as half a win in win percentage.</div><div><span>03</span>Regular-season standings exclude playoffs and unconfirmed phases. PF and PA are scored from both sides of every fixture.</div><div><span>04</span>All-time comparisons group only by explicit saved manager names. No team-name guessing or automatic name merging.</div><div><span>05</span>Computed ranks sort by win percentage, then points for. They are separate from playoff finishes and Yahoo seeding.</div><div><span>06</span>Moves and trades are saved participation counts. Trade details and league-wide distinct trade totals are unavailable.</div></div></section>`+
    (archive.issues.length?`<div class="notice"><strong>Validation issues</strong><ul>${archive.issues.map(i=>`<li>${escape(i.season)}: ${escape(i.message)}</li>`).join('')}</ul></div>`:'')+
    `<section class="source-card"><h2>Source snapshot</h2><p>Budzik league history · 2015–2026 · Updated November 10, 2026.<br>Compiled from the Yahoo final results you supplied. All 2017–2025 schedules were cross-checked against both teams. Source asterisks mean Rivalry Week. 2026 includes final results through Week ${currentWeek()}; remaining schedule and rosters are saved separately. Division titles use overall record and PF.</p><a href="./history.json" download="Budzik_League_History.json">Download source archive ↓</a><p><a href="./Budzik_League_History_2015-2025.xlsx" download>Download Excel workbook (2015–2025, before division titles) ↓</a></p></section>`;
}
function render() {
  const focus=document.activeElement?.id,position=document.activeElement?.selectionStart;
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===(state.view==='profile'?'managers':state.view);b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  document.getElementById('season-buttons').innerHTML=Object.keys(archive.seasons).map(y=>`<button class="season-button ${state.season===y?'active':''}" data-select-season="${y}"${state.season===y?' aria-current="true"':''}>${y}<small>${archive.seasons[y].status==='in_progress'?`Through Week ${currentWeek()}`:filterGames(archive,{season:y,phase:'unconfirmed'}).length?'Phase unconfirmed':'Regular complete'}</small></button>`).join('');
  content.innerHTML=({positions:slotView,trades:tradeView,simulator:simulatorView,scenarios:scenariosView,season:seasonView,matchups:matchupView,playoffs:playoffView,h2h:h2hView,records:recordsView,weeklyrecords:weeklyRecordsView,highlights:highlightsView,planner:plannerView,rivalries:rivalriesView,divisions:divisionsView,activity:activityView,predictions:predictionsView,power:powerView,managers:managerView,profile:profileView,archive:archiveView}[state.view])();
  document.title=`${state.view==='positions'?'Points by position':state.view==='trades'?'Trade analyzer':state.view==='simulator'?'Playoff simulator':state.view==='scenarios'?'Scenario generator':state.view==='profile'?state.profile:state.view==='h2h'?'Head to head':state.view==='power'?'Power rankings':state.view==='predictions'?'Playoff predictions':state.view==='activity'?'Moves & trades':state.view==='divisions'?'Division titles':state.view==='planner'?'2026 matchups':state.view==='rivalries'?'Rivalry leaderboard':state.view==='highlights'?'Game records':state.view==='weeklyrecords'?'Weekly season records':state.view==='records'?'All-time records':state.view==='managers'?'Managers':state.view==='archive'?'Archive notes':state.season} · Budzik Invitational`;
  if(focus==='alias-search'){const el=document.getElementById(focus);el?.focus();if(position!=null)el?.setSelectionRange(position,position);}
  else if(focus?.startsWith('filter-'))document.getElementById(focus)?.focus();
}
function exportCsv(mode) {
  const games=mode==='h2h'?headToHead(archive,state.a,state.b,{season:state.scope,phase:state.phase}).games:filterGames(archive,{season:state.season,phase:state.phase,week:state.week,manager:state.manager});
  const cell=x=>`"${String(x??'').replace(/"/g,'""')}"`;
  const rows=[['Season','Week','Phase','Manager A','Team A','Score A','Manager B','Team B','Score B','Result for A','Week inferred'],...games.map(g=>[g.season,g.week,g.phase,g.a.manager,g.a.team_name,g.a.score,g.b.manager,g.b.team_name,g.b.score,outcome(g.a.score,g.b.score),g.weekInferred])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`Budzik_${mode}_${mode==='h2h'?state.scope:state.season}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||!archive)return;
  if(b.dataset.view)update({view:b.dataset.view,week:'all',q:''});
  else if(b.dataset.selectSeason)update({season:b.dataset.selectSeason,view:['season','matchups','playoffs'].includes(state.view)?state.view:'season',week:'all',manager:'all'});
  else if(b.dataset.goto)update({view:b.dataset.goto,phase:b.dataset.phase||state.phase,week:'all',manager:'all'});
  else if(b.dataset.profile)update({view:'profile',profile:b.dataset.profile});
  else if(b.dataset.pairA)update({view:'h2h',a:b.dataset.pairA,b:b.dataset.pairB});
  else if(b.dataset.compare)update({view:'h2h',a:b.dataset.compare,b:archive.managers.find(n=>n!==b.dataset.compare),scope:'all',phase:'all'});
  else if(b.hasAttribute('data-swap'))update({a:state.b,b:state.a});
  else if(b.dataset.historySort){const key=b.dataset.historySort;update({historySort:key,historyDirection:state.historySort===key?(state.historyDirection==='asc'?'desc':'asc'):['pf','record','finalRecord'].includes(key)?'desc':'asc'},true);}
  else if(b.dataset.export)exportCsv(b.dataset.export);
  else if(b.id==='archive-button')update({view:'archive'});
});
document.addEventListener('change',e=>{if(e.target.dataset.multi){const key=e.target.dataset.multi,value=e.target.value;if(!['historyYears','historyRecord'].includes(key))return;const selected=new Set(state[key].split(',').filter(v=>v!=='all'));if(value==='all'){update({[key]:'all'});return;}if(e.target.checked)selected.add(value);else selected.delete(value);update({[key]:selected.size?[...selected].join(','):'all'});return;}if(e.target.dataset.planIndex!==undefined){const index=Number(e.target.dataset.planIndex),side=e.target.dataset.planSide;if(index>=0&&index<6&&['a','b'].includes(side)){const pairs=plannedPairs();pairs[index][side]=e.target.value;savePlan(pairs);render();}return;}if(!e.target.dataset.state)return;const key=e.target.dataset.state;const selected=e.target.multiple?[...e.target.selectedOptions].map(o=>o.value):null;const changes={[key]:selected?(selected.includes('all')||!selected.length?'all':selected.join(',')):e.target.value};if(key==='season')Object.assign(changes,{week:'all',manager:'all'});if(key==='a'&&e.target.value===state.b)changes.b=state.a;update(changes);});
document.addEventListener('input',e=>{if(e.target.id==='alias-search')update({q:e.target.value},true);});
window.addEventListener('hashchange',()=>{if(archive){readState();render();}});
try {
  archive=normalize(JSON.parse(document.getElementById('archive-data').textContent));readState();render();
} catch(error) {
  content.innerHTML='<div class="panel"><div class="empty"><strong>The archive could not be loaded.</strong>Refresh the page to try again. <a href="./history.json">Open the saved data</a>.</div></div>';
  console.error('League archive load failed:',error);
}

})();
