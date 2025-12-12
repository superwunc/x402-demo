# X402 Hardhat + Node.js Demo

This is a minimal end-to-end demo showing how to connect off-chain API calls
with on-chain billing using a simple X402-style smart contract.

## Structure

- `contracts/X402Billing.sol` - core on-chain billing contract
- `contracts/MockToken.sol` - simple ERC20-like token used for payments
- `scripts/deploy.js` - Hardhat deployment script
- `backend/` - Node.js API server + prepay script

## Prerequisites

- Node.js (>= 18 recommended)
- `npm` or `yarn`
- (Optional) `curl` / Postman for testing the API

## 1. Install Hardhat dependencies

```bash
cd x402-hardhat-demo
npm install
```

## 2. Start a local Hardhat node

```bash
npx hardhat node
```

Keep this process running.

## 3. Deploy contracts to localhost

Open a new terminal:

```bash
cd x402-hardhat-demo
npx hardhat run scripts/deploy.js --network localhost
```

You will see output like:

```text
Deployer: 0x...
Consumer: 0x...
MockToken deployed to: 0x...
X402Billing deployed to: 0x...

=== Copy these values into backend/.env ===
RPC_URL=http://127.0.0.1:8545
X402_ADDRESS=0x...
PAYMENT_TOKEN_ADDRESS=0x...
METER_PRIVATE_KEY=<use deployer private key>
CONSUMER_PRIVATE_KEY=<use consumer private key>
```

Copy these values into `backend/.env` (you can start from `backend/.env.example`).

For Hardhat's local network, you can grab the private keys from the `hardhat node`
console output (it prints 20 accounts with their private keys).

## 4. Install backend dependencies

```bash
cd backend
npm install
```

## 5. Prepay usage units as the consumer

Still under `backend/`:

```bash
npm run prepay
```

This will:

- Check the consumer's token balance
- Approve the X402 contract to pull payment tokens
- Prepay 10 units for the demo API
- Print the current prepaid units

## 6. Start the API server

```bash
npm start
```

You should see:

```text
Checking/initializing API config...
API registered.
X402 demo API server listening on http://localhost:3000
```

(or "API already registered" if you restarted it).

## 7. Call the demo API

In another terminal:

```bash
curl "http://localhost:3000/demo/hello" \
  -H "X-Consumer: 0x<CONSUMER_ADDRESS_FROM_HARDHAT>"
```

You should get a JSON response like:

```json
{
  "message": "Hello from X402 demo API",
  "requestId": "...",
  "consumer": "0x...",
  "billing": {
    "apiId": "0x64656d6f2f68656c6c6f0000000000000000000000000000000000000000",
    "units": 1,
    "usageId": "0x..."
  }
}
```

Behind the scenes:

- The API server calls `reportUsage` on `X402Billing`
- The contract decreases the consumer's prepaid units
- A `UsageReported` event is emitted
- The server parses the `usageId` from that event
- The server then calls `settleUsage(usageId)`
- The provider's withdrawable balance increases on-chain

You can verify provider balances and prepaid units with Hardhat console
or by writing small scripts.

## Notes

- This is a **demo**, not production-ready code.
- No signature verification is implemented for the `X-Consumer` header (for simplicity).
- In a real system you would:
  - Use EIP-712 signatures to bind the off-chain request to the on-chain account
  - Add role-based access control for who can call `reportUsage` / `settleUsage`
  - Implement better error handling and retry logic


## 8. Web Dashboard with EIP-712 Signing

- Open `backend/public/index.html` in an editor.
- Replace `<X402_ADDRESS_PLACEHOLDER>` with the deployed `X402Billing` contract address.
- Start the backend (`npm start` inside `backend/`).
- Then open http://localhost:3000 in a browser with MetaMask:
  - Click **Connect Wallet**
  - Click **Refresh Status** to see prepaid units / provider balance
  - Click **Call /demo/hello** to sign an EIP-712 payload and call the demo API


## 9. v3 Dashboard Features

- API Marketplace view (multiple APIs: Hello API, Random Number API)
- One-click prepay (frontend calls ERC20 approve + X402.prepay)
- Usage history table (`/history/:consumer`)
- Usage trend chart (calls/day) using Chart.js
- All API calls use EIP-712 signatures, verified on the backend


## 10. Product-style API Marketplace Demo (v4)

The v4 dashboard turns this repo into a tiny API marketplace product demo:

- Left: wallet connection, token balance, provider dashboard (revenue + withdraw)
- Middle: API marketplace cards (name, endpoint, on-chain price, call button)
- Right: usage KPIs, prepaid units, provider revenue, history table, and usage trend chart
- All API calls are signed via EIP-712 and metered on-chain through X402Billing

Just:
1. Deploy contracts with Hardhat as before.
2. Fill backend/.env (including X402_ADDRESS and PAYMENT_TOKEN_ADDRESS).
3. Replace the placeholders in backend/public/index.html with your deployed contract addresses.
4. Run the backend (`npm start` inside backend/) and open http://localhost:3000.
