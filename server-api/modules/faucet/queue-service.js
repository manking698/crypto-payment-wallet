"use strict";

const FAUCET_JOB_TYPE = "faucet_claim";

function createFaucetQueueService(deps) {
    const {
        JobQueue,
        faucetService,
        createNotification,
        UserVault,
        logger = console,
        lockOwner = `faucet-worker-${process.pid}`
    } = deps || {};

    let timer = null;
    let running = false;

    async function enqueueClaim(payload) {
        const now = new Date();
        const doc = await JobQueue.create({
            jobType: FAUCET_JOB_TYPE,
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
        logger.info?.("[faucet-queue] submit request", {
            requestId: String(doc?._id || ""),
            vaultAddress: String(payload?.vaultAddress || "").toLowerCase(),
            claimType: String(payload?.claimType || "").toUpperCase(),
            status: "PENDING"
        });
        return doc;
    }

    async function claimOnePendingJob() {
        const now = new Date();
        const job = await JobQueue.findOneAndUpdate(
            {
                jobType: FAUCET_JOB_TYPE,
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
            logger.info?.("[faucet-queue] get queue", {
                requestId: String(job?._id || ""),
                status: "PROCESSING"
            });
        }
        return job;
    }

    async function notifyByVault(vaultAddress, title, message) {
        const normalized = String(vaultAddress || "").trim().toLowerCase();
        if (!normalized) return;
        const owner = await UserVault.findOne({ vaultAddress: normalized }).select({ userId: 1 }).lean();
        if (!owner?.userId) return;
        await createNotification({
            userId: owner.userId,
            type: "transaction",
            title,
            message
        });
    }

    async function processOneJob(job) {
        try {
            logger.info?.("[faucet-queue] start processing", {
                requestId: String(job?._id || ""),
                vaultAddress: String(job?.payload?.vaultAddress || "").toLowerCase(),
                claimType: String(job?.payload?.claimType || "").toUpperCase(),
                retryCount: Number(job?.retryCount || 0)
            });
            const result = await faucetService.claim(job.payload || {});
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
            logger.info?.("[faucet-queue] processing status", {
                requestId: String(job?._id || ""),
                status: "DONE"
            });
            const tokenText = Array.isArray(result?.tokenSymbols) ? result.tokenSymbols.join(", ") : String(job?.payload?.claimType || "");
            await notifyByVault(job?.payload?.vaultAddress, "Faucet completed", `Faucet claim completed: ${tokenText}`);
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
                            error: String(err?.message || "faucet claim failed"),
                            retryCount,
                            updatedAt: new Date()
                        }
                    }
                );
                logger.warn?.("[faucet-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "FAILED",
                    retryCount,
                    error: String(err?.message || "faucet claim failed")
                });
            } else {
                const nextRunAt = new Date(Date.now() + Math.min(60000, retryCount * 5000));
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "PENDING",
                            error: String(err?.message || "faucet claim failed"),
                            retryCount,
                            nextRunAt,
                            lockedAt: null,
                            lockOwner: "",
                            updatedAt: new Date()
                        }
                    }
                );
                logger.info?.("[faucet-queue] processing status", {
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
                logger.error?.("[faucet-queue] batch failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueueClaim,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createFaucetQueueService,
    FAUCET_JOB_TYPE
};
