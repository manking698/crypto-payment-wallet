"use strict";

function createEarnError(status, message) {
    const err = new Error(message || "earn failed");
    err.status = status;
    return err;
}

function createEarnOrchestrator(deps) {
    const {
        ethers,
        Transaction,
        EARN_ALLOWED_SYMBOLS,
        EARN_DEFAULT_APY,
        EARN_MIN_SUBSCRIPTION,
        TOKEN_DECIMALS_BY_SYMBOL,
        EARN_CONTRACT_ADDRESS,
        VAULT_WITHDRAW_ABI,
        backendSigner,
        getEarnContracts,
        getVaultTokenSnapshot,
        getEarnTokenAddress,
        parseEarnAmount,
        normalizeTransactionStatus,
        parseDateStartOfDay,
        parseDateEndOfDay,
        transactionsService,
        earnService
    } = deps;

    function mapEarnHistoryKind(direction) {
        const normalized = String(direction || "").trim().toLowerCase();
        if (normalized === "earn-subscribe") return "subscribe";
        if (normalized === "earn-redemption") return "redemption";
        if (normalized === "earn-reward") return "rewards";
        return "";
    }

    async function getSummary(vaultAddress) {
        if (!vaultAddress) {
            return {
                vaultAddress: "",
                pools: EARN_ALLOWED_SYMBOLS.map((symbol) => ({
                    token: symbol,
                    apy: EARN_DEFAULT_APY[symbol],
                    minSubscription: EARN_MIN_SUBSCRIPTION[symbol],
                    walletBalance: "0",
                    subscribedBalance: "0",
                    totalRewards: "0"
                })),
                description: [
                    "Hourly earnings",
                    "Settled hourly",
                    "Always available",
                    "Easy redeem balance anytime"
                ]
            };
        }

        const assetsSnapshot = await getVaultTokenSnapshot(vaultAddress);
        let contracts = null;
        try {
            contracts = getEarnContracts();
        } catch (_err) {
            contracts = null;
        }

        const claimedRewardRawBySymbol = { USDT: 0n, USDC: 0n, WETH: 0n };
        try {
            const claimedRows = await Transaction.find({
                vaultAddress,
                direction: "earn-reward",
                tokenSymbol: { $in: EARN_ALLOWED_SYMBOLS }
            }).select({ tokenSymbol: 1, amount: 1 }).lean();

            for (const row of claimedRows) {
                const symbol = String(row?.tokenSymbol || "").toUpperCase();
                if (!EARN_ALLOWED_SYMBOLS.includes(symbol)) continue;
                const decimals = Number(TOKEN_DECIMALS_BY_SYMBOL[symbol] || 18);
                let raw = 0n;
                try {
                    raw = ethers.parseUnits(String(row?.amount || "0"), decimals);
                } catch (_e) {
                    raw = 0n;
                }
                if (raw > 0n) claimedRewardRawBySymbol[symbol] += raw;
            }
        } catch (_err) {
            // ignore
        }

        const pools = [];
        let totalEstimatedUsdRaw8 = 0n;
        for (const symbol of EARN_ALLOWED_SYMBOLS) {
            const tokenAddress = getEarnTokenAddress(symbol);
            const decimals = Number(TOKEN_DECIMALS_BY_SYMBOL[symbol] || 18);
            let apy = EARN_DEFAULT_APY[symbol];
            let principalRaw = 0n;
            let claimableRaw = 0n;
            if (contracts) {
                const [apyBpsRaw, pos] = await Promise.all([
                    contracts.read.getApyBps(tokenAddress),
                    contracts.read.getPosition(vaultAddress, tokenAddress)
                ]);
                apy = Number(apyBpsRaw || 0n) > 0 ? Number(apyBpsRaw) / 100 : EARN_DEFAULT_APY[symbol];
                principalRaw = BigInt(pos?.principal || pos?.[0] || 0n);
                claimableRaw = BigInt(pos?.claimable || pos?.[2] || 0n);
            }
            const tokenPriceRaw8 = BigInt(assetsSnapshot?.snapshot?.[symbol]?.priceRaw8 || 0n);
            const totalPoolTokenRaw = principalRaw + claimableRaw;
            const estimatedValueUsdRaw8 = tokenPriceRaw8 > 0n
                ? (totalPoolTokenRaw * tokenPriceRaw8) / (10n ** BigInt(decimals))
                : 0n;
            totalEstimatedUsdRaw8 += estimatedValueUsdRaw8;

            const totalRewardsRaw = BigInt(claimedRewardRawBySymbol[symbol] || 0n);
            pools.push({
                token: symbol,
                apy,
                minSubscription: EARN_MIN_SUBSCRIPTION[symbol],
                walletBalance: ethers.formatUnits(assetsSnapshot?.snapshot?.[symbol]?.balanceRaw || 0n, decimals),
                subscribedBalance: ethers.formatUnits(principalRaw, decimals),
                totalRewards: ethers.formatUnits(totalRewardsRaw, decimals),
                estimatedValueUsd: ethers.formatUnits(estimatedValueUsdRaw8, 8)
            });
        }

        return {
            vaultAddress,
            pools,
            totalEstimatedUsd: ethers.formatUnits(totalEstimatedUsdRaw8, 8),
            description: [
                "Hourly earnings",
                "Settled hourly",
                "Always available",
                "Easy redeem balance anytime"
            ]
        };
    }

    async function getHistory(vaultAddress, queryInput) {
        if (!vaultAddress) {
            return { page: 1, limit: 20, total: 0, hasMore: false, records: [] };
        }

        const tokenRaw = String(queryInput?.token || "ALL").trim().toUpperCase();
        const kindRaw = String(queryInput?.kind || "all").trim().toLowerCase();
        const page = Math.max(1, Number.parseInt(String(queryInput?.page || "1"), 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(String(queryInput?.limit || "20"), 10) || 20));
        const fromDate = parseDateStartOfDay(String(queryInput?.fromDate || ""));
        const toDate = parseDateEndOfDay(String(queryInput?.toDate || ""));

        const txQuery = transactionsService.buildVaultTransactionsBaseQuery(vaultAddress, fromDate, toDate);
        txQuery.direction = { $in: ["earn-subscribe", "earn-redemption", "earn-reward"] };
        if (tokenRaw !== "ALL" && EARN_ALLOWED_SYMBOLS.includes(tokenRaw)) {
            txQuery.tokenSymbol = tokenRaw;
        }

        const rows = await Transaction.find(txQuery).sort({ timestamp: -1, _id: -1 }).lean();
        const mapped = rows
            .map((row) => ({
                id: String(row?._id || ""),
                token: String(row?.tokenSymbol || "").toUpperCase(),
                kind: mapEarnHistoryKind(row?.direction),
                amount: String(row?.amount || "0"),
                txHash: String(row?.txHash || ""),
                status: normalizeTransactionStatus(row) || "COMPLETED",
                timestamp: row?.timestamp ? new Date(row.timestamp).toISOString() : null
            }))
            .filter((row) => Boolean(row.kind));
        const filtered = kindRaw === "all" ? mapped : mapped.filter((row) => row.kind === kindRaw);
        const total = filtered.length;
        const start = (page - 1) * limit;
        return {
            page,
            limit,
            total,
            hasMore: start + limit < total,
            records: filtered.slice(start, start + limit)
        };
    }

    async function subscribe(vaultAddress, token, amount, userId) {
        if (!vaultAddress) throw createEarnError(400, "missing vault address");
        const t = String(token || "").trim().toUpperCase();
        const parsed = parseEarnAmount(t, amount);
        if (!parsed.ok) throw createEarnError(400, parsed.error);
        const tokenAddress = getEarnTokenAddress(t);
        if (!tokenAddress) throw createEarnError(400, "invalid token");

        const { write } = getEarnContracts();
        const vaultContract = new ethers.Contract(vaultAddress, VAULT_WITHDRAW_ABI, backendSigner);

        const tx1 = await vaultContract.withdrawToken(tokenAddress, EARN_CONTRACT_ADDRESS, parsed.amountRaw);
        const r1 = await tx1.wait();
        if (!r1 || Number(r1.status) !== 1) throw createEarnError(500, "vault transfer to earn pool failed");

        const tx2 = await write.depositFor(vaultAddress, tokenAddress, parsed.amountRaw);
        const r2 = await tx2.wait();
        if (!r2 || Number(r2.status) !== 1) throw createEarnError(500, "earn subscription failed");

        const txHash = String(tx2.hash || "").toLowerCase();
        await earnService.recordEarnTransaction({
            txHash,
            direction: "earn-subscribe",
            title: "Earn Subscribe",
            from: vaultAddress,
            to: EARN_CONTRACT_ADDRESS.toLowerCase(),
            origSender: vaultAddress,
            vaultAddress,
            amount: parsed.amount,
            token: t,
            userId,
            notificationTitle: `${t} subscription completed`,
            notificationMessage: earnService.buildSubscribeMessage(parsed.amount, t)
        });
        return { success: true, token: t, amount: parsed.amount, txHash };
    }

    async function redeem(vaultAddress, token, amount, userId) {
        if (!vaultAddress) throw createEarnError(400, "missing vault address");
        const t = String(token || "").trim().toUpperCase();
        const parsed = parseEarnAmount(t, amount, { enforceMin: false });
        if (!parsed.ok) throw createEarnError(400, parsed.error);
        const tokenAddress = getEarnTokenAddress(t);
        if (!tokenAddress) throw createEarnError(400, "invalid token");

        const { write } = getEarnContracts();
        const tx = await write.redeemFor(vaultAddress, tokenAddress, parsed.amountRaw, vaultAddress);
        const receipt = await tx.wait();
        if (!receipt || Number(receipt.status) !== 1) throw createEarnError(500, "earn redemption failed");

        const txHash = String(tx.hash || "").toLowerCase();
        await earnService.recordEarnTransaction({
            txHash,
            direction: "earn-redemption",
            title: "Earn Redemption",
            from: EARN_CONTRACT_ADDRESS.toLowerCase(),
            to: vaultAddress,
            origSender: vaultAddress,
            vaultAddress,
            amount: parsed.amount,
            token: t,
            userId,
            notificationTitle: `${t} redemption completed`,
            notificationMessage: earnService.buildRedeemMessage(parsed.amount, t)
        });
        return { success: true, token: t, amount: parsed.amount, txHash };
    }

    async function claim(vaultAddress, token, userId) {
        if (!vaultAddress) throw createEarnError(400, "missing vault address");
        const t = String(token || "").trim().toUpperCase();
        if (!EARN_ALLOWED_SYMBOLS.includes(t)) throw createEarnError(400, "invalid token");
        const tokenAddress = getEarnTokenAddress(t);
        if (!tokenAddress) throw createEarnError(400, "invalid token");

        const { write } = getEarnContracts();
        const tx = await write.claimFor(vaultAddress, tokenAddress, vaultAddress);
        const receipt = await tx.wait();
        if (!receipt || Number(receipt.status) !== 1) throw createEarnError(500, "earn claim failed");

        const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
        let rewardRaw = 0n;
        for (const log of logs) {
            try {
                const parsed = write.interface.parseLog(log);
                if (parsed && parsed.name === "RewardClaimed") {
                    rewardRaw = BigInt(parsed.args?.reward || 0n);
                }
            } catch (_e) {
                // ignore unrelated logs
            }
        }
        const rewardAmount = ethers.formatUnits(rewardRaw, Number(TOKEN_DECIMALS_BY_SYMBOL[t] || 18));
        const txHash = String(tx.hash || "").toLowerCase();
        await earnService.recordEarnTransaction({
            txHash,
            direction: "earn-reward",
            title: "Earn Reward Claimed",
            from: EARN_CONTRACT_ADDRESS.toLowerCase(),
            to: vaultAddress,
            origSender: vaultAddress,
            vaultAddress,
            amount: rewardAmount,
            token: t,
            userId,
            notificationTitle: `${t} reward claimed`,
            notificationMessage: earnService.buildClaimMessage(rewardAmount, t)
        });
        return { success: true, token: t, amount: rewardAmount, txHash };
    }

    return { getSummary, getHistory, subscribe, redeem, claim };
}

module.exports = { createEarnOrchestrator };

