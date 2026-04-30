"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { TYPO } from "@/lib/typography";
import { ArrowLeft, ChevronRight, Send, Wallet } from "lucide-react";

export default function SendEntryPage() {
    const router = useRouter();
    const { token, hydrated } = useAuthStore();

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
                    <Link
                        href="/dashboard"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Send to wallet</h1>
                </section>

                <section className="mt-8 rounded-[1.8rem] border border-white/80 bg-white/92 px-5 py-6 shadow-[var(--shadow)]">
                    <div className="flex justify-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#edf3ff] text-[#3569d4]">
                            <Send size={30} />
                        </div>
                    </div>
                    <h2 className={`${TYPO.sectionTitle} mt-5 text-center text-[#3569d4]`}>Send Funds</h2>

                    <Link
                        href="/send/wallet"
                        className="mt-8 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:bg-slate-50"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                                <Wallet size={22} />
                            </div>
                            <div>
                                <p className="text-[0.8rem] text-slate-900">Wallet Address</p>
                                <p className="mt-1 text-[0.95rem] text-slate-500">Send funds on chain</p>
                            </div>
                        </div>
                        <ChevronRight size={22} className="text-slate-400" />
                    </Link>
                </section>

            </div>
        </main>
    );
}
