import { ethers } from "ethers";
import "dotenv/config";
import { RPC_URL, X402_ADDRESS, PAYMENT_TOKEN_ADDRESS, API_ID } from "./config.js";
import { X402_ABI } from "./x402Abi.js";

const CONSUMER_PRIVATE_KEY = process.env.CONSUMER_PRIVATE_KEY;

if (!CONSUMER_PRIVATE_KEY) {
  console.error("Please set CONSUMER_PRIVATE_KEY in backend/.env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const consumerWallet = new ethers.Wallet(CONSUMER_PRIVATE_KEY, provider);
const x402 = new ethers.Contract(X402_ADDRESS, X402_ABI, consumerWallet);

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

const token = new ethers.Contract(PAYMENT_TOKEN_ADDRESS, ERC20_ABI, consumerWallet);

(async () => {
  const consumerAddr = await consumerWallet.getAddress();
  console.log("Consumer:", consumerAddr);

  const decimals = await token.decimals();
  const balance = await token.balanceOf(consumerAddr);
  console.log("Token balance:", ethers.formatUnits(balance, decimals));

  const units = 10n;

  const cfg = await x402.getApiConfig(API_ID);
  const pricePerUnit = cfg.pricePerUnit;
  const amount = pricePerUnit * units;

  console.log("Approving", ethers.formatUnits(amount, decimals), "tokens for X402...");

  const approveTx = await token.approve(X402_ADDRESS, amount);
  await approveTx.wait();
  console.log("Approve done.");

  console.log("Prepaying", units.toString(), "units...");
  const prepayTx = await x402.prepay(API_ID, units, consumerAddr);
  await prepayTx.wait();
  console.log("Prepay done.");

  const prepaid = await x402.prepaidUnits(API_ID, consumerAddr);
  console.log("Current prepaid units:", prepaid.toString());
})();
