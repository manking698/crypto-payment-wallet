"use strict";

const express = require("express");
const request = require("supertest");
const { createErrorMetricsService } = require("../modules/common/error-metrics");
const { createRouteObservability } = require("../modules/common/route-observability");
const { registerLedgerInternalRoutes } = require("../modules/ledger/routes");

describe("observability", () => {
    test("records categorized failures and exposes internal metrics endpoint", async () => {
        process.env.INTERNAL_API_KEY = "test-key";
        const app = express();
        app.use(express.json());

        const errorMetricsService = createErrorMetricsService();
        const logger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        const observability = createRouteObservability({
            logger,
            errorMetrics: errorMetricsService
        });

        app.get("/fail-client", (req, res) => {
            const err = new Error("invalid token");
            err.status = 401;
            observability.logError(req, {
                event: "test.client.failed",
                route: "/fail-client",
                operation: "client-fail",
                fallbackCategory: "test",
                error: err
            });
            return res.status(401).json({ error: "invalid token" });
        });

        app.get("/fail-server", (req, res) => {
            const err = new Error("db unavailable");
            err.status = 503;
            observability.logError(req, {
                event: "test.server.failed",
                route: "/fail-server",
                operation: "server-fail",
                fallbackCategory: "test",
                error: err
            });
            return res.status(503).json({ error: "db unavailable" });
        });

        registerLedgerInternalRoutes(app, {
            ledgerService: {
                listOutbox: jest.fn(async () => ({ items: [] })),
                getOutboxFailureStats: jest.fn(async () => ({ totalFailed: 0, byReason: [] })),
                processOutboxBatch: jest.fn(async () => {})
            },
            errorMetricsService,
            observability
        });

        await request(app).get("/fail-client");
        await request(app).get("/fail-server");

        const metricsRes = await request(app)
            .get("/api/internal/observability/error-metrics")
            .set("x-internal-key", "test-key");

        expect(metricsRes.status).toBe(200);
        expect(metricsRes.body.totalGroups).toBeGreaterThanOrEqual(2);
        expect(metricsRes.body.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ route: "/fail-client", operation: "client-fail", category: "client", count: 1 }),
            expect.objectContaining({ route: "/fail-server", operation: "server-fail", category: "server", count: 1 })
        ]));

        delete process.env.INTERNAL_API_KEY;
    });
});
