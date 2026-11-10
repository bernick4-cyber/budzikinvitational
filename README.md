# Budzik Invitational

A standalone league history website with searchable all-time totals, regular-season and playoff filters, records, head-to-head comparisons, division titles, moves/trades analysis, weekly matchup planning, and playoff estimates.

## Publish free with GitHub Pages

1. Create a public GitHub repository named `budzik-invitational`.
2. Extract this ZIP. Upload the contents directly to the repository root, including `index.html`, `bundle.js`, `style.css`, and the data files. Do not upload the ZIP itself or place everything inside another folder.
3. Open repository Settings → Pages.
4. Select Deploy from a branch, branch `main`, folder `/ (root)`, and Save.
5. GitHub will show your public site URL, usually `https://YOUR-USERNAME.github.io/budzik-invitational/`.

No ChatGPT subscription, API key, npm installation, or server is needed. GitHub Pages supports free hosting for public repositories.

## Open locally

Double-click `index.html` after extracting the ZIP. Keep the files together. The archive is embedded in the page so it also works without a server.

## Update the site

- Edit `history.json` to change league data.
- Edit `app.js`, `core.js`, `style.css`, or `index.template.html` to change behavior or appearance.
- Run `python build.py` (or `python3 build.py`) to regenerate `index.html` and `bundle.js`.
- Upload the changed source and generated files to GitHub. Pages publishes the new commit automatically.
- Optional verification: with Node.js installed, run `node --test checks/*.test.mjs`.

Do not edit only the embedded data in `index.html`; `history.json` is the editable source.

## Data snapshot and behavior

Current season: 2026, complete through Week 9. All 54 matchups and 108 starter box scores are included and verified against team scores. The original archive for 2015–2025 is preserved.

New pages:
- Points by position: weekly averages or totals, week-range filters, sorting, team weekly detail, player detail, and CSV export. FLEX is separate from RB, WR and TE. WR combines the two WR slots; FLEX combines both FLEX slots.
- Trade analyzer: compare best legal starting lineups before and after multi-player deals. Initial pools are Week 9 starters only. Add bench players or replacements and edit expected PPG before judging a trade. Historical observed starter averages include zero scores and are not forward projections. It does not assume full current roster ownership from old roster snapshots.
- Playoff simulator: actual Weeks 10–14 schedule, 2,000–20,000 seeded simulations, per-team scoring adjustments, and fixed future score scenarios. It estimates qualification, division, bye and championship probabilities.
- Scenario generator: selected team/goal, exhaustive win/loss paths affecting a division, and an illustrative successful finish with downloadable full results. Exact path counts are not probabilities and ignore score locks. Future PF resolves record ties in the Monte Carlo simulation.

Saved qualification rules: three division winners plus three wild cards; top two division winners get byes. Overall record, then total season PF, determines standing. The championship simulation assumes Weeks 15–17, single-week rounds and reseeding; confirm this bracket assumption against league settings. Exact record-and-PF ties use stable manager ordering only as a computational fallback, not a confirmed Yahoo rule.

The new model uses each team's Weeks 1–9 mean, observed scoring variability shrunk toward a 30-point standard deviation, and uncertainty in team strength. It has no live injury updates, player projections, or NFL bye modeling. Finite-run 0% and 100% are not mathematical elimination or clinch proofs.

The separate older Playoff predictions page remains available with its original historical-variability model; its estimates can differ from the new configurable simulator.

Trade edits, score locks and simulator adjustments are temporary in the current page session. They do not change saved league data. The website does not automatically pull Yahoo results.

## Update files

The included `UPDATE_INSTRUCTIONS.txt` explains the GitHub upload. Run `python build.py` after edits to regenerate `bundle.js` and `index.html`. Calculation tests: `node --test checks/*.test.mjs`.
