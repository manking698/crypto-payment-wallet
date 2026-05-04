"use strict";

function normalizeAllowedSymbol(value, allowedSymbols, fallback = "") {
    const symbol = String(value || "").trim().toUpperCase();
    return Array.isArray(allowedSymbols) && allowedSymbols.includes(symbol) ? symbol : fallback;
}

function countDecimalPlaces(value) {
    const text = String(value || "").trim();
    const [, fraction = ""] = text.split(".");
    return fraction.length;
}

function isPositiveDecimalText(value) {
    const text = String(value || "").trim();
    return /^\d+(\.\d+)?$/.test(text) && Number(text) > 0;
}

function validateDecimalAmount(input) {
    const {
        value,
        label = "amount",
        maxDecimals = null,
        minAmountText = null,
        tokenSymbol = "",
        decimalToScaledBigInt,
        rawDecimals = 18
    } = input || {};
    const text = String(value || "").trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
        return { ok: false, error: `invalid ${label}` };
    }
    if (!Number.isFinite(Number(text)) || Number(text) <= 0) {
        return { ok: false, error: `${label} must be greater than zero` };
    }
    if (maxDecimals !== null && countDecimalPlaces(text) > Number(maxDecimals)) {
        return { ok: false, error: `max ${Number(maxDecimals)} decimals allowed` };
    }

    let amountRaw = null;
    if (typeof decimalToScaledBigInt === "function") {
        amountRaw = decimalToScaledBigInt(text, Number(rawDecimals));
        if (amountRaw <= 0n) {
            return { ok: false, error: `${label} too small` };
        }
        if (minAmountText !== null && minAmountText !== undefined) {
            const minRaw = decimalToScaledBigInt(String(minAmountText), Number(rawDecimals));
            if (amountRaw < minRaw) {
                return {
                    ok: false,
                    error: `minimum subscription is ${minAmountText} ${String(tokenSymbol || "").toUpperCase()}`
                };
            }
        }
    } else if (minAmountText !== null && minAmountText !== undefined && Number(text) < Number(minAmountText)) {
        return {
            ok: false,
            error: `minimum subscription is ${minAmountText} ${String(tokenSymbol || "").toUpperCase()}`
        };
    }

    return { ok: true, amount: text, amountRaw };
}

function createDomainRules(config) {
    const {
        VALID_SPEND_PRIORITY_TOKENS = ["USDT", "USDC", "WETH"],
        SWAP_ALLOWED_SYMBOLS = VALID_SPEND_PRIORITY_TOKENS,
        EARN_ALLOWED_SYMBOLS = VALID_SPEND_PRIORITY_TOKENS,
        EARN_INPUT_DECIMALS = {},
        EARN_MIN_SUBSCRIPTION = {},
        TOKEN_DECIMALS_BY_SYMBOL = {},
        FX_SUPPORTED_CURRENCIES = ["USD"],
        decimalToScaledBigInt
    } = config || {};

    function normalizeSpendPriority(token) {
        return normalizeAllowedSymbol(token, VALID_SPEND_PRIORITY_TOKENS, "USDT");
    }

    function validateCardPaymentInput(reqBody) {
        const paymentCurrency = String(reqBody?.paymentCurrency || "USD").trim().toUpperCase();
        const paymentAmount = String(reqBody?.paymentAmount || "").trim();
        const merchantName = String(reqBody?.merchantName || "").trim();
        const merchantRef = String(reqBody?.merchantRef || "").trim();
        const country = String(reqBody?.country || "").trim().toUpperCase();

        const amountResult = validateDecimalAmount({
            value: paymentAmount,
            label: "payment amount",
            maxDecimals: 8,
            decimalToScaledBigInt,
            rawDecimals: 8
        });
        if (!amountResult.ok) return amountResult;
        if (!FX_SUPPORTED_CURRENCIES.includes(paymentCurrency)) {
            return { ok: false, error: "unsupported payment currency" };
        }
        if (!merchantName) {
            return { ok: false, error: "merchant name is required" };
        }

        return {
            ok: true,
            paymentCurrency,
            paymentAmount: amountResult.amount,
            paymentAmountRaw8: amountResult.amountRaw,
            merchantName,
            merchantRef,
            country
        };
    }

    function validateSwapInput(reqBody) {
        const fromSymbol = normalizeAllowedSymbol(reqBody?.fromSymbol, SWAP_ALLOWED_SYMBOLS);
        const toSymbol = normalizeAllowedSymbol(reqBody?.toSymbol, SWAP_ALLOWED_SYMBOLS);
        const amount = String(reqBody?.amount || "").trim();
        if (!fromSymbol || !toSymbol) return { ok: false, error: "invalid token symbol" };
        if (fromSymbol === toSymbol) return { ok: false, error: "source and target token cannot be same" };

        const fromDecimals = Number(TOKEN_DECIMALS_BY_SYMBOL[fromSymbol] || 18);
        const amountResult = validateDecimalAmount({
            value: amount,
            label: "amount",
            maxDecimals: fromDecimals,
            decimalToScaledBigInt,
            rawDecimals: fromDecimals
        });
        if (!amountResult.ok) return amountResult;
        return {
            ok: true,
            fromSymbol,
            toSymbol,
            amount: amountResult.amount,
            fromAmountRaw: amountResult.amountRaw,
            fromDecimals,
            toDecimals: Number(TOKEN_DECIMALS_BY_SYMBOL[toSymbol] || 18)
        };
    }

    function validateEarnAmountInput(symbol, amountText, options = {}) {
        const enforceMin = options.enforceMin !== false;
        const token = normalizeAllowedSymbol(symbol, EARN_ALLOWED_SYMBOLS);
        if (!token) return { ok: false, error: "invalid token" };
        const tokenDecimals = Number(TOKEN_DECIMALS_BY_SYMBOL[token] || 18);
        const maxDecimals = Number(EARN_INPUT_DECIMALS[token] || tokenDecimals);
        const amountResult = validateDecimalAmount({
            value: amountText,
            label: "amount",
            maxDecimals,
            minAmountText: enforceMin ? EARN_MIN_SUBSCRIPTION[token] : null,
            tokenSymbol: token,
            decimalToScaledBigInt,
            rawDecimals: tokenDecimals
        });
        if (!amountResult.ok) return amountResult;
        return {
            ok: true,
            token,
            amountRaw: amountResult.amountRaw,
            amount: amountResult.amount
        };
    }

    return {
        normalizeAllowedSymbol,
        normalizeSpendPriority,
        validateCardPaymentInput,
        validateSwapInput,
        validateEarnAmountInput
    };
}

module.exports = {
    createDomainRules,
    normalizeAllowedSymbol,
    countDecimalPlaces,
    isPositiveDecimalText,
    validateDecimalAmount
};
