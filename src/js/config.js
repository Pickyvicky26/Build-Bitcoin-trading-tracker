export const STORAGE_KEY = "velocity-desk-state-v2";
export const PRODUCT_ID = "BTC-USD";
export const MAX_TICKS = 480;
export const MAX_LOGS = 80;
export const ANALYTICS_DELAY_MS = 280;
export const BOOK_REFRESH_MS = 6000;
export const OUTBOX_REFRESH_MS = 15000;
export const JOURNAL_HORIZON_MS = 60 * 60 * 1000;

export const DISPLAY_FRAMES = {
  "1H": { label: "1 Hour", granularity: 60, points: 90, refreshMs: 15000 },
  "6H": { label: "6 Hours", granularity: 300, points: 96, refreshMs: 20000 },
  "24H": { label: "24 Hours", granularity: 900, points: 96, refreshMs: 30000 },
  "7D": { label: "7 Days", granularity: 3600, points: 168, refreshMs: 60000 }
};

export const ANALYTIC_FRAMES = {
  T5M: { display: "5m", label: "5 Minutes", granularity: 300, points: 250 },
  T15M: { display: "15m", label: "15 Minutes", granularity: 900, points: 250 },
  T1H: { display: "1h", label: "1 Hour", granularity: 3600, points: 220 },
  T4H: { display: "4h", label: "4 Hours", granularity: 21600, points: 180 }
};

export const BACKTEST_HORIZONS = [
  { label: "15m", bars: 3, scale: 0.32, note: "Scalp bias" },
  { label: "1h", bars: 12, scale: 1, note: "Primary desk call" },
  { label: "4h", bars: 48, scale: 2.25, note: "Session extension" }
];

export function getFrameConfig(frameKey) {
  return DISPLAY_FRAMES[frameKey] || ANALYTIC_FRAMES[frameKey];
}

export function getRequiredFrameKeys(chartFrame) {
  return [...new Set([...Object.keys(ANALYTIC_FRAMES), chartFrame])];
}
