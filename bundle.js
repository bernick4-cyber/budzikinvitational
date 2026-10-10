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

const views = ['season','matchups','playoffs','h2h','records','highlights','planner','rivalries','divisions','activity','predictions','managers','profile','archive'];
const defaultState = {view:'season',season:'2015',scope:'all',phase:'all',week:'all',manager:'all',a:'Josh',b:'Taylor',profile:'Josh',q:'',sort:'wins',category:'high_team',plannerWeek:'1',minimum:'3',order:'best',forecastWeek:'5',startRecord:'0–4–0'};

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
  if(!/^(5|6|7|8|9|10|11|12|13|14)$/.test(state.forecastWeek))state.forecastWeek='5';
  if(!/^([0-4])–([0-4])–([0-4])$/.test(state.startRecord))state.startRecord='0–4–0';
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
 years.map(y=>{const groups=divisionStandings(archive,y).filter(d=>d.teams.some(t=>[t.manager,t.team_name].some(n=>n.toLocaleLowerCase().includes(q))));if(!groups.length)return '';return `<section class="panel"><div class="panel-heading"><div><h2>${y} divisions</h2><p>${archive.seasons[y].status==='in_progress'?'Current leaders through Week 4 · No division titles awarded':'Final regular-season division winners'}</p></div></div><div class="table-wrap"><table><thead><tr><th>Division</th><th>Manager / team</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">PF</th><th>Status</th></tr></thead><tbody>${groups.flatMap(d=>d.teams.map(t=>`<tr><td>${escape(d.division)}</td><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td class="num">${record(t)}</td><td class="num">${pct(t.pct)}</td><td class="num">${number(t.pf)}</td><td>${t.manager===d.winner?`<span class="badge">${d.titleConfirmed?'Division winner':'Current leader'}</span>`:'—'}</td></tr>`)).join('')}</tbody></table></div></section>`;}).join('');
}
function scatter(rows,key) {
 const usable=rows.filter(r=>Number.isFinite(r[key])),max=Math.max(1,...usable.map(r=>r[key]));
 return `<svg class="activity-chart" viewBox="0 0 600 270" role="img" aria-label="${key} versus regular-season win percentage"><line x1="55" y1="225" x2="575" y2="225" stroke="#64736e"/><line x1="55" y1="25" x2="55" y2="225" stroke="#64736e"/>${[0,.5,1].map(v=>`<text x="45" y="${230-200*v}" text-anchor="end">${v*100}%</text><line x1="55" y1="${225-200*v}" x2="575" y2="${225-200*v}" stroke="#e1e6dc"/>`).join('')}${usable.map(r=>`<circle cx="${55+r[key]/max*510}" cy="${225-r.pct*200}" r="4" fill="#285e47" opacity=".65"><title>${escape(r.manager)} · ${r.season}: ${r[key]} ${key}, ${pct(r.pct)} wins</title></circle>`).join('')}<text x="55" y="246">0</text><text x="565" y="246" text-anchor="end">${max}</text><text x="310" y="266" text-anchor="middle">${escape(key)} per season</text></svg>`;
}
function activityView() {
 const rows=activityRows(archive,state.scope,state.q),cor=(key,target)=>pearson(rows.filter(r=>Number.isFinite(r[key])).map(r=>[r[key],r[target]])),fmt=n=>n==null?'Not enough variation':n.toFixed(3);
 return heading('ACTIVITY & RESULTS','Does more activity mean more wins?','Compare moves and trade participation with regular-season results. Completed seasons only.',false)+
 `<div class="filters">${select('Completed seasons','scope',[['all','All completed seasons'],...seasonOptions().filter(([y])=>archive.seasons[y].status!=='in_progress')])}<label class="grow">Search manager or team<input id="alias-search" type="search" value="${escape(state.q)}" placeholder="Compare a manager’s seasons…" maxlength="100"></label></div>`+
 `<div class="notice">Pearson r ranges from −1 to +1: negative means more activity is associated with fewer wins; positive means more activity is associated with more wins. Correlation does not establish cause. Each dot is a manager-season. All-seasons results pool different league sizes and season lengths; use the season filter for within-year comparisons. 2026 is excluded because four weeks of activity cannot be compared with completed seasons. Trades count manager participation, not distinct league transactions. Missing activity values are omitted.</div>`+
 `<section class="metrics">${metric('Moves vs win %',fmt(cor('moves','pct')),`${rows.filter(r=>Number.isFinite(r.moves)).length} manager-seasons`)}${metric('Trades vs win %',fmt(cor('trades','pct')),`${rows.filter(r=>Number.isFinite(r.trades)).length} manager-seasons`)}${metric('Moves vs wins',fmt(cor('moves','wins')),'Regular-season wins')}${metric('Trades vs wins',fmt(cor('trades','wins')),'Regular-season wins')}</section>`+
 `<div class="planner-grid"><section class="panel"><div class="panel-heading"><h2>Moves vs win percentage</h2></div>${scatter(rows,'moves')}</section><section class="panel"><div class="panel-heading"><h2>Trades vs win percentage</h2></div>${scatter(rows,'trades')}</section></div>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Season activity and results</h2><p>${rows.length} completed manager-seasons</p></div></div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Manager / team</th><th class="num">W–L–T</th><th class="num">Win %</th><th class="num">Moves</th><th class="num">Trades</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team_name)}</small></td><td class="num">${record(r)}</td><td class="num">${pct(r.pct)}</td><td class="num">${r.moves??'—'}</td><td class="num">${r.trades??'—'}</td></tr>`).join('')}</tbody></table></div>${!rows.length?'<div class="empty"><strong>No completed seasons match</strong>Try another season or search.</div>':''}</section>`;
}
function predictionsView() {
 const s=archive.seasons['2026'],rows=standings(archive,'2026'),byId=new Map(s.teams.map(t=>[String(t.team_id),t])),groups=divisionStandings(archive,'2026'),leaders=rows.filter(t=>groups.some(d=>d.winner===t.manager)),wild=rows.filter(t=>!leaders.some(l=>l.manager===t.manager)).slice(0,3),qualified=[...leaders,...wild];
 const estimate=playoffEstimate||(playoffEstimate=simulatePlayoffs(archive)),history=historicalStarts(archive),baseline=startingRecordRate(history,state.startRecord);
 const chance=n=>n<.001?'Less than 0.1%':n>.999?'Over 99.9%':pct(n);
 const schedule=s.remaining_schedule.filter(g=>g.week===Number(state.forecastWeek));
 return heading('THE PLAYOFF PICTURE','2026: the road ahead.','Results through Week 4, the remaining fantasy schedule, and your saved roster snapshots.',false)+
 `<div class="notice"><strong>PF-based playoff estimates are live.</strong> We simulate ${number(estimate.iterations)} finishes using each team’s average PF through Week 4 and the supplied Weeks 5–14 schedule. Weekly scoring variation comes from 2021–2025 regular-season scores (pooled within-team standard deviation: ${number(estimate.sd)} points). Each simulated season also varies team scoring strength by ${number(estimate.sd/2)} points of standard deviation to reflect having only four games of evidence. The model assumes scoring strength stays constant, scores vary independently week to week, and uses your division / wild-card / bye rules. These are estimates, not guarantees; injuries, future roster changes, NFL byes, and player projections are not modeled.</div>`+
 `<section class="metrics">${metric('Final results',24,'Weeks 1–4 only')}${metric('Remaining matchups',s.remaining_schedule.length,'Weeks 5–14')}${metric('Playoff spots',6,'3 division winners + 3 wild cards')}${metric('First-round byes',2,'Top two division winners')}</section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>Estimated playoff chances</h2><p>PF scoring model and historical starting-record rates are shown separately. The observed rate is a reference, not a second probability blended into the simulation.</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th class="num">Current record</th><th class="num">Avg PF</th><th class="num">Projected wins</th><th class="num">Make playoffs</th><th class="num">Win division</th><th class="num">Earn bye</th><th>Past teams with this start</th></tr></thead><tbody>${[...estimate.rows].sort((a,b)=>b.playoffChance-a.playoffChance).map(t=>{const past=startingRecordRate(history,record(t));return `<tr><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td class="num">${record(t)}</td><td class="num">${number(t.avg)}</td><td class="num">${t.projectedWins.toFixed(1)}</td><td class="num record">${chance(t.playoffChance)}</td><td class="num">${chance(t.divisionChance)}</td><td class="num">${chance(t.byeChance)}</td><td>${pct(past.rate)}<small class="record-owner">${past.made} of ${past.games} qualified</small></td></tr>`;}).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>What happened after that start?</h2><p>2017–2025 · 12 teams and six playoff qualifiers · Records after four games · ${history.length} manager-seasons. Earlier four-team playoff formats are excluded.</p></div></div><div class="filters">${select('Starting record after Week 4','startRecord',[...new Set(history.map(r=>r.record))].sort().map(r=>[r,r]))}</div><div class="notice"><strong>${baseline.made} of ${baseline.games} teams starting ${escape(state.startRecord)} made the playoffs (${pct(baseline.rate)}).</strong> Small samples are noisy. An observed 0% does not mean a current team has no chance. Qualification is identified from the saved championship brackets.</div><div class="table-wrap"><table><thead><tr><th>Season</th><th>Manager / team</th><th>Start</th><th>Made playoffs?</th></tr></thead><tbody>${baseline.samples.map(r=>`<tr><td>${r.season}</td><td class="team-cell">${managerLink(r.manager)}<small>${escape(r.team)}</small></td><td>${escape(r.record)}</td><td>${r.qualified?'Yes':'No'}</td></tr>`).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>If the season ended today</h2><p>Division winners qualify automatically. Other spots use overall win percentage, then points for.</p></div></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th>Division</th><th class="num">Record</th><th class="num">PF</th><th>Current position</th><th>PF-based playoff chance</th></tr></thead><tbody>${rows.map(t=>`<tr><td class="team-cell">${managerLink(t.manager)}<small>${escape(t.team_name)}</small></td><td>${escape(t.division)}</td><td class="num">${record(t)}</td><td class="num">${number(t.pf)}</td><td>${leaders.slice(0,2).some(l=>l.manager===t.manager)?'Division leader · Bye':leaders.some(l=>l.manager===t.manager)?'Division leader':qualified.some(l=>l.manager===t.manager)?'Wild card':'Outside current field'}</td><td>${chance(estimate.rows.find(r=>r.manager===t.manager).playoffChance)}</td></tr>`).join('')}</tbody></table></div></section>`+
 `<div class="filters">${select('Remaining schedule week','forecastWeek',Array.from({length:10},(_,i)=>[String(i+5),`Week ${i+5}`]))}</div><section class="panel"><div class="panel-heading"><h2>Week ${state.forecastWeek} matchups</h2></div><div class="table-wrap"><table><thead><tr><th>Manager / team</th><th>Opponent / team</th><th>Week type</th></tr></thead><tbody>${schedule.map(g=>{const a=byId.get(String(g.team_id)),b=byId.get(String(g.opponent_id));return `<tr><td class="team-cell">${managerLink(a.manager)}<small>${escape(a.team_name)}</small></td><td class="team-cell">${managerLink(b.manager)}<small>${escape(b.team_name)}</small></td><td>${g.rivalry_week?'Rivalry Week':'Regular week'}</td></tr>`;}).join('')}</tbody></table></div></section>`+
 `<section class="panel"><div class="panel-heading"><div><h2>All 12 roster snapshots</h2><p>Supplied October 10, 2026 · Injury labels are from the supplied snapshot, not live updates. Starter placement is ignored for the future best-projected-lineup model.</p></div></div><div class="roster-list">${s.teams.map(t=>`<details><summary>${escape(t.manager)} · ${escape(t.team_name)} <span>${s.rosters[t.manager].length} players / defenses</span></summary><ul>${s.rosters[t.manager].map(n=>`<li>${escape(n)}</li>`).join('')}</ul></details>`).join('')}</div></section>`;
}
function plannerView() {
 const pairs=plannedPairs(),errors=validateWeeklyPairs(pairs),latest=Object.keys(archive.seasons).at(-1);
 const current=archive.seasons[latest].teams.map(t=>t.manager).sort();
 const choices=[['','Choose a manager'],...current.map(n=>[n,`${n} · ${archive.aliases.get(n).at(-1).team_name}`]),...archive.managers.filter(n=>!current.includes(n)).map(n=>[n,`${n} · Past manager`])];
 return heading('THIS WEEK’S RIVALRIES','2026 matchup planner.','Enter this week’s opponents to see how each rivalry has played out across the archive.',false)+
 `<div class="filters">${select('Week','plannerWeek',Array.from({length:18},(_,i)=>[String(i+1),`Week ${i+1}`]))}${select('Historical seasons','scope',[['all','All seasons'],...seasonOptions()])}${select('Historical game phase','phase',Object.entries(PHASE_LABELS))}</div>`+
 `<div class="notice">${planStorageAvailable?'Matchup selections save automatically in this browser.':'Matchup selections are kept for this visit; browser storage is unavailable.'} Each week has its own matchups. Historical records include final results through 2026 Week 4; entering opponents does not add a scored game. Manager choices show their latest known team names.</div>`+
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
    `<div class="notice">All recorded games includes final results through 2026 Week 4. Current division leaders are not counted as titles. Moves include the supplied 2026 partial totals; 2026 trade counts are not supplied. Championships count saved finals in the selected seasons regardless of the game-phase filter. Win percentage gives ties half credit.</div>`+
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
    `<section class="source-card"><h2>Source snapshot</h2><p>Budzik league history · 2015–2026 · Updated October 10, 2026.<br>Compiled from the Yahoo final results you supplied. All 2017–2025 schedules were cross-checked against both teams. Source asterisks mean Rivalry Week. 2026 includes final results through Week 4; remaining schedule and rosters are saved separately. Division titles use overall record and PF.</p><a href="./history.json" download="Budzik_League_History.json">Download source archive ↓</a><p><a href="./Budzik_League_History_2015-2025.xlsx" download>Download Excel workbook (2015–2025, before division titles) ↓</a></p></section>`;
}
function render() {
  const focus=document.activeElement?.id,position=document.activeElement?.selectionStart;
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===(state.view==='profile'?'managers':state.view);b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  document.getElementById('season-buttons').innerHTML=Object.keys(archive.seasons).map(y=>`<button class="season-button ${state.season===y?'active':''}" data-select-season="${y}"${state.season===y?' aria-current="true"':''}>${y}<small>${archive.seasons[y].status==='in_progress'?'Through Week 4':filterGames(archive,{season:y,phase:'unconfirmed'}).length?'Phase unconfirmed':'Regular complete'}</small></button>`).join('');
  content.innerHTML=({season:seasonView,matchups:matchupView,playoffs:playoffView,h2h:h2hView,records:recordsView,highlights:highlightsView,planner:plannerView,rivalries:rivalriesView,divisions:divisionsView,activity:activityView,predictions:predictionsView,managers:managerView,profile:profileView,archive:archiveView}[state.view])();
  document.title=`${state.view==='profile'?state.profile:state.view==='h2h'?'Head to head':state.view==='predictions'?'Playoff predictions':state.view==='activity'?'Moves & trades':state.view==='divisions'?'Division titles':state.view==='planner'?'2026 matchups':state.view==='rivalries'?'Rivalry leaderboard':state.view==='highlights'?'Game records':state.view==='records'?'All-time records':state.view==='managers'?'Managers':state.view==='archive'?'Archive notes':state.season} · Budzik Invitational`;
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
  else if(b.dataset.export)exportCsv(b.dataset.export);
  else if(b.id==='archive-button')update({view:'archive'});
});
document.addEventListener('change',e=>{if(e.target.dataset.planIndex!==undefined){const index=Number(e.target.dataset.planIndex),side=e.target.dataset.planSide;if(index>=0&&index<6&&['a','b'].includes(side)){const pairs=plannedPairs();pairs[index][side]=e.target.value;savePlan(pairs);render();}return;}if(!e.target.dataset.state)return;const key=e.target.dataset.state;const changes={[key]:e.target.value};if(key==='season')Object.assign(changes,{week:'all',manager:'all'});if(key==='a'&&e.target.value===state.b)changes.b=state.a;update(changes);});
document.addEventListener('input',e=>{if(e.target.id==='alias-search')update({q:e.target.value},true);});
window.addEventListener('hashchange',()=>{if(archive){readState();render();}});
try {
  archive=normalize(JSON.parse(document.getElementById('archive-data').textContent));readState();render();
} catch(error) {
  content.innerHTML='<div class="panel"><div class="empty"><strong>The archive could not be loaded.</strong>Refresh the page to try again. <a href="./history.json">Open the saved data</a>.</div></div>';
  console.error('League archive load failed:',error);
}

})();
