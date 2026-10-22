"""Streamlit entry point for the NFL combine slant explorer."""
from pathlib import Path
import io
import pandas as pd
import matplotlib.pyplot as plt
import streamlit as st
from nfl_slant_starter import inspect_attempt

st.set_page_config(page_title='NFL Prospect Lab', page_icon='🏈', layout='wide')
from presentation import banner, detail_table
banner()
@st.cache_data(show_spinner=False)
def load_csv(raw):
    return pd.read_csv(io.BytesIO(raw))

DATA_DIR = Path(__file__).resolve().parent / 'data'

@st.cache_data(show_spinner=False)
def bundled_csv(filename):
    from data_access import read_data
    return read_data(filename)

with st.sidebar:
    st.title('Prospect Lab')
    st.caption('From combine movement to NFL performance')
    page = st.radio('Research tools', ['Research Lab', 'College pathways', 'Model Lab', 'NFL Success', 'Combine slants', 'Player profiles', 'NFL game tracking', 'Data coverage'])
    st.divider()
    st.caption('NFL Big Data Bowl 2027')

if page == 'College pathways':
    from school_lab import show as schools
    schools()
    st.stop()

if page == 'Model Lab':
    from model_lab import show as models
    models()
    st.stop()

if page == 'NFL Success':
    from nfl_success import show as success
    success()
    st.stop()

if page == 'Research Lab':
    from research_lab import show as research
    research()
    st.stop()

if page != 'Combine slants':
    from extra_views import show
    show(page)
    st.stop()
st.title('Combine route explorer')
st.write('See how a receiver moves through a slant and compare their speed before and after the estimated turn.')
try:
    with st.spinner('Loading included competition data…'):
        players = bundled_csv('players.csv')
        tracking = bundled_csv('combine_tracking.csv')
    for label, df, required in [
        ('players', players, {'nfl_id','display_name','nfl_position'}),
        ('tracking', tracking, {'nfl_id','event_id','entity_type','drill_name','time','x','y','s','dir'})]:
        missing = required - set(df.columns)
        if missing:
            st.error(f'{label} file is missing columns: {", ".join(sorted(missing))}')
            st.stop()
    wr = players[players.nfl_position.eq('WR')].drop_duplicates('nfl_id')
    data = tracking[tracking.nfl_id.isin(wr.nfl_id) & tracking.entity_type.eq('PLAYER') & tracking.drill_name.eq('SLANT_ROUTE_LEFT')].copy()
    if data.empty:
        st.error('No WR SLANT_ROUTE_LEFT player frames were found.'); st.stop()
    if data.duplicated(['event_id','nfl_id','time']).any():
        st.error('Duplicate tracking frames found. Resolve them before measuring.'); st.stop()
    if data[['x','y','s','dir','time']].isna().any().any():
        st.error('Missing tracking measurements found. Resolve them before measuring.'); st.stop()
    names = wr.set_index('nfl_id').display_name.to_dict()
    left, right = st.columns(2)
    left.metric('Receivers with slant tracking', data.nfl_id.nunique())
    right.metric('Drill attempts', data[['event_id','nfl_id']].drop_duplicates().shape[0])
    player = st.selectbox('Receiver', sorted(data.nfl_id.unique(), key=lambda n: str(names[n])), format_func=lambda n: names[n])
    subset = data[data.nfl_id.eq(player)]
    attempts = list(subset.event_id.unique())
    event = st.selectbox('Attempt', attempts, format_func=lambda n: f'Attempt {attempts.index(n)+1}')
    g, i, metrics = inspect_attempt(subset[subset.event_id.eq(event)])
    if metrics is None:
        st.warning('This attempt does not have enough usable moving frames for the candidate turn measurement.'); st.stop()
    g = g.reset_index(drop=True)
    seconds = (g.time - g.time.iloc[0]).dt.total_seconds()
    fig, axs = plt.subplots(1, 2, figsize=(12, 5))
    x, y = g.x-g.x.iloc[0], g.y-g.y.iloc[0]
    axs[0].plot(x,y,'-o',markersize=3)
    axs[0].scatter(x.iloc[i],y.iloc[i],c='red',label='Estimated turn',zorder=3)
    axs[0].set(xlabel='Lengthwise movement (yards)',ylabel='Sideways movement (yards)',title='Route path')
    axs[0].set_aspect('equal'); axs[0].legend()
    axs[1].plot(seconds,g.s)
    axs[1].axvline(seconds.iloc[i],color='red',label='Estimated turn')
    axs[1].set(xlabel='Time since first frame (seconds)',ylabel='Speed (yards/second)',title='Speed over time'); axs[1].legend()
    fig.tight_layout(); st.pyplot(fig); plt.close(fig)
    st.caption('Coordinates are relative to the first frame. Routes are not rotated or aligned across players.')
    c1,c2,c3 = st.columns(3)
    c1.metric('Speed before turn',f'{metrics["entry_speed_yd_s"]:.2f} yd/s')
    c2.metric('Speed after turn',f'{metrics["exit_speed_yd_s"]:.2f} yd/s')
    c3.metric('Speed change through turn',f'{(metrics["exit_entry_speed_ratio"]-1)*100:+.1f}%')
    st.caption('The turn marker is an estimate. Review the route before interpreting the speed change.')
    with st.expander('How to read these measurements'):
        st.write('Before and after speeds are averages over 0.3 seconds on each side of the estimated turn. A positive percentage means the player sped up. The turn marker is an automated estimate that needs visual review. These measurements have not yet been shown to predict NFL performance.')
    with st.expander('Movement details'):
        detail_table(g)
except (ValueError, KeyError, pd.errors.ParserError) as exc:
    st.error(f'Could not process these files: {exc}')
