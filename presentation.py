"""Shared, plain-language labels for the team workspace."""
import pandas as pd
import streamlit as st

HIDDEN = {'nfl_id','event_id','game_id','game_key','play_id','method'}
LABELS = {
'getoff':'Mean rookie get-off (seconds)','getoff_n':'Recorded get-off observations',
'recorded_sacks':'Recorded rookie sacks','sack_n':'Recorded sack observations',
'recorded_plays':'Recorded rookie player-play appearances','recorded_games':'Recorded rookie games',
'line_group':'Defensive-line group',
'display_name':'Player','nfl_position':'Position','combine_position':'Testing position',
'draft_year':'Draft year','birth_date':'Date of birth','college_name':'College','college_conference':'Conference',
'draft_round':'Draft round','draft_pick_within_round':'Pick in round','draft_overall_pick':'Overall pick',
'combine_height':'Height (inches)','combine_weight':'Weight (lb)','hand_size':'Hand size (inches)',
'arm_length':'Arm length (inches)','wing_span':'Wingspan (inches)',
'forty':'40-yard dash (seconds)','ten_yd_split':'10-yard split (seconds)',
'vertical':'Vertical jump (inches)','broad_jump':'Broad jump (inches)',
'three_cone':'Three-cone drill (seconds)','short_shuttle':'Short shuttle (seconds)',
'bench_reps':'Bench press repetitions','ngs_athleticism_score':'Athleticism score',
'ngs_college_production_score':'College production score','ngs_final_score':'Overall prospect score',
'career_offensive_snaps':'Offensive plays','career_defensive_snaps':'Defensive plays',
'career_special_teams_snaps':'Special teams plays','career_games_active':'Games active',
'career_games_started':'Games started','ap_all_pro_1st_team':'First-team All-Pro selections',
'ap_all_pro_2nd_team':'Second-team All-Pro selections','pro_bowl_original_ballot':'Pro Bowls (original selection)',
'x':'Field length position (yards)','y':'Field width position (yards)',
's':'Speed (yards/second)','a':'Acceleration (yards/second²)',
'dis':'Distance since last reading (yards)','dir':'Movement direction (degrees)',
'o':'Body direction (degrees)','event':'Play event','time':'Timestamp',
'team_abbr':'Team','lined_up_position':'Position on play','play_description':'Play description',
'route_ran':'Route','separation_at_pass_forward':'Separation when thrown (yards)',
'cushion':'Starting defender distance (yards)','target':'Pass intended for player',
'rec_yards':'Receiving yards','rush_yards':'Rushing yards','yards_after_catch':'Yards after catch',
'expected_yards_after_catch':'Expected yards after catch','quarter':'Quarter','down':'Down',
'yards_to_go':'Yards for first down','team_coverage_man_zone':'Man or zone coverage',
'entry_speed_yd_s':'Speed before turn (yards/second)',
'exit_speed_yd_s':'Speed after turn (yards/second)',
'exit_entry_speed_ratio':'Speed after / before turn','candidate_turn_seconds':'Estimated turn time (seconds)',
'candidate_turn_x':'Estimated turn field length (yards)','candidate_turn_y':'Estimated turn field width (yards)',
'peak_heading_rate_deg_s':'Turning rate (degrees/second)','frames':'Tracking readings','duration_seconds':'Duration (seconds)',
}

def friendly(df):
    out=df.drop(columns=[c for c in df if c in HIDDEN]).copy()
    out=out.rename(columns={c:LABELS.get(c,c.replace('_',' ').capitalize()) for c in out})
    if 'Play event' in out:
        out['Play event']=out['Play event'].fillna('—').map(lambda x:str(x).replace('_',' ').capitalize())
    return out

def detail_table(df):
    data=friendly(df)
    if len(data)==1:
        row=data.iloc[0]
        records=[]
        for label,value in row.items():
            if pd.isna(value): value='Not recorded'
            elif isinstance(value,float): value=f'{value:,.2f}'.rstrip('0').rstrip('.')
            records.append({'Measurement':label,'Value':str(value)})
        st.dataframe(pd.DataFrame(records),hide_index=True,use_container_width=True)
    else:
        st.dataframe(data,hide_index=True,use_container_width=True)

def banner():
    st.markdown('''<style>
    .stApp {background: #f5f7fb;}
    h1,h2,h3 {color:#14243c;letter-spacing:-0.025em;}
    [data-testid="stSidebar"] {background:#14243c;}
    [data-testid="stSidebar"] * {color:#f3f6fb;}
    [data-testid="stMetric"] {background:white;border:1px solid #e1e7ef;border-radius:12px;padding:18px;}
    </style>''',unsafe_allow_html=True)
    st.caption('NFL BIG DATA BOWL 2027 • TEAM RESEARCH WORKSPACE')
