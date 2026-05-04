export const WALLET_TOKEN_OPTIONS = [
    { key: "USDT", label: "USDT", iconUrl: "/icons/usdt.png", decimals: 6 },
    { key: "USDC", label: "USDC", iconUrl: "/icons/usdc.png", decimals: 6 },
    { key: "WETH", label: "WETH", iconUrl: "/icons/weth-large.png", decimals: 18 },
] as const;

export type WalletTokenKey = (typeof WALLET_TOKEN_OPTIONS)[number]["key"];

export const SPEND_PRIORITY_OPTIONS: WalletTokenKey[] = ["USDT", "USDC", "WETH"];

export function sanitizeDecimalInput(value: string, maxDecimals?: number) {
    const cleaned = String(value || "").replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length <= 1) return cleaned;
    const fraction = parts.slice(1).join("");
    const limited = typeof maxDecimals === "number" ? fraction.slice(0, maxDecimals) : fraction;
    return `${parts[0]}.${limited}`;
}

export function isWalletToken(value: unknown): value is WalletTokenKey {
    const normalized = String(value || "").trim().toUpperCase();
    return SPEND_PRIORITY_OPTIONS.includes(normalized as WalletTokenKey);
}
