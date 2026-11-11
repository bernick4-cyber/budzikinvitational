"""Rookie defensive-line summaries and chronological prediction evaluation."""
import numpy as np
import pandas as pd
from data_access import read_data

POSITIONS = {'DE': 'Edge (DE)', 'DT': 'Interior (DT / NT)', 'NT': 'Interior (DT / NT)'}
FEATURES = ['ten_yd_split', 'broad_jump', 'vertical', 'combine_weight', 'arm_length', 'wing_span']
BASELINE = ['ngs_athleticism_score']


def summarize_rookies(plays, players, games):
    """Count only supplied, non-nullified regular-season rookie observations."""
    q = plays.merge(players[['nfl_id', 'draft_year']], on='nfl_id', validate='many_to_one')
    q = q.merge(games[['game_id', 'season', 'season_type']], on='game_id', validate='many_to_one')
    q = q[q.season.eq(q.draft_year) & q.season_type.eq('REG')
          & q.play_nullified_by_penalty.eq('N')].copy()
    q['player_get_off'] = pd.to_numeric(q.player_get_off, errors='coerce')
    q['sack'] = pd.to_numeric(q.sack, errors='coerce')
    return q.groupby('nfl_id').agg(
        getoff=('player_get_off', 'mean'), getoff_n=('player_get_off', 'count'),
        recorded_sacks=('sack', lambda x: x.sum(min_count=1)),
        sack_n=('sack', 'count'), recorded_plays=('play_id', 'size'),
        recorded_games=('game_id', 'nunique'))


def load_defensive_line():
    players = read_data('players.csv')
    players = players[players.nfl_position.isin(POSITIONS)].copy()
    combine = read_data('combine_results.csv').drop(columns='draft_year', errors='ignore')
    games = read_data('games.csv')
    pieces = []
    columns = ['nfl_id', 'game_id', 'play_id', 'play_nullified_by_penalty', 'player_get_off', 'sack']
    with read_data('player_play.csv', chunksize=100000) as reader:
        for chunk in reader:
            pieces.append(chunk.loc[chunk.nfl_id.isin(players.nfl_id), columns])
    plays = pd.concat(pieces, ignore_index=True)
    if plays.duplicated(['game_id', 'play_id', 'nfl_id']).any():
        raise ValueError('Duplicate player-play rows must be resolved before analysis.')
    summary = summarize_rookies(plays, players, games)
    result = players.merge(combine, on='nfl_id', how='left', validate='one_to_one')
    result = result.merge(summary, on='nfl_id', how='left', validate='one_to_one')
    result['line_group'] = result.nfl_position.map(POSITIONS)
    return result


def fit_predict(train, test, columns):
    """OLS, with scaling and position coding fitted using training players only."""
    numeric = list(columns)
    a = train[numeric].to_numpy(float)
    b = test[numeric].to_numpy(float)
    center = a.mean(axis=0)
    scale = a.std(axis=0)
    scale = np.where(scale > 0, scale, 1.)
    a, b = (a - center) / scale, (b - center) / scale
    groups = sorted(train.line_group.unique())
    if not set(test.line_group).issubset(groups):
        raise ValueError('A test position group is absent from the training sample.')
    for group in groups[1:]:
        a = np.column_stack([a, train.line_group.eq(group).astype(float)])
        b = np.column_stack([b, test.line_group.eq(group).astype(float)])
    a = np.column_stack([np.ones(len(train)), a])
    b = np.column_stack([np.ones(len(test)), b])
    if len(train) < a.shape[1] + 5:
        raise ValueError('Too few training players for these variables; reduce measurements or broaden the group.')
    if np.linalg.matrix_rank(a) < a.shape[1]:
        raise ValueError('Selected measurements have no variation or repeat information; remove a measurement.')
    return b @ np.linalg.lstsq(a, train.getoff.to_numpy(float), rcond=None)[0]


def evaluate_holdout(data, features, minimum=20, test_year=2025):
    """Use a common complete sample; never fit on the held-out class."""
    columns = list(dict.fromkeys(BASELINE + list(features)))
    eligible = data[data.getoff_n.ge(minimum) & data.getoff.notna()]
    complete = eligible.replace([np.inf, -np.inf], np.nan).dropna(subset=columns + ['getoff'])
    train = complete[complete.draft_year.lt(test_year)].copy()
    test = complete[complete.draft_year.eq(test_year)].copy()
    if len(test) < 5:
        raise ValueError('At least five complete test-class players are required. Reduce measurements or broaden the group.')
    if train.empty:
        raise ValueError('No earlier draft classes are available for training.')
    predictions = test[['nfl_id', 'display_name', 'nfl_position', 'draft_year', 'getoff', 'getoff_n']].copy()
    configurations = [('Training average', None), ('Athleticism + position group', BASELINE)]
    if features:
        configurations.append(('Athleticism + position group + measurements', columns))
    scores = []
    for name, inputs in configurations:
        predicted = np.repeat(train.getoff.mean(), len(test)) if inputs is None else fit_predict(train, test, inputs)
        error = test.getoff.to_numpy(float) - predicted
        scores.append({'Model': name, 'MAE (seconds)': np.abs(error).mean(),
                       'RMSE (seconds)': np.sqrt(np.mean(error ** 2))})
        predictions[name] = predicted
    coverage = {'Eligible': len(eligible), 'Missing selected inputs': len(eligible) - len(complete),
                'Training players': len(train), 'Test players': len(test)}
    return pd.DataFrame(scores), predictions, coverage
