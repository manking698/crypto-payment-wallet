"use strict";

function safeSerialize(value) {
    try {
        return JSON.stringify(value);
    } catch (_err) {
        return JSON.stringify({ fallback: String(value) });
    }
}

function createLogger(scope) {
    const name = String(scope || "app");

    function write(level, message, meta) {
        const payload = {
            ts: new Date().toISOString(),
            level,
            scope: name,
            msg: String(message || ""),
            ...(meta && typeof meta === "object" ? meta : {})
        };
        const line = safeSerialize(payload);
        if (level === "error") {
            // eslint-disable-next-line no-console
            console.error(line);
        } else {
            // eslint-disable-next-line no-console
            console.log(line);
        }
    }

    return {
        info(message, meta) {
            write("info", message, meta);
        },
        warn(message, meta) {
            write("warn", message, meta);
        },
        error(message, meta) {
            write("error", message, meta);
        }
    };
}

module.exports = {
    createLogger
};

