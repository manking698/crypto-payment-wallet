"use strict";

function createFaucetService(deps) {
    const {
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
        chainId = 11155111
    } = deps || {};

    async function claim(input) {
        const vaultAddress = normalizeVaultAddressInput(input?.vaultAddress, ethers);
        const claimTypeRaw = String(input?.claimType || "").trim().toUpperCase();
        const claimType = ["USDT", "USDC", "WETH", "ALL"].includes(claimTypeRaw) ? claimTypeRaw : "";
        if (!vaultAddress) {
            const error = new Error("invalid vault address");
            error.status = 400;
            throw error;
        }
        if (!claimType) {
            const error = new Error("invalid claim type");
            error.status = 400;
            throw error;
        }
        if (!backendPrivateKey || !backendSigner?.address) {
            const error = new Error("faucet signer is not configured");
            error.status = 500;
            throw error;
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
            const error = new Error(`Claim completed for today. Please claim again after ${nextClaimAt.toISOString()}`);
            error.status = 429;
            error.nextClaimAt = nextClaimAt.toISOString();
            throw error;
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

        return {
            success: true,
            claimId: String(claim._id),
            vaultAddress,
            claimType,
            tokenSymbols,
            tokenAmount: claimType === "ALL" ? "mixed" : String(tokenAmountBySymbol[tokenSymbols[0]] || ""),
            tokenAmountBySymbol,
            txHashes
        };
    }

    return {
        claim
    };
}

module.exports = {
    createFaucetService
};

