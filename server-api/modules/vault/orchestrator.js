"use strict";

function createVaultError(status, message, extra = {}) {
    const err = new Error(message || "vault request failed");
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function createVaultOrchestrator(deps) {
    const {
        ethers,
        provider,
        backendSigner,
        TOKENS,
        VAULT_WITHDRAW_ABI,
        User,
        computeVaultAddress,
        ensureUserVault,
        ensureUserVaultByAddress,
        getFrozenTokenRawByVault,
        persistLedgerTransaction
    } = deps;

    async function resolveVaultAddressByEmail(email, chainId = 11155111) {
        const cleanEmail = String(email || "").trim().toLowerCase();
        if (!cleanEmail) throw createVaultError(400, "missing email");

        const user = await User.findOne({ email: cleanEmail }).lean();
        if (user) {
            const fallbackAddress = await computeVaultAddress(cleanEmail);
            const vaultRecord = await ensureUserVault(user, chainId)
                || await ensureUserVaultByAddress(chainId, fallbackAddress);
            if (vaultRecord?.vaultAddress) {
                return { vaultAddress: vaultRecord.vaultAddress };
            }
        }
        const vaultAddress = await computeVaultAddress(cleanEmail);
        return { vaultAddress };
    }

    async function withdrawByEmail(reqBody) {
        const { email, amount, toAddress, token } = reqBody || {};
        const chainId = Number(reqBody?.chainId || 11155111);
        if (!email || !amount || !toAddress || !token) {
            throw createVaultError(400, "missing required parameters");
        }

        const cleanEmail = String(email).trim().toLowerCase();
        const user = await User.findOne({ email: cleanEmail }).lean();
        const fallbackAddress = await computeVaultAddress(cleanEmail);
        const vaultRecord = user
            ? await ensureUserVault(user, chainId) || await ensureUserVaultByAddress(chainId, fallbackAddress)
            : null;
        const vaultAddress = vaultRecord?.vaultAddress || fallbackAddress;
        if (vaultAddress === ethers.ZeroAddress) {
            throw createVaultError(400, "invalid email salt");
        }

        const normalizedToken = String(token).toUpperCase();
        const tokenDecimalsByKey = { USDT: 6, USDC: 6, WETH: 18 };
        const tokenAddressByKey = { USDT: TOKENS.USDT, USDC: TOKENS.USDC, WETH: TOKENS.WETH };
        if (!tokenAddressByKey[normalizedToken]) {
            throw createVaultError(400, "unsupported token");
        }

        const tokenAddress = tokenAddressByKey[normalizedToken];
        const tokenDecimals = tokenDecimalsByKey[normalizedToken];
        const tokenC = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);

        const balance = await tokenC.balanceOf(vaultAddress);
        const frozenBySymbol = await getFrozenTokenRawByVault(vaultAddress);
        const frozenRaw = BigInt(frozenBySymbol?.[normalizedToken] || 0n);
        const availableBalance = balance > frozenRaw ? balance - frozenRaw : 0n;
        const required = ethers.parseUnits(String(amount), tokenDecimals);
        if (availableBalance < required) {
            throw createVaultError(400, `Vault ${normalizedToken} available balance is insufficient`, {
                token: normalizedToken,
                requested: ethers.formatUnits(required, tokenDecimals),
                available: ethers.formatUnits(availableBalance, tokenDecimals),
                frozen: ethers.formatUnits(frozenRaw, tokenDecimals),
                onchainBalance: ethers.formatUnits(balance, tokenDecimals)
            });
        }

        const vaultC = new ethers.Contract(vaultAddress, VAULT_WITHDRAW_ABI, backendSigner);
        const tx = await vaultC.withdrawToken(tokenAddress, toAddress, required);
        const receipt = await tx.wait();

        const journalResult = await persistLedgerTransaction({
            chainId,
            blockNumber: Number(receipt?.blockNumber || 0),
            txHash: String(tx.hash || "").toLowerCase(),
            from: String(vaultAddress || "").toLowerCase(),
            to: String(toAddress || "").toLowerCase(),
            origSender: String(vaultAddress || "").toLowerCase(),
            amount: String(amount),
            tokenSymbol: normalizedToken,
            direction: "out",
            type: "withdrawal",
            bridgeStatus: "completed",
            timestamp: new Date()
        });

        return {
            success: true,
            txHash: tx.hash,
            message: "withdraw done",
            journalQueued: Boolean(journalResult?.queued),
            journalTxId: String(journalResult?.txId || "")
        };
    }

    return {
        resolveVaultAddressByEmail,
        withdrawByEmail
    };
}

module.exports = { createVaultOrchestrator };
