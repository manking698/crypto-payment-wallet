"use strict";

function createSwapService(input) {
    const {
        persistLedgerTransaction,
        Transaction,
        createNotification
    } = input || {};

    if (!persistLedgerTransaction || !Transaction || !createNotification) {
        throw new Error("createSwapService requires persistLedgerTransaction, Transaction, createNotification");
    }

    async function recordSwapCompletion(payload) {
        const {
            chainId,
            txHash,
            vaultAddress,
            fromSymbol,
            toSymbol,
            fromAmountText,
            toAmountText,
            timestamp,
            userId
        } = payload;

        const journalResult = await persistLedgerTransaction({
            txId: `${txHash}:swap`,
            chainId,
            blockNumber: Number(payload?.blockNumber || 0),
            txHash,
            from: vaultAddress,
            to: vaultAddress,
            origSender: vaultAddress,
            amount: toAmountText,
            tokenSymbol: toSymbol,
            direction: "swap",
            type: "swap",
            bridgeStatus: "completed",
            swapFromSymbol: fromSymbol,
            swapToSymbol: toSymbol,
            swapFromAmount: fromAmountText,
            swapToAmount: toAmountText,
            amountPrimary: `${toAmountText} ${toSymbol}`,
            amountSecondary: `-${fromAmountText} ${fromSymbol}`,
            title: "Swap",
            timestamp
        });

        const swapTx = await Transaction.findOne({
            chainId,
            txHash,
            direction: "swap"
        }).select({ _id: 1 }).lean();

        await createNotification({
            userId,
            type: "transaction",
            title: "Convert completed",
            message: `${fromAmountText} ${fromSymbol} to ${toAmountText} ${toSymbol}`,
            relatedTransactionId: swapTx?._id || null
        });

        return { journalResult };
    }

    return {
        recordSwapCompletion
    };
}

module.exports = {
    createSwapService
};
