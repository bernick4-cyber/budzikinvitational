"""Exploratory multi-variable regression and range inspection."""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import streamlit as st
from research_lab import load, TESTS, OUTCOMES, score_guide
from presentation import LABELS, friendly


def loo_predictions(X,y):
    X=np.asarray(X,dtype=float);y=np.asarray(y,dtype=float)
    predictions=[]
    for i in range(len(y)):
        mask=np.arange(len(y))!=i
        # Fit scaling only on training players to keep the held-out player separate.
        train=X[mask];center=train.mean(axis=0);scale=train.std(axis=0)
        scale=np.where(scale>0,scale,1.)
        A=np.column_stack([np.ones(mask.sum()),(train-center)/scale])
        test=np.r_[1.,(X[i]-center)/scale]
        if np.linalg.matrix_rank(A)<A.shape[1]:
            raise ValueError('Some selected variables repeat the same information or have no variation. Remove a variable and try again.')
        predictions.append(test@np.linalg.lstsq(A,y[mask],rcond=None)[0])
    return np.asarray(predictions)


def evaluate(data,outcome,columns):
    y=data[outcome].to_numpy(dtype=float)
    if columns:
        pred=loo_predictions(data[columns].to_numpy(dtype=float),y)
    else:
        pred=(y.sum()-y)/(len(y)-1)
    return pred,float(np.mean(np.abs(y-pred))),float(np.sqrt(np.mean((y-pred)**2)))


def show():
    st.title('Model Lab')
    st.write('Explore related measurements, test whether extra variables improve predictions, and inspect promising ranges.')
    with st.spinner('Preparing rookie-season data…'):data=load()
    positions=sorted(data.nfl_position.dropna().unique())
    a,b=st.columns(2)
    pos=a.selectbox('Position',positions,index=positions.index('DT') if 'DT' in positions else 0)
    years=b.multiselect('Draft classes',sorted(data.draft_year.unique()),default=sorted(data.draft_year.unique()))
    pool=data[data.nfl_position.eq(pos)&data.draft_year.isin(years)]
    outcome=st.selectbox('NFL outcome to study',list(OUTCOMES),index=list(OUTCOMES).index('getoff'),format_func=lambda n:OUTCOMES[n][0])
    minimum=int(st.number_input('Minimum recorded outcome observations per player',min_value=1,max_value=2000,value=20 if outcome in {'getoff','separation','yac'} else 1))
    score_guide()
    preset=st.selectbox('Baseline starting point',['Choose my own variables','NGS athleticism + college production','NGS overall prospect score'])
    defaults={'Choose my own variables':['combine_weight'],'NGS athleticism + college production':['ngs_athleticism_score','ngs_college_production_score'],'NGS overall prospect score':['ngs_final_score']}
    baseline=st.multiselect('Baseline variables',TESTS,default=defaults[preset],format_func=lambda n:LABELS.get(n,n),key='baseline_'+preset)
    additions=st.multiselect('Additional variables to test',[n for n in TESTS if n not in baseline],default=['vertical'] if 'vertical' not in baseline else [],format_func=lambda n:LABELS.get(n,n))
    variables=baseline+additions
    if 'ngs_final_score' in variables and any(v in variables for v in ['ngs_athleticism_score','ngs_college_production_score']):
        st.info('Overall prospect score overlaps with its components. For a clearer baseline, compare the overall score alone or athleticism plus college production first.')
    if not variables:st.info('Choose at least one measurement.');return
    eligible=pool[pool[outcome+'_n'].ge(minimum)&pool[outcome].notna()]
    d=eligible.dropna(subset=variables).copy()
    c1,c2,c3=st.columns(3);c1.metric('Players in analysis',len(d));c2.metric('Missing selected measurements',len(eligible)-len(d));c3.metric('Insufficient / missing NFL observations',len(pool)-len(eligible))
    st.caption('All models use the same complete player sample. Adding a measurement can change that sample, so compare models within the same run. No missing values are filled in.')
    st.warning('Exploration, not a validated scouting model. Trying many variables and ranges can overfit even with leave-one-player-out checks. Reserve a separate draft class or players for final validation before claiming a useful predictor or sweet spot.')
    if len(d)<max(8,len(variables)+4):st.info('More complete players are needed for this number of variables. Reduce variables or broaden the sample.');return
    if d[outcome].nunique()<2:st.info('The outcome has no variation in this sample.');return
    associations,models,ranges=st.tabs(['Variable relationships','Prediction error','Explore a sweet spot'])
    with associations:
        method=st.radio('Correlation method',['Linear','Rank'],horizontal=True)
        numeric=d[variables+[outcome]].astype(float)
        corr=numeric.corr() if method=='Linear' else numeric.rank().corr()
        labels={**LABELS,outcome:OUTCOMES[outcome][0]};corr=corr.rename(index=labels,columns=labels)
        st.dataframe(corr.round(2).style.background_gradient(cmap='RdBu',vmin=-1,vmax=1),use_container_width=True)
        pairs=[]
        for i,left in enumerate(numeric.columns):
            for right in numeric.columns[i+1:]:
                value=numeric[left].corr(numeric[right]) if method=='Linear' else numeric[left].rank().corr(numeric[right].rank())
                if pd.notna(value):pairs.append({'First variable':labels.get(left,left),'Second variable':labels.get(right,right),'Correlation':value,'strength':abs(value)})
        if pairs:st.dataframe(pd.DataFrame(pairs).sort_values('strength',ascending=False).drop(columns='strength').round(3),hide_index=True,use_container_width=True)
        st.caption('Linear correlation compares actual values in a straight-line pattern. Rank correlation compares player ordering. Both run from −1 to +1. Negative does not mean bad; smaller timed measurements mean faster performance. Highly correlated inputs may duplicate information and make model coefficients unstable.')
    with models:
        configurations=[('Training-player average',[]),('Baseline',baseline)]
        configurations += [('Baseline + '+LABELS.get(v,v),baseline+[v]) for v in additions]
        if len(additions)>1:configurations.append(('All selected variables',variables))
        records=[];predictions={}
        for title,columns in configurations:
            try:
                pred,mae,rmse=evaluate(d,outcome,columns);predictions[title]=pred
                records.append({'Model':title,'Variables':', '.join(LABELS.get(v,v) for v in columns) or 'No player measurements','Mean absolute error':mae,'Root mean squared error':rmse})
            except ValueError as exc:st.info(f'{title}: {exc}')
        result=pd.DataFrame(records)
        if result.empty:return
        st.dataframe(result.round(5),hide_index=True,use_container_width=True)
        st.caption('Errors use the outcome’s original units. For get-off time, 0.06 means 0.06 seconds. Smaller error is better. MAE is the average absolute miss; RMSE penalizes large misses more. Each prediction is made with that player excluded from fitting. This is not an independent test after choosing variables through exploration.')
        if 'Baseline' in predictions:
            base=result.loc[result.Model.eq('Baseline'),'Mean absolute error'].iloc[0]
            for _,row in result.iterrows():
                if row.Model in {'Baseline','Training-player average'}:continue
                improvement=base-row['Mean absolute error']
                st.write(f"**{row.Model}:** average error {'decreased' if improvement>=0 else 'increased'} by {abs(improvement):.5f} in outcome units versus baseline.")
        model=st.selectbox('Inspect predictions',list(predictions))
        pred=predictions[model];actual=d[outcome].to_numpy(float)
        view=d[['display_name','draft_year','draft_overall_pick']].copy();view['Actual outcome']=actual;view['Predicted outcome (player held out)']=pred;view['Absolute error']=np.abs(actual-pred)
        st.dataframe(friendly(view).round(4),hide_index=True,use_container_width=True)
        fig,ax=plt.subplots(figsize=(9,4));ax.scatter(actual,pred,color='#147d92');lo=min(actual.min(),pred.min());hi=max(actual.max(),pred.max());ax.plot([lo,hi],[lo,hi],'--',color='gray');ax.set(xlabel='Actual '+OUTCOMES[outcome][0],ylabel='Held-out prediction');fig.tight_layout();st.pyplot(fig);plt.close(fig)
    with ranges:
        st.write('Choose measurement ranges and inspect the actual outcomes of matching players. This is a descriptive filter, not an automatically optimized or validated threshold.')
        chosen=st.multiselect('Measurements to filter',variables,default=variables[:2],format_func=lambda n:LABELS.get(n,n))
        matching=d.copy()
        for v in chosen:
            lo=float(d[v].min());hi=float(d[v].max())
            if lo==hi:st.caption(f'{LABELS.get(v,v)} has one value.');continue
            bounds=st.slider(LABELS.get(v,v),min_value=lo,max_value=hi,value=(lo,hi),key='range_'+v)
            matching=matching[matching[v].between(*bounds)]
        a,b,c=st.columns(3);a.metric('Matching players',len(matching));b.metric('Matching average',f'{matching[outcome].mean():.4f}' if len(matching) else '—');c.metric('Full sample average',f'{d[outcome].mean():.4f}')
        outside=d[~d.nfl_id.isin(matching.nfl_id)]
        st.caption(f'{len(outside)} players outside the selected ranges. Their average: '+(f'{outside[outcome].mean():.4f}' if len(outside) else 'not available')+'. These are equally weighted player averages, not causal effects.')
        if len(matching)<10:st.info('Fewer than 10 matching players: treat this range as a very small-sample lead.')
        view=matching[['display_name','draft_year','draft_overall_pick']+variables+[outcome,outcome+'_n']].rename(columns={outcome:OUTCOMES[outcome][0],outcome+'_n':'Recorded observations'})
        st.dataframe(friendly(view).round(3),hide_index=True,use_container_width=True)
        st.caption('Do not remove inconvenient players to improve a result. Write the proposed range and its football rationale, then test it on a separate cohort. No selected ranges or notes are saved across users.')
