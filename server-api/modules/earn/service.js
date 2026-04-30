"use strict";

function createEarnService(input) {
    const {
        Transaction,
        createNotification,
        formatDisplayAmount
    } = input || {};

    if (!Transaction || !createNotification || !formatDisplayAmount) {
        throw new Error("createEarnService requires Transaction, createNotification, formatDisplayAmount");
    }

    async function recordEarnTransaction(payload) {
        const {
            txHash,
            direction,
            title,
            from,
            to,
            origSender,
            vaultAddress,
            amount,
            token,
            userId,
            notificationTitle,
            notificationMessage
        } = payload;

        const txDoc = await Transaction.create({
            txId: `${txHash}:${direction}`,
            chainId: 11155111,
            txHash,
            from: String(from || "").toLowerCase(),
            to: String(to || "").toLowerCase(),
            origSender: String(origSender || "").toLowerCase(),
            vaultAddress: String(vaultAddress || "").toLowerCase(),
            amount: String(amount || "0"),
            tokenSymbol: String(token || "").toUpperCase(),
            direction,
            type: "earn",
            bridgeStatus: "completed",
            status: "completed",
            title,
            timestamp: new Date()
        });

        await createNotification({
            userId,
            type: "transaction",
            title: notificationTitle,
            message: notificationMessage,
            relatedTransactionId: txDoc._id
        });

        return txDoc;
    }

    function buildSubscribeMessage(amount, token) {
        return `Subscribed ${formatDisplayAmount(amount)} ${token} to earn`;
    }
    function buildRedeemMessage(amount, token) {
        return `Redeemed ${formatDisplayAmount(amount)} ${token} from earn`;
    }
    function buildClaimMessage(amount, token) {
        return `Claimed ${formatDisplayAmount(amount)} ${token} rewards`;
    }

    return {
        recordEarnTransaction,
        buildSubscribeMessage,
        buildRedeemMessage,
        buildClaimMessage
    };
}

module.exports = {
    createEarnService
};

