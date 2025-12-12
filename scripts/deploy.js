const hre = require("hardhat");

async function main() {
  const [deployer, consumer] = await hre.ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Consumer:", consumer.address);

  const initialSupply = hre.ethers.parseUnits("1000000", 18);

  const MockToken = await hre.ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy("DemoToken", "DEMO", initialSupply);
  await mockToken.waitForDeployment();
  const tokenAddress = await mockToken.getAddress();
  console.log("MockToken deployed to:", tokenAddress);

  const X402Billing = await hre.ethers.getContractFactory("X402Billing");
  const x402 = await X402Billing.deploy();
  await x402.waitForDeployment();
  const x402Address = await x402.getAddress();
  console.log("X402Billing deployed to:", x402Address);

  console.log("\n=== Copy these values into backend/.env ===");
  console.log(`RPC_URL=${hre.network.config.url || "http://127.0.0.1:8545"}`);
  console.log(`X402_ADDRESS=${x402Address}`);
  console.log(`PAYMENT_TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`METER_PRIVATE_KEY=<use deployer private key>`);
  console.log(`CONSUMER_PRIVATE_KEY=<use consumer private key>`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
