"use strict";

function createDashboardAssetsService({
    DASHBOARD_TOKENS,
    VALID_SPEND_PRIORITY_TOKENS,
    formatTokenUnits,
    formatDisplayUnits,
    formatUsdUnits,
    getVaultTokenSnapshot,
    getFrozenTokenRawByVault,
    applyFrozenBalanceToSnapshot,
    logger = console
}) {
    async function buildDashboardAssets(vaultAddress) {
        const { snapshot: onchainSnapshot } = await getVaultTokenSnapshot(vaultAddress);
        const frozenBySymbol = await getFrozenTokenRawByVault(vaultAddress);
        const { snapshot, totalUsd8 } = applyFrozenBalanceToSnapshot(
            onchainSnapshot,
            frozenBySymbol,
            VALID_SPEND_PRIORITY_TOKENS
        );

        const assets = DASHBOARD_TOKENS
            .map((token) => {
                const row = snapshot[token.symbol];
                if (!row || row.balanceRaw <= 0n) return null;

                return {
                    symbol: token.symbol,
                    balance: formatTokenUnits(
                        row.balanceRaw,
                        token.decimals,
                        Math.min(Number(token.displayDecimals || token.decimals || 8), 8)
                    ),
                    usdValue: formatDisplayUnits(row.usdValueRaw8, token.priceDecimals, 2),
                    decimals: token.decimals
                };
            })
            .filter(Boolean);

        const result = {
            totalBalanceUsd: formatUsdUnits(totalUsd8),
            assets
        };

        logger.log("[dashboard-assets]", {
            vaultAddress,
            totalBalanceUsd: result.totalBalanceUsd,
            frozen: {
                USDT: String(frozenBySymbol?.USDT || 0n),
                USDC: String(frozenBySymbol?.USDC || 0n),
                WETH: String(frozenBySymbol?.WETH || 0n)
            },
            assets: result.assets
        });

        return result;
    }

    return {
        buildDashboardAssets
    };
}

module.exports = {
    createDashboardAssetsService
};

