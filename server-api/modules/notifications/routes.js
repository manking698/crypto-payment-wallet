"use strict";

function registerNotificationRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        notificationsService,
        observability
    } = deps || {};

    app.get("/api/notifications", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const notifications = await notificationsService.listByUser(
                req.authUser._id,
                req.query?.type || "all",
                req.query?.limit || 20
            );
            return res.json({ notifications });
        } catch (err) {
            observability?.logError(req, { event: "notifications.list.failed", route: "/api/notifications", operation: "notifications-list", fallbackCategory: "notifications", error: err });
            return res.status(500).json({ error: "notification list failed" });
        }
    });

    app.get("/api/notifications/unread-count", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const unreadCount = await notificationsService.getUnreadCount(req.authUser._id);
            return res.json({ unreadCount });
        } catch (err) {
            observability?.logError(req, { event: "notifications.unread_count.failed", route: "/api/notifications/unread-count", operation: "notifications-unread-count", fallbackCategory: "notifications", error: err });
            return res.status(500).json({ error: "notification unread count failed" });
        }
    });

    app.post("/api/notifications/:id/read", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const id = String(req.params.id || "").trim();
            const result = await notificationsService.markRead(req.authUser._id, id);
            return res.json({ success: true, unreadCount: result.unreadCount, notification: result.notification });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: "invalid notification id" });
            if (err?.status === 404) return res.status(404).json({ error: "notification not found" });
            observability?.logError(req, { event: "notifications.read.failed", route: "/api/notifications/:id/read", operation: "notifications-read", fallbackCategory: "notifications", error: err });
            return res.status(500).json({ error: "notification update failed" });
        }
    });

    app.post("/api/notifications/system", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const notification = await notificationsService.createSystemNotification(
                req.authUser._id,
                req.body?.title,
                req.body?.message
            );
            return res.status(201).json({ success: true, notification });
        } catch (err) {
            if (err?.status === 400) return res.status(400).json({ error: "title and message are required" });
            observability?.logError(req, { event: "notifications.system_create.failed", route: "/api/notifications/system", operation: "notifications-system-create", fallbackCategory: "notifications", error: err });
            return res.status(500).json({ error: "notification create failed" });
        }
    });
}

module.exports = {
    registerNotificationRoutes
};
