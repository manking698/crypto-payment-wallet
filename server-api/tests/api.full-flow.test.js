"use strict";

const express = require("express");
const request = require("supertest");
const { registerAuthRoutes } = require("../modules/auth/routes");
const { registerCardRoutes } = require("../modules/cards/routes");
const { registerNotificationRoutes } = require("../modules/notifications/routes");
const { registerTransactionRoutes } = require("../modules/transactions/routes");
const { registerLedgerInternalRoutes } = require("../modules/ledger/routes");
const { registerEarnRoutes } = require("../modules/earn/routes");
const { registerSwapRoutes } = require("../modules/swap/routes");
const { registerVaultRoutes } = require("../modules/vault/routes");
const { registerFaucetRoutes } = require("../modules/faucet/routes");
const { registerUserPreferenceRoutes } = require("../modules/user/routes");
const { registerFxRoutes } = require("../modules/fx/routes");
const { registerDashboardRoutes } = require("../modules/dashboard/routes");
const { createErrorMetricsService } = require("../modules/common/error-metrics");
const { createRouteObservability } = require("../modules/common/route-observability");

function createMemoryUserStore() {
    const byEmail = new Map();
    const byId = new Map();
    let seq = 1;

    function cloneUser(user) {
        return {
            _id: user._id,
            email: user.email,
            passwordHash: user.passwordHash,
            defaultChainId: user.defaultChainId,
            spendPriorityToken: user.spendPriorityToken || "USDT",
            displayCurrency: user.displayCurrency || "USD",
            lastLoginAt: user.lastLoginAt || null
        };
    }

    function createDoc(user) {
        if (!user) return null;
        const doc = cloneUser(user);
        doc.save = async () => {
            byEmail.set(doc.email, cloneUser(doc));
            byId.set(String(doc._id), cloneUser(doc));
            return doc;
        };
        return doc;
    }

    return {
        User: {
            findOne(query) {
                const email = String(query?.email || "").trim().toLowerCase();
                const user = byEmail.get(email) || null;
                const doc = createDoc(user);
                return {
                    lean: async () => (user ? cloneUser(user) : null),
                    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
                };
            },
            async create(payload) {
                const user = {
                    _id: `u${seq++}`,
                    email: String(payload.email || "").trim().toLowerCase(),
                    passwordHash: String(payload.passwordHash || ""),
                    defaultChainId: Number(payload.defaultChainId || 11155111),
                    spendPriorityToken: "USDT",
                    displayCurrency: "USD",
                    lastLoginAt: payload.lastLoginAt || null
                };
                byEmail.set(user.email, cloneUser(user));
                byId.set(String(user._id), cloneUser(user));
                return createDoc(user);
            },
            async findById(id) {
                const user = byId.get(String(id)) || null;
                return createDoc(user);
            },
            async updateOne(query, update) {
                const id = String(query?._id || "");
                const current = byId.get(id);
                if (!current) return { matchedCount: 0 };
                const next = { ...current, ...(update?.$set || {}) };
                byId.set(id, next);
                byEmail.set(next.email, next);
                return { matchedCount: 1 };
            }
        }
    };
}

function buildApp() {
    process.env.INTERNAL_API_KEY = "test-internal-key";
    const app = express();
    app.use(express.json());

    const userStore = createMemoryUserStore();
    const authVault = { vaultAddress: "0xabc0000000000000000000000000000000000000", chainId: 11155111 };
    const tokenMap = new Map();
    const errorMetricsService = createErrorMetricsService();
    const observability = createRouteObservability({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        errorMetrics: errorMetricsService
    });

    const UserVault = {
        async create() { return { ok: true }; },
        findOne() {
            return {
                lean: async () => authVault
            };
        }
    };

    const requireAuth = async (req, res, next) => {
        const header = String(req.headers.authorization || "");
        if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "missing auth token" });
        const token = header.slice(7).trim();
        const user = tokenMap.get(token);
        if (!user) return res.status(401).json({ error: "invalid auth token" });
        req.authUser = user;
        req.authVault = authVault;
        return next();
    };

    const pass = (_req, _res, next) => next();
    const tokenService = {
        createAuthToken(user) {
            const token = `token-${String(user._id)}`;
            tokenMap.set(token, {
                _id: String(user._id),
                email: String(user.email),
                defaultChainId: Number(user.defaultChainId || 11155111),
                spendPriorityToken: String(user.spendPriorityToken || "USDT"),
                displayCurrency: String(user.displayCurrency || "USD")
            });
            return token;
        }
    };

    registerAuthRoutes(app, {
        authLimiter: pass,
        authUserLimiter: pass,
        requireAuth,
        User: userStore.User,
        UserVault,
        bcrypt: {
            hash: async (v) => `hashed-${v}`,
            compare: async (raw, hashed) => hashed === `hashed-${raw}`
        },
        deployVault: {
            getSalt: () => "salt-1",
            deploy: async () => ({ result: true, address: authVault.vaultAddress })
        },
        computeVaultAddress: async () => authVault.vaultAddress,
        createNotification: async () => ({ ok: true }),
        tokenService,
        profileService: {
            buildUserProfile(user, vault) {
                return {
                    email: user.email,
                    vaultAddress: String(vault?.vaultAddress || ""),
                    defaultChainId: Number(user.defaultChainId || 11155111),
                    spendPriorityToken: String(user.spendPriorityToken || "USDT"),
                    displayCurrency: String(user.displayCurrency || "USD")
                };
            }
        },
        authSecurityService: {
            buildLoginKey: (email) => email,
            getLoginLockState: () => ({ blocked: false, retryAfterSec: 0 }),
            registerLoginFailure: jest.fn(),
            clearLoginFailure: jest.fn()
        },
        userVaultService: {
            ensureUserVault: async () => authVault,
            ensureUserVaultByAddress: async () => authVault
        },
        observability
    });

    registerCardRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        cardsService: {
            async listCardsByUser() { return [{ id: "card-1", status: "active" }]; },
            async createCard() { return { id: "card-1", status: "active" }; },
            async updateCard() { return { id: "card-1", nickname: "main" }; },
            async freezeCard() { return { id: "card-1", status: "frozen" }; },
            async unfreezeCard() { return { id: "card-1", status: "active" }; }
        },
        cardPaymentService: {
            async processPayment() { return { success: true, paymentId: "payment-1", status: "completed" }; }
        },
        observability
    });

    registerNotificationRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        notificationsService: {
            async listByUser() { return [{ id: "n1", type: "system", title: "T", message: "M", isRead: false }]; },
            async getUnreadCount() { return 1; },
            async markRead() { return { unreadCount: 0, notification: { id: "n1", isRead: true } }; },
            async createSystemNotification() { return { id: "n2", isRead: false }; }
        },
        observability
    });

    registerTransactionRoutes(app, {
        publicLookupLimiter: pass,
        requireAuth,
        authUserLimiter: pass,
        transactionsService: {
            async getPublicLatest() { return [{ id: "tx-public-1" }]; },
            async getHistory() { return { page: 1, limit: 5, total: 1, hasMore: false, transactions: [{ id: "tx1" }] }; },
            async getById() { return { id: "tx1", txHash: "0x1" }; }
        },
        toFixed2: (v) => Number(v || 0).toFixed(2),
        defaultPageSize: 5,
        observability
    });

    registerLedgerInternalRoutes(app, {
        ledgerService: {
            async listOutbox() { return { page: 1, limit: 20, total: 0, hasMore: false, items: [] }; },
            async getOutboxFailureStats() { return { totalFailed: 0, byReason: [] }; },
            async processOutboxBatch() { return undefined; }
        },
        errorMetricsService,
        observability
    });

    registerEarnRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        earnOrchestrator: {
            async getSummary() { return { vaultAddress: authVault.vaultAddress, pools: [] }; },
            async getHistory() { return { page: 1, limit: 20, total: 0, hasMore: false, records: [] }; },
            async subscribe() { return { success: true, txHash: "0xearn1", token: "USDT", amount: "10" }; },
            async redeem() { return { success: true, txHash: "0xearn2", token: "USDT", amount: "1" }; },
            async claim() { return { success: true, txHash: "0xearn3", token: "USDT", amount: "0.1" }; }
        },
        observability
    });

    registerSwapRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        swapOrchestrator: {
            async quote() { return { fromSymbol: "USDT", toSymbol: "USDC", fromAmount: "1", toAmount: "1", usdAmount: "1.00", balances: {} }; },
            async execute() { return { success: true, txHash: "0xswap1", direction: "swap" }; }
        },
        observability
    });

    registerVaultRoutes(app, {
        publicLookupLimiter: pass,
        vaultOrchestrator: {
            async resolveVaultAddressByEmail() { return { email: "u@test.com", vaultAddress: authVault.vaultAddress, chainId: 11155111 }; },
            async withdrawByEmail() { return { success: true, txHash: "0xwithdraw1", message: "ok" }; }
        },
        observability
    });

    registerFaucetRoutes(app, {
        faucetLimiter: pass,
        normalizeVaultAddressInput: (v) => String(v || "").toLowerCase().startsWith("0x") ? String(v).toLowerCase() : "",
        ethers: {
            Contract: function Contract() {
                return {
                    transfer: async () => ({
                        hash: "0xfaucet1",
                        wait: async () => ({ status: 1 })
                    })
                };
            },
            parseUnits: (v) => BigInt(Math.floor(Number(v || 0) * 1_000_000)),
            isAddress: (v) => String(v || "").toLowerCase().startsWith("0x")
        },
        FaucetClaim: {
            find() {
                return {
                    sort() { return { lean: async () => [] }; }
                };
            },
            async create() { return { _id: "fc1" }; }
        },
        getFaucetTokenList: (claimType) => (claimType === "ALL" ? ["USDT", "USDC", "WETH"] : [claimType]),
        getLatestUnlockAtForToken: () => null,
        backendPrivateKey: "0xabc",
        backendSigner: { address: "0xfaucetsigner" },
        tokens: { USDT: "0xusdt", USDC: "0xusdc", WETH: "0xweth" },
        faucetTokenAmounts: { USDT: "500", USDC: "1000", WETH: "0.15" },
        tokenDecimals: { USDT: 6, USDC: 6, WETH: 18 },
        chainId: 11155111,
        observability
    });

    registerUserPreferenceRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        User: userStore.User,
        validSpendPriorityTokens: ["USDT", "USDC", "WETH"],
        fxSupportedCurrencies: ["USD", "MYR", "EUR"]
    });

    registerFxRoutes(app, {
        fxService: {
            async fetchLiveFxRates(base) {
                return { provider: "mock", base, updatedAt: new Date().toISOString(), rates: { USD: 1, MYR: 4.2, EUR: 0.9 } };
            }
        },
        sanitizeBaseCurrency: (base) => ["USD", "MYR", "EUR"].includes(String(base || "").toUpperCase()) ? String(base).toUpperCase() : "USD",
        supportedCurrencies: ["USD", "MYR", "EUR"],
        observability
    });

    registerDashboardRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        dashboardService: {
            async getSummary(user, vault) {
                return {
                    email: user.email,
                    vaultAddress: vault.vaultAddress,
                    assets: [],
                    transactions: []
                };
            }
        },
        observability
    });

    return app;
}

describe("full api flow", () => {
    test("covers register/login/deposit/send/cards/earn/swap/notifications/transactions/internal routes", async () => {
        const app = buildApp();

        const register = await request(app).post("/api/auth/register").send({ email: "u@test.com", password: "Password123" });
        expect(register.status).toBe(201);
        expect(register.body.token).toBeTruthy();
        const token = register.body.token;
        const authz = { Authorization: `Bearer ${token}` };

        const login = await request(app).post("/api/auth/login").send({ email: "u@test.com", password: "Password123" });
        expect(login.status).toBe(200);

        expect((await request(app).get("/api/auth/me").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/auth/change-password").set(authz).send({
            oldPassword: "Password123",
            newPassword: "Password1234",
            confirmPassword: "Password1234"
        })).status).toBe(200);
        expect((await request(app).post("/api/auth/logout").send({})).status).toBe(200);

        expect((await request(app).post("/api/getVault").send({ email: "u@test.com", chainId: 11155111 })).status).toBe(200);
        expect((await request(app).post("/api/withdraw").send({
            email: "u@test.com",
            amount: "1",
            toAddress: "0xdef0000000000000000000000000000000000000",
            token: "USDT",
            chainId: 11155111
        })).status).toBe(200);

        expect((await request(app).get("/api/faucet/status").query({ vaultAddress: "0xabc0000000000000000000000000000000000000", claimType: "ALL" })).status).toBe(200);
        expect((await request(app).post("/api/faucet/claim").send({ vaultAddress: "0xabc0000000000000000000000000000000000000", claimType: "USDT" })).status).toBe(200);

        expect((await request(app).get("/api/cards").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/cards").set(authz).send({ cardholderName: "U", nickname: "main", pin: "1234" })).status).toBe(201);
        expect((await request(app).post("/api/cards/card-1/update").set(authz).send({ nickname: "new-name" })).status).toBe(200);
        expect((await request(app).post("/api/cards/card-1/freeze").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/cards/card-1/unfreeze").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/cards/payments").send({ paymentCurrency: "USD", paymentAmount: "10", merchantName: "Store" })).status).toBe(200);

        expect((await request(app).post("/api/swap/quote").set(authz).send({ fromSymbol: "USDT", toSymbol: "USDC", amount: "1" })).status).toBe(200);
        expect((await request(app).post("/api/swap").set(authz).send({ fromSymbol: "USDT", toSymbol: "USDC", amount: "1" })).status).toBe(200);

        expect((await request(app).get("/api/earn/summary").set(authz)).status).toBe(200);
        expect((await request(app).get("/api/earn/history").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/earn/subscribe").set(authz).send({ token: "USDT", amount: "10" })).status).toBe(200);
        expect((await request(app).post("/api/earn/redeem").set(authz).send({ token: "USDT", amount: "1" })).status).toBe(200);
        expect((await request(app).post("/api/earn/claim").set(authz).send({ token: "USDT" })).status).toBe(200);

        expect((await request(app).post("/api/transactions").send({ vaultAddress: "0xabc0000000000000000000000000000000000000" })).status).toBe(200);
        expect((await request(app).get("/api/transactions/history").set(authz)).status).toBe(200);
        expect((await request(app).get("/api/transactions/tx1").set(authz)).status).toBe(200);

        expect((await request(app).get("/api/notifications").set(authz)).status).toBe(200);
        expect((await request(app).get("/api/notifications/unread-count").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/notifications/n1/read").set(authz).send({})).status).toBe(200);
        expect((await request(app).post("/api/notifications/system").set(authz).send({ title: "T", message: "M" })).status).toBe(201);

        expect((await request(app).get("/api/user/spend-priority").set(authz)).status).toBe(200);
        expect((await request(app).post("/api/user/spend-priority").set(authz).send({ token: "USDC" })).status).toBe(200);
        expect((await request(app).post("/api/user/display-currency").set(authz).send({ currency: "MYR" })).status).toBe(200);

        expect((await request(app).get("/api/fx/latest").query({ base: "USD" })).status).toBe(200);
        expect((await request(app).get("/api/dashboard/summary").set(authz)).status).toBe(200);

        const internalHeaders = { "x-internal-key": "test-internal-key" };
        expect((await request(app).get("/api/internal/ledger-outbox").set(internalHeaders)).status).toBe(200);
        expect((await request(app).get("/api/internal/ledger-outbox/stats").set(internalHeaders)).status).toBe(200);
        expect((await request(app).post("/api/internal/ledger-outbox/retry").set(internalHeaders).send({ limit: 10 })).status).toBe(200);
        expect((await request(app).get("/api/internal/observability/error-metrics").set(internalHeaders)).status).toBe(200);
    });
});
