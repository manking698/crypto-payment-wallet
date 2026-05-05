"use strict";

const EARN_JOB_TYPES = {
    SUBSCRIBE: "earn_subscribe",
    REDEEM: "earn_redeem",
    CLAIM: "earn_claim"
};

function createEarnQueueService(deps) {
    const {
        JobQueue,
        earnOrchestrator,
        createNotification,
        logger = console,
        lockOwner = `earn-worker-${process.pid}`
    } = deps || {};

    let timer = null;
    let running = false;

    async function enqueueJob(jobType, payload) {
        const now = new Date();
        const doc = await JobQueue.create({
            jobType,
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
        logger.info?.("[earn-queue] submit request", {
            requestId: String(doc?._id || ""),
            jobType,
            userId: String(payload?.userId || ""),
            token: String(payload?.token || "").toUpperCase(),
            amount: String(payload?.amount || "")
        });
        return doc;
    }

    async function enqueueSubscribe(payload) {
        return enqueueJob(EARN_JOB_TYPES.SUBSCRIBE, payload);
    }

    async function enqueueRedeem(payload) {
        return enqueueJob(EARN_JOB_TYPES.REDEEM, payload);
    }

    async function enqueueClaim(payload) {
        return enqueueJob(EARN_JOB_TYPES.CLAIM, payload);
    }

    async function claimOnePendingJob() {
        const now = new Date();
        const job = await JobQueue.findOneAndUpdate(
            {
                jobType: { $in: Object.values(EARN_JOB_TYPES) },
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
            logger.info?.("[earn-queue] get queue", {
                requestId: String(job?._id || ""),
                jobType: String(job?.jobType || ""),
                status: "PROCESSING"
            });
        }
        return job;
    }

    async function executeByType(job) {
        const p = job?.payload || {};
        const vaultAddress = String(p?.vaultAddress || "").toLowerCase();
        const token = String(p?.token || "").toUpperCase();
        const amount = String(p?.amount || "");
        const userId = p?.userId;

        if (job.jobType === EARN_JOB_TYPES.SUBSCRIBE) {
            return earnOrchestrator.subscribe(vaultAddress, token, amount, userId);
        }
        if (job.jobType === EARN_JOB_TYPES.REDEEM) {
            return earnOrchestrator.redeem(vaultAddress, token, amount, userId);
        }
        return earnOrchestrator.claim(vaultAddress, token, userId);
    }

    async function notifyEarnFailed(job) {
        const p = job?.payload || {};
        const token = String(p?.token || "").toUpperCase();
        const amount = String(p?.amount || "");
        const typeLabel = job?.jobType === EARN_JOB_TYPES.SUBSCRIBE
            ? "Subscribe"
            : job?.jobType === EARN_JOB_TYPES.REDEEM
                ? "Redeem"
                : "Claim";
        const amountText = amount ? `: ${token} ${amount}` : `: ${token}`;
        const isClaim = job?.jobType === EARN_JOB_TYPES.CLAIM;
        await createNotification({
            userId: p?.userId,
            type: "transaction",
            title: isClaim ? `${token} reward result` : `${typeLabel} failed`,
            message: isClaim
                ? `No matured reward yet for ${token}. Please try again later`
                : `${typeLabel} failed${amountText}. Please try again later`
        });
    }

    async function processOneJob(job) {
        try {
            logger.info?.("[earn-queue] start processing", {
                requestId: String(job?._id || ""),
                jobType: String(job?.jobType || ""),
                token: String(job?.payload?.token || "").toUpperCase(),
                amount: String(job?.payload?.amount || ""),
                retryCount: Number(job?.retryCount || 0)
            });
            const result = await executeByType(job);
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
            logger.info?.("[earn-queue] processing status", {
                requestId: String(job?._id || ""),
                jobType: String(job?.jobType || ""),
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
                            error: String(err?.message || "earn request failed"),
                            retryCount,
                            updatedAt: new Date()
                        }
                    }
                );
                await notifyEarnFailed(job);
                logger.warn?.("[earn-queue] processing status", {
                    requestId: String(job?._id || ""),
                    jobType: String(job?.jobType || ""),
                    status: "FAILED",
                    retryCount,
                    error: String(err?.message || "earn request failed")
                });
            } else {
                const nextRunAt = new Date(Date.now() + Math.min(60000, retryCount * 5000));
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "PENDING",
                            error: String(err?.message || "earn request failed"),
                            retryCount,
                            nextRunAt,
                            lockedAt: null,
                            lockOwner: "",
                            updatedAt: new Date()
                        }
                    }
                );
                logger.info?.("[earn-queue] processing status", {
                    requestId: String(job?._id || ""),
                    jobType: String(job?.jobType || ""),
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
                logger.error?.("[earn-queue] batch failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueueSubscribe,
        enqueueRedeem,
        enqueueClaim,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createEarnQueueService,
    EARN_JOB_TYPES
};
