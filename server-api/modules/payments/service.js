"use strict";

function createPaymentsService(input) {
    const {
        persistLedgerTransaction,
        CardPayment,
        Transaction,
        createNotification
    } = input || {};

    if (!persistLedgerTransaction || !CardPayment || !Transaction || !createNotification) {
        throw new Error("createPaymentsService requires persistLedgerTransaction, CardPayment, Transaction, createNotification");
    }

    async function persistCardPaymentLedgerEntry(payload) {
        const {
            chainId,
            txHash,
            vaultAddress,
            settlementAddress,
            tokenAmountText,
            tokenSymbol,
            merchantShort,
            merchantFull,
            country,
            paymentCurrency,
            paymentAmountFixed2,
            deductedUsdText2,
            paymentId,
            paymentAmount,
            cardLast4,
            spendPriorityToken,
            timestamp,
            blockNumber
        } = payload;

        await persistLedgerTransaction({
            chainId,
            blockNumber: Number(blockNumber || 0),
            txHash,
            from: vaultAddress,
            to: settlementAddress,
            origSender: vaultAddress,
            vaultAddress,
            amount: tokenAmountText,
            tokenSymbol,
            direction: "card-payment",
            type: "card-payment",
            bridgeStatus: "card-payment",
            merchant: merchantShort,
            merchantFullName: merchantFull,
            country: country || paymentCurrency,
            amountPrimary: `${paymentCurrency} ${paymentAmountFixed2}`,
            amountSecondary: `- $${deductedUsdText2}`,
            title: "Card payment",
            paymentId,
            paymentCurrency,
            paymentAmount,
            cardLast4,
            spendPriorityToken,
            timestamp
        });
    }

    async function finalizeCardPaymentSuccess(input) {
        const { paymentDocId, deductedTokens, txHashes, userId, merchantShort, paymentCurrency, paymentAmountFixed2 } = input;
        await CardPayment.updateOne(
            { _id: paymentDocId },
            {
                $set: {
                    status: "completed",
                    reservedTokens: [],
                    deductedTokens,
                    txHashes,
                    updatedAt: new Date()
                }
            }
        );

        const cardPaymentTx = await Transaction.findOne({
            paymentId: paymentDocId,
            direction: "card-payment"
        }).sort({ timestamp: -1, _id: -1 }).select({ _id: 1 }).lean();

        await createNotification({
            userId,
            type: "transaction",
            title: "Payment completed",
            message: `${merchantShort} · ${paymentCurrency} ${paymentAmountFixed2}`,
            relatedTransactionId: cardPaymentTx?._id || null,
            paymentId: paymentDocId
        });
    }

    async function finalizeCardPaymentFailure(input) {
        const { paymentDocId, txHashes, deductedTokens, unresolvedReservedTokens, errorMessage } = input;
        await CardPayment.updateOne(
            { _id: paymentDocId },
            {
                $set: {
                    status: txHashes.length ? "partial_failed" : "failed",
                    reservedTokens: unresolvedReservedTokens,
                    deductedTokens,
                    txHashes,
                    errorMessage: errorMessage || "card payment failed",
                    updatedAt: new Date()
                }
            }
        );
    }

    return {
        persistCardPaymentLedgerEntry,
        finalizeCardPaymentSuccess,
        finalizeCardPaymentFailure
    };
}

module.exports = {
    createPaymentsService
};

