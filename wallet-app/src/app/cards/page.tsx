"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeft,
    ArrowUpRight,
    BadgeDollarSign,
    Copy,
    CreditCard,
    Eye,
    KeyRound,
    Menu,
    Pencil,
    Plus,
    Snowflake,
    Sparkles,
    Wallet,
    X,
} from "lucide-react";
import { createCard, freezeCard, getCards, getTransactionHistory, unfreezeCard, updateCard } from "@/lib/api";
import { copyText } from "@/lib/copy";
import { ProcessingLayer } from "@/components/processing-layer";
import { TYPO } from "@/lib/typography";
import type { DashboardTransaction, UserCard } from "@/lib/types";
import { useAuthStore } from "@/store/auth-store";

type SheetMode = "manage" | "details" | "limit" | "freeze" | "unfreeze" | null;
type PageMode = "main" | "add" | "nickname" | "pin";
const CARD_LIMIT_MAX_USD = 1_000_000;
const CARD_LIMIT_MAX_LENGTH = 7;

function notify(message: string, durationMs: number = 5000) {
    window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, durationMs } }));
}

function titleFromEmail(email?: string) {
    const prefix = String(email || "CARD HOLDER").split("@")[0] || "CARD HOLDER";
    return prefix.replace(/[._-]+/g, " ").trim().toUpperCase().slice(0, 80) || "CARD HOLDER";
}

function formatUsd(value: number) {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value || 0)} USD`;
}

function toPositiveIntegerOrNull(value: string) {
    const numeric = Number(String(value || "").trim());
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
}

function toSafeNumber(value: unknown, fallback: number = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatDate(input?: string | null) {
    if (!input) return "Recent";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return "Recent";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function BottomTab(props: { active?: boolean; icon: React.ReactNode; label: string }) {
    return (
        <div
            className={`flex flex-col items-center gap-1 rounded-[1rem] px-1.5 py-1.5 transition ${props.active
                ? "border border-[#cfe0ff] bg-[#f3f8ff] text-[#3468d4] shadow-[0_6px_16px_rgba(59,114,223,0.14)]"
                : "text-slate-500 hover:bg-slate-50"
                }`}
        >
            <div className={`flex h-7 w-7 items-center justify-center rounded-full ${props.active ? "border border-[#cfe0ff] bg-[#dbe8ff] text-[#1e3a8a]" : "bg-slate-100"}`}>
                {props.icon}
            </div>
            <span className="text-[0.68rem] font-medium">{props.label}</span>
        </div>
    );
}

function BottomNav() {
    return (
        <nav className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto w-full max-w-md rounded-[1.35rem] border border-white/80 bg-white/92 px-1.5 py-1.5 shadow-[0_10px_24px_rgba(148,163,184,0.14)] backdrop-blur">
                <div className="grid grid-cols-4 gap-1">
                    <Link href="/dashboard"><BottomTab icon={<Wallet size={16} />} label="Vault" /></Link>
                    <Link href="/earn"><BottomTab icon={<Sparkles size={16} />} label="Earn" /></Link>
                    <BottomTab active icon={<CreditCard size={16} />} label="Cards" />
                    <Link href="/transactions?scope=card"><BottomTab icon={<Menu size={16} />} label="Transactions" /></Link>
                </div>
            </div>
        </nav>
    );
}

function AppHeader(props: { email?: string; right?: React.ReactNode }) {
    return (
        <section className="flex items-start justify-between pt-2">
            <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#cfe0ff] bg-[#f2f7ff] text-[#3468d4] shadow-[0_10px_25px_rgba(59,114,223,0.14)]">
                    <CreditCard size={27} />
                </div>
                <div>
                    <p className="text-[0.95rem] text-slate-500">Personal (testnet)</p>
                    <h1 className={`${TYPO.pageTitle}`}>My Account</h1>
                    <p className="mt-1 text-[0.78rem] text-slate-400">{props.email || "wallet@demo.com"}</p>
                </div>
            </div>
            {props.right}
        </section>
    );
}

function CardArt(props: { card?: UserCard; muted?: boolean; nicknameAnimating?: boolean }) {
    const ownerRaw = String(props.card?.cardholderName || "").trim();
    const owner = ownerRaw || "CARD HOLDER";
    const rawNickname = String(props.card?.nickname || "").trim();
    const nickname = rawNickname;
    const cardNumber = String(props.card?.cardNumber || "");
    const computedLast4 = cardNumber ? cardNumber.slice(-4) : "";
    const last4 = String(props.card?.last4 || computedLast4 || "0000");
    const frozen = props.card?.status === "frozen";

    return (
        <div className={`relative mx-auto aspect-[1.64/1] w-full max-w-[20rem] overflow-hidden rounded-[1.55rem] border border-[#b6c9f6] bg-[linear-gradient(135deg,#62b8e8_0%,#4f7edc_48%,#7a4ed1_100%)] p-5 text-white shadow-[0_20px_50px_rgba(53,105,212,0.24)] ${props.muted ? "opacity-75" : ""}`}>
            <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/12" />
            <div className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:18px_18px]" />
            {frozen ? (
                <div className="absolute inset-0 bg-slate-950/20">
                    <div className="absolute inset-0 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.08)_6px,transparent_6px,transparent_14px)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Snowflake size={44} className="text-[#f6d58e]" />
                    </div>
                </div>
            ) : null}
            <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Sparkles size={21} />
                        <span className="text-[0.88rem] font-semibold tracking-[0.06em]">SPAY</span>
                    </div>
                    <div className="max-w-[46%] text-right leading-tight">
                        <p className="text-[0.95rem] font-bold tracking-[0.08em]">VISA</p>
                        {nickname ? (
                            <p
                                className={`mt-1 truncate text-[0.75rem] font-medium text-white/90 transition-all duration-500 ${props.nicknameAnimating
                                    ? "scale-[1.06] text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.65)]"
                                    : ""
                                    }`}
                            >
                                {nickname}
                            </p>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="pointer-events-none absolute bottom-4 left-5 right-5 flex items-end justify-between gap-3">
                <p className="max-w-[60%] truncate text-[0.95rem] font-semibold uppercase tracking-[0.01em] text-white [text-shadow:0_1px_8px_rgba(15,23,42,0.55)]">
                    {owner}
                </p>
                <p className="shrink-0 text-[1rem] font-bold tracking-[0.04em] text-white [text-shadow:0_1px_8px_rgba(15,23,42,0.55)]">
                    ** {last4}
                </p>
            </div>
        </div>
    );
}

function PinBoxesInput(props: { value: string; onChange: (value: string) => void }) {
    const digits = props.value.padEnd(6, " ").slice(0, 6).split("");
    return (
        <div className="relative mt-2">
            <div className="grid grid-cols-6 gap-2">
                {digits.map((digit, index) => (
                    <div key={index} className="flex h-12 items-center justify-center rounded-lg border border-[#d8e6ff] bg-[#f8fbff] text-[1.05rem] font-semibold text-slate-900">
                        {digit.trim()}
                    </div>
                ))}
            </div>
            <input
                value={props.value}
                onChange={(event) => props.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                className="absolute inset-0 h-full w-full opacity-0"
            />
        </div>
    );
}

function EmptyCards(props: { email?: string; onGetCard: () => void }) {
    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-24">
                <AppHeader email={props.email} />
                <section className="mt-16 rounded-[2rem] border border-white/80 bg-white/92 px-6 py-9 text-center shadow-[var(--shadow)]">
                    <CardArt muted />
                    <h2 className="mt-9 text-[0.95rem] font-bold text-[#3569d4]">Ready to create your card?</h2>
                    <p className="mt-3 text-[0.92rem] text-slate-500">Get your new card in seconds.</p>
                </section>
                <div className="mt-5">
                    <button type="button" onClick={props.onGetCard} className="btn-theme-primary flex h-10 w-full items-center justify-center gap-2 text-[0.95rem] font-medium">
                        Get Card
                        <Plus size={18} />
                    </button>
                </div>
                <BottomNav />
            </div>
        </main>
    );
}

function AddCardScreen(props: {
    email?: string;
    loading?: boolean;
    onBack: () => void;
    onSubmit: (input: { cardholderName: string; nickname: string; pin: string }) => void;
}) {
    const [name, setName] = useState("");
    const [nickname, setNickname] = useState("");
    const [pin, setPin] = useState("");
    const canSubmit = name.trim().length > 1 && nickname.trim().length > 0 && pin.length === 6 && !props.loading;

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <button type="button" onClick={props.onBack} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>Setup Card</h1>
                </section>

                <section className="mt-8 rounded-[2rem] border border-white/80 bg-white/92 px-6 py-7 shadow-[var(--shadow)]">
                    <CardArt muted />
                    <h2 className="mt-6 text-center text-[0.86rem] font-bold text-[#3569d4]">Setup Card</h2>
                    <div className="mt-6 space-y-4">
                        <label className="block">
                            <span className="mb-2 block text-[0.92rem] text-slate-500">Cardholder name</span>
                            <input
                                value={name}
                                maxLength={80}
                                onChange={(event) => setName(event.target.value.toUpperCase().slice(0, 80))}
                                className="h-12 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-4 text-slate-900 outline-none"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-[0.92rem] text-slate-500">Nickname</span>
                            <input
                                value={nickname}
                                maxLength={32}
                                onChange={(event) => setNickname(event.target.value.slice(0, 32))}
                                className="h-12 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-4 text-slate-900 outline-none"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-2 block text-[0.92rem] text-slate-500">Create 6 digits PIN</span>
                            <PinBoxesInput value={pin} onChange={setPin} />
                        </label>
                    </div>
                    <button type="button" disabled={!canSubmit} onClick={() => props.onSubmit({ cardholderName: name, nickname: nickname.trim(), pin })} className={`btn-theme-primary mt-6 flex h-12 w-full items-center justify-center text-[1rem] font-medium ${!canSubmit ? "ui-state-disabled" : ""}`}>
                        {props.loading ? "Processing..." : "Get card"}
                    </button>
                </section>
            </div>
            <ProcessingLayer open={Boolean(props.loading)} text="processing..." zIndexClassName="z-[70]" />
        </main>
    );
}

function ActionButton(props: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button type="button" disabled={props.disabled} onClick={props.onClick} className={`group flex flex-col items-center gap-2 ${props.disabled ? "opacity-45" : ""}`}>
            <span className="flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-full border border-[#cfe0ff] bg-[#3b78e7] text-white shadow-[0_10px_20px_rgba(59,120,231,0.22)] transition duration-200 group-hover:brightness-105">
                {props.icon}
            </span>
            <span className="text-[0.9rem] font-medium text-slate-800">{props.label}</span>
        </button>
    );
}

function TxRow({ tx }: { tx: DashboardTransaction }) {
    const amountSecondary = String(tx.amountSecondary || "");
    return (
        <Link href={tx.id ? `/transactions/${tx.id}` : "/transactions?scope=card"} className="block">
            <div className="flex items-center gap-3.5 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <CreditCard size={22} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.94rem] font-semibold text-emerald-600">{tx.merchant || "Card Transaction"}</p>
                    <p className="mt-1 text-[0.82rem] text-slate-400">{`${tx.country || "MY"}${tx.cardLast4 ? ` ** ${tx.cardLast4}` : ""}`}</p>
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-[0.88rem] font-semibold text-slate-900">{tx.amountPrimary || "- RM0.00 MYR"}</p>
                    {amountSecondary && !/0\.00/.test(amountSecondary) ? (
                        <p className="mt-1 text-[0.82rem] text-slate-400">{amountSecondary}</p>
                    ) : null}
                    {tx.reward ? <p className="mt-1 text-[0.86rem] text-emerald-500">{tx.reward}</p> : null}
                </div>
            </div>
        </Link>
    );
}

function Sheet(props: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
    if (!props.open) return null;
    return (
        <div className="fixed inset-0 z-40 bg-slate-900/35 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-4 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-3 flex items-center justify-between">
                    <div className="w-9" />
                    <h3 className={`${TYPO.pageTitle}`}>{props.title}</h3>
                    <button type="button" onClick={props.onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                        <X size={17} />
                    </button>
                </div>
                {props.children}
            </div>
        </div>
    );
}

function ManageSheet(props: { onLimit: () => void; onPin: () => void; onNickname: () => void }) {
    return (
        <div className="space-y-1">
            <MenuRow icon={<BadgeDollarSign size={21} />} title="Edit Limit" onClick={props.onLimit} />
            <MenuRow icon={<KeyRound size={21} />} title="Change Pin" onClick={props.onPin} />
            <MenuRow icon={<Pencil size={21} />} title="Change Nickname" onClick={props.onNickname} />
        </div>
    );
}

function MenuRow(props: { icon: React.ReactNode; title: string; onClick: () => void }) {
    return (
        <button type="button" onClick={props.onClick} className="flex w-full items-center gap-4 border-b border-slate-100 py-4 text-left last:border-b-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3f8ff] text-[#3468d4]">{props.icon}</span>
            <span className="text-[1rem] font-medium text-slate-900">{props.title}</span>
        </button>
    );
}

function DetailField(props: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0">
            <div className="min-w-0">
                <p className="text-[0.88rem] text-slate-500">{props.label}</p>
                <p className="mt-1 break-words text-[1rem] font-medium text-slate-900">{props.value}</p>
            </div>
            <button type="button" onClick={() => copyText(props.value).then((ok) => notify(ok ? "Copied" : "Copy failed"))} className="text-[#3468d4]">
                <Copy size={18} />
            </button>
        </div>
    );
}

function CardDetails(props: { card: UserCard }) {
    return (
        <div className="max-h-[68vh] overflow-y-auto pr-1">
            <DetailField label="Card Number" value={props.card.cardNumber.replace(/(.{4})/g, "$1 ").trim()} />
            <DetailField label="Expiry date" value={props.card.expiry} />
            <DetailField label="Security Code / CVV" value={props.card.cvv} />
            <DetailField label="Cardholder name" value={props.card.cardholderName} />
        </div>
    );
}

function LimitSheet(props: {
    card: UserCard;
    perTransactionValue: string;
    dailyValue: string;
    globalMonthlyLimitUsd: number;
    onPerTransactionChange: (value: string) => void;
    onDailyChange: (value: string) => void;
    onSave: () => void;
    saving?: boolean;
}) {
    return (
        <div className="space-y-5">
            <label className="block">
                <span className="mb-2 block text-[0.92rem] text-slate-500">Per Transaction Limit</span>
                <input
                    value={props.perTransactionValue}
                    onChange={(event) => props.onPerTransactionChange(event.target.value.replace(/[^\d]/g, "").slice(0, CARD_LIMIT_MAX_LENGTH))}
                    inputMode="numeric"
                    maxLength={CARD_LIMIT_MAX_LENGTH}
                    className="h-12 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-4 text-slate-900 outline-none"
                />
            </label>
            <label className="block">
                <span className="mb-2 block text-[0.92rem] text-slate-500">Daily Limit</span>
                <input
                    value={props.dailyValue}
                    onChange={(event) => props.onDailyChange(event.target.value.replace(/[^\d]/g, "").slice(0, CARD_LIMIT_MAX_LENGTH))}
                    inputMode="numeric"
                    maxLength={CARD_LIMIT_MAX_LENGTH}
                    className="h-12 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-4 text-slate-900 outline-none"
                />
            </label>
            <div className="rounded-[1.2rem] border border-slate-100 bg-[#fafdff] px-4 py-4 text-[0.9rem] text-slate-600">
                <p>Per Transaction: {formatUsd(toSafeNumber(props.card.perTransactionLimitUsd))}</p>
                <p>Card Daily: {formatUsd(toSafeNumber(props.card.dailyLimitUsd))}</p>
                <p className="mt-2">Global Monthly: {formatUsd(props.globalMonthlyLimitUsd)}</p>
            </div>
            <button type="button" disabled={props.saving} onClick={props.onSave} className={`btn-theme-primary flex h-11 w-full items-center justify-center ${props.saving ? "ui-state-disabled" : ""}`}>
                Confirm
            </button>
        </div>
    );
}

function EditTextScreen(props: {
    title: string;
    value: string;
    saving?: boolean;
    onBack: () => void;
    onChange: (value: string) => void;
    onConfirm: () => void;
}) {
    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <button type="button" onClick={props.onBack} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>{props.title}</h1>
                </section>
                <input value={props.value} maxLength={80} onChange={(event) => props.onChange(event.target.value.toUpperCase().slice(0, 80))} className="mt-10 h-14 w-full rounded-xl border border-[#d8e6ff] bg-white px-4 text-[1rem] text-slate-900 outline-none" />
                <button type="button" disabled={props.saving || !props.value.trim()} onClick={props.onConfirm} className={`btn-theme-primary mt-6 flex h-12 w-full items-center justify-center ${props.saving || !props.value.trim() ? "ui-state-disabled" : ""}`}>
                    Confirm
                </button>
            </div>
            <ProcessingLayer open={Boolean(props.saving)} text="processing..." zIndexClassName="z-[80]" />
        </main>
    );
}

function PinScreen(props: {
    value: string;
    saving?: boolean;
    onBack: () => void;
    onChange: (value: string) => void;
    onConfirm: () => void;
}) {
    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <button type="button" onClick={props.onBack} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ArrowLeft size={22} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>Change PIN</h1>
                </section>
                <p className="mt-10 text-[1rem] text-slate-500">Enter your new 6 digits PIN</p>
                <PinBoxesInput value={props.value} onChange={props.onChange} />
                <button type="button" disabled={props.saving || props.value.length !== 6} onClick={props.onConfirm} className={`btn-theme-primary mt-6 flex h-12 w-full items-center justify-center ${props.saving || props.value.length !== 6 ? "ui-state-disabled" : ""}`}>
                    Confirm
                </button>
            </div>
            <ProcessingLayer open={Boolean(props.saving)} text="processing..." zIndexClassName="z-[80]" />
        </main>
    );
}

export default function CardsPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { token, hydrated, user } = useAuthStore();
    const [pageMode, setPageMode] = useState<PageMode>("main");
    const [sheet, setSheet] = useState<SheetMode>(null);
    const [nicknameDraft, setNicknameDraft] = useState("");
    const [pinDraft, setPinDraft] = useState("");
    const [perTransactionLimitDraft, setPerTransactionLimitDraft] = useState("");
    const [dailyLimitDraft, setDailyLimitDraft] = useState("");
    const [nicknameAnimating, setNicknameAnimating] = useState(false);
    const [processingOverlay, setProcessingOverlay] = useState(false);
    const globalMonthlyLimitUsd = 1000000;

    const cardsQuery = useQuery({ queryKey: ["cards", token], enabled: Boolean(token), queryFn: getCards });
    const txQuery = useQuery({
        queryKey: ["cards-transactions", token],
        enabled: Boolean(token),
        queryFn: () => getTransactionHistory({ scope: "card", page: 1, limit: 5 })
    });

    const cards = cardsQuery.data?.cards || [];
    const card = cards[0];
    const transactions = txQuery.data?.transactions || [];

    const replaceCardCache = (nextCard: UserCard) => {
        queryClient.setQueryData(["cards", token], { cards: [nextCard, ...cards.filter((item) => item.id !== nextCard.id)] });
    };

    const createMutation = useMutation({
        mutationFn: async (input: { cardholderName: string; nickname: string; pin: string }) => {
            return createCard(input);
        },
        onSuccess: (result) => {
            queryClient.setQueryData(["cards", token], { cards: [result.card] });
            setPageMode("main");
            notify("Card created successfully");
        },
        onError: (error: Error) => notify(error.message || "Create card failed")
    });

    const updateMutation = useMutation({
        mutationFn: async (input: { id: string; data: Parameters<typeof updateCard>[1] }) => updateCard(input.id, input.data),
        onSuccess: (result) => {
            const prevNickname = String(card?.nickname || "").trim();
            const nextNickname = String(result.card.nickname || "").trim();
            replaceCardCache(result.card);
            setPageMode("main");
            setSheet(null);
            notify("Saved");
            if (nextNickname && nextNickname !== prevNickname) {
                setNicknameAnimating(true);
                window.setTimeout(() => setNicknameAnimating(false), 1000);
            }
        },
        onError: (error: Error) => notify(error.message || "Save failed")
    });

    const freezeMutation = useMutation({
        mutationFn: async (id: string) => freezeCard(id),
        onSuccess: (result) => {
            replaceCardCache(result.card);
            setSheet(null);
            notify("Card frozen");
        },
        onError: (error: Error) => notify(error.message || "Freeze failed")
    });

    const unfreezeMutation = useMutation({
        mutationFn: async (id: string) => unfreezeCard(id),
        onSuccess: (result) => {
            replaceCardCache(result.card);
            setSheet(null);
            notify("Card unfrozen");
        },
        onError: (error: Error) => notify(error.message || "Unfreeze failed")
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

    const isAnyCardRequestPending =
        createMutation.isPending ||
        updateMutation.isPending ||
        freezeMutation.isPending ||
        unfreezeMutation.isPending;

    useEffect(() => {
        setProcessingOverlay(isAnyCardRequestPending);
    }, [isAnyCardRequestPending]);

    if (pageMode === "add") {
        return <AddCardScreen email={user?.email} loading={processingOverlay} onBack={() => setPageMode("main")} onSubmit={(input) => createMutation.mutate(input)} />;
    }

    if (card && pageMode === "nickname") {
        return (
            <EditTextScreen
                title="Change Nickname"
                value={nicknameDraft}
                saving={processingOverlay}
                onBack={() => setPageMode("main")}
                onChange={setNicknameDraft}
                onConfirm={() => updateMutation.mutate({ id: card.id, data: { nickname: nicknameDraft } })}
            />
        );
    }

    if (card && pageMode === "pin") {
        return (
            <PinScreen
                value={pinDraft}
                saving={processingOverlay}
                onBack={() => setPageMode("main")}
                onChange={setPinDraft}
                onConfirm={() => updateMutation.mutate({ id: card.id, data: { pin: pinDraft } })}
            />
        );
    }

    if (cardsQuery.isLoading) {
        return (
            <main className="flex min-h-screen items-center justify-center px-6">
                <div className="rounded-2xl border border-white/80 bg-white px-5 py-4 text-sm text-slate-600 shadow-[var(--shadow)]">Loading cards...</div>
            </main>
        );
    }

    if (!card) {
        return <EmptyCards email={user?.email} onGetCard={() => setPageMode("add")} />;
    }

    const isFrozen = card.status === "frozen";

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md space-y-5 pb-24">
                <AppHeader
                    email={user?.email}
                    right={(
                        <button
                            type="button"
                            onClick={() => notify("Only one card is allowed per account. Please manage your existing card from this page", 2500)}
                            className="btn-theme-secondary mt-3 flex h-10 items-center gap-2 px-3 text-[0.9rem]"
                        >
                            Add Card
                            <Plus size={18} />
                        </button>
                    )}
                />

                <section className="pt-8">
                    <CardArt card={card} muted={isFrozen} nicknameAnimating={nicknameAnimating} />
                    <div className="mt-6 grid grid-cols-3 gap-4 text-center">
                        <ActionButton icon={<Menu size={24} />} label="Manage" onClick={() => setSheet("manage")} />
                        <ActionButton icon={<Eye size={25} />} label="Card Details" disabled={isFrozen} onClick={() => setSheet("details")} />
                        <ActionButton icon={<Snowflake size={25} />} label={isFrozen ? "Unfreeze Card" : "Freeze Card"} onClick={() => setSheet(isFrozen ? "unfreeze" : "freeze")} />
                    </div>
                </section>

                {isFrozen ? (
                    <section className="rounded-[1.6rem] border border-[#d8e6ff] bg-white/92 px-5 py-6 text-center shadow-[var(--shadow)]">
                        <Snowflake size={36} className="mx-auto text-[#3569d4]" />
                        <h2 className="mt-4 text-[1.05rem] font-semibold text-[#3569d4]">This card is frozen</h2>
                        <p className="mt-2 text-[0.9rem] text-slate-500">Preventing new transactions on this card.</p>
                        <button type="button" onClick={() => setSheet("unfreeze")} className="btn-theme-primary mt-5 flex h-11 w-full items-center justify-center">
                            Unfreeze Card
                        </button>
                    </section>
                ) : null}

                <section className="rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)]">
                    <div className="flex items-center justify-between">
                        <h2 className={`${TYPO.sectionTitle}`}>Transactions</h2>
                        <Link href="/transactions?scope=card" className="btn-theme-secondary flex items-center gap-2 px-3 py-0 text-[0.85rem]">
                            View All
                            <ArrowUpRight size={15} />
                        </Link>
                    </div>
                    <div className="mt-4">
                        {txQuery.isLoading ? (
                            <p className="py-6 text-center text-[0.95rem] text-slate-500">Loading transactions...</p>
                        ) : transactions.length ? (
                            transactions.slice(0, 5).map((tx, index) => (
                                <div key={tx.id || tx.txHash} className="border-b border-slate-100 last:border-b-0">
                                    {index === 0 ? <p className="pt-1 text-[0.88rem] text-slate-400">{formatDate(tx.timestamp)}</p> : null}
                                    <TxRow tx={tx} />
                                </div>
                            ))
                        ) : (
                            <div className="rounded-[1.2rem] border border-slate-100 bg-[#fafdff] px-4 py-6 text-center text-[0.95rem] text-slate-500">
                                No transactions found
                            </div>
                        )}
                    </div>
                </section>

                <BottomNav />
            </div>

            <Sheet open={sheet === "manage"} title="Manage Card" onClose={() => setSheet(null)}>
                <ManageSheet
                    onLimit={() => {
                        const perTxnDefault = Number.isFinite(Number(card.perTransactionLimitUsd))
                            ? Number(card.perTransactionLimitUsd)
                            : 1000;
                        setPerTransactionLimitDraft(String(toSafeNumber(perTxnDefault)));
                        setDailyLimitDraft(String(toSafeNumber(card.dailyLimitUsd)));
                        setSheet("limit");
                    }}
                    onPin={() => {
                        setPinDraft("");
                        setSheet(null);
                        setPageMode("pin");
                    }}
                    onNickname={() => {
                        setNicknameDraft(card.nickname || card.cardholderName);
                        setSheet(null);
                        setPageMode("nickname");
                    }}
                />
            </Sheet>

            <Sheet open={sheet === "details"} title="Card Details" onClose={() => setSheet(null)}>
                <CardDetails card={card} />
            </Sheet>

            <Sheet open={sheet === "limit"} title="Edit spending limits" onClose={() => setSheet(null)}>
                <LimitSheet
                    card={card}
                    perTransactionValue={perTransactionLimitDraft}
                    dailyValue={dailyLimitDraft}
                    globalMonthlyLimitUsd={globalMonthlyLimitUsd}
                    saving={processingOverlay}
                    onPerTransactionChange={setPerTransactionLimitDraft}
                    onDailyChange={setDailyLimitDraft}
                    onSave={() => {
                        const perTxnText = perTransactionLimitDraft.trim().slice(0, CARD_LIMIT_MAX_LENGTH);
                        const dailyText = dailyLimitDraft.trim().slice(0, CARD_LIMIT_MAX_LENGTH);
                        setPerTransactionLimitDraft(perTxnText);
                        setDailyLimitDraft(dailyText);
                        if (perTxnText && Number(perTxnText) > CARD_LIMIT_MAX_USD) {
                            notify("Per transaction limit must be 1,000,000 or less");
                            return;
                        }
                        if (dailyText && Number(dailyText) > CARD_LIMIT_MAX_USD) {
                            notify("Daily limit must be 1,000,000 or less");
                            return;
                        }
                        const data: Parameters<typeof updateCard>[1] = {};
                        const perTxn = toPositiveIntegerOrNull(perTransactionLimitDraft);
                        const daily = toPositiveIntegerOrNull(dailyLimitDraft);
                        if (perTransactionLimitDraft.trim() === "0") data.perTransactionLimitUsd = 0;
                        else if (perTxn !== null) data.perTransactionLimitUsd = perTxn;
                        if (daily !== null) data.dailyLimitUsd = daily;
                        if (dailyLimitDraft.trim() === "0") data.dailyLimitUsd = 0;
                        updateMutation.mutate({ id: card.id, data });
                    }}
                />
            </Sheet>

            <Sheet open={sheet === "freeze"} title="Confirm card freeze" onClose={() => setSheet(null)}>
                <p className="text-center text-[0.95rem] leading-6 text-slate-500">
                    This will temporarily prevent new transactions on your card, including select pre-authorized transactions.
                </p>
                <button type="button" disabled={freezeMutation.isPending} onClick={() => freezeMutation.mutate(card.id)} className={`btn-theme-primary mt-6 flex h-11 w-full items-center justify-center ${freezeMutation.isPending ? "ui-state-disabled" : ""}`}>
                    Confirm
                </button>
                <button type="button" onClick={() => setSheet(null)} className="btn-theme-secondary mt-3 flex h-11 w-full items-center justify-center">
                    Cancel
                </button>
            </Sheet>

            <Sheet open={sheet === "unfreeze"} title="Remove freeze on card" onClose={() => setSheet(null)}>
                <p className="text-center text-[0.95rem] leading-6 text-slate-500">
                    New transactions will no longer be prevented on your card.
                </p>
                <button type="button" disabled={unfreezeMutation.isPending} onClick={() => unfreezeMutation.mutate(card.id)} className={`btn-theme-primary mt-6 flex h-11 w-full items-center justify-center ${unfreezeMutation.isPending ? "ui-state-disabled" : ""}`}>
                    Confirm
                </button>
                <button type="button" onClick={() => setSheet(null)} className="btn-theme-secondary mt-3 flex h-11 w-full items-center justify-center">
                    Cancel
                </button>
            </Sheet>
            <ProcessingLayer open={processingOverlay} text="processing..." zIndexClassName="z-[85]" />
        </main>
    );
}
