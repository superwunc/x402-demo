// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title X402Billing - Minimal X402 on-chain API billing demo
contract X402Billing {
    struct ApiConfig {
        address provider;
        address paymentToken;
        uint256 pricePerUnit; // price per unit in paymentToken
        string  metadataURI;
        bool    active;
    }

    enum UsageStatus { None, Reported, Settled }

    struct UsageRecord {
        bytes32 apiId;
        address consumer;
        uint256 units;
        uint256 pricePerUnitSnapshot;
        address paymentToken;
        UsageStatus status;
        string offchainRef; // requestId or log hash
    }

    // apiId => ApiConfig
    mapping(bytes32 => ApiConfig) private _apis;
    // apiId => consumer => prepaid units
    mapping(bytes32 => mapping(address => uint256)) private _prepaidUnits;
    // apiId => provider withdrawable balance
    mapping(bytes32 => uint256) private _providerBalances;
    // usageId => UsageRecord
    mapping(bytes32 => UsageRecord) private _usageRecords;

    event ApiRegistered(
        bytes32 indexed apiId,
        address indexed provider,
        address indexed paymentToken,
        uint256 pricePerUnit,
        string metadataURI
    );

    event ApiConfigUpdated(
        bytes32 indexed apiId,
        address indexed provider,
        uint256 pricePerUnit,
        string metadataURI,
        bool active
    );

    event UsagePrepaid(
        bytes32 indexed apiId,
        address indexed payer,
        address indexed consumer,
        uint256 units,
        uint256 amount,
        address paymentToken
    );

    event UsageReported(
        bytes32 indexed apiId,
        bytes32 indexed usageId,
        address indexed consumer,
        uint256 units,
        address reporter,
        string offchainRef
    );

    event UsageSettled(
        bytes32 indexed apiId,
        bytes32 indexed usageId,
        address indexed provider,
        uint256 units,
        uint256 amount,
        address paymentToken
    );

    event ProviderWithdraw(
        bytes32 indexed apiId,
        address indexed provider,
        uint256 amount,
        address paymentToken
    );

    modifier onlyProvider(bytes32 apiId) {
        require(_apis[apiId].provider == msg.sender, "Not API provider");
        _;
    }

    function getApiConfig(bytes32 apiId) external view returns (ApiConfig memory) {
        return _apis[apiId];
    }

    function prepaidUnits(bytes32 apiId, address consumer) external view returns (uint256) {
        return _prepaidUnits[apiId][consumer];
    }

    function providerBalance(bytes32 apiId) external view returns (uint256) {
        return _providerBalances[apiId];
    }

    function getUsage(bytes32 usageId) external view returns (UsageRecord memory) {
        return _usageRecords[usageId];
    }

    /// @notice Register a new API
    function registerApi(
        bytes32 apiId,
        address paymentToken,
        uint256 pricePerUnit,
        string calldata metadataURI
    ) external {
        ApiConfig storage cfg = _apis[apiId];
        require(cfg.provider == address(0), "API already exists");
        require(paymentToken != address(0), "Invalid payment token");
        require(pricePerUnit > 0, "Invalid price");

        cfg.provider = msg.sender;
        cfg.paymentToken = paymentToken;
        cfg.pricePerUnit = pricePerUnit;
        cfg.metadataURI = metadataURI;
        cfg.active = true;

        emit ApiRegistered(apiId, msg.sender, paymentToken, pricePerUnit, metadataURI);
    }

    /// @notice Update existing API config
    function updateApiConfig(
        bytes32 apiId,
        uint256 pricePerUnit,
        string calldata metadataURI,
        bool active
    ) external onlyProvider(apiId) {
        ApiConfig storage cfg = _apis[apiId];
        require(cfg.provider != address(0), "API not found");

        cfg.pricePerUnit = pricePerUnit;
        cfg.metadataURI = metadataURI;
        cfg.active = active;

        emit ApiConfigUpdated(apiId, cfg.provider, pricePerUnit, metadataURI, active);
    }

    /// @notice Prepay usage units for a given API
    function prepay(
        bytes32 apiId,
        uint256 units,
        address consumer
    ) external {
        ApiConfig memory cfg = _apis[apiId];
        require(cfg.provider != address(0), "API not found");
        require(cfg.active, "API not active");
        require(units > 0, "Units must be > 0");
        require(consumer != address(0), "Invalid consumer");

        uint256 amount = cfg.pricePerUnit * units;

        require(
            IERC20(cfg.paymentToken).transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );

        _prepaidUnits[apiId][consumer] += units;

        emit UsagePrepaid(apiId, msg.sender, consumer, units, amount, cfg.paymentToken);
    }

    /// @notice Report usage of prepaid units (called by gateway/meter)
    function reportUsage(
        bytes32 apiId,
        address consumer,
        uint256 units,
        string calldata offchainRef
    ) external returns (bytes32 usageId) {
        ApiConfig memory cfg = _apis[apiId];
        require(cfg.provider != address(0), "API not found");
        require(units > 0, "Units must be > 0");
        require(_prepaidUnits[apiId][consumer] >= units, "Insufficient prepaid units");

        _prepaidUnits[apiId][consumer] -= units;

        usageId = keccak256(
            abi.encodePacked(apiId, consumer, units, offchainRef, block.timestamp, block.number)
        );

        UsageRecord storage rec = _usageRecords[usageId];
        require(rec.status == UsageStatus.None, "Usage already exists");

        rec.apiId = apiId;
        rec.consumer = consumer;
        rec.units = units;
        rec.pricePerUnitSnapshot = cfg.pricePerUnit;
        rec.paymentToken = cfg.paymentToken;
        rec.status = UsageStatus.Reported;
        rec.offchainRef = offchainRef;

        emit UsageReported(apiId, usageId, consumer, units, msg.sender, offchainRef);
    }

    /// @notice Settle a previously reported usage and credit provider revenue
    function settleUsage(bytes32 usageId) external {
        UsageRecord storage rec = _usageRecords[usageId];
        require(rec.status == UsageStatus.Reported, "Usage not reportable/settleable");

        ApiConfig memory cfg = _apis[rec.apiId];
        require(cfg.provider != address(0), "API not found");

        uint256 amount = rec.units * rec.pricePerUnitSnapshot;

        _providerBalances[rec.apiId] += amount;
        rec.status = UsageStatus.Settled;

        emit UsageSettled(rec.apiId, usageId, cfg.provider, rec.units, amount, rec.paymentToken);
    }

    /// @notice Provider withdraws their revenue
    function withdrawProviderRevenue(bytes32 apiId, uint256 amount, address to) external onlyProvider(apiId) {
        require(to != address(0), "Invalid to");
        uint256 bal = _providerBalances[apiId];
        require(amount > 0 && amount <= bal, "Invalid amount");

        _providerBalances[apiId] = bal - amount;

        address token = _apis[apiId].paymentToken;
        require(IERC20(token).transfer(to, amount), "Token transfer failed");

        emit ProviderWithdraw(apiId, msg.sender, amount, token);
    }
}
