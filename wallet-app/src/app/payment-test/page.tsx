"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CreditCard, X } from "lucide-react";
import { simulateCardPayment } from "@/lib/api";
import { ProcessingLayer } from "@/components/processing-layer";
import { TYPO } from "@/lib/typography";

const MERCHANT_OPTIONS = [
    "VILLAGE GROCER-I-CITY",
    "KFC MY I-CITY",
    "SUSHI KING ",
    "STARBUCKS KLCC",
    "AEON BIG SHAH ALAM",
    "GT MART-1025 KAPAR 2",
    "MEGA DONQUIJOTE TOKYO",
];

const CURRENCY_OPTIONS = ["MYR", "JPY", "USD", "HKD", "TWD"] as const;

function normalizeCardDigits(value: string) {
    return String(value || "").replace(/\D/g, "").slice(0, 16);
}

function formatCardNumber(value: string) {
    const digits = normalizeCardDigits(value);
    return digits.replace(/(.{4})/g, "$1 ").trim();
}

function sanitizeAmountInput(value: string) {
    const raw = String(value || "").replace(/,/g, "");
    const cleaned = raw.replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const firstDot = cleaned.indexOf(".");
    if (firstDot === -1) return cleaned;
    const intPart = cleaned.slice(0, firstDot);
    const fracPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    return `${intPart}.${fracPart}`;
}

function PinModal(props: {
    open: boolean;
    value: string;
    loading?: boolean;
    onChange: (value: string) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    if (!props.open) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/35 px-4">
            <div className="absolute inset-0" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-100 bg-white px-5 pb-6 pt-4 shadow-[0_-20px_50px_rgba(15,23,42,0.2)]">
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
                <div className="mb-2 flex items-center justify-between">
                    <h3 className={`${TYPO.modalTitle} text-[#2f67d8]`}>Enter card PIN</h3>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
                    >
                        <X size={16} />
                    </button>
                </div>
                <p className="text-[0.92rem] text-slate-500">Please enter 6-digit PIN to confirm payment</p>

                <input
                    value={props.value}
                    onChange={(event) => props.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="mt-4 h-12 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-4 text-[1.05rem] text-slate-900 outline-none"
                />

                <button
                    type="button"
                    disabled={props.loading || props.value.length !== 6}
                    onClick={props.onConfirm}
                    className={`btn-theme-primary mt-5 flex h-10 w-full items-center justify-center ${props.loading || props.value.length !== 6 ? "ui-state-disabled" : ""}`}
                >
                    {props.loading ? "Processing" : "Confirm"}
                </button>
            </div>
        </div>
    );
}

export default function PaymentTestPage() {
    const [mounted, setMounted] = useState(false);
    const [merchantName, setMerchantName] = useState(MERCHANT_OPTIONS[0]);
    const [currency, setCurrency] = useState<(typeof CURRENCY_OPTIONS)[number]>("MYR");
    const [paymentAmount, setPaymentAmount] = useState("");
    const [cardNumber, setCardNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvv, setCvv] = useState("");
    const [pin, setPin] = useState("");
    const [pinOpen, setPinOpen] = useState(false);
    const [resultText, setResultText] = useState("");

    useEffect(() => {
        setMounted(true);
    }, []);


    const isFormReady = useMemo(() => {
        return Boolean(
            merchantName &&
            currency &&
            /^\d+(\.\d{1,2})?$/.test(paymentAmount.trim()) &&
            normalizeCardDigits(cardNumber).length === 16 &&
            expiry.trim().length >= 4 &&
            cvv.replace(/\D/g, "").length >= 3
        );
    }, [merchantName, currency, paymentAmount, cardNumber, expiry, cvv]);

    const payMutation = useMutation({
        mutationFn: simulateCardPayment,
        onSuccess: (result) => {
            setPinOpen(false);
            setPin("");
            setResultText(`Payment completed | ${result.paymentCurrency} ${Number(result.paymentAmount).toFixed(2)} | ${result.txHashes.length} tx`);
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: "Card payment completed", durationMs: 5000 }
            }));
        },
        onError: (error: Error) => {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: { message: error.message || "Card payment failed", tone: "error", durationMs: 5000 }
            }));
        }
    });

    if (!mounted) {
        return null;
    }

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md items-center pb-10">
                <section className="w-full rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-5 shadow-[var(--shadow)]">
                    <section className="flex items-center justify-center gap-3 pt-1">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#edf3ff] text-[#3569d4]">
                            <CreditCard size={22} />
                        </div>
                        <h1 className={`${TYPO.pageTitle}`}>Card payment test</h1>
                    </section>

                    <div className="mt-5 grid grid-cols-5 gap-3">
                        <label className="col-span-3 space-y-1.5">
                            <span className="text-[0.9rem] text-slate-500">Merchant</span>
                            <select
                                value={merchantName}
                                onChange={(event) => setMerchantName(event.target.value)}
                                className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                            >
                                {MERCHANT_OPTIONS.map((item) => (
                                    <option key={item} value={item}>{item}</option>
                                ))}
                            </select>
                        </label>

                        <label className="col-span-2 space-y-1.5">
                            <span className="text-[0.9rem] text-slate-500">Currency</span>
                            <select
                                value={currency}
                                onChange={(event) => setCurrency(event.target.value as (typeof CURRENCY_OPTIONS)[number])}
                                className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                            >
                                {CURRENCY_OPTIONS.map((item) => (
                                    <option key={item} value={item}>{item}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <label className="mt-3 block space-y-1.5">
                        <span className="text-[0.9rem] text-slate-500">Payment amount</span>
                        <input
                            value={paymentAmount}
                            onChange={(event) => setPaymentAmount(sanitizeAmountInput(event.target.value))}
                            onPaste={(event) => {
                                event.preventDefault();
                                const pasted = event.clipboardData.getData("text");
                                setPaymentAmount(sanitizeAmountInput(pasted));
                            }}
                            inputMode="decimal"
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                        />
                    </label>

                    <div className="my-5 border-b border-slate-100" />

                    <p className="text-[0.95rem] text-slate-600">Card data</p>
                    <label className="mt-2 block space-y-1.5">
                        <span className="text-[0.88rem] text-slate-500">Card number</span>
                        <input
                            value={cardNumber}
                            onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
                            onPaste={(event) => {
                                event.preventDefault();
                                const pasted = event.clipboardData.getData("text");
                                setCardNumber(formatCardNumber(pasted));
                            }}
                            inputMode="numeric"
                            className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                        />
                    </label>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="space-y-1.5">
                            <span className="text-[0.88rem] text-slate-500">Expiry</span>
                            <input
                                value={expiry}
                                onChange={(event) => setExpiry(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                onPaste={(event) => {
                                    event.preventDefault();
                                    const pasted = event.clipboardData.getData("text");
                                    setExpiry(String(pasted || "").replace(/\D/g, "").slice(0, 4));
                                }}
                                inputMode="numeric"
                                placeholder="MMYY"
                                className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                            />
                        </label>
                        <label className="space-y-1.5">
                            <span className="text-[0.88rem] text-slate-500">CVV</span>
                            <input
                                value={cvv}
                                onChange={(event) => setCvv(event.target.value.replace(/\D/g, "").slice(0, 4))}
                                inputMode="numeric"
                                className="h-11 w-full rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 text-slate-900 outline-none"
                            />
                        </label>
                    </div>

                    {resultText ? (
                        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.9rem] text-emerald-700">
                            {resultText}
                        </p>
                    ) : null}

                    <button
                        type="button"
                        disabled={!isFormReady || payMutation.isPending}
                        onClick={() => {
                            setPinOpen(true);
                        }}
                        className={`btn-theme-primary mt-5 flex h-10 w-full items-center justify-center ${!isFormReady || payMutation.isPending ? "ui-state-disabled" : ""}`}
                    >
                        Submit payment
                    </button>
                </section>
            </div>

            <PinModal
                open={pinOpen}
                value={pin}
                loading={payMutation.isPending}
                onChange={setPin}
                onClose={() => {
                    if (payMutation.isPending) return;
                    setPinOpen(false);
                    setPin("");
                }}
                onConfirm={() => {
                    payMutation.mutate({
                        merchantName,
                        paymentCurrency: currency,
                        paymentAmount: paymentAmount.trim(),
                        cardNumber: normalizeCardDigits(cardNumber),
                        expiry,
                        cvv,
                        pin,
                        country: currency === "MYR" ? "MY" : "",
                        merchantRef: `SIM-${Date.now()}`
                    });
                }}
            />
            <ProcessingLayer open={payMutation.isPending} text="processing..." zIndexClassName="z-[80]" />
        </main>
    );
}
