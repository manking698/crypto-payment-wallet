"use strict";

function createRequireAuth(input) {
    const {
        tokenService,
        computeVaultAddress,
        userVaultService
    } = input || {};

    return async function requireAuth(req, res, next) {
        try {
            const token = tokenService.getAuthToken(req);
            if (!token) {
                return res.status(401).json({ error: "missing auth token" });
            }

            const { payload, user } = await tokenService.verifyAuthToken(token);
            if (!user) {
                return res.status(401).json({ error: "user not found" });
            }

            const chainId = Number(payload.defaultChainId || user.defaultChainId || 11155111);
            const fallbackAddress = await computeVaultAddress(user.email);
            const vaultRecord = await userVaultService.ensureUserVault(user, chainId)
                || await userVaultService.ensureUserVaultByAddress(chainId, fallbackAddress);

            req.authUser = user;
            req.authVault = vaultRecord || null;
            return next();
        } catch (_err) {
            return res.status(401).json({ error: "invalid auth token" });
        }
    };
}

module.exports = {
    createRequireAuth
};

