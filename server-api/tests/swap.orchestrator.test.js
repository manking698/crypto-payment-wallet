"use strict";

const { createSwapOrchestrator } = require("../modules/swap/orchestrator");
const { createSwapHelpers } = require("../modules/swap/helpers");
const { createDomainRules } = require("../modules/common/domain-rules");
const { applyFrozenBalanceToSnapshot } = require("../modules/common/card-utils");
const { decimalToScaledBigInt, scaledBigIntToDecimal } = require("../modules/common/format");

function formatUnits(value, decimals) {
    const raw = BigInt(value || 0n);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const frac = raw % base;
    const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return fracText ? `${whole}.${fracText}` : whole.toString();
}

function buildOrchestrator(overrides = {}) {
    const TOKEN_DECIMALS_BY_SYMBOL = { USDT: 6, USDC: 6, WETH: 18 };
    const helpers = createSwapHelpers({ SWAP_ALLOWED_SYMBOLS: ["USDT", "USDC", "WETH"] });
    const rules = createDomainRules({
        SWAP_ALLOWED_SYMBOLS: ["USDT", "USDC", "WETH"],
        TOKEN_DECIMALS_BY_SYMBOL,
        decimalToScaledBigInt
    });
    const baseSnapshot = {
        USDT: { tokenAddress: "0xusdt", decimals: 6, balanceRaw: 100000000n, priceRaw8: 100000000n, usdValueRaw8: 10000000000n },
        USDC: { tokenAddress: "0xusdc", decimals: 6, balanceRaw: 1000000000n, priceRaw8: 100000000n, usdValueRaw8: 100000000000n },
        WETH: { tokenAddress: "0xweth", decimals: 18, balanceRaw: 1000000000000000000n, priceRaw8: 200000000000n, usdValueRaw8: 200000000000n }
    };
    return createSwapOrchestrator({
        ethers: { formatUnits, isAddress: () => true, ZeroAddress: "0x0000000000000000000000000000000000000000" },
        provider: { getCode: jest.fn(async () => "0x01") },
        backendSigner: {},
        TOKENS: { USDT: "0xusdt", USDC: "0xusdc", WETH: "0xweth" },
        TOKEN_DECIMALS_BY_SYMBOL,
        VAULT_SWAP_ABI: [],
        ERC20_ABI: [],
        normalizeSwapSymbol: helpers.normalizeSwapSymbol,
        validateSwapInput: rules.validateSwapInput,
        decimalToScaledBigInt,
        scaledBigIntToDecimal,
        getVaultTokenSnapshot: jest.fn(async () => ({ snapshot: overrides.snapshot || baseSnapshot })),
        getFrozenTokenRawByVault: jest.fn(async () => overrides.frozenBySymbol || {}),
        applyFrozenBalanceToSnapshot,
        buildSwapQuoteBySnapshot: helpers.buildSwapQuoteBySnapshot,
        swapService: { recordSwapCompletion: jest.fn(async () => ({ journalResult: { queued: false, txId: "swap" } })) }
    });
}

describe("swap orchestrator", () => {
    test("quote uses frozen-adjusted balance", async () => {
        const orchestrator = buildOrchestrator({ frozenBySymbol: { USDT: 80000000n } });

        await expect(orchestrator.quote({
            fromSymbol: "USDT",
            toSymbol: "USDC",
            amount: "50"
        }, "0xvault")).rejects.toMatchObject({
            status: 400,
            message: "insufficient balance",
            available: "20"
        });
    });

    test("quote happy path returns target amount and balances", async () => {
        const orchestrator = buildOrchestrator();

        const quote = await orchestrator.quote({
            fromSymbol: "USDT",
            toSymbol: "USDC",
            amount: "25"
        }, "0xvault");

        expect(quote).toMatchObject({
            fromSymbol: "USDT",
            toSymbol: "USDC",
            fromAmount: "25",
            toAmount: "25",
            usdAmount: "25.00"
        });
    });
});
