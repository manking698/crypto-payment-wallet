export type UserProfile = {
    email: string;
    vaultAddress: string;
    defaultChainId: number;
    spendPriorityToken?: "USDT" | "USDC" | "WETH";
    displayCurrency?: string;
};

export type AuthResponse = {
    token: string;
    user: UserProfile;
};

export type DashboardTransaction = {
    id?: string;
    paymentId?: string;
    cardLast4?: string;
    swapFromSymbol?: string;
    swapToSymbol?: string;
    swapFromAmount?: string;
    swapToAmount?: string;
    chainId?: number;
    txHash: string;
    from?: string;
    to?: string;
    origSender?: string;
    amount: string;
    direction: string;
    bridgeStatus?: string;
    normalizedStatus?: string;
    explorerBase?: string;
    sourceLink?: string;
    merchant?: string;
    title?: string;
    country?: string;
    amountPrimary?: string;
    amountSecondary?: string;
    reward?: string;
    cardPayment?: {
        id?: string;
        paymentCurrency?: string;
        paymentAmount?: string;
        usdAmount?: string;
        cardLast4?: string;
        deductedTokens?: Array<{
            tokenSymbol?: string;
            tokenAmount?: string;
            tokenAmountRaw?: string;
            usdAmount?: string;
            txHash?: string;
        }>;
        plannedTokens?: Array<{
            tokenSymbol?: string;
            tokenAmount?: string;
            tokenAmountRaw?: string;
            usdAmount?: string;
            priceRaw8?: string;
        }>;
    };
    tokenSymbol?: string;
    type?: string;
    timestamp?: string | null;
};

export type DashboardAsset = {
    symbol: "USDT" | "USDC" | "WETH";
    balance: string;
    usdValue: string;
    decimals: number;
};

export type DashboardSummary = {
    vaultAddress: string;
    defaultChainId: number;
    spendPriorityToken?: "USDT" | "USDC" | "WETH";
    totalBalanceUsd: string;
    assets: DashboardAsset[];
    transactions: DashboardTransaction[];
};

export type TransactionHistoryResponse = {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    transactions: DashboardTransaction[];
};

export type FxLatestResponse = {
    provider: string;
    base: string;
    updatedAt: string;
    rates: Record<string, number>;
};

export type UserCard = {
    id: string;
    cardholderName: string;
    nickname: string;
    last4: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    expiry: string;
    cvv: string;
    status: "active" | "frozen";
    perTransactionLimitUsd: number;
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    vaultDailyLimitUsd: number;
    vaultMonthlyLimitUsd: number;
    createdAt: string | null;
    updatedAt: string | null;
};

export type AppNotification = {
    id: string;
    type: "transaction" | "system";
    title: string;
    message: string;
    isRead: boolean;
    relatedTransactionId?: string;
    paymentId?: string;
    createdAt?: string | null;
};

export type EarnTokenSymbol = "USDT" | "USDC" | "WETH";
export type EarnHistoryKind = "subscribe" | "redemption" | "rewards";

export type EarnPoolSummary = {
    token: EarnTokenSymbol;
    apy: number;
    minSubscription: string;
    walletBalance: string;
    subscribedBalance: string;
    totalRewards: string;
    estimatedValueUsd?: string;
};

export type EarnSummaryResponse = {
    vaultAddress: string;
    pools: EarnPoolSummary[];
    totalEstimatedUsd?: string;
    description: string[];
};

export type EarnHistoryRecord = {
    id: string;
    token: EarnTokenSymbol;
    kind: EarnHistoryKind;
    amount: string;
    txHash: string;
    status: string;
    timestamp: string | null;
};

export type EarnHistoryResponse = {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    records: EarnHistoryRecord[];
};
