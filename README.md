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

The archive includes 947 completed games, historical seasons 2015–2025 and current-season 2026 Weeks 1–4, plus the supplied remaining schedule. Week 5 partial scores are not counted as final results.

Division titles use overall regular-season record (ties count as half a win), then points for. Current division leaders are not awarded completed titles.

Playoff estimates use this year's average points for and historical score variability with the remaining schedule: three division winners plus three wildcards, with byes for the two best division winners. Historical start-record playoff rates appear separately. Estimates are not based on player projections.

Matchup planner selections save in the current browser only. The public site does not synchronize edits or automatically pull Yahoo results. Publish data changes through the source files.

The included Excel download covers 2015–2025 and predates the division-title additions; the website JSON is the newer full archive.
