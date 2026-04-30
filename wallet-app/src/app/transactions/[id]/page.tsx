"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, CreditCard, Plus, RefreshCw } from "lucide-react";
import { getTransactionDetail } from "@/lib/api";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

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

function shortAddress(addr: string) {
    if (!addr) return "-";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

function toFixed2(input?: string | null) {
    const n = Number(String(input || "").replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(2);
}

function getExplorerBase(chainId?: number, sourceLink?: string) {
    const byChain: Record<number, string> = {
        11155111: "https://sepolia.etherscan.io",
        534351: "https://sepolia.scrollscan.com",
        11155420: "https://sepolia-optimism.etherscan.io",
        421614: "https://sepolia.arbiscan.io",
        84532: "https://sepolia.basescan.org"
    };
    const byId = chainId ? byChain[Number(chainId)] : "";
    if (byId) return byId;
    const link = String(sourceLink || "");
    const idx = link.indexOf("/tx/");
    return idx > 0 ? link.slice(0, idx) : "";
}

export default function TransactionDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { token, hydrated } = useAuthStore();
    const txId = String(params?.id || "");

    const detailQuery = useQuery({
        queryKey: ["transaction-detail", txId, token],
        enabled: Boolean(token && txId),
        queryFn: () => getTransactionDetail(txId)
    });

    const tx = detailQuery.data?.transaction;
    const direction = tx?.direction || "";
    const isAddedFunds = direction === "in";
    const isWithdraw = direction === "out";
    const isCard = direction === "card-payment";
    const isEarn = direction === "earn-subscribe" || direction === "earn-redemption" || direction === "earn-reward";
    const isSwap = !isAddedFunds && !isWithdraw && !isCard && !isEarn;
    const symbol = tx?.tokenSymbol || "USDT";
    const amount = tx?.amount || "0.00";

    const headerTitle = useMemo(() => {
        if (isAddedFunds) return "Added Funds";
        if (isWithdraw) return "Withdraw";
        if (direction === "earn-subscribe") return "Earn Deposit";
        if (direction === "earn-reward") return "Earn Reward";
        if (direction === "earn-redemption") return "Earn Redemption";
        if (isEarn) return "Earn";
        if (isSwap) return "Swap";
        return "Card Payment";
    }, [isAddedFunds, isWithdraw, isEarn, isSwap, direction]);

    const normalizedStatus = tx?.normalizedStatus || "FAILED";
    const statusColor = normalizedStatus === "COMPLETED" ? "text-emerald-500" : normalizedStatus === "PENDING" ? "text-amber-500" : "text-red-500";
    const displayStatus = isCard && normalizedStatus === "COMPLETED" ? "CLEARED" : normalizedStatus;
    const deductedTokens = Array.isArray(tx?.cardPayment?.deductedTokens)
        ? tx.cardPayment.deductedTokens
        : [];
    const onChainRecords = useMemo(() => {
        const base = getExplorerBase(tx?.chainId, tx?.sourceLink);
        if (isCard && deductedTokens.length) {
            const seen = new Set<string>();
            const rows = deductedTokens
                .map((item) => {
                    const hash = String(item?.txHash || "").trim();
                    const symbol = String(item?.tokenSymbol || "").trim().toUpperCase();
                    if (!hash) return null;
                    const key = `${hash.toLowerCase()}|${symbol}`;
                    if (seen.has(key)) return null;
                    seen.add(key);
                    return {
                        hash,
                        short: shortAddress(hash),
                        symbol,
                        href: base ? `${base}/tx/${hash}` : ""
                    };
                })
                .filter(Boolean) as Array<{ hash: string; short: string; symbol: string; href: string }>;
            if (rows.length) return rows;
        }

        const fallbackHash = String(tx?.txHash || "").trim();
        if (!fallbackHash) return [];
        return [{
            hash: fallbackHash,
            short: shortAddress(fallbackHash),
            symbol: String(tx?.tokenSymbol || "").toUpperCase(),
            href: String(tx?.sourceLink || (base ? `${base}/tx/${fallbackHash}` : ""))
        }];
    }, [tx?.chainId, tx?.sourceLink, tx?.txHash, tx?.tokenSymbol, isCard, deductedTokens]);
    const vaultEarnAddress = String(
        (tx as Record<string, unknown>)?.vaultEarnAddress ||
        process.env.NEXT_PUBLIC_EARN_CONTRACT_ADDRESS ||
        ""
    ).trim();
    const rewardFromAddress = (direction === "earn-reward" || direction === "earn-redemption")
        ? (vaultEarnAddress || String(tx?.from || ""))
        : String(tx?.origSender || tx?.from || "");
    const swapFromSymbol = String((tx as Record<string, unknown>)?.swapFromSymbol || "USDT").toUpperCase();
    const swapToSymbol = String((tx as Record<string, unknown>)?.swapToSymbol || symbol || "USDT").toUpperCase();
    const amountDisplay = formatAmountForTx(amount, 8);
    const rawSwapFromAmount = String((tx as Record<string, unknown>)?.swapFromAmount || tx?.amount || "0");
    const rawSwapToAmount = String((tx as Record<string, unknown>)?.swapToAmount || tx?.amount || "0");
    const swapFromAmount = `-${formatAmountForTx(rawSwapFromAmount, 8)}`;
    const swapToAmount = `+${formatAmountForTx(rawSwapToAmount, 8)}`;

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
            <div className="mx-auto w-full max-w-md pb-8">
                <section className="flex items-center gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => router.back()}
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>Transaction Details</h1>
                </section>

                <section className="mt-6 rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-6 shadow-[var(--shadow)]">
                    {detailQuery.isLoading ? (
                        <div className="py-8 text-center text-slate-500">Loading transaction detail...</div>
                    ) : !tx ? (
                        <div className="py-8 text-center text-slate-500">Transaction not found.</div>
                    ) : (
                        <>
                            <div className="flex flex-col items-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#edf3ff] text-[#3569d4]">
                                    {isAddedFunds ? <Plus size={26} /> : isWithdraw ? <ArrowUpRight size={26} /> : isSwap ? <RefreshCw size={26} /> : isEarn ? <Plus size={26} /> : <CreditCard size={26} />}
                                </div>
                                <p className={`${TYPO.sectionTitle} mt-3 text-[#3569d4]`}>{headerTitle}</p>
                                {isCard ? (
                                    <>
                                        <p className="mt-2 text-[2.2rem] font-medium tracking-[-0.02em] text-slate-950">
                                            {tx.amountPrimary || "MYR 0.00"}
                                        </p>
                                        <p className="mt-1 text-[1.02rem] text-slate-500">{tx.amountSecondary || "- $0.00 USD"}</p>
                                    </>
                                ) : isSwap ? (
                                    <>
                                        <p className="mt-2 text-[2.2rem] font-medium tracking-[-0.02em] text-slate-950">
                                            {`${formatAmountForTx(rawSwapFromAmount, 8)} ${swapFromSymbol}`}
                                        </p>
                                    </>
                                ) : isEarn ? (
                                    <>
                                        <p className="mt-2 text-[2.2rem] font-medium tracking-[-0.02em] text-slate-950">
                                            {`${amountDisplay} ${symbol}`}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="mt-2 text-[2.2rem] font-medium tracking-[-0.02em] text-slate-950">
                                            {`${amountDisplay} ${symbol}`}
                                        </p>
                                    </>
                                )}
                                <p className={`mt-2 text-[1.1rem] font-medium ${statusColor}`}>{displayStatus}</p>
                                <p className="mt-3 text-[0.95rem] text-slate-500">{formatDateTime(tx.timestamp)}</p>
                            </div>

                            <div className="mt-6 border-t border-slate-100 pt-5">
                                {isCard ? (
                                    <div className="space-y-5">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Merchant</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">{tx.title || "Card payment"}</p>
                                            </div>
                                            <p className="text-right text-[1.05rem] font-medium text-slate-900">{tx.merchant || "Card Payment"}</p>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Paid by</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">From: {shortAddress(tx.origSender || tx.from || "")}</p>
                                            </div>
                                            <p className="text-[1.05rem] font-medium text-slate-900">
                                                - ${toFixed2(tx.cardPayment?.usdAmount || tx.amountSecondary?.replace(/[^\d.]/g, "") || "0")}
                                            </p>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Currency</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">Location: {tx.country || "-"}</p>
                                            </div>
                                            <p className="text-[1.05rem] font-medium text-slate-900">{tx.amountPrimary || "MYR 0.00"}</p>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Card number</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">VISA</p>
                                            </div>
                                            <p className="flex items-center gap-1 text-[1.05rem] font-medium text-slate-900">
                                                <CreditCard size={16} className="text-slate-500" />
                                                {`** ${tx.cardPayment?.cardLast4 || tx.cardLast4 || "----"}`}
                                            </p>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Transaction ID</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">Card settlement</p>
                                            </div>
                                            <p className="max-w-[60%] break-all text-right text-[0.92rem] text-slate-900">{tx.id || "-"}</p>
                                        </div>
                                        {deductedTokens.length ? (
                                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                                                <p className="text-[0.92rem] font-medium text-slate-700">Deducted assets</p>
                                                <div className="mt-2 space-y-1.5">
                                                    {deductedTokens.map((item, index) => (
                                                        <div key={`${item.txHash || "tx"}-${item.tokenSymbol || "token"}-${index}`} className="flex items-start justify-between gap-3">
                                                            <p className="text-[0.9rem] text-slate-600">{item.tokenSymbol || "-"}</p>
                                                            <p className="text-right text-[0.9rem] text-slate-900">
                                                                {item.tokenAmount || "0"} {item.tokenSymbol || ""}
                                                                {item.usdAmount ? (
                                                                    <span className="ml-1 text-slate-500">(${item.usdAmount})</span>
                                                                ) : null}
                                                            </p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : isSwap ? (
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#edf3ff] text-[0.72rem] font-semibold text-[#3569d4]">
                                                    {swapFromSymbol.slice(0, 2)}
                                                </div>
                                                <span className="text-[1.18rem] text-slate-900">{swapFromSymbol}</span>
                                            </div>
                                            <span className="text-[1.28rem] font-medium text-slate-900">{swapFromAmount}</span>
                                        </div>
                                        <p className="text-center text-[1.05rem] text-slate-500">converted to</p>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#edf3ff] text-[0.72rem] font-semibold text-[#3569d4]">
                                                    {swapToSymbol.slice(0, 2)}
                                                </div>
                                                <span className="text-[1.18rem] text-slate-900">{swapToSymbol}</span>
                                            </div>
                                            <span className="text-[1.28rem] font-medium text-slate-900">{swapToAmount}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Sent</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">From: {shortAddress(rewardFromAddress)}</p>
                                            </div>
                                            <p className="text-[1.05rem] font-medium text-slate-900">{amountDisplay} {symbol}</p>
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[0.98rem] text-slate-900">Received</p>
                                                <p className="mt-1 text-[0.86rem] text-slate-500">To: {shortAddress(tx.to || "")}</p>
                                            </div>
                                            <p className="text-[1.05rem] font-medium text-slate-900">{amountDisplay} {symbol}</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 border-t border-slate-100 pt-6">
                                <div className="mb-4 space-y-2">
                                    <p className="text-[1.02rem] text-[#3569d4]">On-chain details</p>
                                    {onChainRecords.map((row) => (
                                        <div key={`${row.hash}-${row.symbol}`} className="flex items-center justify-between rounded-xl border border-[#d8e6ff] bg-[#f3f8ff] px-3 py-2">
                                            <span className="text-[0.95rem] text-slate-500">Spend transaction{row.symbol ? ` (${row.symbol})` : ""}</span>
                                            <span className="text-[0.95rem] text-[#3569d4]">{row.short}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    {onChainRecords.map((row) => (
                                        row.href ? (
                                            <Link
                                                key={`view-${row.hash}-${row.symbol}`}
                                                href={row.href}
                                                target="_blank"
                                                className="btn-theme-primary flex h-9 w-full items-center justify-center gap-2 px-4 text-[0.92rem]"
                                            >
                                                {onChainRecords.length > 1
                                                    ? `View On-Chain Transaction (${row.symbol || "TX"})`
                                                    : "View On-Chain Transaction"}
                                                <ArrowUpRight size={18} />
                                            </Link>
                                        ) : null
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </main>
    );
}
