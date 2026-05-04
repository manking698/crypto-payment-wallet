"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Droplets, Gift } from "lucide-react";
import { claimFaucet, getFaucetStatus } from "@/lib/api";
import { ProcessingLayer } from "@/components/processing-layer";
import { TYPO } from "@/lib/typography";

type ClaimType = "USDT" | "USDC" | "WETH" | "ALL";

const CLAIM_OPTIONS: Array<{ value: ClaimType; label: string }> = [
    { value: "USDT", label: "USDT (500)" },
    { value: "USDC", label: "USDC (1000)" },
    { value: "WETH", label: "WETH (0.15)" },
    { value: "ALL", label: "ALL (USDT + USDC + WETH)" },
];

function isEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function formatDateTime(value?: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

export default function FaucetPage() {
    const [vaultAddress, setVaultAddress] = useState("");
    const [claimType, setClaimType] = useState<ClaimType>("USDT");
    const [resultText, setResultText] = useState("");

    useEffect(() => {
        document.title = "Crypto Payment Wallet - Faucet";
    }, []);

    const normalizedAddress = vaultAddress.trim();
    const canLookup = isEvmAddress(normalizedAddress);

    const statusQuery = useQuery({
        queryKey: ["faucet-status", normalizedAddress, claimType],
        enabled: canLookup,
        queryFn: () => getFaucetStatus(normalizedAddress, claimType)
    });

    const claimMutation = useMutation({
        mutationFn: claimFaucet,
        onMutate: () => {
            setResultText("");
        },
        onSuccess: (result) => {
            statusQuery.refetch();
            setResultText(`Claim submitted | ${result.tokenSymbols.join(", ")} | ${result.txHashes.length} tx`);
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: "Claim submitted successfully", durationMs: 5000 }
            }));
        },
        onError: (error: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: error.message || "Claim failed", tone: "error", durationMs: 5000 }
            }));
        }
    });

    const actionLabel = useMemo(() => {
        if (!normalizedAddress) return "Enter vault address";
        if (!canLookup) return "Invalid vault address";
        if (claimMutation.isPending) return "Processing claim";
        return "Claim";
    }, [normalizedAddress, canLookup, claimMutation.isPending]);

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)]">
                    <section className="flex items-center justify-center gap-3 pt-1">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#edf3ff] text-[#3569d4]">
                            <Droplets size={22} />
                        </div>
                        <h1 className={`${TYPO.pageTitle}`}>Faucet claim</h1>
                    </section>

                    <div className="mt-5 rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 py-3">
                        <p className="text-[0.86rem] font-semibold text-slate-700">Claim rules</p>
                        <ul className="mt-1 space-y-1 text-[0.83rem] text-slate-600">
                            <li>Claim amount: USDT 500, USDC 1000, WETH 0.15</li>
                            <li>* Each token can be claimed once every 24 hours per vault address</li>
                            <li>* ALL claim sends USDT + USDC + WETH together</li>
                            <li>* If already claimed today, next eligible claim time will be shown</li>
                        </ul>
                    </div>

                    <label className="mt-4 block space-y-1.5">
                        <span className="text-[0.9rem] text-slate-500">Vault address</span>
                        <input
                            value={vaultAddress}
                            onChange={(event) => setVaultAddress(event.target.value.trim())}
                            placeholder="0x..."
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                        />
                    </label>

                    <label className="mt-3 block space-y-1.5">
                        <span className="text-[0.9rem] text-slate-500">Claim token</span>
                        <select
                            value={claimType}
                            onChange={(event) => setClaimType(event.target.value as ClaimType)}
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                        >
                            {CLAIM_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </label>

                    {canLookup && statusQuery.data && !statusQuery.data.eligibleNow ? (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 text-[0.85rem] text-slate-700">
                            <p>Claim completed for today</p>
                            <p>Please claim again after {formatDateTime(statusQuery.data.nextClaimAt)}</p>
                        </div>
                    ) : null}

                    {resultText ? (
                        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.9rem] text-emerald-700">
                            {resultText}
                        </p>
                    ) : null}

                    <button
                        type="button"
                        disabled={!canLookup || claimMutation.isPending}
                        onClick={() => {
                            claimMutation.mutate({
                                vaultAddress: normalizedAddress,
                                claimType
                            });
                        }}
                        className={`btn-theme-primary mt-5 flex h-10 w-full items-center justify-center gap-2 ${!canLookup || claimMutation.isPending ? "ui-state-disabled" : ""}`}
                    >
                        <Gift size={16} />
                        {actionLabel}
                    </button>
                </section>
            </div>
            <ProcessingLayer open={claimMutation.isPending} text="processing..." zIndexClassName="z-[70]" />
        </main>
    );
}
