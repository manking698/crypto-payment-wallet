"use strict";

function mapNotificationForClient(item) {
    return {
        id: String(item?._id || ""),
        type: String(item?.type || "system"),
        title: String(item?.title || ""),
        message: String(item?.message || ""),
        isRead: Boolean(item?.isRead),
        relatedTransactionId: item?.relatedTransactionId ? String(item.relatedTransactionId) : "",
        paymentId: item?.paymentId ? String(item.paymentId) : "",
        createdAt: item?.createdAt ? new Date(item.createdAt).toISOString() : null
    };
}

function createNotificationsService(deps) {
    const { Notification, mongoose } = deps;

    async function createNotification(input) {
        const userId = input?.userId;
        if (!userId) return null;
        return Notification.create({
            userId,
            type: String(input?.type || "system"),
            title: String(input?.title || "").trim() || "Notification",
            message: String(input?.message || "").trim() || "",
            isRead: false,
            relatedTransactionId: input?.relatedTransactionId || null,
            paymentId: input?.paymentId || null,
            createdAt: new Date(),
            readAt: null
        });
    }

    async function listByUser(userId, type = "all", limit = 20) {
        const safeLimit = Math.min(50, Math.max(1, Number.parseInt(String(limit || "20"), 10) || 20));
        const typeRaw = String(type || "all").toLowerCase();
        const query = { userId };
        if (typeRaw === "transaction" || typeRaw === "system") {
            query.type = typeRaw;
        }
        const rows = await Notification.find(query).sort({ createdAt: -1, _id: -1 }).limit(safeLimit).lean();
        return rows.map(mapNotificationForClient);
    }

    async function getUnreadCount(userId) {
        return Notification.countDocuments({ userId, isRead: false });
    }

    async function markRead(userId, id) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            const err = new Error("invalid notification id");
            err.status = 400;
            throw err;
        }
        const updated = await Notification.findOneAndUpdate(
            { _id: id, userId },
            { $set: { isRead: true, readAt: new Date() } },
            { returnDocument: "after" }
        ).lean();
        if (!updated) {
            const err = new Error("notification not found");
            err.status = 404;
            throw err;
        }
        const unreadCount = await getUnreadCount(userId);
        return { unreadCount, notification: mapNotificationForClient(updated) };
    }

    async function createSystemNotification(userId, title, message) {
        const cleanTitle = String(title || "").trim();
        const cleanMessage = String(message || "").trim();
        if (!cleanTitle || !cleanMessage) {
            const err = new Error("title and message are required");
            err.status = 400;
            throw err;
        }
        const created = await createNotification({
            userId,
            type: "system",
            title: cleanTitle.slice(0, 80),
            message: cleanMessage.slice(0, 300)
        });
        return mapNotificationForClient(created);
    }

    return {
        createNotification,
        listByUser,
        getUnreadCount,
        markRead,
        createSystemNotification
    };
}

module.exports = { createNotificationsService };

