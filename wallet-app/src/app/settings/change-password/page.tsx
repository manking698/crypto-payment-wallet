"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { changePassword } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { TYPO } from "@/lib/typography";

function notify(message: string, type: "success" | "error" = "success", durationMs: number = 5000) {
    window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, type, durationMs } }));
}

export default function ChangePasswordPage() {
    const router = useRouter();
    const { token, hydrated } = useAuthStore();

    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const canSubmit = useMemo(() => {
        return oldPassword.length >= 8 && newPassword.length >= 8 && confirmPassword.length >= 8 && !submitting;
    }, [oldPassword, newPassword, confirmPassword, submitting]);

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

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting) return;

        if (newPassword !== confirmPassword) {
            notify("New password and confirm password do not match", "error", 5000);
            return;
        }

        setSubmitting(true);
        try {
            await changePassword({
                oldPassword,
                newPassword,
                confirmPassword
            });
            notify("Saved", "success", 5000);
            router.replace("/settings");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Change password failed";
            notify(message, "error", 5000);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="min-h-screen bg-[#f8fafc] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-8">
                <section className="flex items-center gap-3 pt-2">
                    <Link
                        href="/settings"
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                        <ArrowLeft size={22} />
                    </Link>
                    <h1 className={`${TYPO.pageTitle}`}>Change Password</h1>
                </section>

                <form
                    onSubmit={handleSubmit}
                    className="mt-6 rounded-[1.6rem] border border-[#dce4f5] bg-white px-4 py-5 shadow-[var(--shadow)]"
                >
                    <label className="mb-2 block text-[1rem] font-semibold text-slate-800">Old password</label>
                    <div className="mb-4 flex h-14 items-center rounded-[1rem] border border-[#d6e0f4] bg-white px-4">
                        <input
                            type={showOld ? "text" : "password"}
                            value={oldPassword}
                            onChange={(event) => setOldPassword(event.target.value)}
                            className="h-full w-full bg-transparent text-[1.05rem] text-slate-900 outline-none"
                            autoComplete="current-password"
                            required
                        />
                        <button type="button" onClick={() => setShowOld((v) => !v)} className="text-slate-500">
                            {showOld ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>

                    <label className="mb-2 block text-[1rem] font-semibold text-slate-800">New password</label>
                    <div className="mb-4 flex h-14 items-center rounded-[1rem] border border-[#d6e0f4] bg-white px-4">
                        <input
                            type={showNew ? "text" : "password"}
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            className="h-full w-full bg-transparent text-[1.05rem] text-slate-900 outline-none"
                            autoComplete="new-password"
                            required
                        />
                        <button type="button" onClick={() => setShowNew((v) => !v)} className="text-slate-500">
                            {showNew ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>

                    <label className="mb-2 block text-[1rem] font-semibold text-slate-800">Confirm password</label>
                    <div className="mb-5 flex h-14 items-center rounded-[1rem] border border-[#d6e0f4] bg-white px-4">
                        <input
                            type={showConfirm ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            className="h-full w-full bg-transparent text-[1.05rem] text-slate-900 outline-none"
                            autoComplete="new-password"
                            required
                        />
                        <button type="button" onClick={() => setShowConfirm((v) => !v)} className="text-slate-500">
                            {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={!canSubmit}
                        className="h-12 w-full rounded-[0.95rem] bg-[#4168c9] text-[1.05rem] font-semibold text-white disabled:opacity-50"
                    >
                        Confirm
                    </button>
                </form>
            </div>
        </main>
    );
}
