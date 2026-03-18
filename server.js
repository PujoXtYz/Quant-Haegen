// ============================================================
// Bybit MCP + GPT Middleware v2.0
// - MCP SSE protocol (manual, no SDK needed)
// - REST endpoints for ChatGPT backward compat
// Dependencies: express + axios only (no new packages!)
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");

const app = express();
app.use(express.json());

// ── CONFIG ──────────────────────────────────────────────────
const BYBIT_API_KEY    = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
const MIDDLEWARE_KEY   = process.env.MIDDLEWARE_KEY;
const BYBIT_BASE_URL   = "https://api.bybit.com";
const RECV_WINDOW      = "5000";

// ── HELPERS ─────────────────────────────────────────────────

function generateSignature(timestamp, params) {
  const queryString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const raw = `${timestamp}${BYBIT_API_KEY}${RECV_WINDOW}${queryString}`;
  return crypto.createHmac("sha256", BYBIT_API_SECRET).update(raw).digest("hex");
}

async function callBybitPrivate(endpoint, params) {
  const timestamp = Date.now().toString();
  const sign = generateSignature(timestamp, params);
  const response = await axios.get(`${BYBIT_BASE_URL}${endpoint}`, {
    params,
    headers: {
      "X-BAPI-API-KEY":     BYBIT_API_KEY,
      "X-BAPI-SIGN":        sign,
      "X-BAPI-SIGN-TYPE":   "2",
      "X-BAPI-TIMESTAMP":   timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    },
  });
  return response.data;
}

function restAuth(req, res, next) {
  if (req.headers["x-api-key"] !== MIDDLEWARE_KEY)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── MCP TOOL DEFINITIONS ────────────────────────────────────

const MCP_TOOLS = [
  {
    name: "get_wallet_balance",
    description: "Get Bybit wallet balance — total equity, available balance, unrealized PnL",
    inputSchema: {
      type: "object",
      properties: {
        accountType: { type: "string", description: "UNIFIED (default), CONTRACT, or SPOT" },
      },
    },
  },
  {
    name: "get_positions",
    description: "Get all open positions on Bybit (futures/perpetuals)",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "linear (default), inverse, option" },
        symbol:   { type: "string", description: "e.g. BTCUSDT — leave empty for all" },
      },
    },
  },
  {
    name: "get_price",
    description: "Get current market price and 24h stats for a trading pair",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol:   { type: "string", description: "e.g. BTCUSDT, ETHUSDT" },
        category: { type: "string", description: "linear (default), spot, inverse" },
      },
    },
  },
  {
    name: "get_open_orders",
    description: "Get all currently open/active orders on Bybit",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "linear (default), spot, inverse" },
        symbol:   { type: "string", description: "e.g. BTCUSDT — optional filter" },
      },
    },
  },
  {
    name: "get_closed_pnl",
    description: "Get closed PnL history — realized profit/loss from closed trades",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "linear (default), inverse" },
        symbol:   { type: "string", description: "optional filter e.g. BTCUSDT" },
        limit:    { type: "string", description: "number of records, default 50" },
      },
    },
  },
  {
    name: "get_order_history",
    description: "Get order history including filled and cancelled orders",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "linear (default), spot, inverse" },
        symbol:   { type: "string", description: "optional filter e.g. BTCUSDT" },
        limit:    { type: "string", description: "number of records, default 50" },
      },
    },
  },
];

// ── MCP TOOL EXECUTOR ───────────────────────────────────────

async function executeTool(name, args) {
  args = args || {};
  try {
    let data;
    if (name === "get_wallet_balance") {
      data = await callBybitPrivate("/v5/account/wallet-balance", {
        accountType: args.accountType || "UNIFIED",
      });
    } else if (name === "get_positions") {
      const params = { category: args.category || "linear" };
      if (args.symbol) params.symbol = args.symbol;
      data = await callBybitPrivate("/v5/position/list", params);
    } else if (name === "get_price") {
      const resp = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers`, {
        params: { category: args.category || "linear", symbol: args.symbol },
      });
      data = resp.data;
    } else if (name === "get_open_orders") {
      const params = { category: args.category || "linear" };
      if (args.symbol) params.symbol = args.symbol;
      data = await callBybitPrivate("/v5/order/realtime", params);
    } else if (name === "get_closed_pnl") {
      const params = { category: args.category || "linear", limit: args.limit || "50" };
      if (args.symbol) params.symbol = args.symbol;
      data = await callBybitPrivate("/v5/position/closed-pnl", params);
    } else if (name === "get_order_history") {
      const params = { category: args.category || "linear", limit: args.limit || "50" };
      if (args.symbol) params.symbol = args.symbol;
      data = await callBybitPrivate("/v5/order/history", params);
    } else {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}

// ── MCP SSE TRANSPORT ────────────────────────────────────────
// Implements MCP 2024-11-05 SSE protocol manually (no SDK needed)
// GET  /sse      → Claude connects, gets sessionId
// POST /messages → Claude sends JSON-RPC tool calls

const sessions = new Map();

app.get("/sse", (req, res) => {
  const sessionId = crypto.randomUUID();

  res.writeHead(200, {
    "Content-Type":                "text/event-stream",
    "Cache-Control":               "no-cache",
    "Connection":                  "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // MCP SSE handshake: send endpoint event
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

  sessions.set(sessionId, res);

  req.on("close", () => sessions.delete(sessionId));
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const sseRes    = sessions.get(sessionId);

  if (!sseRes) return res.status(404).json({ error: "Session not found" });

  const msg = req.body;

  let reply;

  if (msg.method === "initialize") {
    reply = {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities:   { tools: {} },
        serverInfo:     { name: "bybit-quant-haegen", version: "2.0.0" },
      },
    };
  } else if (msg.method === "notifications/initialized") {
    // Acknowledgement — no response needed
    return res.status(202).send("Accepted");
  } else if (msg.method === "tools/list") {
    reply = {
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: MCP_TOOLS },
    };
  } else if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params;
    const toolResult = await executeTool(name, args);
    reply = { jsonrpc: "2.0", id: msg.id, result: toolResult };
  } else {
    reply = {
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    };
  }

  sseRes.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
  res.status(202).send("Accepted");
});

// ── REST ENDPOINTS (ChatGPT backward compat) ─────────────────

app.get("/wallet-balance", restAuth, async (req, res) => {
  try {
    res.json(await callBybitPrivate("/v5/account/wallet-balance", {
      accountType: req.query.accountType || "UNIFIED",
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/positions", restAuth, async (req, res) => {
  try {
    const params = { category: req.query.category || "linear" };
    if (req.query.symbol) params.symbol = req.query.symbol;
    res.json(await callBybitPrivate("/v5/position/list", params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/open-orders", restAuth, async (req, res) => {
  try {
    const params = { category: req.query.category || "linear" };
    if (req.query.symbol) params.symbol = req.query.symbol;
    res.json(await callBybitPrivate("/v5/order/realtime", params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/ticker", async (req, res) => {
  try {
    const resp = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers`, {
      params: { category: req.query.category || "spot", symbol: req.query.symbol },
    });
    res.json(resp.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/order-history", restAuth, async (req, res) => {
  try {
    const params = { category: req.query.category || "linear" };
    if (req.query.symbol) params.symbol = req.query.symbol;
    if (req.query.limit)  params.limit  = req.query.limit;
    res.json(await callBybitPrivate("/v5/order/history", params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status:       "ok",
    version:      "2.0.0",
    mcp_endpoint: "/sse",
    tools:        MCP_TOOLS.map((t) => t.name),
  });
});

// ── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Bybit MCP + REST Middleware v2.0 running on port ${PORT}`)
);
