"use strict";

function registerLedgerInternalRoutes(app, deps) {
    const {
        ledgerService,
        errorMetricsService,
        observability
    } = deps || {};

    const internalKey = String(process.env.INTERNAL_API_KEY || "").trim();

    function requireInternalKey(req, res, next) {
        if (!internalKey) {
            return res.status(403).json({ error: "internal api disabled" });
        }
        const provided = String(req.headers["x-internal-key"] || "").trim();
        if (!provided || provided !== internalKey) {
            return res.status(401).json({ error: "invalid internal api key" });
        }
        return next();
    }

    app.get("/api/internal/ledger-outbox", requireInternalKey, async (req, res) => {
        try {
            const payload = await ledgerService.listOutbox({
                page: req.query?.page,
                limit: req.query?.limit,
                status: req.query?.status
            });
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "ledger.outbox.list.failed", route: "/api/internal/ledger-outbox", operation: "ledger-outbox-list", fallbackCategory: "ledger", error: err });
            return res.status(500).json({ error: "ledger outbox list failed" });
        }
    });

    app.get("/api/internal/ledger-outbox/stats", requireInternalKey, async (req, res) => {
        try {
            const payload = await ledgerService.getOutboxFailureStats();
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "ledger.outbox.stats.failed", route: "/api/internal/ledger-outbox/stats", operation: "ledger-outbox-stats", fallbackCategory: "ledger", error: err });
            return res.status(500).json({ error: "ledger outbox stats failed" });
        }
    });

    app.post("/api/internal/ledger-outbox/retry", requireInternalKey, async (req, res) => {
        try {
            const limitRaw = Number(req.body?.limit || req.query?.limit || 50);
            const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(300, Math.floor(limitRaw)) : 50;
            await ledgerService.processOutboxBatch(limit);
            return res.json({ success: true, processedBatchLimit: limit });
        } catch (err) {
            observability?.logError(req, { event: "ledger.outbox.retry.failed", route: "/api/internal/ledger-outbox/retry", operation: "ledger-outbox-retry", fallbackCategory: "ledger", error: err });
            return res.status(500).json({ error: "ledger outbox retry failed" });
        }
    });

    app.get("/api/internal/observability/error-metrics", requireInternalKey, async (_req, res) => {
        const items = errorMetricsService?.list?.() || [];
        return res.json({
            totalGroups: items.length,
            items
        });
    });
}

module.exports = {
    registerLedgerInternalRoutes
};
