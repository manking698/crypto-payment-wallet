"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowUpRight,
    Bell,
    Check,
    Circle,
    ChevronDown,
    ChevronRight,
    Copy,
    CreditCard,
    Eye,
    EyeOff,
    Menu,
    Plus,
    RefreshCw,
    Search,
    Send,
    Sparkles,
    Wallet,
    X,
} from "lucide-react";
import { getDashboardSummary, getEarnSummary, getFxLatest, getMe, getNotificationUnreadCount, updateDisplayCurrency, updateSpendPriorityToken } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { TYPO } from "@/lib/typography";
import type { DashboardAsset, DashboardTransaction } from "@/lib/types";
import { useAuthStore } from "@/store/auth-store";

type DisplayTransaction = {
    id: string;
    dateLabel: string;
    name: string;
    subtitle: string;
    meta: string;
    amountPrimary: string;
    amountSecondary: string;
    reward?: string;
    status?: string;
    kind: "card" | "in" | "out" | "swap" | "earn";
    swapFromSymbol?: string;
    swapToSymbol?: string;
    swapFromAmount?: string;
    swapToAmount?: string;
    swapFromIconUrl?: string;
    href?: string;
};

type AssetItem = {
    symbol: string;
    amountUsd: string;
    amountToken: string;
    iconUrl: string;
    earnApy?: number;
};

type SpendPriorityToken = "USDT" | "USDC" | "WETH";
type DisplayCurrencyCode =
    | "USD" | "EUR" | "GBP" | "JPY" | "CNY" | "HKD" | "SGD" | "AUD" | "CAD" | "CHF"
    | "NZD" | "SEK" | "NOK" | "DKK" | "AED" | "SAR" | "THB" | "TWD" | "MYR" | "INR"
    | "KRW" | "IDR" | "PHP" | "VND" | "BRL" | "MXN" | "ZAR" | "TRY"
    | "PLN" | "CZK" | "HUF" | "RON" | "ILS" | "RUB" | "EGP" | "PKR" | "BDT" | "LKR";

const SPEND_PRIORITY_OPTIONS: SpendPriorityToken[] = ["USDT", "USDC", "WETH"];
const BALANCE_BASE_FONT_PX = 55;
const BALANCE_MIN_FONT_PX = 24;
const DISPLAY_CURRENCY_STORAGE_KEY = "wallet.display_currency";
const BALANCE_MASK_STORAGE_KEY = "wallet.mask_total_balance";
const DISPLAY_CURRENCY_PINNED: DisplayCurrencyCode[] = ["USD", "JPY", "MYR", "HKD"];
const DISPLAY_CURRENCIES: Array<{ code: DisplayCurrencyCode; name: string; flag: string }> = [
    { code: "USD", name: "US Dollar", flag: "🇺🇸" },
    { code: "EUR", name: "Euro", flag: "🇪🇺" },
    { code: "GBP", name: "British Pound", flag: "🇬🇧" },
    { code: "JPY", name: "Japanese Yen", flag: "🇯🇵" },
    { code: "CNY", name: "Chinese Yuan", flag: "🇨🇳" },
    { code: "HKD", name: "Hong Kong Dollar", flag: "🇭🇰" },
    { code: "SGD", name: "Singapore Dollar", flag: "🇸🇬" },
    { code: "AUD", name: "Australian Dollar", flag: "🇦🇺" },
    { code: "CAD", name: "Canadian Dollar", flag: "🇨🇦" },
    { code: "CHF", name: "Swiss Franc", flag: "🇨🇭" },
    { code: "NZD", name: "New Zealand Dollar", flag: "🇳🇿" },
    { code: "SEK", name: "Swedish Krona", flag: "🇸🇪" },
    { code: "NOK", name: "Norwegian Krone", flag: "🇳🇴" },
    { code: "DKK", name: "Danish Krone", flag: "🇩🇰" },
    { code: "AED", name: "UAE Dirham", flag: "🇦🇪" },
    { code: "SAR", name: "Saudi Riyal", flag: "🇸🇦" },
    { code: "THB", name: "Thai Baht", flag: "🇹🇭" },
    { code: "TWD", name: "New Taiwan Dollar", flag: "🇹🇼" },
    { code: "MYR", name: "Malaysian Ringgit", flag: "🇲🇾" },
    { code: "INR", name: "Indian Rupee", flag: "🇮🇳" },
    { code: "KRW", name: "South Korean Won", flag: "🇰🇷" },
    { code: "IDR", name: "Indonesian Rupiah", flag: "🇮🇩" },
    { code: "PHP", name: "Philippine Peso", flag: "🇵🇭" },
    { code: "VND", name: "Vietnamese Dong", flag: "🇻🇳" },
    { code: "BRL", name: "Brazilian Real", flag: "🇧🇷" },
    { code: "MXN", name: "Mexican Peso", flag: "🇲🇽" },
    { code: "ZAR", name: "South African Rand", flag: "🇿🇦" },
    { code: "TRY", name: "Turkish Lira", flag: "🇹🇷" },
    { code: "PLN", name: "Polish Zloty", flag: "🇵🇱" },
    { code: "CZK", name: "Czech Koruna", flag: "🇨🇿" },
    { code: "HUF", name: "Hungarian Forint", flag: "🇭🇺" },
    { code: "RON", name: "Romanian Leu", flag: "🇷🇴" },
    { code: "ILS", name: "Israeli Shekel", flag: "🇮🇱" },
    { code: "RUB", name: "Russian Ruble", flag: "🇷🇺" },
    { code: "EGP", name: "Egyptian Pound", flag: "🇪🇬" },
    { code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰" },
    { code: "BDT", name: "Bangladeshi Taka", flag: "🇧🇩" },
    { code: "LKR", name: "Sri Lankan Rupee", flag: "🇱🇰" }
];

function SpendPriorityModal(props: {
    open: boolean;
    selected: SpendPriorityToken;
    options: Array<{ symbol: SpendPriorityToken; amountToken: string; amountUsd: string; iconUrl: string }>;
    saving?: boolean;
    onSelect: (token: SpendPriorityToken) => void;
    onClose: () => void;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/30 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-4 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[1.15rem] font-semibold text-[#2f67d8]">Select spend priority</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                    >
                        <X size={18} />
                    </button>
                </div>
                <p className="mt-2 text-[0.92rem] leading-6 text-slate-500">
                    Card payments use this token first.
                </p>

                <div className="mt-4 space-y-2">
                    {props.options.map((item) => {
                        const isSelected = props.selected === item.symbol;
                        return (
                            <button
                                key={item.symbol}
                                type="button"
                                disabled={props.saving}
                                onClick={() => props.onSelect(item.symbol)}
                                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition ${isSelected ? "ui-state-selected" : "ui-state-unselected"
                                    } ${props.saving ? "ui-state-disabled" : ""}`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                                        <img src={item.iconUrl} alt={`${item.symbol} icon`} className="h-7 w-7 object-contain" />
                                    </div>
                                    <div>
                                        <p className="text-[1rem] text-slate-900">{item.symbol}</p>
                                        <p className="text-[0.86rem] text-slate-500">{item.amountToken} · {item.amountUsd}</p>
                                    </div>
                                </div>
                                {isSelected ? (
                                    <Check size={16} className="text-[#2f67d8]" />
                                ) : (
                                    <Circle size={16} className="text-slate-300" />
                                )}
                            </button>
                        );
                    })}
                </div>

            </div>
        </div>
    );
}

function DisplayCurrencyModal(props: {
    open: boolean;
    selected: DisplayCurrencyCode;
    search: string;
    options: Array<{ code: DisplayCurrencyCode; name: string; flag: string }>;
    onSearchChange: (value: string) => void;
    onSelect: (code: DisplayCurrencyCode) => void;
    onClose: () => void;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/30 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-4 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-3 flex items-center justify-between">
                    <h3 className={`${TYPO.modalTitle} text-[#2f67d8]`}>Select display currency</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="mb-3 flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                    <Search size={17} className="text-slate-400" />
                    <input
                        value={props.search}
                        onChange={(event) => props.onSearchChange(event.target.value)}
                        placeholder="Search..."
                        className="w-full bg-transparent text-[0.95rem] text-slate-900 outline-none placeholder:text-slate-400"
                    />
                </div>

                <div className="max-h-[48vh] space-y-1 overflow-y-auto pr-1">
                    {props.options.map((item) => {
                        const selected = props.selected === item.code;
                        return (
                            <button
                                key={item.code}
                                type="button"
                                onClick={() => props.onSelect(item.code)}
                                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition ${selected ? "ui-state-selected" : "ui-state-unselected"
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[0.68rem] font-semibold text-slate-600">
                                        {item.code.slice(0, 2)}
                                    </span>
                                    <div>
                                        <p className="text-[1rem] text-slate-900">{item.code}</p>
                                        <p className="text-[0.88rem] text-slate-500">{item.name}</p>
                                    </div>
                                </div>
                                {selected ? (
                                    <Check size={16} className="text-[#2f67d8]" />
                                ) : (
                                    <Circle size={16} className="text-slate-300" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function truncateNoRound(value: string, decimals: number) {
    const raw = String(value || "0").trim();
    if (!raw) return `0.${"0".repeat(decimals)}`;

    const negative = raw.startsWith("-");
    const unsigned = negative ? raw.slice(1) : raw;
    const [intPartRaw, fracPartRaw = ""] = unsigned.split(".");
    const intPart = intPartRaw || "0";
    const fracPart = fracPartRaw.slice(0, decimals).padEnd(decimals, "0");

    return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

function formatAmountForTx(value: string, maxDecimals = 8) {
    const normalized = truncateNoRound(value, maxDecimals);
    const [intPart, fracRaw = ""] = normalized.split(".");
    const fracTrimmed = fracRaw.replace(/0+$/, "");
    const min2 = fracTrimmed.padEnd(2, "0");
    const fracFinal = min2.slice(0, maxDecimals);
    return `${intPart}.${fracFinal}`;
}

function mapVaultTransactions(transactions: DashboardTransaction[]): DisplayTransaction[] {
    const iconBySymbol: Record<string, string> = {
        USDT: "/icons/usdt.png",
        USDC: "/icons/usdc.png",
        WETH: "/icons/weth-large.png"
    };
    const toNum = (value: unknown) => {
        const n = Number(String(value ?? "").trim());
        return Number.isFinite(n) ? n : NaN;
    };
    const shouldHideEarnShadowTx = (
        tx: DashboardTransaction,
        earnRows: DashboardTransaction[],
        expectedDirection: "earn-subscribe" | "earn-redemption" | "earn-reward"
    ) => {
        const txAmount = toNum(tx.amount);
        if (!Number.isFinite(txAmount)) return false;
        const txToken = String(tx.tokenSymbol || "").trim().toUpperCase();
        const txTs = tx.timestamp ? new Date(tx.timestamp).getTime() : NaN;

        return earnRows.some((earnTx) => {
            if (String(earnTx.direction || "") !== expectedDirection) return false;
            const earnToken = String(earnTx.tokenSymbol || "").trim().toUpperCase();
            if (!earnToken || earnToken !== txToken) return false;

            const earnAmount = toNum(earnTx.amount);
            if (!Number.isFinite(earnAmount)) return false;
            if (Math.abs(earnAmount - txAmount) > 1e-12) return false;

            const earnTs = earnTx.timestamp ? new Date(earnTx.timestamp).getTime() : NaN;
            if (!Number.isFinite(txTs) || !Number.isFinite(earnTs)) return true;
            return Math.abs(earnTs - txTs) <= 10 * 60 * 1000;
        });
    };

    const earnRows = transactions.filter((tx) =>
        tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward"
    );
    const earnTxHashSet = new Set(
        transactions
            .filter((tx) => tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward")
            .map((tx) => String(tx.txHash || "").trim().toLowerCase())
            .filter(Boolean)
    );
    const swapTxHashSet = new Set(
        transactions
            .filter((tx) => tx.direction === "swap")
            .map((tx) => String(tx.txHash || "").trim().toLowerCase())
            .filter(Boolean)
    );
    const filtered = transactions.filter((tx) => {
        const hash = String(tx.txHash || "").trim().toLowerCase();
        const direction = String(tx.direction || "");
        const isEarn = direction === "earn-subscribe" || direction === "earn-redemption" || direction === "earn-reward";
        const isCard = direction === "card-payment";
        const isSwap = direction === "swap";
        if (hash && swapTxHashSet.has(hash) && !isSwap && !isEarn && !isCard) {
            return false;
        }
        if (direction === "out") {
            if (hash && swapTxHashSet.has(hash)) return false;
            if (hash && earnTxHashSet.has(hash)) return false;
            if (shouldHideEarnShadowTx(tx, earnRows, "earn-subscribe")) return false;
        }
        if (direction === "in") {
            if (hash && swapTxHashSet.has(hash)) return false;
            if (hash && earnTxHashSet.has(hash)) return false;
            if (shouldHideEarnShadowTx(tx, earnRows, "earn-redemption")) return false;
            if (shouldHideEarnShadowTx(tx, earnRows, "earn-reward")) return false;
        }
        return true;
    });

    return filtered.slice(0, 5).map((tx, index) => {
        const symbol = tx.tokenSymbol || tx.type || "";
        const formattedAmount = formatAmountForTx(tx.amount || "0", 8);
        const isEarn = tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward";
        const isSwap = !isEarn && tx.direction !== "card-payment" && tx.direction !== "in" && tx.direction !== "out";
        const swapFromSymbol = String(tx.swapFromSymbol || "USDT").toUpperCase();
        const swapToSymbol = String(tx.swapToSymbol || symbol || "USDT").toUpperCase();
        const swapFromAmount = String(tx.swapFromAmount || tx.amount || "0");
        const swapToAmount = String(tx.swapToAmount || tx.amount || "0");
        const swapFromFormatted = formatAmountForTx(swapFromAmount, 8);
        const swapToFormatted = formatAmountForTx(swapToAmount, 8);
        const earnDirectionLabel = tx.direction === "earn-subscribe"
            ? "Earn deposit"
            : tx.direction === "earn-redemption"
                ? "Earn redemption"
                : "Earn reward";
        const earnSignedAmount = tx.direction === "earn-subscribe"
            ? `-${formattedAmount} ${symbol}`.trim()
            : `+${formattedAmount} ${symbol}`.trim();
        return {
            id: tx.id || `${tx.txHash}-${index}`,
            dateLabel: tx.timestamp
                ? new Date(tx.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                })
                : "Recent",
            name: tx.direction === "card-payment"
                ? (tx.merchant || "Card Transaction")
                : (isEarn ? (tx.tokenSymbol || "Token") : (tx.direction === "in" || tx.direction === "out" ? (tx.tokenSymbol || "Token") : swapFromSymbol)),
            subtitle: tx.direction === "card-payment"
                ? ""
                : (isEarn ? earnDirectionLabel : (isSwap ? swapToSymbol : formattedAmount)),
            meta: tx.direction === "card-payment"
                ? `${tx.country || "MY"}${tx.cardLast4 ? ` ** ${tx.cardLast4}` : ""}`
                : "",
            amountPrimary: tx.direction === "card-payment"
                ? (tx.amountPrimary || "- RM0.00 MYR")
                : (isEarn ? earnSignedAmount : (isSwap ? `-${swapFromFormatted} ${swapFromSymbol}` : `${formattedAmount} ${symbol}`.trim())),
            amountSecondary: tx.direction === "card-payment"
                ? (tx.amountSecondary || "")
                : (isEarn ? "" : (isSwap ? `+${swapToFormatted} ${swapToSymbol}` : "")),
            reward: tx.direction === "card-payment" ? (tx.reward || "") : undefined,
            status: "",
            kind: tx.direction === "card-payment"
                ? "card"
                : tx.direction === "in"
                    ? "in"
                    : tx.direction === "out"
                        ? "out"
                        : isEarn
                            ? "earn"
                            : "swap",
            swapFromSymbol: isSwap ? swapFromSymbol : undefined,
            swapToSymbol: isSwap ? swapToSymbol : undefined,
            swapFromAmount: isSwap ? swapFromFormatted : undefined,
            swapToAmount: isSwap ? swapToFormatted : undefined,
            swapFromIconUrl: isSwap ? iconBySymbol[swapFromSymbol] : undefined,
            href: tx.id ? `/transactions/${tx.id}` : undefined,
        };
    });
}

function formatUsdDisplay(value: string) {
    const normalized = String(value || "").replace(/,/g, "").trim();
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return "$0.00";
    return `$${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(numeric)}`;
}

function toUsdNumber(value: string) {
    const normalized = String(value || "").replace(/,/g, "").trim();
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrencyDisplay(value: number, currency: DisplayCurrencyCode) {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    } catch (_err) {
        return `${currency} ${value.toFixed(2)}`;
    }
}

function mapDashboardAssets(assets: DashboardAsset[] | undefined, apyBySymbol?: Record<string, number>): AssetItem[] {
    if (!assets?.length) {
        return [];
    }

    const iconBySymbol = {
        USDT: {
            iconUrl: "/icons/usdt.png",
        },
        USDC: {
            iconUrl: "/icons/usdc.png",
        },
        WETH: {
            iconUrl: "/icons/weth-large.png",
        }
    } as const;

    return assets.map((asset) => ({
        symbol: asset.symbol,
        amountUsd: formatUsdDisplay(asset.usdValue),
        amountToken: `${asset.balance} ${asset.symbol}`,
        iconUrl: iconBySymbol[asset.symbol].iconUrl,
        earnApy: apyBySymbol?.[asset.symbol]
    }));
}

function ActionItem(props: {
    href?: string;
    icon: React.ReactNode;
    label: string;
}) {
    const { href, icon, label } = props;

    const content = (
        <div className="group flex flex-col items-center gap-2">
            <div
                className="relative flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-full border border-[#cfe0ff] bg-[#3b78e7] text-white shadow-[0_10px_20px_rgba(59,120,231,0.22)] transition duration-200 group-hover:brightness-105"
            >
                {icon}
            </div>
            <span className="text-[0.9rem] font-medium text-slate-800">{label}</span>
        </div>
    );

    if (href) {
        return <Link href={href}>{content}</Link>;
    }

    return <button type="button">{content}</button>;
}

function AssetRow({ asset, showEarnHint }: { asset: AssetItem; showEarnHint: boolean }) {
    const hasEarnApy = Number.isFinite(Number(asset.earnApy));
    return (
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm">
                    <img
                        src={asset.iconUrl}
                        alt={`${asset.symbol} icon`}
                        className="h-10 w-10 object-contain"
                        loading="lazy"
                    />
                </div>
                <div className="min-w-0">
                    <p className="truncate text-[1.02rem] font-medium text-slate-950">{asset.symbol}</p>
                    {hasEarnApy && showEarnHint ? (
                        <p
                            className="mt-0.5 text-[0.74rem] text-emerald-500 transition-opacity duration-700 ease-in-out"
                        >
                            {`Earn ${Number(asset.earnApy || 0).toFixed(2)}% APY`}
                        </p>
                    ) : null}
                </div>
            </div>
            <div className="text-right">
                <p className="text-[1rem] font-semibold text-slate-950">{asset.amountUsd}</p>
                <p className="mt-1 text-[0.88rem] text-slate-500">{asset.amountToken}</p>
            </div>
        </div>
    );
}

function BottomTab(props: {
    active?: boolean;
    icon: React.ReactNode;
    label: string;
}) {
    const { active, icon, label } = props;

    return (
        <div
            className={`flex flex-col items-center gap-1 rounded-[1rem] px-1.5 py-1.5 transition ${active
                ? "border border-[#cfe0ff] bg-[#f3f8ff] text-[#3468d4] shadow-[0_6px_16px_rgba(59,114,223,0.14)]"
                : "text-slate-500 hover:bg-slate-50"
                }`}
        >
            <div className={`flex h-7 w-7 items-center justify-center rounded-full ${active ? "border border-[#cfe0ff] bg-[#dbe8ff] text-[#1e3a8a]" : "bg-slate-100"}`}>
                {icon}
            </div>
            <span className="text-[0.68rem] font-medium leading-none">{label}</span>
        </div>
    );
}

export default function DashboardPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { token, user, setUser, hydrated } = useAuthStore();
    const [copied, setCopied] = useState(false);
    const [spendPriorityOpen, setSpendPriorityOpen] = useState(false);
    const [spendPriorityDraft, setSpendPriorityDraft] = useState<SpendPriorityToken>("USDT");
    const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrencyCode>("USD");
    const [displayCurrencyOpen, setDisplayCurrencyOpen] = useState(false);
    const [displayCurrencySearch, setDisplayCurrencySearch] = useState("");
    const [balanceFontPx, setBalanceFontPx] = useState(BALANCE_BASE_FONT_PX);
    const [maskTotalBalance, setMaskTotalBalance] = useState(false);
    const [maskReady, setMaskReady] = useState(false);
    const [showEarnHint, setShowEarnHint] = useState(true);
    const balanceRowRef = useRef<HTMLDivElement | null>(null);

    const profileQuery = useQuery({
        queryKey: ["auth-me", token],
        queryFn: getMe,
        enabled: Boolean(token),
    });

    const summaryQuery = useQuery({
        queryKey: ["dashboard-summary", token],
        queryFn: getDashboardSummary,
        enabled: Boolean(token),
    });
    const earnSummaryQuery = useQuery({
        queryKey: ["dashboard-earn-summary", token],
        enabled: Boolean(token),
        queryFn: getEarnSummary,
        staleTime: 30_000
    });
    const fxQuery = useQuery({
        queryKey: ["fx-rates-usd"],
        queryFn: async () => {
            const payload = await getFxLatest("USD");
            return payload.rates || {};
        },
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false
    });
    const notificationCountQuery = useQuery({
        queryKey: ["notifications-unread-count", token],
        enabled: Boolean(token),
        queryFn: getNotificationUnreadCount
    });

    const activeUser = profileQuery.data ?? user;
    const displayTransactions = useMemo(() => {
        if (summaryQuery.isLoading || summaryQuery.isFetching) {
            return [] as DisplayTransaction[];
        }
        const txs = summaryQuery.data?.transactions ?? [];
        return txs.length ? mapVaultTransactions(txs) : [];
    }, [summaryQuery.data, summaryQuery.isFetching, summaryQuery.isLoading]);
    const apyBySymbol = useMemo(() => {
        const map: Record<string, number> = {};
        (earnSummaryQuery.data?.pools || []).forEach((pool) => {
            map[String(pool.token || "").toUpperCase()] = Number(pool.apy || 0);
        });
        // Fallback to keep all asset rows consistent even when one pool is missing from API response.
        if (!Number.isFinite(map.USDT)) map.USDT = 3.0;
        if (!Number.isFinite(map.USDC)) map.USDC = 3.01;
        if (!Number.isFinite(map.WETH)) map.WETH = 3.5;
        return map;
    }, [earnSummaryQuery.data?.pools]);
    const displayAssets = useMemo(
        () => mapDashboardAssets(summaryQuery.data?.assets, apyBySymbol),
        [summaryQuery.data, apyBySymbol]
    );
    const unreadNotificationCount = Number(notificationCountQuery.data?.unreadCount || 0);
    const totalBalance = useMemo(() => {
        const usdValue = toUsdNumber(summaryQuery.data?.totalBalanceUsd || "0");
        if (displayCurrency === "USD") {
            return formatCurrencyDisplay(usdValue, "USD");
        }
        const rate = Number(fxQuery.data?.[displayCurrency] || 0);
        if (!Number.isFinite(rate) || rate <= 0) {
            return `${displayCurrency} ${usdValue.toFixed(2)}`;
        }
        return formatCurrencyDisplay(usdValue * rate, displayCurrency);
    }, [summaryQuery.data?.totalBalanceUsd, displayCurrency, fxQuery.data]);
    const filteredDisplayCurrencies = useMemo(() => {
        const pinnedSet = new Set<DisplayCurrencyCode>(DISPLAY_CURRENCY_PINNED);
        const pinned = DISPLAY_CURRENCIES.filter((item) => pinnedSet.has(item.code));
        const others = DISPLAY_CURRENCIES
            .filter((item) => !pinnedSet.has(item.code))
            .sort((a, b) => a.code.localeCompare(b.code));
        const ordered = [...pinned, ...others];

        const keyword = displayCurrencySearch.trim().toLowerCase();
        if (!keyword) return ordered;
        return ordered.filter((item) =>
            item.code.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword)
        );
    }, [displayCurrencySearch]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
        const normalized = String(saved || "").trim().toUpperCase() as DisplayCurrencyCode;
        if (DISPLAY_CURRENCIES.some((item) => item.code === normalized)) {
            setDisplayCurrency(normalized);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = window.localStorage.getItem(BALANCE_MASK_STORAGE_KEY);
        setMaskTotalBalance(saved === "1");
        setMaskReady(true);
    }, []);

    useEffect(() => {
        const profileCurrency = String(activeUser?.displayCurrency || "").trim().toUpperCase() as DisplayCurrencyCode;
        if (DISPLAY_CURRENCIES.some((item) => item.code === profileCurrency)) {
            setDisplayCurrency(profileCurrency);
        }
    }, [activeUser?.displayCurrency]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, displayCurrency);
    }, [displayCurrency]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!maskReady) return;
        window.localStorage.setItem(BALANCE_MASK_STORAGE_KEY, maskTotalBalance ? "1" : "0");
    }, [maskTotalBalance, maskReady]);

    useEffect(() => {
        const rowEl = balanceRowRef.current;
        if (!rowEl) return;

        const measureAndSet = () => {
            const availableWidth = rowEl.clientWidth * 0.7;
            if (availableWidth <= 0) return;

            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) return;

            context.font = `600 ${BALANCE_BASE_FONT_PX}px Verdana, Geneva, sans-serif`;
            const textWidth = context.measureText(totalBalance).width;
            if (!Number.isFinite(textWidth) || textWidth <= 0) {
                setBalanceFontPx(BALANCE_BASE_FONT_PX);
                return;
            }

            const scaled = Math.floor((BALANCE_BASE_FONT_PX * availableWidth) / textWidth);
            const nextSize = Math.max(BALANCE_MIN_FONT_PX, Math.min(BALANCE_BASE_FONT_PX, scaled));
            setBalanceFontPx(nextSize);
        };

        measureAndSet();
        const observer = new ResizeObserver(() => measureAndSet());
        observer.observe(rowEl);
        window.addEventListener("resize", measureAndSet);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measureAndSet);
        };
    }, [totalBalance]);

    const selectedSpendPriority = useMemo<SpendPriorityToken>(() => {
        const raw = String(summaryQuery.data?.spendPriorityToken || activeUser?.spendPriorityToken || "USDT").toUpperCase();
        return SPEND_PRIORITY_OPTIONS.includes(raw as SpendPriorityToken) ? (raw as SpendPriorityToken) : "USDT";
    }, [summaryQuery.data?.spendPriorityToken, activeUser?.spendPriorityToken]);

    const spendPriorityAssets = useMemo(() => {
        const iconBySymbol: Record<SpendPriorityToken, string> = {
            USDT: "/icons/usdt.png",
            USDC: "/icons/usdc.png",
            WETH: "/icons/weth-large.png"
        };
        const assetMap = new Map((summaryQuery.data?.assets || []).map((item) => [item.symbol, item]));

        return SPEND_PRIORITY_OPTIONS.map((symbol) => {
            const found = assetMap.get(symbol);
            return {
                symbol,
                amountToken: `${found?.balance || "0"} ${symbol}`,
                amountUsd: formatUsdDisplay(found?.usdValue || "0"),
                iconUrl: iconBySymbol[symbol]
            };
        });
    }, [summaryQuery.data?.assets]);

    useEffect(() => {
        if (!spendPriorityOpen) {
            setSpendPriorityDraft(selectedSpendPriority);
        }
    }, [selectedSpendPriority, spendPriorityOpen]);
    useEffect(() => {
        let timer: number | undefined;
        const schedule = (show: boolean) => {
            timer = window.setTimeout(() => {
                setShowEarnHint(!show);
                schedule(!show);
            }, show ? 40_000 : 60_000);
        };
        schedule(true);
        return () => {
            if (timer) window.clearTimeout(timer);
        };
    }, []);

    const spendPriorityMutation = useMutation({
        mutationFn: updateSpendPriorityToken,
        onSuccess: (result) => {
            queryClient.setQueryData(["dashboard-summary", token], (prev: any) => {
                if (!prev) return prev;
                return { ...prev, spendPriorityToken: result.spendPriorityToken };
            });
            queryClient.setQueryData(["auth-me", token], (prev: any) => {
                if (!prev) return prev;
                return { ...prev, spendPriorityToken: result.spendPriorityToken };
            });
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: "Saved" } }));
        },
        onError: (error: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: error.message || "Save failed" } }));
        }
    });
    const displayCurrencyMutation = useMutation({
        mutationFn: updateDisplayCurrency,
        onSuccess: (result) => {
            if (activeUser) {
                setUser({ ...activeUser, displayCurrency: result.displayCurrency });
            }
            queryClient.setQueryData(["auth-me", token], (prev: any) => {
                if (!prev) return prev;
                return { ...prev, displayCurrency: result.displayCurrency };
            });
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: "Saved" } }));
        },
        onError: (error: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: error.message || "Save failed", tone: "error" } }));
        }
    });

    if (!hydrated) {
        return (
            <main className="flex min-h-screen items-center justify-center px-6">
                <div className="rounded-2xl border border-white/80 bg-white px-5 py-4 text-sm text-slate-600 shadow-[var(--shadow)]">
                    <p>Restoring your session...</p>
                    <p className="mt-1 text-xs text-slate-400">If no response after a while, please refresh this page.</p>
                </div>
            </main>
        );
    }

    if (!token) {
        router.replace("/login");
        return null;
    }

    const handleCopy = async () => {
        if (!activeUser?.vaultAddress) return;
        const ok = await copyText(activeUser.vaultAddress);
        if (!ok) {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: "Copy failed. Please try again" }
            }));
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md space-y-5 pb-20">
                <section className="flex items-start justify-between pt-2">
                    <div className="flex items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#cfe0ff] bg-[#f2f7ff] text-[#3468d4] shadow-[0_10px_25px_rgba(59,114,223,0.14)]">
                            <Wallet size={28} strokeWidth={1.8} />
                        </div>
                        <div>
                            <p className="text-[0.95rem] text-slate-500">Personal (testnet)</p>
                            <div className="flex items-center gap-2">
                                <h1 className={`${TYPO.pageTitle}`}>My Account</h1>
                            </div>
                            <p className="mt-1 text-[0.78rem] text-slate-400">
                                {activeUser?.email ?? "wallet@demo.com"}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => router.push("/notifications")}
                            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-[0_10px_20px_rgba(148,163,184,0.12)] transition hover:bg-slate-50"
                        >
                            <Bell size={16} />
                            {unreadNotificationCount > 0 ? (
                                <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[0.66rem] font-semibold leading-[1.1rem] text-white">
                                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                                </span>
                            ) : null}
                        </button>
                        <button
                            type="button"
                            onClick={() => router.push("/menu")}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-[0_10px_20px_rgba(148,163,184,0.12)] transition hover:bg-slate-50"
                        >
                            <Menu size={17} />
                        </button>
                    </div>
                </section>

                <section className="rounded-[2rem] border border-white/80 bg-white/92 px-6 py-7 text-center shadow-[var(--shadow)] backdrop-blur">
                    <div className="flex items-center justify-center gap-2 text-[#3468d4]">
                        <span className="font-heading text-[1.2rem]">Total Balance</span>
                        <Sparkles size={16} />
                        <button
                            type="button"
                            onClick={() => setMaskTotalBalance((prev) => !prev)}
                            className="ml-1 inline-flex items-center justify-center rounded-full text-[#3468d4]"
                            aria-label={maskTotalBalance ? "Show total balance" : "Hide total balance"}
                        >
                            {maskTotalBalance ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>

                    <div ref={balanceRowRef} className="mt-3 flex items-end justify-center gap-3">
                        <span
                            style={{ fontSize: `${balanceFontPx}px`, maxWidth: "70%" }}
                            className="whitespace-nowrap font-semibold leading-none tracking-[-0.04em] text-slate-950"
                        >
                            {maskTotalBalance ? "****" : totalBalance}
                        </span>
                        <button
                            type="button"
                            onClick={() => setDisplayCurrencyOpen(true)}
                            className="flex items-center gap-1 pb-2 text-[1.05rem] text-slate-500"
                        >
                            {displayCurrency}
                            <ChevronDown size={16} className="text-slate-400" />
                        </button>
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-4">
                        <ActionItem href="/deposit" icon={<Plus size={22} strokeWidth={2.35} />} label="Add Funds" />
                        <ActionItem href="/send" icon={<Send size={20} strokeWidth={2.35} />} label="Send" />
                        <ActionItem href="/convert" icon={<RefreshCw size={20} strokeWidth={2.35} />} label="Convert" />
                    </div>
                </section>

                <section className="rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)] backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className={`${TYPO.sectionTitle} text-[#3468d4]`}>Assets</h2>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setSpendPriorityDraft(selectedSpendPriority);
                                setSpendPriorityOpen(true);
                            }}
                            className="pt-1 text-right text-[0.96rem] text-[#3468d4]"
                        >
                            Set spend priority
                        </button>
                    </div>

                    <div className="mt-4 rounded-[1.4rem] border border-slate-100 bg-[#fafdff] px-4 py-1">
                        {displayAssets.length ? (
                            displayAssets.map((asset) => (
                                <AssetRow key={asset.symbol} asset={asset} showEarnHint={showEarnHint} />
                            ))
                        ) : (
                            <div className="py-6 text-center text-[0.95rem] text-slate-400">
                                No asset balance yet
                            </div>
                        )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <Link
                            href="/deposit"
                            className="btn-theme-primary flex h-9 items-center justify-center px-3 text-[0.9rem] font-medium"
                        >
                            Add Funds
                        </Link>
                        <Link
                            href="/earn"
                            className="btn-theme-secondary flex h-9 items-center justify-center px-3 text-[0.9rem] font-medium"
                        >
                            Earn with Liquid
                        </Link>
                    </div>

                    <div className="mt-4 flex items-center justify-between rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <div className="min-w-0">
                            <p className="text-slate-500">Vault address</p>
                            <p className="mt-1 break-all text-slate-800">{activeUser?.vaultAddress || ""}</p>
                        </div>
                        <button type="button" onClick={handleCopy} className="text-slate-500">
                            {copied ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} />}
                        </button>
                    </div>
                </section>

                <section className="rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)] backdrop-blur">
                    <div className="flex items-center justify-between">
                        <h2 className={`${TYPO.sectionTitle} text-[#3468d4]`}>Transactions</h2>
                        <Link
                            href="/transactions"
                            className="btn-theme-secondary flex items-center gap-2 rounded-lg px-3 py-0 text-[0.85rem]"
                        >
                            View All
                            <ArrowUpRight size={16} />
                        </Link>
                    </div>

                    <div className="mt-6 space-y-5">
                        {displayTransactions.length ? (
                            displayTransactions.map((tx, index) => (
                                <div key={tx.id} className="space-y-3">
                                    {index === 0 || tx.dateLabel !== displayTransactions[index - 1]?.dateLabel ? (
                                        <p className="text-[0.95rem] text-slate-400 whitespace-nowrap">{tx.dateLabel}</p>
                                    ) : null}
                                    <Link href={tx.href || "/transactions"} className="block">
                                        <div className="flex items-center gap-4">
                                            <div className={`mt-1 flex h-11 w-11 items-center justify-center rounded-xl ${tx.kind === "card"
                                                ? "bg-slate-100 text-slate-700"
                                                : tx.kind === "in"
                                                    ? "bg-emerald-50 text-emerald-600"
                                                    : tx.kind === "out"
                                                        ? "bg-amber-50 text-amber-600"
                                                        : tx.kind === "earn"
                                                            ? "bg-violet-50 text-violet-600"
                                                            : "bg-sky-50 text-sky-600"
                                                }`}>
                                                {tx.kind === "swap" && tx.swapFromIconUrl ? (
                                                    <img src={tx.swapFromIconUrl} alt={`${tx.swapFromSymbol || "swap"} icon`} className="h-8 w-8 rounded-full object-cover" />
                                                ) : tx.kind === "card" ? (
                                                    <CreditCard size={24} />
                                                ) : tx.kind === "in" ? (
                                                    <Plus size={24} />
                                                ) : tx.kind === "out" ? (
                                                    <Send size={22} />
                                                ) : tx.kind === "earn" ? (
                                                    <Sparkles size={22} />
                                                ) : (
                                                    <RefreshCw size={22} />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <p className={`truncate text-[0.98rem] ${tx.kind === "card" ? "font-semibold text-emerald-600" : "font-semibold text-slate-900"}`}>{tx.name}</p>
                                                        {tx.subtitle ? (
                                                            <p className={`mt-1 ${tx.kind === "earn" ? "text-[0.8rem] font-normal" : "text-[0.88rem]"} ${tx.kind === "card" ? "text-emerald-500" : "text-slate-500"}`}>
                                                                {tx.subtitle}
                                                            </p>
                                                        ) : null}
                                                        <p className="mt-1 text-[0.9rem] text-slate-400">{tx.meta}</p>
                                                    </div>
                                                    <div className="shrink-0 flex items-start gap-2">
                                                        <div className="text-right">
                                                            <p className="text-[0.9rem] font-semibold text-slate-900">{tx.amountPrimary}</p>
                                                            {tx.amountSecondary && (tx.kind === "swap" || !/0\.00/.test(String(tx.amountSecondary))) ? (
                                                                <p className="mt-1 text-[0.86rem] text-slate-400">{tx.amountSecondary}</p>
                                                            ) : null}
                                                            {tx.reward ? <p className="mt-1 text-[0.95rem] text-emerald-500">{tx.reward}</p> : null}
                                                        </div>
                                                        <ChevronRight className="mt-0.5 shrink-0 text-slate-400" size={22} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                    {index < displayTransactions.length - 1 ? (
                                        <div className="border-b border-slate-100" />
                                    ) : null}
                                </div>
                            ))
                        ) : (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-6 text-center text-[0.95rem] text-slate-500">
                                No transactions yet
                            </div>
                        )}
                    </div>

                    <Link
                        href="/transactions"
                        className="btn-theme-primary mt-8 flex h-9 w-full items-center justify-center px-4 text-[0.92rem] font-medium"
                    >
                        View All Transactions
                    </Link>
                </section>

                <nav className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[env(safe-area-inset-bottom)]">
                    <div className="mx-auto w-full max-w-md rounded-[1.35rem] border border-white/80 bg-white/92 px-1.5 py-1.5 shadow-[0_10px_24px_rgba(148,163,184,0.14)] backdrop-blur">
                        <div className="grid grid-cols-4 gap-1">
                            <BottomTab active icon={<Wallet size={16} />} label="Vault" />
                            <Link href="/earn">
                                <BottomTab icon={<Sparkles size={16} />} label="Earn" />
                            </Link>
                            <Link href="/cards">
                                <BottomTab icon={<CreditCard size={16} />} label="Cards" />
                            </Link>
                            <Link href="/transactions">
                                <BottomTab icon={<Menu size={16} />} label="Transactions" />
                            </Link>
                        </div>
                    </div>
                </nav>
            </div>

            <SpendPriorityModal
                open={spendPriorityOpen}
                selected={spendPriorityDraft}
                options={spendPriorityAssets}
                saving={spendPriorityMutation.isPending}
                onSelect={(nextToken) => {
                    setSpendPriorityDraft(nextToken);
                    if (spendPriorityMutation.isPending) return;
                    if (nextToken === selectedSpendPriority) return;
                    spendPriorityMutation.mutate({ token: nextToken });
                }}
                onClose={() => setSpendPriorityOpen(false)}
            />

            <DisplayCurrencyModal
                open={displayCurrencyOpen}
                selected={displayCurrency}
                search={displayCurrencySearch}
                options={filteredDisplayCurrencies}
                onSearchChange={setDisplayCurrencySearch}
                onSelect={(code) => {
                    if (code === displayCurrency) {
                        return;
                    }
                    setDisplayCurrency(code);
                    displayCurrencyMutation.mutate({ currency: code });
                }}
                onClose={() => setDisplayCurrencyOpen(false)}
            />
        </main>
    );
}
