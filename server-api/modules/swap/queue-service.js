"use strict";

const SWAP_JOB_TYPE = "swap";

function createSwapQueueService(deps) {
    const {
        JobQueue,
        swapOrchestrator,
        createNotification,
        logger = console,
        lockOwner = `swap-worker-${process.pid}`
    } = deps || {};

    let timer = null;
    let running = false;

    async function enqueueSwap(payload) {
        const now = new Date();
        const doc = await JobQueue.create({
            jobType: SWAP_JOB_TYPE,
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
        logger.info?.("[swap-queue] submit request", {
            requestId: String(doc?._id || ""),
            userId: String(payload?.userId || ""),
            fromSymbol: String(payload?.reqBody?.fromSymbol || "").toUpperCase(),
            toSymbol: String(payload?.reqBody?.toSymbol || "").toUpperCase(),
            amount: String(payload?.reqBody?.amount || ""),
            status: "PENDING"
        });
        return doc;
    }

    async function claimOnePendingJob() {
        const now = new Date();
        const job = await JobQueue.findOneAndUpdate(
            {
                jobType: SWAP_JOB_TYPE,
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
            logger.info?.("[swap-queue] get queue", {
                requestId: String(job?._id || ""),
                status: "PROCESSING",
                lockOwner
            });
        }
        return job;
    }

    async function processOneJob(job) {
        try {
            logger.info?.("[swap-queue] start processing", {
                requestId: String(job?._id || ""),
                userId: String(job?.payload?.userId || ""),
                fromSymbol: String(job?.payload?.reqBody?.fromSymbol || "").toUpperCase(),
                toSymbol: String(job?.payload?.reqBody?.toSymbol || "").toUpperCase(),
                amount: String(job?.payload?.reqBody?.amount || ""),
                retryCount: Number(job?.retryCount || 0)
            });
            const result = await swapOrchestrator.execute(
                job?.payload?.reqBody || {},
                String(job?.payload?.vaultAddress || ""),
                job?.payload?.userId
            );

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

            logger.info?.("[swap-queue] processing status", {
                requestId: String(job?._id || ""),
                status: "DONE",
                txHash: String(result?.txHash || "")
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
                            error: String(err?.message || "convert failed"),
                            retryCount,
                            updatedAt: new Date()
                        }
                    }
                );
                await createNotification({
                    userId: job?.payload?.userId,
                    type: "transaction",
                    title: "Convert failed",
                    message: `Conversion failed: ${String(job?.payload?.reqBody?.amount || "")} ${String(job?.payload?.reqBody?.fromSymbol || "").toUpperCase()} to ${String(job?.payload?.reqBody?.toSymbol || "").toUpperCase()}. Please try again later`
                });
                logger.warn?.("[swap-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "FAILED",
                    retryCount,
                    error: String(err?.message || "convert failed")
                });
            } else {
                const nextRunAt = new Date(Date.now() + Math.min(60000, retryCount * 5000));
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "PENDING",
                            error: String(err?.message || "convert failed"),
                            retryCount,
                            nextRunAt,
                            lockedAt: null,
                            lockOwner: "",
                            updatedAt: new Date()
                        }
                    }
                );
                logger.info?.("[swap-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "PENDING_RETRY",
                    retryCount,
                    nextRunAt: nextRunAt.toISOString(),
                    error: String(err?.message || "convert failed")
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
                logger.error?.("[swap-queue] batch failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueueSwap,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createSwapQueueService,
    SWAP_JOB_TYPE
};
