"use strict";

function createEarnHelpers({
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
}) {
    function getEarnTokenAddress(symbol) {
        const normalized = String(symbol || "").toUpperCase();
        if (!EARN_ALLOWED_SYMBOLS.includes(normalized)) return "";
        return String(TOKENS[normalized] || "");
    }

    function parseEarnAmount(symbol, amountText, options = {}) {
        const enforceMin = options.enforceMin !== false;
        const token = String(symbol || "").toUpperCase();
        const input = String(amountText || "").trim();
        if (!EARN_ALLOWED_SYMBOLS.includes(token)) return { ok: false, error: "invalid token" };
        if (!/^\d+(\.\d+)?$/.test(input)) return { ok: false, error: "invalid amount" };
        const maxDecimals = Number(EARN_INPUT_DECIMALS[token] || 2);
        const decimalsCount = (input.split(".")[1] || "").length;
        if (decimalsCount > maxDecimals) return { ok: false, error: `max ${maxDecimals} decimals allowed` };
        const minAmount = Number(EARN_MIN_SUBSCRIPTION[token] || "0");
        const amountNum = Number(input);
        if (!Number.isFinite(amountNum) || amountNum <= 0) return { ok: false, error: "amount must be greater than zero" };
        if (enforceMin && amountNum < minAmount) return { ok: false, error: `minimum subscription is ${minAmount} ${token}` };
        const tokenDecimals = Number(TOKEN_DECIMALS_BY_SYMBOL[token] || 18);
        const amountRaw = decimalToScaledBigInt(input, tokenDecimals);
        if (amountRaw <= 0n) return { ok: false, error: "amount too small" };
        return { ok: true, token, amountRaw, amount: input };
    }

    function getEarnContracts() {
        if (!EARN_CONTRACT_ADDRESS || !ethers.isAddress(EARN_CONTRACT_ADDRESS)) {
            throw new Error("earn contract is not configured");
        }
        return {
            read: new ethers.Contract(EARN_CONTRACT_ADDRESS, EARN_CONTRACT_ABI, provider),
            write: new ethers.Contract(EARN_CONTRACT_ADDRESS, EARN_CONTRACT_ABI, backendSigner)
        };
    }

    return {
        getEarnTokenAddress,
        parseEarnAmount,
        getEarnContracts
    };
}

module.exports = {
    createEarnHelpers
};

