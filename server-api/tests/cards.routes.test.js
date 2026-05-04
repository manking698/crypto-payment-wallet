"use strict";

const express = require("express");
const request = require("supertest");
const { registerCardRoutes } = require("../modules/cards/routes");

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    const requireAuth = (req, _res, next) => {
        req.authUser = { _id: "u1", email: "u@test.com" };
        req.authVault = { vaultAddress: "0xabc" };
        next();
    };
    const passthrough = (_req, _res, next) => next();
    registerCardRoutes(app, {
        requireAuth,
        authUserLimiter: passthrough,
        cardsService: overrides.cardsService || {
            async listCardsByUser() { return [{ id: "c1" }]; },
            async createCard() { return { id: "c1" }; },
            async updateCard() { return { id: "c1", nickname: "A" }; },
            async freezeCard() { return { id: "c1", status: "frozen" }; },
            async unfreezeCard() { return { id: "c1", status: "active" }; }
        },
        cardPaymentService: overrides.cardPaymentService || {
            async processPayment() { return { success: true, paymentId: "p1" }; }
        }
    });
    return app;
}

describe("cards routes", () => {
    test("GET /api/cards happy path", async () => {
        const app = buildApp();
        const res = await request(app).get("/api/cards");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.cards)).toBe(true);
    });

    test("POST /api/cards/:id/freeze fail path returns 404", async () => {
        const app = buildApp({
            cardsService: {
                async listCardsByUser() { return []; },
                async createCard() { return { id: "c1" }; },
                async updateCard() { return { id: "c1" }; },
                async freezeCard() {
                    const err = new Error("card not found");
                    err.status = 404;
                    throw err;
                },
                async unfreezeCard() { return { id: "c1" }; }
            }
        });
        const res = await request(app).post("/api/cards/cx/freeze").send({});
        expect(res.status).toBe(404);
    });

    test("POST /api/cards/payments happy + fail propagation", async () => {
        const okApp = buildApp();
        const ok = await request(okApp).post("/api/cards/payments").send({});
        expect(ok.status).toBe(200);
        expect(ok.body.success).toBe(true);

        const failApp = buildApp({
            cardPaymentService: {
                async processPayment() {
                    const err = new Error("insufficient");
                    err.status = 400;
                    err.availableUsd = "10";
                    throw err;
                }
            }
        });
        const fail = await request(failApp).post("/api/cards/payments").send({});
        expect(fail.status).toBe(400);
        expect(fail.body.error).toBe("insufficient");
        expect(fail.body.availableUsd).toBe("10");
    });
});

