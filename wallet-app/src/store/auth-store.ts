"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserProfile } from "@/lib/types";

type AuthState = {
    token: string | null;
    user: UserProfile | null;
    hydrated: boolean;
    setSession: (token: string, user: UserProfile) => void;
    setUser: (user: UserProfile | null) => void;
    clearSession: () => void;
    setHydrated: (hydrated: boolean) => void;
};

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            user: null,
            hydrated: false,
            setSession: (token, user) => set({ token, user }),
            setUser: (user) => set({ user }),
            clearSession: () => set({ token: null, user: null }),
            setHydrated: (hydrated) => set({ hydrated }),
        }),
        {
            name: "wallet-app-auth",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                token: state.token,
                user: state.user,
            }),
            merge: (persisted, current) => ({
                ...current,
                ...(persisted as Partial<AuthState>),
                hydrated: current.hydrated,
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.warn("[auth-store] rehydrate failed:", error);
                }
                state?.setHydrated(true);
            },
        }
    )
);
