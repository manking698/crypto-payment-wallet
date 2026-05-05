"use strict";

function createProvisioningService(deps) {
    const {
        User,
        UserVault,
        deployVault,
        computeVaultAddress,
        createNotification,
        chainId = 11155111,
        logger = console
    } = deps || {};

    let timer = null;
    let running = false;

    async function enqueueForUser(userId) {
        await User.updateOne(
            { _id: userId },
            {
                $set: {
                    registrationStatus: "PENDING_VAULT",
                    registrationError: "",
                    registrationRequestedAt: new Date()
                },
                $setOnInsert: { registrationRetries: 0 }
            }
        );
    }

    async function processOneUser(user) {
        const email = String(user?.email || "").trim().toLowerCase();
        if (!email) return;
        const now = new Date();
        try {
            await User.updateOne(
                { _id: user._id },
                { $set: { registrationLastAttemptAt: now }, $inc: { registrationRetries: 1 } }
            );

            const salt = deployVault.getSalt(email);
            const deployResult = await deployVault.deploy(chainId, salt);
            if (!deployResult.result && deployResult.message !== "already deployed") {
                throw new Error(deployResult.message || "vault deploy failed");
            }
            const vaultAddress = String(deployResult.address || await computeVaultAddress(email)).toLowerCase();

            await UserVault.updateOne(
                { userId: user._id, chainId },
                {
                    $set: { vaultAddress, salt },
                    $setOnInsert: { userId: user._id, chainId, createdAt: new Date() }
                },
                { upsert: true }
            );

            await User.updateOne(
                { _id: user._id },
                {
                    $set: {
                        registrationStatus: "ACTIVE",
                        registrationError: "",
                        registrationCompletedAt: new Date()
                    }
                }
            );

            await createNotification({
                userId: user._id,
                type: "system",
                title: "Welcome",
                message: "Your wallet account is ready"
            });
        } catch (err) {
            await User.updateOne(
                { _id: user._id },
                { $set: { registrationStatus: "FAILED", registrationError: String(err?.message || "provisioning failed") } }
            );
            logger.error?.("[auth-provisioning] failed", {
                userId: String(user._id),
                email,
                error: String(err?.message || err)
            });
        }
    }

    async function processBatch({ limit = 10 } = {}) {
        if (running) return;
        running = true;
        try {
            const users = await User.find({
                registrationStatus: { $in: ["PENDING_VAULT", "FAILED"] }
            })
                .sort({ registrationRequestedAt: 1, createdAt: 1 })
                .limit(limit)
                .lean();

            for (const user of users) {
                // eslint-disable-next-line no-await-in-loop
                await processOneUser(user);
            }
        } finally {
            running = false;
        }
    }

    function startProcessor({ intervalMs = 5000, batchSize = 10 } = {}) {
        if (timer) return;
        timer = setInterval(() => {
            processBatch({ limit: batchSize }).catch((err) => {
                logger.error?.("[auth-provisioning] batch_failed", { error: String(err?.message || err) });
            });
        }, intervalMs);
    }

    function stopProcessor() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    }

    return {
        enqueueForUser,
        processBatch,
        startProcessor,
        stopProcessor
    };
}

module.exports = {
    createProvisioningService
};

