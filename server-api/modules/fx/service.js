"use strict";

function createFxService({ fetchImpl = fetch }) {
    async function fetchFxFromOpenErApi(base) {
        const response = await fetchImpl(`https://open.er-api.com/v6/latest/${base}`);
        if (!response.ok) {
            throw new Error(`open.er-api HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (payload?.result !== "success" || !payload?.rates) {
            throw new Error("open.er-api invalid payload");
        }

        return {
            provider: "open.er-api",
            base: String(payload.base_code || base).toUpperCase(),
            updatedAt: payload.time_last_update_utc || new Date().toISOString(),
            rates: payload.rates
        };
    }

    async function fetchFxFromFrankfurter(base) {
        const response = await fetchImpl(`https://api.frankfurter.app/latest?from=${base}`);
        if (!response.ok) {
            throw new Error(`frankfurter HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.rates) {
            throw new Error("frankfurter invalid payload");
        }

        return {
            provider: "frankfurter",
            base: String(payload.amount ? base : payload.base || base).toUpperCase(),
            updatedAt: payload.date || new Date().toISOString(),
            rates: payload.rates
        };
    }

    async function fetchLiveFxRates(base) {
        try {
            return await fetchFxFromOpenErApi(base);
        } catch (primaryErr) {
            try {
                return await fetchFxFromFrankfurter(base);
            } catch (fallbackErr) {
                throw new Error(`fx provider unavailable (${primaryErr.message}; ${fallbackErr.message})`);
            }
        }
    }

    return {
        fetchFxFromOpenErApi,
        fetchFxFromFrankfurter,
        fetchLiveFxRates
    };
}

module.exports = {
    createFxService
};

