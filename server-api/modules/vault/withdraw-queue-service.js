"use strict";

const WITHDRAW_JOB_TYPE = "withdraw";

function createWithdrawQueueService(deps) {
    const {
        JobQueue,
        User,
        vaultOrchestrator,
        createNotification,
        logger = console,
        lockOwner = `withdraw-worker-${process.pid}`
    } = deps || {};

    let timer = null;
    let running = false;

    function formatWithdrawAssetAmount(payload) {
        const token = String(payload?.token || "").trim().toUpperCase();
        const amountText = String(payload?.amount || "").trim();
        if (!amountText) return token || "asset";
        return `${token} ${amountText}`.trim();
    }

    async function enqueueWithdraw(payload) {
        const now = new Date();
        const doc = await JobQueue.create({
            jobType: WITHDRAW_JOB_TYPE,
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
        logger.info?.("[withdraw-queue] submit request", {
            requestId: String(doc?._id || ""),
            email: String(payload?.email || "").toLowerCase(),
            token: String(payload?.token || "").toUpperCase(),
            amount: String(payload?.amount || ""),
            toAddress: String(payload?.toAddress || "").toLowerCase(),
            chainId: Number(payload?.chainId || 11155111),
            status: "PENDING"
        });
        return doc;
    }

    async function getActiveSummaryByEmail(email) {
        const normalizedEmail = String(email || "").trim().toLowerCase();
        if (!normalizedEmail) return { count: 0, latestRequestId: "" };
        const rows = await JobQueue.find({
            jobType: WITHDRAW_JOB_TYPE,
            status: { $in: ["PENDING", "PROCESSING"] },
            "payload.email": normalizedEmail
        })
            .select({ _id: 1, createdAt: 1 })
            .sort({ createdAt: -1 })
            .limit(1)
            .lean();
        const count = await JobQueue.countDocuments({
            jobType: WITHDRAW_JOB_TYPE,
            status: { $in: ["PENDING", "PROCESSING"] },
            "payload.email": normalizedEmail
        });
        return {
            count,
            latestRequestId: rows[0]?._id ? String(rows[0]._id) : ""
        };
    }

    async function claimOnePendingJob() {
        const now = new Date();
        const job = await JobQueue.findOneAndUpdate(
            {
                jobType: WITHDRAW_JOB_TYPE,
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
            logger.info?.("[withdraw-queue] get queue", {
                requestId: String(job?._id || ""),
                status: "PROCESSING",
                lockOwner
            });
        }
        return job;
    }

    async function notifyWithdrawResult(payload, success, message) {
        const email = String(payload?.email || "").trim().toLowerCase();
        if (!email) return;
        const user = await User.findOne({ email }).lean();
        if (!user?._id) return;
        await createNotification({
            userId: user._id,
            type: "transaction",
            title: success ? "Withdrawal completed" : "Withdrawal failed",
            message
        });
    }

    async function processOneJob(job) {
        try {
            logger.info?.("[withdraw-queue] start processing", {
                requestId: String(job?._id || ""),
                email: String(job?.payload?.email || "").toLowerCase(),
                token: String(job?.payload?.token || "").toUpperCase(),
                amount: String(job?.payload?.amount || ""),
                retryCount: Number(job?.retryCount || 0)
            });
            const result = await vaultOrchestrator.withdrawByEmail(job.payload || {});
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
            logger.info?.("[withdraw-queue] processing status", {
                requestId: String(job?._id || ""),
                status: "DONE",
                txHash: String(result?.txHash || "")
            });
            const assetAmount = formatWithdrawAssetAmount(job.payload);
            await notifyWithdrawResult(job.payload, true, `Your withdrawal has been completed: ${assetAmount}`);
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
                            error: String(err?.message || "withdraw failed"),
                            retryCount,
                            updatedAt: new Date()
                        }
                    }
                );
                logger.warn?.("[withdraw-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "FAILED",
                    retryCount,
                    error: String(err?.message || "withdraw failed")
                });
                const assetAmount = formatWithdrawAssetAmount(job.payload);
                await notifyWithdrawResult(job.payload, false, `Withdrawal failed: ${assetAmount}. Please try again later`);
            } else {
                const nextRunAt = new Date(Date.now() + Math.min(60000, retryCount * 5000));
                await JobQueue.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            status: "PENDING",
                            error: String(err?.message || "withdraw failed"),
                            retryCount,
                            nextRunAt,
                            lockedAt: null,
                            lockOwner: "",
                            updatedAt: new Date()
                        }
                    }
                );
                logger.info?.("[withdraw-queue] processing status", {
                    requestId: String(job?._id || ""),
                    status: "PENDING_RETRY",
                    retryCount,
                    nextRunAt: nextRunAt.toISOString(),
                    error: String(err?.message || "withdraw failed")
                });
            }
            logger.error?.("[withdraw-queue] process failed", {
                jobId: String(job._id),
                retryCount,
                error: String(err?.message || err)
            });
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
                logger.error?.("[withdraw-queue] batch failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueueWithdraw,
        getActiveSummaryByEmail,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createWithdrawQueueService,
    WITHDRAW_JOB_TYPE
};
