"use strict";

function registerVaultRoutes(app, deps) {
    const {
        publicLookupLimiter,
        requireAuth,
        authUserLimiter,
        vaultOrchestrator,
        withdrawQueueService,
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
            const input = req.body || {};
            const email = String(input?.email || "").trim().toLowerCase();
            const amount = String(input?.amount || "").trim();
            const toAddress = String(input?.toAddress || "").trim();
            const token = String(input?.token || "").trim().toUpperCase();
            const chainId = Number(input?.chainId || 11155111);
            if (!email || !amount || !toAddress || !token) {
                return res.status(400).json({ error: "missing required parameters" });
            }

            if (withdrawQueueService?.enqueueWithdraw) {
                const queued = await withdrawQueueService.enqueueWithdraw({
                    email,
                    amount,
                    toAddress,
                    token,
                    chainId
                });

                return res.status(202).json({
                    success: true,
                    status: "PENDING",
                    message: "withdrawal submitted and processing",
                    requestId: String(queued?._id || "")
                });
            }

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

    app.get("/api/withdraw/active-summary", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const email = String(req.authUser?.email || "").trim().toLowerCase();
            const summary = await withdrawQueueService.getActiveSummaryByEmail(email);
            return res.json(summary);
        } catch (err) {
            observability?.logError(req, { event: "vault.withdraw.active_summary.failed", route: "/api/withdraw/active-summary", operation: "withdraw-active-summary", fallbackCategory: "vault", error: err });
            return res.status(500).json({ error: "withdraw active summary query failed" });
        }
    });
}

module.exports = {
    registerVaultRoutes
};
