"""Descriptive school/conference comparisons and exploratory baseline residuals."""
import numpy as np
import pandas as pd
import streamlit as st
from research_lab import load, OUTCOMES, NGS_SCORES, TESTS, score_guide
from model_lab import evaluate
from presentation import LABELS, friendly


def group_summary(pool,eligible,group,outcome):
    counts=pool.groupby(group).size().rename('Prospects in sample')
    stats=eligible.groupby(group).agg(**{
        'Players with NFL outcome':(outcome,'count'),
        'Average rookie outcome':(outcome,'mean'),
        'Median rookie outcome':(outcome,'median'),
        'Outcome standard deviation':(outcome,'std'),
        'Average athleticism score':('ngs_athleticism_score','mean'),
        'Average college production score':('ngs_college_production_score','mean'),
        'Average overall prospect score':('ngs_final_score','mean'),
        'Players with athleticism score':('ngs_athleticism_score','count'),
        'Players with college production score':('ngs_college_production_score','count'),
        'Players with overall prospect score':('ngs_final_score','count'),
        'Average overall pick (drafted only)':('draft_overall_pick','mean')})
    return counts.to_frame().join(stats).reset_index()


def adjusted_results(data,outcome,variables):
    complete=data.dropna(subset=variables+[outcome]).copy()
    if len(complete)<max(8,len(variables)+4):
        raise ValueError('Not enough complete players for the selected baseline. Reduce variables or broaden draft classes.')
    predictions,mae,rmse=evaluate(complete,outcome,variables)
    complete['Baseline prediction']=predictions
    sign=-1 if outcome=='getoff' else 1
    complete['Outcome above baseline']=(complete[outcome]-predictions)*sign
    return complete,mae,rmse


def show():
    st.title('College pathways')
    st.write('Compare sampled prospects from different schools and conferences, including how their rookie outcomes relate to NGS evaluations.')
    with st.spinner('Preparing school comparisons…'):data=load()
    score_guide()
    a,b,c=st.columns(3)
    positions=sorted(data.nfl_position.dropna().unique())
    position=a.selectbox('Position',positions,index=positions.index('WR') if 'WR' in positions else 0)
    years=b.multiselect('Draft classes',sorted(data.draft_year.unique()),default=sorted(data.draft_year.unique()))
    grouping=c.selectbox('Compare by',['School','Conference'])
    group='college_name' if grouping=='School' else 'college_conference'
    pool=data[data.nfl_position.eq(position)&data.draft_year.isin(years)].copy()
    missing_group=int(pool[group].isna().sum());pool=pool[pool[group].notna()]
    if pool.empty:st.info('Choose draft classes with available players.');return
    a,b,c=st.columns(3)
    outcome=a.selectbox('Rookie NFL outcome',list(OUTCOMES),format_func=lambda n:OUTCOMES[n][0])
    observations=int(b.number_input('Minimum outcome observations per player',min_value=1,max_value=2000,value=20 if outcome in {'separation','yac','getoff'} else 1))
    minimum=int(c.number_input('Minimum players per school / conference',min_value=1,max_value=100,value=3))
    eligible=pool[pool[outcome+'_n'].ge(observations)&pool[outcome].notna()].copy()
    label=OUTCOMES[outcome][0]
    st.caption(f'{len(pool)} prospects · {len(eligible)} with eligible NFL outcomes · {len(pool)-len(eligible)} missing or below the observation minimum · {missing_group} excluded for missing school/conference')
    st.warning('This sample contains selected prospects from 2023–2025, not every player a school produced. Differences can reflect recruiting, role, injuries, NFL opportunity, and selection into this dataset. They do not prove that a school develops better players.')
    raw,adjusted=st.tabs(['School outcomes and NGS scores','Outcomes versus NGS expectations'])
    with raw:
        summary=group_summary(pool,eligible,group,outcome)
        summary=summary[summary['Players with NFL outcome'].ge(minimum)]
        if summary.empty:st.info('No groups meet the player minimum. Try conference comparisons or a lower minimum, with extra caution for small groups.')
        else:
            summary=summary.sort_values('Average rookie outcome',ascending=outcome=='getoff')
            all_groups=st.checkbox('Select all schools / conferences',value=True,key='schools_raw_all')
            chosen=summary[group].tolist() if all_groups else st.multiselect('Schools / conferences to display',summary[group].tolist())
            visible=summary[summary[group].isin(chosen)].rename(columns={group:grouping})
            st.markdown('#### '+label)
            st.dataframe(visible.round(2),hide_index=True,use_container_width=True)
            if not visible.empty:st.bar_chart(visible.set_index(grouping)[['Average rookie outcome']])
            st.caption('Each player has equal weight. NGS averages use the players with eligible NFL outcomes, with score-specific counts shown. Average pick excludes undrafted players. Lower get-off time is faster; higher separation is not a complete talent grade. Missing NFL outcomes are excluded, not treated as zero.')
            chosen_players=eligible[eligible[group].isin(chosen)]
            st.markdown('#### Players behind these averages')
            cols=['display_name',group,'draft_year','draft_overall_pick']+NGS_SCORES+[outcome,outcome+'_n']
            view=chosen_players[cols].rename(columns={outcome:label,outcome+'_n':'Recorded observations'})
            st.dataframe(friendly(view).round(2),hide_index=True,use_container_width=True)
            if (visible['Players with NFL outcome']<5).any():st.info('Some displayed groups have fewer than five players. A single prospect can substantially change their averages.')
    with adjusted:
        st.write('Fit a baseline without school identity, predict each player with that player left out, then average the differences by school or conference.')
        variables=st.multiselect('Baseline predictors',TESTS,default=['ngs_athleticism_score','ngs_college_production_score'],format_func=lambda n:LABELS.get(n,n),key='school_predictors')
        if not variables:st.info('Choose at least one baseline predictor.');return
        if 'ngs_final_score' in variables and any(v in variables for v in NGS_SCORES[:2]):st.info('The overall score overlaps with its components. Start with overall score alone or athleticism plus college production.')
        try:complete,mae,rmse=adjusted_results(eligible,outcome,variables)
        except ValueError as exc:st.info(str(exc));return
        a,b,c=st.columns(3);a.metric('Baseline sample',len(complete));b.metric('Missing baseline measurements',len(eligible)-len(complete));c.metric('Prediction error (MAE)',f'{mae:.4f}')
        grouped=complete.groupby(group).agg(**{'Players compared':(outcome,'count'),'Average actual outcome':(outcome,'mean'),'Average baseline prediction':('Baseline prediction','mean'),'Average outcome above baseline':('Outcome above baseline','mean'),'Residual standard deviation':('Outcome above baseline','std')}).reset_index()
        grouped=grouped[grouped['Players compared'].ge(minimum)].sort_values('Average outcome above baseline',ascending=False)
        if grouped.empty:st.info('No groups meet the minimum after requiring complete baseline scores. Try conference comparisons.');return
        all_groups=st.checkbox('Select all schools / conferences',value=True,key='schools_adjusted_all')
        chosen=grouped[group].tolist() if all_groups else st.multiselect('Groups to inspect',grouped[group].tolist())
        visible=grouped[grouped[group].isin(chosen)].rename(columns={group:grouping})
        st.dataframe(visible.round(4),hide_index=True,use_container_width=True)
        if not visible.empty:st.bar_chart(visible.set_index(grouping)[['Average outcome above baseline']])
        st.caption('Positive “above baseline” means a higher outcome than predicted, except get-off time where the sign is reversed so faster-than-predicted is positive. Units match the outcome: seconds, yards, sacks, or counts. For separation, higher is only a descriptive result, not automatically better play.')
        detail=complete[complete[group].isin(chosen)][['display_name',group,'draft_year','draft_overall_pick']+variables+[outcome,'Baseline prediction','Outcome above baseline']].rename(columns={outcome:label})
        st.dataframe(friendly(detail).round(4),hide_index=True,use_container_width=True)
        st.caption('NGS expectations here are predictions from our simple linear baseline using supplied NGS scores, not official NFL forecasts. School is not a predictor. Player-held-out residuals reduce self-fitting but do not establish a school effect, confidence interval, or prospective validation. Baseline training history and score snapshot timing remain unverified. No college contribution is assigned across transfers: school/conference labels are used as supplied.')
    with st.expander('Suggested team experiment'):
        st.write('Choose one position and outcome. Inspect school counts, then compare NGS-adjusted outcomes on the same player sample. Check the individual players behind each apparent advantage. Repeat by conference if schools are too sparse, and inspect one draft class at a time for consistency. Reserve a separate cohort before drawing a scouting conclusion.')
