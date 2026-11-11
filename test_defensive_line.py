import unittest
import numpy as np
import pandas as pd
from defensive_line_data import summarize_rookies, evaluate_holdout


class DefensiveLineTests(unittest.TestCase):
    def test_rookie_regular_season_and_penalties(self):
        players = pd.DataFrame({'nfl_id': [1], 'draft_year': [2023]})
        games = pd.DataFrame({'game_id': [1, 2, 3], 'season': [2023, 2024, 2023], 'season_type': ['REG', 'REG', 'POST']})
        plays = pd.DataFrame({'nfl_id': [1]*5, 'game_id': [1, 1, 1, 2, 3],
                              'play_id': [1, 2, 3, 4, 5], 'play_nullified_by_penalty': ['N', 'N', 'Y', 'N', 'N'],
                              'player_get_off': [1., np.nan, 9., 9., 9.], 'sack': [0., np.nan, 1., 1., 1.]})
        row = summarize_rookies(plays, players, games).loc[1]
        self.assertEqual(row.getoff, 1.)
        self.assertEqual(row.getoff_n, 1)
        self.assertEqual(row.recorded_plays, 2)
        self.assertEqual(row.recorded_sacks, 0.)

    def sample(self):
        n = 30
        return pd.DataFrame({'nfl_id': range(n), 'display_name': [str(i) for i in range(n)],
            'nfl_position': ['DT']*n, 'line_group': ['Interior']*n,
            'draft_year': [2023]*10 + [2024]*10 + [2025]*10,
            'getoff_n': [30]*n, 'getoff': np.linspace(.7, 1.3, n),
            'ngs_athleticism_score': np.sin(np.arange(n)) + 70,
            'ten_yd_split': np.cos(np.arange(n)) + 2})

    def test_test_outcomes_do_not_affect_predictions(self):
        d = self.sample()
        _, before, _ = evaluate_holdout(d, ['ten_yd_split'])
        d.loc[d.draft_year.eq(2025), 'getoff'] += 10
        _, after, _ = evaluate_holdout(d, ['ten_yd_split'])
        np.testing.assert_allclose(before.iloc[:, 6:].to_numpy(float), after.iloc[:, 6:].to_numpy(float))

    def test_common_sample_and_chronological_split(self):
        d = self.sample()
        d.loc[0, 'ten_yd_split'] = np.nan
        d.loc[20, 'ngs_athleticism_score'] = np.nan
        scores, predictions, coverage = evaluate_holdout(d, ['ten_yd_split'])
        self.assertEqual(coverage['Training players'], 19)
        self.assertEqual(coverage['Test players'], 9)
        self.assertEqual(coverage['Missing selected inputs'], 2)
        self.assertTrue(predictions.draft_year.eq(2025).all())
        self.assertEqual(len(scores), 3)

    def test_small_test_sample_is_reported(self):
        with self.assertRaisesRegex(ValueError, 'five'):
            evaluate_holdout(self.sample().iloc[:24], ['ten_yd_split'])


if __name__ == '__main__':
    unittest.main()
