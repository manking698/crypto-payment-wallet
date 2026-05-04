"use strict";

function registerFxRoutes(app, deps) {
    const {
        fxService,
        sanitizeBaseCurrency,
        supportedCurrencies,
        observability
    } = deps || {};

    app.get("/api/fx/latest", async (req, res) => {
        try {
            const base = sanitizeBaseCurrency(req.query?.base, supportedCurrencies);
            const result = await fxService.fetchLiveFxRates(base);

            const filteredRates = {};
            for (const code of supportedCurrencies) {
                if (code === result.base) {
                    filteredRates[code] = 1;
                    continue;
                }
                const rate = Number(result.rates?.[code]);
                if (Number.isFinite(rate) && rate > 0) {
                    filteredRates[code] = rate;
                }
            }

            return res.json({
                provider: result.provider,
                base: result.base,
                updatedAt: result.updatedAt,
                rates: filteredRates
            });
        } catch (err) {
            observability?.logError(req, { event: "fx.latest.failed", route: "/api/fx/latest", operation: "fx-latest", fallbackCategory: "fx", error: err });
            return res.status(500).json({ error: "fx latest failed" });
        }
    });
}

module.exports = {
    registerFxRoutes
};
