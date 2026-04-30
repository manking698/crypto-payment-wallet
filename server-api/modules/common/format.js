"use strict";

function parseDateStartOfDay(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseDateEndOfDay(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
}

function getStartOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getStartOfMonth(date = new Date()) {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function decimalToScaledBigInt(input, decimals) {
    const raw = String(input || "").trim();
    if (!raw) return 0n;
    if (!/^\d+(\.\d+)?$/.test(raw)) return 0n;
    const [intPart, fracPartRaw = ""] = raw.split(".");
    const fracPart = fracPartRaw.slice(0, decimals).padEnd(decimals, "0");
    return BigInt(intPart || "0") * (10n ** BigInt(decimals)) + BigInt(fracPart || "0");
}

function scaledBigIntToDecimal(value, decimals, fixed = decimals) {
    const normalized = BigInt(value || 0n);
    const sign = normalized < 0n ? "-" : "";
    const abs = normalized < 0n ? -normalized : normalized;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    if (fixed <= 0) return `${sign}${whole.toString()}`;
    const fracText = frac.toString().padStart(decimals, "0").slice(0, fixed);
    return `${sign}${whole.toString()}.${fracText}`;
}

function formatDisplayAmountMin2Max8Cut(input) {
    const raw = String(input ?? "0").trim();
    if (!raw) return "0.00";
    const negative = raw.startsWith("-");
    const unsigned = negative ? raw.slice(1) : raw;
    const [intPartRaw, fracRaw = ""] = unsigned.split(".");
    const intPart = (intPartRaw || "0").replace(/[^\d]/g, "") || "0";
    const cut = fracRaw.replace(/[^\d]/g, "").slice(0, 8);
    const trimmed = cut.replace(/0+$/, "");
    const frac = trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, "0");
    return `${negative ? "-" : ""}${intPart}.${frac}`;
}

function toFixed2(value) {
    const n = Number(String(value || "").replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
}

module.exports = {
    parseDateStartOfDay,
    parseDateEndOfDay,
    getStartOfDay,
    getStartOfMonth,
    decimalToScaledBigInt,
    scaledBigIntToDecimal,
    formatDisplayAmountMin2Max8Cut,
    toFixed2
};

