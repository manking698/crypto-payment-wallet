"use strict";

function registerFaucetRoutes(app, deps) {
    const {
        faucetLimiter,
        normalizeVaultAddressInput,
        ethers,
        FaucetClaim,
        getFaucetTokenList,
        getLatestUnlockAtForToken,
        backendPrivateKey,
        backendSigner,
        tokens,
        faucetTokenAmounts,
        tokenDecimals,
        chainId = 11155111,
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
            if (!vaultAddress) {
                return res.status(400).json({ error: "invalid vault address" });
            }
            if (!claimType) {
                return res.status(400).json({ error: "invalid claim type" });
            }
            if (!backendPrivateKey || !backendSigner?.address) {
                return res.status(500).json({ error: "faucet signer is not configured" });
            }

            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const rows = await FaucetClaim.find({
                vaultAddress,
                createdAt: { $gte: since }
            }).sort({ createdAt: 1 }).lean();

            const tokenSymbols = getFaucetTokenList(claimType);
            const blockedUntilList = tokenSymbols
                .map((symbol) => getLatestUnlockAtForToken(rows, symbol))
                .filter(Boolean);
            if (blockedUntilList.length > 0) {
                const nextClaimAt = new Date(Math.max(...blockedUntilList.map((d) => d.getTime())));
                return res.status(429).json({
                    error: `Claim completed for today. Please claim again after ${nextClaimAt.toISOString()}`,
                    nextClaimAt: nextClaimAt.toISOString()
                });
            }

            const txHashes = [];
            const tokenAmountBySymbol = {};
            for (const symbol of tokenSymbols) {
                const tokenAddress = tokens[symbol];
                if (!tokenAddress) throw new Error(`missing token address for ${symbol}`);
                const tokenC = new ethers.Contract(tokenAddress, [
                    "function transfer(address to, uint256 amount) returns (bool)"
                ], backendSigner);
                const amountText = String(faucetTokenAmounts[symbol] || "0");
                const amountRaw = ethers.parseUnits(amountText, tokenDecimals[symbol]);
                const tx = await tokenC.transfer(vaultAddress, amountRaw);
                const receipt = await tx.wait();
                if (!receipt || Number(receipt.status) !== 1) {
                    throw new Error(`faucet transfer failed for ${symbol}`);
                }
                tokenAmountBySymbol[symbol] = amountText;
                txHashes.push(String(tx.hash || "").toLowerCase());
            }

            const claim = await FaucetClaim.create({
                vaultAddress,
                claimType,
                tokenSymbols,
                tokenAmount: claimType === "ALL" ? "mixed" : String(tokenAmountBySymbol[tokenSymbols[0]] || ""),
                tokenAmountBySymbol,
                txHashes,
                senderAddress: String(process.env.SIGNER_ADDRESS || backendSigner.address || "").toLowerCase(),
                chainId,
                createdAt: new Date()
            });

            return res.json({
                success: true,
                claimId: String(claim._id),
                vaultAddress,
                claimType,
                tokenSymbols,
                tokenAmount: claimType === "ALL" ? "mixed" : String(tokenAmountBySymbol[tokenSymbols[0]] || ""),
                tokenAmountBySymbol,
                txHashes
            });
        } catch (err) {
            observability?.logError(req, { event: "faucet.claim.failed", route: "/api/faucet/claim", operation: "faucet-claim", fallbackCategory: "faucet", error: err });
            return res.status(500).json({ error: err.message || "faucet claim failed" });
        }
    });
}

module.exports = {
    registerFaucetRoutes
};
