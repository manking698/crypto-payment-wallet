"use strict";

function registerVaultRoutes(app, deps) {
    const {
        publicLookupLimiter,
        vaultOrchestrator,
        observability
    } = deps || {};

    app.post("/api/getVault", publicLookupLimiter, async (req, res) => {
        try {
            const payload = await vaultOrchestrator.resolveVaultAddressByEmail(
                req.body?.email,
                Number(req.body?.chainId || 11155111)
            );
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                return res.status(err.status).json({ error: err.message || "get vault failed" });
            }
            observability?.logError(req, { event: "vault.get_by_email.failed", route: "/api/getVault", operation: "vault-get", fallbackCategory: "vault", error: err });
            return res.status(500).json({ error: "get vault error: " + err.message });
        }
    });

    app.post("/api/withdraw", publicLookupLimiter, async (req, res) => {
        try {
            const payload = await vaultOrchestrator.withdrawByEmail(req.body || {});
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                const body = { error: err.message || "withdraw failed" };
                if (typeof err.token !== "undefined") body.token = err.token;
                if (typeof err.requested !== "undefined") body.requested = err.requested;
                if (typeof err.available !== "undefined") body.available = err.available;
                if (typeof err.frozen !== "undefined") body.frozen = err.frozen;
                if (typeof err.onchainBalance !== "undefined") body.onchainBalance = err.onchainBalance;
                return res.status(err.status).json(body);
            }
            observability?.logError(req, { event: "vault.withdraw.failed", route: "/api/withdraw", operation: "vault-withdraw", fallbackCategory: "vault", error: err });
            return res.status(500).json({ error: "withdraw error: " + err.message });
        }
    });
}

module.exports = {
    registerVaultRoutes
};
