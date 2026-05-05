"use strict";

const CARD_PAYMENT_JOB_TYPE = "card_payment";

function createCardPaymentQueueService(deps) {
    const {
        JobQueue,
        cardPaymentService,
        logger = console,
        lockOwner = `card-payment-worker-${process.pid}`
    } = deps || {};

    let timer = null;
    let running = false;

    async function enqueuePayment(payload) {
        const now = new Date();
        const doc = await JobQueue.create({
            jobType: CARD_PAYMENT_JOB_TYPE,
            status: "PENDING",
            payload,
            retryCount: 0,
            maxRetry: 3,
            nextRunAt: now,
            lockedAt: null,
            lockOwner: "",
            createdAt: now,
            updatedAt: now
        });
        logger.info?.("[card-payment-queue] submit request", {
            requestId: String(doc?._id || ""),
            merchantName: String(payload?.merchantName || ""),
            paymentCurrency: String(payload?.paymentCurrency || "").toUpperCase(),
            paymentAmount: String(payload?.paymentAmount || ""),
            status: "PENDING"
        });
        return doc;
    }

    async function claimOnePendingJob() {
        const now = new Date();
        const job = await JobQueue.findOneAndUpdate(
            {
                jobType: CARD_PAYMENT_JOB_TYPE,
                status: "PENDING",
                nextRunAt: { $lte: now }
            },
            {
                $set: {
                    status: "PROCESSING",
                    lockedAt: now,
                    lockOwner,
                    updatedAt: now
                }
            },
            {
                sort: { createdAt: 1 },
                returnDocument: "after"
            }
        ).lean();
        if (job) {
            logger.info?.("[card-payment-queue] get queue", {
                requestId: String(job?._id || ""),
                status: "PROCESSING"
            });
        }
        return job;
    }

    async function processOneJob(job) {
        try {
            logger.info?.("[card-payment-queue] start processing", {
                requestId: String(job?._id || ""),
                merchantName: String(job?.payload?.merchantName || ""),
                paymentCurrency: String(job?.payload?.paymentCurrency || "").toUpperCase(),
                paymentAmount: String(job?.payload?.paymentAmount || ""),
                retryCount: Number(job?.retryCount || 0)
            });
            const result = await cardPaymentService.processPayment(job.payload || {});
            await JobQueue.updateOne(
                { _id: job._id },
                {
                    $set: {
                        status: "DONE",
                        result,
                        error: "",
                        updatedAt: new Date()
                    }
                }
            );
            logger.info?.("[card-payment-queue] processing status", {
                requestId: String(job?._id || ""),
                status: "DONE",
                paymentId: String(result?.paymentId || "")
            });
            return;
        } catch (err) {
            const retryCount = Number(job.retryCount || 0) + 1;
            const maxRetry = Number(job.maxRetry || 3);
            const exhausted = retryCount >= maxRetry;
            if (exhausted) {
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "FAILED",
                            error: String(err?.message || "card payment failed"),
                            retryCount,
                            updatedAt: new Date()
                        }
                    }
                );
                logger.warn?.("[card-payment-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "FAILED",
                    retryCount,
                    error: String(err?.message || "card payment failed")
                });
            } else {
                const nextRunAt = new Date(Date.now() + Math.min(60000, retryCount * 5000));
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "PENDING",
                            error: String(err?.message || "card payment failed"),
                            retryCount,
                            nextRunAt,
                            lockedAt: null,
                            lockOwner: "",
                            updatedAt: new Date()
                        }
                    }
                );
                logger.info?.("[card-payment-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "PENDING_RETRY",
                    retryCount,
                    nextRunAt: nextRunAt.toISOString()
                });
            }
        }
    }

    async function processBatch({ batchSize = 5 } = {}) {
        if (running) return;
        running = true;
        try {
            for (let i = 0; i < batchSize; i += 1) {
                // eslint-disable-next-line no-await-in-loop
                const job = await claimOnePendingJob();
                if (!job) break;
                // eslint-disable-next-line no-await-in-loop
                await processOneJob(job);
            }
        } finally {
            running = false;
        }
    }

    function startProcessor({ intervalMs = 5000, batchSize = 5 } = {}) {
        if (timer) return;
        timer = setInterval(() => {
            processBatch({ batchSize }).catch((err) => {
                logger.error?.("[card-payment-queue] batch failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueuePayment,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createCardPaymentQueueService,
    CARD_PAYMENT_JOB_TYPE
};

