"use strict";

function createAuthSecurityService(config) {
    const {
        shortLockThreshold = 5,
        longLockThreshold = 20,
        shortLockMs = 10 * 60 * 1000,
        longLockMs = 24 * 60 * 60 * 1000,
        resetWindowMs = 24 * 60 * 60 * 1000
    } = config || {};

    const loginAttemptState = new Map();

    function buildLoginKey(email) {
        return `${String(email || "").trim().toLowerCase() || "unknown-email"}`;
    }

    function getLoginLockState(key) {
        const now = Date.now();
        const state = loginAttemptState.get(key);
        if (!state) return { blocked: false };
        if (state.lockUntil && state.lockUntil > now) {
            return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((state.lockUntil - now) / 1000)) };
        }
        if (state.firstAt && now - state.firstAt > resetWindowMs) {
            loginAttemptState.delete(key);
            return { blocked: false };
        }
        return { blocked: false };
    }

    function registerLoginFailure(key) {
        const now = Date.now();
        const prev = loginAttemptState.get(key);
        let count = 1;
        let firstAt = now;
        if (prev && now - prev.firstAt <= resetWindowMs) {
            count = Number(prev.count || 0) + 1;
            firstAt = prev.firstAt;
        }
        let lockUntil = 0;
        if (count >= longLockThreshold) {
            lockUntil = now + longLockMs;
        } else if (count >= shortLockThreshold) {
            lockUntil = now + shortLockMs;
        }
        loginAttemptState.set(key, { count, firstAt, lockUntil });
        return { count, lockUntil };
    }

    function clearLoginFailure(key) {
        loginAttemptState.delete(key);
    }

    return {
        buildLoginKey,
        getLoginLockState,
        registerLoginFailure,
        clearLoginFailure
    };
}

module.exports = {
    createAuthSecurityService
};

