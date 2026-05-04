"use strict";

const { createLedgerService } = require("../modules/ledger/service");

function chainableRows(rows) {
    return {
        sort() { return this; },
        limit() { return { lean: async () => rows }; }
    };
}

describe("ledger service outbox", () => {
    test("queues ledger payload when transaction write fails, then retries it", async () => {
        const updateOne = jest.fn()
            .mockRejectedValueOnce(new Error("mongo write failed"))
            .mockResolvedValueOnce({ upsertedCount: 1 });
        const outboxUpdateOne = jest.fn().mockResolvedValue({});
        const payload = {
            txHash: "0xABC",
            from: "0xFROM",
            to: "0xTO",
            amount: "1",
            tokenSymbol: "usdt",
            direction: "withdraw"
        };

        const service = createLedgerService({
            Transaction: { updateOne },
            LedgerOutbox: {
                updateOne: outboxUpdateOne,
                find: jest.fn(() => chainableRows([{ _id: "o1", payload, retries: 0 }]))
            },
            logger: { error: jest.fn() }
        });

        const result = await service.persistTransaction(payload);
        expect(result).toMatchObject({ ok: false, queued: true });
        expect(outboxUpdateOne).toHaveBeenCalledWith(
            expect.objectContaining({ dedupeKey: "11155111|0xabc|withdraw|USDT||0xfrom|0xto|1" }),
            expect.any(Object),
            { upsert: true }
        );

        await service.processOutboxBatch(10);
        expect(updateOne).toHaveBeenCalledTimes(2);
        expect(outboxUpdateOne).toHaveBeenLastCalledWith(
            { _id: "o1" },
            expect.objectContaining({
                $set: expect.objectContaining({ status: "processed", lastError: "" })
            })
        );
    });

    test("uses an upsert query so duplicate ledger writes are idempotent", async () => {
        const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
        const service = createLedgerService({
            Transaction: { updateOne },
            LedgerOutbox: { updateOne: jest.fn(), find: jest.fn() },
            logger: { error: jest.fn() }
        });

        const first = await service.persistTransaction({
            txHash: "0xHash",
            from: "0xA",
            to: "0xB",
            amount: "5",
            tokenSymbol: "USDC",
            direction: "swap"
        });

        expect(first).toMatchObject({ ok: true, queued: false });
        expect(updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                txHash: "0xhash",
                direction: "swap",
                tokenSymbol: "USDC"
            }),
            expect.objectContaining({ $setOnInsert: expect.any(Object) }),
            { upsert: true }
        );
    });
});
