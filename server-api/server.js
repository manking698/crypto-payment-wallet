require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dns = require("dns");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const { CHAIN_CONFIGS, getTokenAddressByKey } = require("./config/chainConfig");
const { deployVault } = require("../service/deploy-vault-factory");
const { createAuthSecurityService } = require("./modules/auth/service");
const { createTokenService } = require("./modules/auth/token-service");
const { createLedgerService } = require("./modules/ledger/service");
const { createSwapService } = require("./modules/swap/service");
const { createSwapHelpers } = require("./modules/swap/helpers");
const { createPaymentsService } = require("./modules/payments/service");
const { createEarnService } = require("./modules/earn/service");
const { createEarnHelpers } = require("./modules/earn/helpers");
const { createTransactionsService } = require("./modules/transactions/service");
const { createNotificationsService } = require("./modules/notifications/service");
const { createCardsService } = require("./modules/cards/service");
const { createCardPaymentService } = require("./modules/cards/payment-service");
const { createSwapOrchestrator } = require("./modules/swap/orchestrator");
const { createVaultOrchestrator } = require("./modules/vault/orchestrator");
const { createUserVaultService } = require("./modules/vault/user-vault-service");
const { createDashboardService } = require("./modules/dashboard/service");
const { createDashboardAssetsService } = require("./modules/dashboard/assets-service");
const { createEarnOrchestrator } = require("./modules/earn/orchestrator");
const { createProfileService } = require("./modules/user/profile-service");
const { createVaultSnapshotService } = require("./modules/vault/snapshot-service");
const { createFxService } = require("./modules/fx/service");
const { getClientIp, createRateLimiter, isPrivateIpv4Host } = require("./modules/common/network");
const {
    parseDateStartOfDay,
    parseDateEndOfDay,
    getStartOfDay,
    getStartOfMonth,
    decimalToScaledBigInt,
    scaledBigIntToDecimal,
    formatDisplayAmountMin2Max8Cut,
    toFixed2
} = require("./modules/common/format");
const {
    formatDisplayUnits,
    formatUsdUnits,
    formatTokenUnits,
    normalizeTransactionStatus,
    mapTransactionForClient
} = require("./modules/common/tx-mapper");
const {
    normalizeSpendPriority,
    buildCardPaymentPriority,
    normalizeCardDigits,
    getFaucetTokenList,
    getLatestUnlockAtForToken,
    applyFrozenBalanceToSnapshot,
    buildCardDeductionPlan,
    shortenMerchantNameAscii
} = require("./modules/common/card-utils");
const {
    normalizeVaultAddressInput,
    parseExpiryInput,
    sanitizeBaseCurrency
} = require("./modules/common/input");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const JWT_ISSUER = process.env.JWT_ISSUER || "vault-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "vault-wallet-app";
const AUTH_USER_LIMIT_WINDOW_MS = Number.parseInt(process.env.AUTH_USER_LIMIT_WINDOW_MS || String(60 * 1000), 10);
const AUTH_USER_LIMIT_MAX = Number.parseInt(process.env.AUTH_USER_LIMIT_MAX || "120", 10);
const LOGIN_FAIL_SHORT_LOCK_THRESHOLD = Number.parseInt(process.env.LOGIN_FAIL_SHORT_LOCK_THRESHOLD || "5", 10);
const LOGIN_FAIL_LONG_LOCK_THRESHOLD = Number.parseInt(process.env.LOGIN_FAIL_LONG_LOCK_THRESHOLD || "20", 10);
const LOGIN_FAIL_SHORT_LOCK_MS = Number.parseInt(process.env.LOGIN_FAIL_SHORT_LOCK_MS || String(10 * 60 * 1000), 10);
const LOGIN_FAIL_LONG_LOCK_MS = Number.parseInt(process.env.LOGIN_FAIL_LONG_LOCK_MS || String(24 * 60 * 60 * 1000), 10);
const LOGIN_FAIL_RESET_WINDOW_MS = Number.parseInt(process.env.LOGIN_FAIL_RESET_WINDOW_MS || String(24 * 60 * 60 * 1000), 10);

const apiBaseLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 180,
    message: "request rate limit exceeded"
});

const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 12,
    keyFn: (req) => {
        const email = String(req.body?.email || "").trim().toLowerCase();
        return `${email || "unknown-email"}`;
    },
    message: "too many login attempts, please try again later"
});

const faucetLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    keyFn: (req) => {
        const vaultAddress = String(req.body?.vaultAddress || req.query?.vaultAddress || "").trim().toLowerCase();
        return `${getClientIp(req)}|${vaultAddress || "unknown-vault"}`;
    },
    message: "faucet request too frequent, please try again later"
});

const publicLookupLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 40,
    keyFn: (req) => getClientIp(req),
    message: "lookup request too frequent, please try again later"
});

const authUserLimiter = createRateLimiter({
    windowMs: Number.isFinite(AUTH_USER_LIMIT_WINDOW_MS) && AUTH_USER_LIMIT_WINDOW_MS > 0 ? AUTH_USER_LIMIT_WINDOW_MS : (60 * 1000),
    max: Number.isFinite(AUTH_USER_LIMIT_MAX) && AUTH_USER_LIMIT_MAX > 0 ? AUTH_USER_LIMIT_MAX : 120,
    keyFn: (req) => {
        const userId = String(req.authUser?._id || "").trim();
        return userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
    },
    message: "too many authenticated requests, please try again later"
});

const authSecurityService = createAuthSecurityService({
    shortLockThreshold: LOGIN_FAIL_SHORT_LOCK_THRESHOLD,
    longLockThreshold: LOGIN_FAIL_LONG_LOCK_THRESHOLD,
    shortLockMs: LOGIN_FAIL_SHORT_LOCK_MS,
    longLockMs: LOGIN_FAIL_LONG_LOCK_MS,
    resetWindowMs: LOGIN_FAIL_RESET_WINDOW_MS
});
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

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (LOCAL_DEV_ORIGINS.has(origin)) return callback(null, true);
        if (EXTERNAL_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        try {
            const url = new URL(origin);
            if ((url.protocol === "http:" || url.protocol === "https:") && isPrivateIpv4Host(url.hostname)) {
                return callback(null, true);
            }
        } catch (_err) {
            // fall through
        }
        return callback(new Error("CORS blocked origin"));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use("/api", apiBaseLimiter);

dns.setServers(["8.8.8.8", "8.8.4.4"]);
console.log("Using Google DNS 8.8.8.8");

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection failed:", err.message));

const transactionSchema = new mongoose.Schema({
    blockNumber: Number,
    txHash: String,
    from: String,
    to: String,
    amount: String,
    tokenSymbol: String,
    direction: String,
    type: String,
    timestamp: Date,
}, { strict: false });

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    defaultChainId: { type: Number, default: 11155111 },
    spendPriorityToken: { type: String, enum: ["USDT", "USDC", "WETH"], default: "USDT" },
    displayCurrency: { type: String, default: "USD" },
    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: null }
});

const userVaultSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    chainId: { type: Number, required: true },
    vaultAddress: { type: String, required: true, lowercase: true, trim: true },
    salt: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
userVaultSchema.index({ userId: 1, chainId: 1 }, { unique: true });
userVaultSchema.index({ chainId: 1, vaultAddress: 1 }, { unique: true });

const userCardSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    cardholderName: { type: String, required: true, trim: true },
    nickname: { type: String, required: false, trim: true, default: "" },
    cardNumber: { type: String, required: true },
    expiryMonth: { type: String, required: true },
    expiryYear: { type: String, required: true },
    cvv: { type: String, required: true },
    pin: { type: String, required: true },
    status: { type: String, enum: ["active", "frozen"], default: "active" },
    perTransactionLimitUsd: { type: Number, default: 1000 },
    dailyLimitUsd: { type: Number, default: 50000 },
    monthlyLimitUsd: { type: Number, default: 200000 },
    vaultDailyLimitUsd: { type: Number, default: 100000 },
    vaultMonthlyLimitUsd: { type: Number, default: 1000000 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
userCardSchema.index({ userId: 1, createdAt: -1 });

// Card payment journal for settlement/audit and limit tracking.
const cardPaymentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    cardId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    paymentCurrency: { type: String, required: true, uppercase: true, trim: true },
    paymentAmount: { type: String, required: true },
    usdAmount: { type: String, required: true },
    cardLast4: { type: String, default: "" },
    fxBase: { type: String, default: "USD" },
    fxRateUsdToPayment: { type: String, required: true },
    spendPriorityToken: { type: String, enum: ["USDT", "USDC", "WETH"], required: true },
    merchantName: { type: String, default: "" },
    merchantRef: { type: String, default: "" },
    status: { type: String, enum: ["processing", "completed", "failed", "partial_failed"], default: "processing" },
    // Full multi-asset planned deduction breakdown for this payment.
    plannedTokens: { type: Array, default: [] },
    // Reserved token balance while blockchain tx is still pending.
    reservedTokens: { type: Array, default: [] },
    deductedTokens: { type: Array, default: [] },
    txHashes: { type: [String], default: [] },
    errorMessage: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });
cardPaymentSchema.index({ userId: 1, cardId: 1, createdAt: -1 });

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ["transaction", "system"], required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false, index: true },
    relatedTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    readAt: { type: Date, default: null }
}, { strict: false });
notificationSchema.index({ userId: 1, createdAt: -1 });

const faucetClaimSchema = new mongoose.Schema({
    vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
    claimType: { type: String, enum: ["USDT", "USDC", "WETH", "ALL"], required: true, index: true },
    tokenSymbols: { type: [String], default: [] },
    tokenAmount: { type: String, default: "100" },
    txHashes: { type: [String], default: [] },
    senderAddress: { type: String, default: "" },
    chainId: { type: Number, default: 11155111 },
    createdAt: { type: Date, default: Date.now, index: true }
}, { strict: false });
faucetClaimSchema.index({ vaultAddress: 1, createdAt: -1 });

// Ledger outbox for eventual consistency:
// when chain tx succeeds but transaction journal write fails, payload is queued here for retry.
const ledgerOutboxSchema = new mongoose.Schema({
    dedupeKey: { type: String, required: true, index: true, unique: true },
    status: { type: String, enum: ["pending", "processed", "failed"], default: "pending", index: true },
    txHash: { type: String, default: "", index: true },
    chainId: { type: Number, default: 11155111, index: true },
    direction: { type: String, default: "", index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    retries: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });
ledgerOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });

const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);
const UserVault = mongoose.models.UserVault || mongoose.model("UserVault", userVaultSchema);
const UserCard = mongoose.models.UserCard || mongoose.model("UserCard", userCardSchema);
const CardPayment = mongoose.models.CardPayment || mongoose.model("CardPayment", cardPaymentSchema);
const Notification = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
const FaucetClaim = mongoose.models.FaucetClaim || mongoose.model("FaucetClaim", faucetClaimSchema);
const LedgerOutbox = mongoose.models.LedgerOutbox || mongoose.model("LedgerOutbox", ledgerOutboxSchema);

const provider = new ethers.JsonRpcProvider(CHAIN_CONFIGS.sepolia.RPC.http[0]);
const backendPrivateKey = process.env.PRIVATE_KEY;
const backendSigner = new ethers.Wallet(backendPrivateKey, provider);

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const FACTORY_ABI = [
    "function deploy(uint256 value, bytes32 salt, bytes memory code) external returns (address)",
    "function computeAddress(bytes32 salt, bytes32 memory codeHash) external view returns (address)"
];
const JWT_SECRET = process.env.JWT_SECRET || "wallet-app-dev-secret";

const TOKENS = {
    USDT: getTokenAddressByKey(11155111, "USDT"),
    USDC: getTokenAddressByKey(11155111, "USDC"),
    WETH: getTokenAddressByKey(11155111, "WETH")
};

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
const EARN_CONTRACT_ADDRESS = String(process.env.EARN_CONTRACT_ADDRESS || "").trim();
const CARD_GLOBAL_MONTHLY_LIMIT_USD = Number.parseFloat(process.env.CARD_GLOBAL_MONTHLY_LIMIT_USD || "1000000");

const FX_SUPPORTED_CURRENCIES = [
    "USD", "EUR", "GBP", "JPY", "CNY", "HKD", "SGD", "AUD", "CAD", "CHF",
    "NZD", "SEK", "NOK", "DKK", "AED", "SAR", "THB", "TWD", "MYR", "INR",
    "KRW", "IDR", "PHP", "VND", "BRL", "MXN", "ZAR", "TRY",
    "PLN", "CZK", "HUF", "RON", "ILS", "RUB", "EGP", "PKR", "BDT", "LKR"
];

const profileService = createProfileService({
    VALID_SPEND_PRIORITY_TOKENS,
    FX_SUPPORTED_CURRENCIES
});
const tokenService = createTokenService({
    jwt,
    User,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
    jwtIssuer: JWT_ISSUER,
    jwtAudience: JWT_AUDIENCE
});
const userVaultService = createUserVaultService({
    UserVault,
    logger: console
});

const encoded = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [backendSigner.address]);
const VAULT_FACTORY_BYTECODE = process.env.USER_VAULT_BYTECODE + encoded.slice(2);

function getSalt(email) {
    return ethers.keccak256(ethers.toUtf8Bytes(email));
}

const notificationsService = createNotificationsService({ Notification, mongoose });
const createNotification = (input) => notificationsService.createNotification(input);

const ledgerService = createLedgerService({
    Transaction,
    LedgerOutbox,
    logger: console
});
const persistLedgerTransaction = (payload) => ledgerService.persistTransaction(payload);
const swapService = createSwapService({
    persistLedgerTransaction,
    Transaction,
    createNotification
});
const paymentsService = createPaymentsService({
    persistLedgerTransaction,
    CardPayment,
    Transaction,
    createNotification
});
const earnService = createEarnService({
    Transaction,
    createNotification,
    formatDisplayAmount: formatDisplayAmountMin2Max8Cut
});
const vaultSnapshotService = createVaultSnapshotService({
    ethers,
    provider,
    CardPayment,
    TOKENS,
    TOKEN_DECIMALS_BY_SYMBOL,
    VALID_SPEND_PRIORITY_TOKENS,
    VAULT_DASHBOARD_ABI,
    ERC20_ABI
});
const fxService = createFxService({ fetchImpl: fetch });
const swapHelpers = createSwapHelpers({ SWAP_ALLOWED_SYMBOLS });
const earnHelpers = createEarnHelpers({
    ethers,
    EARN_ALLOWED_SYMBOLS,
    EARN_INPUT_DECIMALS,
    EARN_MIN_SUBSCRIPTION,
    TOKEN_DECIMALS_BY_SYMBOL,
    TOKENS,
    EARN_CONTRACT_ADDRESS,
    EARN_CONTRACT_ABI,
    provider,
    backendSigner,
    decimalToScaledBigInt
});
const transactionsService = createTransactionsService({
    Transaction,
    CardPayment,
    mapTransactionForClient,
    enrichCardPaymentRows,
    parseDateStartOfDay,
    parseDateEndOfDay,
    DEFAULT_TX_PAGE_SIZE,
    mongoose
});
const cardsService = createCardsService({
    UserCard,
    mongoose,
    normalizeCardDigits,
    parseExpiryInput,
    maskCardForClient: profileService.maskCardForClient,
    nowFactory: () => new Date()
});
const cardPaymentService = createCardPaymentService({
    mongoose,
    ethers,
    User,
    UserVault,
    CardPayment,
    backendSigner,
    provider,
    TOKENS,
    ERC20_ABI,
    VAULT_WITHDRAW_ABI,
    FX_SUPPORTED_CURRENCIES,
    VALID_SPEND_PRIORITY_TOKENS,
    CARD_GLOBAL_MONTHLY_LIMIT_USD,
    normalizeCardDigits,
    decimalToScaledBigInt,
    scaledBigIntToDecimal,
    fetchLiveFxRates: fxService.fetchLiveFxRates,
    getVaultTokenSnapshot: vaultSnapshotService.getVaultTokenSnapshot,
    getFrozenTokenRawByVault: vaultSnapshotService.getFrozenTokenRawByVault,
    applyFrozenBalanceToSnapshot: (snapshotBySymbol, frozenBySymbol) =>
        applyFrozenBalanceToSnapshot(snapshotBySymbol, frozenBySymbol, VALID_SPEND_PRIORITY_TOKENS),
    normalizeSpendPriority: (token) => normalizeSpendPriority(token, VALID_SPEND_PRIORITY_TOKENS),
    buildCardPaymentPriority: (spendPriorityToken) =>
        buildCardPaymentPriority(spendPriorityToken, CARD_PAYMENT_PRIORITY_FLOW, VALID_SPEND_PRIORITY_TOKENS),
    buildCardDeductionPlan,
    getStartOfDay,
    getStartOfMonth,
    shortenMerchantNameAscii,
    paymentsService,
    cardsService,
    toFixed2
});
const swapOrchestrator = createSwapOrchestrator({
    ethers,
    provider,
    backendSigner,
    TOKENS,
    TOKEN_DECIMALS_BY_SYMBOL,
    VAULT_SWAP_ABI,
    ERC20_ABI,
    normalizeSwapSymbol: swapHelpers.normalizeSwapSymbol,
    decimalToScaledBigInt,
    scaledBigIntToDecimal,
    getVaultTokenSnapshot: vaultSnapshotService.getVaultTokenSnapshot,
    getFrozenTokenRawByVault: vaultSnapshotService.getFrozenTokenRawByVault,
    applyFrozenBalanceToSnapshot,
    buildSwapQuoteBySnapshot: swapHelpers.buildSwapQuoteBySnapshot,
    swapService
});
const vaultOrchestrator = createVaultOrchestrator({
    ethers,
    provider,
    backendSigner,
    TOKENS,
    VAULT_WITHDRAW_ABI,
    User,
    computeVaultAddress,
    ensureUserVault: userVaultService.ensureUserVault,
    ensureUserVaultByAddress: userVaultService.ensureUserVaultByAddress,
    getFrozenTokenRawByVault: vaultSnapshotService.getFrozenTokenRawByVault,
    persistLedgerTransaction
});
const dashboardService = createDashboardService({
    buildDashboardAssets: createDashboardAssetsService({
        DASHBOARD_TOKENS,
        VALID_SPEND_PRIORITY_TOKENS,
        formatTokenUnits,
        formatDisplayUnits,
        formatUsdUnits,
        getVaultTokenSnapshot: vaultSnapshotService.getVaultTokenSnapshot,
        getFrozenTokenRawByVault: vaultSnapshotService.getFrozenTokenRawByVault,
        applyFrozenBalanceToSnapshot,
        logger: console
    }).buildDashboardAssets,
    transactionsService,
    VALID_SPEND_PRIORITY_TOKENS
});
const earnOrchestrator = createEarnOrchestrator({
    ethers,
    Transaction,
    EARN_ALLOWED_SYMBOLS,
    EARN_DEFAULT_APY,
    EARN_MIN_SUBSCRIPTION,
    TOKEN_DECIMALS_BY_SYMBOL,
    EARN_CONTRACT_ADDRESS,
    VAULT_WITHDRAW_ABI,
    backendSigner,
    getEarnContracts: earnHelpers.getEarnContracts,
    getVaultTokenSnapshot: vaultSnapshotService.getVaultTokenSnapshot,
    getEarnTokenAddress: earnHelpers.getEarnTokenAddress,
    parseEarnAmount: earnHelpers.parseEarnAmount,
    normalizeTransactionStatus,
    parseDateStartOfDay,
    parseDateEndOfDay,
    transactionsService,
    earnService
});

async function enrichCardPaymentRows(mappedItems) {
    const paymentIds = mappedItems
        .filter((tx) => String(tx?.direction || "").toLowerCase() === "card-payment")
        .map((tx) => String(tx?.paymentId || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!paymentIds.length) return mappedItems;

    const payments = await CardPayment.find({ _id: { $in: paymentIds } })
        .select({ paymentCurrency: 1, paymentAmount: 1, usdAmount: 1, merchantName: 1, deductedTokens: 1, plannedTokens: 1, cardLast4: 1 })
        .lean();
    const paymentMap = new Map(payments.map((p) => [String(p._id), p]));

    return mappedItems.map((tx) => {
        if (String(tx?.direction || "").toLowerCase() !== "card-payment") return tx;
        const pid = String(tx?.paymentId || "").trim();
        const payment = paymentMap.get(pid);
        if (!payment) return tx;

        const paymentCurrency = String(payment.paymentCurrency || tx.paymentCurrency || "").toUpperCase();
        const paymentAmount = String(payment.paymentAmount || tx.paymentAmount || "0");
        const usdAmount = String(payment.usdAmount || "0");

        return {
            ...tx,
            merchant: String(payment.merchantName || tx.merchant || ""),
            amountPrimary: `${paymentCurrency} ${toFixed2(paymentAmount)}`.trim(),
            amountSecondary: `- $${toFixed2(usdAmount)}`,
            cardLast4: String(payment.cardLast4 || tx.cardLast4 || ""),
            cardPayment: {
                id: String(payment._id || ""),
                paymentCurrency,
                paymentAmount,
                usdAmount,
                cardLast4: String(payment.cardLast4 || tx.cardLast4 || ""),
                deductedTokens: Array.isArray(payment.deductedTokens) ? payment.deductedTokens : [],
                plannedTokens: Array.isArray(payment.plannedTokens) ? payment.plannedTokens : []
            }
        };
    });
}

async function computeVaultAddress(email) {
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, backendSigner);
    const salt = getSalt(email);
    const codeHash = ethers.keccak256(VAULT_FACTORY_BYTECODE);
    return factory.computeAddress(salt, codeHash);
}

async function requireAuth(req, res, next) {
    try {
        const token = tokenService.getAuthToken(req);
        if (!token) {
            return res.status(401).json({ error: "missing auth token" });
        }

        const { payload, user } = await tokenService.verifyAuthToken(token);
        if (!user) {
            return res.status(401).json({ error: "user not found" });
        }

        const chainId = Number(payload.defaultChainId || user.defaultChainId || 11155111);
        const fallbackAddress = await computeVaultAddress(user.email);
        const vaultRecord = await userVaultService.ensureUserVault(user, chainId)
            || await userVaultService.ensureUserVaultByAddress(chainId, fallbackAddress);

        req.authUser = user;
        req.authVault = vaultRecord || null;
        return next();
    } catch (_err) {
        return res.status(401).json({ error: "invalid auth token" });
    }
}

app.post("/api/auth/register", authLimiter, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
        return res.status(400).json({ error: "email and password are required" });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
        return res.status(409).json({ error: "email already registered" });
    }

    try {
        const salt = deployVault.getSalt(email);
        const deployResult = await deployVault.deploy(11155111, salt);
        if (!deployResult.result && deployResult.message !== "already deployed") {
            return res.status(500).json({ error: deployResult.message || "vault deploy failed" });
        }

        const vaultAddress = String(deployResult.address || await computeVaultAddress(email)).toLowerCase();
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({
            email,
            passwordHash,
            defaultChainId: 11155111,
            lastLoginAt: new Date()
        });
        await UserVault.create({
            userId: user._id,
            chainId: 11155111,
            vaultAddress,
            salt
        });
        await createNotification({
            userId: user._id,
            type: "system",
            title: "Welcome",
            message: "Your wallet account is ready"
        });

        return res.status(201).json({
            token: tokenService.createAuthToken(user),
            user: profileService.buildUserProfile(user, {
                vaultAddress,
                chainId: 11155111
            })
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "register failed: " + err.message });
    }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const loginKey = authSecurityService.buildLoginKey(email);
    const lockState = authSecurityService.getLoginLockState(loginKey);

    if (!email || !password) {
        return res.status(400).json({ error: "email and password are required" });
    }
    if (lockState.blocked) {
        res.setHeader("Retry-After", String(lockState.retryAfterSec || 60));
        return res.status(429).json({ error: "too many failed login attempts, please try again later" });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) {
            authSecurityService.registerLoginFailure(loginKey);
            return res.status(401).json({ error: "invalid email or password" });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            authSecurityService.registerLoginFailure(loginKey);
            return res.status(401).json({ error: "invalid email or password" });
        }

        authSecurityService.clearLoginFailure(loginKey);
        user.lastLoginAt = new Date();
        await user.save();
        const fallbackAddress = await computeVaultAddress(user.email);
        const vaultRecord = await userVaultService.ensureUserVault(user, user.defaultChainId || 11155111)
            || await userVaultService.ensureUserVaultByAddress(user.defaultChainId || 11155111, fallbackAddress);

        return res.json({
            token: tokenService.createAuthToken(user),
            user: profileService.buildUserProfile(user, vaultRecord)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "login failed: " + err.message });
    }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
    return res.json({
        user: profileService.buildUserProfile(req.authUser, req.authVault)
    });
});

app.post("/api/auth/logout", (_req, res) => {
    return res.json({ success: true });
});

app.post("/api/auth/change-password", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const oldPassword = String(req.body?.oldPassword || "");
        const newPassword = String(req.body?.newPassword || "");
        const confirmPassword = String(req.body?.confirmPassword || "");

        if (!oldPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ error: "old password, new password and confirm password are required" });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "new password must be at least 8 characters" });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: "new password and confirm password do not match" });
        }
        if (oldPassword === newPassword) {
            return res.status(400).json({ error: "new password must be different from old password" });
        }

        const userDoc = await User.findById(req.authUser._id);
        if (!userDoc) {
            return res.status(404).json({ error: "user not found" });
        }

        const matched = await bcrypt.compare(oldPassword, String(userDoc.passwordHash || ""));
        if (!matched) {
            return res.status(400).json({ error: "old password is incorrect" });
        }

        userDoc.passwordHash = await bcrypt.hash(newPassword, 10);
        await userDoc.save();

        return res.json({ success: true, message: "password changed" });
    } catch (err) {
        console.error("[auth] change-password failed:", err.message);
        return res.status(500).json({ error: "change password failed" });
    }
});

app.get("/api/fx/latest", async (req, res) => {
    try {
        const base = sanitizeBaseCurrency(req.query?.base, FX_SUPPORTED_CURRENCIES);
        const result = await fxService.fetchLiveFxRates(base);

        // Keep only rates we use in UI to reduce payload.
        const filteredRates = {};
        for (const code of FX_SUPPORTED_CURRENCIES) {
            if (code === result.base) {
                filteredRates[code] = 1;
                continue;
            }
            const rate = Number(result.rates?.[code]);
            if (Number.isFinite(rate) && rate > 0) {
                filteredRates[code] = rate;
            }
        }

        return res.json({
            provider: result.provider,
            base: result.base,
            updatedAt: result.updatedAt,
            rates: filteredRates
        });
    } catch (err) {
        console.error("[fx] latest failed:", err.message);
        return res.status(500).json({ error: "fx latest failed" });
    }
});

app.get("/api/faucet/status", faucetLimiter, async (req, res) => {
    try {
        const vaultAddress = normalizeVaultAddressInput(req.query?.vaultAddress, ethers);
        const claimTypeRaw = String(req.query?.claimType || "").trim().toUpperCase();
        const claimType = ["USDT", "USDC", "WETH", "ALL"].includes(claimTypeRaw) ? claimTypeRaw : "USDT";
        if (!vaultAddress) {
            return res.status(400).json({ error: "invalid vault address" });
        }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rows = await FaucetClaim.find({
            vaultAddress,
            createdAt: { $gte: since }
        }).sort({ createdAt: 1 }).lean();

        const requestedTokens = getFaucetTokenList(claimType);
        const blockedUntilList = requestedTokens
            .map((symbol) => getLatestUnlockAtForToken(rows, symbol))
            .filter(Boolean);
        const nextClaimAt = blockedUntilList.length
            ? new Date(Math.max(...blockedUntilList.map((d) => d.getTime())))
            : null;
        const eligibleNow = !nextClaimAt;

        return res.json({
            vaultAddress,
            claimType,
            eligibleNow,
            nextClaimAt: nextClaimAt ? nextClaimAt.toISOString() : null
        });
    } catch (err) {
        console.error("[faucet] status failed:", err.message);
        return res.status(500).json({ error: "faucet status failed" });
    }
});

app.post("/api/faucet/claim", faucetLimiter, async (req, res) => {
    try {
        const vaultAddress = normalizeVaultAddressInput(req.body?.vaultAddress, ethers);
        const claimTypeRaw = String(req.body?.claimType || "").trim().toUpperCase();
        const claimType = ["USDT", "USDC", "WETH", "ALL"].includes(claimTypeRaw) ? claimTypeRaw : "";
        if (!vaultAddress) {
            return res.status(400).json({ error: "invalid vault address" });
        }
        if (!claimType) {
            return res.status(400).json({ error: "invalid claim type" });
        }
        if (!backendPrivateKey || !backendSigner?.address) {
            return res.status(500).json({ error: "faucet signer is not configured" });
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rows = await FaucetClaim.find({
            vaultAddress,
            createdAt: { $gte: since }
        }).sort({ createdAt: 1 }).lean();

        const tokenSymbols = getFaucetTokenList(claimType);
        const blockedUntilList = tokenSymbols
            .map((symbol) => getLatestUnlockAtForToken(rows, symbol))
            .filter(Boolean);
        if (blockedUntilList.length > 0) {
            const nextClaimAt = new Date(Math.max(...blockedUntilList.map((d) => d.getTime())));
            return res.status(429).json({
                error: `Claim completed for today. Please claim again after ${nextClaimAt.toISOString()}`,
                nextClaimAt: nextClaimAt.toISOString()
            });
        }

        const tokenDecimals = { USDT: 6, USDC: 6, WETH: 18 };
        const faucetTokenAmounts = { USDT: "500", USDC: "1000", WETH: "0.15" };
        const txHashes = [];
        const tokenAmountBySymbol = {};
        for (const symbol of tokenSymbols) {
            const tokenAddress = TOKENS[symbol];
            if (!tokenAddress) throw new Error(`missing token address for ${symbol}`);
            const tokenC = new ethers.Contract(tokenAddress, [
                "function transfer(address to, uint256 amount) returns (bool)"
            ], backendSigner);
            const amountText = String(faucetTokenAmounts[symbol] || "0");
            const amountRaw = ethers.parseUnits(amountText, tokenDecimals[symbol]);
            const tx = await tokenC.transfer(vaultAddress, amountRaw);
            const receipt = await tx.wait();
            if (!receipt || Number(receipt.status) !== 1) {
                throw new Error(`faucet transfer failed for ${symbol}`);
            }
            tokenAmountBySymbol[symbol] = amountText;
            txHashes.push(String(tx.hash || "").toLowerCase());
        }

        const claim = await FaucetClaim.create({
            vaultAddress,
            claimType,
            tokenSymbols,
            tokenAmount: claimType === "ALL" ? "mixed" : String(tokenAmountBySymbol[tokenSymbols[0]] || ""),
            tokenAmountBySymbol,
            txHashes,
            senderAddress: String(process.env.SIGNER_ADDRESS || backendSigner.address || "").toLowerCase(),
            chainId: 11155111,
            createdAt: new Date()
        });

        return res.json({
            success: true,
            claimId: String(claim._id),
            vaultAddress,
            claimType,
            tokenSymbols,
            tokenAmount: claimType === "ALL" ? "mixed" : String(tokenAmountBySymbol[tokenSymbols[0]] || ""),
            tokenAmountBySymbol,
            txHashes
        });
    } catch (err) {
        console.error("[faucet] claim failed:", err.message);
        return res.status(500).json({ error: err.message || "faucet claim failed" });
    }
});

app.get("/api/user/spend-priority", requireAuth, authUserLimiter, async (req, res) => {
    const spendPriorityToken = VALID_SPEND_PRIORITY_TOKENS.includes(String(req.authUser?.spendPriorityToken || "").toUpperCase())
        ? String(req.authUser.spendPriorityToken).toUpperCase()
        : "USDT";

    return res.json({ spendPriorityToken });
});

app.post("/api/user/spend-priority", requireAuth, authUserLimiter, async (req, res) => {
    const token = String(req.body?.token || "").trim().toUpperCase();
    if (!VALID_SPEND_PRIORITY_TOKENS.includes(token)) {
        return res.status(400).json({ error: "invalid spend priority token" });
    }

    await User.updateOne(
        { _id: req.authUser._id },
        { $set: { spendPriorityToken: token } }
    );

    return res.json({ success: true, spendPriorityToken: token });
});

app.post("/api/user/display-currency", requireAuth, authUserLimiter, async (req, res) => {
    const currency = String(req.body?.currency || "").trim().toUpperCase();
    if (!FX_SUPPORTED_CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: "invalid display currency" });
    }

    await User.updateOne(
        { _id: req.authUser._id },
        { $set: { displayCurrency: currency } }
    );

    return res.json({ success: true, displayCurrency: currency });
});

app.get("/api/earn/summary", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await earnOrchestrator.getSummary(vaultAddress);
        return res.json(payload);
    } catch (err) {
        console.error("[earn] summary failed:", err.message);
        return res.status(500).json({ error: err.message || "earn summary failed" });
    }
});

app.get("/api/earn/history", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await earnOrchestrator.getHistory(vaultAddress, req.query || {});
        return res.json(payload);
    } catch (err) {
        console.error("[earn] history failed:", err.message);
        return res.status(500).json({ error: err.message || "earn history failed" });
    }
});

app.post("/api/earn/subscribe", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await earnOrchestrator.subscribe(
            vaultAddress,
            req.body?.token,
            req.body?.amount,
            req.authUser._id
        );
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            return res.status(err.status).json({ error: err.message || "earn subscribe failed" });
        }
        console.error("[earn] subscribe failed:", err.message);
        return res.status(500).json({ error: err.message || "earn subscribe failed" });
    }
});

app.post("/api/earn/redeem", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await earnOrchestrator.redeem(
            vaultAddress,
            req.body?.token,
            req.body?.amount,
            req.authUser._id
        );
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            return res.status(err.status).json({ error: err.message || "earn redemption failed" });
        }
        console.error("[earn] redemption failed:", err.message);
        return res.status(500).json({ error: err.message || "earn redemption failed" });
    }
});

app.post("/api/earn/claim", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await earnOrchestrator.claim(
            vaultAddress,
            req.body?.token,
            req.authUser._id
        );
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            return res.status(err.status).json({ error: err.message || "earn claim failed" });
        }
        console.error("[earn] claim failed:", err.message);
        return res.status(500).json({ error: err.message || "earn claim failed" });
    }
});

app.get("/api/notifications", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const notifications = await notificationsService.listByUser(
            req.authUser._id,
            req.query?.type || "all",
            req.query?.limit || 20
        );
        return res.json({ notifications });
    } catch (err) {
        console.error("[notifications] list failed:", err.message);
        return res.status(500).json({ error: "notification list failed" });
    }
});

app.get("/api/notifications/unread-count", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const unreadCount = await notificationsService.getUnreadCount(req.authUser._id);
        return res.json({ unreadCount });
    } catch (err) {
        console.error("[notifications] unread count failed:", err.message);
        return res.status(500).json({ error: "notification unread count failed" });
    }
});

app.post("/api/notifications/:id/read", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        const result = await notificationsService.markRead(req.authUser._id, id);
        return res.json({ success: true, unreadCount: result.unreadCount, notification: result.notification });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: "invalid notification id" });
        if (err?.status === 404) return res.status(404).json({ error: "notification not found" });
        console.error("[notifications] read failed:", err.message);
        return res.status(500).json({ error: "notification update failed" });
    }
});

app.post("/api/notifications/system", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const notification = await notificationsService.createSystemNotification(
            req.authUser._id,
            req.body?.title,
            req.body?.message
        );
        return res.status(201).json({ success: true, notification });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: "title and message are required" });
        console.error("[notifications] create system failed:", err.message);
        return res.status(500).json({ error: "notification create failed" });
    }
});

app.get("/api/cards", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const cards = await cardsService.listCardsByUser(req.authUser._id);
        return res.json({ cards });
    } catch (err) {
        console.error("[cards] list failed:", err.message);
        return res.status(500).json({ error: "card query failed" });
    }
});

app.post("/api/cards", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const card = await cardsService.createCard({
            userId: req.authUser._id,
            vaultAddress: String(req.authVault?.vaultAddress || "").toLowerCase(),
            email: req.authUser.email,
            cardholderName: req.body?.cardholderName,
            nickname: req.body?.nickname,
            pin: req.body?.pin
        });
        return res.status(201).json({ success: true, card });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: err.message });
        console.error("[cards] create failed:", err.message);
        return res.status(500).json({ error: "card create failed" });
    }
});

async function updateCardHandler(req, res) {
    try {
        const CARD_LIMIT_MAX_USD = 1000000;
        const card = await cardsService.updateCard({
            userId: req.authUser._id,
            cardId: String(req.params.id || "").trim(),
            payload: req.body || {},
            maxLimitUsd: CARD_LIMIT_MAX_USD
        });
        return res.json({ success: true, card });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: err.message });
        if (err?.status === 404) return res.status(404).json({ error: "card not found" });
        console.error("[cards] update failed:", err.message);
        return res.status(500).json({ error: "card update failed" });
    }
}

app.patch("/api/cards/:id", requireAuth, updateCardHandler);
app.post("/api/cards/:id/update", requireAuth, updateCardHandler);

app.post("/api/cards/:id/freeze", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const card = await cardsService.freezeCard({
            userId: req.authUser._id,
            cardId: String(req.params.id || "").trim()
        });
        return res.json({ success: true, card });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: "invalid card id" });
        if (err?.status === 404) return res.status(404).json({ error: "card not found" });
        console.error("[cards] freeze failed:", err.message);
        return res.status(500).json({ error: "card freeze failed" });
    }
});

app.post("/api/cards/:id/unfreeze", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const card = await cardsService.unfreezeCard({
            userId: req.authUser._id,
            cardId: String(req.params.id || "").trim()
        });
        return res.json({ success: true, card });
    } catch (err) {
        if (err?.status === 400) return res.status(400).json({ error: "invalid card id" });
        if (err?.status === 404) return res.status(404).json({ error: "card not found" });
        console.error("[cards] unfreeze failed:", err.message);
        return res.status(500).json({ error: "card unfreeze failed" });
    }
});

// Card payment settlement:
// 1) convert payment currency to USD
// 2) split deduction by spendPriorityToken flow
// 3) withdraw token(s) from vault
// 4) persist payment + transaction journals
app.post("/api/cards/payments", authUserLimiter, async (req, res) => {
    try {
        const result = await cardPaymentService.processPayment(req.body || {});
        return res.json(result);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            const body = { error: err.message || "card payment failed" };
            if (typeof err.requiredUsd !== "undefined") body.requiredUsd = err.requiredUsd;
            if (typeof err.availableUsd !== "undefined") body.availableUsd = err.availableUsd;
            if (typeof err.frozenUsd !== "undefined") body.frozenUsd = err.frozenUsd;
            if (typeof err.remainingUsd !== "undefined") body.remainingUsd = err.remainingUsd;
            if (typeof err.paymentId !== "undefined") body.paymentId = err.paymentId;
            if (typeof err.txHashes !== "undefined") body.txHashes = err.txHashes;
            return res.status(err.status).json(body);
        }
        console.error("[card-payment] failed:", err.message);
        return res.status(500).json({ error: "card payment failed" });
    }
});

app.post("/api/swap/quote", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await swapOrchestrator.quote(req.body || {}, vaultAddress);
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            const body = { error: err.message || "swap quote failed" };
            if (typeof err.available !== "undefined") body.available = err.available;
            return res.status(err.status).json(body);
        }
        const detail = String(err?.reason || err?.shortMessage || err?.message || "swap quote failed");
        console.error("[swap] quote failed:", detail);
        return res.status(500).json({ error: detail });
    }
});

app.post("/api/swap", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
        const payload = await swapOrchestrator.execute(req.body || {}, vaultAddress, req.authUser._id);
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            const body = { error: err.message || "swap failed" };
            if (typeof err.available !== "undefined") body.available = err.available;
            if (typeof err.required !== "undefined") body.required = err.required;
            return res.status(err.status).json(body);
        }
        const detail = String(err?.reason || err?.shortMessage || err?.message || "swap failed");
        console.error("[swap] execute failed:", detail);
        return res.status(500).json({ error: detail });
    }
});

app.post("/api/getVault", publicLookupLimiter, async (req, res) => {
    try {
        const payload = await vaultOrchestrator.resolveVaultAddressByEmail(
            req.body?.email,
            Number(req.body?.chainId || 11155111)
        );
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            return res.status(err.status).json({ error: err.message || "get vault failed" });
        }
        console.error(err);
        return res.status(500).json({ error: "get vault error: " + err.message });
    }
});

app.post("/api/withdraw", publicLookupLimiter, async (req, res) => {
    try {
        const payload = await vaultOrchestrator.withdrawByEmail(req.body || {});
        return res.json(payload);
    } catch (err) {
        if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
            const body = { error: err.message || "withdraw failed" };
            if (typeof err.token !== "undefined") body.token = err.token;
            if (typeof err.requested !== "undefined") body.requested = err.requested;
            if (typeof err.available !== "undefined") body.available = err.available;
            if (typeof err.frozen !== "undefined") body.frozen = err.frozen;
            if (typeof err.onchainBalance !== "undefined") body.onchainBalance = err.onchainBalance;
            return res.status(err.status).json(body);
        }
        console.error(err);
        return res.status(500).json({ error: "withdraw error: " + err.message });
    }
});

app.post("/api/transactions", publicLookupLimiter, async (req, res) => {
    const vaultAddress = String(req.body?.vaultAddress || "").trim().toLowerCase();
    if (!vaultAddress) {
        return res.status(400).json({ error: "missing vaultAddress" });
    }

    try {
        const latestTxs = await transactionsService.getPublicLatest(vaultAddress, 5);
        return res.json({ transactions: latestTxs });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "transaction query failed" });
    }
});

app.get("/api/transactions/history", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const vaultAddress = String(req.authVault?.vaultAddress || "").toLowerCase();
        if (!vaultAddress) {
            return res.json({
                page: 1,
                limit: DEFAULT_TX_PAGE_SIZE,
                total: 0,
                hasMore: false,
                transactions: []
            });
        }
        const payload = await transactionsService.getHistory(vaultAddress, req.query || {});
        return res.json(payload);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "transaction history failed" });
    }
});

app.get("/api/transactions/:id", requireAuth, authUserLimiter, async (req, res) => {
    try {
        const txId = String(req.params.id || "").trim();
        const vaultAddress = String(req.authVault?.vaultAddress || "").toLowerCase();
        if (!vaultAddress) {
            return res.status(404).json({ error: "transaction not found" });
        }
        const mapped = await transactionsService.getById(vaultAddress, txId, { toFixed2 });
        return res.json({ transaction: mapped });
    } catch (err) {
        if (err?.status === 400) {
            return res.status(400).json({ error: err.message || "invalid transaction id" });
        }
        if (err?.status === 404) {
            return res.status(404).json({ error: "transaction not found" });
        }
        console.error(err);
        return res.status(500).json({ error: "transaction detail failed" });
    }
});

app.get("/api/dashboard/summary", requireAuth, authUserLimiter, async (req, res) => {
    try {
        console.log("[dashboard-summary] incoming", {
            email: req.authUser.email,
            defaultChainId: req.authUser.defaultChainId,
            authVault: req.authVault
        });
        const payload = await dashboardService.getSummary(req.authUser, req.authVault);
        return res.json(payload);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "dashboard summary failed" });
    }
});

const PORT = process.env.PORT || 3000;
mongoose.connection.once("open", async () => {
    try {
        await userVaultService.ensureUserVaultIndexes();
        ledgerService.startProcessor({ intervalMs: 5000, batchSize: 30 });
    } catch (err) {
        console.error("ensure user vault indexes failed:", err.message);
    }
});

app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
});
