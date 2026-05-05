"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
    ArrowLeft,
    ChevronDown,
    Check,
    Circle,
    Clipboard,
    Send,
    X
} from "lucide-react";
import { getDashboardSummary, getMe, withdrawFunds } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { ProcessingLayer } from "@/components/processing-layer";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

type NetworkOption = {
    chainId: number;
    name: string;
    short: string;
    iconBg: string;
};

type TokenOption = {
    key: "USDT" | "USDC" | "WETH";
    label: string;
    iconUrl: string;
    decimals: number;
};

const NETWORKS: NetworkOption[] = [
    { chainId: 11155111, name: "ETH Sepolia", short: "ETH", iconBg: "bg-slate-600" },
    { chainId: 534351, name: "Scroll Sepolia", short: "SC", iconBg: "bg-amber-500" },
    { chainId: 11155420, name: "OP Sepolia", short: "OP", iconBg: "bg-rose-500" },
    { chainId: 421614, name: "ARB Sepolia", short: "ARB", iconBg: "bg-sky-500" },
    { chainId: 84532, name: "Base Sepolia", short: "BA", iconBg: "bg-blue-500" }
];

const TOKENS: TokenOption[] = [
    { key: "USDT", label: "USDT", iconUrl: "/icons/usdt.png", decimals: 6 },
    { key: "USDC", label: "USDC", iconUrl: "/icons/usdc.png", decimals: 6 },
    { key: "WETH", label: "WETH", iconUrl: "/icons/weth-large.png", decimals: 18 }
];

function formatBalanceValue(value: string) {
    const normalized = String(value || "").replace(/,/g, "").trim();
    if (!normalized) return "0";
    const matched = normalized.match(/^-?\d+(\.\d+)?$/);
    if (!matched) return "0";
    return normalized;
}

function isValidEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function truncateNoRound(value: string, decimals: number) {
    const raw = String(value || "").replace(/,/g, "").trim();
    if (!raw) return "0";
    const negative = raw.startsWith("-");
    const unsigned = negative ? raw.slice(1) : raw;
    const [intPartRaw, fracPartRaw = ""] = unsigned.split(".");
    const intPart = intPartRaw || "0";
    const fracPart = fracPartRaw.slice(0, Math.max(0, decimals));
    return `${negative ? "-" : ""}${fracPart ? `${intPart}.${fracPart}` : intPart}`;
}

function sanitizeDecimalInput(value: string, decimals: number) {
    const input = String(value || "").replace(/,/g, "");
    const cleaned = input.replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    const intPart = cleaned.slice(0, firstDot);
    const fracPart = cleaned.slice(firstDot + 1).replace(/\./g, "");
    return `${intPart}.${fracPart.slice(0, Math.max(0, decimals))}`;
}

function getMaxWithdrawInputDecimals(token: TokenOption | null) {
    if (!token) return 8;
    return token.decimals >= 18 ? 8 : 6;
}

function toScaledBigInt(value: string, decimals: number) {
    const normalized = String(value || "").trim();
    if (!normalized) return BigInt(0);
    if (!/^\d+(\.\d+)?$/.test(normalized)) return BigInt(0);
    const [intPart, fracPart = ""] = normalized.split(".");
    const scaledFrac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(intPart || "0") * (BigInt(10) ** BigInt(decimals)) + BigInt(scaledFrac || "0");
}

function NetworkModal(props: {
    open: boolean;
    selected: NetworkOption;
    onClose: () => void;
    onSelect: (network: NetworkOption) => void;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 px-3 pb-3 pt-10 backdrop-blur-[2px]">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-md rounded-[1.7rem] border border-slate-100 bg-white px-4 pb-4 pt-3 shadow-[0_24px_90px_rgba(15,23,42,0.22)]">
                <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-2.5 flex items-center justify-between">
                    <h3 className={`${TYPO.modalTitle}`}>Select Network</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="space-y-2">
                    {NETWORKS.map((network) => {
                        const active = network.chainId === props.selected.chainId;
                        return (
                            <button
                                key={network.chainId}
                                type="button"
                                onClick={() => {
                                    props.onSelect(network);
                                    props.onClose();
                                }}
                                className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 ${active ? "ui-state-selected" : "ui-state-unselected"
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white ${network.iconBg}`}>
                                        {network.short}
                                    </div>
                                    <span className="text-[1rem] text-slate-900">{network.name}</span>
                                </div>
                                {active ? (
                                    <Check size={15} className="text-[#2f67d8]" />
                                ) : (
                                    <Circle size={15} className="text-slate-300" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function TokenModal(props: {
    open: boolean;
    tokens: TokenOption[];
    selected: TokenOption | null;
    onClose: () => void;
    onSelect: (token: TokenOption) => void;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 px-3 pb-3 pt-10 backdrop-blur-[2px]">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-md rounded-[1.7rem] border border-slate-100 bg-white px-4 pb-4 pt-3 shadow-[0_24px_90px_rgba(15,23,42,0.22)]">
                <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-2.5 flex items-center justify-between">
                    <h3 className={`${TYPO.modalTitle}`}>Select Token</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                    >
                        <X size={16} />
                    </button>
                </div>
                {props.tokens.length ? (
                    <div className="space-y-2">
                        {props.tokens.map((token) => {
                            const active = props.selected?.key === token.key;
                            return (
                                <button
                                    key={token.key}
                                    type="button"
                                    onClick={() => {
                                        props.onSelect(token);
                                        props.onClose();
                                    }}
                                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 ${active ? "ui-state-selected" : "ui-state-unselected"
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                                            <img src={token.iconUrl} alt={`${token.label} icon`} className="h-6 w-6 object-contain" />
                                        </div>
                                        <span className="text-[1rem] text-slate-900">{token.label}</span>
                                    </div>
                                    {active ? (
                                        <Check size={15} className="text-[#2f67d8]" />
                                    ) : (
                                        <Circle size={15} className="text-slate-300" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-slate-500">
                        No tokens available on this network.
                    </div>
                )}
            </div>
        </div>
    );
}

function ConfirmModal(props: {
    open: boolean;
    title: string;
    description: string;
    amountText: string;
    networkText: string;
    toAddress: string;
    confirmText: string;
    pending?: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    if (!props.open) return null;
    const locked = Boolean(props.pending);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="relative w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_24px_90px_rgba(15,23,42,0.25)]">
                <h3 className={`${TYPO.modalTitle}`}>{props.title}</h3>
                <p className="mt-2 text-[0.95rem] text-slate-600">{props.description}</p>
                <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[0.92rem] text-slate-700"><span className="text-slate-500">Amount:</span> {props.amountText}</p>
                    <p className="text-[0.92rem] text-slate-700"><span className="text-slate-500">Network:</span> {props.networkText}</p>
                    <p className="break-all text-[0.92rem] text-slate-700"><span className="text-slate-500">To:</span> {props.toAddress}</p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={props.onClose}
                        disabled={locked}
                        className="btn-theme-secondary h-8 text-[0.9rem] disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={props.onConfirm}
                        disabled={props.pending}
                        className="btn-theme-primary h-8 text-[0.9rem] disabled:opacity-50"
                    >
                        {props.pending ? "Submitting..." : props.confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function SendWalletPage() {
    const router = useRouter();
    const { token, user, hydrated } = useAuthStore();
    const [selectedNetwork, setSelectedNetwork] = useState<NetworkOption>(NETWORKS[0]);
    const [selectedToken, setSelectedToken] = useState<TokenOption | null>(TOKENS[0]);
    const [amount, setAmount] = useState("");
    const [toAddress, setToAddress] = useState("");
    const [networkOpen, setNetworkOpen] = useState(false);
    const [tokenOpen, setTokenOpen] = useState(false);
    const [notice, setNotice] = useState<{ status: "success" | "error"; message: string; txHash?: string; chainId?: number } | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const profileQuery = useQuery({
        queryKey: ["auth-me", token],
        queryFn: getMe,
        enabled: Boolean(token)
    });
    const summaryQuery = useQuery({
        queryKey: ["dashboard-summary", token],
        queryFn: getDashboardSummary,
        enabled: Boolean(token)
    });

    const activeUser = profileQuery.data ?? user;
    const tokenOptions = useMemo(() => (
        selectedNetwork.chainId === 11155111 ? TOKENS : []
    ), [selectedNetwork.chainId]);

    useEffect(() => {
        if (!tokenOptions.length) {
            setSelectedToken(null);
            return;
        }
        if (!selectedToken || !tokenOptions.find((item) => item.key === selectedToken.key)) {
            setSelectedToken(tokenOptions[0]);
        }
    }, [tokenOptions, selectedToken]);

    const selectedAssetBalance = useMemo(() => {
        if (!selectedToken) return "0";
        if (selectedNetwork.chainId !== 11155111) return "0";
        const asset = summaryQuery.data?.assets?.find((item) => item.symbol === selectedToken.key);
        return formatBalanceValue(asset?.balance || "0");
    }, [selectedNetwork.chainId, selectedToken, summaryQuery.data]);
    const hasPositiveBalance = Number(selectedAssetBalance) > 0;

    const amountRaw = String(amount || "").trim();
    const amountDigits = amountRaw.replace(".", "").length;
    const amountFontPx = useMemo(() => {
        if (amountDigits <= 6) return 52;
        if (amountDigits <= 10) return 44;
        if (amountDigits <= 14) return 36;
        return 30;
    }, [amountDigits]);
    const amountScale = selectedToken?.decimals ?? 18;
    const inputMaxDecimals = getMaxWithdrawInputDecimals(selectedToken);
    const fractionPart = amountRaw.includes(".") ? amountRaw.split(".")[1] || "" : "";
    const hasValidAmountFormat = /^\d+(\.\d+)?$/.test(amountRaw);
    const withinTokenDecimals = fractionPart.length <= inputMaxDecimals;
    const amountScaled = toScaledBigInt(amountRaw || "0", amountScale);
    const balanceScaled = toScaledBigInt(truncateNoRound(selectedAssetBalance, amountScale), amountScale);
    const hasPositiveAmount = amountScaled > BigInt(0);
    const withinBalance = amountScaled <= balanceScaled;
    const isValidAmount =
        hasValidAmountFormat &&
        withinTokenDecimals &&
        hasPositiveAmount &&
        withinBalance;
    const isValidAddress = isValidEvmAddress(toAddress);
    const isOwnVaultAddress = useMemo(() => {
        const target = String(toAddress || "").trim().toLowerCase();
        const own = String(activeUser?.vaultAddress || "").trim().toLowerCase();
        if (!target || !own) return false;
        return target === own;
    }, [toAddress, activeUser?.vaultAddress]);

    const withdrawMutation = useMutation({
        mutationFn: withdrawFunds,
        onSuccess: (_result) => {
            setNotice(null);
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: {
                    message: "Your withdrawal request has been submitted. You may continue using wallet. A notification will appear once processing is complete.",
                    tone: "success",
                    durationMs: 5500
                }
            }));
            setAmount("");
            setToAddress("");
        },
        onError: (error: Error) => {
            setNotice({ status: "error", message: error.message || "Send failed" });
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: {
                    message: "Failed. Please check amount, token balance and address",
                    tone: "error",
                    durationMs: 2800
                }
            }));
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

    const canSubmit =
        Boolean(activeUser?.email) &&
        selectedNetwork.chainId === 11155111 &&
        Boolean(selectedToken) &&
        isValidAmount &&
        isValidAddress &&
        !isOwnVaultAddress;

    const handleMax = () => {
        if (!selectedToken) return;
        setAmount(truncateNoRound(selectedAssetBalance, selectedToken.decimals));
    };

    const handlePaste = async () => {
        const readClipboard = async () => {
            if (typeof navigator === "undefined") return "";
            if (!("clipboard" in navigator)) return "";
            if (typeof navigator.clipboard?.readText !== "function") return "";
            return navigator.clipboard.readText();
        };

        try {
            const text = (await readClipboard()).trim();
            if (text) {
                setToAddress(text);
                return;
            }
        } catch (_err) {
            // iOS Safari / non-secure origins can block Clipboard API.
        }

        const manual = window.prompt("Paste wallet address", toAddress || "");
        if (manual === null) return;

        const next = manual.trim();
        if (!next) {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: "No address pasted" }
            }));
            return;
        }

        setToAddress(next);
    };

    const handleCopyTxHash = async () => {
        if (!notice?.txHash) return;
        const ok = await copyText(notice.txHash);
        if (!ok) {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: "Copy failed. Please try again" }
            }));
        }
    };

    const explorerByChainId: Record<number, string> = {
        11155111: "https://sepolia.etherscan.io",
        534351: "https://sepolia.scrollscan.com",
        11155420: "https://sepolia-optimism.etherscan.io",
        421614: "https://sepolia.arbiscan.io",
        84532: "https://sepolia.basescan.org"
    };
    const txExplorerBase = notice?.chainId ? explorerByChainId[notice.chainId] : "";
    const txExplorerLink = (notice?.status === "success" && txExplorerBase && notice?.txHash) ? `${txExplorerBase}/tx/${notice.txHash}` : "";
    const shortTxHash = notice?.txHash
        ? `${notice.txHash.slice(0, 34)}...`
        : "";

    const handleSubmit = async () => {
        if (!canSubmit || !selectedToken || !activeUser?.email || withdrawMutation.isPending) return;
        try {
            await withdrawMutation.mutateAsync({
                email: activeUser.email,
                amount: amount.trim(),
                toAddress: toAddress.trim(),
                token: selectedToken.key,
                chainId: selectedNetwork.chainId
            });
        } finally {
            setConfirmOpen(false);
        }
    };

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-8">
                <section className="flex items-center gap-3 pt-2">
                    <Link
                        href="/send"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Send funds</h1>
                </section>

                <section className="mt-6 rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)]">
                    <div className="flex justify-center pb-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#edf3ff] text-[#3569d4]">
                            <Send size={25} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-[0.95rem] text-slate-500">Select supported network</p>
                        <button
                            type="button"
                            onClick={() => setNetworkOpen(true)}
                            className="flex h-14 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4"
                        >
                            <div className="flex items-center gap-3">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white ${selectedNetwork.iconBg}`}>
                                    {selectedNetwork.short}
                                </div>
                                <span className="text-[1.05rem] text-slate-900">{selectedNetwork.name}</span>
                            </div>
                            <ChevronDown size={18} className="text-slate-400" />
                        </button>
                    </div>

                    <div className="my-5 border-b border-slate-100" />

                    <div className="space-y-2">
                        <p className="text-[0.95rem] text-slate-500">Select Asset</p>
                        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_10px_rgba(148,163,184,0.08)]">
                            <div className="flex items-start justify-between gap-3">
                                <input
                                    value={amount}
                                    onChange={(e) => {
                                        setAmount(sanitizeDecimalInput(e.target.value, inputMaxDecimals));
                                    }}
                                    inputMode="decimal"
                                    placeholder="0"
                                    style={{ fontSize: `${amountFontPx}px` }}
                                    className="w-full bg-transparent leading-none tracking-[-0.03em] text-slate-900 outline-none placeholder:text-slate-300"
                                />
                                <button
                                    type="button"
                                    onClick={() => setTokenOpen(true)}
                                    className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 ${selectedToken ? "border border-slate-200 bg-white" : "bg-slate-100 text-slate-500"
                                        }`}
                                >
                                    {selectedToken ? (
                                        <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                                            <img src={selectedToken.iconUrl} alt={`${selectedToken.label} icon`} className="h-5 w-5 object-contain" />
                                        </div>
                                    ) : null}
                                    <span className="text-[1rem]">{selectedToken ? selectedToken.label : "No Token"}</span>
                                    <ChevronDown size={16} />
                                </button>
                            </div>
                            <div className="mt-4 flex items-center justify-end gap-3">
                                <p className="text-[0.95rem] text-slate-500">Balance: {selectedAssetBalance}</p>
                                <button
                                    type="button"
                                    onClick={handleMax}
                                    disabled={!selectedToken || !hasPositiveBalance}
                                    className="btn-theme-primary px-3 py-0 text-[0.86rem] disabled:opacity-50"
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 space-y-2">
                        <p className="text-[0.95rem] text-slate-500">
                            Withdraw {selectedToken?.label || "token"} to
                        </p>
                        <div className="flex h-14 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4">
                            <input
                                value={toAddress}
                                onChange={(e) => setToAddress(e.target.value)}
                                placeholder="Wallet Address"
                                className="w-full bg-transparent text-[1rem] text-slate-900 outline-none placeholder:text-slate-400"
                            />
                            <button
                                type="button"
                                onClick={handlePaste}
                                className="text-slate-500"
                                aria-label="Paste address"
                            >
                                <Clipboard size={20} />
                            </button>
                        </div>
                        <p className="text-[0.92rem] text-sky-600">
                            Address must be on the {selectedNetwork.name} network
                        </p>
                        {isOwnVaultAddress ? (
                            <p className="text-[0.92rem] text-red-600">
                                You cannot send funds to your own vault address
                            </p>
                        ) : null}
                    </div>

                    {selectedNetwork.chainId !== 11155111 ? (
                        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.92rem] text-amber-700">
                            This network currently has no supported tokens for send.
                        </div>
                    ) : null}

                    {notice ? (
                        <div className={`mt-4 rounded-xl px-3 py-2 text-[0.92rem] ${notice.status === "success"
                            ? "border border-[#bcd1ff] bg-[#f6f9ff] text-[#1e3a8a] shadow-[0_10px_24px_rgba(59,114,223,0.12)]"
                            : "border border-red-200 bg-red-50 text-red-700"
                            }`}>
                            <p>{notice.message}</p>
                            {notice.status === "success" && notice.txHash ? (
                                <div className="mt-1 flex items-center justify-between gap-2">
                                    {txExplorerLink ? (
                                        <a
                                            href={txExplorerLink}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block break-all text-[0.92rem] text-[#1e3a8a] underline"
                                        >
                                            {shortTxHash}
                                        </a>
                                    ) : (
                                        <p className="break-all text-[0.92rem] text-[#1e3a8a]">{shortTxHash}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleCopyTxHash}
                                        className="btn-theme-primary shrink-0 px-2 py-0 text-[0.75rem]"
                                    >
                                        Copy
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </section>

                {canSubmit ? (
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(true)}
                        disabled={withdrawMutation.isPending}
                        className="btn-theme-primary mt-6 flex h-9 w-full items-center justify-center px-4 text-[0.95rem] disabled:opacity-45"
                    >
                        Review
                    </button>
                ) : null}
            </div>

            <NetworkModal
                open={networkOpen}
                selected={selectedNetwork}
                onClose={() => setNetworkOpen(false)}
                onSelect={setSelectedNetwork}
            />
            <TokenModal
                open={tokenOpen}
                tokens={tokenOptions}
                selected={selectedToken}
                onClose={() => setTokenOpen(false)}
                onSelect={setSelectedToken}
            />

            <ConfirmModal
                open={confirmOpen}
                title="Confirm Send"
                description="Please review details carefully. Choose Cancel or Confirm to continue."
                amountText={`${amount.trim()} ${selectedToken?.label || ""}`.trim()}
                networkText={selectedNetwork.name}
                toAddress={toAddress.trim()}
                confirmText="Confirm"
                pending={withdrawMutation.isPending}
                onClose={() => setConfirmOpen(false)}
                onConfirm={handleSubmit}
            />
            <ProcessingLayer open={withdrawMutation.isPending} text="processing..." zIndexClassName="z-[80]" />
        </main>
    );
}
