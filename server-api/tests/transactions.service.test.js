"use strict";

const { createTransactionsService } = require("../modules/transactions/service");

function chainableLean(rows) {
    return {
        sort() {
            return {
                lean: async () => rows
            };
        }
    };
}

describe("transactions service", () => {
    test("keeps only withdraw record for sender vault when same hash has in/out rows", async () => {
        const sender = "0xsender";
        const receiver = "0xreceiver";
        const txRows = [
            {
                _id: "a1",
                chainId: 11155111,
                txHash: "0xabc",
                direction: "out",
                tokenSymbol: "USDT",
                from: sender,
                to: receiver,
                origSender: sender,
                amount: "10",
                timestamp: new Date("2026-01-01T00:00:00Z")
            },
            {
                _id: "a2",
                chainId: 11155111,
                txHash: "0xabc",
                direction: "in",
                tokenSymbol: "USDT",
                from: sender,
                to: receiver,
                origSender: sender,
                amount: "10",
                timestamp: new Date("2026-01-01T00:00:01Z")
            }
        ];
        const service = createTransactionsService({
            Transaction: { find: jest.fn(() => chainableLean(txRows)) },
            CardPayment: { find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })) },
            mapTransactionForClient: (tx) => ({
                id: String(tx._id),
                chainId: tx.chainId,
                txHash: tx.txHash,
                direction: tx.direction,
                tokenSymbol: tx.tokenSymbol,
                from: tx.from,
                to: tx.to,
                origSender: tx.origSender,
                amount: tx.amount,
                timestamp: tx.timestamp.toISOString(),
                normalizedStatus: "COMPLETED"
            }),
            enrichCardPaymentRows: async (items) => items,
            parseDateStartOfDay: () => null,
            parseDateEndOfDay: () => null,
            DEFAULT_TX_PAGE_SIZE: 5,
            mongoose: { Types: { ObjectId: { isValid: () => true } } }
        });

        const senderHistory = await service.getHistory(sender, { scope: "all", page: 1, limit: 20 });
        expect(senderHistory.transactions).toHaveLength(1);
        expect(senderHistory.transactions[0].direction).toBe("out");

        const receiverHistory = await service.getHistory(receiver, { scope: "all", page: 1, limit: 20 });
        expect(receiverHistory.transactions).toHaveLength(1);
        expect(receiverHistory.transactions[0].direction).toBe("in");
    });
});
