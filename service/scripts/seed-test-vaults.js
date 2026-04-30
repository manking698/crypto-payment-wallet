const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const { deployVault } = require("../deploy-vault-factory");

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    defaultChainId: { type: Number, default: 11155111 },
    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: null }
});

const UserVaultSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    chainId: { type: Number, required: true },
    vaultAddress: { type: String, required: true, lowercase: true, trim: true },
    salt: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
UserVaultSchema.index({ userId: 1, chainId: 1 }, { unique: true });
UserVaultSchema.index({ chainId: 1, vaultAddress: 1 }, { unique: true });

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const UserVault = mongoose.models.UserVault || mongoose.model("UserVault", UserVaultSchema);

function parseRange() {
    const start = Number(process.argv[2] || 501);
    const end = Number(process.argv[3] || start);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
        throw new Error("Usage: node scripts/seed-test-vaults.js <start> <end>");
    }
    return { start, end };
}

async function seedVaults() {
    const { start, end } = parseRange();
    const passwordHash = await bcrypt.hash("test12345", 10);

    for (let i = start; i <= end; i++) {
        const email = `test${i}@hotmail.com`;
        const salt = deployVault.getSalt(email);
        console.log(`deploy email=${email}`);

        const tx = await deployVault.deploy(11155111, salt);
        if (!tx || tx.result !== true || !tx.address) continue;

        const user = await User.findOneAndUpdate(
            { email },
            {
                $setOnInsert: {
                    email,
                    passwordHash,
                    defaultChainId: 11155111,
                    createdAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        await UserVault.updateOne(
            { userId: user._id, chainId: 11155111 },
            {
                $set: {
                    salt,
                    vaultAddress: tx.address.toLowerCase()
                },
                $setOnInsert: {
                    userId: user._id,
                    chainId: 11155111,
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    }
}

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        await seedVaults();
        await mongoose.disconnect();
    })
    .catch(async (err) => {
        console.error("seed-test-vaults failed:", err.message);
        try {
            await mongoose.disconnect();
        } catch (_) {
        }
        process.exit(1);
    });
