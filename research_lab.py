"""Exploratory player-level research; no predictive or causal claims."""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import streamlit as st
from data_access import read_data, manifest
from presentation import LABELS, friendly

TESTS=['forty','ten_yd_split','vertical','broad_jump','three_cone','short_shuttle','bench_reps','combine_height','combine_weight','arm_length','hand_size','wing_span']
NGS_SCORES=['ngs_athleticism_score','ngs_college_production_score','ngs_final_score']
TESTS=TESTS+NGS_SCORES
LOWER={'forty','ten_yd_split','three_cone','short_shuttle'}
OUTCOMES={
 'separation':('Average separation when thrown (yards)','separation_at_pass_forward','mean'),
 'yac':('Average yards after catch','yards_after_catch','mean'),
 'receiving':('Recorded receiving yards','rec_yards','sum'),
 'rushing':('Recorded rushing yards','rush_yards','sum'),
 'sacks':('Recorded sacks','sack','sum'),
 'getoff':('Average pass-rush get-off time (seconds)','player_get_off','mean'),
 'games':('Games with recorded plays',None,None),
 'plays':('Recorded player-play appearances',None,None),
}

def score_guide():
    with st.expander('Understanding the Next Gen Stats scores'):
        st.markdown('''- **Athleticism score:** supplied NGS summary of athletic testing. It can overlap with the individual tests used as model inputs.
- **College production score:** supplied NGS summary of college performance. Its full model is not disclosed in the supplied documentation.
- **Overall prospect score:** supplied NGS overall prospect assessment combining information including athleticism and college production. It can overlap with the component scores.

**Combine IQ is a dashboard, not another score.** A score of 80 is not an 80% chance of NFL success. Percentiles in this app are calculated within your selected prospect sample and are distinct from the original NGS scores.

Use the scores as existing benchmarks, then test whether additional measurements reduce held-out prediction error on the same players. Correlations between a composite score and its inputs are not independent evidence of NFL value. Avoid treating the overall score and its components as independent measurements. The supplied score snapshot's timing and model training cohorts have not been verified, so score-based retrospective comparisons remain exploratory.''')


def assemble(players,combine,plays,games):
    p=players.merge(combine.drop(columns='draft_year',errors='ignore'),on='nfl_id',how='left',validate='one_to_one')
    g=games[['game_id','season','season_type']].drop_duplicates('game_id')
    q=plays.merge(g,on='game_id',how='left',validate='many_to_one').merge(players[['nfl_id','draft_year']],on='nfl_id',validate='many_to_one')
    q=q[q.season.eq(q.draft_year)&q.season_type.eq('REG')].copy()
    # Do not count wiped-out plays in either outcome or observation denominator.
    if 'play_nullified_by_penalty' in q:q=q[q.play_nullified_by_penalty.eq('N')]
    summary=q.groupby('nfl_id').agg(plays=('play_id','size'),games=('game_id','nunique'))
    summary['plays_n']=summary.plays;summary['games_n']=summary.games
    for key,(_,col,method) in OUTCOMES.items():
        if col is None:continue
        valid=q[['nfl_id',col]].copy();valid[col]=pd.to_numeric(valid[col],errors='coerce')
        group=valid.groupby('nfl_id')[col]
        summary[key]=group.mean() if method=='mean' else group.sum(min_count=1)
        summary[key+'_n']=group.count()
    return p.merge(summary,on='nfl_id',how='left',validate='one_to_one')

@st.cache_data(max_entries=1)
def load():
    return assemble(*[read_data(n) for n in ['players.csv','combine_results.csv','player_play.csv','games.csv']])

def rank_correlations(data, minimum_players=20, minimum_observations=20):
    rows=[]
    for position,group in data.groupby('nfl_position'):
        for test in TESTS:
            for outcome in OUTCOMES:
                threshold=minimum_observations if outcome in {'separation','yac','getoff'} else 1
                eligible=group[group[outcome+'_n'].ge(threshold)&group[outcome].notna()]
                pairs=eligible.dropna(subset=[test,outcome])
                if len(pairs)<minimum_players or pairs[test].nunique()<2 or pairs[outcome].nunique()<2:
                    continue
                x=pairs[test].astype(float);y=pairs[outcome].astype(float)
                linear=float(x.corr(y));rank=float(x.rank().corr(y.rank()))
                if not np.isfinite(linear) or not np.isfinite(rank):continue
                rows.append({'position':position,'test':test,'outcome':outcome,'players':len(pairs),
                             'linear':linear,'rank':rank,'missing_tests':int(eligible[test].isna().sum()),
                             'threshold':threshold})
    return pd.DataFrame(rows)


def strongest_view(data):
    st.subheader('Strongest correlations')
    st.write('Rank the largest relationships within each position, then inspect the players behind each result.')
    a,b=st.columns(2)
    positions=a.multiselect('Positions to search',sorted(data.nfl_position.dropna().unique()),default=sorted(data.nfl_position.dropna().unique()))
    years=b.multiselect('Draft classes to search',sorted(data.draft_year.unique()),default=sorted(data.draft_year.unique()))
    a,b,c=st.columns(3)
    minimum=int(a.number_input('Minimum players per comparison',min_value=5,max_value=200,value=20))
    observations=int(b.number_input('Minimum observations for average outcomes',min_value=1,max_value=2000,value=20,help='Applies to separation, yards after catch, and get-off time. Totals and recorded playing-time counts require at least one observation.'))
    ordering=c.selectbox('Rank by',['Linear correlation','Rank correlation'])
    filtered=data[data.nfl_position.isin(positions)&data.draft_year.isin(years)]
    with st.spinner('Comparing measurements and rookie outcomes…'):
        scores=rank_correlations(filtered,minimum,observations)
    if scores.empty:
        st.info('No comparisons meet these filters. Select more positions or classes, or reduce the minimum sample size.');return
    key='linear' if ordering=='Linear correlation' else 'rank'
    scores=scores.assign(strength=scores[key].abs()).sort_values(['strength','players'],ascending=[False,False]).reset_index(drop=True)
    st.metric('Eligible comparisons searched',len(scores))
    st.caption('Sorted by absolute correlation: both negative and positive relationships can be strong. Every comparison is within one position. Click table headings to sort; select a relationship below to inspect it.')
    visible=pd.DataFrame({'Position':scores.position,'Combine measurement':scores.test.map(lambda n:LABELS.get(n,n)),
        'Rookie NFL outcome':scores.outcome.map(lambda n:OUTCOMES[n][0]),'Players':scores.players,
        'Linear correlation':scores.linear.round(3),'Rank correlation':scores['rank'].round(3),
        'Missing combine tests':scores.missing_tests})
    st.dataframe(visible,hide_index=True,use_container_width=True)
    st.warning('These rankings search many combinations and can highlight chance findings. They are not adjusted for multiple comparisons, validated predictions, or evidence of causation. Small samples and missing combine tests can change the rankings.')
    selected=st.selectbox('Inspect a relationship',list(scores.index),format_func=lambda i:f"{scores.loc[i,'position']} · {LABELS.get(scores.loc[i,'test'],scores.loc[i,'test'])} → {OUTCOMES[scores.loc[i,'outcome']][0]}")
    row=scores.loc[selected];test=row['test'];outcome=row['outcome']
    group=filtered[filtered.nfl_position.eq(row.position)]
    pairs=group[group[outcome+'_n'].ge(row.threshold)].dropna(subset=[test,outcome])
    c1,c2,c3=st.columns(3);c1.metric('Players',len(pairs));c2.metric('Linear correlation',f'{row.linear:+.3f}');c3.metric('Rank correlation',f'{row["rank"]:+.3f}')
    direction='higher' if row.linear>0 else 'lower'
    st.write(f'Higher values of {LABELS.get(test,test).lower()} are associated with {direction} values of {OUTCOMES[outcome][0].lower()} in this sample.')
    st.caption('For timed drills and get-off time, a lower value means faster. A relationship with size is not automatically a relationship with better performance.')
    fig,ax=plt.subplots(figsize=(10,5));ax.scatter(pairs[test].astype(float),pairs[outcome].astype(float),color='#147d92',alpha=.75)
    ax.set(xlabel=LABELS.get(test,test),ylabel=OUTCOMES[outcome][0]);ax.spines[['top','right']].set_visible(False);fig.tight_layout();st.pyplot(fig);plt.close(fig)
    details=pairs[['display_name','draft_year',test,outcome,outcome+'_n']].rename(columns={outcome:OUTCOMES[outcome][0],outcome+'_n':'Recorded observations'})
    st.dataframe(friendly(details).round(2),hide_index=True,use_container_width=True)
    st.caption('Each dot is one player with equal weight. Rookie regular season only; nullified plays excluded. Missing outcomes stay unknown. Recorded appearances and yardage totals measure opportunity as well as performance. Non-missing observation counts do not automatically identify routes, catches, or pass-rush attempts. Confirm field applicability for each position.')


def show():
    st.title('Research Lab')
    st.write('Compare athletic profiles and explore how combine testing relates to rookie NFL performance.')
    score_guide()
    with st.expander('Start here: linear and rank correlations explained'):
        st.markdown('''**Linear correlation** asks whether two measurements follow a straight-line pattern. It uses the actual numeric gaps, so extreme players can have a large effect.

**Rank correlation** asks whether the ordering of players is consistent. It correlates their ranks, giving less influence to the size of extreme values. It can capture a steadily increasing or decreasing pattern that is not a straight line.

Both range from **−1 to +1**. Near +1 means larger values tend to go with larger values; near −1 means larger values tend to go with smaller values. Near zero means little relationship of that type, but does not rule out all patterns.

**Negative is not necessarily bad.** Higher jumps associated with lower get-off times produce a negative correlation: lower time means faster movement. A positive relationship between two timed tests can also mean faster players perform faster on both.

A correlation of −0.71 does **not** mean a 71% success rate or 71% of NFL success explained. Similar linear and rank values lend consistency to an exploratory pattern; different values are a reason to inspect outliers or curvature.

**What to do next:** check the chart, sample size, missing measurements and position-specific context. Search rankings are not corrected for trying many combinations. Keep exploratory findings separate from a hypothesis tested on held-out players. Rookie correlations use regular-season rookie performance; visit **NFL Success** for subsequent seasons and career context.''')

    needed={'players.csv','combine_results.csv','player_play.csv','games.csv'}
    if not needed.issubset(manifest()):
        st.info('Player information, combine results, game schedule, and play performance are required. Check Data coverage.');return
    with st.spinner('Preparing rookie-season comparisons…'):data=load()
    mode=st.radio('Research tool',['Strongest correlations','Player comparison','Percentiles vs. draft pick','Combine vs. performance','Similar prospects'],horizontal=True)
    if mode=='Strongest correlations':
        strongest_view(data)
        return
    a,b=st.columns(2)
    pos=a.selectbox('Position',sorted(data.nfl_position.dropna().unique()),index=list(sorted(data.nfl_position.dropna().unique())).index('WR'))
    years=b.multiselect('Draft classes',sorted(data.draft_year.unique()),default=sorted(data.draft_year.unique()))
    pool=data[data.nfl_position.eq(pos)&data.draft_year.isin(years)].copy()
    if pool.empty:st.info('Select at least one draft class.');return
    st.caption(f'{len(pool)} prospects · Same-position comparisons · Regular-season rookie year only')
    st.info('Exploratory research: relationships do not prove causation or predictive value. Players without recorded rookie plays have unknown outcomes here, not zero performance. Missing combine tests are not imputed.')
    names=pool.set_index('nfl_id').display_name.to_dict();ids=sorted(names,key=lambda n:names[n])
    if mode=='Player comparison':
        all_players=st.checkbox('Select all players',key='research_all_players')
        selected=ids if all_players else st.multiselect('Compare players',ids,default=ids[:min(3,len(ids))],format_func=lambda n:names[n])
        all_measurements=st.checkbox('Select all measurements',key='research_all_measurements')
        measurements=TESTS if all_measurements else st.multiselect('Measurements',TESTS,default=['forty','ten_yd_split','vertical','broad_jump'],format_func=lambda n:LABELS.get(n,n))
        st.caption(f'{len(selected)} players selected in the current position and draft-class filters.')
        if not selected or not measurements:return
        st.dataframe(friendly(pool[pool.nfl_id.isin(selected)][['display_name','draft_year','draft_round','draft_overall_pick']+measurements]).round(2),hide_index=True,use_container_width=True)
        rows=[]
        for metric in measurements:
            ranks=pool[metric].rank(pct=True,ascending=metric not in LOWER)*100
            for idx,row in pool[pool.nfl_id.isin(selected)].iterrows():
                rows.append({'Player':row.display_name,'Draft year':int(row.draft_year),'Draft round':'Undrafted' if pd.isna(row.draft_round) else int(row.draft_round),'Overall pick':'Undrafted' if pd.isna(row.draft_overall_pick) else int(row.draft_overall_pick),'Measurement':LABELS.get(metric,metric),'Position percentile':ranks.loc[idx],'Players tested':int(pool[metric].notna().sum())})
        st.subheader('Position percentiles')
        st.dataframe(pd.DataFrame(rows).round(1),hide_index=True,use_container_width=True)
        st.caption('Percentiles use recorded tests in the selected position and classes. Higher means a larger measurement; for timed drills, higher means faster. Size percentiles do not imply better performance. Ties use average ranks.')
    elif mode=='Percentiles vs. draft pick':
        st.subheader('Percentiles and draft investment')
        basis=st.radio('Percentile source',['Combine measurements and NGS scores','Rookie NFL performance'],horizontal=True)
        if basis=='Combine measurements and NGS scores':
            metric=st.selectbox('Measurement to rank',TESTS,format_func=lambda n:LABELS.get(n,n))
            label=LABELS.get(metric,metric);low=metric in LOWER;reference=pool.copy()
        else:
            metric=st.selectbox('Performance to rank',list(OUTCOMES),format_func=lambda n:OUTCOMES[n][0])
            minimum=st.number_input('Minimum recorded observations',min_value=1,max_value=2000,value=20 if metric in {'separation','yac','getoff'} else 1)
            label=OUTCOMES[metric][0];low=metric=='getoff'
            reference=pool[pool[metric+'_n'].ge(minimum)].copy()
        reference['Position percentile']=reference[metric].rank(pct=True,ascending=not low)*100
        all_selected=st.checkbox('Select all players',value=True,key='draft_all_players')
        chosen=ids if all_selected else st.multiselect('Players to display',ids,format_func=lambda n:names[n])
        display=pool[pool.nfl_id.isin(chosen)].copy()
        rank_lookup=reference.set_index('nfl_id')['Position percentile']
        display['Position percentile']=display.nfl_id.map(rank_lookup)
        c1,c2,c3=st.columns(3);c1.metric('Players with percentile',int(display['Position percentile'].notna().sum()));c2.metric('Players in reference group',int(reference[metric].notna().sum()));c3.metric('Undrafted players selected',int(display.draft_overall_pick.isna().sum()))
        points=display.dropna(subset=['Position percentile','draft_overall_pick'])
        if not points.empty:
            fig,ax=plt.subplots(figsize=(10,5));ax.scatter(points.draft_overall_pick,points['Position percentile'],color='#147d92',alpha=.75)
            ax.set(xlabel='Overall draft pick (smaller number = earlier selection)',ylabel=f'Position percentile: {label}',ylim=(0,102))
            ax.spines[['top','right']].set_visible(False);fig.tight_layout();st.pyplot(fig);plt.close(fig)
        else:st.info('Select drafted players with a recorded percentile to display the chart.')
        st.caption('Upper right: high percentile with a later draft selection. Lower left: lower percentile with an earlier selection. These are research leads, not proof of draft value. Undrafted players appear in the table but have no pick number on the chart.')
        cols=['display_name','draft_year','draft_round','draft_overall_pick',metric,'Position percentile']
        if basis=='Rookie NFL performance':cols.append(metric+'_n')
        view=display[cols].copy()
        for col in ['draft_round','draft_overall_pick']:
            view[col]=view[col].map(lambda x:'Undrafted' if pd.isna(x) else str(int(x)))
        view=view.rename(columns={metric:label,metric+'_n':'Recorded observations'})
        st.dataframe(friendly(view).round(1),hide_index=True,use_container_width=True)
        st.caption('Percentiles use the full selected position and draft-class group, not just the displayed players. Missing tests and insufficient NFL observations have no percentile. Ties receive average ranks. Higher percentile means faster timed testing or a larger other measurement; for NFL get-off time, faster ranks higher. Size and separation percentiles are descriptive, not overall talent grades. Reference groups include only supplied prospects, not the entire historical NFL.')
        st.caption('Draft pick is shown as its actual overall number, not a draft percentile: draft class sizes differ and the supplied prospect sample is incomplete. Rookie yardage and participation percentiles reflect opportunity as well as performance.')
    elif mode=='Combine vs. performance':
        col1,col2=st.columns(2)
        metric=col1.selectbox('Combine measurement',TESTS,format_func=lambda n:LABELS.get(n,n))
        outcome=col2.selectbox('Rookie outcome',list(OUTCOMES),format_func=lambda n:OUTCOMES[n][0])
        minimum=st.number_input('Minimum recorded observations for the selected outcome',min_value=1,max_value=2000,value=20 if outcome in {'separation','yac','getoff'} else 1)
        eligible=pool[pool[outcome+'_n'].ge(minimum)&pool[outcome].notna()]
        pairs=eligible.dropna(subset=[metric,outcome])
        c1,c2,c3=st.columns(3);c1.metric('Players compared',len(pairs));c2.metric('Missing selected combine test',int(eligible[metric].isna().sum()));c3.metric('Insufficient / missing NFL outcome',len(pool)-len(eligible))
        if len(pairs)<5 or pairs[metric].nunique()<2 or pairs[outcome].nunique()<2:
            st.warning('Not enough variation or at least five complete player records for this comparison. Try another measurement or outcome.');return
        pearson=pairs[metric].corr(pairs[outcome]);spearman=pairs[metric].rank().corr(pairs[outcome].rank())
        c1,c2=st.columns(2);c1.metric('Linear correlation',f'{pearson:+.2f}');c2.metric('Rank correlation',f'{spearman:+.2f}')
        fig,ax=plt.subplots(figsize=(10,5));ax.scatter(pairs[metric],pairs[outcome],color='#147d92',alpha=.75)
        ax.set(xlabel=LABELS.get(metric,metric),ylabel=OUTCOMES[outcome][0]);ax.spines[['top','right']].set_visible(False);fig.tight_layout();st.pyplot(fig);plt.close(fig)
        view=pairs[['display_name','draft_year',metric,outcome,outcome+'_n']].rename(columns={outcome:OUTCOMES[outcome][0],outcome+'_n':'Recorded observations'})
        st.dataframe(friendly(view).round(2),hide_index=True,use_container_width=True)
        st.caption('Each dot is one player; each player receives equal weight. Correlations range from −1 to +1. Timed tests run in the opposite direction: a smaller number is faster. Repeatedly trying combinations can reveal chance patterns; validate a chosen hypothesis on held-out players before claiming prediction.')
        st.caption('Recorded appearances and yardage totals reflect both opportunity and performance. Observation counts are non-missing records for the selected outcome, not automatically route, catch, or pass-rush counts. Confirm field applicability before interpreting another position.')
    else:
        player=st.selectbox('Find comparisons for',ids,format_func=lambda n:names[n])
        metrics=st.multiselect('Compare these measurements',TESTS,default=['forty','vertical','broad_jump','combine_height','combine_weight'],format_func=lambda n:LABELS.get(n,n))
        if not metrics:return
        target=pool[pool.nfl_id.eq(player)].iloc[0]
        missing=[m for m in metrics if pd.isna(target[m])]
        if missing:st.warning('Selected player is missing: '+', '.join(LABELS.get(m,m) for m in missing)+'. Remove those measurements to continue.');return
        candidates=pool.dropna(subset=metrics).copy()
        spread=pool[metrics].std(ddof=0);usable=[m for m in metrics if pd.notna(spread[m]) and spread[m]>0]
        if not usable:st.info('These measurements have no usable variation.');return
        if len(usable)<len(metrics):st.caption('Measurements without variation were excluded.')
        # A mixed-type player row is an object Series even after selecting
        # numeric fields. Convert explicitly before NumPy arithmetic.
        candidate_values=candidates[usable].apply(pd.to_numeric,errors='raise').to_numpy(dtype=float)
        target_values=pd.to_numeric(target[usable],errors='raise').to_numpy(dtype=float)
        scales=spread[usable].to_numpy(dtype=float)
        candidates['Profile distance']=np.sqrt(np.mean(((candidate_values-target_values)/scales)**2,axis=1))
        nearest=candidates[candidates.nfl_id.ne(player)].nsmallest(10,'Profile distance')
        if nearest.empty:st.info('No other players have all selected measurements.');return
        outcome=st.selectbox('Show rookie outcome',list(OUTCOMES),format_func=lambda n:OUTCOMES[n][0])
        view=nearest[['display_name','draft_year','Profile distance']+usable+[outcome,outcome+'_n']].rename(columns={outcome:OUTCOMES[outcome][0],outcome+'_n':'Recorded observations'})
        st.dataframe(friendly(view).round(2),hide_index=True,use_container_width=True)
        st.caption(f'{len(candidates)-1} complete comparison candidates. Smaller distance means a more similar profile. Distances average squared differences after scaling each measurement by its position-group standard deviation. These are athletic comparisons, not NFL projections; no success label is used to select neighbors.')
    with st.expander('Research design and limits'):
        st.write('Rookie year is defined by game season matching draft year; playoffs and nullified plays are excluded. A player without recorded plays remains missing. No career totals are used as the rookie outcome. The sample includes only supplied 2023–2025 prospects. Injuries, team role, coaching, quarterback play, and selection into combine drills can affect results. No causal model or held-out validation has been run in this view. Combine movement features will be added after their measurement is validated.')
