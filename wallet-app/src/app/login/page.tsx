"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LoaderCircle, LogIn } from "lucide-react";
import { login } from "@/lib/api";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

const loginSchema = z.object({
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
});

type LoginValues = z.infer<typeof loginSchema>;

function LoginPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [showPassword, setShowPassword] = useState(false);
    const setSession = useAuthStore((state) => state.setSession);
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        setError,
        setValue,
        watch,
    } = useForm<LoginValues>({
        resolver: zodResolver(loginSchema),
        mode: "onBlur",
        reValidateMode: "onChange",
        defaultValues: {
            email: "",
            password: "",
        },
    });

    useEffect(() => {
        if (hydrated && token) {
            router.replace("/dashboard");
        }
    }, [hydrated, router, token]);

    useEffect(() => {
        const email = String(searchParams.get("email") || "").trim();
        if (!email) return;
        setValue("email", email, { shouldValidate: true, shouldDirty: true });
    }, [searchParams, setValue]);

    const emailInput = watch("email");
    const isEmailFormatValid = z.string().email().safeParse(String(emailInput || "").trim()).success;

    const onSubmit = handleSubmit(async (values) => {
        try {
            const result = await login(values);
            setSession(result.token, result.user);
            router.replace("/dashboard");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Login failed.";
            if (message.includes("registration is still processing")) {
                setError("root", {
                    message: "Wallet setup is still in progress. Please try again shortly.",
                });
                return;
            }
            if (message.includes("wallet setup is retrying")) {
                setError("root", {
                    message: "Wallet setup retrying. Please try again shortly.",
                });
                return;
            }
            setError("root", {
                message,
            });
        }
    });

    return (
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
            <section className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/70 bg-white/80 shadow-[var(--shadow)] backdrop-blur xl:grid-cols-[1.05fr_0.95fr]">
                <div className="hidden bg-[linear-gradient(160deg,#eaf2ff_0%,#f5f9ff_52%,#eef5ff_100%)] px-12 py-14 xl:flex xl:flex-col xl:justify-between">
                    <div className="space-y-5">
                        <span className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-sky-700 shadow-sm">
                            Cryptocurrency Vault Wallet S
                        </span>
                        <div className="space-y-4">
                            <h1 className={`${TYPO.heroTitleDesktop} text-slate-900`}>
                                Login and manage your vault wallet with less friction.
                            </h1>
                            <p className="max-w-xl text-lg leading-8 text-slate-600">
                                Email-based access, ETH Sepolia default vault creation, and a cleaner dashboard flow built for deposit and withdrawal.
                            </p>
                        </div>
                    </div>
                    <div className="grid gap-4">
                        {[
                            "Email login stays active until you logout.",
                            "Vault address stays mapped to your account.",
                            "Bridge and monitor logic remain on your existing backend.",
                        ].map((item) => (
                            <div key={item} className="rounded-2xl border border-[#d8e6ff] bg-white px-5 py-4 text-sm text-slate-600">
                                {item}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-center px-6 py-10 sm:px-10">
                    <div className="w-full max-w-md space-y-8">
                        <div className="space-y-3">
                            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-soft)] px-4 py-2 text-sm font-semibold text-[var(--brand)]">
                                <LogIn size={16} />
                                Welcome back
                            </span>
                            <div>
                                <h2 className={`${TYPO.formTitle}`}>Login</h2>
                                <p className="mt-2 text-sm leading-6 text-slate-500">
                                    Sign in with your email and password to continue to your wallet dashboard.
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
                                        placeholder="Enter your password"
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

                            {errors.root ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {errors.root.message}
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                disabled={isSubmitting || !isEmailFormatValid}
                                className="btn-theme-primary inline-flex h-9 w-full items-center justify-center gap-2 px-4 text-[0.95rem] font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {isSubmitting ? <LoaderCircle className="animate-spin" size={18} /> : null}
                                {isSubmitting ? "Signing in..." : "Login"}
                            </button>
                        </form>

                        <p className="text-sm text-slate-500">
                            New here?{" "}
                            <Link href="/register" className="font-semibold text-[var(--brand)]">
                                Create your wallet account
                            </Link>
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginPageContent />
        </Suspense>
    );
}
