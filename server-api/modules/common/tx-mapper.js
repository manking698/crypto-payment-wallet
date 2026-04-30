"use strict";

const { ethers } = require("ethers");
const { CHAIN_CONFIGS } = require("../../config/chainConfig");

function formatDisplayUnits(value, decimals, displayDecimals = 2) {
    const formatted = ethers.formatUnits(value, decimals);
    const [integerPartRaw, fractionPartRaw = ""] = formatted.split(".");
    const integerPart = integerPartRaw || "0";
    const groupedInteger = Number(integerPart).toLocaleString("en-US");
    const truncatedFraction = fractionPartRaw.slice(0, displayDecimals).replace(/0+$/, "");
    if (!truncatedFraction) return groupedInteger;
    return `${groupedInteger}.${truncatedFraction}`;
}

function formatUsdUnits(value, usdDecimals = 8) {
    return formatDisplayUnits(value, usdDecimals, 2);
}

function formatTokenUnits(value, decimals, displayDecimals = 2) {
    return formatDisplayUnits(value, decimals, displayDecimals);
}

function getExplorerBaseByChainId(chainId) {
    for (const chainKey in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainKey];
        if (Number(chain.chainId) === Number(chainId)) {
            return String(chain.blockExplorer || "").replace(/\/$/, "");
        }
    }
    return "";
}

function normalizeDirection(tx) {
    const rawDirection = String(tx?.direction || "").trim().toLowerCase();
    if (rawDirection) return rawDirection;

    const rawBridgeStatus = String(tx?.bridgeStatus || "").trim().toLowerCase();
    if (rawBridgeStatus === "card-payment") return "card-payment";

    const rawType = String(tx?.type || "").trim().toLowerCase();
    if (rawType.includes("card")) return "card-payment";
    if (rawType.includes("swap") || rawType.includes("convert")) return "swap";
    return "";
}

function normalizeTransactionStatus(tx) {
    const status = String(tx?.bridgeStatus || tx?.status || "").trim().toLowerCase();
    if (!status) return "";
    if (status === "card-payment") return "COMPLETED";
    if (status === "done" || status === "completed") return "COMPLETED";
    if (status === "pending") return "PENDING";
    return "FAILED";
}

function mapTransactionForClient(tx) {
    const chainId = Number(tx?.chainId || 11155111);
    const explorerBase = getExplorerBaseByChainId(chainId);
    const txHash = String(tx?.txHash || "");

    return {
        id: String(tx?._id || ""),
        chainId,
        txHash,
        from: String(tx?.from || ""),
        to: String(tx?.to || ""),
        origSender: String(tx?.origSender || tx?.from || ""),
        amount: String(tx?.amount || "0"),
        tokenSymbol: String(tx?.tokenSymbol || ""),
        direction: normalizeDirection(tx),
        type: String(tx?.type || ""),
        bridgeStatus: String(tx?.bridgeStatus || tx?.status || ""),
        normalizedStatus: normalizeTransactionStatus(tx),
        timestamp: tx?.timestamp ? new Date(tx.timestamp).toISOString() : null,
        sourceLink: txHash && explorerBase ? `${explorerBase}/tx/${txHash}` : "",
        merchant: String(tx?.merchant || tx?.name || ""),
        title: String(tx?.title || ""),
        country: String(tx?.country || tx?.source || ""),
        amountPrimary: String(tx?.amountPrimary || ""),
        amountSecondary: String(tx?.amountSecondary || ""),
        reward: String(tx?.reward || ""),
        paymentId: String(tx?.paymentId || ""),
        cardLast4: String(tx?.cardLast4 || ""),
        swapFromSymbol: String(tx?.swapFromSymbol || ""),
        swapToSymbol: String(tx?.swapToSymbol || ""),
        swapFromAmount: String(tx?.swapFromAmount || ""),
        swapToAmount: String(tx?.swapToAmount || "")
    };
}

module.exports = {
    formatDisplayUnits,
    formatUsdUnits,
    formatTokenUnits,
    getExplorerBaseByChainId,
    normalizeDirection,
    normalizeTransactionStatus,
    mapTransactionForClient
};

