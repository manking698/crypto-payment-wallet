"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import QRCode from "react-qr-code";
import {
    ArrowLeft,
    Check,
    ChevronDown,
    Circle,
    Copy,
    LoaderCircle,
    X,
} from "lucide-react";
import { getMe } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

type NetworkOption = {
    id: number;
    name: string;
    short: string;
    iconBg: string;
};

type TokenOption = {
    key: string;
    label: string;
    iconUrl: string;
};

const NETWORKS: NetworkOption[] = [
    { id: 11155111, name: "ETH Sepolia", short: "ETH", iconBg: "bg-slate-500" },
    { id: 84532, name: "Base Sepolia", short: "BA", iconBg: "bg-blue-500" },
    { id: 421614, name: "Arbitrum Sepolia", short: "AR", iconBg: "bg-sky-500" },
    { id: 11155420, name: "OP Sepolia", short: "OP", iconBg: "bg-rose-500" },
    { id: 534351, name: "Scroll Sepolia", short: "SC", iconBg: "bg-amber-500" },
];

const TOKENS: TokenOption[] = [
    { key: "USDT", label: "USDT", iconUrl: "/icons/usdt.png" },
    { key: "USDC", label: "USDC", iconUrl: "/icons/usdc.png" },
    { key: "ETH", label: "ETH", iconUrl: "/icons/eth.png" },
    { key: "WETH", label: "WETH", iconUrl: "/icons/weth-large.png" },
];

function buildReminder(token: string, network: string) {
    return `Only deposit ${token} from the ${network} network. Deposits of other assets or from other networks may be lost.`;
}

function SelectCard<T extends { label?: string; name?: string; iconText?: string; short?: string; iconBg?: string; iconUrl?: string }>(props: {
    title: string;
    selected: T;
    onToggle: () => void;
    helper?: string;
}) {
    const { title, selected, onToggle, helper } = props;
    const selectedText = selected.label ?? selected.name ?? "";
    const selectedIconText = selected.iconText ?? selected.short ?? selectedText.slice(0, 2);

    return (
        <div className="space-y-2.5">
            <p className="text-[14px] text-slate-500">{title}</p>
            <button
                onClick={onToggle}
                className="flex w-full items-center justify-between rounded-[1rem] border border-[#d8e6ff] bg-[#f8fbff] px-4 py-3 text-left transition hover:bg-[#f1f6ff]"
            >
                <div className="flex min-w-0 items-center gap-3">
                    {selected.iconUrl ? (
                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm">
                            <img src={selected.iconUrl} alt={`${selectedText} icon`} className="h-6 w-6 object-contain" />
                        </div>
                    ) : (
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white ${selected.iconBg || "bg-slate-500"}`}>
                            {selectedIconText}
                        </div>
                    )}
                    <div className="min-w-0">
                        <span className="block truncate text-[15px] text-slate-900">{selectedText}</span>
                        {helper ? <span className="block truncate text-[11px] text-slate-400">{helper}</span> : null}
                    </div>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                    <ChevronDown size={16} />
                </div>
            </button>
        </div>
    );
}

function PickerModal<T extends { label?: string; name?: string; iconText?: string; short?: string; iconBg?: string; iconUrl?: string }>(props: {
    title: string;
    open: boolean;
    options: T[];
    selected: T;
    onClose: () => void;
    onSelect: (value: T) => void;
}) {
    const { title, open, options, selected, onClose, onSelect } = props;

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/28 px-3 pb-3 pt-10 backdrop-blur-[3px]">
            <div className="w-full max-w-md rounded-[1.7rem] bg-white px-4 pb-4 pt-3 shadow-[0_24px_90px_rgba(15,23,42,0.18)]">
                <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-2.5 flex items-center justify-between">
                    <h3 className={`${TYPO.modalTitle} text-[#2f67d8]`}>{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                        aria-label="Close picker"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="space-y-2">
                    {options.map((option) => {
                        const active = option === selected;
                        const text = option.label ?? option.name ?? "";
                        const iconText = option.iconText ?? option.short ?? text.slice(0, 2);

                        return (
                            <button
                                key={`${title}-${text}`}
                                onClick={() => onSelect(option)}
                                className={`flex w-full items-center justify-between rounded-[0.95rem] border px-4 py-2.5 text-left transition ${
                                    active ? "ui-state-selected" : "ui-state-unselected"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    {option.iconUrl ? (
                                        <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm">
                                            <img src={option.iconUrl} alt={`${text} icon`} className="h-5 w-5 object-contain" />
                                        </div>
                                    ) : (
                                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${option.iconBg || "bg-slate-500"}`}>
                                            {iconText}
                                        </div>
                                    )}
                                    <span className="text-[14px] text-slate-900">{text}</span>
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

export default function DepositPage() {
    const router = useRouter();
    const { token, user, hydrated } = useAuthStore();
    const [selectedToken, setSelectedToken] = useState<TokenOption>(TOKENS[0]);
    const [selectedNetwork, setSelectedNetwork] = useState<NetworkOption>(NETWORKS[3]);
    const [copied, setCopied] = useState(false);
    const [tokenOpen, setTokenOpen] = useState(false);
    const [networkOpen, setNetworkOpen] = useState(false);

    const profileQuery = useQuery({
        queryKey: ["auth-me", token],
        queryFn: getMe,
        enabled: Boolean(token),
    });

    const activeUser = profileQuery.data ?? user;

    if (!hydrated) {
        return (
            <main className="flex min-h-screen items-center justify-center">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/80 bg-white px-5 py-4 shadow-[var(--shadow)]">
                    <LoaderCircle className="animate-spin text-slate-400" size={18} />
                    <span className="text-sm text-slate-600">
                        <p>Restoring your session...</p>
                        <p className="mt-1 text-xs text-slate-400">If no response after a while, please refresh this page.</p>
                    </span>
                </div>
            </main>
        );
    }

    if (!token) {
        router.replace("/login");
        return null;
    }

    const vaultAddress = activeUser?.vaultAddress ?? "";
    const reminder = buildReminder(selectedToken.label, selectedNetwork.name);
    const hiddenRenderMessages = useMemo(
        () =>
            Array.from({ length: 50 }, (_, index) => {
                const stamp = Date.now().toString(36);
                const rand = Math.random().toString(36).slice(2, 10);
                return `render-${index + 1}-${stamp}-${rand}`;
            }),
        [vaultAddress, selectedToken.key, selectedNetwork.id, copied, tokenOpen, networkOpen]
    );

    const handleCopy = async () => {
        if (!vaultAddress) return;
        const ok = await copyText(vaultAddress);
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
    };

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-5 py-6 sm:px-8">
            <div className="mx-auto w-full max-w-md">
                <section className="flex items-center gap-3 pt-2">
                    <Link
                        href="/dashboard"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>
                        Share deposit address
                    </h1>
                </section>

                <div className="mt-6 space-y-4.5 rounded-[24px] border border-white/80 bg-white/92 px-5 pb-5 pt-4 shadow-[var(--shadow)] backdrop-blur sm:px-6">

                    <section className="space-y-2.5 text-center">
                        <div className="flex justify-center">
                            <div className="rounded-[1.3rem] bg-white p-2.5 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                                <QRCode
                                    value={vaultAddress || `${selectedToken.key}:${selectedNetwork.id}`}
                                    size={204}
                                    bgColor="#FFFFFF"
                                    fgColor="#0f172a"
                                />
                            </div>
                        </div>

                        <p className="text-[0.88rem] text-slate-500">
                            {selectedToken.label} deposit address
                        </p>

                        <button
                            onClick={handleCopy}
                            className="flex w-full items-center justify-between rounded-[1.1rem] border border-[#bcd1ff] bg-[#f6f9ff] px-3.5 py-3 text-left text-[#1e3a8a] shadow-[0_6px_18px_rgba(148,163,184,0.1)] transition hover:bg-[#edf4ff]"
                        >
                            <span className="truncate pr-4 text-[0.92rem]">
                                {vaultAddress || "Loading vault address..."}
                            </span>
                            <span className="shrink-0">
                                {copied ? <Check size={18} className="text-[#2f67d8]" /> : <Copy size={18} className="text-[#2f67d8]" />}
                            </span>
                        </button>

                        <div className="rounded-[1.2rem] border border-[#d8e6ff] bg-[#f3f8ff] px-3 py-2.5 text-left">
                            <p className="text-[1rem] font-semibold leading-none text-slate-950">Reminder</p>
                            <p className="mt-1.5 text-[0.88rem] leading-5 text-slate-600">
                                {reminder}
                            </p>
                        </div>
                    </section>

                    <section className="space-y-5 pt-0.5">
                        <SelectCard
                            title="Select Token"
                            selected={selectedToken}
                            onToggle={() => {
                                setNetworkOpen(false);
                                setTokenOpen((prev) => !prev);
                            }}
                            helper="Tap to choose token"
                        />

                        <SelectCard
                            title="Select supported network"
                            selected={selectedNetwork}
                            onToggle={() => {
                                setTokenOpen(false);
                                setNetworkOpen((prev) => !prev);
                            }}
                            helper="Tap to choose network"
                        />
                    </section>

                    <button
                        className="btn-theme-primary mt-0.5 flex h-9 w-full items-center justify-center px-4 text-[0.95rem] font-medium"
                        onClick={() => router.push("/dashboard")}
                    >
                        OK
                    </button>
                </div>
            </div>

            <PickerModal
                title="Choose token"
                open={tokenOpen}
                options={TOKENS}
                selected={selectedToken}
                onClose={() => setTokenOpen(false)}
                onSelect={(value) => {
                    setSelectedToken(value);
                    setTokenOpen(false);
                }}
            />

            <PickerModal
                title="Choose network"
                open={networkOpen}
                options={NETWORKS}
                selected={selectedNetwork}
                onClose={() => setNetworkOpen(false)}
                onSelect={(value) => {
                    setSelectedNetwork(value);
                    setNetworkOpen(false);
                }}
            />
            <div className="hidden" aria-hidden="true" data-render-check={Date.now()} data-dev-pulse="pulse-050">
                {hiddenRenderMessages.map((message, idx) => (
                    <span key={`${idx}-${message}`} data-hidden-render-message={message}>
                        {message}
                    </span>
                ))}
            </div>
        </main>
    );
}
