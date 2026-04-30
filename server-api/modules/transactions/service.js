"use strict";

function getStatusRank(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "COMPLETED") return 3;
    if (normalized === "PENDING") return 2;
    if (normalized === "FAILED") return 1;
    return 0;
}

function dedupeMappedTransactions(items) {
    const deduped = new Map();

    for (const tx of items) {
        const txHash = String(tx?.txHash || "").toLowerCase();
        const direction = String(tx?.direction || "").toLowerCase();
        const tokenSymbol = String(tx?.tokenSymbol || "").toUpperCase();
        const chainId = Number(tx?.chainId || 11155111);
        const fallbackId = String(tx?.id || "");
        const paymentId = String(tx?.paymentId || "").trim();

        if (direction === "card-payment" && paymentId) {
            const paymentKey = `${chainId}|card-payment|${paymentId}`;
            const previousByPayment = deduped.get(paymentKey);
            if (!previousByPayment) {
                deduped.set(paymentKey, tx);
                continue;
            }

            const prevStatusRank = getStatusRank(previousByPayment.normalizedStatus);
            const currStatusRank = getStatusRank(tx.normalizedStatus);
            if (currStatusRank > prevStatusRank) {
                deduped.set(paymentKey, tx);
                continue;
            }
            if (currStatusRank < prevStatusRank) {
                continue;
            }

            const prevTime = previousByPayment.timestamp ? Date.parse(previousByPayment.timestamp) : 0;
            const currTime = tx.timestamp ? Date.parse(tx.timestamp) : 0;
            if (currTime >= prevTime) deduped.set(paymentKey, tx);
            continue;
        }

        const key = txHash
            ? `${chainId}|${txHash}|${direction}|${tokenSymbol}`
            : `${chainId}|nohash|${fallbackId}`;

        const previous = deduped.get(key);
        if (!previous) {
            deduped.set(key, tx);
            continue;
        }

        const prevStatusRank = getStatusRank(previous.normalizedStatus);
        const currStatusRank = getStatusRank(tx.normalizedStatus);
        if (currStatusRank > prevStatusRank) {
            deduped.set(key, tx);
            continue;
        }
        if (currStatusRank < prevStatusRank) {
            continue;
        }

        const prevTime = previous.timestamp ? new Date(previous.timestamp).getTime() : 0;
        const currTime = tx.timestamp ? new Date(tx.timestamp).getTime() : 0;
        if (currTime >= prevTime) deduped.set(key, tx);
    }

    const values = Array.from(deduped.values());
    const cardHashKeys = new Set(
        values
            .filter((tx) => String(tx?.direction || "").toLowerCase() === "card-payment")
            .map((tx) => `${Number(tx?.chainId || 11155111)}|${String(tx?.txHash || "").toLowerCase()}`)
            .filter((key) => !key.endsWith("|"))
    );

    return values
        .filter((tx) => {
            const hashKey = `${Number(tx?.chainId || 11155111)}|${String(tx?.txHash || "").toLowerCase()}`;
            if (!cardHashKeys.has(hashKey)) return true;
            return String(tx?.direction || "").toLowerCase() === "card-payment";
        })
        .sort((a, b) => {
            const t1 = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const t2 = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return t2 - t1;
        });
}

function matchTransactionScope(tx, scope) {
    if (scope === "card") return tx.direction === "card-payment";
    if (scope === "vault") return tx.direction !== "card-payment";
    return true;
}

function matchTransactionTypes(tx, selectedTypes) {
    if (!selectedTypes.length) return true;
    return selectedTypes.includes(tx.direction);
}

function buildVaultTransactionsBaseQuery(vaultAddress, fromDate, toDate) {
    const query = {
        chainId: 11155111,
        $or: [
            { from: vaultAddress },
            { to: vaultAddress },
            { origSender: vaultAddress },
            { vaultAddress: vaultAddress }
        ]
    };
    if (fromDate || toDate) {
        query.timestamp = {};
        if (fromDate) query.timestamp.$gte = fromDate;
        if (toDate) query.timestamp.$lte = toDate;
    }
    return query;
}

function createTransactionsService(deps) {
    const {
        Transaction,
        CardPayment,
        mapTransactionForClient,
        enrichCardPaymentRows,
        parseDateStartOfDay,
        parseDateEndOfDay,
        DEFAULT_TX_PAGE_SIZE,
        mongoose
    } = deps;

    async function getCardPaymentTxHashSetByVault(vaultAddress) {
        const normalizedVault = String(vaultAddress || "").trim().toLowerCase();
        if (!normalizedVault) return new Set();

        const rows = await CardPayment.find({
            vaultAddress: normalizedVault,
            status: { $in: ["processing", "completed", "partial_failed"] }
        }).select({ txHashes: 1 }).lean();

        const hashSet = new Set();
        for (const row of rows) {
            const hashes = Array.isArray(row?.txHashes) ? row.txHashes : [];
            for (const hash of hashes) {
                const normalized = String(hash || "").trim().toLowerCase();
                if (normalized) hashSet.add(normalized);
            }
        }
        return hashSet;
    }

    function hideRawCardSettlementRows(mappedItems, cardPaymentTxHashSet) {
        if (!cardPaymentTxHashSet || !cardPaymentTxHashSet.size) return mappedItems;
        return mappedItems.filter((tx) => {
            const direction = String(tx?.direction || "").trim().toLowerCase();
            const txHash = String(tx?.txHash || "").trim().toLowerCase();
            if (!txHash) return true;
            if (!cardPaymentTxHashSet.has(txHash)) return true;
            return direction === "card-payment";
        });
    }

    async function getHistory(vaultAddress, queryInput) {
        const scopeRaw = String(queryInput?.scope || "all").toLowerCase();
        const scope = ["all", "vault", "card"].includes(scopeRaw) ? scopeRaw : "all";
        const page = Math.max(1, Number.parseInt(String(queryInput?.page || "1"), 10) || 1);
        const limit = Math.min(
            50,
            Math.max(1, Number.parseInt(String(queryInput?.limit || String(DEFAULT_TX_PAGE_SIZE)), 10) || DEFAULT_TX_PAGE_SIZE)
        );
        const selectedTypes = String(queryInput?.types || "")
            .split(",")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);

        const fromDate = parseDateStartOfDay(String(queryInput?.fromDate || ""));
        const toDate = parseDateEndOfDay(String(queryInput?.toDate || ""));
        const query = buildVaultTransactionsBaseQuery(vaultAddress, fromDate, toDate);

        const allCandidateTxs = await Transaction.find(query).sort({ timestamp: -1, _id: -1 }).lean();
        const cardPaymentTxHashSet = await getCardPaymentTxHashSetByVault(vaultAddress);
        const filteredTxs = hideRawCardSettlementRows(
            allCandidateTxs.map(mapTransactionForClient),
            cardPaymentTxHashSet
        )
            .filter((tx) => matchTransactionScope(tx, scope))
            .filter((tx) => matchTransactionTypes(tx, selectedTypes));

        const dedupedTxs = await enrichCardPaymentRows(dedupeMappedTransactions(filteredTxs));
        const total = dedupedTxs.length;
        const start = (page - 1) * limit;
        return {
            page,
            limit,
            total,
            hasMore: start + limit < total,
            transactions: dedupedTxs.slice(start, start + limit)
        };
    }

    async function getById(vaultAddress, txId, helpers) {
        if (!mongoose.Types.ObjectId.isValid(txId)) {
            const err = new Error("invalid transaction id");
            err.status = 400;
            throw err;
        }
        const tx = await Transaction.findOne({
            _id: txId,
            chainId: 11155111,
            $or: [
                { from: vaultAddress },
                { to: vaultAddress },
                { origSender: vaultAddress },
                { vaultAddress: vaultAddress }
            ]
        }).lean();
        if (!tx) {
            const err = new Error("transaction not found");
            err.status = 404;
            throw err;
        }

        const mapped = mapTransactionForClient(tx);
        const paymentId = String(mapped?.paymentId || "").trim();
        if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
            const payment = await CardPayment.findById(paymentId).lean();
            if (payment) {
                const paymentCurrency = String(payment.paymentCurrency || mapped.paymentCurrency || "").toUpperCase();
                const paymentAmount = String(payment.paymentAmount || mapped.paymentAmount || "0");
                const usdAmount = String(payment.usdAmount || "0");
                mapped.merchant = String(payment.merchantName || mapped.merchant || "");
                mapped.amountPrimary = `${paymentCurrency} ${helpers.toFixed2(paymentAmount)}`.trim();
                mapped.amountSecondary = `- $${helpers.toFixed2(usdAmount)}`;
                mapped.cardLast4 = String(payment.cardLast4 || mapped.cardLast4 || "");
                mapped.cardPayment = {
                    id: String(payment._id || ""),
                    paymentCurrency,
                    paymentAmount,
                    usdAmount,
                    cardLast4: String(payment.cardLast4 || mapped.cardLast4 || ""),
                    deductedTokens: Array.isArray(payment.deductedTokens) ? payment.deductedTokens : [],
                    plannedTokens: Array.isArray(payment.plannedTokens) ? payment.plannedTokens : []
                };
            }
        }
        return mapped;
    }

    async function getDashboardRecent(vaultAddress, limit = 5) {
        const latestTxs = await Transaction.find(buildVaultTransactionsBaseQuery(vaultAddress, null, null))
            .sort({ timestamp: -1, _id: -1 })
            .limit(500)
            .lean();
        const cardPaymentTxHashSet = await getCardPaymentTxHashSetByVault(vaultAddress);
        const visibleLatestTxs = hideRawCardSettlementRows(latestTxs.map(mapTransactionForClient), cardPaymentTxHashSet);
        const dedupedLatestTxs = await enrichCardPaymentRows(dedupeMappedTransactions(visibleLatestTxs));
        return dedupedLatestTxs.slice(0, limit);
    }

    async function getPublicLatest(vaultAddress, limit = 5) {
        const safeLimit = Math.min(50, Math.max(1, Number.parseInt(String(limit || "5"), 10) || 5));
        const latestTxs = await Transaction.find({
            $or: [{ from: vaultAddress }, { to: vaultAddress }],
            $nor: [{ from: vaultAddress, $nor: [{ to: vaultAddress }], direction: "in" }]
        })
            .sort({ timestamp: -1 })
            .limit(safeLimit);
        return latestTxs;
    }

    return {
        buildVaultTransactionsBaseQuery,
        getHistory,
        getById,
        getDashboardRecent,
        getPublicLatest
    };
}

module.exports = { createTransactionsService };
