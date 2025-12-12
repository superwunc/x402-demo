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



下面我从 **纯技术视角**（Technical Perspective）把 **x402-hardhat-demo v4** 的所有功能拆分成**系统模块（Modules）**，适合用于：

* 系统设计文档
* 技术架构图
* Jira Epic 拆解
* 代码结构规划

---

# 🧩 **X402 API Marketplace Demo v4 — 技术功能模块 (Technical Modules)**

---

# 🔶 **模块 1：Web3 身份与签名模块（Web3 Identity & EIP-712 Signing）**

## 1.1 钱包连接模块

* 使用 `window.ethereum` 与 MetaMask 建立连接
* 获取 `accounts[]`、`chainId`
* 实例化 `ethers.BrowserProvider` 与 `signer`

## 1.2 EIP-712 TypedData 构建模块

* 构造 Domain（包含 chainId、verifyingContract）
* 构建 TypedData：`Call`
* 字段：

  * `consumer`
  * `apiId`
  * `nonce`
  * `deadline`

## 1.3 前端签名模块

使用：

```js
ethereum.request({
  method: "eth_signTypedData_v4",
  params: [address, typedJson]
})
```

用于 API 调用授权（API Key → Wallet Key）

## 1.4 后端签名验证模块

通过：

```js
ethers.verifyTypedData(domain, types, message, signature)
```

实现：

* 验证调用者身份
* 确认 API 调用请求未伪造
* 验证有效期（deadline）
* 验证 nonce（当前 Demo 为时间戳型 nonce）

---

# 🔶 **模块 2：链上计量与计费模块（X402 Billing Engine Integration）**

## 2.1 reportUsage（链上记录调用）

* 后端调用：

  ```
  reportUsage(apiId, consumer, units, offchainRef)
  ```
* 解析事件 `UsageReported` 获取 `usageId`

## 2.2 settleUsage（链上结算）

* 后端调用：

```
settleUsage(usageId)
```

实时从预付费余额扣费。

## 2.3 链上 Prepaid Units 管理

* 查询：

  ```
  prepaidUnits(apiId, consumer)
  ```
* Prepay 流程：

  1. approve(token, X402, amount)
  2. prepay(apiId, units, consumer)

---

# 🔶 **模块 3：Provider 收益管理模块（Provider Revenue Management）**

## 3.1 Provider Dashboard 数据模块

后端 `/provider-info`：

* 获取 API 列表
* 查询每个 API provider 是否匹配
* 聚合 providerBalance 总收入

## 3.2 Provider 提现模块（Withdraw）

后端 `/provider/withdraw`：

* 调用：

  ```
  withdrawProviderRevenue(apiId, amount, provider)
  ```
* 管理 Provider 收益提取功能

---

# 🔶 **模块 4：API Registry & Marketplace 模块（API Definition & Metadata）**

## 4.1 API 自动注册模块（Registrar）

系统启动时后端执行：

```
ensureApisRegistered()
```

对每个 API：

* 若未注册 → 注册
* 配置：

  * provider
  * paymentToken
  * pricePerUnit
  * metadataURI

## 4.2 API 列表模块（Marketplace List）

后端 `/api-list`：

* 返回所有 API 的：

  * 名称、描述
  * endpoint
  * provider
  * pricePerUnit
  * active 状态
  * providerBalance

---

# 🔶 **模块 5：业务 API 模块（Business APIs）**

## 5.1 Hello API

* 路由：`POST /demo/hello`
* 功能：返回静态消息
* 使用链上扣费 1 unit

## 5.2 Random Number API

* 路由：`POST /random/number`
* 功能：返回随机整数
* 使用链上扣费 1 unit

---

# 🔶 **模块 6：使用记录与历史统计模块（Usage History & Analytics）**

## 6.1 使用记录（Memory Storage）

使用后端内存记录：

```
usageHistory[]
```

字段：

* usageId
* apiId
* consumer
* units
* timestamp
* requestId
* result（仅 random API）

## 6.2 调用历史 REST 模块

后端 `/history/:consumer`：

* 查询某 wallet 的调用历史
* 返回所有 API 的使用记录

## 6.3 调用趋势图表模块（Chart.js）

前端：

* 聚合历史数据（按日期统计）
* 绘制折线图（Calls Per Day）

---

# 🔶 **模块 7：状态与余额模块（Status & Balances）**

## 7.1 Token 余额模块

后端 `/token-info`：
读取 ERC20：

* balanceOf
* decimals
* symbol
* name

## 7.2 API 状态模块

后端 `/status?address=...`：
返回：

* prepaidUnits
* providerBalance
* pricePerUnit
* paymentToken

前端展示在 KPI 面板。

---

# 🔶 **模块 8：Prepay 一键预付费模块（Approve + Prepay Combo）**

流程：

1. 输入 Units
2. 查 pricePerUnit
3. 计算 total = pricePerUnit × units
4. 调用 ERC20 approve
5. 调用 X402.prepay
6. 刷新 KPI / Token Balance

该模块将 ERC20 approve + prepay 封装成一键操作。

---

# 🔶 **模块 9：UI 与可视化模块（Dashboard & Visualization）**

## 9.1 三栏式产品 UI 布局

* 左列：Wallet + Provider Dashboard
* 中列：API Marketplace + Last Call
* 右列：Usage & Billing 面板 + History 表 + Trend 图

## 9.2 API 卡片渲染模块

动态渲染 `/api-list` 返回的 API 数据。

## 9.3 调用结果显示模块

展示最后一次 API 调用的 JSON Payload。

---

# 🔶 **模块 10：系统配置模块（Config / Env）**

## 10.1 环境变量模块（backend/.env）

包括：

```
RPC_URL
X402_ADDRESS
PAYMENT_TOKEN_ADDRESS
METER_PRIVATE_KEY
CONSUMER_PRIVATE_KEY
PORT
```

## 10.2 Frontend 配置占位符

需要填入：

```js
const X402_ADDRESS = "0x...";
const PAYMENT_TOKEN_ADDRESS = "0x...";
```

---

# 🧩 总结：v4 技术模块结构图（总览）

```
┌────────────────────────────┐
│ Web3 Identity & Signature   │
└───────────────┬────────────┘
                │ EIP-712
┌───────────────▼────────────┐
│  Billing Engine (X402)      │
│  reportUsage / settleUsage  │
└───────────────┬────────────┘
                │
        ┌───────▼────────┐
        │ API Marketplace │
        └───────┬────────┘
                │ /api-list
        ┌───────▼──────────────┐
        │ Business APIs (Hello) │
        │ Business APIs (Random)│
        └────────┬──────────────┘
                 │ usageHistory
        ┌────────▼────────────┐
        │ Analytics Module     │
        │ History + Trend      │
        └────────┬────────────┘
                 │
        ┌────────▼────────────┐
        │ Wallet / Provider    │
        │ Balance / Revenue    │
        └──────────────────────┘
```


