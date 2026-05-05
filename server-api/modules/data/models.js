"use strict";

function registerModels(mongoose) {
    const transactionSchema = new mongoose.Schema({
        blockNumber: Number,
        txHash: String,
        from: String,
        to: String,
        amount: String,
        tokenSymbol: String,
        direction: String,
        type: String,
        timestamp: Date,
    }, { strict: false });

    const userSchema = new mongoose.Schema({
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        defaultChainId: { type: Number, default: 11155111 },
        spendPriorityToken: { type: String, enum: ["USDT", "USDC", "WETH"], default: "USDT" },
        displayCurrency: { type: String, default: "USD" },
        registrationStatus: { type: String, enum: ["ACTIVE", "PENDING_VAULT", "FAILED"], default: "PENDING_VAULT", index: true },
        registrationError: { type: String, default: "" },
        registrationRetries: { type: Number, default: 0 },
        registrationRequestedAt: { type: Date, default: Date.now },
        registrationLastAttemptAt: { type: Date, default: null },
        registrationCompletedAt: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
        lastLoginAt: { type: Date, default: null }
    });

    const userVaultSchema = new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        chainId: { type: Number, required: true },
        vaultAddress: { type: String, required: true, lowercase: true, trim: true },
        salt: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    });
    userVaultSchema.index({ userId: 1, chainId: 1 }, { unique: true });
    userVaultSchema.index({ chainId: 1, vaultAddress: 1 }, { unique: true });

    const userCardSchema = new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
        cardholderName: { type: String, required: true, trim: true },
        nickname: { type: String, required: false, trim: true, default: "" },
        cardNumber: { type: String, required: true },
        expiryMonth: { type: String, required: true },
        expiryYear: { type: String, required: true },
        cvv: { type: String, required: true },
        pin: { type: String, required: true },
        status: { type: String, enum: ["active", "frozen"], default: "active" },
        perTransactionLimitUsd: { type: Number, default: 1000 },
        dailyLimitUsd: { type: Number, default: 50000 },
        monthlyLimitUsd: { type: Number, default: 200000 },
        vaultDailyLimitUsd: { type: Number, default: 100000 },
        vaultMonthlyLimitUsd: { type: Number, default: 1000000 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    });
    userCardSchema.index({ userId: 1, createdAt: -1 });

    const cardPaymentSchema = new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        cardId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
        paymentCurrency: { type: String, required: true, uppercase: true, trim: true },
        paymentAmount: { type: String, required: true },
        usdAmount: { type: String, required: true },
        cardLast4: { type: String, default: "" },
        fxBase: { type: String, default: "USD" },
        fxRateUsdToPayment: { type: String, required: true },
        spendPriorityToken: { type: String, enum: ["USDT", "USDC", "WETH"], required: true },
        merchantName: { type: String, default: "" },
        merchantRef: { type: String, default: "" },
        status: { type: String, enum: ["processing", "completed", "failed", "partial_failed"], default: "processing" },
        plannedTokens: { type: Array, default: [] },
        reservedTokens: { type: Array, default: [] },
        deductedTokens: { type: Array, default: [] },
        txHashes: { type: [String], default: [] },
        errorMessage: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now }
    }, { strict: false });
    cardPaymentSchema.index({ userId: 1, cardId: 1, createdAt: -1 });

    const notificationSchema = new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        type: { type: String, enum: ["transaction", "system"], required: true, index: true },
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true, trim: true },
        isRead: { type: Boolean, default: false, index: true },
        relatedTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        paymentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        createdAt: { type: Date, default: Date.now, index: true },
        readAt: { type: Date, default: null }
    }, { strict: false });
    notificationSchema.index({ userId: 1, createdAt: -1 });

    const faucetClaimSchema = new mongoose.Schema({
        vaultAddress: { type: String, required: true, lowercase: true, trim: true, index: true },
        claimType: { type: String, enum: ["USDT", "USDC", "WETH", "ALL"], required: true, index: true },
        tokenSymbols: { type: [String], default: [] },
        tokenAmount: { type: String, default: "100" },
        txHashes: { type: [String], default: [] },
        senderAddress: { type: String, default: "" },
        chainId: { type: Number, default: 11155111 },
        createdAt: { type: Date, default: Date.now, index: true }
    }, { strict: false });
    faucetClaimSchema.index({ vaultAddress: 1, createdAt: -1 });

    const ledgerOutboxSchema = new mongoose.Schema({
        dedupeKey: { type: String, required: true, index: true, unique: true },
        status: { type: String, enum: ["pending", "processed", "failed"], default: "pending", index: true },
        txHash: { type: String, default: "", index: true },
        chainId: { type: Number, default: 11155111, index: true },
        direction: { type: String, default: "", index: true },
        payload: { type: mongoose.Schema.Types.Mixed, required: true },
        retries: { type: Number, default: 0 },
        lastError: { type: String, default: "" },
        nextRetryAt: { type: Date, default: Date.now, index: true },
        processedAt: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    }, { strict: false });
    ledgerOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });

    const jobQueueSchema = new mongoose.Schema({
        jobType: { type: String, required: true, index: true },
        status: { type: String, enum: ["PENDING", "PROCESSING", "DONE", "FAILED"], default: "PENDING", index: true },
        payload: { type: mongoose.Schema.Types.Mixed, required: true },
        result: { type: mongoose.Schema.Types.Mixed, default: null },
        error: { type: String, default: "" },
        retryCount: { type: Number, default: 0 },
        maxRetry: { type: Number, default: 3 },
        nextRunAt: { type: Date, default: Date.now, index: true },
        lockedAt: { type: Date, default: null, index: true },
        lockOwner: { type: String, default: "", index: true },
        idempotencyKey: { type: String, default: "", index: true },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now }
    }, { strict: false });
    jobQueueSchema.index({ jobType: 1, status: 1, nextRunAt: 1, createdAt: 1 });

    return {
        Transaction: mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema),
        User: mongoose.models.User || mongoose.model("User", userSchema),
        UserVault: mongoose.models.UserVault || mongoose.model("UserVault", userVaultSchema),
        UserCard: mongoose.models.UserCard || mongoose.model("UserCard", userCardSchema),
        CardPayment: mongoose.models.CardPayment || mongoose.model("CardPayment", cardPaymentSchema),
        Notification: mongoose.models.Notification || mongoose.model("Notification", notificationSchema),
        FaucetClaim: mongoose.models.FaucetClaim || mongoose.model("FaucetClaim", faucetClaimSchema),
        LedgerOutbox: mongoose.models.LedgerOutbox || mongoose.model("LedgerOutbox", ledgerOutboxSchema),
        JobQueue: mongoose.models.JobQueue || mongoose.model("JobQueue", jobQueueSchema)
    };
}

module.exports = {
    registerModels
};
