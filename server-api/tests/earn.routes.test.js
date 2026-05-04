"use strict";

const express = require("express");
const request = require("supertest");
const { registerEarnRoutes } = require("../modules/earn/routes");

function buildApp(orchestrator) {
    const app = express();
    app.use(express.json());
    const requireAuth = (req, _res, next) => {
        req.authUser = { _id: "u1" };
        req.authVault = { vaultAddress: "0xabc" };
        next();
    };
    const pass = (_req, _res, next) => next();
    registerEarnRoutes(app, {
        requireAuth,
        authUserLimiter: pass,
        earnOrchestrator: orchestrator
    });
    return app;
}

describe("earn routes", () => {
    test("summary + subscribe happy", async () => {
        const app = buildApp({
            async getSummary() { return { ok: true }; },
            async getHistory() { return { items: [] }; },
            async subscribe() { return { success: true }; },
            async redeem() { return { success: true }; },
            async claim() { return { success: true }; }
        });
        const summary = await request(app).get("/api/earn/summary");
        expect(summary.status).toBe(200);
        const subscribe = await request(app).post("/api/earn/subscribe").send({});
        expect(subscribe.status).toBe(200);
        expect(subscribe.body.success).toBe(true);
    });

    test("redeem fail returns domain status", async () => {
        const app = buildApp({
            async getSummary() { return {}; },
            async getHistory() { return {}; },
            async subscribe() { return {}; },
            async redeem() {
                const err = new Error("insufficient subscribed balance");
                err.status = 400;
                throw err;
            },
            async claim() { return {}; }
        });
        const res = await request(app).post("/api/earn/redeem").send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("insufficient subscribed balance");
    });
});

