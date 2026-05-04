"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, CheckCircle2, History, X } from "lucide-react";
import { claimEarnReward, getEarnSummary, redeemEarn, subscribeEarn } from "@/lib/api";
import { ProcessingLayer } from "@/components/processing-layer";
import type { EarnTokenSymbol } from "@/lib/types";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

const MIN_SUB: Record<EarnTokenSymbol, number> = { USDT: 10, USDC: 10, WETH: 0.005 };
const INPUT_DEC: Record<EarnTokenSymbol, number> = { USDT: 2, USDC: 2, WETH: 3 };

function sanitize(input: string, maxDecimals: number) {
    const cleaned = String(input || "").replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const dot = cleaned.indexOf(".");
    if (dot < 0) return cleaned;
    return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, maxDecimals)}`;
}

function fmt(value: string | number, fixed = 2) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0.00";
    return n.toFixed(fixed);
}

function decimalsByToken(token: EarnTokenSymbol) {
    return token === "WETH" ? 8 : 6;
}

function formatTokenAmount(value: string | number, token: EarnTokenSymbol) {
    const decimals = decimalsByToken(token);
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return `0.${"0".repeat(decimals)}`;

    // Convert scientific notation to plain decimal safely for small numbers.
    const plain = numeric.toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 20
    });

    const negative = plain.startsWith("-");
    const unsigned = negative ? plain.slice(1) : plain;
    const [intPartRaw, fracRaw = ""] = unsigned.split(".");
    const intPart = (intPartRaw || "0").replace(/[^\d]/g, "") || "0";
    const frac = fracRaw.replace(/[^\d]/g, "").slice(0, decimals).padEnd(decimals, "0");
    return `${negative ? "-" : ""}${intPart}.${frac}`;
}

function toScaledInt(value: string, decimals: number): bigint {
    const text = String(value || "0").trim();
    if (!text) return BigInt(0);
    const [intPartRaw, fracRaw = ""] = text.split(".");
    const intPart = (intPartRaw || "0").replace(/[^\d]/g, "") || "0";
    const frac = fracRaw.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
    return BigInt(intPart) * (BigInt(10) ** BigInt(decimals)) + BigInt(frac || "0");
}

function truncateDown(value: string | number, decimals: number) {
    const text = String(value || "0").trim();
    if (!text) return `0.${"0".repeat(decimals)}`;
    const [intPartRaw, fracRaw = ""] = text.split(".");
    const intPart = (intPartRaw || "0").replace(/[^\d-]/g, "") || "0";
    const frac = fracRaw.replace(/[^\d]/g, "").slice(0, decimals).padEnd(decimals, "0");
    return `${intPart}.${frac}`;
}

export default function EarnSubscribePage() {
    const params = useParams<{ token: string }>();
    const router = useRouter();
    const queryClient = useQueryClient();
    const { token, hydrated } = useAuthStore();

    const selected = String(params?.token || "").toUpperCase();
    const selectedToken: EarnTokenSymbol = selected === "USDC" || selected === "WETH" ? selected : "USDT";
    const [amount, setAmount] = useState("");
    const [confirmSheet, setConfirmSheet] = useState<null | {
        action: "subscribe" | "redeem" | "claim";
        amount?: string;
    }>(null);
    const [successSheet, setSuccessSheet] = useState<null | {
        action: "subscribe" | "redeem" | "claim";
        amount: string;
        txHash: string;
    }>(null);

    const summaryQuery = useQuery({
        queryKey: ["earn-summary", token],
        enabled: Boolean(token),
        queryFn: getEarnSummary
    });

    const pool = summaryQuery.data?.pools?.find((p) => p.token === selectedToken);
    const apy = Number(pool?.apy || 0);
    const min = Number(pool?.minSubscription || MIN_SUB[selectedToken]);
    const maxDecimals = INPUT_DEC[selectedToken];
    const amountNum = Number(amount || 0);
    const estHourly = amountNum > 0 ? amountNum * apy / 100 / 365 / 24 : 0;
    const fixed = selectedToken === "WETH" ? 3 : 2;
    const availableRaw = String(pool?.walletBalance || "0");
    const available = Number(availableRaw || 0);
    const availableScaled = toScaledInt(availableRaw, maxDecimals);
    const subscribedRaw = String(pool?.subscribedBalance || "0");
    const subscribedScaled = toScaledInt(subscribedRaw, maxDecimals);
    const defaultRedeemAmount = truncateDown(subscribedRaw, fixed);
    const activeSubscribed = Number(pool?.subscribedBalance || 0) > 0;

    const baseAmountError = useMemo(() => {
        if (!amount) return "";
        if (!/^\d+(\.\d+)?$/.test(amount)) return "Invalid amount format";
        const decimals = (amount.split(".")[1] || "").length;
        if (decimals > maxDecimals) return `Max ${maxDecimals} decimals allowed`;
        return "";
    }, [amount, maxDecimals]);

    const subscribeError = useMemo(() => {
        if (baseAmountError) return baseAmountError;
        if (!amount) return "";
        if (amountNum < min) return `The minimum subscription amount is ${min} ${selectedToken}`;
        if (toScaledInt(amount, maxDecimals) > availableScaled) return "Insufficient balance";
        return "";
    }, [baseAmountError, amount, amountNum, min, selectedToken, maxDecimals, availableScaled]);

    const redeemError = useMemo(() => {
        if (baseAmountError) return baseAmountError;
        if (!amount) return "";
        if (toScaledInt(amount, maxDecimals) > subscribedScaled) return "Insufficient subscribed balance";
        return "";
    }, [baseAmountError, amount, maxDecimals, subscribedScaled]);

    const subscribeMutation = useMutation({
        mutationFn: subscribeEarn,
        onSuccess: (result) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: "Subscribed successfully", durationMs: 5000 } }));
            setAmount("");
            queryClient.invalidateQueries({ queryKey: ["earn-summary"] });
            setSuccessSheet({
                action: "subscribe",
                amount: String(result.amount || "0"),
                txHash: String(result.txHash || "")
            });
        },
        onError: (err: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: err.message || "Subscribe failed", tone: "error", durationMs: 5000 } }));
        }
    });
    const redeemMutation = useMutation({
        mutationFn: redeemEarn,
        onSuccess: (result) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: "Redeemed successfully", durationMs: 5000 } }));
            setAmount("");
            queryClient.invalidateQueries({ queryKey: ["earn-summary"] });
            setSuccessSheet({
                action: "redeem",
                amount: String(result.amount || "0"),
                txHash: String(result.txHash || "")
            });
        },
        onError: (err: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: err.message || "Redemption failed", tone: "error", durationMs: 5000 } }));
        }
    });
    const claimMutation = useMutation({
        mutationFn: claimEarnReward,
        onSuccess: (result) => {
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message: "Rewards claimed successfully", durationMs: 5000 } }));
            queryClient.invalidateQueries({ queryKey: ["earn-summary"] });
            setSuccessSheet({
                action: "claim",
                amount: String(result.amount || "0"),
                txHash: String(result.txHash || "")
            });
        },
        onError: (err: Error) => {
            const raw = String(err.message || "");
            const normalized = raw.toLowerCase();
            const message = normalized.includes("no rewards") || normalized.includes("execution reverted")
                ? "no matured rewards yet"
                : (raw || "Claim failed");
            window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, tone: "error", durationMs: 5000 } }));
        }
    });
    const isProcessing = subscribeMutation.isPending || redeemMutation.isPending || claimMutation.isPending;

    if (!hydrated) return null;
    if (!token) {
        router.replace("/login");
        return null;
    }

    const openConfirm = (action: "subscribe" | "redeem" | "claim") => {
        if (action === "claim") {
            setConfirmSheet({ action });
            return;
        }
        if (action === "subscribe") {
            if (!amount || subscribeError) return;
            setConfirmSheet({ action, amount });
            return;
        }
        const redeemAmount = amount || defaultRedeemAmount;
        if (!redeemAmount) return;
        if (toScaledInt(redeemAmount, maxDecimals) <= BigInt(0)) return;
        if (amount && redeemError) return;
        setConfirmSheet({ action, amount: redeemAmount });
    };

    const submitConfirm = () => {
        if (!confirmSheet) return;
        if (confirmSheet.action === "subscribe") {
            subscribeMutation.mutate({ token: selectedToken, amount: String(confirmSheet.amount || amount) });
        } else if (confirmSheet.action === "redeem") {
            redeemMutation.mutate({ token: selectedToken, amount: String(confirmSheet.amount || defaultRedeemAmount) });
        } else {
            claimMutation.mutate({ token: selectedToken });
        }
        setConfirmSheet(null);
    };

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <Link href="/earn" className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>{selectedToken} Subscribe</h1>
                    <Link href={`/earn/history?token=${selectedToken}`} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border border-[#d8e6ff] bg-white text-[#3569d4]">
                        <History size={18} />
                    </Link>
                </section>

                <section className="mt-4 rounded-[1.2rem] border border-[#ced8e8] bg-white px-4 py-3">
                    <p className="text-[0.86rem] text-slate-500">7-Day APY</p>
                    <p className="text-[1.6rem] font-semibold text-emerald-500">{apy.toFixed(2)}%</p>
                </section>

                <section className="mt-4 rounded-[1.6rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)]">
                    <p className="text-[1.4rem] font-semibold text-slate-900">Amount</p>
                    <div className="mt-2 flex items-center gap-2">
                        <input
                            value={amount}
                            onChange={(event) => setAmount(sanitize(event.target.value, maxDecimals))}
                            placeholder="0"
                            inputMode="decimal"
                            className="h-14 flex-1 rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-[1.8rem] font-semibold text-slate-900 outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => setAmount(truncateDown(availableRaw, fixed))}
                            className="btn-theme-primary h-10 px-4"
                        >
                            Max
                        </button>
                    </div>

                    {subscribeError ? (
                        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[0.9rem] text-red-600">{subscribeError}</div>
                    ) : null}

                    <p className="mt-3 text-[0.92rem] text-slate-500">Available funds {truncateDown(availableRaw, fixed)} {selectedToken}</p>
                    <div className="mt-3 flex items-center justify-between text-[0.95rem]">
                        <p className="text-slate-500">Estimated hourly earnings</p>
                        <p className="font-semibold text-emerald-500">{formatTokenAmount(estHourly, selectedToken)} {selectedToken}</p>
                    </div>
                    <p className="mt-3 text-[0.86rem] text-slate-500">
                        Redeem uses the same amount input. You can partially redeem by entering amount. Leave amount empty to redeem full subscribed balance.
                    </p>
                </section>

                <section className="mt-4 rounded-[1.6rem] border border-white/80 bg-white/92 p-4 shadow-[var(--shadow)]">
                    <h2 className="text-[1.2rem] font-semibold text-slate-900">Product Rules</h2>
                    <div className="mt-3 border-t border-slate-100 pt-3 text-[0.92rem] text-slate-600">
                        <p className="font-semibold text-slate-800">Earnings accrual and distribution</p>
                        <ul className="mt-2 space-y-1">
                            <li>Subscription time: Now</li>
                            <li>Accrual start time: immediately after subscription confirmation</li>
                            <li>Earnings distribution: when claim is submitted and confirmed</li>
                        </ul>
                        <p className="mt-3">Rewards accumulate on-chain and stay claimable anytime</p>
                    </div>
                    <div className="mt-4 border-t border-slate-100 pt-3 text-[0.92rem] text-slate-600">
                        <p className="font-semibold text-slate-800">Redemptions</p>
                        <p className="mt-2">You can subscribe or redeem assets anytime. Redemption is processed immediately and returned to your vault balance</p>
                    </div>
                </section>

                <div className={`mt-4 grid gap-2 ${activeSubscribed ? "grid-cols-3" : "grid-cols-1"}`}>
                    <button
                        type="button"
                        disabled={!amount || Boolean(subscribeError) || subscribeMutation.isPending}
                        onClick={() => openConfirm("subscribe")}
                        className={`btn-theme-primary h-10 ${!amount || Boolean(subscribeError) || subscribeMutation.isPending ? "ui-state-disabled" : ""}`}
                    >
                        {subscribeMutation.isPending ? "Processing..." : "Subscribe"}
                    </button>
                    {activeSubscribed ? (
                        <button
                            type="button"
                            disabled={(subscribedScaled <= BigInt(0)) || (Boolean(amount) && Boolean(redeemError)) || redeemMutation.isPending}
                            onClick={() => {
                                const redeemAmount = amount || defaultRedeemAmount;
                                if (!redeemAmount || toScaledInt(redeemAmount, maxDecimals) <= BigInt(0)) return;
                                openConfirm("redeem");
                            }}
                            className={`btn-theme-secondary h-10 ${(subscribedScaled <= BigInt(0)) || (Boolean(amount) && Boolean(redeemError)) || redeemMutation.isPending ? "ui-state-disabled" : ""}`}
                        >
                            {redeemMutation.isPending ? "Processing..." : "Redeem"}
                        </button>
                    ) : null}
                    {activeSubscribed ? (
                        <button
                            type="button"
                            disabled={claimMutation.isPending}
                            onClick={() => openConfirm("claim")}
                            className={`btn-theme-secondary h-10 ${claimMutation.isPending ? "ui-state-disabled" : ""}`}
                        >
                            {claimMutation.isPending ? "Processing..." : "Claim"}
                        </button>
                    ) : null}
                </div>
            </div>

            {confirmSheet ? (
                <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="w-9" />
                            <h3 className={`${TYPO.modalTitle}`}>Confirm Action</h3>
                            <button
                                type="button"
                                onClick={() => setConfirmSheet(null)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[0.92rem] text-slate-700">
                            <p>
                                Action:{" "}
                                <span className="font-semibold text-slate-900">
                                    {confirmSheet.action === "subscribe" ? "Subscribe" : confirmSheet.action === "redeem" ? "Redeem" : "Claim Reward"}
                                </span>
                            </p>
                            <p className="mt-1">Token: <span className="font-semibold text-slate-900">{selectedToken}</span></p>
                            {confirmSheet.action !== "claim" ? (
                                <p className="mt-1">Amount: <span className="font-semibold text-slate-900">{confirmSheet.amount} {selectedToken}</span></p>
                            ) : null}
                            {confirmSheet.action === "redeem" && !amount ? (
                                <p className="mt-2 text-[0.84rem] text-slate-500">No amount entered, full subscribed balance will be redeemed</p>
                            ) : null}
                            {confirmSheet.action === "redeem" && amount ? (
                                <p className="mt-2 text-[0.84rem] text-slate-500">Partial redeem based on current amount input</p>
                            ) : null}
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setConfirmSheet(null)} className="btn-theme-secondary h-10">
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitConfirm}
                                className="btn-theme-primary h-10"
                            >
                                Submit
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {successSheet ? (
                <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-5 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="w-9" />
                            <h3 className={`${TYPO.modalTitle}`}>Completed</h3>
                            <button
                                type="button"
                                onClick={() => setSuccessSheet(null)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center">
                            <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
                            <p className="mt-2 text-[1rem] font-semibold text-slate-900">
                                {successSheet.action === "subscribe" ? "Earn Subscribe" : successSheet.action === "redeem" ? "Earn Redemption" : "Earn Claim"}
                            </p>
                            <p className="mt-1 text-[0.92rem] text-slate-600">
                                {formatTokenAmount(successSheet.amount, selectedToken)} {selectedToken}
                            </p>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-2">
                            {successSheet.txHash ? (
                                <a
                                    href={`https://sepolia.etherscan.io/tx/${successSheet.txHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn-theme-secondary flex h-10 items-center justify-center gap-1.5"
                                >
                                    View On-Chain Transaction
                                    <ArrowUpRight size={16} />
                                </a>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => setSuccessSheet(null)}
                                className="btn-theme-primary h-10"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <ProcessingLayer open={isProcessing} text="processing..." zIndexClassName="z-[60]" />
        </main>
    );
}
