"use strict";

function getClientIp(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
    return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function createRateLimiter({
    windowMs,
    max,
    keyFn,
    message = "too many requests, please try again later"
}) {
    const buckets = new Map();

    return (req, res, next) => {
        const now = Date.now();
        if (buckets.size > 10000) {
            for (const [bucketKey, entry] of buckets.entries()) {
                if (now >= entry.resetAt) buckets.delete(bucketKey);
            }
        }
        const key = String(keyFn ? keyFn(req) : getClientIp(req) || "unknown");
        const prev = buckets.get(key);

        if (!prev || now >= prev.resetAt) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (prev.count >= max) {
            const retryAfterSec = Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
            res.setHeader("Retry-After", String(retryAfterSec));
            return res.status(429).json({ error: message });
        }

        prev.count += 1;
        buckets.set(key, prev);
        return next();
    };
}

function isPrivateIpv4Host(hostname) {
    if (!hostname || !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
    const parts = hostname.split(".").map((v) => Number.parseInt(v, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

module.exports = {
    getClientIp,
    createRateLimiter,
    isPrivateIpv4Host
};

