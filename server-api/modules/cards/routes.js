"use strict";

function registerCardRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        cardsService,
        cardPaymentService,
        observability
    } = deps || {};

    app.get("/api/cards", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const cards = await cardsService.listCardsByUser(req.authUser._id);
            return res.json({ cards });
        } catch (err) {
            observability?.logError(req, { event: "cards.list.failed", route: "/api/cards", operation: "cards-list", fallbackCategory: "cards", error: err });
            return res.status(500).json({ error: "card query failed" });
        }
    });

    app.post("/api/cards", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const card = await cardsService.createCard({
                userId: req.authUser._id,
                vaultAddress: String(req.authVault?.vaultAddress || "").toLowerCase(),
                email: req.authUser.email,
                cardholderName: req.body?.cardholderName,
                nickname: req.body?.nickname,
                pin: req.body?.pin
            });
            return res.status(201).json({ success: true, card });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: err.message });
            observability?.logError(req, { event: "cards.create.failed", route: "/api/cards", operation: "cards-create", fallbackCategory: "cards", error: err });
            return res.status(500).json({ error: "card create failed" });
        }
    });

    async function updateCardHandler(req, res) {
        try {
            const CARD_LIMIT_MAX_USD = 1000000;
            const card = await cardsService.updateCard({
                userId: req.authUser._id,
                cardId: String(req.params.id || "").trim(),
                payload: req.body || {},
                maxLimitUsd: CARD_LIMIT_MAX_USD
            });
            return res.json({ success: true, card });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: err.message });
            if (err?.status === 404) return res.status(404).json({ error: "card not found" });
            observability?.logError(req, { event: "cards.update.failed", route: "/api/cards/:id", operation: "cards-update", fallbackCategory: "cards", error: err });
            return res.status(500).json({ error: "card update failed" });
        }
    }

    app.patch("/api/cards/:id", requireAuth, updateCardHandler);
    app.post("/api/cards/:id/update", requireAuth, updateCardHandler);

    app.post("/api/cards/:id/freeze", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const card = await cardsService.freezeCard({
                userId: req.authUser._id,
                cardId: String(req.params.id || "").trim()
            });
            return res.json({ success: true, card });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: "invalid card id" });
            if (err?.status === 404) return res.status(404).json({ error: "card not found" });
            observability?.logError(req, { event: "cards.freeze.failed", route: "/api/cards/:id/freeze", operation: "cards-freeze", fallbackCategory: "cards", error: err });
            return res.status(500).json({ error: "card freeze failed" });
        }
    });

    app.post("/api/cards/:id/unfreeze", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const card = await cardsService.unfreezeCard({
                userId: req.authUser._id,
                cardId: String(req.params.id || "").trim()
            });
            return res.json({ success: true, card });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: "invalid card id" });
            if (err?.status === 404) return res.status(404).json({ error: "card not found" });
            observability?.logError(req, { event: "cards.unfreeze.failed", route: "/api/cards/:id/unfreeze", operation: "cards-unfreeze", fallbackCategory: "cards", error: err });
            return res.status(500).json({ error: "card unfreeze failed" });
        }
    });

    app.post("/api/cards/payments", authUserLimiter, async (req, res) => {
        try {
            const result = await cardPaymentService.processPayment(req.body || {});
            return res.json(result);
        } catch (err) {
            if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 600) {
                const body = { error: err.message || "card payment failed" };
                if (typeof err.requiredUsd !== "undefined") body.requiredUsd = err.requiredUsd;
                if (typeof err.availableUsd !== "undefined") body.availableUsd = err.availableUsd;
                if (typeof err.frozenUsd !== "undefined") body.frozenUsd = err.frozenUsd;
                if (typeof err.remainingUsd !== "undefined") body.remainingUsd = err.remainingUsd;
                if (typeof err.paymentId !== "undefined") body.paymentId = err.paymentId;
                if (typeof err.txHashes !== "undefined") body.txHashes = err.txHashes;
                return res.status(err.status).json(body);
            }
            observability?.logError(req, { event: "cards.payment.failed", route: "/api/cards/payments", operation: "cards-payment", fallbackCategory: "payment", error: err });
            return res.status(500).json({ error: "card payment failed" });
        }
    });
}

module.exports = {
    registerCardRoutes
};
