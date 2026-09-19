# Matt & Matt TD Parlay Tracker

A full-stack NFL anytime-touchdown parlay tracker for Matt P and Matt B.

## Current MVP
- Packers-inspired Sunday Football UI
- Separate Matt P / Matt B / combined bankrolls
- Multiple live parlays
- 50/50 wager and P/L calculations
- Leg statuses: Not Started, Live, TD Scored, Failed
- Immediate parlay loss when a leg fails
- Completed parlays move to history
- DraftKings import workflow with confirmation screen
- Manual entry fallback
- Promo flags per leg
- PostgreSQL persistence
- Render-ready deployment configuration

## Important DraftKings note
This app does **not** log into DraftKings, scrape My Bets, or automate access to a DraftKings account. DraftKings Sportsbook terms prohibit automated harvesting/scraping of website information. Use the import workflow by pasting/entering bet information you already have access to.

## Local setup
1. Install Node.js 20+.
2. Create a PostgreSQL database and set `DATABASE_URL`.
3. Run:
   - `npm install`
   - `npm run install:all`
   - `npm run dev`
4. Open the Vite URL shown by the client.

## Render
The included `render.yaml` creates the web service and PostgreSQL database. Connect the GitHub repo to Render and deploy.

## Live NFL data
The server includes a pluggable scoreboard adapter. The initial adapter uses ESPN's public scoreboard feed for game/player status. This should be treated as an external data source and can be replaced with a dedicated licensed sports-data provider later.
