"use strict";

function registerAuthRoutes(app, deps) {
    const {
        authLimiter,
        authUserLimiter,
        requireAuth,
        User,
        UserVault,
        bcrypt,
        deployVault,
        computeVaultAddress,
        createNotification,
        tokenService,
        profileService,
        authSecurityService,
        userVaultService,
        provisioningService,
        observability
    } = deps || {};

    app.post("/api/auth/register", authLimiter, async (req, res) => {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");

        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: "password must be at least 8 characters" });
        }

        const existingUser = await User.findOne({ email }).lean();
        if (existingUser) {
            return res.status(409).json({ error: "email already registered" });
        }

        try {
            if (provisioningService) {
                const passwordHash = await bcrypt.hash(password, 10);
                const user = await User.create({
                    email,
                    passwordHash,
                    defaultChainId: 11155111,
                    registrationStatus: "PENDING_VAULT",
                    registrationRequestedAt: new Date(),
                    lastLoginAt: null
                });
                await provisioningService.enqueueForUser(user._id);
                return res.status(202).json({
                    success: true,
                    status: "PENDING_VAULT",
                    message: "registration submitted, wallet setup is in progress"
                });
            }

            const salt = deployVault.getSalt(email);
            const deployResult = await deployVault.deploy(11155111, salt);
            if (!deployResult.result && deployResult.message !== "already deployed") {
                return res.status(500).json({ error: deployResult.message || "vault deploy failed" });
            }

            const vaultAddress = String(deployResult.address || await computeVaultAddress(email)).toLowerCase();
            const passwordHash = await bcrypt.hash(password, 10);
            const user = await User.create({
                email,
                passwordHash,
                defaultChainId: 11155111,
                lastLoginAt: new Date()
            });
            await UserVault.create({
                userId: user._id,
                chainId: 11155111,
                vaultAddress,
                salt
            });
            await createNotification({
                userId: user._id,
                type: "system",
                title: "Welcome",
                message: "Your wallet account is ready"
            });

            return res.status(201).json({
                token: tokenService.createAuthToken(user),
                user: profileService.buildUserProfile(user, {
                    vaultAddress,
                    chainId: 11155111
                })
            });
        } catch (err) {
            observability?.logError(req, { event: "auth.register.failed", route: "/api/auth/register", operation: "register", fallbackCategory: "auth", error: err });
            return res.status(500).json({ error: "register failed: " + err.message });
        }
    });

    app.post("/api/auth/login", authLimiter, async (req, res) => {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const loginKey = authSecurityService.buildLoginKey(email);
        const lockState = authSecurityService.getLoginLockState(loginKey);

        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }
        if (lockState.blocked) {
            res.setHeader("Retry-After", String(lockState.retryAfterSec || 60));
            return res.status(429).json({ error: "too many failed login attempts, please try again later" });
        }

        try {
            const user = await User.findOne({ email });
            if (!user) {
                authSecurityService.registerLoginFailure(loginKey);
                return res.status(401).json({ error: "invalid email or password" });
            }

            const isValid = await bcrypt.compare(password, user.passwordHash);
            if (!isValid) {
                authSecurityService.registerLoginFailure(loginKey);
                return res.status(401).json({ error: "invalid email or password" });
            }
            const registrationStatus = String(user.registrationStatus || "ACTIVE");
            if (registrationStatus === "PENDING_VAULT") {
                authSecurityService.clearLoginFailure(loginKey);
                return res.status(409).json({
                    error: "registration is still processing, please try again shortly",
                    code: "REGISTRATION_IN_PROGRESS"
                });
            }
            if (registrationStatus === "FAILED") {
                authSecurityService.clearLoginFailure(loginKey);
                return res.status(409).json({
                    error: "wallet setup is retrying, please try again shortly",
                    code: "REGISTRATION_RETRYING"
                });
            }

            authSecurityService.clearLoginFailure(loginKey);
            user.lastLoginAt = new Date();
            await user.save();
            const fallbackAddress = await computeVaultAddress(user.email);
            const vaultRecord = await userVaultService.ensureUserVault(user, user.defaultChainId || 11155111)
                || await userVaultService.ensureUserVaultByAddress(user.defaultChainId || 11155111, fallbackAddress);

            return res.json({
                token: tokenService.createAuthToken(user),
                user: profileService.buildUserProfile(user, vaultRecord)
            });
        } catch (err) {
            observability?.logError(req, { event: "auth.login.failed", route: "/api/auth/login", operation: "login", fallbackCategory: "auth", error: err });
            return res.status(500).json({ error: "login failed: " + err.message });
        }
    });

    app.post("/api/auth/registration-status", authLimiter, async (req, res) => {
        const email = String(req.body?.email || "").trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: "email is required" });
        }
        try {
            const user = await User.findOne({ email }).lean();
            if (!user) {
                return res.status(404).json({ error: "account not found" });
            }
            const registrationStatus = String(user.registrationStatus || "ACTIVE");
            return res.json({
                status: registrationStatus,
                ready: registrationStatus === "ACTIVE"
            });
        } catch (err) {
            observability?.logError(req, { event: "auth.registration_status.failed", route: "/api/auth/registration-status", operation: "registration-status", fallbackCategory: "auth", error: err });
            return res.status(500).json({ error: "registration status query failed" });
        }
    });

    app.get("/api/auth/me", requireAuth, (req, res) => {
        return res.json({
            user: profileService.buildUserProfile(req.authUser, req.authVault)
        });
    });

    app.post("/api/auth/logout", (_req, res) => {
        return res.json({ success: true });
    });

    app.post("/api/auth/change-password", requireAuth, authUserLimiter, async (req, res) => {
        try {
            const oldPassword = String(req.body?.oldPassword || "");
            const newPassword = String(req.body?.newPassword || "");
            const confirmPassword = String(req.body?.confirmPassword || "");

            if (!oldPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({ error: "old password, new password and confirm password are required" });
            }
            if (newPassword.length < 8) {
                return res.status(400).json({ error: "new password must be at least 8 characters" });
            }
            if (newPassword !== confirmPassword) {
                return res.status(400).json({ error: "new password and confirm password do not match" });
            }
            if (oldPassword === newPassword) {
                return res.status(400).json({ error: "new password must be different from old password" });
            }

            const userDoc = await User.findById(req.authUser._id);
            if (!userDoc) {
                return res.status(404).json({ error: "user not found" });
            }

            const matched = await bcrypt.compare(oldPassword, String(userDoc.passwordHash || ""));
            if (!matched) {
                return res.status(400).json({ error: "old password is incorrect" });
            }

            userDoc.passwordHash = await bcrypt.hash(newPassword, 10);
            await userDoc.save();

            return res.json({ success: true, message: "password changed" });
        } catch (err) {
            observability?.logError(req, { event: "auth.change_password.failed", route: "/api/auth/change-password", operation: "change-password", fallbackCategory: "auth", error: err });
            return res.status(500).json({ error: "change password failed" });
        }
    });
}

module.exports = {
    registerAuthRoutes
};
