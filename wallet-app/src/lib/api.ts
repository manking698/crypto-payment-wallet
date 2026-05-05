import type {
    AppNotification,
    AuthResponse,
    DashboardSummary,
    EarnHistoryResponse,
    EarnSummaryResponse,
    EarnTokenSymbol,
    FxLatestResponse,
    RegisterResponse,
    TransactionHistoryResponse,
    UserCard,
    UserProfile
} from "@/lib/types";
import type { WalletTokenKey } from "@/lib/domain-rules";
import { useAuthStore } from "@/store/auth-store";

function resolveApiBaseUrl() {
    if (process.env.NEXT_PUBLIC_API_BASE_URL) {
        return process.env.NEXT_PUBLIC_API_BASE_URL;
    }
    if (typeof window !== "undefined") {
        const protocol = window.location.protocol || "http:";
        const hostname = window.location.hostname || "localhost";
        return `${protocol}//${hostname}:3000`;
    }
    return "http://localhost:3000";
}

const API_BASE_URL = resolveApiBaseUrl();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init?.headers || {}),
        },
    });

    const rawText = await response.text();
    let payload: Record<string, unknown> = {};
    try {
        payload = rawText ? JSON.parse(rawText) : {};
    } catch {
        payload = {};
    }
    if (!response.ok) {
        const messageFromPayload = typeof payload?.error === "string" ? payload.error : "";
        const messageFromRaw = rawText && !rawText.trim().startsWith("<") ? rawText.trim() : "";
        throw new Error(messageFromPayload || messageFromRaw || "Request failed");
    }

    return payload as T;
}

export async function registerAccount(input: { email: string; password: string }) {
    return request<RegisterResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getRegistrationStatus(input: { email: string }) {
    return request<{ status: "ACTIVE" | "PENDING_VAULT" | "FAILED"; ready: boolean }>("/api/auth/registration-status", {
        method: "POST",
        body: JSON.stringify(input)
    });
}

export async function login(input: { email: string; password: string }) {
    return request<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function logout() {
    return request<{ success: boolean }>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function changePassword(input: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
}) {
    return request<{ success: boolean; message: string }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getMe() {
    const data = await request<{ user: UserProfile }>("/api/auth/me");
    return data.user;
}

export async function getDashboardSummary() {
    return request<DashboardSummary>("/api/dashboard/summary");
}

export async function getTransactionHistory(input: {
    scope: "all" | "vault" | "card";
    page?: number;
    limit?: number;
    types?: string[];
    fromDate?: string;
    toDate?: string;
}) {
    const params = new URLSearchParams();
    params.set("scope", input.scope);
    params.set("page", String(input.page || 1));
    params.set("limit", String(input.limit || 5));

    if (input.types?.length) {
        params.set("types", input.types.join(","));
    }
    if (input.fromDate) {
        params.set("fromDate", input.fromDate);
    }
    if (input.toDate) {
        params.set("toDate", input.toDate);
    }

    return request<TransactionHistoryResponse>(`/api/transactions/history?${params.toString()}`);
}

export async function getTransactionDetail(id: string) {
    return request<{ transaction: DashboardSummary["transactions"][number] }>(`/api/transactions/${id}`);
}

export async function withdrawFunds(input: {
    email: string;
    amount: string;
    toAddress: string;
    token: string;
    chainId: number;
}) {
    return request<{ success: boolean; txHash: string; message: string }>("/api/withdraw", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function updateSpendPriorityToken(input: { token: WalletTokenKey }) {
    return request<{ success: boolean; spendPriorityToken: WalletTokenKey }>("/api/user/spend-priority", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function updateDisplayCurrency(input: { currency: string }) {
    return request<{ success: boolean; displayCurrency: string }>("/api/user/display-currency", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getCards() {
    return request<{ cards: UserCard[] }>("/api/cards");
}

export async function createCard(input: { cardholderName: string; nickname: string; pin: string }) {
    return request<{ success: boolean; card: UserCard }>("/api/cards", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function updateCard(id: string, input: Partial<Pick<UserCard, "nickname" | "perTransactionLimitUsd" | "dailyLimitUsd" | "monthlyLimitUsd">> & { pin?: string }) {
    try {
        return await request<{ success: boolean; card: UserCard }>(`/api/cards/${id}/update`, {
            method: "POST",
            body: JSON.stringify(input),
        });
    } catch (_primaryErr) {
        try {
            return await request<{ success: boolean; card: UserCard }>(`/api/cards/${id}`, {
                method: "PATCH",
                body: JSON.stringify(input),
            });
        } catch (_secondaryErr) {
            return request<{ success: boolean; card: UserCard }>(`/api/cards/${id}`, {
                method: "POST",
                body: JSON.stringify(input),
            });
        }
    }
}

export async function freezeCard(id: string) {
    return request<{ success: boolean; card: UserCard }>(`/api/cards/${id}/freeze`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function unfreezeCard(id: string) {
    return request<{ success: boolean; card: UserCard }>(`/api/cards/${id}/unfreeze`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function getFxLatest(base: string = "USD") {
    const params = new URLSearchParams();
    params.set("base", base);

    try {
        return await request<FxLatestResponse>(`/api/fx/latest?${params.toString()}`);
    } catch (_err) {
        // Fallback when local API is not restarted/available yet.
        const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
        if (!response.ok) {
            throw new Error("Failed to load exchange rates");
        }
        const payload = await response.json() as { date?: string; rates?: Record<string, number> };
        return {
            provider: "frankfurter-fallback",
            base: String(base || "USD").toUpperCase(),
            updatedAt: payload.date || new Date().toISOString(),
            rates: payload.rates || {}
        };
    }
}

export async function simulateCardPayment(input: {
    cardId?: string;
    merchantName: string;
    merchantRef?: string;
    country?: string;
    paymentCurrency: "MYR" | "JPY" | "USD" | "HKD" | "TWD";
    paymentAmount: string;
    cardNumber: string;
    expiry: string;
    cvv: string;
    pin: string;
}) {
    return request<{
        success: boolean;
        paymentId: string;
        status: string;
        paymentCurrency: string;
        paymentAmount: string;
        usdAmount: string;
        spendPriorityToken: WalletTokenKey;
        priorityFlow: string[];
        plannedTokens: Array<{
            tokenSymbol: string;
            tokenDecimals: number;
            tokenAmount: string;
            tokenAmountRaw: string;
            usdAmount: string;
            priceRaw8: string;
        }>;
        deductedTokens: Array<{
            tokenSymbol: string;
            tokenAmount: string;
            tokenAmountRaw: string;
            usdAmount: string;
            priceRaw8: string;
            txHash: string;
        }>;
        txHashes: string[];
    }>("/api/cards/payments", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getSwapQuote(input: {
    fromSymbol: WalletTokenKey;
    toSymbol: WalletTokenKey;
    amount: string;
}) {
    return request<{
        fromSymbol: string;
        toSymbol: string;
        fromAmount: string;
        toAmount: string;
        usdAmount: string;
        balances: Record<string, string>;
    }>("/api/swap/quote", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function executeSwap(input: {
    fromSymbol: WalletTokenKey;
    toSymbol: WalletTokenKey;
    amount: string;
}) {
    return request<{
        success: boolean;
        txHash: string;
        direction: "swap";
        fromSymbol: string;
        toSymbol: string;
        fromAmount: string;
        toAmount: string;
        usdAmount: string;
    }>("/api/swap", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getNotifications(input?: { limit?: number; type?: "all" | "transaction" | "system" }) {
    const params = new URLSearchParams();
    params.set("limit", String(input?.limit || 20));
    params.set("type", String(input?.type || "all"));
    return request<{ notifications: AppNotification[] }>(`/api/notifications?${params.toString()}`);
}

export async function getNotificationUnreadCount() {
    return request<{ unreadCount: number }>("/api/notifications/unread-count");
}

export async function markNotificationRead(id: string) {
    return request<{ success: boolean; unreadCount: number; notification: AppNotification }>(`/api/notifications/${id}/read`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function getFaucetStatus(vaultAddress: string, claimType: "USDT" | "USDC" | "WETH" | "ALL" = "USDT") {
    const params = new URLSearchParams();
    params.set("vaultAddress", vaultAddress);
    params.set("claimType", claimType);
    return request<{
        vaultAddress: string;
        claimType: "USDT" | "USDC" | "WETH" | "ALL";
        eligibleNow: boolean;
        nextClaimAt: string | null;
    }>(`/api/faucet/status?${params.toString()}`);
}

export async function claimFaucet(input: {
    vaultAddress: string;
    claimType: "USDT" | "USDC" | "WETH" | "ALL";
}) {
    return request<{
        success: boolean;
        claimId: string;
        vaultAddress: string;
        claimType: string;
        tokenSymbols: string[];
        tokenAmount: string;
        txHashes: string[];
    }>("/api/faucet/claim", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getEarnSummary() {
    return request<EarnSummaryResponse>("/api/earn/summary");
}

export async function getEarnHistory(input?: {
    token?: "ALL" | EarnTokenSymbol;
    kind?: "all" | "subscribe" | "redemption" | "rewards";
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
}) {
    const params = new URLSearchParams();
    params.set("token", String(input?.token || "ALL"));
    params.set("kind", String(input?.kind || "all"));
    params.set("page", String(input?.page || 1));
    params.set("limit", String(input?.limit || 20));
    if (input?.fromDate) params.set("fromDate", input.fromDate);
    if (input?.toDate) params.set("toDate", input.toDate);
    return request<EarnHistoryResponse>(`/api/earn/history?${params.toString()}`);
}

export async function subscribeEarn(input: { token: EarnTokenSymbol; amount: string }) {
    return request<{
        success: boolean;
        token: EarnTokenSymbol;
        amount: string;
        txHash: string;
    }>("/api/earn/subscribe", {
        method: "POST",
        body: JSON.stringify(input)
    });
}

export async function redeemEarn(input: { token: EarnTokenSymbol; amount: string }) {
    return request<{
        success: boolean;
        token: EarnTokenSymbol;
        amount: string;
        txHash: string;
    }>("/api/earn/redeem", {
        method: "POST",
        body: JSON.stringify(input)
    });
}

export async function claimEarnReward(input: { token: EarnTokenSymbol }) {
    return request<{
        success: boolean;
        token: EarnTokenSymbol;
        amount: string;
        txHash: string;
    }>("/api/earn/claim", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
