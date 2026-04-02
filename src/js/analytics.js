import { BACKTEST_HORIZONS, ANALYTIC_FRAMES } from "./config.js";
import {
  average,
  atr,
  buildVwap,
  clamp,
  ema,
  last,
  macd,
  mapRangeText,
  money,
  percentMove,
  plainNumber,
  regressionSlope,
  rsi,
  scoreClass,
  scoreLabel,
  signedPercent,
  sma,
  standardDeviation,
  sum,
  toNumber
} from "./utils.js";

const FRAME_WEIGHTS = {
  T5M: 0.22,
  T15M: 0.24,
  T1H: 0.29,
  T4H: 0.25
};

function materializeCandles(candles, livePrice) {
  const series = candles.map((candle) => ({ ...candle }));

  if (Number.isFinite(livePrice) && series.length) {
    const latest = series[series.length - 1];
    latest.close = livePrice;
    latest.high = Math.max(latest.high, livePrice);
    latest.low = Math.min(latest.low, livePrice);
  }

  return series;
}

export function computeOrderFlow(orderBook, liveTicks, price, now = Date.now()) {
  const recentTicks = liveTicks.filter((tick) => now - tick.ts <= 60000);
  const buyVolume = sum(recentTicks.filter((tick) => tick.side !== "sell").map((tick) => tick.size));
  const sellVolume = sum(recentTicks.filter((tick) => tick.side === "sell").map((tick) => tick.size));
  const delta = buyVolume - sellVolume;
  const total = buyVolume + sellVolume;
  const deltaPct = total ? delta / total : 0;
  const largestTrade = Math.max(0, ...recentTicks.map((tick) => tick.size || 0));
  const imbalance = Number.isFinite(orderBook.imbalance) ? orderBook.imbalance : 0.5;
  const microEdgeBps = Number.isFinite(orderBook.microprice) && Number.isFinite(price)
    ? ((orderBook.microprice - price) / price) * 10000
    : 0;
  const spreadBps = Number.isFinite(orderBook.spread) && Number.isFinite(price)
    ? (orderBook.spread / price) * 10000
    : 0;

  const flowScore = clamp(
    50 +
      (imbalance - 0.5) * 120 +
      deltaPct * 70 +
      microEdgeBps * 2.2 -
      spreadBps * 0.6 +
      (largestTrade >= 1 ? 5 : 0),
    0,
    100
  );

  let narrative = "Order flow is balanced.";
  if (flowScore >= 60) {
    narrative = `Bids are leading. Book imbalance is ${plainNumber(imbalance * 100, 0)}%, one-minute delta is ${plainNumber(delta, 4)} BTC, and the microprice is leaning above last trade.`;
  } else if (flowScore <= 40) {
    narrative = `Offers are pressing. Ask liquidity is heavier, one-minute delta is ${plainNumber(delta, 4)} BTC, and the microprice is leaning below last trade.`;
  } else if (largestTrade >= 1) {
    narrative = `The tape is mixed but block flow is active. Largest recent print was ${plainNumber(largestTrade, 4)} BTC.`;
  }

  return {
    buyVolume,
    sellVolume,
    delta,
    deltaPct,
    largestTrade,
    tapeSpeed: recentTicks.length,
    imbalance,
    microEdgeBps,
    spreadBps,
    flowScore,
    narrative
  };
}

export function analyzeFrame(candles, options = {}) {
  if (!Array.isArray(candles) || candles.length < 55) return null;

  const series = materializeCandles(candles, options.livePrice);
  const closes = series.map((candle) => candle.close);
  const highs = series.map((candle) => candle.high);
  const lows = series.map((candle) => candle.low);
  const volumes = series.map((candle) => candle.volume);

  const ema9Series = ema(closes, 9);
  const ema21Series = ema(closes, 21);
  const ema55Series = ema(closes, 55);
  const rsiSeries = rsi(closes, 14);
  const macdSeries = macd(closes);
  const atrSeries = atr(series, 14);
  const vwapSeries = buildVwap(series);

  const price = last(closes);
  const ema9Value = last(ema9Series);
  const ema21Value = last(ema21Series);
  const ema55Value = last(ema55Series);
  const rsiValue = last(rsiSeries);
  const macdHist = last(macdSeries.histogram);
  const atrValue = last(atrSeries);
  const vwapValue = last(vwapSeries);
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));
  const averageVolume20 = average(volumes.slice(-20));
  const currentVolume = last(volumes);
  const volumeImpulse = Number.isFinite(currentVolume) && Number.isFinite(averageVolume20) && averageVolume20
    ? currentVolume / averageVolume20
    : 1;

  const trendPct = percentMove(price, ema21Value) ?? 0;
  const emaSpreadPct = percentMove(ema9Value, ema21Value) ?? 0;
  const fastSlope = regressionSlope(closes.slice(-12));
  const slowSlope = regressionSlope(closes.slice(-34));
  const slopePct = Number.isFinite(fastSlope) && price ? (fastSlope / price) * 100 : 0;
  const driftPct = Number.isFinite(slowSlope) && price ? (slowSlope / price) * 100 : 0;
  const liveTickSlope = regressionSlope((options.liveTicks || []).slice(-30).map((tick) => tick.price)) || 0;
  const liveTickPct = price ? (liveTickSlope / price) * 100 : 0;
  const atrPct = Number.isFinite(atrValue) && price ? (atrValue / price) * 100 : 0;
  const breakoutDistance = Number.isFinite(atrValue) && atrValue > 0 ? (price - recentHigh) / atrValue : 0;
  const breakdownDistance = Number.isFinite(atrValue) && atrValue > 0 ? (recentLow - price) / atrValue : 0;
  const returns = closes
    .slice(-20)
    .map((value, index, array) => (index === 0 ? null : (value - array[index - 1]) / array[index - 1]))
    .slice(1);
  const realizedVolPct = (standardDeviation(returns) || 0) * 100;
  const macdPct = Number.isFinite(macdHist) && price ? (macdHist / price) * 100 : 0;
  const emaStackBias =
    (price > ema21Value ? 1 : -1) +
    (ema9Value > ema21Value ? 1 : -1) +
    (ema21Value > ema55Value ? 1 : -1) +
    (price > vwapValue ? 1 : -1);

  const trendScore = clamp(50 + trendPct * 18 + emaSpreadPct * 26 + driftPct * 125 + emaStackBias * 5, 0, 100);
  const momentumScore = clamp(50 + slopePct * 170 + liveTickPct * 220 + macdPct * 1800, 0, 100);
  let rsiScore = 50;

  if (rsiValue >= 52 && rsiValue <= 68) rsiScore = 74;
  else if (rsiValue > 68 && rsiValue <= 77) rsiScore = 60;
  else if (rsiValue > 77) rsiScore = 34;
  else if (rsiValue >= 40 && rsiValue < 52) rsiScore = 44;
  else if (rsiValue < 40) rsiScore = 26;

  const breakoutScore = clamp(50 + breakoutDistance * 18 - breakdownDistance * 14 + (volumeImpulse - 1) * 24, 0, 100);
  const volatilityScore = clamp(62 - atrPct * 18 + Math.abs(slopePct) * 90 + Math.abs(macdPct) * 1500, 0, 100);
  const flowAdjustment = options.orderFlow ? (options.orderFlow.flowScore - 50) * 0.24 : 0;

  const score = clamp(
    trendScore * 0.28 +
      momentumScore * 0.24 +
      rsiScore * 0.14 +
      breakoutScore * 0.2 +
      volatilityScore * 0.14 +
      flowAdjustment,
    0,
    100
  );

  const action = scoreLabel(score);
  const actionClass = scoreClass(score);
  const direction = score >= 58 ? 1 : score <= 42 ? -1 : 0;

  const bullishConfirmations = [
    trendScore >= 55,
    momentumScore >= 55,
    breakoutScore >= 55,
    rsiValue >= 50,
    ema9Value > ema21Value,
    ema21Value > ema55Value,
    price > vwapValue
  ].filter(Boolean).length;

  const bearishConfirmations = [
    trendScore <= 45,
    momentumScore <= 45,
    breakoutScore <= 45,
    rsiValue <= 50,
    ema9Value < ema21Value,
    ema21Value < ema55Value,
    price < vwapValue
  ].filter(Boolean).length;

  const confidence = clamp(
    34 + Math.abs(score - 50) * 1.15 + (direction >= 0 ? bullishConfirmations : bearishConfirmations) * 4 - atrPct * 3.2,
    18,
    97
  );

  let regime = "Balanced auction";
  if (score >= 70 && breakoutDistance > -0.2) regime = "Breakout acceleration";
  else if (score >= 58) regime = "Trend continuation";
  else if (score <= 30 && breakdownDistance > -0.2) regime = "Breakdown pressure";
  else if (atrPct < 0.45) regime = "Compression coil";
  else if (atrPct > 1.3) regime = "Wide volatility";

  return {
    score,
    action,
    actionClass,
    direction,
    confidence,
    regime,
    atrValue,
    atrPct,
    realizedVolPct,
    recentHigh,
    recentLow,
    ema9Value,
    ema21Value,
    ema55Value,
    vwapValue,
    rsiValue,
    macdHist,
    trendPct,
    liveTickPct,
    breakoutDistance,
    volumeImpulse,
    factors: [
      {
        label: "Trend stack",
        score: trendScore,
        detail: `Price is ${signedPercent(trendPct)} vs EMA 21, with EMA 9 / 21 spread at ${signedPercent(emaSpreadPct)} and VWAP relation intact.`
      },
      {
        label: "Momentum",
        score: momentumScore,
        detail: `Slope ${signedPercent(slopePct, 3)} per bar, live drift ${signedPercent(liveTickPct, 3)}, MACD impulse ${signedPercent(macdPct, 3)}.`
      },
      {
        label: "RSI state",
        score: rsiScore,
        detail: `RSI 14 sits at ${plainNumber(rsiValue, 1)} and reads ${mapRangeText(rsiScore)}.`
      },
      {
        label: "Breakout pressure",
        score: breakoutScore,
        detail: `BTC is ${money(price - recentHigh)} from the 20-bar high with volume impulse ${plainNumber(volumeImpulse, 2)}x.`
      },
      {
        label: "Volatility quality",
        score: volatilityScore,
        detail: `ATR is ${plainNumber(atrPct, 2)}% of price and realized move rate is ${plainNumber(realizedVolPct, 2)}%.`
      }
    ]
  };
}

export function combineSignals(frameSignals, orderFlow, chartSignal) {
  const rows = Object.entries(ANALYTIC_FRAMES)
    .map(([key, frame]) => ({ key, frame, signal: frameSignals[key] }))
    .filter((row) => row.signal);

  if (!rows.length) return null;

  const totalWeight = sum(rows.map((row) => FRAME_WEIGHTS[row.key] || 0.25)) || 1;
  const weightedScore = rows.reduce(
    (acc, row) => acc + row.signal.score * (FRAME_WEIGHTS[row.key] || 0.25),
    0
  ) / totalWeight;

  const bullish = rows.filter((row) => row.signal.direction > 0).length;
  const bearish = rows.filter((row) => row.signal.direction < 0).length;
  const neutral = rows.length - bullish - bearish;
  const orderFlowAdjustment = (orderFlow.flowScore - 50) * 0.22;
  const agreementBoost = bullish >= 3 ? 4 : bearish >= 3 ? -4 : 0;

  let score = clamp(weightedScore + orderFlowAdjustment + agreementBoost, 0, 100);
  if (bullish && bearish && Math.abs(bullish - bearish) <= 1) {
    score = (score + 50) / 2;
  }
  if (chartSignal && ((chartSignal.direction > 0 && bearish >= 3) || (chartSignal.direction < 0 && bullish >= 3))) {
    score = (score + 50) / 2;
  }

  let regime = "Balanced auction";
  if (bullish >= 3 && orderFlow.flowScore >= 55) regime = "Stacked long continuation";
  else if (bearish >= 3 && orderFlow.flowScore <= 45) regime = "Stacked short pressure";
  else if (bullish >= 2 && bearish <= 1) regime = "Higher-timeframe uptrend";
  else if (bearish >= 2 && bullish <= 1) regime = "Higher-timeframe downtrend";
  else if (chartSignal?.atrPct < 0.45) regime = "Compression coil";

  const action = scoreLabel(score);
  return {
    action,
    actionClass: scoreClass(score),
    score,
    confidence: clamp(
      40 + Math.abs(score - 50) * 1.1 + Math.max(bullish, bearish) * 5 + (orderFlow.flowScore >= 58 || orderFlow.flowScore <= 42 ? 4 : 0) - neutral * 4,
      22,
      97
    ),
    regime,
    bullish,
    bearish,
    neutral,
    rows,
    summary: `Alignment reads ${bullish} bullish, ${bearish} bearish, ${neutral} neutral. Order-flow score is ${plainNumber(orderFlow.flowScore, 0)}/100, so the combined desk bias is ${action.toLowerCase()}.`
  };
}

export function runBacktest(baseCandles, currentScore, currentDirection) {
  const warmup = 60;
  const maxBars = Math.max(...BACKTEST_HORIZONS.map((horizon) => horizon.bars));
  if (!Array.isArray(baseCandles) || baseCandles.length < warmup + maxBars + 10) return null;

  const signals = [];
  for (let index = warmup; index < baseCandles.length - maxBars; index += 1) {
    const analysis = analyzeFrame(baseCandles.slice(0, index + 1));
    if (!analysis || analysis.direction === 0) continue;

    signals.push({
      index,
      price: baseCandles[index].close,
      direction: analysis.direction,
      score: analysis.score
    });
  }

  const horizons = BACKTEST_HORIZONS.map((horizon) => {
    let sample = 0;
    let wins = 0;
    let returnSum = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let similarSample = 0;
    let similarWins = 0;

    signals.forEach((signal) => {
      const exit = baseCandles[signal.index + horizon.bars];
      if (!exit) return;

      const rawReturn = ((exit.close - signal.price) / signal.price) * 100;
      const signedReturn = rawReturn * signal.direction;
      sample += 1;
      returnSum += signedReturn;

      if (signedReturn >= 0) {
        wins += 1;
        grossWin += signedReturn;
      } else {
        grossLoss += Math.abs(signedReturn);
      }

      equity += signedReturn;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);

      if (Math.abs(signal.score - currentScore) <= 8 && (currentDirection === 0 || signal.direction === currentDirection)) {
        similarSample += 1;
        if (signedReturn >= 0) similarWins += 1;
      }
    });

    const winRate = sample ? (wins / sample) * 100 : null;
    const avgReturn = sample ? returnSum / sample : null;
    const profitFactor = grossLoss ? grossWin / grossLoss : grossWin ? 999 : null;

    return {
      label: horizon.label,
      sample,
      winRate,
      avgReturn,
      profitFactor,
      expectancy: avgReturn,
      maxDrawdown,
      currentWinRate: similarSample ? (similarWins / similarSample) * 100 : winRate,
      similarSample
    };
  });

  const primary = horizons.find((horizon) => horizon.label === "1h") || horizons[0];
  return {
    summary: {
      sample: primary?.sample ?? 0,
      winRate: primary?.winRate ?? null,
      avgReturn: primary?.avgReturn ?? null,
      profitFactor: primary?.profitFactor ?? null,
      expectancy: primary?.expectancy ?? null,
      maxDrawdown: primary?.maxDrawdown ?? null,
      currentWinRate: primary?.currentWinRate ?? null,
      similarSample: primary?.similarSample ?? 0
    },
    horizons
  };
}

export function sizePlay(entry, stop, target, accountSize, riskPct) {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
  if (!Number.isFinite(accountSize) || !Number.isFinite(riskPct)) return null;

  const stopDistance = Math.abs(entry - stop);
  if (!stopDistance) return null;

  const riskCapital = accountSize * (riskPct / 100);
  const sizeBtc = riskCapital / stopDistance;
  const notional = sizeBtc * entry;

  return {
    riskCapital,
    sizeBtc,
    notional,
    leverageNeeded: accountSize ? notional / accountSize : null,
    capitalUsagePct: accountSize ? (notional / accountSize) * 100 : null,
    rr: Math.abs(target - entry) / stopDistance
  };
}

export function buildRiskPlan(combined, chartSignal, settings, price) {
  if (!combined || !chartSignal || !Number.isFinite(price)) return null;

  const accountSize = toNumber(settings.accountSize);
  const riskPct = toNumber(settings.riskPct);
  const dailyLossPct = toNumber(settings.dailyLossPct);
  const dayPnl = toNumber(settings.dayPnl);
  const dailyStop = Number.isFinite(accountSize) && Number.isFinite(dailyLossPct)
    ? accountSize * (dailyLossPct / 100)
    : null;
  const locked = Number.isFinite(dayPnl) && Number.isFinite(dailyStop) ? dayPnl <= -dailyStop : false;

  const breakoutEntry = Number.isFinite(chartSignal.atrValue) ? chartSignal.recentHigh + chartSignal.atrValue * 0.12 : null;
  const pullbackEntry = Number.isFinite(chartSignal.atrValue) ? chartSignal.ema21Value - chartSignal.atrValue * 0.25 : null;
  const longStop = Number.isFinite(chartSignal.atrValue) ? chartSignal.ema21Value - chartSignal.atrValue * 1.05 : null;
  const longTarget = Number.isFinite(chartSignal.atrValue) ? price + chartSignal.atrValue * 1.9 : null;

  const sellEntry = Number.isFinite(chartSignal.atrValue) ? chartSignal.recentLow - chartSignal.atrValue * 0.12 : null;
  const sellStop = Number.isFinite(chartSignal.atrValue) ? chartSignal.ema21Value + chartSignal.atrValue * 0.95 : null;
  const sellTarget = Number.isFinite(chartSignal.atrValue) ? price - chartSignal.atrValue * 1.8 : null;

  const breakoutSizing = sizePlay(breakoutEntry, longStop, longTarget, accountSize, riskPct);
  const pullbackSizing = sizePlay(pullbackEntry, longStop, longTarget, accountSize, riskPct);
  const shortSizing = sizePlay(sellEntry, sellStop, sellTarget, accountSize, riskPct);

  return {
    accountSize,
    riskPct,
    dailyLossPct,
    dayPnl,
    dailyStop,
    locked,
    plays: [
      {
        title: "Breakout Long",
        tag: locked ? "Locked" : combined.action.includes("Buy") ? "Active" : "Standby",
        active: !locked && combined.action.includes("Buy"),
        entry: breakoutEntry,
        stop: longStop,
        target: longTarget,
        sizing: breakoutSizing,
        copy: "Take only if BTC clears resistance and holds the break. This is the fast-follow trade when the stack is aligned long."
      },
      {
        title: "Pullback Buy",
        tag: locked ? "Locked" : combined.action.includes("Buy") || combined.action === "Hold" ? "Watch" : "Low priority",
        active: !locked && (combined.action.includes("Buy") || combined.action === "Hold"),
        entry: pullbackEntry,
        stop: longStop,
        target: longTarget,
        sizing: pullbackSizing,
        copy: "Best when price cools into trend support without losing order-flow quality. The desk wants responsive bids, not slow drifts."
      },
      {
        title: "Defensive Sell",
        tag: locked ? "Locked" : combined.action.includes("Sell") ? "Active" : "Hedge",
        active: !locked && combined.action.includes("Sell"),
        entry: sellEntry,
        stop: sellStop,
        target: sellTarget,
        sizing: shortSizing,
        copy: "Use on failed structure when BTC breaks the short-term floor. This protects capital during liquidation-style moves."
      }
    ]
  };
}

export function buildForecast(combined, chartSignal, backtest, orderFlow, price) {
  if (!combined || !chartSignal || !Number.isFinite(price)) return [];

  const baseDriftPct = clamp(
    ((combined.score - 50) / 50) * 0.9 +
      chartSignal.trendPct * 0.4 +
      chartSignal.liveTickPct * 6 +
      orderFlow.deltaPct * 1.8,
    -3.4,
    3.4
  );

  return BACKTEST_HORIZONS.map((horizon) => {
    const stats = backtest?.horizons?.find((item) => item.label === horizon.label);
    const winRate = stats?.currentWinRate ?? stats?.winRate ?? 50;
    const winEdge = (winRate - 50) / 50;
    const movePct = clamp(baseDriftPct * horizon.scale + winEdge * 0.7, -5.5, 5.5);
    const projectedPrice = price * (1 + movePct / 100);
    const bandPct = clamp((chartSignal.atrPct || 0.45) * Math.sqrt(horizon.scale + 0.35) * 0.9, 0.18, 4.8);
    const range = projectedPrice * (bandPct / 100);

    return {
      label: horizon.label,
      note: horizon.note,
      movePct,
      projectedPrice,
      range,
      tone: movePct >= 0.35 ? "buy" : movePct <= -0.35 ? "sell" : "hold",
      probability: winRate,
      sample: stats?.similarSample ?? stats?.sample ?? 0
    };
  });
}

export function buildNotes(combined, orderFlow, backtest, riskPlan, forecast) {
  const notes = [];

  if (combined) {
    notes.push(`Stack alignment: ${combined.summary}`);
  }

  if (orderFlow) {
    notes.push(`Order flow: ${orderFlow.narrative}`);
  }

  if (backtest?.summary) {
    notes.push(`Backtest: the primary ${plainNumber(backtest.summary.currentWinRate, 0)}% hit rate comes from ${plainNumber(backtest.summary.similarSample, 0)} similar one-hour cases.`);
  }

  if (forecast?.[1]) {
    notes.push(`Scenario path: the ${forecast[1].label} desk call points to ${money(forecast[1].projectedPrice)} with ${plainNumber(forecast[1].probability, 0)}% historical follow-through.`);
  }

  if (riskPlan) {
    if (riskPlan.locked) {
      notes.push("Risk lockout: today's realized P/L is below the max daily loss guardrail, so no new trades should be opened until the next reset.");
    } else {
      notes.push(`Risk plan: daily stop is ${money(riskPlan.dailyStop)} and current per-trade risk is ${plainNumber(riskPlan.riskPct, 2)}% of account equity.`);
    }
  }

  return notes;
}
