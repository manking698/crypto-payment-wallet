"use strict";

const { createCardPaymentService } = require("../modules/cards/payment-service");
const {
    applyFrozenBalanceToSnapshot,
    buildCardDeductionPlan,
    buildCardPaymentPriority,
    normalizeCardDigits,
    normalizeSpendPriority,
    shortenMerchantNameAscii
} = require("../modules/common/card-utils");
const { createDomainRules } = require("../modules/common/domain-rules");
const { decimalToScaledBigInt, scaledBigIntToDecimal, getStartOfDay, getStartOfMonth, toFixed2 } = require("../modules/common/format");

function findResult(rows) {
    return {
        select() {
            return { lean: async () => rows };
        }
    };
}

function buildService(overrides = {}) {
    const txCalls = [];
    let txIndex = 0;
    const ethers = {
        isAddress: () => true,
        formatUnits(value, decimals) {
            const raw = BigInt(value || 0n);
            const base = 10n ** BigInt(decimals);
            const whole = raw / base;
            const frac = raw % base;
            const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
            return fracText ? `${whole}.${fracText}` : whole.toString();
        },
        Contract: function Contract() {
            return {
                withdrawToken: async (tokenAddress, settlementAddress, rawAmount) => {
                    txCalls.push({ tokenAddress, settlementAddress, rawAmount });
                    txIndex += 1;
                    return {
                        hash: `0xTX${txIndex}`,
                        wait: async () => ({ status: 1, blockNumber: 100 + txIndex })
                    };
                }
            };
        }
    };
    const rules = createDomainRules({
        VALID_SPEND_PRIORITY_TOKENS: ["USDT", "USDC", "WETH"],
        FX_SUPPORTED_CURRENCIES: ["USD"],
        decimalToScaledBigInt
    });
    const paymentDoc = { _id: "payment1" };
    const paymentsService = {
        persistCardPaymentLedgerEntry: jest.fn(async () => ({ ok: true, queued: false, txId: "txid" })),
        finalizeCardPaymentSuccess: jest.fn(async () => {}),
        finalizeCardPaymentFailure: jest.fn(async () => {})
    };
    const service = createCardPaymentService({
        mongoose: {},
        ethers,
        User: {
            findById: jest.fn(() => ({ lean: async () => ({ _id: "user1", spendPriorityToken: "USDT" }) }))
        },
        UserVault: {
            findOne: jest.fn(() => ({ lean: async () => ({ vaultAddress: "0xvault" }) }))
        },
        CardPayment: {
            find: jest.fn(() => findResult([])),
            create: jest.fn(async () => paymentDoc)
        },
        backendSigner: { address: "0xsettlement" },
        provider: {},
        TOKENS: { USDT: "0xusdt", USDC: "0xusdc", WETH: "0xweth" },
        ERC20_ABI: [],
        VAULT_WITHDRAW_ABI: [],
        FX_SUPPORTED_CURRENCIES: ["USD"],
        VALID_SPEND_PRIORITY_TOKENS: ["USDT", "USDC", "WETH"],
        CARD_GLOBAL_MONTHLY_LIMIT_USD: 1000000,
        normalizeCardDigits,
        decimalToScaledBigInt,
        scaledBigIntToDecimal,
        fetchLiveFxRates: jest.fn(),
        getVaultTokenSnapshot: jest.fn(async () => ({
            snapshot: {
                USDT: { tokenAddress: "0xusdt", decimals: 6, balanceRaw: 600000000n, priceRaw8: 100000000n, usdValueRaw8: 60000000000n },
                USDC: { tokenAddress: "0xusdc", decimals: 6, balanceRaw: 600000000n, priceRaw8: 100000000n, usdValueRaw8: 60000000000n },
                WETH: { tokenAddress: "0xweth", decimals: 18, balanceRaw: 0n, priceRaw8: 200000000000n, usdValueRaw8: 0n }
            }
        })),
        getFrozenTokenRawByVault: jest.fn(async () => ({ USDT: 200000000n })),
        applyFrozenBalanceToSnapshot,
        normalizeSpendPriority,
        buildCardPaymentPriority: (token) => buildCardPaymentPriority(token, {
            USDT: ["USDT", "USDC", "WETH"],
            USDC: ["USDC", "USDT", "WETH"],
            WETH: ["WETH", "USDT", "USDC"]
        }, ["USDT", "USDC", "WETH"]),
        buildCardDeductionPlan,
        validateCardPaymentInput: rules.validateCardPaymentInput,
        getStartOfDay,
        getStartOfMonth,
        shortenMerchantNameAscii,
        paymentsService,
        cardsService: {
            resolveCardForPayment: jest.fn(async () => ({
                _id: "card1",
                userId: "user1",
                status: "active",
                perTransactionLimitUsd: 1000,
                dailyLimitUsd: 1000
            })),
            verifyCardCredentials: jest.fn(() => ({ ok: true, cardLast4: "4242" }))
        },
        toFixed2,
        ...overrides
    });
    return { service, paymentsService, txCalls };
}

describe("card payment service", () => {
    test("deducts across multiple tokens after frozen balance is applied", async () => {
        const { service, paymentsService, txCalls } = buildService();

        const result = await service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "700",
            merchantName: "Test Merchant",
            cardNumber: "4242",
            expiry: "12/30",
            cvv: "123",
            pin: "1234"
        });

        expect(result).toMatchObject({ success: true, status: "completed", paymentId: "payment1" });
        expect(result.plannedTokens.map((item) => item.tokenSymbol)).toEqual(["USDT", "USDC"]);
        expect(result.plannedTokens.map((item) => item.tokenAmountRaw)).toEqual(["400000000", "300000000"]);
        expect(txCalls).toHaveLength(2);
        expect(paymentsService.persistCardPaymentLedgerEntry).toHaveBeenCalledTimes(2);
        expect(paymentsService.finalizeCardPaymentSuccess).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentDocId: "payment1",
                txHashes: ["0xtx1", "0xtx2"],
                deductedTokens: expect.arrayContaining([
                    expect.objectContaining({ tokenSymbol: "USDT", tokenAmountRaw: "400000000" }),
                    expect.objectContaining({ tokenSymbol: "USDC", tokenAmountRaw: "300000000" })
                ])
            })
        );
    });

    test("fails before creating payment when only frozen funds would satisfy the amount", async () => {
        const { service, paymentsService } = buildService();

        await expect(service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "1100",
            merchantName: "Test Merchant"
        })).rejects.toMatchObject({
            status: 400,
            message: "vault balance is insufficient",
            availableUsd: "1000.00",
            frozenUsd: "200.00"
        });

        expect(paymentsService.persistCardPaymentLedgerEntry).not.toHaveBeenCalled();
    });

    test("enforces per-transaction limit", async () => {
        const { service } = buildService({
            cardsService: {
                resolveCardForPayment: jest.fn(async () => ({
                    _id: "card1",
                    userId: "user1",
                    status: "active",
                    perTransactionLimitUsd: 100,
                    dailyLimitUsd: 1000,
                    monthlyLimitUsd: 10000
                })),
                verifyCardCredentials: jest.fn(() => ({ ok: true, cardLast4: "4242" }))
            }
        });

        await expect(service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "101",
            merchantName: "Test Merchant"
        })).rejects.toMatchObject({
            status: 400,
            message: "card per transaction limit exceeded"
        });
    });

    test("enforces daily limit using existing same-day payments", async () => {
        const CardPayment = {
            find: jest.fn(() => findResult([{ usdAmount: "900" }])),
            create: jest.fn(async () => ({ _id: "payment1" }))
        };
        const { service } = buildService({
            CardPayment,
            cardsService: {
                resolveCardForPayment: jest.fn(async () => ({
                    _id: "card1",
                    userId: "user1",
                    status: "active",
                    perTransactionLimitUsd: 1000,
                    dailyLimitUsd: 1000,
                    monthlyLimitUsd: 10000
                })),
                verifyCardCredentials: jest.fn(() => ({ ok: true, cardLast4: "4242" }))
            }
        });

        await expect(service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "200",
            merchantName: "Test Merchant"
        })).rejects.toMatchObject({
            status: 400,
            message: "card daily limit exceeded"
        });
    });

    test("enforces monthly limit using existing same-month payments", async () => {
        const CardPayment = {
            find: jest.fn()
                .mockImplementation(() => findResult([]))
                .mockImplementationOnce(() => findResult([]))
                .mockImplementationOnce(() => findResult([{ usdAmount: "950" }])),
            create: jest.fn(async () => ({ _id: "payment1" }))
        };
        const { service } = buildService({
            CardPayment,
            cardsService: {
                resolveCardForPayment: jest.fn(async () => ({
                    _id: "card1",
                    userId: "user1",
                    status: "active",
                    perTransactionLimitUsd: 1000,
                    dailyLimitUsd: 1000,
                    monthlyLimitUsd: 1000
                })),
                verifyCardCredentials: jest.fn(() => ({ ok: true, cardLast4: "4242" }))
            }
        });

        await expect(service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "100",
            merchantName: "Test Merchant"
        })).rejects.toMatchObject({
            status: 400,
            message: "card monthly limit exceeded"
        });
    });

    test("enforces vault daily limit across card payments", async () => {
        const CardPayment = {
            find: jest.fn()
                .mockImplementation(() => findResult([]))
                .mockImplementationOnce(() => findResult([]))
                .mockImplementationOnce(() => findResult([]))
                .mockImplementationOnce(() => findResult([{ usdAmount: "950" }]))
                .mockImplementationOnce(() => findResult([])),
            create: jest.fn(async () => ({ _id: "payment1" }))
        };
        const { service } = buildService({
            CardPayment,
            cardsService: {
                resolveCardForPayment: jest.fn(async () => ({
                    _id: "card1",
                    userId: "user1",
                    status: "active",
                    perTransactionLimitUsd: 1000,
                    dailyLimitUsd: 2000,
                    monthlyLimitUsd: 10000,
                    vaultDailyLimitUsd: 1000,
                    vaultMonthlyLimitUsd: 10000
                })),
                verifyCardCredentials: jest.fn(() => ({ ok: true, cardLast4: "4242" }))
            }
        });

        await expect(service.processPayment({
            paymentCurrency: "USD",
            paymentAmount: "100",
            merchantName: "Test Merchant"
        })).rejects.toMatchObject({
            status: 400,
            message: "vault daily limit exceeded"
        });
    });
});
