"use strict";

function createSwapHelpers({ SWAP_ALLOWED_SYMBOLS }) {
    function normalizeSwapSymbol(value) {
        const symbol = String(value || "").trim().toUpperCase();
        return SWAP_ALLOWED_SYMBOLS.includes(symbol) ? symbol : "";
    }

    function buildSwapQuoteBySnapshot(snapshotBySymbol, fromSymbol, toSymbol, fromAmountRaw) {
        const from = snapshotBySymbol?.[fromSymbol];
        const to = snapshotBySymbol?.[toSymbol];
        if (!from || !to) {
            return { toAmountRaw: 0n, usdRaw8: 0n };
        }
        if (from.priceRaw8 <= 0n || to.priceRaw8 <= 0n) {
            return { toAmountRaw: 0n, usdRaw8: 0n };
        }
        const fromBase = 10n ** BigInt(from.decimals);
        const toBase = 10n ** BigInt(to.decimals);
        const usdRaw8 = (BigInt(fromAmountRaw) * from.priceRaw8) / fromBase;
        const toAmountRaw = (usdRaw8 * toBase) / to.priceRaw8;
        return { toAmountRaw, usdRaw8 };
    }

    return {
        normalizeSwapSymbol,
        buildSwapQuoteBySnapshot
    };
}

module.exports = {
    createSwapHelpers
};

