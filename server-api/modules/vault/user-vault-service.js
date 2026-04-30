"use strict";

function createUserVaultService({ UserVault, logger = console }) {
    async function ensureUserVault(user, chainId = user.defaultChainId || 11155111) {
        return UserVault.findOne({ userId: user._id, chainId }).lean();
    }

    async function ensureUserVaultByAddress(chainId, vaultAddress) {
        const normalizedAddress = String(vaultAddress || "").trim().toLowerCase();
        if (!normalizedAddress) return null;

        let vaultRecord = await UserVault.findOne({ chainId, vaultAddress: normalizedAddress }).lean();
        if (vaultRecord) return vaultRecord;

        const existingVault = await UserVault.findOne({ vaultAddress: normalizedAddress }).lean();
        if (!existingVault) return null;

        await UserVault.updateOne(
            { userId: existingVault.userId, chainId },
            {
                $setOnInsert: {
                    userId: existingVault.userId,
                    chainId,
                    vaultAddress: normalizedAddress,
                    salt: existingVault.salt,
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );

        logger.log("[uservault] created missing chain vault record", {
            userId: String(existingVault.userId),
            chainId,
            vaultAddress: normalizedAddress
        });

        return UserVault.findOne({ chainId, vaultAddress: normalizedAddress }).lean();
    }

    async function ensureUserVaultIndexes() {
        const indexes = await UserVault.collection.indexes();
        const hasLegacyVaultIndex = indexes.some((index) => index.name === "vaultAddress_1");

        if (hasLegacyVaultIndex) {
            await UserVault.collection.dropIndex("vaultAddress_1");
            logger.log("[uservault] dropped legacy vaultAddress_1 index");
        }

        await UserVault.collection.createIndex(
            { userId: 1, chainId: 1 },
            { unique: true, name: "userId_1_chainId_1" }
        );
        await UserVault.collection.createIndex(
            { chainId: 1, vaultAddress: 1 },
            { unique: true, name: "chainId_1_vaultAddress_1" }
        );
    }

    return {
        ensureUserVault,
        ensureUserVaultByAddress,
        ensureUserVaultIndexes
    };
}

module.exports = {
    createUserVaultService
};

