// Minimal ABI for interacting with X402Billing in the demo backend
export const X402_ABI = [
  "event UsageReported(bytes32 indexed apiId, bytes32 indexed usageId, address indexed consumer, uint256 units, address reporter, string offchainRef)",

  "function getApiConfig(bytes32 apiId) external view returns (tuple(address provider,address paymentToken,uint256 pricePerUnit,string metadataURI,bool active))",
  "function registerApi(bytes32 apiId, address paymentToken, uint256 pricePerUnit, string metadataURI) external",
  "function updateApiConfig(bytes32 apiId, uint256 pricePerUnit, string metadataURI, bool active) external",

  "function prepay(bytes32 apiId, uint256 units, address consumer) external",
  "function prepaidUnits(bytes32 apiId, address consumer) external view returns (uint256)",

  "function reportUsage(bytes32 apiId, address consumer, uint256 units, string offchainRef) external returns (bytes32)",
  "function settleUsage(bytes32 usageId) external",

  "function providerBalance(bytes32 apiId) external view returns (uint256)"
];
