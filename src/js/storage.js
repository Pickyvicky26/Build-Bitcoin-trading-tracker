import { DISPLAY_FRAMES, STORAGE_KEY } from "./config.js";

export function loadPersistedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function buildInitialState(persisted) {
  return {
    chartFrame: persisted.chartFrame && DISPLAY_FRAMES[persisted.chartFrame] ? persisted.chartFrame : "24H",
    settings: {
      buyBelow: persisted.buyBelow ?? "",
      sellAbove: persisted.sellAbove ?? "",
      notifications: Boolean(persisted.notifications),
      sound: Boolean(persisted.sound),
      signalAlerts: persisted.signalAlerts !== false,
      webhookEnabled: Boolean(persisted.webhookEnabled),
      webhookUrl: persisted.webhookUrl ?? "",
      accountSize: persisted.accountSize ?? "25000",
      riskPct: persisted.riskPct ?? "1",
      dailyLossPct: persisted.dailyLossPct ?? "3",
      dayPnl: persisted.dayPnl ?? "0"
    },
    alertFlags: {
      buyBelow: false,
      sellAbove: false,
      signalKey: persisted.signalKey ?? null
    },
    frames: {},
    liveTicks: [],
    ticker: {
      price: null,
      bestBid: null,
      bestAsk: null,
      lastSize: null,
      side: null,
      time: null
    },
    stats: {
      open: null,
      high: null,
      low: null,
      volume: null
    },
    orderBook: {
      bids: [],
      asks: [],
      spread: null,
      mid: null,
      microprice: null,
      topBidVol: null,
      topAskVol: null,
      imbalance: null,
      impactBuy1: null,
      impactSell1: null
    },
    analytics: null,
    logs: [],
    notes: [],
    journal: Array.isArray(persisted.journal) ? persisted.journal : [],
    alertOutbox: Array.isArray(persisted.alertOutbox) ? persisted.alertOutbox : [],
    alertHistory: Array.isArray(persisted.alertHistory) ? persisted.alertHistory : [],
    ws: null,
    wsConnected: false,
    refreshHandle: null,
    bookRefreshHandle: null,
    outboxHandle: null,
    analyticsTimer: null,
    lastSync: null,
    audioContext: null,
    renderQueued: false,
    backtestDirty: true,
    flushingOutbox: false,
    lastJournalSignal: persisted.lastJournalSignal ?? null
  };
}

export function persistState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    chartFrame: state.chartFrame,
    buyBelow: state.settings.buyBelow,
    sellAbove: state.settings.sellAbove,
    notifications: state.settings.notifications,
    sound: state.settings.sound,
    signalAlerts: state.settings.signalAlerts,
    webhookEnabled: state.settings.webhookEnabled,
    webhookUrl: state.settings.webhookUrl,
    accountSize: state.settings.accountSize,
    riskPct: state.settings.riskPct,
    dailyLossPct: state.settings.dailyLossPct,
    dayPnl: state.settings.dayPnl,
    signalKey: state.alertFlags.signalKey,
    lastJournalSignal: state.lastJournalSignal,
    journal: state.journal.slice(0, 40),
    alertOutbox: state.alertOutbox.slice(0, 40),
    alertHistory: state.alertHistory.slice(0, 20)
  }));
}
