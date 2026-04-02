import {
  ANALYTICS_DELAY_MS,
  BACKTEST_HORIZONS,
  BOOK_REFRESH_MS,
  DISPLAY_FRAMES,
  JOURNAL_HORIZON_MS,
  MAX_LOGS,
  MAX_TICKS,
  OUTBOX_REFRESH_MS,
  getFrameConfig,
  getRequiredFrameKeys
} from "./config.js";
import {
  $,
  actionTone,
  clamp,
  formatClock,
  money,
  percentMove,
  plainNumber,
  toNumber
} from "./utils.js";
import { buildInitialState, loadPersistedState, persistState } from "./storage.js";
import { fetchBook, fetchFrameCandles, fetchStats, openTickerFeed } from "./market-data.js";
import {
  analyzeFrame,
  buildForecast,
  buildNotes,
  buildRiskPlan,
  combineSignals,
  computeOrderFlow,
  runBacktest
} from "./analytics.js";
import { createRenderer } from "./render.js";

export function createApp() {
  const persisted = loadPersistedState();
  const state = buildInitialState(persisted);

  const renderer = createRenderer({
    state,
    getCurrentPrice,
    getEffectiveCandles
  });

  function currentPrice() {
    return Number.isFinite(state.ticker.price)
      ? state.ticker.price
      : state.frames[state.chartFrame]?.at(-1)?.close ?? state.frames.T5M?.at(-1)?.close ?? null;
  }

  function getEffectiveCandles(frameKey, includeLive = true) {
    const source = state.frames[frameKey];
    if (!Array.isArray(source) || !source.length) return [];

    const candles = source.map((candle) => ({ ...candle }));
    const price = includeLive ? currentPrice() : null;

    if (Number.isFinite(price)) {
      const latest = candles[candles.length - 1];
      latest.close = price;
      latest.high = Math.max(latest.high, price);
      latest.low = Math.min(latest.low, price);
      latest.volume = Math.max(latest.volume || 0, state.ticker.lastSize || 0);
    }

    return candles;
  }

  function updateLastSync(reason) {
    const now = state.lastSync ? new Date(state.lastSync) : new Date();
    const suffix = reason === "manual" ? "manual" : reason === "boot" ? "boot" : "sync";
    $("lastSync").textContent = `${formatClock(now)} ${suffix}`;
  }

  function pushLog(message, tone = "info") {
    const latest = state.logs[0];
    if (latest && latest.message === message) return;

    state.logs.unshift({
      message,
      tone,
      time: Date.now()
    });

    if (state.logs.length > MAX_LOGS) {
      state.logs.length = MAX_LOGS;
    }

    renderer.renderTape();
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function playTone(kind) {
    if (!state.settings.sound) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    if (!state.audioContext) {
      state.audioContext = new AudioContextCtor();
    }

    const context = state.audioContext;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "sell" ? "sawtooth" : "triangle";
    oscillator.frequency.value = kind === "sell" ? 220 : kind === "warn" ? 340 : 520;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  async function sendNotification(message) {
    if (!state.settings.notifications || !("Notification" in window)) return;

    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }

    if (Notification.permission === "granted") {
      new Notification("Velocity Desk", { body: message });
    }
  }

  function queueWebhookDelivery(payload) {
    if (!state.settings.webhookEnabled || !state.settings.webhookUrl) return;

    state.alertOutbox.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: Date.now(),
      attempts: 0,
      payload
    });
    state.alertOutbox = state.alertOutbox.slice(0, 40);
    persistState(state);
    flushOutbox();
  }

  async function flushOutbox() {
    if (state.flushingOutbox) return;
    if (!state.settings.webhookEnabled || !state.settings.webhookUrl || !state.alertOutbox.length) return;

    state.flushingOutbox = true;
    const nextQueue = [];
    const pending = [...state.alertOutbox].reverse();

    for (const item of pending) {
      try {
        const response = await fetch(state.settings.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload)
        });

        if (!response.ok) throw new Error(`Webhook status ${response.status}`);

        state.alertHistory.unshift({
          ...item.payload,
          deliveredAt: Date.now()
        });
      } catch (error) {
        nextQueue.unshift({
          ...item,
          attempts: (item.attempts || 0) + 1,
          lastTriedAt: Date.now(),
          lastError: error.message
        });
      }
    }

    state.alertOutbox = nextQueue.slice(0, 40);
    state.alertHistory = state.alertHistory.slice(0, 20);
    state.flushingOutbox = false;
    persistState(state);
    renderer.renderAlerts();
  }

  function issueAlert(message, tone = "buy", meta = {}) {
    pushLog(message, tone === "sell" ? "sell" : tone === "warn" ? "warn" : "buy");
    showToast(message);
    playTone(tone);
    sendNotification(message);

    queueWebhookDelivery({
      source: "velocity-desk",
      tone,
      message,
      createdAt: new Date().toISOString(),
      price: currentPrice(),
      signal: state.analytics?.combined?.action ?? null,
      score: state.analytics?.combined?.score ?? null,
      meta
    });
  }

  function resolveJournalEntries() {
    const base = state.frames.T5M;
    if (!Array.isArray(base) || !base.length) return;

    let changed = false;
    state.journal = state.journal.map((entry) => {
      if (entry.status !== "open" || Date.now() < entry.resolveAt) return entry;

      const exit = base.find((candle) => candle.time >= entry.resolveAt);
      if (!exit) return entry;

      const direction = entry.action.includes("Buy") ? 1 : entry.action.includes("Sell") ? -1 : 0;
      const marketMovePct = percentMove(exit.close, entry.price) ?? 0;
      const realizedMovePct = marketMovePct * (direction || 0);
      changed = true;

      return {
        ...entry,
        status: direction === 0 ? "hold" : realizedMovePct >= 0 ? "win" : "loss",
        resolvedAt: exit.time,
        exitPrice: exit.close,
        marketMovePct,
        realizedMovePct
      };
    });

    if (changed) persistState(state);
  }

  function appendJournalEntry(combined, forecast) {
    if (!combined || state.lastJournalSignal === combined.action) return;

    const price = currentPrice();
    if (!Number.isFinite(price)) return;

    state.lastJournalSignal = combined.action;
    state.journal.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: Date.now(),
      resolveAt: Date.now() + JOURNAL_HORIZON_MS,
      action: combined.action,
      score: combined.score,
      confidence: combined.confidence,
      price,
      regime: combined.regime,
      projectedPrice: forecast?.[1]?.projectedPrice ?? null,
      status: "open"
    });
    state.journal = state.journal.slice(0, 24);
    persistState(state);
  }

  function processAlerts() {
    const price = currentPrice();
    const combined = state.analytics?.combined;
    if (!Number.isFinite(price) || !combined) return;

    const buyBelow = toNumber(state.settings.buyBelow);
    const sellAbove = toNumber(state.settings.sellAbove);

    if (Number.isFinite(buyBelow)) {
      if (price <= buyBelow && !state.alertFlags.buyBelow) {
        state.alertFlags.buyBelow = true;
        issueAlert(`Buy zone triggered: BTC tagged ${money(price)} below ${money(buyBelow)}.`, "buy", {
          type: "price-threshold",
          threshold: buyBelow
        });
      } else if (price > buyBelow * 1.004) {
        state.alertFlags.buyBelow = false;
      }
    }

    if (Number.isFinite(sellAbove)) {
      if (price >= sellAbove && !state.alertFlags.sellAbove) {
        state.alertFlags.sellAbove = true;
        issueAlert(`Sell zone triggered: BTC traded ${money(price)} above ${money(sellAbove)}.`, "sell", {
          type: "price-threshold",
          threshold: sellAbove
        });
      } else if (price < sellAbove * 0.996) {
        state.alertFlags.sellAbove = false;
      }
    }

    if (state.settings.signalAlerts) {
      if (state.alertFlags.signalKey && state.alertFlags.signalKey !== combined.action) {
        issueAlert(`Desk bias changed from ${state.alertFlags.signalKey} to ${combined.action}.`, actionTone(combined.action), {
          type: "signal-change"
        });
      }

      state.alertFlags.signalKey = combined.action;
      persistState(state);
    }
  }

  function rebuildDesk() {
    const price = currentPrice();
    const orderFlow = computeOrderFlow(state.orderBook, state.liveTicks, price);
    const frameSignals = {};

    Object.keys(state.frames)
      .filter((key) => key.startsWith("T"))
      .forEach((key) => {
        const signal = analyzeFrame(getEffectiveCandles(key, true), {
          livePrice: price,
          liveTicks: key === "T5M" ? state.liveTicks : [],
          orderFlow: key === "T5M" ? orderFlow : null
        });

        if (signal) frameSignals[key] = signal;
      });

    const chartSignal = analyzeFrame(getEffectiveCandles(state.chartFrame, true), {
      livePrice: price,
      liveTicks: state.liveTicks,
      orderFlow
    });

    if (!chartSignal && !Object.keys(frameSignals).length) {
      state.analytics = null;
      state.notes = [];
      queueRender();
      return;
    }

    const combined = combineSignals(frameSignals, orderFlow, chartSignal);
    const currentDirection = combined?.score >= 58 ? 1 : combined?.score <= 42 ? -1 : 0;
    const backtest = state.backtestDirty
      ? runBacktest(state.frames.T5M, combined?.score ?? 50, currentDirection)
      : state.analytics?.backtest ?? runBacktest(state.frames.T5M, combined?.score ?? 50, currentDirection);
    const forecast = buildForecast(combined, chartSignal, backtest, orderFlow, price);
    const riskPlan = buildRiskPlan(combined, chartSignal, state.settings, price);
    const factors = [
      ...(combined ? [{
        label: "Multi-timeframe alignment",
        score: combined.score,
        detail: `${combined.bullish} bullish frames, ${combined.bearish} bearish frames, ${combined.neutral} neutral frames.`
      }] : []),
      ...(chartSignal?.factors || []),
      {
        label: "Order-flow pressure",
        score: orderFlow.flowScore,
        detail: `Book imbalance ${plainNumber(orderFlow.imbalance * 100, 0)}%, one-minute delta ${plainNumber(orderFlow.delta, 4)} BTC, largest trade ${plainNumber(orderFlow.largestTrade, 4)} BTC.`
      },
      ...(backtest ? [{
        label: "Backtest edge",
        score: backtest.summary.currentWinRate ?? 50,
        detail: `Similar one-hour cases won ${plainNumber(backtest.summary.currentWinRate, 0)}% of the time across ${plainNumber(backtest.summary.similarSample, 0)} matches.`
      }] : [])
    ].slice(0, 8);

    state.analytics = {
      combined,
      chartSignal,
      frameSignals,
      orderFlow,
      backtest,
      forecast,
      riskPlan,
      factors
    };
    state.notes = buildNotes(combined, orderFlow, backtest, riskPlan, forecast);
    state.backtestDirty = false;

    appendJournalEntry(combined, forecast);
    resolveJournalEntries();
    processAlerts();
    queueRender();
  }

  function scheduleAnalytics(force = false) {
    if (force) {
      if (state.analyticsTimer) clearTimeout(state.analyticsTimer);
      state.analyticsTimer = null;
      rebuildDesk();
      return;
    }

    if (state.analyticsTimer) return;
    state.analyticsTimer = setTimeout(() => {
      state.analyticsTimer = null;
      rebuildDesk();
    }, ANALYTICS_DELAY_MS);
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      renderer.renderAll();
    });
  }

  function connectFeed() {
    if (state.ws) {
      const previousSocket = state.ws;
      state.ws = null;
      previousSocket.close();
    }

    const socket = openTickerFeed({
      onOpen(activeSocket) {
        if (state.ws !== activeSocket) return;
        state.wsConnected = true;
        renderer.updateFeedState();
        pushLog("Coinbase feed connected.", "info");
      },
      onMessage(message, activeSocket) {
        if (state.ws !== activeSocket) return;
        if (message.type !== "ticker" || message.product_id !== "BTC-USD") return;

        const price = toNumber(message.price);
        if (!Number.isFinite(price)) return;

        const previousPrice = state.ticker.price;
        state.ticker.price = price;
        state.ticker.bestBid = toNumber(message.best_bid) ?? state.ticker.bestBid;
        state.ticker.bestAsk = toNumber(message.best_ask) ?? state.ticker.bestAsk;
        state.ticker.lastSize = toNumber(message.last_size) ?? state.ticker.lastSize;
        state.ticker.side = message.side || state.ticker.side;
        state.ticker.time = message.time || Date.now();

        state.liveTicks.push({
          ts: Date.now(),
          price,
          side: message.side || "buy",
          size: toNumber(message.last_size) || 0
        });

        if (state.liveTicks.length > MAX_TICKS) {
          state.liveTicks.splice(0, state.liveTicks.length - MAX_TICKS);
        }

        const move = Number.isFinite(previousPrice) ? percentMove(price, previousPrice) : null;
        if (Number.isFinite(move) && Math.abs(move) >= 0.12) {
          pushLog(`Fast move ${move >= 0 ? "+" : ""}${move.toFixed(2)}% to ${money(price)}.`, move > 0 ? "buy" : "sell");
        } else if ((toNumber(message.last_size) || 0) >= 1.25) {
          pushLog(`Block tape: ${plainNumber(message.last_size, 4)} BTC ${message.side || "trade"} at ${money(price)}.`, message.side === "sell" ? "sell" : "buy");
        }

        queueRender();
        scheduleAnalytics();
      },
      onError(activeSocket) {
        if (state.ws !== activeSocket) return;
        pushLog("Feed error. Falling back to scheduled sync until reconnect.", "error");
      },
      onClose(activeSocket) {
        if (state.ws !== activeSocket) return;
        state.ws = null;
        state.wsConnected = false;
        renderer.updateFeedState();
        pushLog("Feed disconnected. Reconnecting in 4 seconds.", "warn");
        setTimeout(connectFeed, 4000);
      }
    });

    state.ws = socket;
  }

  async function syncBook(reason = "scheduled") {
    try {
      state.orderBook = await fetchBook();
      scheduleAnalytics();
      queueRender();

      if (reason === "manual") {
        pushLog("Order book refreshed.", "info");
      }
    } catch (error) {
      if (reason === "manual") {
        pushLog(error.message || "Order book refresh failed.", "error");
      }
    } finally {
      scheduleBookRefresh();
    }
  }

  async function syncMarket(reason = "scheduled") {
    try {
      const frameKeys = getRequiredFrameKeys(state.chartFrame);
      const [frameData, overview, book] = await Promise.all([
        Promise.all(frameKeys.map(async (key) => ({
          key,
          candles: await fetchFrameCandles(getFrameConfig(key))
        }))),
        fetchStats(),
        fetchBook()
      ]);

      frameData.forEach(({ key, candles }) => {
        state.frames[key] = candles;
      });

      state.ticker.price = toNumber(overview.ticker.price) ?? state.ticker.price;
      state.ticker.bestBid = toNumber(overview.ticker.bestBid) ?? state.ticker.bestBid;
      state.ticker.bestAsk = toNumber(overview.ticker.bestAsk) ?? state.ticker.bestAsk;
      state.ticker.lastSize = toNumber(overview.ticker.lastSize) ?? state.ticker.lastSize;
      state.ticker.time = overview.ticker.time ?? state.ticker.time;
      state.stats = {
        open: toNumber(overview.stats.open),
        high: toNumber(overview.stats.high),
        low: toNumber(overview.stats.low),
        volume: toNumber(overview.stats.volume)
      };
      state.orderBook = book;
      state.lastSync = Date.now();
      state.backtestDirty = true;

      scheduleAnalytics(true);
      queueRender();
      updateLastSync(reason);

      if (reason !== "silent") {
        pushLog(`Synced ${DISPLAY_FRAMES[state.chartFrame].label.toLowerCase()} view plus confirmation frames.`, "info");
      }
    } catch (error) {
      pushLog(error.message || "Market sync failed.", "error");
      showToast("Market sync failed. The desk will keep retrying.");
    } finally {
      scheduleRefresh();
      scheduleBookRefresh();
    }
  }

  function scheduleRefresh() {
    if (state.refreshHandle) clearTimeout(state.refreshHandle);
    state.refreshHandle = setTimeout(() => syncMarket("scheduled"), DISPLAY_FRAMES[state.chartFrame].refreshMs);
  }

  function scheduleBookRefresh() {
    if (state.bookRefreshHandle) clearTimeout(state.bookRefreshHandle);
    state.bookRefreshHandle = setTimeout(() => syncBook("scheduled"), BOOK_REFRESH_MS);
  }

  function scheduleOutboxFlush() {
    if (state.outboxHandle) clearInterval(state.outboxHandle);
    state.outboxHandle = setInterval(() => flushOutbox(), OUTBOX_REFRESH_MS);
  }

  function applyRiskInputs() {
    state.settings.accountSize = $("accountSizeInput").value.trim();
    state.settings.riskPct = $("riskPctInput").value.trim();
    state.settings.dailyLossPct = $("dailyLossPctInput").value.trim();
    state.settings.dayPnl = $("dayPnlInput").value.trim();
    persistState(state);
    scheduleAnalytics(true);
    showToast("Risk plan updated.");
  }

  async function applyAlertInputs() {
    state.settings.buyBelow = $("buyBelowInput").value.trim();
    state.settings.sellAbove = $("sellAboveInput").value.trim();
    state.settings.webhookUrl = $("webhookUrlInput").value.trim();
    state.alertFlags.buyBelow = false;
    state.alertFlags.sellAbove = false;
    persistState(state);
    renderer.renderAlerts();

    if (state.settings.notifications && "Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        pushLog("Notification permission request was blocked.", "warn");
      }
    }

    pushLog("Alert rules updated.", "info");
    showToast("Alert rules armed.");
    flushOutbox();
    processAlerts();
  }

  function attachEvents() {
    document.querySelectorAll("[data-timeframe]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.timeframe;
        if (!DISPLAY_FRAMES[next] || state.chartFrame === next) return;

        state.chartFrame = next;
        state.backtestDirty = true;
        persistState(state);
        syncMarket("manual");
        renderer.renderAll();
      });
    });

    $("refreshBtn").addEventListener("click", () => syncMarket("manual"));
    $("saveRiskBtn").addEventListener("click", applyRiskInputs);
    $("applyAlertsBtn").addEventListener("click", applyAlertInputs);

    $("testWebhookBtn").addEventListener("click", () => {
      state.settings.webhookUrl = $("webhookUrlInput").value.trim();
      if (!state.settings.webhookEnabled || !state.settings.webhookUrl) {
        showToast("Enable webhook relay and set a webhook URL first.");
        return;
      }

      persistState(state);
      queueWebhookDelivery({
        source: "velocity-desk",
        tone: "info",
        message: "Velocity Desk webhook test",
        createdAt: new Date().toISOString(),
        price: currentPrice(),
        signal: state.analytics?.combined?.action ?? null
      });
      pushLog("Webhook test queued.", "info");
      showToast("Webhook test queued.");
    });

    $("notificationsToggle").addEventListener("click", async () => {
      state.settings.notifications = !state.settings.notifications;
      persistState(state);
      renderer.renderAlerts();

      if (state.settings.notifications && "Notification" in window && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          pushLog("Notification permission request was blocked.", "warn");
        }
      }
    });

    $("soundToggle").addEventListener("click", () => {
      state.settings.sound = !state.settings.sound;
      persistState(state);
      renderer.renderAlerts();
    });

    $("signalAlertsToggle").addEventListener("click", () => {
      state.settings.signalAlerts = !state.settings.signalAlerts;
      if (!state.settings.signalAlerts) {
        state.alertFlags.signalKey = state.analytics?.combined?.action || null;
      }
      persistState(state);
      renderer.renderAlerts();
    });

    $("webhookToggle").addEventListener("click", () => {
      state.settings.webhookEnabled = !state.settings.webhookEnabled;
      state.settings.webhookUrl = $("webhookUrlInput").value.trim();
      persistState(state);
      renderer.renderAlerts();
      flushOutbox();
    });

    ["accountSizeInput", "riskPctInput", "dailyLossPctInput", "dayPnlInput"].forEach((id) => {
      $(id).addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyRiskInputs();
      });
    });

    ["buyBelowInput", "sellAboveInput", "webhookUrlInput"].forEach((id) => {
      $(id).addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyAlertInputs();
      });
    });

    window.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncBook("silent");
        flushOutbox();
      }
    });

    window.addEventListener("beforeunload", () => persistState(state));
  }

  function bootClock() {
    $("deskClock").textContent = formatClock();
    setInterval(() => {
      $("deskClock").textContent = formatClock();
    }, 1000);
  }

  function init() {
    attachEvents();
    bootClock();
    renderer.renderAlerts();
    renderer.renderRiskLab();
    renderer.renderTape();
    renderer.renderNotes();
    renderer.renderJournal();
    renderer.renderAll();
    scheduleOutboxFlush();
    flushOutbox();
    connectFeed();
    syncMarket("boot");
  }

  return { init };
}
