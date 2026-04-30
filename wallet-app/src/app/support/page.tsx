"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LifeBuoy, Mail, Send } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import { TYPO } from "@/lib/typography";

export default function SupportPage() {
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
                    <h1 className={`${TYPO.pageTitle}`}>Support</h1>
                </section>

                <section className="mt-8 rounded-[1.8rem] border border-white/80 bg-white/92 px-6 py-10 text-center shadow-[var(--shadow)]">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#d8e3f8] bg-[#f4f8ff] text-[#4a73bf]">
                        <LifeBuoy size={28} />
                    </div>
                    <p className="mt-5 text-[0.95rem] text-slate-500">
                        If you need help, contact us by email.
                    </p>

                    <div className="mx-auto mt-5 flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                            <Mail size={18} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[0.82rem] text-slate-500">Email contact</p>
                            <p className="truncate text-[0.98rem] font-medium text-slate-900">tekwei82@hotmail.com</p>
                        </div>
                    </div>

                    <a
                        href="mailto:tekwei82@hotmail.com?subject=Crypto%20Wallet%20Support"
                        className="btn-theme-primary mx-auto mt-4 flex h-9 w-full max-w-sm items-center justify-center gap-2 px-4 text-[0.92rem] font-medium"
                    >
                        <Send size={16} />
                        Send Email
                    </a>
                </section>
            </div>
        </main>
    );
}
