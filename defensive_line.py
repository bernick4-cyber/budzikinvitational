"""Defensive-line research workspace."""
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import streamlit as st
from defensive_line_data import FEATURES, load_defensive_line, evaluate_holdout
from presentation import LABELS, friendly


@st.cache_data(max_entries=1, show_spinner=False)
def load():
    return load_defensive_line()


def show():
    st.title('Defensive Line Lab')
    st.write('Do combine measurements add information about rookie NFL get-off beyond the supplied athleticism score?')
    st.caption('DE, DT and NT only. Edge uses the roster DE label; OLB prospects are excluded. Position labels do not identify every player’s actual alignment.')
    with st.spinner('Preparing defensive-line rookie observations…'):
        data = load()
    a, b = st.columns(2)
    group = a.selectbox('Defensive-line group', ['All defensive linemen', 'Edge (DE)', 'Interior (DT / NT)'])
    minimum = int(b.number_input('Minimum rookie get-off observations', min_value=1, max_value=2000, value=20))
    pool = data if group == 'All defensive linemen' else data[data.line_group.eq(group)]
    eligible = pool[pool.getoff_n.ge(minimum) & pool.getoff.notna()]
    a, b, c = st.columns(3)
    a.metric('Prospects', len(pool))
    b.metric('Meet get-off threshold', len(eligible))
    c.metric('Missing / insufficient observations', len(pool) - len(eligible))
    st.info('Lower get-off time means a faster recorded start. It does not measure overall defensive quality. Rookie regular-season player averages are weighted equally; play volume and game context can affect comparisons.')
    coverage, comparisons, relationships, models = st.tabs(['Data coverage', 'Player comparisons', 'Combine relationships', 'Draft-class test'])
    with coverage:
        counts = pool.groupby(['draft_year', 'line_group']).size().rename('Prospects').to_frame()
        counts = counts.join(eligible.groupby(['draft_year', 'line_group']).size().rename('Meet threshold')).fillna(0).astype(int)
        st.dataframe(counts.reset_index(), hide_index=True, use_container_width=True)
        measurements = FEATURES + ['ngs_athleticism_score']
        st.dataframe(pd.DataFrame({'Measurement': [LABELS[n] for n in measurements],
                     'Recorded among eligible players': [eligible[n].notna().sum() for n in measurements],
                     'Missing among eligible players': [eligible[n].isna().sum() for n in measurements]}), hide_index=True, use_container_width=True)
        st.caption('Missing NFL outcomes stay missing. Sacks shown elsewhere are recorded totals, not sack rates; no pass-rush opportunity denominator has been inferred.')
    with comparisons:
        if eligible.empty:
            st.info('No players meet this observation threshold.')
        else:
            names = eligible.set_index('nfl_id').display_name.to_dict()
            chosen = st.multiselect('Compare players', list(names), default=list(names)[:3], format_func=lambda x: names[x])
            view = eligible[eligible.nfl_id.isin(chosen)]
            columns = ['display_name', 'nfl_position', 'draft_year', 'college_name', 'getoff', 'getoff_n', 'recorded_sacks', 'sack_n'] + FEATURES + ['ngs_athleticism_score']
            st.dataframe(friendly(view[columns]).round(3), hide_index=True, use_container_width=True)
            if len(view):
                fig, ax = plt.subplots(figsize=(8, max(3, len(view) * .45)))
                chart = view.sort_values('getoff')
                ax.barh(chart.display_name, chart.getoff, color='#147d92')
                ax.invert_yaxis()
                ax.set(xlabel='Mean rookie get-off (seconds; lower is faster)')
                fig.tight_layout(); st.pyplot(fig); plt.close(fig)
            st.download_button('Download eligible player data', friendly(eligible).to_csv(index=False).encode(), 'defensive_line_players.csv', 'text/csv')
    with relationships:
        measurement = st.selectbox('Combine measurement', FEATURES + ['ngs_athleticism_score'], format_func=lambda x: LABELS[x])
        paired = eligible.dropna(subset=[measurement, 'getoff'])
        st.write(f'{len(paired)} players have both measurements.')
        if len(paired) >= 3 and paired[measurement].nunique() > 1 and paired.getoff.nunique() > 1:
            a, b = st.columns(2)
            a.metric('Linear correlation', f'{paired[measurement].corr(paired.getoff):.3f}')
            b.metric('Rank correlation', f'{paired[measurement].rank().corr(paired.getoff.rank()):.3f}')
            fig, ax = plt.subplots(figsize=(8, 4))
            for label, subset in paired.groupby('line_group'):
                ax.scatter(subset[measurement], subset.getoff, label=label, alpha=.8)
            ax.set(xlabel=LABELS[measurement], ylabel='Mean rookie get-off (seconds)'); ax.legend()
            fig.tight_layout(); st.pyplot(fig); plt.close(fig)
        else:
            st.info('More players with varying measurements are needed for a correlation.')
        st.caption('These relationships use all available classes for exploration. Negative correlations with get-off can mean faster starts at higher input values. Mixing edge and interior players can create position-driven relationships. Correlation does not establish causation.')
    with models:
        st.write('Fit on 2023–2024 prospects and evaluate on 2025 prospects. All models use the same complete players, and preprocessing uses training players only.')
        st.warning('The 2025 class is a retrospective holdout, not an untouched final test once you inspect its outcomes or try different inputs. Exploratory charts above include 2025. Freeze a hypothesis before evaluation and report every attempted specification. NGS score snapshot timing and training cohorts remain unverified.')
        features = st.multiselect('Added combine measurements', FEATURES, default=['ten_yd_split'], format_func=lambda x: LABELS[x])
        st.caption('Start with one added measurement. Position group is included when both edge and interior players occur in training; each player has equal model weight.')
        if st.button('Evaluate 2025 draft class', type='primary'):
            try:
                scores, predictions, sample = evaluate_holdout(pool, features, minimum)
            except ValueError as exc:
                st.info(str(exc))
            else:
                st.dataframe(pd.DataFrame([sample]), hide_index=True, use_container_width=True)
                st.dataframe(scores.round(4), hide_index=True, use_container_width=True)
                if len(scores) == 3:
                    change = scores.iloc[1]['MAE (seconds)'] - scores.iloc[2]['MAE (seconds)']
                    st.write(f'Adding the measurements {"reduced" if change >= 0 else "increased"} test-class average absolute error by {abs(change):.4f} seconds.')
                st.caption('Lower MAE / RMSE is better. Results describe this small supplied sample; they do not establish a reliable scouting advantage. A negative predicted time would be an invalid physical prediction from this unconstrained regression.')
                st.dataframe(friendly(predictions).round(4), hide_index=True, use_container_width=True)
                st.download_button('Download test predictions', friendly(predictions).to_csv(index=False).encode(), 'defensive_line_2025_predictions.csv', 'text/csv')
