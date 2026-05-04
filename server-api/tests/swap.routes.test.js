"use strict";

const express = require("express");
const request = require("supertest");
const { registerSwapRoutes } = require("../modules/swap/routes");

function buildApp(orchestrator) {
    const app = express();
    app.use(express.json());
    const requireAuth = (req, _res, next) => {
        req.authUser = { _id: "u1" };
        req.authVault = { vaultAddress: "0xabc" };
        next();
    };
    const pass = (_req, _res, next) => next();
    registerSwapRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        swapOrchestrator: orchestrator
    });
    return app;
}

describe("swap routes", () => {
    test("quote/execute happy", async () => {
        const app = buildApp({
            async quote() { return { amountOut: "10" }; },
            async execute() { return { success: true, txHash: "0x1" }; }
        });
        const q = await request(app).post("/api/swap/quote").send({});
        expect(q.status).toBe(200);
        const ex = await request(app).post("/api/swap").send({});
        expect(ex.status).toBe(200);
        expect(ex.body.success).toBe(true);
    });

    test("execute fail returns status payload", async () => {
        const app = buildApp({
            async quote() { return {}; },
            async execute() {
                const err = new Error("insufficient balance");
                err.status = 400;
                err.available = "1";
                err.required = "2";
                throw err;
            }
        });
        const res = await request(app).post("/api/swap").send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("insufficient balance");
        expect(res.body.available).toBe("1");
        expect(res.body.required).toBe("2");
    });
});

