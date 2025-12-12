import express from "express";
import path from "path";
import bodyParser from "body-parser";
import crypto from "crypto";
import { ethers } from "ethers";
import { RPC_URL, METER_PRIVATE_KEY, X402_ADDRESS, PAYMENT_TOKEN_ADDRESS, API_ID } from "./config.js";
import { X402_ABI } from "./x402Abi.js";

if (!METER_PRIVATE_KEY || !X402_ADDRESS || !PAYMENT_TOKEN_ADDRESS) {
  console.error("Please set RPC_URL, METER_PRIVATE_KEY, X402_ADDRESS, PAYMENT_TOKEN_ADDRESS in backend/.env");
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// Serve static dashboard from /public
const staticDir = path.join(process.cwd(), "public");
app.use(express.static(staticDir));

// In-memory usage history for demo purposes
const usageHistory = [];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const meterWallet = new ethers.Wallet(METER_PRIVATE_KEY, provider);
const x402 = new ethers.Contract(X402_ADDRESS, X402_ABI, meterWallet);

// Minimal ERC20 interface for token info
const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)"
];
const paymentToken = new ethers.Contract(PAYMENT_TOKEN_ADDRESS, ERC20_ABI, provider);

// EIP-712 domain (filled with real chainId at startup)
let eip712Domain = {
  name: "X402Demo",
  version: "1",
  chainId: 0,
  verifyingContract: X402_ADDRESS
};

// Typed data structure for API calls
const EIP712_TYPES = {
  Call: [
    { name: "consumer", type: "address" },
    { name: "apiId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

// Helper to encode string API keys into bytes32 apiId
function toAPIId(str) {
  return "0x" + Buffer.from(str).toString("hex").padEnd(64, "0");
}

// Our demo APIs
const API_ID_HELLO = API_ID;              // from config ("demo/hello")
const API_ID_RANDOM = toAPIId("random/number");

const API_LIST = [
  {
    name: "Hello API",
    apiKey: "demo/hello",
    apiId: API_ID_HELLO,
    endpoint: "/demo/hello",
    description: "Returns a greeting message"
  },
  {
    name: "Random Number API",
    apiKey: "random/number",
    apiId: API_ID_RANDOM,
    endpoint: "/random/number",
    description: "Returns a random integer"
  }
];

async function initDomain() {
  const net = await provider.getNetwork();
  eip712Domain.chainId = Number(net.chainId.toString());
  console.log("EIP-712 domain initialized:", eip712Domain);
}

// helper: ensure APIs are registered on-chain
async function ensureApisRegistered() {
  console.log("Checking/initializing API configs...");

  // for simplicity, all APIs share same payment token and price
  const pricePerUnit = ethers.parseUnits("1", 18);
  const metadataBase = "ipfs://demo-x402-api/";

  for (const api of API_LIST) {
    let cfg;
    try {
      cfg = await x402.getApiConfig(api.apiId);
    } catch (e) {
      console.log(`getApiConfig reverted for ${api.name}, will try to register.`);
    }

    if (cfg && cfg.provider && cfg.provider !== ethers.ZeroAddress) {
      console.log(`API already registered: ${api.name} by ${cfg.provider}`);
      continue;
    }

    const metadataURI = metadataBase + api.apiKey;
    const tx = await x402.registerApi(api.apiId, PAYMENT_TOKEN_ADDRESS, pricePerUnit, metadataURI);
    console.log(`Registering API ${api.name}... tx hash:`, tx.hash);
    await tx.wait();
    console.log(`API ${api.name} registered.`);
  }
}

// ---------- API endpoints ----------

// Status endpoint: returns prepaid units and provider balance (for Hello API)
app.get("/status", async (req, res) => {
  try {
    const addr = req.query.address;
    if (!addr || !ethers.isAddress(addr)) {
      return res.status(400).json({ error: "Missing or invalid address param" });
    }

    const [prepaid, apiCfg, providerBal] = await Promise.all([
      x402.prepaidUnits(API_ID_HELLO, addr),
      x402.getApiConfig(API_ID_HELLO),
      x402.providerBalance(API_ID_HELLO)
    ]);

    res.json({
      apiId: API_ID_HELLO,
      consumer: addr,
      prepaidUnits: prepaid.toString(),
      provider: apiCfg.provider,
      providerBalance: providerBal.toString(),
      paymentToken: apiCfg.paymentToken,
      pricePerUnit: apiCfg.pricePerUnit.toString()
    });
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ error: "Status failed", details: err.message || String(err) });
  }
});

// Token info: balance, symbol, decimals for a wallet
app.get("/token-info", async (req, res) => {
  try {
    const addr = req.query.address;
    if (!addr || !ethers.isAddress(addr)) {
      return res.status(400).json({ error: "Missing or invalid address param" });
    }
    const [bal, decimals, symbol, name] = await Promise.all([
      paymentToken.balanceOf(addr),
      paymentToken.decimals(),
      paymentToken.symbol(),
      paymentToken.name()
    ]);
    res.json({
      address: addr,
      balance: bal.toString(),
      decimals: Number(decimals),
      symbol,
      name
    });
  } catch (err) {
    console.error("Token info error:", err);
    res.status(500).json({ error: "Token info failed", details: err.message || String(err) });
  }
});

// Provider dashboard info: balances per API
app.get("/provider-info", async (req, res) => {
  try {
    const addr = req.query.address;
    if (!addr || !ethers.isAddress(addr)) {
      return res.status(400).json({ error: "Missing or invalid address param" });
    }
    const lower = addr.toLowerCase();
    const apis = [];
    let total = 0n;

    for (const api of API_LIST) {
      const [cfg, bal] = await Promise.all([
        x402.getApiConfig(api.apiId),
        x402.providerBalance(api.apiId)
      ]);
      if (cfg.provider.toLowerCase() !== lower) continue;
      const balBig = BigInt(bal.toString());
      total += balBig;
      apis.push({
        name: api.name,
        apiId: api.apiId,
        endpoint: api.endpoint,
        paymentToken: cfg.paymentToken,
        pricePerUnit: cfg.pricePerUnit.toString(),
        balance: bal.toString()
      });
    }

    res.json({
      provider: addr,
      apis,
      totalBalance: total.toString()
    });
  } catch (err) {
    console.error("Provider info error:", err);
    res.status(500).json({ error: "Provider info failed", details: err.message || String(err) });
  }
});

// Provider withdraw all revenue for all APIs (demo only, no auth)
app.post("/provider/withdraw", async (req, res) => {
  try {
    const to = req.body?.to && ethers.isAddress(req.body.to) ? req.body.to : meterWallet.address;
    const results = [];

    for (const api of API_LIST) {
      const cfg = await x402.getApiConfig(api.apiId);
      if (cfg.provider.toLowerCase() !== meterWallet.address.toLowerCase()) continue;

      const bal = await x402.providerBalance(api.apiId);
      const balBig = BigInt(bal.toString());
      if (balBig === 0n) continue;

      const tx = await x402.withdrawProviderRevenue(api.apiId, balBig, to);
      await tx.wait();
      results.push({ apiId: api.apiId, to, amount: balBig.toString() });
    }

    res.json({ ok: true, withdrawals: results });
  } catch (err) {
    console.error("Provider withdraw error:", err);
    res.status(500).json({ error: "Provider withdraw failed", details: err.message || String(err) });
  }
});

// Usage history for a consumer (all APIs)
app.get("/history/:consumer", (req, res) => {
  const consumer = req.params.consumer.toLowerCase();
  const list = usageHistory.filter(x => x.consumer.toLowerCase() === consumer);
  res.json(list);
});

// API marketplace list (including on-chain config)
app.get("/api-list", async (req, res) => {
  try {
    const enriched = [];
    for (const api of API_LIST) {
      const cfg = await x402.getApiConfig(api.apiId);
      const providerBal = await x402.providerBalance(api.apiId);
      enriched.push({
        ...api,
        provider: cfg.provider,
        paymentToken: cfg.paymentToken,
        pricePerUnit: cfg.pricePerUnit.toString(),
        active: cfg.active,
        providerBalance: providerBal.toString()
      });
    }
    res.json(enriched);
  } catch (err) {
    console.error("api-list error:", err);
    res.status(500).json({ error: "api-list failed", details: err.message || String(err) });
  }
});

// Verify an EIP-712 signed request
async function verifySignedRequest(body, expectedApiId) {
  const { consumer, nonce, deadline, signature } = body || {};

  if (!consumer || !ethers.isAddress(consumer)) {
    throw new Error("Missing or invalid consumer");
  }
  if (!nonce || !deadline || !signature) {
    throw new Error("Missing nonce/deadline/signature");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(deadline) < nowSec) {
    throw new Error("Signature expired");
  }

  const message = {
    consumer,
    apiId: expectedApiId,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline)
  };

  const recovered = ethers.verifyTypedData(eip712Domain, EIP712_TYPES, message, signature);
  if (recovered.toLowerCase() !== consumer.toLowerCase()) {
    throw new Error("Invalid signature");
  }

  return { consumer, nonce, deadline, signature };
}

// Business API: /demo/hello (Hello API)
app.post("/demo/hello", async (req, res) => {
  let consumer;
  try {
    ({ consumer } = await verifySignedRequest(req.body, API_ID_HELLO));
  } catch (err) {
    console.error("Signature verification error (hello):", err);
    return res.status(400).json({ error: "Signature verification failed", details: err.message || String(err) });
  }

  const requestId = crypto.randomBytes(16).toString("hex");
  console.log(`Incoming signed HELLO requestId=${requestId}, consumer=${consumer}`);

  const payload = {
    message: "Hello from X402 demo API (EIP-712 secured)",
    requestId,
    consumer
  };

  try {
    const units = 1;
    const offchainRef = `hello:${requestId}`;

    const reportTx = await x402.reportUsage(API_ID_HELLO, consumer, units, offchainRef);
    console.log("reportUsage (hello) tx:", reportTx.hash);
    const reportRcpt = await reportTx.wait();

    const iface = new ethers.Interface(X402_ABI);
    let usageId = null;
    for (const log of reportRcpt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "UsageReported") {
          usageId = parsed.args.usageId;
          break;
        }
      } catch (e) {
        // ignore non-matching logs
      }
    }

    if (!usageId) {
      throw new Error("Unable to parse usageId from UsageReported event");
    }

    const settleTx = await x402.settleUsage(usageId);
    console.log("settleUsage (hello) tx:", settleTx.hash);
    await settleTx.wait();
    console.log("Usage settled (hello).");

    usageHistory.push({
      usageId,
      apiId: API_ID_HELLO,
      consumer,
      units,
      timestamp: Date.now(),
      requestId
    });

    res.json({
      ...payload,
      billing: {
        apiId: API_ID_HELLO,
        units,
        usageId
      }
    });
  } catch (err) {
    console.error("Billing error (hello):", err);
    res.status(500).json({
      error: "Billing failed",
      details: err.message || String(err)
    });
  }
});

// Business API: /random/number (Random Number API)
app.post("/random/number", async (req, res) => {
  let consumer;
  try {
    ({ consumer } = await verifySignedRequest(req.body, API_ID_RANDOM));
  } catch (err) {
    console.error("Signature verification error (random):", err);
    return res.status(400).json({ error: "Signature verification failed", details: err.message || String(err) });
  }

  const requestId = crypto.randomBytes(16).toString("hex");
  console.log(`Incoming signed RANDOM requestId=${requestId}, consumer=${consumer}`);

  const randomNumber = Math.floor(Math.random() * 100000);

  try {
    const units = 1;
    const offchainRef = `random:${requestId}`;

    const reportTx = await x402.reportUsage(API_ID_RANDOM, consumer, units, offchainRef);
    console.log("reportUsage (random) tx:", reportTx.hash);
    const reportRcpt = await reportTx.wait();

    const iface = new ethers.Interface(X402_ABI);
    let usageId = null;
    for (const log of reportRcpt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "UsageReported") {
          usageId = parsed.args.usageId;
          break;
        }
      } catch (e) {
        // ignore non-matching logs
      }
    }

    if (!usageId) {
      throw new Error("Unable to parse usageId from UsageReported event");
    }

    const settleTx = await x402.settleUsage(usageId);
    console.log("settleUsage (random) tx:", settleTx.hash);
    await settleTx.wait();
    console.log("Usage settled (random).");

    usageHistory.push({
      usageId,
      apiId: API_ID_RANDOM,
      consumer,
      units,
      timestamp: Date.now(),
      requestId,
      result: randomNumber
    });

    res.json({
      number: randomNumber,
      billing: {
        apiId: API_ID_RANDOM,
        units,
        usageId
      }
    });
  } catch (err) {
    console.error("Billing error (random):", err);
    res.status(500).json({
      error: "Billing failed",
      details: err.message || String(err)
    });
  }
});

const PORT = process.env.PORT || 3000;

(async () => {
  await initDomain();
  await ensureApisRegistered();
  app.listen(PORT, () => {
    console.log(`X402 demo API server listening on http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/`);
    console.log(`Status endpoint: GET http://localhost:${PORT}/status?address=<wallet>`);
    console.log(`Hello API: POST http://localhost:${PORT}/demo/hello`);
    console.log(`Random API: POST http://localhost:${PORT}/random/number`);
    console.log(`Token info: GET http://localhost:${PORT}/token-info?address=<wallet>`);
    console.log(`Provider info: GET http://localhost:${PORT}/provider-info?address=<provider>`);
  });
})();
