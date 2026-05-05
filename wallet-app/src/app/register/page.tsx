"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LoaderCircle, UserPlus } from "lucide-react";
import { registerAccount } from "@/lib/api";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

const registerSchema = z.object({
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Please confirm your password."),
}).refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
});

type RegisterValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
    const router = useRouter();
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const setSession = useAuthStore((state) => state.setSession);
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting, isValid },
        setError,
    } = useForm<RegisterValues>({
        resolver: zodResolver(registerSchema),
        mode: "onBlur",
        reValidateMode: "onChange",
        defaultValues: {
            email: "",
            password: "",
            confirmPassword: "",
        },
    });

    useEffect(() => {
        if (hydrated && token) {
            router.replace("/dashboard");
        }
    }, [hydrated, router, token]);

    const onSubmit = handleSubmit(async (values) => {
        try {
            const result = await registerAccount({
                email: values.email,
                password: values.password,
            });
            if ("token" in result) {
                window.dispatchEvent(new CustomEvent("app:toast", {
                    detail: {
                        message: "Register completed. Redirecting",
                        tone: "success",
                        durationMs: 2400
                    }
                }));
                setSession(result.token, result.user);
                router.replace("/dashboard");
                return;
            }

            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: {
                    message: "Registration submitted. Please login in a while",
                    tone: "success",
                    durationMs: 3000
                }
            }));
            router.replace(`/login?email=${encodeURIComponent(values.email)}`);
        } catch (err) {
            window.dispatchEvent(new CustomEvent("app:toast", {
                detail: {
                    message: err instanceof Error ? err.message : "Register failed",
                    tone: "error",
                    durationMs: 3600
                }
            }));
            setError("root", {
                message: err instanceof Error ? err.message : "Register failed",
            });
        }
    });

    return (
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
            <section className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-[var(--shadow)] backdrop-blur xl:grid-cols-[0.98fr_1.02fr]">
                <div className="flex items-center justify-center px-6 py-10 sm:px-10">
                    <div className="w-full max-w-md space-y-8">
                        <div className="space-y-3">
                            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-soft)] px-4 py-2 text-sm font-semibold text-[var(--brand)]">
                                <UserPlus size={16} />
                                Register wallet account
                            </span>
                            <div>
                                <h2 className={`${TYPO.formTitle}`}>Create account</h2>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    Your email will map to a vault address for this prototype.
                                </p>
                            </div>
                        </div>

                        <form className="space-y-5" onSubmit={onSubmit}>
                            <label className="block space-y-2">
                                <span className="text-sm font-semibold text-slate-700">Email</span>
                                <input
                                    {...register("email")}
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-blue-100"
                                />
                                {errors.email ? <p className="text-sm text-[var(--danger)]">{errors.email.message}</p> : null}
                            </label>

                            <label className="block space-y-2">
                                <span className="text-sm font-semibold text-slate-700">Password</span>
                                <div className="relative">
                                    <input
                                        {...register("password")}
                                        type={showPassword ? "text" : "password"}
                                        placeholder="At least 8 characters"
                                        className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 pr-12 text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-blue-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        className="absolute inset-y-0 right-3 flex items-center text-slate-500"
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                {errors.password ? <p className="text-sm text-[var(--danger)]">{errors.password.message}</p> : null}
                            </label>

                            <label className="block space-y-2">
                                <span className="text-sm font-semibold text-slate-700">Confirm password</span>
                                <div className="relative">
                                    <input
                                        {...register("confirmPassword")}
                                        type={showConfirmPassword ? "text" : "password"}
                                        placeholder="Repeat your password"
                                        className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 pr-12 text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-blue-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                                        className="absolute inset-y-0 right-3 flex items-center text-slate-500"
                                        aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                                    >
                                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                {errors.confirmPassword ? <p className="text-sm text-[var(--danger)]">{errors.confirmPassword.message}</p> : null}
                            </label>

                            {errors.root ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {errors.root.message}
                                </div>
                            ) : null}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                                Prototype note: email verification is not required at this stage.
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting || !isValid}
                                className="btn-theme-primary inline-flex h-9 w-full items-center justify-center gap-2 px-4 text-[0.95rem] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {isSubmitting ? <LoaderCircle className="animate-spin" size={18} /> : null}
                                {isSubmitting ? "Please wait..." : "Register"}
                            </button>
                            {isSubmitting ? (
                                <p className="text-center text-sm text-slate-500">
                                    Please wait...
                                </p>
                            ) : null}
                        </form>

                        <p className="text-sm text-slate-500">
                            Already registered?{" "}
                            <Link href="/login" className="font-semibold text-[var(--brand)]">
                                Back to login
                            </Link>
                        </p>
                    </div>
                </div>

                <div className="hidden bg-[linear-gradient(160deg,#eaf2ff_0%,#f5f9ff_56%,#eef5ff_100%)] px-12 py-14 xl:flex xl:flex-col xl:justify-between">
                    <div className="space-y-5">
                        <span className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-sky-700 shadow-sm">
                            Simple and friendly light UI
                        </span>
                        <div className="space-y-4">
                    <h1 className={`${TYPO.heroTitleDesktop} text-slate-900`}>
                                A cleaner wallet flow built around your vault, not around chaos.
                            </h1>
                            <p className="max-w-xl text-lg leading-8 text-slate-600">
                                We are replacing the old hard-to-follow React flow with a clearer register, login, and dashboard experience.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {[
                            "Email becomes the vault identity input.",
                            "Default vault chain is ETH Sepolia (11155111).",
                            "Dashboard stays familiar, but the codebase stays clean.",
                        ].map((item) => (
                            <div key={item} className="rounded-2xl border border-[#d8e6ff] bg-white px-5 py-4 text-sm text-slate-600">
                                {item}
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </main>
    );
}
