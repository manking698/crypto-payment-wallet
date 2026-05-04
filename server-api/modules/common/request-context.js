"use strict";

const { randomUUID } = require("crypto");

function createRequestContextMiddleware(logger) {
    return function requestContextMiddleware(req, res, next) {
        const requestId = String(req.headers["x-request-id"] || randomUUID());
        const startedAt = Date.now();
        req.requestId = requestId;
        res.setHeader("x-request-id", requestId);

        res.on("finish", () => {
            const elapsedMs = Date.now() - startedAt;
            logger.info("http.request.completed", {
                requestId,
                method: req.method,
                path: req.originalUrl || req.url,
                statusCode: res.statusCode,
                elapsedMs
            });
        });

        return next();
    };
}

module.exports = {
    createRequestContextMiddleware
};

