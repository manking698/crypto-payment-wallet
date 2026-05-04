"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, WalletCards } from "lucide-react";
import { getEarnSummary } from "@/lib/api";
import type { EarnTokenSymbol } from "@/lib/types";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

const TOKENS: EarnTokenSymbol[] = ["USDT", "USDC", "WETH"];
const BALANCE_MASK_STORAGE_KEY = "wallet.mask_total_balance";

function fmt(value: string | number, fixed = 2) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(fixed);
}

function tokenDisplayDecimals(token: EarnTokenSymbol) {
    // USDT/USDC show 6 decimals, WETH total rewards show 12 decimals for readability.
    return token === "WETH" ? 12 : 6;
}

export default function EarnPage() {
    const router = useRouter();
    const { token, hydrated } = useAuthStore();
    const [maskTotalValue, setMaskTotalValue] = useState(false);
    const [maskReady, setMaskReady] = useState(false);

    const summaryQuery = useQuery({
        queryKey: ["earn-summary", token],
        enabled: Boolean(token),
        queryFn: getEarnSummary
    });

    const pools = summaryQuery.data?.pools || [];
    const estTotal = useMemo(() => {
        const apiTotal = Number(summaryQuery.data?.totalEstimatedUsd || 0);
        if (Number.isFinite(apiTotal) && apiTotal > 0) return apiTotal;
        const sum = pools.reduce((acc, pool) => {
            const v = Number(pool?.estimatedValueUsd || 0);
            return acc + (Number.isFinite(v) ? v : 0);
        }, 0);
        return Number.isFinite(sum) ? sum : 0;
    }, [pools, summaryQuery.data?.totalEstimatedUsd]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const saved = window.localStorage.getItem(BALANCE_MASK_STORAGE_KEY);
        setMaskTotalValue(saved === "1");
        setMaskReady(true);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!maskReady) return;
        window.localStorage.setItem(BALANCE_MASK_STORAGE_KEY, maskTotalValue ? "1" : "0");
    }, [maskTotalValue, maskReady]);

    if (!hydrated) return null;
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
                    <h1 className={`${TYPO.pageTitle}`}>Earn</h1>
                    <Link href="/earn/history" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-[#d8e6ff] bg-white text-[#3569d4]">
                        <WalletCards size={18} />
                    </Link>
                </section>

                <section className="mt-6 rounded-[1.8rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)]">
                    <div className="flex items-center gap-2 text-[0.92rem] text-slate-500">
                        Est. total value
                        <button
                            type="button"
                            onClick={() => setMaskTotalValue((prev) => !prev)}
                            className="inline-flex items-center justify-center rounded-full text-slate-500"
                            aria-label={maskTotalValue ? "Show estimated total value" : "Hide estimated total value"}
                        >
                            {maskTotalValue ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                    </div>
                    <p className="mt-2 text-[2.6rem] font-semibold leading-none text-slate-900">
                        {maskTotalValue ? "****" : fmt(estTotal, 2)} <span className="text-[1.2rem]">USDT</span>
                    </p>
                </section>

                <section className="mt-4 space-y-3">
                    {TOKENS.map((tk) => {
                        const pool = pools.find((p) => p.token === tk);
                        const amountFixed = tk === "WETH" ? 3 : 2;
                        const rewardFixed = tokenDisplayDecimals(tk);
                        return (
                            <Link
                                key={tk}
                                href={`/earn/subscribe/${tk}`}
                                className="block rounded-[1.5rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)] transition hover:bg-white"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[1.15rem] font-semibold text-slate-900">{tk}</p>
                                        <p className="mt-0.5 text-[0.96rem] text-emerald-500">APY {Number(pool?.apy || 0).toFixed(2)}%</p>
                                    </div>
                                    <span className="btn-theme-primary inline-flex h-9 items-center gap-1.5 px-4 text-[0.9rem]">
                                        View <ArrowUpRight size={14} />
                                    </span>
                                </div>
                                <div className="mt-3 grid grid-cols-20 gap-2 border-t border-slate-100 pt-3">
                                    <div className="col-span-9 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                                        <p className="text-[0.78rem] text-slate-500">Stake amount</p>
                                        <p className="mt-1 text-[1.05rem] font-semibold text-slate-900">{fmt(pool?.subscribedBalance || 0, amountFixed)}</p>
                                    </div>
                                    <div className="col-span-11 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                                        <p className="text-[0.78rem] text-slate-500">Total rewards</p>
                                        <p className="mt-1 text-[1.05rem] font-semibold text-slate-900">{fmt(pool?.totalRewards || 0, rewardFixed)}</p>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </section>

                <section className="mt-4 rounded-[1.2rem] border border-white/80 bg-white/92 px-4 py-3 shadow-[var(--shadow)]">
                    <p className="text-[0.9rem] text-slate-500">
                        Hourly earnings, settled hourly, always available and easy redeem balance anytime
                    </p>
                </section>
            </div>
        </main>
    );
}
