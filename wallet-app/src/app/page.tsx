"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export default function HomePage() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);

    useEffect(() => {
        if (!hydrated) return;
        router.replace(token ? "/dashboard" : "/login");
    }, [hydrated, router, token]);

    return null;
}
