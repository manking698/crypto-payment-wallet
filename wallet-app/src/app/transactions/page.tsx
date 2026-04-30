"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
    CalendarDays,
    Check,
    ChevronLeft,
    ChevronRight,
    Circle,
    CreditCard,
    Plus,
    Search,
    SlidersHorizontal,
    ArrowUpRight,
    RefreshCw,
    X
} from "lucide-react";
import { getCards, getTransactionHistory } from "@/lib/api";
import { TYPO } from "@/lib/typography";
import type { DashboardTransaction } from "@/lib/types";
import { useAuthStore } from "@/store/auth-store";

type ScopeTab = "all" | "vault" | "card";

const PAGE_SIZE = 5;

const TYPE_LABELS: Record<string, string> = {
    "card-payment": "Card Transactions",
    in: "Adding Funds",
    out: "Withdrawals",
    swap: "Swap"
};

function formatDateLabel(input?: string | null) {
    if (!input) return "Recent";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return "Recent";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(input?: string | null) {
    if (!input) return "";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
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

function toAmountText(value: string, symbol: string, direction: string) {
    const amount = formatAmountForTx(value, 8);
    if (direction === "in") return `${amount} ${symbol}`;
    if (direction === "out") return `${amount} ${symbol}`;
    return amount;
}

function groupByDate(transactions: DashboardTransaction[]) {
    const groups = new Map<string, DashboardTransaction[]>();
    transactions.forEach((tx) => {
        const key = formatDateLabel(tx.timestamp);
        const list = groups.get(key) || [];
        list.push(tx);
        groups.set(key, list);
    });
    return Array.from(groups.entries());
}

function toNum(value: unknown) {
    const n = Number(String(value ?? "").trim());
    return Number.isFinite(n) ? n : NaN;
}

function shouldHideEarnShadowTx(
    tx: DashboardTransaction,
    earnRows: DashboardTransaction[],
    expectedDirection: "earn-subscribe" | "earn-redemption" | "earn-reward"
) {
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
}

function TxIcon({ tx }: { tx: DashboardTransaction }) {
    const isEarn = tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward";
    if (isEarn) {
        return (
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                <RefreshCw size={22} />
            </div>
        );
    }
    if (tx.direction === "card-payment") {
        return (
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <CreditCard size={22} />
            </div>
        );
    }
    if (tx.direction === "in") {
        return (
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Plus size={22} />
            </div>
        );
    }
    if (tx.direction === "out") {
        return (
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <ArrowUpRight size={22} />
            </div>
        );
    }
    const fromSymbol = String(tx.swapFromSymbol || "USDT").toUpperCase();
    const iconBySymbol: Record<string, string> = {
        USDT: "/icons/usdt.png",
        USDC: "/icons/usdc.png",
        WETH: "/icons/weth-large.png"
    };
    const iconUrl = iconBySymbol[fromSymbol];
    if (iconUrl) {
        return (
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
                <img src={iconUrl} alt={`${fromSymbol} icon`} className="h-7 w-7 rounded-full object-cover" />
            </div>
        );
    }
    return (
        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <RefreshCw size={22} />
        </div>
    );
}

function TxRow({ tx }: { tx: DashboardTransaction }) {
    const isCard = tx.direction === "card-payment";
    const isAddFunds = tx.direction === "in";
    const isWithdraw = tx.direction === "out";
    const isEarn = tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward";
    const isSwap = !isCard && !isAddFunds && !isWithdraw && !isEarn;
    const symbol = tx.tokenSymbol || "USDT";
    const swapFromSymbol = String(tx.swapFromSymbol || "USDT").toUpperCase();
    const swapToSymbol = String(tx.swapToSymbol || symbol || "USDT").toUpperCase();
    const swapFromAmountRaw = String(tx.swapFromAmount || tx.amount || "0");
    const swapToAmountRaw = String(tx.swapToAmount || tx.amount || "0");
    const title = isCard
        ? tx.merchant || "Card Transaction"
        : (isEarn
            ? symbol
            : (isAddFunds ? symbol : (isWithdraw ? symbol : swapFromSymbol)));
    const baseAmountText = formatAmountForTx(tx.amount || "0", 8);
    const subTitle = isCard
        ? ""
        : (isEarn
            ? (tx.direction === "earn-subscribe" ? "Earn deposit" : tx.direction === "earn-redemption" ? "Earn redemption" : "Earn reward")
            : (isSwap ? swapToSymbol : baseAmountText));
    const rightTop = isCard
        ? (tx.amountPrimary || "- RM0.00 MYR")
        : (isEarn
            ? `${tx.direction === "earn-subscribe" ? "-" : "+"}${formatAmountForTx(tx.amount || "0", 8)} ${symbol}`
            : (isSwap
                ? `-${formatAmountForTx(swapFromAmountRaw, 8)}`
                : toAmountText(tx.amount, symbol, tx.direction)));
    const rightMidRaw = isCard ? (tx.amountSecondary || "") : "";
    const rightMid = isSwap
        ? `+${formatAmountForTx(swapToAmountRaw, 8)} ${swapToSymbol}`
        : (/0\.00/.test(String(rightMidRaw)) ? "" : rightMidRaw);
    const rightRewardRaw = isCard ? (tx.reward || "") : "";
    const rightReward = /^\$?0(\.0+)?$/i.test(String(rightRewardRaw).replace(/\s/g, "").replace(/^\+/, "")) ? "" : rightRewardRaw;
    const rightStatus = "";
    const href = tx.id ? `/transactions/${tx.id}` : "";

    const rowContent = (
        <div className="flex items-center gap-3.5 rounded-2xl px-1 py-2">
            <TxIcon tx={tx} />
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className={`truncate text-[0.96rem] ${isCard ? "font-semibold text-emerald-600" : "font-semibold text-slate-900"}`}>{title}</p>
                        {subTitle ? (
                            <p className={`mt-1 ${isEarn ? "text-[0.8rem] font-normal" : "text-[0.88rem]"} ${isCard ? "text-emerald-500" : "text-slate-500"}`}>
                                {subTitle}
                            </p>
                        ) : null}
                        <p className="mt-1 text-[0.88rem] text-slate-400">
                            {isCard ? `${tx.country || "MY"}${tx.cardLast4 ? ` ** ${tx.cardLast4}` : ""}` : ""}
                        </p>
                    </div>
                    <div className="shrink-0 flex items-start gap-2">
                        <div className="text-right">
                            <p className="text-[0.9rem] font-semibold text-slate-900">{isSwap ? `${rightTop} ${swapFromSymbol}` : rightTop}</p>
                            {rightMid ? <p className="mt-1 text-[0.86rem] text-slate-400">{rightMid}</p> : null}
                            {rightReward ? <p className="mt-1 text-[0.95rem] text-emerald-500">{rightReward}</p> : null}
                            {rightStatus ? <p className="mt-1 text-[0.88rem] text-slate-400">{rightStatus}</p> : null}
                        </div>
                        <ChevronRight className="mt-0.5 shrink-0 text-slate-400" size={20} />
                    </div>
                </div>
            </div>
        </div>
    );

    if (!href) return rowContent;
    return <Link href={href}>{rowContent}</Link>;
}

function SheetContainer(props: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                <div className="mb-2 flex items-center justify-between">
                    <div className="w-9" />
                    <h3 className={`${TYPO.modalTitle}`}>{props.title}</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                        aria-label="Close filter sheet"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="mt-5 max-h-[55vh] overflow-y-auto">{props.children}</div>
            </div>
        </div>
    );
}

export default function TransactionsPage() {
    const router = useRouter();
    const { token, hydrated } = useAuthStore();
    const [scope, setScope] = useState<ScopeTab>(() => {
        if (typeof window === "undefined") return "all";
        const initialScope = new URLSearchParams(window.location.search).get("scope");
        return initialScope === "vault" || initialScope === "card" || initialScope === "all" ? initialScope : "all";
    });
    const [selectedCards, setSelectedCards] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [showCardSheet, setShowCardSheet] = useState(false);
    const [showTypeSheet, setShowTypeSheet] = useState(false);
    const [showDateSheet, setShowDateSheet] = useState(false);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const invalidDateRange = Boolean(fromDate && toDate && toDate < fromDate);

    const applyScope = (nextScope: ScopeTab) => {
        setScope(nextScope);
        setSelectedTypes([]);
        if (typeof window === "undefined") return;
        if (nextScope === "all") {
            router.replace("/transactions");
            return;
        }
        router.replace(`/transactions?scope=${nextScope}`);
    };

    useEffect(() => {
        if (typeof window === "undefined") return;
        const qsScope = new URLSearchParams(window.location.search).get("scope");
        if (qsScope === "all" || qsScope === "vault" || qsScope === "card") {
            setScope(qsScope);
            setSelectedTypes([]);
        }
    }, []);

    const availableTypeOptions = useMemo(() => {
        if (scope === "card") return [];
        if (scope === "vault") return ["in", "out", "swap"];
        return ["card-payment", "in", "out", "swap"];
    }, [scope]);
    const cardsQuery = useQuery({
        queryKey: ["cards", token],
        enabled: Boolean(token),
        queryFn: getCards
    });

    const cardOptions = useMemo(() => {
        const cards = cardsQuery.data?.cards || [];
        return cards.slice(0, 1).map((item) => ({
            id: item.id,
            label: `..${item.last4}`,
            owner: item.cardholderName
        }));
    }, [cardsQuery.data?.cards]);

    useEffect(() => {
        if (!cardOptions.length) {
            setSelectedCards([]);
            return;
        }
        setSelectedCards((prev) => (prev.length ? prev : [cardOptions[0].id]));
    }, [cardOptions]);

    const txQuery = useInfiniteQuery({
        queryKey: ["transactions-history", token, scope, selectedTypes.join(","), fromDate, toDate],
        enabled: Boolean(token),
        initialPageParam: 1,
        queryFn: ({ pageParam }) =>
            getTransactionHistory({
                scope,
                page: Number(pageParam),
                limit: PAGE_SIZE,
                types: selectedTypes,
                fromDate: invalidDateRange ? undefined : (fromDate || undefined),
                toDate: invalidDateRange ? undefined : (toDate || undefined)
            }),
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined)
    });

    const txs = useMemo(() => {
        const rows = txQuery.data?.pages.flatMap((page) => page.transactions) || [];
        // 1) Deduplicate identical rows from backend pagination merges.
        const dedupRows = rows.filter((tx, index, arr) => {
            const key = [
                String(tx.txHash || "").trim().toLowerCase(),
                String(tx.direction || "").trim().toLowerCase(),
                String(tx.tokenSymbol || "").trim().toUpperCase(),
                String(tx.amount || "").trim()
            ].join("|");
            return index === arr.findIndex((it) => {
                const compareKey = [
                    String(it.txHash || "").trim().toLowerCase(),
                    String(it.direction || "").trim().toLowerCase(),
                    String(it.tokenSymbol || "").trim().toUpperCase(),
                    String(it.amount || "").trim()
                ].join("|");
                return compareKey === key;
            });
        });

        // 2) Hide in/out entries that are part of earn/swap flow.
        const earnRows = dedupRows.filter((tx) =>
            tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward"
        );
        const earnTxHashSet = new Set(
            dedupRows
                .filter((tx) => tx.direction === "earn-subscribe" || tx.direction === "earn-redemption" || tx.direction === "earn-reward")
                .map((tx) => String(tx.txHash || "").trim().toLowerCase())
                .filter(Boolean)
        );
        const swapTxHashSet = new Set(
            dedupRows
                .filter((tx) => tx.direction === "swap")
                .map((tx) => String(tx.txHash || "").trim().toLowerCase())
                .filter(Boolean)
        );
        return dedupRows.filter((tx) => {
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
    }, [txQuery.data]);
    const groupedTxs = useMemo(() => groupByDate(txs), [txs]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!target) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry?.isIntersecting) return;
                if (!txQuery.hasNextPage) return;
                if (txQuery.isFetchingNextPage) return;
                txQuery.fetchNextPage();
            },
            { root: null, rootMargin: "220px 0px 220px 0px", threshold: 0.1 }
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [txQuery.hasNextPage, txQuery.isFetchingNextPage, txQuery.fetchNextPage]);

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

    const toggleType = (typeKey: string) => {
        setSelectedTypes((prev) =>
            prev.includes(typeKey) ? prev.filter((item) => item !== typeKey) : [...prev, typeKey]
        );
    };

    const toggleCard = (cardId: string) => setSelectedCards([cardId]);

    const resetTypeFilter = () => setSelectedTypes([]);
    const resetDateFilter = () => {
        setFromDate("");
        setToDate("");
    };

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#fefcf7_48%,#f8fafc_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-8">
                <section className="flex items-center gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => router.back()}
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>Transaction History</h1>
                </section>

                <section className="mt-6 rounded-[1.6rem] border border-white/80 bg-white/92 p-3 shadow-[var(--shadow)]">
                    <div className="rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 py-2">
                        <select
                            value={scope}
                            onChange={(event) => applyScope(event.target.value as ScopeTab)}
                            className="h-8 w-full bg-transparent text-[0.95rem] font-medium text-slate-700 outline-none"
                        >
                            <option value="all">All</option>
                            <option value="vault">Vault</option>
                            <option value="card">Card</option>
                        </select>
                    </div>

                    <div className={`mt-3 grid gap-2 ${scope === "all" ? "grid-cols-3" : "grid-cols-2"}`}>
                        {(scope === "all" || scope === "card") ? (
                            <button
                                type="button"
                                onClick={() => setShowCardSheet(true)}
                                className="btn-theme-ghost flex h-8 items-center justify-center rounded-lg"
                            >
                                <CreditCard size={18} />
                            </button>
                        ) : null}

                        {scope !== "card" ? (
                            <button
                                type="button"
                                onClick={() => setShowTypeSheet(true)}
                                className="btn-theme-ghost flex h-8 items-center justify-center rounded-lg"
                            >
                                <SlidersHorizontal size={18} />
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={() => setShowDateSheet(true)}
                            className="btn-theme-ghost flex h-8 items-center justify-center rounded-lg"
                        >
                            <CalendarDays size={18} />
                        </button>
                    </div>
                </section>

                <section className="mt-6 rounded-[1.8rem] border border-white/80 bg-white/92 px-4 py-4 shadow-[var(--shadow)]">
                    {txQuery.isLoading ? (
                        <div className="py-8 text-center text-slate-500">Loading transactions...</div>
                    ) : groupedTxs.length ? (
                        <div className="space-y-5">
                            {groupedTxs.map(([dateLabel, list]) => (
                                <div key={dateLabel}>
                                    <p className="text-[0.95rem] text-slate-400 whitespace-nowrap">{dateLabel}</p>
                                    <div className="mt-3 space-y-1">
                                        {list.map((tx) => (
                                            <TxRow key={`${tx.id || tx.txHash}-${tx.timestamp || ""}`} tx={tx} />
                                        ))}
                                    </div>
                                    <div className="mt-3 border-b border-slate-100" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-slate-500">No transaction found</div>
                    )}

                    <div ref={loadMoreRef} className="h-4" />
                    {txQuery.isFetchingNextPage ? (
                        <div className="mt-4 text-center text-[0.9rem] text-slate-500">Loading more...</div>
                    ) : null}
                </section>
            </div>

            <SheetContainer open={showCardSheet} title="Cards" onClose={() => setShowCardSheet(false)}>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-slate-500">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Search..."
                            className="w-full border-0 bg-transparent text-slate-700 outline-none"
                        />
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    {cardOptions.length ? cardOptions.map((card) => {
                        const selected = selectedCards.includes(card.id);
                        return (
                            <button
                                key={card.id}
                                type="button"
                                onClick={() => toggleCard(card.id)}
                                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left ${selected ? "ui-state-selected" : "ui-state-unselected"
                                    }`}
                            >
                                <div className="min-w-0">
                                    <span className="block text-[1rem] text-slate-800">{card.label}</span>
                                    {card.owner ? <span className="block text-[0.86rem] text-slate-400">{card.owner}</span> : null}
                                </div>
                                {selected ? (
                                    <Check size={15} className="text-[#2f67d8]" />
                                ) : (
                                    <Circle size={15} className="text-slate-300" />
                                )}
                            </button>
                        );
                    }) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-[0.92rem] text-slate-500">
                            No card issued yet
                        </div>
                    )}
                </div>
            </SheetContainer>

            <SheetContainer open={showTypeSheet} title="Filter" onClose={() => setShowTypeSheet(false)}>
                <button
                    type="button"
                    onClick={resetTypeFilter}
                    className="btn-theme-secondary mb-3 px-3 py-0 text-[0.88rem]"
                >
                    Deselect All
                </button>
                <div className="space-y-2">
                    {availableTypeOptions.map((typeKey) => {
                        const checked = selectedTypes.includes(typeKey);
                        return (
                            <button
                                key={typeKey}
                                type="button"
                                onClick={() => toggleType(typeKey)}
                                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 ${checked ? "ui-state-selected" : "ui-state-unselected"
                                    }`}
                            >
                                <span className="text-[1.02rem] text-slate-800">{TYPE_LABELS[typeKey]}</span>
                                <span className="hidden">
                                    {checked ? "✓" : ""}
                                </span>
                                {checked ? (
                                    <Check size={15} className="text-[#2f67d8]" />
                                ) : (
                                    <Circle size={15} className="text-slate-300" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </SheetContainer>

            <SheetContainer open={showDateSheet} title="Date Range" onClose={() => setShowDateSheet(false)}>
                <div className="space-y-4">
                    <label className="block">
                        <span className="mb-1 block text-[0.92rem] text-slate-500">From</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(event) => {
                                const next = event.target.value;
                                setFromDate(next);
                                if (toDate && next && toDate < next) {
                                    setToDate("");
                                }
                            }}
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-800"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-[0.92rem] text-slate-500">To</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(event) => setToDate(event.target.value)}
                            min={fromDate || undefined}
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-800"
                        />
                    </label>
                    {invalidDateRange ? (
                        <p className="text-[0.82rem] text-rose-500">End date must be after start date</p>
                    ) : null}
                    <button
                        type="button"
                        onClick={resetDateFilter}
                        className="btn-theme-secondary h-8 w-full text-[0.9rem]"
                    >
                        Clear Date
                    </button>
                </div>
            </SheetContainer>
        </main>
    );
}
