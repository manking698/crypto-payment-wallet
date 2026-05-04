"use strict";

const { createDomainRules } = require("../modules/common/domain-rules");
const { decimalToScaledBigInt } = require("../modules/common/format");

function buildRules() {
    return createDomainRules({
        VALID_SPEND_PRIORITY_TOKENS: ["USDT", "USDC", "WETH"],
        SWAP_ALLOWED_SYMBOLS: ["USDT", "USDC", "WETH"],
        EARN_ALLOWED_SYMBOLS: ["USDT", "USDC", "WETH"],
        EARN_INPUT_DECIMALS: { USDT: 2, USDC: 2, WETH: 3 },
        EARN_MIN_SUBSCRIPTION: { USDT: "10", USDC: "10", WETH: "0.005" },
        TOKEN_DECIMALS_BY_SYMBOL: { USDT: 6, USDC: 6, WETH: 18 },
        FX_SUPPORTED_CURRENCIES: ["USD", "MYR", "JPY"],
        decimalToScaledBigInt
    });
}

describe("domain rules", () => {
    test("validates card payment inputs in one shared place", () => {
        const rules = buildRules();
        const ok = rules.validateCardPaymentInput({
            paymentCurrency: "myr",
            paymentAmount: "12.34",
            merchantName: "Coffee"
        });
        expect(ok).toMatchObject({
            ok: true,
            paymentCurrency: "MYR",
            paymentAmount: "12.34",
            merchantName: "Coffee"
        });
        expect(ok.paymentAmountRaw8).toBe(1234000000n);

        expect(rules.validateCardPaymentInput({ paymentAmount: "1.123456789", merchantName: "Shop" }))
            .toMatchObject({ ok: false, error: "max 8 decimals allowed" });
        expect(rules.validateCardPaymentInput({ paymentCurrency: "ABC", paymentAmount: "1", merchantName: "Shop" }))
            .toMatchObject({ ok: false, error: "unsupported payment currency" });
    });

    test("validates swap amount precision by source token decimals", () => {
        const rules = buildRules();
        expect(rules.validateSwapInput({ fromSymbol: "USDT", toSymbol: "WETH", amount: "1.123456" }))
            .toMatchObject({ ok: true, fromSymbol: "USDT", toSymbol: "WETH", fromAmountRaw: 1123456n });
        expect(rules.validateSwapInput({ fromSymbol: "USDT", toSymbol: "WETH", amount: "1.1234567" }))
            .toMatchObject({ ok: false, error: "max 6 decimals allowed" });
        expect(rules.validateSwapInput({ fromSymbol: "USDT", toSymbol: "USDT", amount: "1" }))
            .toMatchObject({ ok: false, error: "source and target token cannot be same" });
    });

    test("validates earn minimums and token-specific input decimals", () => {
        const rules = buildRules();
        expect(rules.validateEarnAmountInput("WETH", "0.005"))
            .toMatchObject({ ok: true, token: "WETH", amountRaw: 5000000000000000n });
        expect(rules.validateEarnAmountInput("WETH", "0.004"))
            .toMatchObject({ ok: false, error: "minimum subscription is 0.005 WETH" });
        expect(rules.validateEarnAmountInput("USDT", "10.001"))
            .toMatchObject({ ok: false, error: "max 2 decimals allowed" });
    });
});
