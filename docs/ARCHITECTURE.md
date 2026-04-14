# Architecture Overview

## Current Runtime

The active root app is a single-file static implementation in `index.html`.

That is the current production path for the repository. It was rebuilt this way to guarantee:

- seeded data is visible immediately
- no blank screen if a module chain fails
- simple static deployment
- easier GitHub review
- minimal browser/runtime assumptions

## Design Goal

Velocity Desk is intentionally static-first. The architecture optimizes for:

- compatibility
- readability
- simple deployment
- trader-facing outputs instead of framework complexity

The app is designed to feel operational, not overengineered.

## Root File Responsibilities

### `index.html`

The root file now contains all active runtime concerns:

- application shell and styling
- seeded fallback BTC data
- local state bootstrap
- Coinbase polling and WebSocket hooks
- indicator math and signal scoring
- backtest and forecast generation
- risk sizing
- alert handling
- journal state
- SVG chart rendering

This is the file GitHub readers should treat as the live implementation.

## Runtime Sections Inside `index.html`

The inline script is organized into these practical layers:

### State and persistence

- local storage restore and save
- seeded fallback state
- alert and journal persistence trimming

### Market data

- Coinbase REST polling for ticker, stats, book, and candles
- optional WebSocket ticker flow
- graceful fallback to seeded data

### Analytics

- EMA, RSI, MACD, ATR, slope, and simple order-flow calculations
- per-frame signal scoring
- multi-timeframe blending
- rolling backtest estimation
- scenario forecast generation
- risk-plan derivation

### Rendering

- banner and hero updates
- chart rendering through SVG
- board, forecast, playbook, notes, journal, and log updates

### Operations

- timer scheduling
- refresh handling
- alert triggering
- webhook queue flushing
- browser notification requests

## Data Flow

1. Seed fallback BTC data is loaded immediately.
2. The app renders a usable desk before any network calls complete.
3. Coinbase polling updates ticker, stats, book, and candles when available.
4. Optional WebSocket ticks enrich short-term tape behavior.
5. Analytics rebuild the desk state.
6. Render passes update the visible dashboard.
7. Alerts, settings, and journal state persist locally in the browser.

## Why `src/` Still Exists

The `src/` tree is retained as legacy/reference code from the earlier modular production pass.

It is still useful because it shows:

- a more separated code organization
- clean boundaries between data, analytics, render, and storage
- a possible future direction if the app moves back to a modular runtime

But for the current repository state, `src/` is not the active root implementation.

## Extension Points

The easiest next upgrades are:

- move live analytics into a Web Worker
- replace browser-queued webhooks with a small backend alert relay
- add exchange aggregation instead of Coinbase-only reads
- store journal outcomes in a backend or database
- expose the signal model through a Python or Pine Script companion

## Deployment Model

The project remains static-host friendly:

- no build step required
- no custom backend required for the UI
- compatible with GitHub Pages and similar hosts

The only live dependency is browser access to Coinbase plus any optional webhook endpoint you configure.
