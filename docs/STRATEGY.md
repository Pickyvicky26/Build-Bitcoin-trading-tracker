# Strategy Explanation

## Overview

Velocity Desk is a discretionary BTC/USD signal framework. It is not an execution bot and it is not pretending to be institutional alpha research. Its job is simpler: compress the workflow of an active trader into a browser-native desk that answers these questions fast:

1. What is BTC doing right now?
2. Are short and higher timeframes aligned?
3. Is order flow helping the move or fading it?
4. What have similar setups done recently?
5. How should size, stop, and target look if a trade is taken?

## Inputs

The current scratch rebuild consumes four practical input groups:

- seeded fallback BTC data so the desk is visible instantly
- Coinbase candles across chart and analytical timeframes
- Coinbase ticker and order-book state for spread and tape context
- user-defined risk and alert settings stored in browser local storage

## Analytical Frames

The strategy stack tracks:

- `T5M`
- `T15M`
- `T1H`
- `T4H`

Each frame is analyzed independently, then blended into a combined desk bias.

## Per-Frame Signal Logic

Each frame uses a lightweight but trader-readable score built from:

- EMA 8 versus EMA 21
- EMA 21 versus EMA 55
- RSI 14 location
- MACD histogram direction
- ATR pressure
- short regression slope
- recent range positioning
- optional order-flow tilt

Those inputs are compressed into a 0-100 score and mapped into:

- `Strong Buy`
- `Buy`
- `Hold`
- `Sell`
- `Strong Sell`

## Multi-Timeframe Combination

The desk combines frame scores using fixed weights:

- `T5M`: 20%
- `T15M`: 25%
- `T1H`: 30%
- `T4H`: 25%

That combined score is then adjusted by:

- book imbalance
- one-minute delta
- current order-flow pressure

This produces the top-level desk bias shown in the signal card, banner, forecast deck, and playbook.

## Order-Flow Layer

The current implementation keeps order flow intentionally lightweight:

- bid/ask imbalance
- one-minute delta from live ticks
- spread
- microprice proxy
- tape speed
- largest recent trade print

This is not a true high-frequency market-microstructure model. It is a fast trader-friendly confirmation layer.

## Backtest Layer

The rolling backtest works off the 5-minute base tape. It:

1. Replays signal logic after a warmup period.
2. Keeps only directional cases.
3. Evaluates forward outcomes at 15m, 1h, and 4h horizons.
4. Builds simple win-rate, average-return, drawdown, and sample-size context.
5. Biases toward cases with similar current score and direction.

The purpose is calibration, not scientific validation.

## Forecast Layer

Forecasts are scenario cards, not guarantees. Each horizon blends:

- current combined score
- ATR pressure
- order-flow edge
- horizon scaling
- backtest win-rate context

Each forecast outputs:

- projected price
- move percentage
- probability proxy
- trader note for the horizon

## Risk Framework

The risk layer turns the signal into a usable playbook using:

- account size
- risk per trade
- max daily loss
- current day P/L

From there, the desk derives:

- entry
- stop
- target
- stop distance
- reward/risk ratio
- BTC size
- notional exposure
- daily lockout state

## Journal And Alerts

The journal records signal changes and resolves them on a one-hour review horizon. Alerts can trigger on:

- buy-below threshold
- sell-above threshold
- optional desktop notification
- optional webhook queue relay

## Limitations

- This is heuristic and discretionary.
- Backtests are simplified and do not model slippage or fees.
- Coinbase-only data means no exchange aggregation.
- Browser persistence is convenient, but not hardened infrastructure.

## Next Steps If You Want To Push It Further

- port the model into Pine Script for chart-native overlays
- move journaling and alerts into a backend service
- upgrade order-flow inputs with deeper market-depth data
- add proper event storage and replay
- add walk-forward validation and transaction-cost assumptions
