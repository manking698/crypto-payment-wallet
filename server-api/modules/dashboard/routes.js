"use strict";

function registerDashboardRoutes(app, deps) {
    const {
        requireAuth,
        authUserLimiter,
        dashboardService,
        observability
    } = deps || {};

    app.get("/api/dashboard/summary", requireAuth, authUserLimiter, async (req, res) => {
        try {
            observability?.logInfo(req, "dashboard.summary.requested", {
                route: "/api/dashboard/summary",
                email: req.authUser.email,
                defaultChainId: req.authUser.defaultChainId,
                vaultAddress: String(req.authVault?.vaultAddress || "").toLowerCase()
            });
            const payload = await dashboardService.getSummary(req.authUser, req.authVault);
            return res.json(payload);
        } catch (err) {
            observability?.logError(req, { event: "dashboard.summary.failed", route: "/api/dashboard/summary", operation: "dashboard-summary", fallbackCategory: "dashboard", error: err });
            return res.status(500).json({ error: "dashboard summary failed" });
        }
    });
}

module.exports = {
    registerDashboardRoutes
};
