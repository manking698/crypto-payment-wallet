"use strict";

function createSwapError(status, message, extra = {}) {
    const err = new Error(message || "swap failed");
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function createSwapOrchestrator(deps) {
    const {
        ethers,
        provider,
        backendSigner,
        TOKENS,
        TOKEN_DECIMALS_BY_SYMBOL,
        VAULT_SWAP_ABI,
        ERC20_ABI,
        normalizeSwapSymbol,
        validateSwapInput,
        decimalToScaledBigInt,
        scaledBigIntToDecimal,
        getVaultTokenSnapshot,
        getFrozenTokenRawByVault,
        applyFrozenBalanceToSnapshot,
        buildSwapQuoteBySnapshot,
        swapService
    } = deps;

    function getSwapInputMaxDecimals(fromSymbol, fromDecimals) {
        if (String(fromSymbol || "").toUpperCase() === "WETH") return 8;
        return Number(fromDecimals || 0) >= 18 ? 8 : 6;
    }

    function assertSwapInputDecimals(amountText, fromSymbol, fromDecimals) {
        const text = String(amountText || "").trim();
        if (!/^\d+(\.\d+)?$/.test(text)) throw createSwapError(400, "invalid amount");
        const fraction = text.includes(".") ? (text.split(".")[1] || "") : "";
        const maxInputDecimals = getSwapInputMaxDecimals(fromSymbol, fromDecimals);
        if (fraction.length > maxInputDecimals) {
            throw createSwapError(400, `max ${maxInputDecimals} decimals allowed`);
        }
    }

    function parseSwapRequest(reqBody) {
        if (typeof validateSwapInput === "function") {
            const parsed = validateSwapInput(reqBody);
            if (!parsed.ok) throw createSwapError(400, parsed.error);
            assertSwapInputDecimals(parsed.amount, parsed.fromSymbol, parsed.fromDecimals);
            return parsed;
        }
        const fromSymbol = normalizeSwapSymbol(reqBody?.fromSymbol);
        const toSymbol = normalizeSwapSymbol(reqBody?.toSymbol);
        const amount = String(reqBody?.amount || "").trim();

        if (!fromSymbol || !toSymbol) throw createSwapError(400, "invalid token symbol");
        if (fromSymbol === toSymbol) throw createSwapError(400, "source and target token cannot be same");
        if (!/^\d+(\.\d+)?$/.test(amount)) throw createSwapError(400, "invalid amount");

        const fromDecimals = TOKEN_DECIMALS_BY_SYMBOL[fromSymbol];
        const toDecimals = TOKEN_DECIMALS_BY_SYMBOL[toSymbol];
        assertSwapInputDecimals(amount, fromSymbol, fromDecimals);
        const fromAmountRaw = decimalToScaledBigInt(amount, fromDecimals);
        if (fromAmountRaw <= 0n) throw createSwapError(400, "amount must be greater than zero");
        return { fromSymbol, toSymbol, amount, fromAmountRaw, fromDecimals, toDecimals };
    }

    async function quote(reqBody, vaultAddress) {
        if (!vaultAddress) throw createSwapError(400, "missing vault address");
        const { fromSymbol, toSymbol, fromAmountRaw, fromDecimals } = parseSwapRequest(reqBody);

        const { snapshot: onchainSnapshot } = await getVaultTokenSnapshot(vaultAddress);
        const frozenBySymbol = await getFrozenTokenRawByVault(vaultAddress);
        const { snapshot } = applyFrozenBalanceToSnapshot(onchainSnapshot, frozenBySymbol);
        const fromToken = snapshot[fromSymbol];
        const toToken = snapshot[toSymbol];
        if (!fromToken || !toToken) throw createSwapError(400, "token not available");
        if (fromToken.balanceRaw < fromAmountRaw) {
            throw createSwapError(400, "insufficient balance", {
                available: ethers.formatUnits(fromToken.balanceRaw, fromToken.decimals)
            });
        }

        const { toAmountRaw, usdRaw8 } = buildSwapQuoteBySnapshot(snapshot, fromSymbol, toSymbol, fromAmountRaw);
        if (toAmountRaw <= 0n) throw createSwapError(400, "invalid quote amount");

        return {
            fromSymbol,
            toSymbol,
            fromAmount: ethers.formatUnits(fromAmountRaw, fromDecimals),
            toAmount: ethers.formatUnits(toAmountRaw, TOKEN_DECIMALS_BY_SYMBOL[toSymbol]),
            usdAmount: scaledBigIntToDecimal(usdRaw8, 8, 2),
            balances: {
                [fromSymbol]: ethers.formatUnits(fromToken.balanceRaw, fromToken.decimals),
                [toSymbol]: ethers.formatUnits(toToken.balanceRaw, toToken.decimals)
            }
        };
    }

    async function execute(reqBody, vaultAddress, userId) {
        const chainId = 11155111;

        if (!vaultAddress) throw createSwapError(400, "missing vault address");
        const { fromSymbol, toSymbol, fromAmountRaw, fromDecimals, toDecimals, amount: fromAmountInputText } = parseSwapRequest(reqBody);

        const { snapshot: onchainSnapshot } = await getVaultTokenSnapshot(vaultAddress);
        const frozenBySymbol = await getFrozenTokenRawByVault(vaultAddress);
        const { snapshot } = applyFrozenBalanceToSnapshot(onchainSnapshot, frozenBySymbol);
        const fromToken = snapshot[fromSymbol];
        const toToken = snapshot[toSymbol];
        if (!fromToken || !toToken) throw createSwapError(400, "token not available");
        if (fromToken.balanceRaw < fromAmountRaw) {
            throw createSwapError(400, "insufficient balance", {
                available: ethers.formatUnits(fromToken.balanceRaw, fromToken.decimals)
            });
        }

        const { toAmountRaw, usdRaw8 } = buildSwapQuoteBySnapshot(snapshot, fromSymbol, toSymbol, fromAmountRaw);
        if (toAmountRaw <= 0n) throw createSwapError(400, "invalid quote amount");

        const minAmountOut = (toAmountRaw * 9950n) / 10000n;
        const vaultC = new ethers.Contract(vaultAddress, VAULT_SWAP_ABI, backendSigner);
        const routerAddress = String(await vaultC.swapRouter()).toLowerCase();
        if (!ethers.isAddress(routerAddress) || routerAddress === ethers.ZeroAddress) {
            throw createSwapError(400, "swap router is not configured");
        }
        const routerCode = await provider.getCode(routerAddress);
        if (!routerCode || routerCode === "0x") {
            throw createSwapError(400, "swap router contract not found, please set valid swap router address");
        }
        const routerOutToken = new ethers.Contract(TOKENS[toSymbol], ERC20_ABI, provider);
        const routerOutBalanceRaw = BigInt(await routerOutToken.balanceOf(routerAddress));
        if (routerOutBalanceRaw < toAmountRaw) {
            throw createSwapError(400, `swap router ${toSymbol} liquidity is insufficient`, {
                required: ethers.formatUnits(toAmountRaw, toDecimals),
                available: ethers.formatUnits(routerOutBalanceRaw, toDecimals)
            });
        }

        const tx = await vaultC.swapToken(
            TOKENS[fromSymbol],
            TOKENS[toSymbol],
            fromAmountRaw,
            minAmountOut,
            vaultAddress
        );
        const receipt = await tx.wait();
        if (!receipt || Number(receipt.status) !== 1) {
            throw createSwapError(500, "swap transaction reverted");
        }

        const txHash = String(tx.hash || "").toLowerCase();
        const fromAmountText = ethers.formatUnits(fromAmountRaw, fromDecimals);
        const toAmountText = ethers.formatUnits(toAmountRaw, toDecimals);
        const timestamp = new Date();

        const recordResult = await swapService.recordSwapCompletion({
            chainId,
            blockNumber: Number(receipt?.blockNumber || 0),
            txHash,
            vaultAddress,
            fromSymbol,
            toSymbol,
            fromAmountInputText,
            fromAmountText,
            toAmountText,
            timestamp,
            userId
        });

        return {
            success: true,
            txHash,
            direction: "swap",
            fromSymbol,
            toSymbol,
            fromAmount: fromAmountText,
            toAmount: toAmountText,
            usdAmount: scaledBigIntToDecimal(usdRaw8, 8, 2),
            journalQueued: Boolean(recordResult?.journalResult?.queued),
            journalTxId: String(recordResult?.journalResult?.txId || "")
        };
    }

    return { quote, execute };
}

module.exports = { createSwapOrchestrator };
