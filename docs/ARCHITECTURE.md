# Architecture Overview

## Design Goal

The repo is structured as a static frontend project with clear separation between:

- configuration
- data acquisition
- analytics
- persistence
- rendering
- application orchestration

This keeps the project readable on GitHub and makes later migration to a backend or charting platform straightforward.

## File Responsibilities

### `index.html`

- Defines the application shell and all visible dashboard sections
- Keeps the visual styling co-located for simple static deployment
- Loads the application through a single module entrypoint

### `src/main.js`

- Bootstraps the app
- Creates a single runtime instance

### `src/js/config.js`

- Shared constants
- Frame configuration
- Refresh timing
- Backtest horizon metadata

### `src/js/utils.js`

- Formatting helpers
- Indicator math
- DOM helpers
- Small reusable numeric utilities

### `src/js/storage.js`

- Local storage load and save
- Initial state construction
- Persistence trimming for journals and alert queues

### `src/js/market-data.js`

- REST calls for candles, ticker stats, and level 2 book data
- WebSocket setup for live ticker flow
- Exchange-specific data normalization

### `src/js/analytics.js`

- Order-flow analytics
- Per-frame signal analysis
- Multi-timeframe aggregation
- Rolling backtest
- Forecast generation
- Risk sizing and playbook derivation
- Desk narrative notes

### `src/js/render.js`

- DOM rendering layer
- Chart SVG generation
- Dashboard card rendering
- Journal, notes, alerts, and playbook visualization

### `src/js/app.js`

- State orchestration
- Sync scheduling
- Live feed handling
- Alert processing
- Journal resolution
- Event wiring
- Render coordination

## Runtime Flow

1. `src/main.js` creates the app.
2. `app.init()` attaches listeners, boots the clock, restores persisted state, and starts the data loops.
3. `market-data.js` fetches candles, stats, and book snapshots.
4. `analytics.js` scores the market and builds risk/forecast outputs.
5. `render.js` updates the dashboard.
6. Alert state, journal state, and user settings are persisted through `storage.js`.

## Naming and Modularity Changes

The production pass cleaned up several issues from the single-file prototype:

- Extracted runtime logic from the HTML bundle into modules
- Standardized analytical timeframe naming to avoid collisions with display timeframes
- Centralized shared constants
- Separated rendering from analytics
- Separated exchange I/O from model logic
- Preserved the dashboard while making the code reviewable

## Extension Points

The current structure is intentionally ready for the next step:

- Replace Coinbase with a feed adapter layer
- Move analytics into a worker or backend
- Publish the model through an API
- Add persistent journaling and alert delivery
- Add a Pine Script or Python companion implementation

## Deployment Model

This project is static-first:

- No build step required
- No server dependency required for the UI
- Easy deployment to GitHub Pages or any static host

The only runtime dependency is browser access to Coinbase APIs and any optional webhook endpoint you configure.
