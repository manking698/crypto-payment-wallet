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

    async function upsertLedgerTransactionPayload(payload) {
        const query = {
            chainId: Number(payload?.chainId || 11155111),
            txHash: String(payload?.txHash || "").toLowerCase(),
            direction: String(payload?.direction || ""),
            tokenSymbol: String(payload?.tokenSymbol || ""),
            from: String(payload?.from || "").toLowerCase(),
            to: String(payload?.to || "").toLowerCase(),
            paymentId: payload?.paymentId || undefined
        };
        await Transaction.updateOne(
            query,
            { $setOnInsert: payload },
            { upsert: true }
        );
    }

    async function enqueueLedgerOutbox(payload, errorMessage) {
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

    async function persistTransaction(payload) {
        try {
            await upsertLedgerTransactionPayload(payload);
            return { ok: true };
        } catch (err) {
            await enqueueLedgerOutbox(payload, err?.message || "journal write failed");
            return { ok: false, queued: true, error: err };
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
        startProcessor
    };
}

module.exports = {
    createLedgerService
};

