"use strict";

function normalizeSpendPriority(token, validTokens = ["USDT", "USDC", "WETH"]) {
    const t = String(token || "").trim().toUpperCase();
    return validTokens.includes(t) ? t : "USDT";
}

function buildCardPaymentPriority(spendPriorityToken, priorityFlow, validTokens = ["USDT", "USDC", "WETH"]) {
    const head = normalizeSpendPriority(spendPriorityToken, validTokens);
    return priorityFlow?.[head] || priorityFlow?.USDT || ["USDT", "USDC", "WETH"];
}

function normalizeCardDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function getFaucetTokenList(claimType) {
    if (claimType === "ALL") return ["USDT", "USDC", "WETH"];
    return [claimType];
}

function getLatestUnlockAtForToken(rows, tokenSymbol) {
    const symbol = String(tokenSymbol || "").toUpperCase();
    let maxUnlockTs = 0;
    for (const row of rows || []) {
        const tokenSymbols = Array.isArray(row?.tokenSymbols) ? row.tokenSymbols.map((s) => String(s || "").toUpperCase()) : [];
        const claimedThisToken = tokenSymbols.includes(symbol);
        if (!claimedThisToken) continue;
        const createdTs = new Date(row.createdAt || 0).getTime();
        if (!Number.isFinite(createdTs) || createdTs <= 0) continue;
        const unlockTs = createdTs + 24 * 60 * 60 * 1000;
        if (unlockTs > maxUnlockTs) maxUnlockTs = unlockTs;
    }
    return maxUnlockTs > 0 ? new Date(maxUnlockTs) : null;
}

function applyFrozenBalanceToSnapshot(snapshotBySymbol, frozenBySymbol, validTokens = ["USDT", "USDC", "WETH"]) {
    const adjusted = {};
    let totalUsd8 = 0n;
    for (const symbol of validTokens) {
        const src = snapshotBySymbol[symbol];
        if (!src) continue;
        const frozenRaw = BigInt(frozenBySymbol?.[symbol] || 0n);
        const availableRaw = src.balanceRaw > frozenRaw ? src.balanceRaw - frozenRaw : 0n;
        const usdValueRaw8 = src.priceRaw8 > 0n
            ? (availableRaw * src.priceRaw8) / (10n ** BigInt(src.decimals))
            : 0n;

        adjusted[symbol] = {
            ...src,
            frozenRaw,
            balanceRaw: availableRaw,
            usdValueRaw8
        };
        totalUsd8 += usdValueRaw8;
    }
    return { snapshot: adjusted, totalUsd8 };
}

function buildCardDeductionPlan(snapshotBySymbol, prioritySymbols, targetUsdRaw8) {
    let remainingUsdRaw8 = BigInt(targetUsdRaw8 || 0n);
    const plan = [];

    for (const symbol of prioritySymbols) {
        if (remainingUsdRaw8 <= 0n) break;
        const token = snapshotBySymbol[symbol];
        if (!token) continue;
        if (token.balanceRaw <= 0n || token.priceRaw8 <= 0n) continue;

        const tokenBase = 10n ** BigInt(token.decimals);
        const maxUsdRaw8 = (token.balanceRaw * token.priceRaw8) / tokenBase;
        if (maxUsdRaw8 <= 0n) continue;

        const usdToUseRaw8 = remainingUsdRaw8 > maxUsdRaw8 ? maxUsdRaw8 : remainingUsdRaw8;
        let deductTokenRaw = (usdToUseRaw8 * tokenBase + token.priceRaw8 - 1n) / token.priceRaw8;
        if (deductTokenRaw > token.balanceRaw) {
            deductTokenRaw = token.balanceRaw;
        }

        const deductedUsdRaw8 = (deductTokenRaw * token.priceRaw8) / tokenBase;
        if (deductedUsdRaw8 <= 0n) continue;

        plan.push({
            symbol,
            tokenAddress: token.tokenAddress,
            tokenDecimals: token.decimals,
            priceRaw8: token.priceRaw8,
            deductTokenRaw,
            deductedUsdRaw8
        });
        remainingUsdRaw8 = remainingUsdRaw8 > deductedUsdRaw8 ? remainingUsdRaw8 - deductedUsdRaw8 : 0n;
    }

    return { plan, remainingUsdRaw8 };
}

function shortenMerchantNameAscii(name, maxLength = 22) {
    const text = String(name || "").trim().replace(/\s+/g, " ");
    if (!text) return "Card Payment";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 3)).trim()}...`;
}

module.exports = {
    normalizeSpendPriority,
    buildCardPaymentPriority,
    normalizeCardDigits,
    getFaucetTokenList,
    getLatestUnlockAtForToken,
    applyFrozenBalanceToSnapshot,
    buildCardDeductionPlan,
    shortenMerchantNameAscii
};

