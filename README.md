# NFL Prospect Lab — Big Data Bowl 2027

Streamlit workspace for combine measurements and NFL outcomes. The default
Defensive Line Lab studies whether combine measurements add information about
rookie get-off beyond the supplied NGS athleticism score.

## Defensive Line Lab

- DE, DT and NT prospects; OLB excluded. Edge = DE; interior = DT or NT.
- Coverage by draft class and group, including missing measurements.
- Player comparisons with get-off observations, recorded sacks and measurements.
- Linear and rank correlations with position-colored scatterplots.
- Train on 2023–2024, evaluate on 2025. Preprocessing uses training players only.
- All compared models use the same complete-player sample, with equal player
  weights and no imputation. Position group is included when both occur.
- CSV downloads for eligible players and evaluated predictions.

Default comparison adds the 10-yard split to athleticism and position group.
Get-off is averaged over supplied rookie regular-season, non-nullified plays.
Sacks are descriptive recorded totals, not opportunity-adjusted sack rates.
Faster get-off alone does not establish better defensive play. Position labels
are roster labels, not play alignment. Small samples and role/context differences
limit interpretation. Inspecting 2025 outcomes and trying specifications makes
that evaluation exploratory. NGS score timing and training cohorts are unverified.

## Other pages

Research Lab, College pathways, Model Lab, NFL Success, Combine slants,
Player profiles, NFL game tracking and Data coverage remain available.

## Included data

The manifest includes nine datasets: players, combine results, combine tracking,
player-play data, games, career successes and NFL tracking for 2023, 2024 and 2025.
There are 510 prospects across the 2023–2025 draft classes. Files are gzip
compressed and some are split into parts. Keep the complete data folder and
manifest intact; do not extract or rename the individual parts.

## Run

```bash
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

For Streamlit Community Cloud use app.py as the entry point. The defensive-line
update adds no dependencies. Optional Streamlit configuration belongs at
.streamlit/config.toml.

## Validate

```bash
python -m unittest test_defensive_line.py
```

Keep competition data access and sharing within the applicable competition terms.
