"use strict";

function createDashboardService(deps) {
    const {
        buildDashboardAssets,
        transactionsService,
        VALID_SPEND_PRIORITY_TOKENS
    } = deps;

    function normalizeSpendPriorityToken(user) {
        const token = String(user?.spendPriorityToken || "").toUpperCase();
        return VALID_SPEND_PRIORITY_TOKENS.includes(token) ? token : "USDT";
    }

    async function getSummary(authUser, authVault) {
        const vaultAddress = String(authVault?.vaultAddress || "").toLowerCase();
        const defaultChainId = authVault?.chainId || authUser?.defaultChainId || 11155111;
        const spendPriorityToken = normalizeSpendPriorityToken(authUser);

        if (!vaultAddress) {
            return {
                vaultAddress: "",
                defaultChainId,
                spendPriorityToken,
                totalBalanceUsd: "0.00",
                assets: [],
                transactions: []
            };
        }

        const { totalBalanceUsd, assets } = await buildDashboardAssets(vaultAddress);
        const transactions = await transactionsService.getDashboardRecent(vaultAddress, 5);
        return {
            vaultAddress,
            defaultChainId,
            spendPriorityToken,
            totalBalanceUsd,
            assets,
            transactions
        };
    }

    return {
        getSummary
    };
}

module.exports = { createDashboardService };

