import { DISPLAY_FRAMES } from "./config.js";
import {
  $,
  actionTone,
  compact,
  formatStamp,
  money,
  plainNumber,
  signedPercent,
  syncInput
} from "./utils.js";

function findNearestIndex(candles, time) {
  let bestIndex = 0;
  let bestDiff = Infinity;

  candles.forEach((candle, index) => {
    const diff = Math.abs(candle.time - time);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function createRenderer({ state, getCurrentPrice, getEffectiveCandles }) {
  function updateFeedState() {
    $("feedDot").classList.toggle("live", state.wsConnected);
    $("feedStatus").textContent = state.wsConnected ? "Live" : "Polling";
  }

  function renderHero() {
    const price = getCurrentPrice();
    const open = state.stats.open;
    const high = state.stats.high;
    const low = state.stats.low;
    const changePct = open ? ((price - open) / open) * 100 : null;
    const changeEl = $("priceChange");
    const spread = Number.isFinite(state.ticker.bestAsk) && Number.isFinite(state.ticker.bestBid)
      ? state.ticker.bestAsk - state.ticker.bestBid
      : state.orderBook.spread;

    $("priceValue").textContent = money(price);
    changeEl.textContent = Number.isFinite(changePct) ? signedPercent(changePct) : "--";
    changeEl.className = `price-change ${Number.isFinite(changePct) ? (changePct >= 0 ? "buy" : "sell") : ""}`;
    $("bidValue").textContent = money(state.ticker.bestBid ?? state.orderBook.bids[0]?.price);
    $("askValue").textContent = money(state.ticker.bestAsk ?? state.orderBook.asks[0]?.price);
    $("spreadValue").textContent = Number.isFinite(spread) ? money(spread, 2) : "$--";
    $("volumeValue").textContent = Number.isFinite(state.stats.volume) ? `${compact(state.stats.volume, 2)} BTC` : "--";

    const combined = state.analytics?.combined;
    const chartSignal = state.analytics?.chartSignal;
    $("marketMode").textContent = combined?.regime || "Awaiting model";
    $("priceNarrative").textContent = Number.isFinite(price) && Number.isFinite(open)
      ? `BTC is ${signedPercent(changePct)} versus the 24-hour open, with a ${money((high || price) - (low || price))} daily range and ${money(spread, 2)} spread.`
      : "Waiting for the first market sync.";

    if (!combined || !chartSignal) return;

    $("signalPill").textContent = combined.action;
    $("signalPill").className = `signal-pill ${combined.actionClass}`;
    $("signalScore").textContent = `${plainNumber(combined.score, 0)}/100`;
    $("confidenceValue").textContent = `${plainNumber(combined.confidence, 0)}%`;
    $("signalMeterFill").style.width = `${combined.score}%`;
    $("signalNarrative").textContent = `${combined.summary} BTC is trading ${money(price - chartSignal.ema21Value)} versus EMA 21, while order-flow reads ${state.analytics.orderFlow.flowScore >= 58 ? "bid-led" : state.analytics.orderFlow.flowScore <= 42 ? "offer-led" : "mixed"}.`;
    $("atrValue").textContent = money(chartSignal.atrValue);
    $("volatilityValue").textContent = `${plainNumber(chartSignal.realizedVolPct, 2)}%`;
    $("rangeValue").textContent = Number.isFinite(high) && Number.isFinite(low) ? money(high - low) : "$--";
    $("tapeSpeedValue").textContent = `${state.analytics.orderFlow.tapeSpeed}/min`;
    $("riskMode").textContent = combined.regime;

    if (chartSignal.atrPct > 1.35) {
      $("riskNarrative").textContent = `Heat is high. ATR is ${plainNumber(chartSignal.atrPct, 2)}% of price, order-flow speed is ${state.analytics.orderFlow.tapeSpeed} ticks per minute, and size should be reduced.`;
    } else if (state.analytics.riskPlan?.locked) {
      $("riskNarrative").textContent = "Daily loss lockout is active. The desk keeps the playbook visible but new trades should stay off until the next reset.";
    } else {
      $("riskNarrative").textContent = `Risk is controlled. ${combined.regime} conditions are active with one-hour backtest edge at ${plainNumber(state.analytics.backtest?.summary?.currentWinRate, 0)}% and live order-flow score ${plainNumber(state.analytics.orderFlow.flowScore, 0)}/100.`;
    }
  }

  function renderChart() {
    const svg = $("priceChart");
    const candles = getEffectiveCandles(state.chartFrame, true);

    if (!candles.length) {
      svg.innerHTML = `<text x="500" y="180" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="18">Loading BTC candles...</text>`;
      $("chartSummary").textContent = "The chart will render once the desk has candle history.";
      return;
    }

    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const volumes = candles.map((candle) => candle.volume);
    const ema21Series = candles.map((_, index) => state.analytics?.chartSignal && index < candles.length ? null : null);
    const effectiveEma = state.analytics?.chartSignal ? [] : [];
    // The renderer rebuilds its own series for charting to keep the chart independent from model internals.
    let emaPrev = closes[0];
    const emaSeries = closes.map((value, index) => {
      if (index === 0) return value;
      emaPrev = value * (2 / (21 + 1)) + emaPrev * (1 - (2 / (21 + 1)));
      return emaPrev;
    });
    let cumulativeVolume = 0;
    let cumulativeNotional = 0;
    const vwapSeries = candles.map((candle) => {
      const typical = (candle.high + candle.low + candle.close) / 3;
      cumulativeVolume += candle.volume || 0;
      cumulativeNotional += typical * (candle.volume || 0);
      return cumulativeVolume ? cumulativeNotional / cumulativeVolume : typical;
    });

    const forecast = state.analytics?.forecast || [];
    const futurePoints = forecast.map((item) => item.projectedPrice);
    const activePlay = state.analytics?.riskPlan?.plays?.find((play) => play.active) || state.analytics?.riskPlan?.plays?.[0] || null;
    const journalMarkers = state.journal.filter((entry) => entry.createdAt >= candles[0].time && entry.createdAt <= candles[candles.length - 1].time);

    const allPrices = highs
      .concat(lows)
      .concat(emaSeries.filter(Number.isFinite))
      .concat(vwapSeries.filter(Number.isFinite))
      .concat(futurePoints)
      .concat([activePlay?.entry, activePlay?.stop, activePlay?.target].filter(Number.isFinite));

    const maxPrice = Math.max(...allPrices);
    const minPrice = Math.min(...allPrices);
    const pad = Math.max((maxPrice - minPrice) * 0.12, maxPrice * 0.005);
    const top = 26;
    const chartHeight = 240;
    const volumeTop = 286;
    const volumeHeight = 48;
    const left = 36;
    const liveRight = 826;
    const futureRight = 968;
    const bodyWidth = Math.max(3, ((liveRight - left) / Math.max(candles.length, 1)) * 0.55);
    const volumeMax = Math.max(...volumes, 1);

    const scaleY = (value) => top + chartHeight - ((value - (minPrice - pad)) / ((maxPrice + pad) - (minPrice - pad))) * chartHeight;
    const scaleX = (index) => left + (index / Math.max(candles.length - 1, 1)) * (liveRight - left);
    const scaleFutureX = (index) => liveRight + ((index + 1) / (futurePoints.length + 0.5)) * (futureRight - liveRight);

    const grid = [0, 0.25, 0.5, 0.75, 1].map((step) => {
      const y = top + chartHeight * step;
      return `<line x1="${left}" y1="${y}" x2="${futureRight}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1" />`;
    }).join("");

    const candleSvg = candles.map((candle, index) => {
      const x = scaleX(index);
      const wick = `<line x1="${x.toFixed(2)}" y1="${scaleY(candle.high).toFixed(2)}" x2="${x.toFixed(2)}" y2="${scaleY(candle.low).toFixed(2)}" stroke="${candle.close >= candle.open ? "#2be38c" : "#ff6a78"}" stroke-width="1.4" />`;
      const openY = scaleY(candle.open);
      const closeY = scaleY(candle.close);
      const rectY = Math.min(openY, closeY);
      const rectHeight = Math.max(Math.abs(openY - closeY), 1.6);
      return `${wick}<rect x="${(x - bodyWidth / 2).toFixed(2)}" y="${rectY.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" rx="2" fill="${candle.close >= candle.open ? "rgba(43,227,140,0.84)" : "rgba(255,106,120,0.84)"}" />`;
    }).join("");

    const buildPath = (series, scaleFn) => series
      .map((value, index) => `${index === 0 ? "M" : "L"} ${scaleFn(index).toFixed(2)} ${scaleY(value).toFixed(2)}`)
      .join(" ");

    const emaPath = buildPath(emaSeries, scaleX);
    const vwapPath = buildPath(vwapSeries, scaleX);
    const lastLiveX = scaleX(candles.length - 1);
    const lastLiveY = scaleY(closes[closes.length - 1]);
    const futurePath = futurePoints.length
      ? `M ${lastLiveX.toFixed(2)} ${lastLiveY.toFixed(2)} ${futurePoints.map((point, index) => `L ${scaleFutureX(index).toFixed(2)} ${scaleY(point).toFixed(2)}`).join(" ")}`
      : "";

    const volumeBars = candles.map((candle, index) => {
      const x = scaleX(index);
      const barHeight = (candle.volume / volumeMax) * volumeHeight;
      const y = volumeTop + (volumeHeight - barHeight);
      return `<rect x="${(x - bodyWidth / 2).toFixed(2)}" y="${y.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="2" fill="${candle.close >= candle.open ? "rgba(43,227,140,0.22)" : "rgba(255,106,120,0.2)"}" />`;
    }).join("");

    const guideLines = [activePlay?.entry, activePlay?.stop, activePlay?.target]
      .filter(Number.isFinite)
      .map((level, index) => {
        const color = index === 0 ? "rgba(95,168,255,0.35)" : index === 1 ? "rgba(255,106,120,0.28)" : "rgba(43,227,140,0.28)";
        return `<line x1="${left}" y1="${scaleY(level)}" x2="${futureRight}" y2="${scaleY(level)}" stroke="${color}" stroke-width="1" stroke-dasharray="6 6" />`;
      }).join("");

    const markerSvg = journalMarkers.map((entry) => {
      const index = findNearestIndex(candles, entry.createdAt);
      const x = scaleX(index);
      const y = scaleY(entry.price);
      const color = entry.action.includes("Buy") ? "#2be38c" : entry.action.includes("Sell") ? "#ff6a78" : "#f5b83d";
      const markerText = entry.action.includes("Buy") ? "B" : entry.action.includes("Sell") ? "S" : "H";
      return `<g><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.5" /><text x="${x.toFixed(2)}" y="${(y - 10).toFixed(2)}" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="11" font-family="IBM Plex Mono">${markerText}</text></g>`;
    }).join("");

    const lastForecast = forecast[forecast.length - 1];
    const forecastLabel = lastForecast
      ? `${lastForecast.label} ${money(lastForecast.projectedPrice)} ${signedPercent(lastForecast.movePct)} / ${plainNumber(lastForecast.probability, 0)}%`
      : "Forecast pending";

    svg.innerHTML = `
      <rect x="0" y="0" width="1000" height="360" fill="url(#panelFade)"></rect>
      <defs>
        <linearGradient id="panelFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.04)"></stop>
          <stop offset="100%" stop-color="rgba(255,255,255,0.01)"></stop>
        </linearGradient>
      </defs>
      ${grid}
      ${guideLines}
      ${candleSvg}
      <path d="${emaPath}" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
      <path d="${vwapPath}" fill="none" stroke="#f5b83d" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
      ${futurePath ? `<path d="${futurePath}" fill="none" stroke="${lastForecast && lastForecast.movePct >= 0 ? "#2be38c" : "#ff6a78"}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="8 8"></path>` : ""}
      ${markerSvg}
      ${volumeBars}
      <circle cx="${lastLiveX.toFixed(2)}" cy="${lastLiveY.toFixed(2)}" r="5.5" fill="#5fa8ff" stroke="#d8e8ff" stroke-width="2"></circle>
      <text x="${left}" y="18" fill="rgba(255,255,255,0.7)" font-size="13" font-family="IBM Plex Mono">HIGH ${money(maxPrice)}</text>
      <text x="${left}" y="274" fill="rgba(255,255,255,0.7)" font-size="13" font-family="IBM Plex Mono">LOW ${money(minPrice)}</text>
      <text x="${futureRight - 4}" y="18" text-anchor="end" fill="rgba(255,255,255,0.7)" font-size="13" font-family="IBM Plex Mono">${forecastLabel}</text>
      <text x="${futureRight - 4}" y="350" text-anchor="end" fill="rgba(255,255,255,0.45)" font-size="12" font-family="IBM Plex Mono">${DISPLAY_FRAMES[state.chartFrame].label}</text>
    `;

    const chartSignal = state.analytics?.chartSignal;
    $("chartSummary").textContent = chartSignal
      ? `BTC is trading between ${money(chartSignal.recentLow)} and ${money(chartSignal.recentHigh)} on the selected ${DISPLAY_FRAMES[state.chartFrame].label.toLowerCase()} view. VWAP sits at ${money(chartSignal.vwapValue)} and the active playbook is tracking ${activePlay ? activePlay.title.toLowerCase() : "the primary setup"}.`
      : `Showing ${DISPLAY_FRAMES[state.chartFrame].label.toLowerCase()} structure for BTC/USD.`;
  }

  function renderConfirmation() {
    const combined = state.analytics?.combined;
    if (!combined) {
      $("confirmationGrid").innerHTML = `<div class="empty">Timeframe confirmations will appear after the first sync.</div>`;
      $("confirmationSummary").textContent = "The desk is waiting for enough structure to stack confirmations.";
      return;
    }

    $("confirmationGrid").innerHTML = combined.rows.map((row) => `
      <div class="mtf-row">
        <strong>${row.frame.display}</strong>
        <span class="status-badge ${actionTone(row.signal.action)}">${row.signal.action}</span>
        <div><span class="metric-label">Score</span><strong>${plainNumber(row.signal.score, 0)}/100</strong></div>
        <div><span class="metric-label">Confidence</span><strong>${plainNumber(row.signal.confidence, 0)}%</strong></div>
      </div>
    `).join("");

    $("confirmationSummary").textContent = combined.summary;
  }

  function renderOrderFlow() {
    const flow = state.analytics?.orderFlow;
    if (!flow) {
      $("flowGrid").innerHTML = `<div class="empty">Order-flow metrics will appear after the first book snapshot.</div>`;
      $("flowNarrative").textContent = "Waiting for bid, ask, delta, and liquidity skew.";
      return;
    }

    $("flowGrid").innerHTML = [
      { label: "Bid / Ask Imbalance", value: `${plainNumber(flow.imbalance * 100, 0)}%` },
      { label: "1m Delta", value: `${plainNumber(flow.delta, 4)} BTC` },
      { label: "Microprice Edge", value: `${plainNumber(flow.microEdgeBps, 1)} bps` },
      { label: "Spread", value: `${plainNumber(flow.spreadBps, 1)} bps` },
      { label: "1 BTC Impact", value: `${money((state.orderBook.impactBuy1 || 0) + (state.orderBook.impactSell1 || 0), 2)}` },
      { label: "Largest Trade", value: `${plainNumber(flow.largestTrade, 4)} BTC` }
    ].map((item) => `
      <div class="board-card">
        <span>${item.label}</span>
        <strong>${item.value}</strong>
      </div>
    `).join("");

    $("flowNarrative").textContent = flow.narrative;
  }

  function renderForecast() {
    const forecast = state.analytics?.forecast || [];
    if (!forecast.length) {
      $("forecastGrid").innerHTML = `<div class="empty">Waiting for enough history to build forecast scenarios.</div>`;
      return;
    }

    $("forecastGrid").innerHTML = forecast.map((item) => `
      <article class="forecast-card ${item.tone}">
        <div class="section-meta">${item.label}</div>
        <strong>${money(item.projectedPrice)}</strong>
        <div class="move ${item.tone === "buy" ? "up" : item.tone === "sell" ? "down" : "flat"}">${signedPercent(item.movePct)}</div>
        <div class="note">${item.note}. Hit rate ${plainNumber(item.probability, 0)}% across ${plainNumber(item.sample, 0)} similar signals. Range band ${money(item.projectedPrice - item.range)} to ${money(item.projectedPrice + item.range)}.</div>
      </article>
    `).join("");
  }

  function renderBacktest() {
    const backtest = state.analytics?.backtest;
    if (!backtest) {
      $("backtestSummary").innerHTML = `<div class="empty">Backtest stats will load after the first market sync.</div>`;
      $("probabilityList").innerHTML = `<div class="empty">Historical outcome rows will appear here.</div>`;
      return;
    }

    $("backtestSummary").innerHTML = [
      { label: "Primary Win Rate", value: `${plainNumber(backtest.summary.currentWinRate, 0)}%` },
      { label: "Avg Return", value: signedPercent(backtest.summary.avgReturn || 0) },
      { label: "Profit Factor", value: plainNumber(backtest.summary.profitFactor, 2) },
      { label: "Max Drawdown", value: `${plainNumber(backtest.summary.maxDrawdown, 2)} pts` }
    ].map((item) => `
      <div class="backtest-stat">
        <span>${item.label}</span>
        <strong>${item.value}</strong>
      </div>
    `).join("");

    $("probabilityList").innerHTML = backtest.horizons.map((horizon) => `
      <div class="probability-row">
        <strong>${horizon.label}</strong>
        <div><span>Hit Rate</span><strong>${plainNumber(horizon.currentWinRate, 0)}%</strong></div>
        <div><span>Avg Return</span><strong>${signedPercent(horizon.avgReturn || 0)}</strong></div>
        <div><span>Sample</span><strong>${plainNumber(horizon.sample, 0)}</strong></div>
        <div><span>Similar Cases</span><strong>${plainNumber(horizon.similarSample, 0)}</strong></div>
      </div>
    `).join("");
  }

  function renderFactors() {
    const factors = state.analytics?.factors || [];
    $("factorHint").textContent = `${plainNumber(factors.length, 0)}-input stack`;

    if (!factors.length) {
      $("factorList").innerHTML = `<div class="empty">Factors will populate after the first model pass.</div>`;
      return;
    }

    $("factorList").innerHTML = factors.map((factor) => `
      <article class="factor">
        <div class="factor-head">
          <span>${factor.label}</span>
          <span>${plainNumber(factor.score, 0)}/100</span>
        </div>
        <div class="factor-bar">
          <div class="factor-fill" style="width:${factor.score}%"></div>
        </div>
        <div class="factor-note">${factor.detail}</div>
      </article>
    `).join("");
  }

  function renderPlaybook() {
    const plays = state.analytics?.riskPlan?.plays || [];
    if (!plays.length) {
      $("playbookGrid").innerHTML = `<div class="empty">The playbook needs a live structure read first.</div>`;
      return;
    }

    $("playbookGrid").innerHTML = plays.map((play) => {
      const sizing = play.sizing;
      const sizeLine = sizing
        ? `Size ${plainNumber(sizing.sizeBtc, 4)} BTC | Notional ${money(sizing.notional)} | R/R ${plainNumber(sizing.rr, 2)}`
        : "Enter account and risk settings to size this setup.";

      return `
        <article class="play ${play.active ? "active" : ""}">
          <div class="play-title">
            <span>${play.title}</span>
            <span class="play-tag">${play.tag}</span>
          </div>
          <div class="play-grid">
            <div>
              <span>Entry</span>
              <strong>${money(play.entry)}</strong>
            </div>
            <div>
              <span>Stop</span>
              <strong>${money(play.stop)}</strong>
            </div>
            <div>
              <span>Target</span>
              <strong>${money(play.target)}</strong>
            </div>
          </div>
          <div class="play-copy">${play.copy} ${sizeLine}</div>
        </article>
      `;
    }).join("");
  }

  function renderRiskLab() {
    syncInput("accountSizeInput", state.settings.accountSize);
    syncInput("riskPctInput", state.settings.riskPct);
    syncInput("dailyLossPctInput", state.settings.dailyLossPct);
    syncInput("dayPnlInput", state.settings.dayPnl);

    const riskPlan = state.analytics?.riskPlan;
    if (!riskPlan) {
      $("riskPlanSummary").textContent = "Set account and risk values to turn the playbook into sized trades.";
      $("riskSizingGrid").innerHTML = `<div class="empty">Risk sizing metrics will appear here.</div>`;
      return;
    }

    const activePlay = riskPlan.plays.find((play) => play.active) || riskPlan.plays[0];
    const activeSizing = activePlay?.sizing;

    $("riskPlanSummary").textContent = riskPlan.locked
      ? `Risk lockout is active. Daily stop is ${money(riskPlan.dailyStop)} and realized P/L is ${money(riskPlan.dayPnl)}.`
      : `Per-trade risk is ${plainNumber(riskPlan.riskPct, 2)}% of account equity. Daily stop sits at ${money(riskPlan.dailyStop)} and the active setup is ${activePlay?.title.toLowerCase()}.`;

    $("riskSizingGrid").innerHTML = [
      { label: "Risk Capital", value: activeSizing ? money(activeSizing.riskCapital) : "$--" },
      { label: "Suggested Size", value: activeSizing ? `${plainNumber(activeSizing.sizeBtc, 4)} BTC` : "--" },
      { label: "Notional", value: activeSizing ? money(activeSizing.notional) : "$--" },
      { label: "Capital Use", value: activeSizing ? `${plainNumber(activeSizing.capitalUsagePct, 1)}%` : "--" },
      { label: "Leverage Need", value: activeSizing ? `${plainNumber(Math.max(activeSizing.leverageNeeded || 1, 1), 2)}x` : "--" },
      { label: "Today's P/L", value: money(riskPlan.dayPnl) }
    ].map((item) => `
      <div class="risk-stat">
        <span>${item.label}</span>
        <strong>${item.value}</strong>
      </div>
    `).join("");
  }

  function renderAlerts() {
    syncInput("buyBelowInput", state.settings.buyBelow);
    syncInput("sellAboveInput", state.settings.sellAbove);
    syncInput("webhookUrlInput", state.settings.webhookUrl);
    $("notificationsToggle").classList.toggle("active", state.settings.notifications);
    $("soundToggle").classList.toggle("active", state.settings.sound);
    $("signalAlertsToggle").classList.toggle("active", state.settings.signalAlerts);
    $("webhookToggle").classList.toggle("active", state.settings.webhookEnabled);

    const parts = [];
    if (state.settings.buyBelow) parts.push(`Buy below ${money(state.settings.buyBelow)}`);
    if (state.settings.sellAbove) parts.push(`Sell above ${money(state.settings.sellAbove)}`);
    if (state.settings.notifications) parts.push("Browser notifications on.");
    if (state.settings.sound) parts.push("Sound cue on.");
    if (state.settings.webhookEnabled) parts.push(`Webhook queue ${plainNumber(state.alertOutbox.length, 0)} pending.`);
    if (state.alertHistory[0]?.deliveredAt) parts.push(`Last delivery ${formatStamp(state.alertHistory[0].deliveredAt)}.`);
    if (!parts.length) parts.push("No thresholds armed yet.");
    $("alertStatus").textContent = parts.join(" ");
  }

  function renderTape() {
    if (!state.logs.length) {
      $("tapeList").innerHTML = `<div class="empty">The desk log is waiting for the first event.</div>`;
      return;
    }

    $("tapeList").innerHTML = state.logs.slice(0, 18).map((entry) => `
      <div class="tape-line ${entry.tone}">
        <div>${entry.message}</div>
        <time>${formatStamp(entry.time)}</time>
      </div>
    `).join("");
  }

  function renderNotes() {
    if (!state.notes.length) {
      $("notesList").innerHTML = `<div class="empty">Notes will appear after the desk scores the market.</div>`;
      return;
    }

    $("notesList").innerHTML = state.notes.map((note) => `<div class="note-line">${note}</div>`).join("");
  }

  function renderJournal() {
    if (!state.journal.length) {
      $("journalList").innerHTML = `<div class="empty">Signal changes and outcomes will be recorded here.</div>`;
      return;
    }

    $("journalList").innerHTML = state.journal.map((entry) => `
      <article class="journal-entry">
        <div class="journal-head">
          <div>
            <strong>${entry.action} at ${money(entry.price)}</strong>
            <time>${formatStamp(entry.createdAt)} | ${entry.regime || "Awaiting regime"}</time>
          </div>
          <span class="journal-pill ${entry.status}">${entry.status === "open" ? "Open" : entry.status === "hold" ? "Hold" : entry.status}</span>
        </div>
        <div class="journal-metrics">
          <div>
            <span>Score</span>
            <strong>${plainNumber(entry.score, 0)}/100</strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>${plainNumber(entry.confidence, 0)}%</strong>
          </div>
          <div>
            <span>Projected 1h</span>
            <strong>${money(entry.projectedPrice)}</strong>
          </div>
          <div>
            <span>Outcome</span>
            <strong>${entry.status === "open" ? `Due ${formatStamp(entry.resolveAt)}` : signedPercent(entry.realizedMovePct || 0)}</strong>
          </div>
        </div>
        <div class="journal-note">${entry.status === "open" ? "Awaiting one-hour evaluation from the 5m tape." : `Resolved at ${money(entry.exitPrice)} on ${formatStamp(entry.resolvedAt)} with raw market move ${signedPercent(entry.marketMovePct || 0)}.`}</div>
      </article>
    `).join("");
  }

  function renderTimeframeButtons() {
    document.querySelectorAll("[data-timeframe]").forEach((button) => {
      button.classList.toggle("active", button.dataset.timeframe === state.chartFrame);
    });
  }

  function renderAll() {
    updateFeedState();
    renderHero();
    renderChart();
    renderConfirmation();
    renderOrderFlow();
    renderForecast();
    renderBacktest();
    renderFactors();
    renderPlaybook();
    renderRiskLab();
    renderAlerts();
    renderNotes();
    renderJournal();
    renderTimeframeButtons();
  }

  return {
    renderAll,
    renderTape,
    renderNotes,
    renderJournal,
    renderAlerts,
    renderRiskLab,
    updateFeedState
  };
}
