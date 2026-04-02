# Velocity Desk

Velocity Desk is a hedge-fund-inspired Bitcoin trading terminal built for BTC/USD market monitoring, trader-style decision support, and portfolio presentation. It blends live Coinbase market data, multi-timeframe signal scoring, order-flow pressure, probabilistic scenario forecasts, backtest context, and structured risk overlays into a single static web app.

![Velocity Desk preview](./assets/velocity-desk-preview.svg)

## Hedge-Fund Style Project Description

Velocity Desk is designed to read like an internal crypto desk tool instead of a generic retail dashboard. The project packages a discretionary trading workflow into a browser-native execution cockpit:

- Live BTC/USD ticker, spread, tape, and market-state dashboard
- Multi-timeframe signal engine across 5m, 15m, 1h, and 4h structure
- Order-flow layer with imbalance, delta, spread, microprice, and large-print monitoring
- Rolling backtest stats and scenario forecasts for 15m, 1h, and 4h horizons
- Risk controls with position sizing, R/R, leverage pressure, and daily lockout logic
- Journal and alerting workflow for operational follow-through

This repo is intentionally portfolio-ready: clear structure, direct setup, strategy docs, architecture notes, and visual assets.

## Strategy Snapshot

![Strategy flow](./assets/strategy-flow.svg)

The signal stack is a browser implementation of a trader workflow:

1. Pull live candles, ticker stats, and order book snapshots from Coinbase.
2. Score each analytical timeframe using EMA structure, RSI, MACD, ATR, VWAP, drift, and breakout pressure.
3. Blend timeframe agreement with order-flow adjustment into a unified desk bias.
4. Contextualize that bias with rolling backtest hit rates and scenario forecasts.
5. Convert the active setup into a sized trade plan with daily risk guardrails.

Full details:

- [Strategy explanation](./docs/STRATEGY.md)
- [Architecture overview](./docs/ARCHITECTURE.md)

## Repo Structure

```text
.
├── assets/
│   ├── strategy-flow.svg
│   └── velocity-desk-preview.svg
├── docs/
│   ├── ARCHITECTURE.md
│   └── STRATEGY.md
├── src/
│   ├── js/
│   │   ├── analytics.js
│   │   ├── app.js
│   │   ├── config.js
│   │   ├── market-data.js
│   │   ├── render.js
│   │   ├── storage.js
│   │   └── utils.js
│   └── main.js
├── index.html
├── LICENSE
├── package.json
└── README.md
```

## Quick Start

### Option 1: Run a local static server

```bash
npm run dev
```

Then open [http://localhost:4173](http://localhost:4173).

### Option 2: Use Python directly

```bash
python3 -m http.server 4173
```

### Option 3: Open the file directly

`index.html` will render as a static page, but a local server is the safer option for module loading and hosting parity.

## Usage Examples

### Intraday breakout confirmation

- Watch for `Strong Buy` or `Buy` bias with 3 or more bullish timeframe confirmations.
- Confirm that order-flow imbalance and one-minute delta are positive.
- Use the active `Breakout Long` play for entry, stop, target, and sizing context.

### Pullback continuation setup

- Wait for a higher-timeframe uptrend with mixed short-term flow.
- Let the `Pullback Buy` setup define the mean-reversion entry around EMA support.
- Use the risk lab to keep the trade size capped to your configured risk budget.

### Defensive hedge workflow

- When the stack flips `Sell` and the order-flow turns offer-led, treat the `Defensive Sell` setup as the active hedge candidate.
- Use journal entries and the one-hour resolution cycle to inspect whether the desk bias is actually paying off.

## Deployment

Velocity Desk is a static site. It can be published to:

- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages
- Any basic web server

For GitHub Pages, push the repo, set the deployment source to the default branch, and publish from the repository root.

## Notes

- Alerts use browser notifications and an optional webhook relay. The webhook queue is client-side, so it still needs a real endpoint for delivery.
- Forecasts and signals are heuristic trading tools, not investment advice.
- The code is organized so the model logic can be ported later to Pine Script, Python, or a backend service if you want a more institutional pipeline.
