"use strict";

function registerEarnRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        earnOrchestrator,
        observability
    } = deps || {};

    app.get("/api/earn/summary", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await earnOrchestrator.getSummary(vaultAddress);
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "earn.summary.failed", route: "/api/earn/summary", operation: "earn-summary", fallbackCategory: "earn", error: err });
            return res.status(500).json({ error: err.message || "earn summary failed" });
        }
    });

    app.get("/api/earn/history", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await earnOrchestrator.getHistory(vaultAddress, req.query || {});
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "earn.history.failed", route: "/api/earn/history", operation: "earn-history", fallbackCategory: "earn", error: err });
            return res.status(500).json({ error: err.message || "earn history failed" });
        }
    });

    app.post("/api/earn/subscribe", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await earnOrchestrator.subscribe(
                vaultAddress,
                req.body?.token,
                req.body?.amount,
                req.authUser._id
            );
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                return res.status(err.status).json({ error: err.message || "earn subscribe failed" });
            }
            observability?.logError(req, { event: "earn.subscribe.failed", route: "/api/earn/subscribe", operation: "earn-subscribe", fallbackCategory: "earn", error: err });
            return res.status(500).json({ error: err.message || "earn subscribe failed" });
        }
    });

    app.post("/api/earn/redeem", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await earnOrchestrator.redeem(
                vaultAddress,
                req.body?.token,
                req.body?.amount,
                req.authUser._id
            );
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                return res.status(err.status).json({ error: err.message || "earn redemption failed" });
            }
            observability?.logError(req, { event: "earn.redeem.failed", route: "/api/earn/redeem", operation: "earn-redeem", fallbackCategory: "earn", error: err });
            return res.status(500).json({ error: err.message || "earn redemption failed" });
        }
    });

    app.post("/api/earn/claim", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await earnOrchestrator.claim(
                vaultAddress,
                req.body?.token,
                req.authUser._id
            );
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                return res.status(err.status).json({ error: err.message || "earn claim failed" });
            }
            observability?.logError(req, { event: "earn.claim.failed", route: "/api/earn/claim", operation: "earn-claim", fallbackCategory: "earn", error: err });
            return res.status(500).json({ error: err.message || "earn claim failed" });
        }
    });
}

module.exports = {
    registerEarnRoutes
};
