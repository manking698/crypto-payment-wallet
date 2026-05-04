"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getEarnHistory } from "@/lib/api";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

type TokenFilter = "ALL" | "USDT" | "USDC" | "WETH";
type KindFilter = "all" | "subscribe" | "redemption" | "rewards";

const TOKEN_FILTERS: TokenFilter[] = ["ALL", "USDT", "USDC", "WETH"];
const KIND_FILTERS: Array<{ key: KindFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "subscribe", label: "Subscribe" },
    { key: "redemption", label: "Redemption" },
    { key: "rewards", label: "Rewards" }
];

function formatMin2Max8Cut(value: string | number) {
    const raw = String(value ?? "0").trim();
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

function EarnHistoryPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { token, hydrated } = useAuthStore();
    const initialToken = String(searchParams.get("token") || "ALL").toUpperCase();
    const [tokenFilter, setTokenFilter] = useState<TokenFilter>(TOKEN_FILTERS.includes(initialToken as TokenFilter) ? (initialToken as TokenFilter) : "ALL");
    const [kindFilter, setKindFilter] = useState<KindFilter>("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const invalidDateRange = Boolean(fromDate && toDate && toDate < fromDate);

    const historyQuery = useQuery({
        queryKey: ["earn-history-page", token, tokenFilter, kindFilter, fromDate, toDate],
        enabled: Boolean(token),
        queryFn: () => getEarnHistory({
            token: tokenFilter,
            kind: kindFilter,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            limit: 100,
            page: 1
        })
    });

    const rows = useMemo(() => historyQuery.data?.records || [], [historyQuery.data?.records]);

    if (!hydrated) return null;
    if (!token) {
        router.replace("/login");
        return null;
    }

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <Link href="/earn" className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Earn History</h1>
                </section>

                <section className="mt-6 rounded-[1.6rem] border border-white/80 bg-white/92 p-3 shadow-[var(--shadow)]">
                    <div>
                        <select
                            value={kindFilter}
                            onChange={(event) => setKindFilter(event.target.value as KindFilter)}
                            className="h-10 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-[0.84rem] text-slate-700 outline-none"
                        >
                            {KIND_FILTERS.map((item) => (
                                <option key={item.key} value={item.key}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="mt-3">
                        <select
                            value={tokenFilter}
                            onChange={(event) => setTokenFilter(event.target.value as TokenFilter)}
                            className="h-10 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-[0.84rem] text-slate-700 outline-none"
                        >
                            {TOKEN_FILTERS.map((tk) => (
                                <option key={tk} value={tk}>
                                    {tk === "ALL" ? "All assets" : tk}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
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
                            className="h-10 rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-[0.84rem] text-slate-700 outline-none"
                        />
                        <input
                            type="date"
                            value={toDate}
                            onChange={(event) => setToDate(event.target.value)}
                            min={fromDate || undefined}
                            className="h-10 rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-[0.84rem] text-slate-700 outline-none"
                        />
                    </div>
                    {invalidDateRange ? (
                        <p className="mt-2 text-[0.78rem] text-rose-500">End date must be after start date</p>
                    ) : null}
                </section>

                <section className="mt-4 rounded-[1.8rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)]">
                    {rows.length ? (
                        <div className="space-y-2">
                            {rows.map((row) => {
                                const canOpenDetail = Boolean(row.id);
                                const content = (
                                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="text-[0.9rem] font-semibold text-slate-900">{row.token}</p>
                                                <p className="text-[0.8rem] text-slate-500">{row.kind}</p>
                                            </div>
                                            <p className="text-[0.92rem] font-semibold text-slate-900">{formatMin2Max8Cut(row.amount)}</p>
                                        </div>
                                        <div className="mt-0.5 flex items-center justify-between text-[0.78rem] text-slate-500">
                                            <p>{row.timestamp ? new Date(row.timestamp).toLocaleString() : "-"}</p>
                                            <p className="uppercase">{row.status || "COMPLETED"}</p>
                                        </div>
                                    </div>
                                );
                                if (canOpenDetail) {
                                    return (
                                        <Link key={row.id} href={`/transactions/${row.id}`} className="block">
                                            {content}
                                        </Link>
                                    );
                                }
                                return <div key={row.id || `${row.token}-${row.timestamp || "unknown"}`}>{content}</div>;
                            })}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-[0.9rem] text-slate-500">
                            No records found
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

export default function EarnHistoryPage() {
    return (
        <Suspense fallback={null}>
            <EarnHistoryPageContent />
        </Suspense>
    );
}
