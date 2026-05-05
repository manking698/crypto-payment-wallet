require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dns = require("dns");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const { CHAIN_CONFIGS, getTokenAddressByKey } = require("./config/chainConfig");
const { buildAppConstants } = require("./config/app-constants");
const { deployVault } = require("../service/deploy-vault-factory");
const { createAuthSecurityService } = require("./modules/auth/service");
const { createProvisioningService } = require("./modules/auth/provisioning-service");
const { createTokenService } = require("./modules/auth/token-service");
const { createRequireAuth } = require("./modules/auth/middleware");
const { createVaultAddressResolver } = require("./modules/auth/vault-address");
const { registerAuthRoutes } = require("./modules/auth/routes");
const { registerCardRoutes } = require("./modules/cards/routes");
const { registerNotificationRoutes } = require("./modules/notifications/routes");
const { registerTransactionRoutes } = require("./modules/transactions/routes");
const { registerLedgerInternalRoutes } = require("./modules/ledger/routes");
const { registerEarnRoutes } = require("./modules/earn/routes");
const { registerSwapRoutes } = require("./modules/swap/routes");
const { registerVaultRoutes } = require("./modules/vault/routes");
const { registerFaucetRoutes } = require("./modules/faucet/routes");
const { registerUserPreferenceRoutes } = require("./modules/user/routes");
const { registerFxRoutes } = require("./modules/fx/routes");
const { registerDashboardRoutes } = require("./modules/dashboard/routes");
const { registerModels } = require("./modules/data/models");
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
const { createLogger } = require("./modules/common/logger");
const { createRequestContextMiddleware } = require("./modules/common/request-context");
const { createDomainRules } = require("./modules/common/domain-rules");
const { createErrorMetricsService } = require("./modules/common/error-metrics");
const { createRouteObservability } = require("./modules/common/route-observability");
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
const appLogger = createLogger("server-api");
const errorMetricsService = createErrorMetricsService();
const routeObservability = createRouteObservability({
    logger: appLogger,
    errorMetrics: errorMetricsService
});
app.set("trust proxy", 1);
app.use(express.json());
app.use(createRequestContextMiddleware(appLogger));

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

const {
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
} = buildAppConstants(getTokenAddressByKey);

const authSecurityService = createAuthSecurityService({
    shortLockThreshold: LOGIN_FAIL_SHORT_LOCK_THRESHOLD,
    longLockThreshold: LOGIN_FAIL_LONG_LOCK_THRESHOLD,
    shortLockMs: LOGIN_FAIL_SHORT_LOCK_MS,
    longLockMs: LOGIN_FAIL_LONG_LOCK_MS,
    resetWindowMs: LOGIN_FAIL_RESET_WINDOW_MS
});

function parseAllowedOriginsFromEnv(raw) {
    return new Set(
        String(raw || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    );
}

const envAllowedOrigins = parseAllowedOriginsFromEnv(process.env.CORS_ALLOWED_ORIGINS);
const corsAllowAll = String(process.env.CORS_ALLOW_ALL || "").trim().toLowerCase() === "true";

const domainRules = createDomainRules({
    VALID_SPEND_PRIORITY_TOKENS,
    SWAP_ALLOWED_SYMBOLS,
    EARN_ALLOWED_SYMBOLS,
    EARN_INPUT_DECIMALS,
    EARN_MIN_SUBSCRIPTION,
    TOKEN_DECIMALS_BY_SYMBOL,
    FX_SUPPORTED_CURRENCIES,
    decimalToScaledBigInt
});

app.use(cors({
    origin(origin, callback) {
        if (corsAllowAll) return callback(null, true);
        if (!origin) return callback(null, true);
        if (LOCAL_DEV_ORIGINS.has(origin)) return callback(null, true);
        if (EXTERNAL_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        if (envAllowedOrigins.has(origin)) return callback(null, true);
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
appLogger.info("dns.configured", { servers: ["8.8.8.8", "8.8.4.4"] });

mongoose.connect(process.env.MONGO_URI)
    .then(() => appLogger.info("mongodb.connected"))
    .catch((err) => appLogger.error("mongodb.connection_failed", { error: err.message }));

const {
    Transaction,
    User,
    UserVault,
    UserCard,
    CardPayment,
    Notification,
    FaucetClaim,
    LedgerOutbox
} = registerModels(mongoose);

const provider = new ethers.JsonRpcProvider(CHAIN_CONFIGS.sepolia.RPC.http[0]);
const backendPrivateKey = process.env.PRIVATE_KEY;
const backendSigner = new ethers.Wallet(backendPrivateKey, provider);

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const JWT_SECRET = process.env.JWT_SECRET || "wallet-app-dev-secret";
const EARN_CONTRACT_ADDRESS = String(process.env.EARN_CONTRACT_ADDRESS || "").trim();
const CARD_GLOBAL_MONTHLY_LIMIT_USD = Number.parseFloat(process.env.CARD_GLOBAL_MONTHLY_LIMIT_USD || "1000000");

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
const vaultAddressResolver = createVaultAddressResolver({
    backendSigner,
    factoryAddress: FACTORY_ADDRESS,
    factoryAbi: FACTORY_ABI,
    vaultFactoryBytecode: VAULT_FACTORY_BYTECODE
});
const computeVaultAddress = vaultAddressResolver.computeVaultAddress;

const notificationsService = createNotificationsService({ Notification, mongoose });
const createNotification = (input) => notificationsService.createNotification(input);
const provisioningService = createProvisioningService({
    User,
    UserVault,
    deployVault,
    computeVaultAddress,
    createNotification,
    chainId: 11155111,
    logger: appLogger
});

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
    persistLedgerTransaction,
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
    decimalToScaledBigInt,
    validateEarnAmountInput: domainRules.validateEarnAmountInput
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
    validateCardPaymentInput: domainRules.validateCardPaymentInput,
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
    validateSwapInput: domainRules.validateSwapInput,
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

const requireAuth = createRequireAuth({
    tokenService,
    computeVaultAddress,
    userVaultService
});

registerAuthRoutes(app, {
    authLimiter,
    authUserLimiter,
    requireAuth,
    User,
    UserVault,
    bcrypt,
    deployVault,
    computeVaultAddress,
    createNotification,
    tokenService,
    profileService,
    authSecurityService,
    userVaultService,
    provisioningService,
    observability: routeObservability
});

registerCardRoutes(app, {
    requireAuth,
    authUserLimiter,
    cardsService,
    cardPaymentService,
    observability: routeObservability
});

registerNotificationRoutes(app, {
    requireAuth,
    authUserLimiter,
    notificationsService,
    observability: routeObservability
});

registerTransactionRoutes(app, {
    publicLookupLimiter,
    requireAuth,
    authUserLimiter,
    transactionsService,
    toFixed2,
    defaultPageSize: DEFAULT_TX_PAGE_SIZE,
    observability: routeObservability
});

registerLedgerInternalRoutes(app, {
    ledgerService,
    errorMetricsService,
    observability: routeObservability
});

registerEarnRoutes(app, {
    requireAuth,
    authUserLimiter,
    earnOrchestrator,
    observability: routeObservability
});

registerSwapRoutes(app, {
    requireAuth,
    authUserLimiter,
    swapOrchestrator,
    observability: routeObservability
});

registerVaultRoutes(app, {
    publicLookupLimiter,
    vaultOrchestrator,
    observability: routeObservability
});

registerFaucetRoutes(app, {
    faucetLimiter,
    normalizeVaultAddressInput,
    ethers,
    FaucetClaim,
    getFaucetTokenList,
    getLatestUnlockAtForToken,
    backendPrivateKey,
    backendSigner,
    tokens: TOKENS,
    faucetTokenAmounts: { USDT: "500", USDC: "1000", WETH: "0.15" },
    tokenDecimals: { USDT: 6, USDC: 6, WETH: 18 },
    chainId: 11155111,
    observability: routeObservability
});

registerUserPreferenceRoutes(app, {
    requireAuth,
    authUserLimiter,
    User,
    validSpendPriorityTokens: VALID_SPEND_PRIORITY_TOKENS,
    fxSupportedCurrencies: FX_SUPPORTED_CURRENCIES
});

registerFxRoutes(app, {
    fxService,
    sanitizeBaseCurrency,
    supportedCurrencies: FX_SUPPORTED_CURRENCIES,
    observability: routeObservability
});

registerDashboardRoutes(app, {
    requireAuth,
    authUserLimiter,
    dashboardService,
    observability: routeObservability
});

app.get("/api/health", (_req, res) => {
    return res.json({
        ok: true,
        service: "server-api",
        uptimeSec: Math.floor(process.uptime()),
        now: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
mongoose.connection.once("open", async () => {
    try {
        await userVaultService.ensureUserVaultIndexes();
        ledgerService.startProcessor({ intervalMs: 5000, batchSize: 30 });
        provisioningService.startProcessor({ intervalMs: 5000, batchSize: 10 });
    } catch (err) {
        appLogger.error("bootstrap.ensure_indexes_failed", { error: err.message });
    }
});

app.listen(PORT, () => {
    appLogger.info("server.started", { port: Number(PORT) });
});
