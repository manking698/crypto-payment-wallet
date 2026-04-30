"use strict";

function createVaultSnapshotService({
    ethers,
    provider,
    CardPayment,
    TOKENS,
    TOKEN_DECIMALS_BY_SYMBOL,
    VALID_SPEND_PRIORITY_TOKENS,
    VAULT_DASHBOARD_ABI,
    ERC20_ABI
}) {
    async function getVaultTokenSnapshot(vaultAddress) {
        const vaultContract = new ethers.Contract(vaultAddress, VAULT_DASHBOARD_ABI, provider);
        const [usdtPriceRaw, usdcPriceRaw, wethPriceRaw] = await Promise.all([
            vaultContract.getUsdtPrice(),
            vaultContract.getUsdcPrice(),
            vaultContract.getWethPrice()
        ]);

        const tokenPriceRawBySymbol = {
            USDT: BigInt(usdtPriceRaw),
            USDC: BigInt(usdcPriceRaw),
            WETH: BigInt(wethPriceRaw)
        };

        const snapshot = {};
        let totalUsd8 = 0n;
        for (const symbol of VALID_SPEND_PRIORITY_TOKENS) {
            const tokenAddress = TOKENS[symbol];
            const decimals = TOKEN_DECIMALS_BY_SYMBOL[symbol];
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
            const balanceRaw = BigInt(await tokenContract.balanceOf(vaultAddress));
            const priceRaw8 = BigInt(tokenPriceRawBySymbol[symbol] || 0n);
            const usdValueRaw8 = priceRaw8 > 0n
                ? (balanceRaw * priceRaw8) / (10n ** BigInt(decimals))
                : 0n;

            snapshot[symbol] = {
                symbol,
                tokenAddress,
                decimals,
                balanceRaw,
                priceRaw8,
                usdValueRaw8
            };
            totalUsd8 += usdValueRaw8;
        }

        return { snapshot, totalUsd8 };
    }

    async function getFrozenTokenRawByVault(vaultAddress) {
        const rows = await CardPayment.find({
            vaultAddress: String(vaultAddress || "").trim().toLowerCase(),
            status: { $in: ["processing", "partial_failed", "failed"] }
        }).select({ reservedTokens: 1 }).lean();

        const frozen = { USDT: 0n, USDC: 0n, WETH: 0n };
        for (const row of rows) {
            const list = Array.isArray(row?.reservedTokens) ? row.reservedTokens : [];
            for (const item of list) {
                const symbol = String(item?.tokenSymbol || "").trim().toUpperCase();
                if (!VALID_SPEND_PRIORITY_TOKENS.includes(symbol)) continue;
                const raw = String(item?.tokenAmountRaw || "0").trim();
                if (!/^\d+$/.test(raw)) continue;
                frozen[symbol] += BigInt(raw);
            }
        }
        return frozen;
    }

    return {
        getVaultTokenSnapshot,
        getFrozenTokenRawByVault
    };
}

module.exports = {
    createVaultSnapshotService
};

