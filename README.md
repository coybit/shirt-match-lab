# Shirt Match Lab

A simulation of the childhood football-card game, built on real kit colours, with an interactive course on the maths behind it.

**Live site:** https://coybit.github.io/shirt-match-lab/ · **Course:** https://coybit.github.io/shirt-match-lab/course.html

**Rules.** Two players split a deck. Each card has ONE colour: the colour covering most of the footballer's shirt (ties within 5 points go to a preset order: strong colours before black/grey/white). Before each *set* you may reorder your own cards; during a set the order is locked and players alternately lay their top card. If your card has the same colour as the card just laid, you take the whole pile. (A variant where every colour on the shirt counts is available via `colour.rule = "all"`.) The winner starts the next set. You lose when you must play and have no cards.

## Folder layout

```
config/assumptions.json        every modelling assumption, editable (kit usage, fame weight, colour rules, game size)
data/overrides/kit_usage_overrides.json   optional exact per-team kit usage (replaces the estimate)
data/processed/teams.json      cleaned teams + kits + history sample (built by src/build_dataset.py)
src/engine.js                  shared engine: colours, weighted deck pool, game rules, strategies, exact maths
src/run_scenarios.js           colour breakdowns (deck types, confederations, leagues, decades)
src/run_math.js                set-length law, absorbing Markov chain, colour graph, threshold curve
src/run_tournament.js          round-robin of strategies
src/run_vs_random.js           each strategy vs random across deck types
index.html, course.html        the site (served by GitHub Pages from the repository root)
engine.js, worker.js           shared engine + simulation worker used by the site
teams.json, assumptions.json, results.json   data files loaded by the site
out/                           experiment results (JSON)
```

## Running

```
node src/run_tournament.js 150 40 basic on out/t_main.json
python3 -m http.server 8000                     # then open http://localhost:8000
```
(The web page loads its data files with `fetch`, so open it through a local server rather than double-clicking it.)

## How a "realistic deck" is weighted

```
card weight = matches per season (by league level / national)
            x fame^exponent           (Wikipedia language editions; optional, top-N filter)
            x kit usage share         (home / away / third; estimate, overridable per team)
shirt colours = body (70%: base colour + stripe/hoop pattern pixels) + sleeves (2 x 15%)
card colour = the family with the biggest share (rule 'dominant', tie window 5 points, tie_priority list)
            or, in the variant rule 'all', every colour covering >= min_share (12%)
```

All of these are in `config/assumptions.json` and adjustable live in the web interface.

## Data sources

* English Wikipedia: `Infobox football club`, `Infobox national football team`, club season articles (kit parameters)
* Wikimedia Commons: kit body pattern images (pixel colour analysis)
* Wikidata: country (P17), continent (P30), league (P118), league level (P3983), competition class (P2094), inception (P571), sitelinks

Scraped 17 Oct 2026. Known gaps: current kits only (history = 43 big clubs' season articles), league labels from Wikidata can be outdated, sleeve patterns and shorts and socks ignored.

(The 17 MB raw scrape and the build script that turns it into `data/processed/teams.json` are kept outside this repository.)
