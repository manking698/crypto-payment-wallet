"use client";

import { PropsWithChildren, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth-store";

type ToastTone = "success" | "error";

type AppToastDetail = {
    message?: string;
    tone?: ToastTone;
    durationMs?: number;
};

export function AppProviders({ children }: PropsWithChildren) {
    const [queryClient] = useState(() => new QueryClient());
    const [toastMessage, setToastMessage] = useState("");
    const [, setToastTone] = useState<ToastTone>("success");
    const [toastVisible, setToastVisible] = useState(false);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        // Safety net: prevent indefinite "Restoring your session..." if persist rehydrate is blocked.
        const HYDRATION_RELOAD_KEY = "wallet.hydration.reload_once";
        const HYDRATION_DASHBOARD_REDIRECT_COUNT_KEY = "wallet.hydration.dashboard_redirect_count";
        const PERSIST_KEY = "wallet-app-auth";
        const persistApi = (useAuthStore as typeof useAuthStore & {
            persist?: {
                hasHydrated?: () => boolean;
                onFinishHydration?: (callback: () => void) => () => void;
                rehydrate?: () => Promise<void> | void;
            };
        }).persist;

        // iOS/Safari fallback: proactively restore auth from persisted JSON.
        const bootstrapFromStorage = () => {
            try {
                const raw = window.localStorage.getItem(PERSIST_KEY);
                if (!raw) return false;
                const parsed = JSON.parse(raw) as {
                    state?: { token?: string | null; user?: unknown };
                };
                const token = typeof parsed?.state?.token === "string" ? parsed.state.token : null;
                const user = (parsed?.state?.user ?? null) as unknown;
                if (token) {
                    useAuthStore.setState({
                        token,
                        user: (user as any) ?? null,
                    });
                }
                return true;
            } catch {
                return false;
            }
        };

        if (persistApi?.hasHydrated?.()) {
            useAuthStore.setState({ hydrated: true });
            return;
        }

        const markReadyIfHydrated = () => {
            if (persistApi?.hasHydrated?.()) {
                try {
                    window.sessionStorage.removeItem(HYDRATION_RELOAD_KEY);
                } catch {
                    // ignore storage errors
                }
                useAuthStore.setState({ hydrated: true });
                return true;
            }
            return false;
        };

        const unsubscribe = persistApi?.onFinishHydration?.(() => {
            markReadyIfHydrated();
        });

        // Some mobile browsers can stall hydration after restoring a suspended tab/session.
        // Retry rehydrate a few times, then force-unblock to avoid requiring manual refresh.
        let attempts = 0;
        const tryRehydrate = () => {
            if (useAuthStore.getState().hydrated) return;
            if (markReadyIfHydrated()) return;
            bootstrapFromStorage();
            attempts += 1;
            try {
                persistApi?.rehydrate?.();
            } catch {
                // ignore and rely on fallback below
            }
            if (attempts >= 4) {
                useAuthStore.setState({ hydrated: true });
            }
        };

        tryRehydrate();
        const retryTimer = window.setInterval(tryRehydrate, 900);
        const redirectToDashboardTimer = window.setInterval(() => {
            if (useAuthStore.getState().hydrated) return;
            if (markReadyIfHydrated()) return;

            let currentCount = 0;
            try {
                currentCount = Number(window.sessionStorage.getItem(HYDRATION_DASHBOARD_REDIRECT_COUNT_KEY) || "0");
            } catch {
                currentCount = 0;
            }

            // Avoid infinite loops: allow limited forced navigation attempts per tab session.
            if (!Number.isFinite(currentCount) || currentCount >= 3) return;

            try {
                window.sessionStorage.setItem(HYDRATION_DASHBOARD_REDIRECT_COUNT_KEY, String(currentCount + 1));
            } catch {
                // ignore storage errors
            }

            const path = window.location.pathname || "/";
            if (path !== "/dashboard") {
                window.location.replace("/dashboard");
                return;
            }
            window.location.reload();
        }, 3500);
        const onPageShow = () => {
            if (!markReadyIfHydrated()) {
                tryRehydrate();
            }
        };
        const onFocus = () => {
            if (!markReadyIfHydrated()) {
                tryRehydrate();
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                if (!markReadyIfHydrated()) {
                    tryRehydrate();
                }
            }
        };
        window.addEventListener("pageshow", onPageShow);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);

        const reloadTimer = window.setTimeout(() => {
            if (useAuthStore.getState().hydrated) return;
            try {
                const alreadyReloaded = window.sessionStorage.getItem(HYDRATION_RELOAD_KEY) === "1";
                if (!alreadyReloaded) {
                    window.sessionStorage.setItem(HYDRATION_RELOAD_KEY, "1");
                    window.location.reload();
                    return;
                }
            } catch {
                // ignore storage errors and continue to forced unblock
            }
            useAuthStore.setState({ hydrated: true });
        }, 2200);
        const fallbackTimer = window.setTimeout(() => {
            // Last chance restoration before force-unblock.
            bootstrapFromStorage();
            useAuthStore.setState({ hydrated: true });
        }, 3200);

        return () => {
            if (unsubscribe) unsubscribe();
            window.clearInterval(retryTimer);
            window.clearInterval(redirectToDashboardTimer);
            window.clearTimeout(reloadTimer);
            window.clearTimeout(fallbackTimer);
            window.removeEventListener("pageshow", onPageShow);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    const isShortToast = toastMessage.length > 0 && toastMessage.length < 50;

    useEffect(() => {
        const onToast = (event: Event) => {
            const customEvent = event as CustomEvent<AppToastDetail>;
            const message = String(customEvent.detail?.message || "").trim();
            if (!message) return;
            const tone = customEvent.detail?.tone === "error" ? "error" : "success";
            const durationMs = Number(customEvent.detail?.durationMs);
            const persistent = Number.isFinite(durationMs) && durationMs <= 0;
            const hideAfterMs = Number.isFinite(durationMs) && durationMs >= 1200 ? durationMs : 2500;

            setToastMessage(message);
            setToastTone(tone);
            setToastVisible(true);

            if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
            if (!persistent) {
                hideTimerRef.current = window.setTimeout(() => {
                    setToastVisible(false);
                }, hideAfterMs);
            }
        };

        window.addEventListener("app:toast", onToast as EventListener);
        return () => {
            window.removeEventListener("app:toast", onToast as EventListener);
            if (hideTimerRef.current) {
                window.clearTimeout(hideTimerRef.current);
            }
        };
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            {toastVisible ? (
                <div className="pointer-events-none fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[15vh]">
                    <div
                        className={`${isShortToast ? "inline-flex max-w-[92vw] whitespace-nowrap" : "w-full max-w-[92vw] whitespace-normal break-words sm:max-w-md"} rounded-md border border-blue-300/70 bg-blue-500/9 px-4 py-2 text-sm font-medium text-blue-900 shadow-[0_10px_24px_rgba(15,23,42,0.18)] backdrop-blur`}
                    >
                        {toastMessage}
                    </div>
                </div>
            ) : null}
        </QueryClientProvider>
    );
}
