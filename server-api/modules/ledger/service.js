"use strict";

function createLedgerService(input) {
    const {
        Transaction,
        LedgerOutbox,
        logger = console
    } = input || {};

    if (!Transaction || !LedgerOutbox) {
        throw new Error("createLedgerService requires Transaction and LedgerOutbox models");
    }

    function buildLedgerDedupeKey(payload) {
        const chainId = Number(payload?.chainId || 11155111);
        const txHash = String(payload?.txHash || "").trim().toLowerCase();
        const direction = String(payload?.direction || "").trim().toLowerCase();
        const tokenSymbol = String(payload?.tokenSymbol || "").trim().toUpperCase();
        const paymentId = String(payload?.paymentId || "").trim();
        const from = String(payload?.from || "").trim().toLowerCase();
        const to = String(payload?.to || "").trim().toLowerCase();
        const amount = String(payload?.amount || "").trim();
        return [chainId, txHash, direction, tokenSymbol, paymentId, from, to, amount].join("|");
    }

    function buildFallbackTxId(payload) {
        const chainId = Number(payload?.chainId || 11155111);
        const txHash = String(payload?.txHash || "").trim().toLowerCase();
        const direction = String(payload?.direction || "").trim().toLowerCase();
        const tokenSymbol = String(payload?.tokenSymbol || "").trim().toUpperCase();
        const paymentId = String(payload?.paymentId || "").trim();
        const from = String(payload?.from || "").trim().toLowerCase();
        const to = String(payload?.to || "").trim().toLowerCase();
        const amount = String(payload?.amount || "").trim();
        return [chainId, txHash, direction, tokenSymbol, paymentId, from, to, amount].join(":");
    }

    function normalizeLedgerPayload(rawPayload) {
        const payload = { ...(rawPayload || {}) };
        payload.chainId = Number(payload?.chainId || 11155111);
        payload.txHash = String(payload?.txHash || "").trim().toLowerCase();
        payload.from = String(payload?.from || "").trim().toLowerCase();
        payload.to = String(payload?.to || "").trim().toLowerCase();
        payload.direction = String(payload?.direction || "").trim().toLowerCase();
        payload.tokenSymbol = String(payload?.tokenSymbol || "").trim().toUpperCase();
        payload.amount = String(payload?.amount || "").trim();
        payload.txId = String(payload?.txId || "").trim() || buildFallbackTxId(payload);
        return payload;
    }

    async function upsertLedgerTransactionPayload(rawPayload) {
        const payload = normalizeLedgerPayload(rawPayload);
        const query = {
            txId: String(payload.txId),
            chainId: Number(payload.chainId || 11155111),
            txHash: String(payload.txHash || "").toLowerCase(),
            direction: String(payload.direction || ""),
            tokenSymbol: String(payload.tokenSymbol || ""),
            from: String(payload.from || "").toLowerCase(),
            to: String(payload.to || "").toLowerCase(),
            paymentId: payload?.paymentId || undefined
        };
        await Transaction.updateOne(
            query,
            { $setOnInsert: payload },
            { upsert: true }
        );
    }

    async function enqueueLedgerOutbox(rawPayload, errorMessage) {
        const payload = normalizeLedgerPayload(rawPayload);
        const dedupeKey = buildLedgerDedupeKey(payload);
        const now = new Date();
        await LedgerOutbox.updateOne(
            { dedupeKey },
            {
                $setOnInsert: {
                    dedupeKey,
                    status: "pending",
                    txHash: String(payload?.txHash || "").toLowerCase(),
                    chainId: Number(payload?.chainId || 11155111),
                    direction: String(payload?.direction || ""),
                    payload,
                    retries: 0,
                    lastError: String(errorMessage || "journal write failed"),
                    nextRetryAt: now,
                    createdAt: now,
                    updatedAt: now
                },
                $set: {
                    status: "pending",
                    lastError: String(errorMessage || "journal write failed"),
                    updatedAt: now
                }
            },
            { upsert: true }
        );
    }

    async function persistTransaction(rawPayload) {
        const payload = normalizeLedgerPayload(rawPayload);
        const dedupeKey = buildLedgerDedupeKey(payload);
        try {
            await upsertLedgerTransactionPayload(payload);
            return { ok: true, queued: false, dedupeKey, txId: payload.txId };
        } catch (err) {
            await enqueueLedgerOutbox(payload, err?.message || "journal write failed");
            return { ok: false, queued: true, dedupeKey, txId: payload.txId, error: err };
        }
    }

    async function processOutboxBatch(limit = 20) {
        const now = new Date();
        const items = await LedgerOutbox.find({
            status: { $in: ["pending", "failed"] },
            nextRetryAt: { $lte: now }
        }).sort({ nextRetryAt: 1, createdAt: 1 }).limit(limit).lean();

        for (const item of items) {
            const id = item?._id;
            if (!id) continue;
            try {
                await upsertLedgerTransactionPayload(item.payload || {});
                await LedgerOutbox.updateOne(
                    { _id: id },
                    {
                        $set: {
                            status: "processed",
                            processedAt: new Date(),
                            updatedAt: new Date(),
                            lastError: ""
                        }
                    }
                );
            } catch (err) {
                const retries = Number(item?.retries || 0) + 1;
                const backoffMs = Math.min(10 * 60 * 1000, 5000 * Math.max(1, retries));
                await LedgerOutbox.updateOne(
                    { _id: id },
                    {
                        $set: {
                            status: "failed",
                            retries,
                            lastError: String(err?.message || "outbox retry failed"),
                            nextRetryAt: new Date(Date.now() + backoffMs),
                            updatedAt: new Date()
                        }
                    }
                );
            }
        }
    }

    async function listOutbox(params) {
        const pageRaw = Number(params?.page || 1);
        const limitRaw = Number(params?.limit || 20);
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
        const limit = Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(200, Math.floor(limitRaw))
            : 20;
        const status = String(params?.status || "all").trim().toLowerCase();

        const query = {};
        if (status !== "all") {
            query.status = status;
        }

        const total = await LedgerOutbox.countDocuments(query);
        const rows = await LedgerOutbox.find(query)
            .sort({ updatedAt: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        return {
            page,
            limit,
            total,
            hasMore: page * limit < total,
            items: rows
        };
    }

    async function getOutboxFailureStats() {
        const pipeline = [
            { $match: { status: "failed" } },
            {
                $project: {
                    reason: {
                        $cond: [
                            { $gt: [{ $strLenCP: { $ifNull: ["$lastError", ""] } }, 0] },
                            {
                                $substrCP: [
                                    { $ifNull: ["$lastError", "unknown"] },
                                    0,
                                    120
                                ]
                            },
                            "unknown"
                        ]
                    }
                }
            },
            { $group: { _id: "$reason", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 50 }
        ];

        const byReason = await LedgerOutbox.aggregate(pipeline);
        const totalFailed = byReason.reduce((sum, row) => sum + Number(row?.count || 0), 0);

        return {
            totalFailed,
            byReason: byReason.map((row) => ({
                reason: String(row?._id || "unknown"),
                count: Number(row?.count || 0)
            }))
        };
    }

    function startProcessor(options) {
        const intervalMs = Number(options?.intervalMs || 5000);
        const batchSize = Number(options?.batchSize || 30);
        const timer = setInterval(() => {
            processOutboxBatch(batchSize).catch((err) => {
                logger.error?.("[ledger-outbox] batch failed:", err?.message || err);
            });
        }, intervalMs);
        processOutboxBatch(batchSize).catch((err) => {
            logger.error?.("[ledger-outbox] bootstrap batch failed:", err?.message || err);
        });
        return timer;
    }

    return {
        persistTransaction,
        processOutboxBatch,
        startProcessor,
        listOutbox,
        getOutboxFailureStats
    };
}

module.exports = {
    createLedgerService
};
