"use strict";

function normalizeCategory(input) {
    const text = String(input || "unknown").trim().toLowerCase();
    return text || "unknown";
}

function categorizeError(err, fallbackCategory = "unknown") {
    const status = Number(err?.status || err?.statusCode || 0);
    const code = String(err?.code || "").trim().toUpperCase();
    const message = String(err?.message || "").trim().toLowerCase();

    if (status >= 400 && status < 500) return "client";
    if (status >= 500) return "server";
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return "network";
    if (message.includes("insufficient")) return "insufficient-balance";
    if (message.includes("invalid")) return "invalid-input";
    if (message.includes("rate limit") || message.includes("too many")) return "rate-limit";
    if (message.includes("auth") || message.includes("token") || message.includes("password")) return "auth";
    return normalizeCategory(fallbackCategory);
}

function createErrorMetricsService() {
    const counters = new Map();

    function record(input) {
        const route = String(input?.route || "unknown").trim() || "unknown";
        const operation = String(input?.operation || "unknown").trim() || "unknown";
        const category = normalizeCategory(input?.category || categorizeError(input?.error, "unknown"));
        const key = `${route}|${operation}|${category}`;
        const prev = counters.get(key) || { route, operation, category, count: 0, updatedAt: null };
        prev.count += 1;
        prev.updatedAt = new Date().toISOString();
        counters.set(key, prev);
        return prev;
    }

    function list() {
        const rows = Array.from(counters.values());
        rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
        return rows;
    }

    function clear() {
        counters.clear();
    }

    return {
        record,
        list,
        clear,
        categorizeError
    };
}

module.exports = {
    createErrorMetricsService,
    categorizeError
};
