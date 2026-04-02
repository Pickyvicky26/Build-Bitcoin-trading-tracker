import { PRODUCT_ID } from "./config.js";

function estimateFill(levels, quantity) {
  let remaining = quantity;
  let notional = 0;

  for (const level of levels) {
    const size = Math.min(remaining, level.size);
    notional += size * level.price;
    remaining -= size;
    if (remaining <= 0) break;
  }

  return remaining > 0 ? null : notional / quantity;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Market request failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchFrameCandles(frameConfig) {
  const url = `https://api.exchange.coinbase.com/products/${PRODUCT_ID}/candles?granularity=${frameConfig.granularity}`;
  const raw = await fetchJson(url);

  return raw
    .map(([time, low, high, open, close, volume]) => ({
      time: Number(time) * 1000,
      low: Number(low),
      high: Number(high),
      open: Number(open),
      close: Number(close),
      volume: Number(volume)
    }))
    .filter((item) => Number.isFinite(item.close))
    .sort((a, b) => a.time - b.time)
    .slice(-frameConfig.points);
}

export async function fetchStats() {
  const [ticker, stats] = await Promise.all([
    fetchJson(`https://api.exchange.coinbase.com/products/${PRODUCT_ID}/ticker`),
    fetchJson(`https://api.exchange.coinbase.com/products/${PRODUCT_ID}/stats`)
  ]);

  return {
    ticker: {
      price: Number(ticker.price),
      bestBid: Number(ticker.best_bid),
      bestAsk: Number(ticker.best_ask),
      lastSize: Number(ticker.last_size),
      time: ticker.time || Date.now()
    },
    stats: {
      open: Number(stats.open),
      high: Number(stats.high),
      low: Number(stats.low),
      volume: Number(stats.volume)
    }
  };
}

export async function fetchBook() {
  const data = await fetchJson(`https://api.exchange.coinbase.com/products/${PRODUCT_ID}/book?level=2`);
  const bids = (data.bids || []).slice(0, 8).map(([price, size]) => ({
    price: Number(price),
    size: Number(size)
  }));
  const asks = (data.asks || []).slice(0, 8).map(([price, size]) => ({
    price: Number(price),
    size: Number(size)
  }));

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? bestAsk - bestBid : null;
  const mid = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? (bestAsk + bestBid) / 2 : null;
  const topBidVol = bids.slice(0, 5).reduce((sum, level) => sum + level.size, 0);
  const topAskVol = asks.slice(0, 5).reduce((sum, level) => sum + level.size, 0);
  const imbalance = topBidVol + topAskVol ? topBidVol / (topBidVol + topAskVol) : 0.5;
  const microprice = bids[0] && asks[0]
    ? ((asks[0].price * bids[0].size) + (bids[0].price * asks[0].size)) / (bids[0].size + asks[0].size)
    : null;

  return {
    bids,
    asks,
    spread,
    mid,
    microprice,
    topBidVol,
    topAskVol,
    imbalance,
    impactBuy1: Number.isFinite(bestAsk) ? estimateFill(asks, 1) - bestAsk : null,
    impactSell1: Number.isFinite(bestBid) ? bestBid - estimateFill(bids, 1) : null
  };
}

export function openTickerFeed(handlers) {
  const socket = new WebSocket("wss://ws-feed.exchange.coinbase.com");

  socket.addEventListener("open", () => {
    handlers.onOpen?.(socket);
    socket.send(JSON.stringify({
      type: "subscribe",
      product_ids: [PRODUCT_ID],
      channels: ["ticker"]
    }));
  });

  socket.addEventListener("message", (event) => {
    try {
      handlers.onMessage?.(JSON.parse(event.data), socket);
    } catch {
      return;
    }
  });

  socket.addEventListener("error", () => {
    handlers.onError?.(socket);
  });

  socket.addEventListener("close", () => {
    handlers.onClose?.(socket);
  });

  return socket;
}
