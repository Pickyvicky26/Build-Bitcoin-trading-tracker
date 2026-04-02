# Strategy Explanation

## Overview

Velocity Desk is a discretionary signal framework for BTC/USD. It is not an execution bot and it is not a fully statistical alpha model. The goal is to compress the workflow of an active trader into a browser-native decision surface that answers five questions quickly:

1. What is the market doing right now?
2. Is the move aligned across timeframes?
3. Is order flow confirming or fading the move?
4. What has happened historically in similar conditions?
5. How much risk should be deployed if a trade is taken?

## Inputs

The desk consumes four categories of inputs:

- Candle history from Coinbase across chart and analytical timeframes
- Live ticker updates from the Coinbase WebSocket feed
- Level 2 order-book snapshots for spread, imbalance, and microprice
- User-defined risk settings and alert thresholds stored in local state

## Timeframe Model

The analytical stack uses:

- `T5M`
- `T15M`
- `T1H`
- `T4H`

Each frame is scored independently, then blended into a combined bias. The selected chart timeframe is rendered separately for operator context.

## Per-Frame Signal Logic

Every analytical frame computes:

- EMA 9, EMA 21, and EMA 55 structure
- RSI 14 state
- MACD histogram impulse
- ATR-based volatility pressure
- VWAP relation
- Short-term slope and drift
- Breakout and breakdown distance versus the recent range
- Volume impulse versus a 20-bar baseline

These factors are compressed into a 0-100 frame score and translated into a desk-readable action:

- `Strong Buy`
- `Buy`
- `Hold`
- `Sell`
- `Strong Sell`

## Multi-Timeframe Combination

The combined signal applies fixed weights:

- `T5M`: 22%
- `T15M`: 24%
- `T1H`: 29%
- `T4H`: 25%

That weighted score is then adjusted by:

- Order-flow score
- Frame agreement boost
- A moderation pass when bullish and bearish counts are too balanced
- A moderation pass when the selected chart structure conflicts with stacked higher-timeframe direction

The result is the desk-wide bias shown in the hero panel and playbook.

## Order-Flow Layer

The order-flow read is intentionally lightweight and fast. It tracks:

- Bid/ask imbalance
- One-minute buy/sell delta
- Largest recent print
- Spread in basis points
- Microprice edge
- Top-of-book liquidity pressure

This becomes a separate `flowScore` which both informs the desk narrative and modifies the combined multi-timeframe score.

## Backtest Layer

The rolling backtest is run on the 5-minute base tape. It:

1. Replays historical frame analysis after a warmup period.
2. Records directional signals only when the model is non-neutral.
3. Measures future performance at 15m, 1h, and 4h horizons.
4. Computes sample size, win rate, average return, profit factor, and drawdown.
5. Separately tracks "similar" cases near the current signal score and direction.

This does not make the model predictive by itself, but it does force the signal engine to justify itself with historical context.

## Forecast Layer

Forecast cards are scenario projections rather than guaranteed predictions. They combine:

- Current combined score
- Trend and drift
- Live tape slope
- Order-flow delta
- Horizon-specific scaling
- Historical win-rate edge from similar backtest cases

Each card outputs:

- Projected price
- Move percentage
- Probability proxy
- Forecast band

## Risk Framework

The risk layer translates bias into actual trade structure:

- Account size
- Risk percentage per trade
- Daily loss limit
- Current day P/L

From there, the desk derives:

- Breakout long setup
- Pullback long setup
- Defensive sell setup

Each setup includes entry, stop, target, notional exposure, capital usage, leverage pressure, and reward-to-risk ratio. If day P/L breaches the configured daily stop, the desk enters lockout mode.

## Journal and Alerts

The journal records signal changes and resolves them on a one-hour review horizon. Alerts can fire on:

- Buy-below threshold
- Sell-above threshold
- Signal-state change
- Optional browser notification
- Optional webhook queue delivery

## Limitations

- The strategy is heuristic and discretionary, not a production-grade institutional model.
- Backtests are simplified and do not include slippage, fees, or full regime conditioning.
- Coinbase-only data means the desk is not exchange-aggregated.
- Browser persistence is convenient, but it is not a substitute for a hardened backend.

## If You Want to Push It Further

- Port the model logic into Pine Script for chart-native overlays and alerts
- Add exchange aggregation and higher-quality market-depth feeds
- Move alerts and journaling into a backend service
- Build proper event storage and replay for deeper research
- Add walk-forward validation and transaction-cost modeling
