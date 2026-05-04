"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUpDown, ArrowUpRight, CheckCircle2, ChevronDown, Circle, X } from "lucide-react";
import { executeSwap, getDashboardSummary, getSwapQuote } from "@/lib/api";
import { ProcessingLayer } from "@/components/processing-layer";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";
import { sanitizeDecimalInput, WALLET_TOKEN_OPTIONS, type WalletTokenKey } from "@/lib/domain-rules";

type TokenKey = WalletTokenKey;
const TOKEN_LIST = WALLET_TOKEN_OPTIONS;

function emitToast(message: string, tone: "success" | "error" = "success", durationMs = 5000) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, tone, durationMs } }));
}

function normalizeSymbol(value: unknown) {
    return String(value || "").trim().toUpperCase();
}

function normalizeNumericString(value: unknown) {
    return String(value ?? "0").replace(/,/g, "").trim();
}

function fmtBalance(value?: string) {
    const n = Number(normalizeNumericString(value || "0"));
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
}

export default function ConvertPage() {
    const router = useRouter();
    const { token, hydrated } = useAuthStore();
    const [fromToken, setFromToken] = useState<TokenKey | "">("");
    const [toToken, setToToken] = useState<TokenKey | "">("");
    const [amount, setAmount] = useState("");
    const [picker, setPicker] = useState<"from" | "to" | null>(null);
    const [showReview, setShowReview] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [swapResult, setSwapResult] = useState<null | {
        txHash: string;
        fromSymbol: string;
        toSymbol: string;
        fromAmount: string;
        toAmount: string;
        usdAmount: string;
    }>(null);

    const summaryQuery = useQuery({
        queryKey: ["dashboard-summary", token],
        enabled: Boolean(token),
        queryFn: getDashboardSummary
    });

    const quoteQuery = useQuery({
        queryKey: ["swap-quote", token, fromToken, toToken, amount],
        enabled: Boolean(token && fromToken && toToken && amount && Number(amount) > 0 && fromToken !== toToken),
        queryFn: () => getSwapQuote({ fromSymbol: fromToken as TokenKey, toSymbol: toToken as TokenKey, amount })
    });

    const swapMutation = useMutation({
        mutationFn: () => executeSwap({ fromSymbol: fromToken as TokenKey, toSymbol: toToken as TokenKey, amount }),
        onSuccess: (result) => {
            setShowReview(false);
            setSwapResult(result);
            emitToast("Converted successfully", "success", 5000);
            summaryQuery.refetch();
        },
        onError: (err: Error) => {
            emitToast(err.message || "Convert failed", "error", 5000);
        }
    });

    const assetMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const item of summaryQuery.data?.assets || []) {
            const symbolKey = normalizeSymbol(item.symbol);
            if (!symbolKey) continue;
            map[symbolKey] = normalizeNumericString(item.balance);
        }
        return map;
    }, [summaryQuery.data?.assets]);

    const fromConfig = TOKEN_LIST.find((item) => item.key === fromToken);
    const toConfig = TOKEN_LIST.find((item) => item.key === toToken);
    const quoteToAmount = quoteQuery.data?.toAmount || "0";
    const quoteUsd = quoteQuery.data?.usdAmount || "0.00";
    const fromBalance = fromToken ? assetMap[normalizeSymbol(fromToken)] || "0" : "0";
    const toBalance = toToken ? assetMap[normalizeSymbol(toToken)] || "0" : "0";
    const hasInsufficient = Boolean(fromToken && amount && Number(amount) > 0 && Number(fromBalance || "0") < Number(amount || "0"));
    const disableReason = !fromToken || !toToken
        ? "Select Token"
        : fromToken === toToken
            ? "Select Different Token"
            : !amount || Number(amount) <= 0
                ? "Enter Amount"
                : hasInsufficient
                    ? "Insufficient Balance"
                    : "Review";
    const canReview = disableReason === "Review" && !quoteQuery.isError;

    const handleFlipPair = () => {
        if (!fromToken && !toToken) return;
        const prevFrom = fromToken;
        const prevTo = toToken;
        setFromToken(prevTo as TokenKey | "");
        setToToken(prevFrom as TokenKey | "");
    };

    const handleConfirmConvert = async () => {
        if (swapMutation.isPending) return;
        setIsProcessing(true);
        try {
            await swapMutation.mutateAsync();
        } finally {
            setIsProcessing(false);
        }
    };

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

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <Link href="/dashboard" className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Convert</h1>
                </section>

                <section className="mt-6 space-y-3 rounded-[1.8rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)]">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                        <p className="text-[0.95rem] text-slate-500">From</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <input
                                value={amount}
                                onChange={(event) => setAmount(sanitizeDecimalInput(event.target.value, fromConfig?.decimals))}
                                inputMode="decimal"
                                placeholder="0"
                                className="w-full bg-transparent text-[2.3rem] font-medium leading-none text-slate-900 outline-none"
                            />
                            <button type="button" onClick={() => setPicker("from")} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-900">
                                {fromConfig ? <img src={fromConfig.iconUrl} alt={fromConfig.label} className="h-6 w-6 rounded-full object-cover" /> : null}
                                <span className="whitespace-nowrap text-[0.95rem] font-medium">{fromConfig?.label || "Select Token"}</span>
                                <ChevronDown size={16} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                            <p className="text-[0.92rem] text-slate-500">${fmtBalance(quoteUsd)}</p>
                            <div className="flex items-center gap-2">
                                <p className="text-[0.92rem] text-slate-500">Balance: {fmtBalance(fromBalance)}</p>
                                <button
                                    type="button"
                                    onClick={() => setAmount(fromBalance || "0")}
                                    className="btn-theme-primary h-7 rounded-lg border border-[#2f67d8] px-3 text-[0.86rem] text-white"
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleFlipPair}
                        className="mx-auto -my-1 mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-[#d8e6ff] bg-white text-[#3569d4]"
                        aria-label="Switch tokens"
                    >
                        <ArrowDown size={18} />
                    </button>

                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                        <p className="text-[0.95rem] text-slate-500">To</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="truncate text-[2.3rem] font-medium leading-none text-slate-900">{Number(quoteToAmount || "0") > 0 ? quoteToAmount : "0"}</p>
                            <button type="button" onClick={() => setPicker("to")} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-900">
                                {toConfig ? <img src={toConfig.iconUrl} alt={toConfig.label} className="h-6 w-6 rounded-full object-cover" /> : null}
                                <span className="whitespace-nowrap text-[0.95rem] font-medium">{toConfig?.label || "Select Token"}</span>
                                <ChevronDown size={16} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                            <p className="text-[0.92rem] text-slate-500">${fmtBalance(quoteUsd)}</p>
                            <p className="text-[0.92rem] text-slate-500">Balance: {fmtBalance(toBalance)}</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={!canReview}
                        onClick={() => setShowReview(true)}
                        className="btn-theme-primary h-9 w-full rounded-full border border-[#2f67d8] text-[0.95rem] font-medium text-white disabled:cursor-not-allowed disabled:opacity-55"
                    >
                        {disableReason}
                    </button>
                </section>
            </div>

            {picker ? (
                <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="w-9" />
                            <h3 className={`${TYPO.modalTitle}`}>Select Token</h3>
                            <button type="button" onClick={() => setPicker(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="space-y-2">
                            {TOKEN_LIST.map((tokenItem) => {
                                const selected = (picker === "from" ? fromToken : toToken) === tokenItem.key;
                                return (
                                    <button
                                        key={tokenItem.key}
                                        type="button"
                                        onClick={() => {
                                            if (picker === "from") setFromToken(tokenItem.key);
                                            if (picker === "to") setToToken(tokenItem.key);
                                            setPicker(null);
                                        }}
                                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 ${selected ? "ui-state-selected" : "ui-state-unselected"}`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <img src={tokenItem.iconUrl} alt={tokenItem.label} className="h-8 w-8 rounded-full object-cover" />
                                            <span className="text-[1rem] text-slate-900">{tokenItem.label}</span>
                                        </span>
                                        {selected ? <CheckCircle2 size={18} className="text-[#3569d4]" /> : <Circle size={18} className="text-slate-300" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : null}

            {showReview ? (
                <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="w-9" />
                            <h3 className={`${TYPO.modalTitle}`}>You&apos;re converting</h3>
                            <button type="button" onClick={() => setShowReview(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[1.2rem] text-slate-900">{amount || "0"} {fromToken}</p>
                                {fromConfig ? <img src={fromConfig.iconUrl} alt={fromConfig.label} className="h-10 w-10 rounded-full object-cover" /> : null}
                            </div>
                            <p className="mt-1 text-[0.95rem] text-slate-500">${fmtBalance(quoteUsd)}</p>
                            <ArrowUpDown size={18} className="my-4 text-slate-500" />
                            <div className="flex items-center justify-between">
                                <p className="text-[1.2rem] text-slate-900">{quoteToAmount || "0"} {toToken}</p>
                                {toConfig ? <img src={toConfig.iconUrl} alt={toConfig.label} className="h-10 w-10 rounded-full object-cover" /> : null}
                            </div>
                            <p className="mt-1 text-[0.95rem] text-slate-500">${fmtBalance(quoteUsd)}</p>
                        </div>
                        <button
                            type="button"
                            onClick={handleConfirmConvert}
                            disabled={swapMutation.isPending}
                            className="btn-theme-primary mt-4 h-9 w-full rounded-full text-[0.95rem] font-medium"
                        >
                            {swapMutation.isPending ? "Converting..." : "Convert"}
                        </button>
                        <button type="button" onClick={() => setShowReview(false)} className="btn-theme-secondary mt-3 h-9 w-full rounded-full border text-[0.95rem]">
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}

            {swapResult ? (
                <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="w-9" />
                            <h3 className={`${TYPO.modalTitle}`}>Converted</h3>
                            <button type="button" onClick={() => setSwapResult(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-center">
                            <p className="text-[1.22rem] text-slate-900">+ {swapResult.toAmount} {swapResult.toSymbol}</p>
                            <p className="mt-1 text-[0.95rem] text-slate-500">${fmtBalance(swapResult.usdAmount)}</p>
                            <CheckCircle2 size={32} className="mx-auto mt-3 text-emerald-500" />
                        </div>
                        <Link
                            href={`https://sepolia.etherscan.io/tx/${swapResult.txHash}`}
                            target="_blank"
                            className="btn-theme-secondary mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-full border text-[0.95rem] font-medium"
                        >
                            View On-Chain Transaction
                            <ArrowUpRight size={17} />
                        </Link>
                        <button type="button" onClick={() => { setSwapResult(null); router.push("/dashboard"); }} className="btn-theme-primary mt-3 h-9 w-full rounded-full text-[0.95rem] font-medium">
                            OK
                        </button>
                    </div>
                </div>
            ) : null}

            <ProcessingLayer open={isProcessing} text="processing..." zIndexClassName="z-[60]" />
        </main>
    );
}
