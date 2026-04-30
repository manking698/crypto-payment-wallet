"use strict";

function normalizeVaultAddressInput(value, ethers) {
    const addr = String(value || "").trim().toLowerCase();
    return ethers.isAddress(addr) ? addr : "";
}

function parseExpiryInput(raw) {
    const text = String(raw || "").trim();
    if (!text) return { month: "", year2: "" };
    const only = text.replace(/\s/g, "");
    const m = only.match(/^(\d{1,2})[\/-]?(\d{2,4})$/);
    if (!m) return { month: "", year2: "" };
    const month = m[1].padStart(2, "0");
    const y = m[2];
    const year2 = y.length >= 2 ? y.slice(-2) : y.padStart(2, "0");
    return { month, year2 };
}

function sanitizeBaseCurrency(base, supportedCurrencies = ["USD"]) {
    const normalized = String(base || "USD").trim().toUpperCase();
    return supportedCurrencies.includes(normalized) ? normalized : "USD";
}

module.exports = {
    normalizeVaultAddressInput,
    parseExpiryInput,
    sanitizeBaseCurrency
};

