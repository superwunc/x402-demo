import "dotenv/config";

export const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

// Signer used as "meter / gateway" to call reportUsage & settleUsage
export const METER_PRIVATE_KEY = process.env.METER_PRIVATE_KEY;

// X402 contract address (deploy it with Hardhat)
export const X402_ADDRESS = process.env.X402_ADDRESS;

// ERC20 token used for payment
export const PAYMENT_TOKEN_ADDRESS = process.env.PAYMENT_TOKEN_ADDRESS;

// apiId: we hash-like a string, e.g. "demo/hello"
// For real deployment you'd want to use keccak256 on-chain or in a script.
export const API_ID = "0x" + Buffer.from("demo/hello").toString("hex").padEnd(64, "0");
