"use strict";

function buildAppConstants(getTokenAddressByKey) {
    const TOKENS = {
        USDT: getTokenAddressByKey(11155111, "USDT"),
        USDC: getTokenAddressByKey(11155111, "USDC"),
        WETH: getTokenAddressByKey(11155111, "WETH")
    };

    const FACTORY_ABI = [
        "function deploy(uint256 value, bytes32 salt, bytes memory code) external returns (address)",
        "function computeAddress(bytes32 salt, bytes32 memory codeHash) external view returns (address)"
    ];

    const ERC20_ABI = [
        "function balanceOf(address account) view returns (uint256)"
    ];

    const VAULT_WITHDRAW_ABI = [
        "function withdrawToken(address token, address to, uint256 amount) external"
    ];

    const VAULT_SWAP_ABI = [
        "function swapToken(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) external returns (uint256)",
        "function quoteSwapOut(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)",
        "function swapRouter() view returns (address)"
    ];

    const EARN_CONTRACT_ABI = [
        "event RewardClaimed(address indexed beneficiary, address indexed token, uint256 reward, address receiver)",
        "function setApyBps(address token, uint256 apyBps) external",
        "function getApyBps(address token) view returns (uint256)",
        "function depositFor(address beneficiary, address token, uint256 amount) external",
        "function redeemFor(address beneficiary, address token, uint256 amount, address receiver) external",
        "function claimFor(address beneficiary, address token, address receiver) external returns (uint256)",
        "function getPosition(address beneficiary, address token) view returns (uint256 principal, uint256 accruedStored, uint256 claimable, uint256 lastAccruedAt)"
    ];

    const VAULT_DASHBOARD_ABI = [
        "function totalVaultBalanceUSD() view returns (uint256)",
        "function getUsdcPrice() view returns (uint256)",
        "function getUsdtPrice() view returns (uint256)",
        "function getWethPrice() view returns (uint256)"
    ];

    const DASHBOARD_TOKENS = [
        {
            symbol: "USDT",
            decimals: 6,
            displayDecimals: 2,
            priceDecimals: 8,
            address: TOKENS.USDT,
            priceMethod: "getUsdtPrice",
        },
        {
            symbol: "USDC",
            decimals: 6,
            displayDecimals: 2,
            priceDecimals: 8,
            address: TOKENS.USDC,
            priceMethod: "getUsdcPrice",
        },
        {
            symbol: "WETH",
            decimals: 18,
            displayDecimals: 18,
            priceDecimals: 8,
            address: TOKENS.WETH,
            priceMethod: "getWethPrice",
        }
    ];

    const DEFAULT_TX_PAGE_SIZE = 5;
    const VALID_SPEND_PRIORITY_TOKENS = ["USDT", "USDC", "WETH"];
    const TOKEN_DECIMALS_BY_SYMBOL = { USDT: 6, USDC: 6, WETH: 18 };
    const CARD_PAYMENT_PRIORITY_FLOW = {
        USDT: ["USDT", "USDC", "WETH"],
        USDC: ["USDC", "USDT", "WETH"],
        WETH: ["WETH", "USDT", "USDC"]
    };
    const SWAP_ALLOWED_SYMBOLS = ["USDT", "USDC", "WETH"];
    const EARN_ALLOWED_SYMBOLS = ["USDT", "USDC", "WETH"];
    const EARN_DEFAULT_APY = { USDT: 3.00, USDC: 3.01, WETH: 3.50 };
    const EARN_MIN_SUBSCRIPTION = { USDT: "10", USDC: "10", WETH: "0.005" };
    const EARN_INPUT_DECIMALS = { USDT: 2, USDC: 2, WETH: 3 };

    const FX_SUPPORTED_CURRENCIES = [
        "USD", "EUR", "GBP", "JPY", "CNY", "HKD", "SGD", "AUD", "CAD", "CHF",
        "NZD", "SEK", "NOK", "DKK", "AED", "SAR", "THB", "TWD", "MYR", "INR",
        "KRW", "IDR", "PHP", "VND", "BRL", "MXN", "ZAR", "TRY",
        "PLN", "CZK", "HUF", "RON", "ILS", "RUB", "EGP", "PKR", "BDT", "LKR"
    ];

    const LOCAL_DEV_ORIGINS = new Set([
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001"
    ]);
    const EXTERNAL_ALLOWED_ORIGINS = new Set([
        "http://172.16.230.116",
        "https://172.16.230.116",
        "http://172.16.230.116:3000",
        "http://172.16.230.116:3001",
        "http://172.16.230.116:5173",
        "https://172.16.230.116:3000",
        "https://172.16.230.116:3001",
        "https://172.16.230.116:5173"
    ]);

    return {
        TOKENS,
        FACTORY_ABI,
        ERC20_ABI,
        VAULT_WITHDRAW_ABI,
        VAULT_SWAP_ABI,
        EARN_CONTRACT_ABI,
        VAULT_DASHBOARD_ABI,
        DASHBOARD_TOKENS,
        DEFAULT_TX_PAGE_SIZE,
        VALID_SPEND_PRIORITY_TOKENS,
        TOKEN_DECIMALS_BY_SYMBOL,
        CARD_PAYMENT_PRIORITY_FLOW,
        SWAP_ALLOWED_SYMBOLS,
        EARN_ALLOWED_SYMBOLS,
        EARN_DEFAULT_APY,
        EARN_MIN_SUBSCRIPTION,
        EARN_INPUT_DECIMALS,
        FX_SUPPORTED_CURRENCIES,
        LOCAL_DEV_ORIGINS,
        EXTERNAL_ALLOWED_ORIGINS
    };
}

module.exports = {
    buildAppConstants
};

