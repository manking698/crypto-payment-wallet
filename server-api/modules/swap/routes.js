"use strict";

function registerSwapRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        swapOrchestrator,
        observability
    } = deps || {};

    app.post("/api/swap/quote", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await swapOrchestrator.quote(req.body || {}, vaultAddress);
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                const body = { error: err.message || "swap quote failed" };
                if (typeof err.available !== "undefined") body.available = err.available;
                return res.status(err.status).json(body);
            }
            const detail = String(err?.reason || err?.shortMessage || err?.message || "swap quote failed");
            observability?.logError(req, { event: "swap.quote.failed", route: "/api/swap/quote", operation: "swap-quote", fallbackCategory: "swap", error: err });
            return res.status(500).json({ error: detail });
        }
    });

    app.post("/api/swap", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const vaultAddress = String(req.authVault?.vaultAddress || "").trim().toLowerCase();
            const payload = await swapOrchestrator.execute(req.body || {}, vaultAddress, req.authUser._id);
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                const body = { error: err.message || "swap failed" };
                if (typeof err.available !== "undefined") body.available = err.available;
                if (typeof err.required !== "undefined") body.required = err.required;
                return res.status(err.status).json(body);
            }
            const detail = String(err?.reason || err?.shortMessage || err?.message || "swap failed");
            observability?.logError(req, { event: "swap.execute.failed", route: "/api/swap", operation: "swap-execute", fallbackCategory: "swap", error: err });
            return res.status(500).json({ error: detail });
        }
    });
}

module.exports = {
    registerSwapRoutes
};
