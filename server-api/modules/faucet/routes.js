"use strict";

function registerFaucetRoutes(app, deps) {
    const {
        faucetLimiter,
        normalizeVaultAddressInput,
        ethers,
        FaucetClaim,
        faucetService,
        faucetQueueService,
        getFaucetTokenList,
        getLatestUnlockAtForToken,
        backendPrivateKey,
        backendSigner,
        observability
    } = deps || {};

    app.get("/api/faucet/status", faucetLimiter, async (req, res) => {
        try {
            const vaultAddress = normalizeVaultAddressInput(req.query?.vaultAddress, ethers);
            const claimTypeRaw = String(req.query?.claimType || "").trim().toUpperCase();
            const claimType = ["USDT", "USDC", "WETH", "ALL"].includes(claimTypeRaw) ? claimTypeRaw : "USDT";
            if (!vaultAddress) {
                return res.status(400).json({ error: "invalid vault address" });
            }
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const rows = await FaucetClaim.find({
                vaultAddress,
                createdAt: { $gte: since }
            }).sort({ createdAt: 1 }).lean();

            const requestedTokens = getFaucetTokenList(claimType);
            const blockedUntilList = requestedTokens
                .map((symbol) => getLatestUnlockAtForToken(rows, symbol))
                .filter(Boolean);
            const nextClaimAt = blockedUntilList.length
                ? new Date(Math.max(...blockedUntilList.map((d) => d.getTime())))
                : null;
            const eligibleNow = !nextClaimAt;

            return res.json({
                vaultAddress,
                claimType,
                eligibleNow,
                nextClaimAt: nextClaimAt ? nextClaimAt.toISOString() : null
            });
        } catch (err) {
            observability?.logError(req, { event: "faucet.status.failed", route: "/api/faucet/status", operation: "faucet-status", fallbackCategory: "faucet", error: err });
            return res.status(500).json({ error: "faucet status failed" });
        }
    });

    app.post("/api/faucet/claim", faucetLimiter, async (req, res) => {
        try {
            const vaultAddress = normalizeVaultAddressInput(req.body?.vaultAddress, ethers);
            const claimTypeRaw = String(req.body?.claimType || "").trim().toUpperCase();
            const claimType = ["USDT", "USDC", "WETH", "ALL"].includes(claimTypeRaw) ? claimTypeRaw : "";
            if (!vaultAddress) return res.status(400).json({ error: "invalid vault address" });
            if (!claimType) return res.status(400).json({ error: "invalid claim type" });
            if (!backendPrivateKey || !backendSigner?.address) {
                return res.status(500).json({ error: "faucet signer is not configured" });
            }

            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const rows = await FaucetClaim.find({
                vaultAddress,
                createdAt: { $gte: since }
            }).sort({ createdAt: 1 }).lean();
            const requestedTokens = getFaucetTokenList(claimType);
            const blockedUntilList = requestedTokens
                .map((symbol) => getLatestUnlockAtForToken(rows, symbol))
                .filter(Boolean);
            if (blockedUntilList.length > 0) {
                const nextClaimAt = new Date(Math.max(...blockedUntilList.map((d) => d.getTime())));
                return res.status(429).json({
                    error: `Claim completed for today. Please claim again after ${nextClaimAt.toISOString()}`,
                    nextClaimAt: nextClaimAt.toISOString()
                });
            }

            if (faucetQueueService?.enqueueClaim) {
                const queued = await faucetQueueService.enqueueClaim({ vaultAddress, claimType });
                return res.status(202).json({
                    success: true,
                    status: "PENDING",
                    message: "faucet claim submitted and processing",
                    requestId: String(queued?._id || "")
                });
            }

            const payload = await faucetService.claim({ vaultAddress, claimType });
            return res.json(payload);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                const body = { error: err.message || "faucet claim failed" };
                if (typeof err.nextClaimAt !== "undefined") body.nextClaimAt = err.nextClaimAt;
                return res.status(err.status).json(body);
            }
            observability?.logError(req, { event: "faucet.claim.failed", route: "/api/faucet/claim", operation: "faucet-claim", fallbackCategory: "faucet", error: err });
            return res.status(500).json({ error: err.message || "faucet claim failed" });
        }
    });
}

module.exports = {
    registerFaucetRoutes
};
