"use strict";

function registerUserPreferenceRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        User,
        validSpendPriorityTokens,
        fxSupportedCurrencies
    } = deps || {};

    app.get("/api/user/spend-priority", requireAuth, authUserLimiter, async (req, res) => {
        const spendPriorityToken = validSpendPriorityTokens.includes(String(req.authUser?.spendPriorityToken || "").toUpperCase())
            ? String(req.authUser.spendPriorityToken).toUpperCase()
            : "USDT";

        return res.json({ spendPriorityToken });
    });

    app.post("/api/user/spend-priority", requireAuth, authUserLimiter, async (req, res) => {
        const token = String(req.body?.token || "").trim().toUpperCase();
        if (!validSpendPriorityTokens.includes(token)) {
            return res.status(400).json({ error: "invalid spend priority token" });
        }

        await User.updateOne(
            { _id: req.authUser._id },
            { $set: { spendPriorityToken: token } }
        );

        return res.json({ success: true, spendPriorityToken: token });
    });

    app.post("/api/user/display-currency", requireAuth, authUserLimiter, async (req, res) => {
        const currency = String(req.body?.currency || "").trim().toUpperCase();
        if (!fxSupportedCurrencies.includes(currency)) {
            return res.status(400).json({ error: "invalid display currency" });
        }

        await User.updateOne(
            { _id: req.authUser._id },
            { $set: { displayCurrency: currency } }
        );

        return res.json({ success: true, displayCurrency: currency });
    });
}

module.exports = {
    registerUserPreferenceRoutes
};

