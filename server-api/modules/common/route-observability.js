"use strict";

const { categorizeError } = require("./error-metrics");

function createRouteObservability(deps) {
    const logger = deps?.logger || console;
    const errorMetrics = deps?.errorMetrics || null;

    function logError(req, input) {
        const err = input?.error;
        const event = String(input?.event || "http.route.error");
        const route = String(input?.route || req?.originalUrl || req?.url || "unknown");
        const operation = String(input?.operation || "unknown");
        const fallbackCategory = String(input?.fallbackCategory || "unknown");
        const category = categorizeError(err, fallbackCategory);
        const status = Number(err?.status || err?.statusCode || 500);

        errorMetrics?.record?.({
            route,
            operation,
            category,
            error: err
        });

        logger.error?.(event, {
            requestId: req?.requestId || "",
            route,
            operation,
            category,
            statusCode: Number.isFinite(status) ? status : 500,
            errorCode: String(err?.code || ""),
            errorMessage: String(err?.message || input?.message || "unknown error")
        });
    }

    function logInfo(req, event, meta) {
        logger.info?.(String(event || "http.route.info"), {
            requestId: req?.requestId || "",
            ...(meta && typeof meta === "object" ? meta : {})
        });
    }

    return {
        logError,
        logInfo
    };
}

module.exports = {
    createRouteObservability
};
