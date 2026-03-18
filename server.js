import express from "express";
import crypto from "crypto";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// =============================================
// CONFIG — semua dari Railway Environment Variables
// =============================================
const BYBIT_API_KEY    = process.env.BYBIT_API_KEY;
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
const MIDDLEWARE_KEY   = process.env.MIDDLEWARE_KEY; // untuk REST endpoint (ChatGPT)
const BYBIT_BASE_URL   = "https://api.bybit.com";
const RECV_WINDOW      = "5000";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

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

async function callBybitPrivate(endpoint, params) {
  const timestamp = Date.now().toString();
  const sign = generateSignature(timestamp, params);
  const response = await axios.get(`${BYBIT_BASE_URL}${endpoint}`, {
    params,
    headers: {
      "X-BAPI-API-KEY":      BYBIT_API_KEY,
      "X-BAPI-SIGN":         sign,
      "X-BAPI-SIGN-TYPE":    "2",
      "X-BAPI-TIMESTAMP":    timestamp,
      "X-BAPI-RECV-WINDOW":  RECV_WINDOW,
    },
  });
  return response.data;
}

// Middleware auth untuk REST endpoints (ChatGPT)
function restAuth(req, res, next) {
  const key = req.headers["x-api-key"];
  if (key !== MIDDLEWARE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─────────────────────────────────────────────
// MCP SERVER — untuk Claude Cowork
// ─────────────────────────────────────────────

const mcpServer = new McpServer({
  name: "bybit-quant-haegen",
  version: "2.0.0",
});

// Tool: get_wallet_balance
mcpServer.tool(
  "get_wallet_balance",
  "Get Bybit wallet balance including total equity, available balance, and unrealized PnL",
  {
    accountType: z
      .string()
      .optional()
      .describe("Account type: UNIFIED (default), CONTRACT, SPOT"),
  },
  async ({ accountType = "UNIFIED" }) => {
    try {
      const data = await callBybitPrivate("/v5/account/wallet-balance", { accountType });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: get_positions
mcpServer.tool(
  "get_positions",
  "Get all open positions on Bybit (futures/perpetuals)",
  {
    category: z
      .string()
      .optional()
      .describe("Market category: linear (default), inverse, option"),
    symbol: z
      .string()
      .optional()
      .describe("Filter by symbol e.g. BTCUSDT. Leave empty for all positions."),
  },
  async ({ category = "linear", symbol }) => {
    try {
      const params = { category, ...(symbol && { symbol }) };
      const data = await callBybitPrivate("/v5/position/list", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: get_price
mcpServer.tool(
  "get_price",
  "Get current market price and 24h stats for a trading pair",
  {
    symbol: z.string().describe("Trading pair symbol e.g. BTCUSDT, ETHUSDT"),
    category: z
      .string()
      .optional()
      .describe("Market category: linear (default), spot, inverse"),
  },
  async ({ symbol, category = "linear" }) => {
    try {
      const response = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers`, {
        params: { category, symbol },
      });
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: get_open_orders
mcpServer.tool(
  "get_open_orders",
  "Get all currently open/active orders on Bybit",
  {
    category: z.string().optional().describe("Market category: linear (default), spot, inverse"),
    symbol: z.string().optional().describe("Filter by symbol e.g. BTCUSDT"),
  },
  async ({ category = "linear", symbol }) => {
    try {
      const params = { category, ...(symbol && { symbol }) };
      const data = await callBybitPrivate("/v5/order/realtime", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: get_closed_pnl
mcpServer.tool(
  "get_closed_pnl",
  "Get closed PnL history (realized profit/loss from closed trades)",
  {
    category: z.string().optional().describe("Market category: linear (default), inverse"),
    symbol: z.string().optional().describe("Filter by symbol e.g. BTCUSDT"),
    limit: z.string().optional().describe("Number of records to return (default: 50, max: 100)"),
  },
  async ({ category = "linear", symbol, limit = "50" }) => {
    try {
      const params = { category, limit, ...(symbol && { symbol }) };
      const data = await callBybitPrivate("/v5/position/closed-pnl", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: get_order_history
mcpServer.tool(
  "get_order_history",
  "Get order history (all orders including filled, cancelled)",
  {
    category: z.string().optional().describe("Market category: linear (default), spot, inverse"),
    symbol: z.string().optional().describe("Filter by symbol e.g. BTCUSDT"),
    limit: z.string().optional().describe("Number of records to return (default: 50)"),
  },
  async ({ category = "linear", symbol, limit = "50" }) => {
    try {
      const params = { category, limit, ...(symbol && { symbol }) };
      const data = await callBybitPrivate("/v5/order/history", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// ─────────────────────────────────────────────
// MCP SSE TRANSPORT ENDPOINTS
// GET  /sse      → Claude connects here (SSE stream)
// POST /messages → Claude sends tool calls here
// ─────────────────────────────────────────────

const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  transport.onclose = () => {
    delete transports[transport.sessionId];
  };

  await mcpServer.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(404).json({ error: "MCP session not found" });
  }
});

// ─────────────────────────────────────────────
// REST ENDPOINTS — backward compat untuk ChatGPT
// ─────────────────────────────────────────────

app.get("/wallet-balance", restAuth, async (req, res) => {
  try {
    const data = await callBybitPrivate("/v5/account/wallet-balance", {
      accountType: req.query.accountType || "UNIFIED",
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/positions", restAuth, async (req, res) => {
  try {
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
    };
    const data = await callBybitPrivate("/v5/position/list", params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/open-orders", restAuth, async (req, res) => {
  try {
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
    };
    const data = await callBybitPrivate("/v5/order/realtime", params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get("/order-history", restAuth, async (req, res) => {
  try {
    const params = {
      category: req.query.category || "linear",
      ...(req.query.symbol && { symbol: req.query.symbol }),
      ...(req.query.limit && { limit: req.query.limit }),
    };
    const data = await callBybitPrivate("/v5/order/history", params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Bybit MCP + GPT Middleware v2.0",
    mcp_endpoint: "/sse",
    tools: [
      "get_wallet_balance",
      "get_positions",
      "get_price",
      "get_open_orders",
      "get_closed_pnl",
      "get_order_history",
    ],
  });
});

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bybit MCP + REST Middleware running on port ${PORT}`));
