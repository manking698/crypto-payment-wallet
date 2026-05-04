"use strict";

function createCardPaymentError(status, message, extra = {}) {
    const err = new Error(message || "card payment failed");
    err.status = status;
    Object.assign(err, extra);
    return err;
}

function createCardPaymentService(deps) {
    const {
        mongoose,
        ethers,
        User,
        UserVault,
        CardPayment,
        backendSigner,
        provider,
        TOKENS,
        ERC20_ABI,
        VAULT_WITHDRAW_ABI,
        FX_SUPPORTED_CURRENCIES,
        VALID_SPEND_PRIORITY_TOKENS,
        CARD_GLOBAL_MONTHLY_LIMIT_USD,
        normalizeCardDigits,
        decimalToScaledBigInt,
        scaledBigIntToDecimal,
        fetchLiveFxRates,
        getVaultTokenSnapshot,
        getFrozenTokenRawByVault,
        applyFrozenBalanceToSnapshot,
        normalizeSpendPriority,
        buildCardPaymentPriority,
        buildCardDeductionPlan,
        validateCardPaymentInput,
        getStartOfDay,
        getStartOfMonth,
        shortenMerchantNameAscii,
        paymentsService,
        cardsService,
        toFixed2
    } = deps;

    async function processPayment(reqBody) {
        const input = typeof validateCardPaymentInput === "function"
            ? validateCardPaymentInput(reqBody)
            : null;
        if (input && !input.ok) {
            throw createCardPaymentError(400, input.error);
        }
        const paymentCurrency = input?.paymentCurrency || String(reqBody?.paymentCurrency || "USD").trim().toUpperCase();
        const paymentAmount = input?.paymentAmount || String(reqBody?.paymentAmount || "").trim();
        const merchantName = input?.merchantName || String(reqBody?.merchantName || "").trim();
        const merchantRef = input?.merchantRef || String(reqBody?.merchantRef || "").trim();
        const country = input?.country || String(reqBody?.country || "").trim().toUpperCase();
        const chainId = 11155111;

        const paymentAmountRaw8 = input?.paymentAmountRaw8 ?? decimalToScaledBigInt(paymentAmount, 8);
        if (paymentAmountRaw8 <= 0n) {
            throw createCardPaymentError(400, "payment amount must be greater than zero");
        }
        if (!input && !FX_SUPPORTED_CURRENCIES.includes(paymentCurrency)) {
            throw createCardPaymentError(400, "unsupported payment currency");
        }
        if (!input && !merchantName) {
            throw createCardPaymentError(400, "merchant name is required");
        }

        const cardId = String(reqBody?.cardId || "").trim();
        const inputCardNumber = normalizeCardDigits(reqBody?.cardNumber);
        const card = await cardsService.resolveCardForPayment({ cardId, inputCardNumber });
        if (!card) throw createCardPaymentError(404, "card not found");
        if (String(card.status || "active") !== "active") {
            throw createCardPaymentError(400, "payment is failed: card is not active");
        }

        const verify = cardsService.verifyCardCredentials(card, reqBody || {});
        if (!verify.ok) {
            throw createCardPaymentError(400, verify.error);
        }
        const cardLast4 = verify.cardLast4;

        const authUser = await User.findById(card.userId).lean();
        if (!authUser) throw createCardPaymentError(404, "card owner not found");
        const authVault = await UserVault.findOne({ userId: authUser._id }).lean();
        const vaultAddress = String(authVault?.vaultAddress || "").trim().toLowerCase();
        if (!vaultAddress) throw createCardPaymentError(400, "missing vault address");

        const settlementAddressRaw = String(
            reqBody?.settlementAddress || process.env.CARD_PAYMENT_SETTLEMENT_ADDRESS || backendSigner.address
        ).trim();
        if (!ethers.isAddress(settlementAddressRaw)) {
            throw createCardPaymentError(400, "invalid settlement address");
        }
        const settlementAddress = settlementAddressRaw.toLowerCase();

        let fxRateUsdToPaymentRaw8 = 100000000n;
        if (paymentCurrency !== "USD") {
            const fx = await fetchLiveFxRates("USD");
            const rate = fx?.rates?.[paymentCurrency];
            if (!Number.isFinite(rate) || Number(rate) <= 0) {
                throw createCardPaymentError(500, "failed to get exchange rate");
            }
            fxRateUsdToPaymentRaw8 = decimalToScaledBigInt(String(rate), 8);
            if (fxRateUsdToPaymentRaw8 <= 0n) {
                throw createCardPaymentError(500, "invalid exchange rate");
            }
        }

        const usdAmountRaw8 = paymentCurrency === "USD"
            ? paymentAmountRaw8
            : (paymentAmountRaw8 * 100000000n + fxRateUsdToPaymentRaw8 - 1n) / fxRateUsdToPaymentRaw8;

        const { snapshot: onchainSnapshot } = await getVaultTokenSnapshot(vaultAddress);
        const frozenBySymbol = await getFrozenTokenRawByVault(vaultAddress);
        const { snapshot, totalUsd8 } = applyFrozenBalanceToSnapshot(onchainSnapshot, frozenBySymbol);
        if (totalUsd8 < usdAmountRaw8) {
            throw createCardPaymentError(400, "vault balance is insufficient", {
                requiredUsd: scaledBigIntToDecimal(usdAmountRaw8, 8, 2),
                availableUsd: scaledBigIntToDecimal(totalUsd8, 8, 2),
                frozenUsd: scaledBigIntToDecimal(
                    (BigInt(onchainSnapshot.USDT?.usdValueRaw8 || 0n) + BigInt(onchainSnapshot.USDC?.usdValueRaw8 || 0n) + BigInt(onchainSnapshot.WETH?.usdValueRaw8 || 0n)) - totalUsd8,
                    8,
                    2
                )
            });
        }

        const spendPriorityToken = normalizeSpendPriority(authUser?.spendPriorityToken);
        const priorityFlow = buildCardPaymentPriority(spendPriorityToken);
        const { plan, remainingUsdRaw8 } = buildCardDeductionPlan(snapshot, priorityFlow, usdAmountRaw8);
        if (!plan.length || remainingUsdRaw8 > 0n) {
            throw createCardPaymentError(400, "insufficient convertible token balance", {
                remainingUsd: scaledBigIntToDecimal(remainingUsdRaw8, 8, 8)
            });
        }

        const startOfDay = getStartOfDay(new Date());
        const startOfMonth = getStartOfMonth(new Date());
        const [dailyPayments, monthlyPayments, vaultDailyPayments, vaultMonthlyPayments] = await Promise.all([
            CardPayment.find({
                userId: authUser._id,
                cardId: card._id,
                status: { $in: ["processing", "completed", "partial_failed"] },
                createdAt: { $gte: startOfDay }
            }).select({ usdAmount: 1 }).lean(),
            CardPayment.find({
                userId: authUser._id,
                cardId: card._id,
                status: { $in: ["processing", "completed", "partial_failed"] },
                createdAt: { $gte: startOfMonth }
            }).select({ usdAmount: 1 }).lean(),
            CardPayment.find({
                vaultAddress,
                status: { $in: ["processing", "completed", "partial_failed"] },
                createdAt: { $gte: startOfDay }
            }).select({ usdAmount: 1 }).lean(),
            CardPayment.find({
                vaultAddress,
                status: { $in: ["processing", "completed", "partial_failed"] },
                createdAt: { $gte: startOfMonth }
            }).select({ usdAmount: 1 }).lean()
        ]);

        const dailySpentUsd8 = dailyPayments.reduce(
            (sum, item) => sum + decimalToScaledBigInt(String(item.usdAmount || "0"), 8),
            0n
        );
        const monthlySpentUsd8 = monthlyPayments.reduce(
            (sum, item) => sum + decimalToScaledBigInt(String(item.usdAmount || "0"), 8),
            0n
        );
        const vaultDailySpentUsd8 = vaultDailyPayments.reduce(
            (sum, item) => sum + decimalToScaledBigInt(String(item.usdAmount || "0"), 8),
            0n
        );
        const vaultMonthlySpentUsd8 = vaultMonthlyPayments.reduce(
            (sum, item) => sum + decimalToScaledBigInt(String(item.usdAmount || "0"), 8),
            0n
        );

        const rawPerTxnLimit = Number.isFinite(Number(card.perTransactionLimitUsd))
            ? Number(card.perTransactionLimitUsd)
            : 1000;
        const cardPerTxnLimitUsd8 = decimalToScaledBigInt(String(rawPerTxnLimit), 8);
        const cardDailyLimitUsd8 = decimalToScaledBigInt(String(card.dailyLimitUsd || 0), 8);
        const cardMonthlyLimitUsd8 = decimalToScaledBigInt(
            String(
                Number.isFinite(Number(card.monthlyLimitUsd)) && Number(card.monthlyLimitUsd) > 0
                    ? Number(card.monthlyLimitUsd)
                    : (Number.isFinite(CARD_GLOBAL_MONTHLY_LIMIT_USD) && CARD_GLOBAL_MONTHLY_LIMIT_USD > 0 ? CARD_GLOBAL_MONTHLY_LIMIT_USD : 1000000)
            ),
            8
        );
        const vaultDailyLimitUsd8 = decimalToScaledBigInt(String(card.vaultDailyLimitUsd || 0), 8);
        const vaultMonthlyLimitUsd8 = decimalToScaledBigInt(String(card.vaultMonthlyLimitUsd || 0), 8);
        if (cardPerTxnLimitUsd8 <= 0n || usdAmountRaw8 > cardPerTxnLimitUsd8) {
            throw createCardPaymentError(400, "card per transaction limit exceeded");
        }
        if (dailySpentUsd8 + usdAmountRaw8 > cardDailyLimitUsd8) {
            throw createCardPaymentError(400, "card daily limit exceeded");
        }
        if (monthlySpentUsd8 + usdAmountRaw8 > cardMonthlyLimitUsd8) {
            throw createCardPaymentError(400, "card monthly limit exceeded");
        }
        if (vaultDailyLimitUsd8 > 0n && vaultDailySpentUsd8 + usdAmountRaw8 > vaultDailyLimitUsd8) {
            throw createCardPaymentError(400, "vault daily limit exceeded");
        }
        if (vaultMonthlyLimitUsd8 > 0n && vaultMonthlySpentUsd8 + usdAmountRaw8 > vaultMonthlyLimitUsd8) {
            throw createCardPaymentError(400, "vault monthly limit exceeded");
        }

        const plannedTokens = plan.map((item) => ({
            tokenSymbol: item.symbol,
            tokenDecimals: item.tokenDecimals,
            tokenAmount: ethers.formatUnits(item.deductTokenRaw, item.tokenDecimals),
            tokenAmountRaw: item.deductTokenRaw.toString(),
            usdAmount: scaledBigIntToDecimal(item.deductedUsdRaw8, 8, 8),
            priceRaw8: item.priceRaw8.toString()
        }));
        const reservedTokens = plan.map((item) => ({
            tokenSymbol: item.symbol,
            tokenAmountRaw: item.deductTokenRaw.toString()
        }));

        const paymentDoc = await CardPayment.create({
            userId: authUser._id,
            cardId: card._id,
            vaultAddress,
            paymentCurrency,
            paymentAmount,
            usdAmount: scaledBigIntToDecimal(usdAmountRaw8, 8, 8),
            cardLast4,
            fxBase: "USD",
            fxRateUsdToPayment: scaledBigIntToDecimal(fxRateUsdToPaymentRaw8, 8, 8),
            spendPriorityToken,
            merchantName: shortenMerchantNameAscii(merchantName),
            merchantFullName: merchantName,
            merchantRef,
            status: "processing",
            plannedTokens,
            reservedTokens,
            deductedTokens: [],
            txHashes: [],
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const vaultC = new ethers.Contract(vaultAddress, VAULT_WITHDRAW_ABI, backendSigner);
        const txHashes = [];
        const deductedTokens = [];
        const journalResults = [];

        try {
            for (const item of plan) {
                const tx = await vaultC.withdrawToken(item.tokenAddress, settlementAddress, item.deductTokenRaw);
                const receipt = await tx.wait();
                if (!receipt || Number(receipt.status) !== 1) {
                    throw new Error("card payment tx reverted");
                }
                const txHash = String(tx.hash || "").toLowerCase();
                txHashes.push(txHash);

                const tokenAmountText = ethers.formatUnits(item.deductTokenRaw, item.tokenDecimals);
                deductedTokens.push({
                    tokenSymbol: item.symbol,
                    tokenAmount: tokenAmountText,
                    tokenAmountRaw: item.deductTokenRaw.toString(),
                    usdAmount: scaledBigIntToDecimal(item.deductedUsdRaw8, 8, 8),
                    priceRaw8: item.priceRaw8.toString(),
                    txHash
                });

                const journalResult = await paymentsService.persistCardPaymentLedgerEntry({
                    chainId,
                    blockNumber: Number(receipt?.blockNumber || 0),
                    txHash,
                    vaultAddress,
                    settlementAddress,
                    tokenAmountText,
                    tokenSymbol: item.symbol,
                    merchantShort: shortenMerchantNameAscii(merchantName),
                    merchantFull: merchantName,
                    country: country || paymentCurrency,
                    paymentCurrency,
                    paymentAmountFixed2: Number(paymentAmount).toFixed(2),
                    deductedUsdText2: scaledBigIntToDecimal(item.deductedUsdRaw8, 8, 2),
                    paymentId: paymentDoc._id,
                    paymentAmount,
                    cardLast4,
                    spendPriorityToken,
                    timestamp: new Date()
                });
                journalResults.push(journalResult);
            }

            await paymentsService.finalizeCardPaymentSuccess({
                paymentDocId: paymentDoc._id,
                deductedTokens,
                txHashes,
                userId: authUser._id,
                merchantShort: shortenMerchantNameAscii(merchantName),
                paymentCurrency,
                paymentAmountFixed2: toFixed2(paymentAmount)
            });

            return {
                success: true,
                paymentId: String(paymentDoc._id),
                status: "completed",
                paymentCurrency,
                paymentAmount,
                usdAmount: scaledBigIntToDecimal(usdAmountRaw8, 8, 2),
                spendPriorityToken,
                priorityFlow,
                plannedTokens,
                deductedTokens,
                txHashes,
                journalQueued: journalResults.some((item) => Boolean(item?.queued)),
                journalTxIds: journalResults.map((item) => String(item?.txId || "")).filter(Boolean)
            };
        } catch (chainErr) {
            const plannedRawBySymbol = new Map();
            for (const p of plannedTokens) {
                const symbol = String(p?.tokenSymbol || "").trim().toUpperCase();
                const raw = String(p?.tokenAmountRaw || "0").trim();
                if (!VALID_SPEND_PRIORITY_TOKENS.includes(symbol) || !/^\d+$/.test(raw)) continue;
                const prev = plannedRawBySymbol.get(symbol) || 0n;
                plannedRawBySymbol.set(symbol, prev + BigInt(raw));
            }

            const deductedRawBySymbol = new Map();
            for (const d of deductedTokens) {
                const symbol = String(d?.tokenSymbol || "").trim().toUpperCase();
                const raw = String(d?.tokenAmountRaw || "0").trim();
                if (!VALID_SPEND_PRIORITY_TOKENS.includes(symbol) || !/^\d+$/.test(raw)) continue;
                const prev = deductedRawBySymbol.get(symbol) || 0n;
                deductedRawBySymbol.set(symbol, prev + BigInt(raw));
            }

            const unresolvedReservedTokens = [];
            for (const symbol of VALID_SPEND_PRIORITY_TOKENS) {
                const planned = plannedRawBySymbol.get(symbol) || 0n;
                const done = deductedRawBySymbol.get(symbol) || 0n;
                const remaining = planned > done ? planned - done : 0n;
                if (remaining > 0n) {
                    unresolvedReservedTokens.push({ tokenSymbol: symbol, tokenAmountRaw: remaining.toString() });
                }
            }

            await paymentsService.finalizeCardPaymentFailure({
                paymentDocId: paymentDoc._id,
                txHashes,
                deductedTokens,
                unresolvedReservedTokens,
                errorMessage: chainErr.message || "card payment failed"
            });
            throw createCardPaymentError(500, "card payment failed", {
                paymentId: String(paymentDoc._id),
                txHashes
            });
        }
    }

    return { processPayment };
}

module.exports = { createCardPaymentService };
