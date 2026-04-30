"use strict";

function createTokenService({
    jwt,
    User,
    jwtSecret,
    jwtExpiresIn,
    jwtIssuer,
    jwtAudience
}) {
    function createAuthToken(user) {
        return jwt.sign(
            {
                sub: String(user._id),
                email: user.email,
                defaultChainId: user.defaultChainId
            },
            jwtSecret,
            {
                expiresIn: jwtExpiresIn,
                issuer: jwtIssuer,
                audience: jwtAudience,
                algorithm: "HS256"
            }
        );
    }

    function getAuthToken(req) {
        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) return "";
        return authHeader.slice(7).trim();
    }

    async function verifyAuthToken(token) {
        const payload = jwt.verify(token, jwtSecret, {
            issuer: jwtIssuer,
            audience: jwtAudience,
            algorithms: ["HS256"]
        });
        const user = await User.findById(payload.sub).lean();
        return { payload, user };
    }

    return {
        createAuthToken,
        getAuthToken,
        verifyAuthToken
    };
}

module.exports = {
    createTokenService
};

