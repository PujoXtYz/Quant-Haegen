const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

// =============================================
// GANTI INI DENGAN API KEY & SECRET BYBIT KAMU
// =============================================
const BYBIT_API_KEY = process.env.BYBIT_API_KEY || "ISI_API_KEY_KAMU";
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET || "ISI_API_SECRET_KAMU";
const YOUR_MIDDLEWARE_KEY = process.env.MIDDLEWARE_KEY || "ISI_PASSWORD_RAHASIA_KAMU"; // kunci untuk GPT
// =============================================

const BYBIT_BASE_URL = "https://api.bybit.com";
const RECV_WINDOW = "5000";

// Helper: generate Bybit signature
function generateSignature(timestamp, params) {
  const queryString =
    typeof params === "string"
      ? params
      : Object.keys(params)
          .sort()
          .map((k) => `${k}=${params[k]}`)
          .join("&");
  const raw = `${timestamp}${BYBIT_API_KEY}${RECV_WINDOW}${queryString}`;
  return crypto.createHmac("sha256", BYBIT_API_SECRET).update(raw).digest("hex");
}

// Middleware: validasi kunci dari Custom GPT
function authMiddleware(req, res, next) {
  const key = req.headers["x-api-key"];
  if (key !== YOUR_MIDDLEWARE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─────────────────────────────────────────────
// GET /wallet-balance?accountType=UNIFIED
// ─────────────────────────────────────────────
app.get("/wallet-balance", authMiddleware, async (req, res) => {
  try {
    const timestamp = Date.now().toString();
    const params = { accountType: req.query.accountType || "UNIFIED" };
    const sign = generateSignature(timestamp, params);

    const response = await axios.get(`${BYBIT_BASE_URL}/v5/account/wallet-balance`, {
      params,
      headers: {
        "X-BAPI-API-KEY": BYBIT_API_KEY,
        "X-BAPI-SIGN": sign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /positions?category=linear&symbol=BTCUSDT
// ─────────────────────────────────────────────
app.get("/positions", authMiddleware, async (req, res) => {
  try {
    const timestamp = Date.now().toString();
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
    };
    const sign = generateSignature(timestamp, params);

    const response = await axios.get(`${BYBIT_BASE_URL}/v5/position/list`, {
      params,
      headers: {
        "X-BAPI-API-KEY": BYBIT_API_KEY,
        "X-BAPI-SIGN": sign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /open-orders?category=linear&symbol=BTCUSDT
// ─────────────────────────────────────────────
app.get("/open-orders", authMiddleware, async (req, res) => {
  try {
    const timestamp = Date.now().toString();
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
    };
    const sign = generateSignature(timestamp, params);

    const response = await axios.get(`${BYBIT_BASE_URL}/v5/order/realtime`, {
      params,
      headers: {
        "X-BAPI-API-KEY": BYBIT_API_KEY,
        "X-BAPI-SIGN": sign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /ticker?category=spot&symbol=BTCUSDT
// (public, no auth needed)
// ─────────────────────────────────────────────
app.get("/ticker", async (req, res) => {
  try {
    const response = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers`, {
      params: {
        category: req.query.category || "spot",
        symbol: req.query.symbol,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /order-history?category=linear&symbol=BTCUSDT
// ─────────────────────────────────────────────
app.get("/order-history", authMiddleware, async (req, res) => {
  try {
    const timestamp = Date.now().toString();
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
      ...(req.query.limit && { limit: req.query.limit }),
    };
    const sign = generateSignature(timestamp, params);

    const response = await axios.get(`${BYBIT_BASE_URL}/v5/order/history`, {
      params,
      headers: {
        "X-BAPI-API-KEY": BYBIT_API_KEY,
        "X-BAPI-SIGN": sign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bybit Middleware running on port ${PORT}`));
