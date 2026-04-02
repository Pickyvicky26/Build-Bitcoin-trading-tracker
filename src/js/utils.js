export const $ = (id) => document.getElementById(id);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function last(array) {
  return array[array.length - 1];
}

export function money(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "$--";

  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits
  });
}

export function compact(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";

  return num.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: digits
  });
}

export function plainNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function signedPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${num >= 0 ? "+" : ""}${num.toFixed(digits)}%`;
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function formatStamp(value) {
  return formatClock(value ? new Date(value) : new Date());
}

export function percentMove(now, then) {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return ((now - then) / then) * 100;
}

export function average(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function standardDeviation(values) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 2) return null;

  const mean = average(usable);
  const variance = usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
  return Math.sqrt(variance);
}

export function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

export function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    return average(values.slice(index + 1 - period, index + 1));
  });
}

export function ema(values, period) {
  if (!values.length) return [];

  const alpha = 2 / (period + 1);
  const output = [];
  let previous = values[0];

  values.forEach((value, index) => {
    if (index === 0) {
      output.push(value);
    } else {
      previous = value * alpha + previous * (1 - alpha);
      output.push(previous);
    }
  });

  return output;
}

export function rsi(values, period = 14) {
  if (values.length < 2) return [];

  const gains = [0];
  const losses = [0];

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? Math.abs(delta) : 0);
  }

  const avgGain = sma(gains, period);
  const avgLoss = sma(losses, period);

  return values.map((_, index) => {
    if (!Number.isFinite(avgGain[index]) || !Number.isFinite(avgLoss[index])) return null;
    if (avgLoss[index] === 0) return 100;

    const rs = avgGain[index] / avgLoss[index];
    return 100 - (100 / (1 + rs));
  });
}

export function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = ema(line, signalPeriod);
  const histogram = line.map((value, index) => value - signal[index]);

  return { line, signal, histogram };
}

export function atr(candles, period = 14) {
  const ranges = candles.map((candle, index) => {
    const prevClose = index === 0 ? candle.close : candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
  });

  return sma(ranges, period);
}

export function regressionSlope(values) {
  const usable = values.filter(Number.isFinite);
  const length = usable.length;

  if (length < 2) return null;

  const meanX = (length - 1) / 2;
  const meanY = average(usable);
  let numerator = 0;
  let denominator = 0;

  usable.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });

  return denominator ? numerator / denominator : null;
}

export function buildVwap(candles) {
  let cumulativeVolume = 0;
  let cumulativeNotional = 0;

  return candles.map((candle) => {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeVolume += candle.volume || 0;
    cumulativeNotional += typicalPrice * (candle.volume || 0);
    return cumulativeVolume ? cumulativeNotional / cumulativeVolume : typicalPrice;
  });
}

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function scoreClass(score) {
  if (score >= 74) return "strong-buy";
  if (score >= 58) return "buy";
  if (score >= 43) return "hold";
  if (score >= 26) return "sell";
  return "strong-sell";
}

export function scoreLabel(score) {
  if (score >= 74) return "Strong Buy";
  if (score >= 58) return "Buy";
  if (score >= 43) return "Hold";
  if (score >= 26) return "Sell";
  return "Strong Sell";
}

export function mapRangeText(value) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > 65) return "stacked long";
  if (value < 35) return "heavy offer";
  return "two-way";
}

export function actionTone(action) {
  if (String(action).includes("Buy")) return "buy";
  if (String(action).includes("Sell")) return "sell";
  return "hold";
}

export function syncInput(id, value) {
  const input = $(id);
  if (document.activeElement !== input) {
    input.value = value ?? "";
  }
}
