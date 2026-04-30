"use strict";

function createProfileService({
    VALID_SPEND_PRIORITY_TOKENS,
    FX_SUPPORTED_CURRENCIES
}) {
    function buildUserProfile(user, vaultRecord) {
        const spendPriorityToken = VALID_SPEND_PRIORITY_TOKENS.includes(String(user?.spendPriorityToken || "").toUpperCase())
            ? String(user.spendPriorityToken).toUpperCase()
            : "USDT";
        const displayCurrencyRaw = String(user?.displayCurrency || "USD").trim().toUpperCase();
        const displayCurrency = FX_SUPPORTED_CURRENCIES.includes(displayCurrencyRaw) ? displayCurrencyRaw : "USD";

        return {
            email: user.email,
            vaultAddress: vaultRecord?.vaultAddress || "",
            defaultChainId: vaultRecord?.chainId || user.defaultChainId || 11155111,
            spendPriorityToken,
            displayCurrency
        };
    }

    function maskCardForClient(card, includeSensitive = false) {
        if (!card) return null;
        const cardNumber = String(card.cardNumber || "");
        const last4 = cardNumber.slice(-4) || String(card.last4 || "");
        const expiryMonth = String(card.expiryMonth || "").padStart(2, "0");
        const expiryYear = String(card.expiryYear || "");
        const cardholderName = String(card.cardholderName || card.cardHolderName || card.name || "");

        return {
            id: String(card._id || ""),
            cardholderName,
            nickname: String(card.nickname || ""),
            last4,
            cardNumber: includeSensitive ? cardNumber : "",
            expiryMonth,
            expiryYear,
            expiry: `${expiryMonth}/${expiryYear.slice(-2)}`,
            cvv: includeSensitive ? String(card.cvv || "") : "",
            status: String(card.status || "active"),
            perTransactionLimitUsd: Number.isFinite(Number(card.perTransactionLimitUsd))
                ? Number(card.perTransactionLimitUsd)
                : 1000,
            dailyLimitUsd: Number(card.dailyLimitUsd || 0),
            monthlyLimitUsd: Number(card.monthlyLimitUsd || 0),
            vaultDailyLimitUsd: Number(card.vaultDailyLimitUsd || 0),
            vaultMonthlyLimitUsd: Number(card.vaultMonthlyLimitUsd || 0),
            createdAt: card.createdAt ? new Date(card.createdAt).toISOString() : null,
            updatedAt: card.updatedAt ? new Date(card.updatedAt).toISOString() : null
        };
    }

    return {
        buildUserProfile,
        maskCardForClient
    };
}

module.exports = {
    createProfileService
};

