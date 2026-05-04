"use strict";

function registerTransactionRoutes(app, deps) {
    const {
        publicLookupLimiter,
        requireAuth,
        authUserLimiter,
        transactionsService,
        toFixed2,
        defaultPageSize = 20,
        observability
    } = deps || {};

    app.post("/api/transactions", publicLookupLimiter, async (req, res) => {
        const vaultAddress = String(req.body?.vaultAddress || "").trim().toLowerCase();
        if (!vaultAddress) {
            return res.status(400).json({ error: "missing vaultAddress" });
        }

        try {
            const latestTxs = await transactionsService.getPublicLatest(vaultAddress, 5);
            return res.json({ transactions: latestTxs });
        } catch (err) {
            observability?.logError(req, { event: "transactions.public_list.failed", route: "/api/transactions", operation: "transactions-public-list", fallbackCategory: "transactions", error: err });
            return res.status(500).json({ error: "transaction query failed" });
        }
    });

    app.get("/api/transactions/history", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").toLowerCase();
            if (!vaultAddress) {
                return res.json({
                    page: 1,
                    limit: defaultPageSize,
                    total: 0,
                    hasMore: false,
                    transactions: []
                });
            }
            const payload = await transactionsService.getHistory(vaultAddress, req.query || {});
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "transactions.history.failed", route: "/api/transactions/history", operation: "transactions-history", fallbackCategory: "transactions", error: err });
            return res.status(500).json({ error: "transaction history failed" });
        }
    });

    app.get("/api/transactions/:id", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const txId = String(req.params.id || "").trim();
            const vaultAddress = String(req.authVault?.vaultAddress || "").toLowerCase();
            if (!vaultAddress) {
                return res.status(404).json({ error: "transaction not found" });
            }
            const mapped = await transactionsService.getById(vaultAddress, txId, { toFixed2 });
            return res.json({ transaction: mapped });
        } catch (err) {
            if (err?.status === 400) {
                return res.status(400).json({ error: err.message || "invalid transaction id" });
            }
            if (err?.status === 404) {
                return res.status(404).json({ error: "transaction not found" });
            }
            observability?.logError(req, { event: "transactions.detail.failed", route: "/api/transactions/:id", operation: "transactions-detail", fallbackCategory: "transactions", error: err });
            return res.status(500).json({ error: "transaction detail failed" });
        }
    });
}

module.exports = {
    registerTransactionRoutes
};
