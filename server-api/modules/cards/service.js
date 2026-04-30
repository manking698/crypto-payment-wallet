"use strict";

function randomDigits(length) {
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += Math.floor(Math.random() * 10).toString();
    }
    return out;
}

function generateCardNumber() {
    return `45492406${randomDigits(4)}${randomDigits(4)}`;
}

function createCardsService(deps) {
    const {
        UserCard,
        mongoose,
        normalizeCardDigits,
        parseExpiryInput,
        maskCardForClient,
        nowFactory
    } = deps;

    function now() {
        return typeof nowFactory === "function" ? nowFactory() : new Date();
    }

    async function listCardsByUser(userId) {
        const cards = await UserCard.find({ userId }).sort({ createdAt: -1 }).lean();
        return cards.map((card) => maskCardForClient(card, true));
    }

    async function createCard({ userId, vaultAddress, email, cardholderName, nickname, pin }) {
        if (!vaultAddress) {
            const err = new Error("missing vault address");
            err.status = 400;
            throw err;
        }

        const safeName = String(cardholderName || email?.split("@")[0] || "Card Holder").trim().slice(0, 48);
        const safeNickname = String(nickname || "").trim().slice(0, 32);
        if (!safeNickname) {
            const err = new Error("nickname is required");
            err.status = 400;
            throw err;
        }
        const safePin = String(pin || "").replace(/\D/g, "");
        if (safePin.length !== 6) {
            const err = new Error("pin must be 6 digits");
            err.status = 400;
            throw err;
        }

        const createdAt = now();
        const expiry = new Date(createdAt);
        expiry.setFullYear(createdAt.getFullYear() + 4);
        const card = await UserCard.create({
            userId,
            vaultAddress: String(vaultAddress).toLowerCase(),
            cardholderName: safeName,
            nickname: safeNickname,
            cardNumber: generateCardNumber(),
            expiryMonth: String(expiry.getMonth() + 1).padStart(2, "0"),
            expiryYear: String(expiry.getFullYear()).slice(-2),
            cvv: randomDigits(3),
            pin: safePin,
            status: "active",
            perTransactionLimitUsd: 1000,
            dailyLimitUsd: 50000,
            monthlyLimitUsd: 200000,
            vaultDailyLimitUsd: 100000,
            vaultMonthlyLimitUsd: 1000000,
            createdAt,
            updatedAt: createdAt
        });
        return maskCardForClient(card, true);
    }

    async function updateCard({ userId, cardId, payload, maxLimitUsd = 1000000 }) {
        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            const err = new Error("invalid card id");
            err.status = 400;
            throw err;
        }

        const set = { updatedAt: now() };
        if (typeof payload?.nickname === "string") {
            const nickname = String(payload.nickname).trim().slice(0, 32);
            if (!nickname) {
                const err = new Error("nickname is required");
                err.status = 400;
                throw err;
            }
            set.nickname = nickname;
        }

        if (typeof payload?.dailyLimitUsd !== "undefined") {
            const dailyLimitText = String(payload.dailyLimitUsd).trim();
            if (!/^\d{1,7}$/.test(dailyLimitText)) {
                const err = new Error("daily limit must be numeric and up to 7 digits");
                err.status = 400;
                throw err;
            }
            const dailyLimitUsd = Number(payload.dailyLimitUsd);
            if (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd < 0 || !Number.isInteger(dailyLimitUsd) || dailyLimitUsd > maxLimitUsd) {
                const err = new Error("invalid daily limit");
                err.status = 400;
                throw err;
            }
            set.dailyLimitUsd = dailyLimitUsd;
        }

        if (typeof payload?.perTransactionLimitUsd !== "undefined") {
            const perTxnText = String(payload.perTransactionLimitUsd).trim();
            if (!/^\d{1,7}$/.test(perTxnText)) {
                const err = new Error("per transaction limit must be numeric and up to 7 digits");
                err.status = 400;
                throw err;
            }
            const perTransactionLimitUsd = Number(payload.perTransactionLimitUsd);
            if (!Number.isFinite(perTransactionLimitUsd) || perTransactionLimitUsd < 0 || !Number.isInteger(perTransactionLimitUsd) || perTransactionLimitUsd > maxLimitUsd) {
                const err = new Error("invalid per transaction limit");
                err.status = 400;
                throw err;
            }
            set.perTransactionLimitUsd = perTransactionLimitUsd;
        }

        if (typeof payload?.monthlyLimitUsd !== "undefined") {
            const monthlyLimitUsd = Number(payload.monthlyLimitUsd);
            if (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd <= 0) {
                const err = new Error("invalid monthly limit");
                err.status = 400;
                throw err;
            }
            set.monthlyLimitUsd = Math.round(monthlyLimitUsd * 100) / 100;
        }

        if (typeof payload?.pin === "string") {
            const pin = String(payload.pin).replace(/\D/g, "");
            if (pin.length !== 6) {
                const err = new Error("pin must be 6 digits");
                err.status = 400;
                throw err;
            }
            set.pin = pin;
        }

        const card = await UserCard.findOneAndUpdate(
            { _id: cardId, userId },
            { $set: set },
            { returnDocument: "after" }
        ).lean();
        if (!card) {
            const err = new Error("card not found");
            err.status = 404;
            throw err;
        }
        return maskCardForClient(card, true);
    }

    async function setCardStatus({ userId, cardId, status }) {
        if (!mongoose.Types.ObjectId.isValid(cardId)) {
            const err = new Error("invalid card id");
            err.status = 400;
            throw err;
        }
        const card = await UserCard.findOneAndUpdate(
            { _id: cardId, userId },
            { $set: { status, updatedAt: now() } },
            { returnDocument: "after" }
        ).lean();
        if (!card) {
            const err = new Error("card not found");
            err.status = 404;
            throw err;
        }
        return maskCardForClient(card, true);
    }

    async function resolveCardForPayment({ cardId, inputCardNumber }) {
        let card = null;
        if (cardId && mongoose.Types.ObjectId.isValid(cardId)) {
            card = await UserCard.findOne({ _id: cardId }).lean();
        } else {
            const formattedCardNumber = inputCardNumber.replace(/(.{4})/g, "$1 ").trim();
            card = await UserCard.findOne({
                $or: [{ cardNumber: inputCardNumber }, { cardNumber: formattedCardNumber }]
            }).sort({ createdAt: -1 }).lean();
        }
        return card;
    }

    function verifyCardCredentials(card, input) {
        const inputCardNumber = normalizeCardDigits(input?.cardNumber);
        const inputCvv = normalizeCardDigits(input?.cvv);
        const inputPin = normalizeCardDigits(input?.pin);
        const expiryMonthInputRaw = String(input?.expiryMonth || "").trim();
        const expiryYearInputRaw = String(input?.expiryYear || "").trim();
        const expiryInputRaw = String(input?.expiry || "").trim();
        const parsedExpiry = parseExpiryInput(expiryInputRaw);

        const inputExpiryMonth = (expiryMonthInputRaw || parsedExpiry.month || "").padStart(2, "0");
        const inputExpiryYear2 = String(expiryYearInputRaw || parsedExpiry.year2 || "").slice(-2).padStart(2, "0");

        const cardNumberDb = normalizeCardDigits(card.cardNumber);
        const cvvDb = normalizeCardDigits(card.cvv);
        const pinDb = normalizeCardDigits(card.pin);
        const expiryMonthDb = String(card.expiryMonth || "").padStart(2, "0");
        const expiryYearDb2 = String(card.expiryYear || "").slice(-2).padStart(2, "0");

        if (!inputCardNumber || inputCardNumber !== cardNumberDb) return { ok: false, error: "invalid card number" };
        if (!inputExpiryMonth || !inputExpiryYear2 || inputExpiryMonth !== expiryMonthDb || inputExpiryYear2 !== expiryYearDb2) {
            return { ok: false, error: "invalid expiry date" };
        }
        if (!inputCvv || inputCvv !== cvvDb) return { ok: false, error: "invalid cvv" };
        if (!inputPin || inputPin.length !== 6 || inputPin !== pinDb) return { ok: false, error: "invalid pin" };

        return {
            ok: true,
            cardNumberDb,
            cardLast4: cardNumberDb.slice(-4)
        };
    }

    return {
        listCardsByUser,
        createCard,
        updateCard,
        freezeCard: (args) => setCardStatus({ ...args, status: "frozen" }),
        unfreezeCard: (args) => setCardStatus({ ...args, status: "active" }),
        resolveCardForPayment,
        verifyCardCredentials
    };
}

module.exports = { createCardsService };

