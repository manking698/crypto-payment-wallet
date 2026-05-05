"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    ChevronRight,
    KeyRound
} from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import { TYPO } from "@/lib/typography";

export default function SettingsPage() {
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
        <main className="min-h-screen bg-[#f8fafc] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-8">
                <section className="flex items-center gap-3 pt-2">
                    <Link
                        href="/menu"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Settings</h1>
                </section>

                <section className="mt-7 overflow-hidden rounded-[1.5rem] border border-[#dce4f5] bg-white shadow-[var(--shadow)]">
                    <Link
                        href="/settings/change-password"
                        className="flex w-full items-center gap-3 px-4 py-4 text-left"
                    >
                        <KeyRound className="h-5 w-5 text-slate-700" />
                        <span className="flex-1 text-[0.90rem] text-slate-900">Change password</span>
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                    </Link>
                </section>
            </div>
        </main>
    );
}
