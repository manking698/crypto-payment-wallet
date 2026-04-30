"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, LifeBuoy, LogOut, Settings } from "lucide-react";
import { logout } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { TYPO } from "@/lib/typography";

export default function MainMenuPage() {
    const router = useRouter();
    const { token, hydrated, clearSession } = useAuthStore();

    if (!hydrated) {
        return (
            <main className="flex min-h-screen items-center justify-center px-6">
                <div className="rounded-2xl border border-white/80 bg-white px-5 py-4 text-sm text-slate-600 shadow-[var(--shadow)]">
                    <p>Restoring your session...</p>
                </div>
            </main>
        );
    }

    if (!token) {
        router.replace("/login");
        return null;
    }

    async function handleLogout() {
        try {
            await logout();
        } catch (_err) {
            // no-op
        } finally {
            clearSession();
            router.replace("/login");
        }
    }

    return (
        <main className="min-h-screen bg-[#f8fafc] px-4 py-6 text-slate-950">
            <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col pb-4">
                <section className="flex items-center gap-3 pt-2">
                    <Link
                        href="/dashboard"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Settings</h1>
                </section>

                <section className="mt-7 overflow-hidden rounded-[1.5rem] border border-[#dce4f5] bg-white shadow-[var(--shadow)]">
                    <Link href="/settings" className="flex w-full items-center gap-3 border-b border-[#e7edf8] px-4 py-4 text-left">
                        <Settings className="h-5 w-5 text-slate-700" />
                        <span className="flex-1 text-[1.1rem] text-slate-900">Settings</span>
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                    </Link>
                    <Link href="/support" className="flex w-full items-center gap-3 px-4 py-4 text-left">
                        <LifeBuoy className="h-5 w-5 text-slate-700" />
                        <span className="flex-1 text-[1.1rem] text-slate-900">Support</span>
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                    </Link>
                </section>

                <button
                    type="button"
                    onClick={handleLogout}
                    className="btn-theme-primary mt-auto flex h-12 w-full items-center justify-center gap-2 text-[0.98rem] font-medium"
                >
                    <LogOut size={17} />
                    Logout
                </button>
            </div>
        </main>
    );
}
