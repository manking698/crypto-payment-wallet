"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Bell, ChevronLeft, CreditCard, Megaphone } from "lucide-react";
import { getNotificationUnreadCount, getNotifications, markNotificationRead } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
import { TYPO } from "@/lib/typography";
import { useAuthStore } from "@/store/auth-store";

type NotificationTab = "all" | "transaction" | "system";

function formatDateTime(input?: string | null) {
    if (!input) return "";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}

function NotificationTypeIcon(props: { type: AppNotification["type"] }) {
    if (props.type === "transaction") {
        return (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f4e2b5] text-[#8f6a1f]">
                <CreditCard size={22} />
            </div>
        );
    }
    return (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e7ddff] text-[#6a4bd9]">
            <Megaphone size={22} />
        </div>
    );
}

export default function NotificationsPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { token, hydrated } = useAuthStore();
    const [tab, setTab] = useState<NotificationTab>("all");

    const listQuery = useQuery({
        queryKey: ["notifications", token, tab],
        enabled: Boolean(token),
        queryFn: () => getNotifications({ type: tab, limit: 50 })
    });
    const countQuery = useQuery({
        queryKey: ["notifications-unread-count", token],
        enabled: Boolean(token),
        queryFn: getNotificationUnreadCount
    });
    const readMutation = useMutation({
        mutationFn: markNotificationRead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
        }
    });

    const items = useMemo(() => listQuery.data?.notifications || [], [listQuery.data?.notifications]);
    const unreadCount = Number(countQuery.data?.unreadCount || 0);

    const handleItemClick = async (item: AppNotification) => {
        if (!item.isRead && !readMutation.isPending) {
            try {
                await readMutation.mutateAsync(item.id);
            } catch {
                // ignore
            }
        }
        if (item.type === "transaction" && item.relatedTransactionId) {
            router.push(`/transactions/${item.relatedTransactionId}`);
        }
    };

    if (!hydrated) return null;
    if (!token) {
        router.replace("/login");
        return null;
    }

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#f3f8ff_52%,#f8fbff_100%)] px-4 py-6 text-slate-950">
            <div className="mx-auto w-full max-w-md pb-10">
                <section className="flex items-center gap-3 pt-2">
                    <button type="button" onClick={() => router.back()} className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
                        <ChevronLeft size={22} />
                    </button>
                    <h1 className={`${TYPO.pageTitle}`}>Notifications</h1>
                    <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[0.78rem] text-slate-600">
                        <Bell size={14} />
                        {unreadCount}
                    </div>
                </section>

                <section className="mt-6 rounded-[1.6rem] border border-white/80 bg-white/92 p-3 shadow-[var(--shadow)]">
                    <div className="rounded-xl border border-[#d8e6ff] bg-[#f8fbff] px-3 py-2">
                        <select
                            value={tab}
                            onChange={(event) => setTab(event.target.value as NotificationTab)}
                            className="h-8 w-full bg-transparent text-[0.95rem] font-medium text-slate-700 outline-none"
                        >
                            <option value="all">All</option>
                            <option value="transaction">Transaction</option>
                            <option value="system">System</option>
                        </select>
                    </div>
                </section>

                <section className="mt-4 rounded-[1.8rem] border border-white/80 bg-white/92 px-4 py-4 shadow-[var(--shadow)]">
                    {items.length ? (
                        <div className="space-y-2">
                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleItemClick(item)}
                                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${item.isRead ? "ui-state-unselected" : "ui-state-selected"}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <NotificationTypeIcon type={item.type} />
                                        <div className="min-w-0 flex-1">
                                            <p className={`truncate text-[0.95rem] ${item.isRead ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>{item.title}</p>
                                            <p className="mt-1 text-[0.84rem] text-slate-500">{item.message}</p>
                                            <p className="mt-1 text-[0.78rem] text-slate-400">{formatDateTime(item.createdAt)}</p>
                                        </div>
                                        <div className="pl-1">
                                            {!item.isRead ? <span className="mt-1 inline-block h-2 w-2 rounded-full bg-[#2f67d8]" /> : null}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-[0.92rem] text-slate-500">
                            No notifications
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
