// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "https://cdn.jsdelivr.net/npm/@chainlink/contracts@0.8.0/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockOracleUSDC is AggregatorV3Interface {
    int256 public price;
    uint8 public override decimals = 8; // 價格小數位數
    string public override description = "Mock USDC Price Feed";
    uint256 public override version = 1;

    constructor(int256 _initialPrice) {
        price = _initialPrice; // 例如 100000000 = $1.00000000
    }

    // 讓你隨時設定價格（測試用）
    function setPrice(int256 _price) external {
        price = _price;
    }

    // Chainlink 標準介面：返回最新價格
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }

    // 其他 Chainlink 必須實作的函數（返回假數據）
    function getRoundData(uint80)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}