const { ethers, NonceManager } = require("ethers");
const mongoose = require("mongoose");
require("dotenv").config();

const dns = require("dns");
const pLimit = require("p-limit").default;
const {
    getFilterTokenAddresses,
    getChains,
    getTokenInfoByAddress,
    getTokenInfoByKey,
    getWrapperToken
} = require("../server-api/config/chainConfig");
const { deployVault } = require("./deploy-vault-factory");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const HYPERLANE_SENDER_ABI = [
    "function sendMessage(uint32 destinationDomain, address hyperlaneReceiver, string memory txId, address receiver, address token, uint256 amount) external payable returns (bytes32)"
];
const VAULT_ADDRESS_ABI = [
    "function withdrawToken(address token, address to, uint256 amount) external",
    "function withdrawETH(address to, uint256 amount) external",
    "function owner() external view returns (address)"
];
const ERC20_DEBUG_ABI = [
    "function balanceOf(address account) view returns (uint256)"
];
const HYPERLANE_RECEIVER_ABI = [
    "function handle(uint32 _origin, bytes32 _sender, bytes _body) payable"
];

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKEN_HANDLED_TOPIC = "0x6a6a4ed4a3103021cbb39925b50d4932b2e91e9fe85981a811a706f2177757f3";

const CHAIN_IDS = {
    ETH_SEPOLIA: 11155111,
    SCROLL_SEPOLIA: 534351
};
const BRIDGE_STATUS = {
    NONE: "none",
    DONE: "done",
    PENDING: "pending",
    PROCESSING: "processing",
    DELIVERED: "delivered",
    MINTING: "minting",
    COMPLETED: "completed",
    MINT_FAILED: "mint_failed",
    SWAP: "swap",
    DEDUCTING: "deducting",
    MESSAGING: "messaging",
    CHECK_VAULT: "checkvault",
    BRIDGE_TX: "bridgetx"
};

const TARGET_CHAIN_ID = CHAIN_IDS.ETH_SEPOLIA;
const TARGET_CHAIN_NAME = "ETH Sepolia";
const DEFAULT_GAS_LIMIT = 600000n;
const GAS_FEE_CACHE_TTL_MS = 5000;
const HYPERLANE_QUOTE_CACHE_TTL_MS = 5000;
const BLOCK_FETCH_CONCURRENCY = 20;
const RECEIPT_CONCURRENCY = 20;
const CHAINS_BY_ID = new Map(getChains().map((chain) => [chain.chainId, chain]));
const TOKEN_HANDLED_IFACE = new ethers.Interface([
    "event TokenHandled(string txId, address token, address to, uint256 amount, uint8 status)"
]);

const TransactionSchema = new mongoose.Schema({
    chainId: Number,
    chainName: String,
    txId: String,
    type: String,
    blockNumber: Number,
    txHash: String,
    logIndex: Number,
    from: String,
    to: String,
    amount: String,
    token: String,
    tokenKey: String,
    tokenSymbol: String,
    direction: String,
    directionLabel: String,
    timestamp: Date,
    origSender: String,
    bridged: { type: Boolean, default: false },
    bridgeStatus: { type: String, default: BRIDGE_STATUS.NONE },
    bridgeTxId: { type: String, default: "" },
    bridgeErrLast: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    retry: Number,
    skipDeduct: { type: Number, default: 0 },
    lockAttempt: { type: Number, default: 0 }
});
TransactionSchema.index({ chainId: 1, txId: 1 });
TransactionSchema.index({ bridgeStatus: 1, createdAt: 1, chainId: 1 });
TransactionSchema.index({ txHash: 1, amount: 1 });
TransactionSchema.index(
    { txId: 1, chainId: 1, from: 1, to: 1, amount: 1, direction: 1 },
    { unique: true, name: "uniq_transaction_dedupe_key" }
);
const Transaction = mongoose.model("Transaction", TransactionSchema);

const BridgeTxSchema = new mongoose.Schema({
    txId: String,
    txHash: String,
    origSender: String,
    recipient: String,
    tokenKey: String,
    tokenSymbol: String,
    token: String,
    amount: String,
    sourceChainId: Number,
    sourceChain: String,
    targetChainId: Number,
    targetChain: String,
    sourceTxHash: String,
    targetTxHash: String,
    deductTxHash: String,
    timestamp: Date,
    createdAt: { type: Date, default: Date.now }
});
BridgeTxSchema.index({ txId: 1, targetTxHash: 1 });
const BridgeTx = mongoose.model("BridgeTx", BridgeTxSchema);

const ChainStateSchema = new mongoose.Schema({
    chain: String,
    lastProcessedBlock: Number
});
ChainStateSchema.index({ chain: 1 });
const ChainState = mongoose.model("ChainState", ChainStateSchema);

const UserVaultSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    chainId: Number,
    vaultAddress: String,
    salt: String,
    createdAt: Date
});
UserVaultSchema.index({ userId: 1, chainId: 1 }, { unique: true });
UserVaultSchema.index({ chainId: 1, vaultAddress: 1 }, { unique: true });
const UserVault = mongoose.models.UserVault || mongoose.model("UserVault", UserVaultSchema);

const vaultAddresses = new Set();
const providers = {};
const signerCache = new Map();
const contractCache = new Map();
const gasFeeCache = new Map();
const hyperlaneQuoteCache = new Map();
const SUPPORTED_TOKEN_ADDRESSES = getFilterTokenAddresses();
SUPPORTED_TOKEN_ADDRESSES.push(process.env.HYPERLANE_RECEIVER_ADDRESS.toLowerCase());
const VAULT_ADDRESS_REFRESH_INTERVAL_MS = 30 * 1000;

function registerVaultAddress(vaultAddress) {
    const normalizedAddress = String(vaultAddress || "").trim().toLowerCase();
    if (!normalizedAddress) return false;
    const beforeSize = vaultAddresses.size;
    vaultAddresses.add(normalizedAddress);
    return vaultAddresses.size > beforeSize;
}

async function ensureUserVaultByAddress(chainId, vaultAddress) {
    const normalizedAddress = String(vaultAddress || "").trim().toLowerCase();
    if (!normalizedAddress) return null;

    let vaultRecord = await UserVault.findOne({ chainId, vaultAddress: normalizedAddress }).lean();
    if (vaultRecord) {
        registerVaultAddress(vaultRecord.vaultAddress);
        return vaultRecord;
    }

    const existingVault = await UserVault.findOne({ vaultAddress: normalizedAddress }).lean();
    if (!existingVault) return null;

    await UserVault.updateOne(
        { userId: existingVault.userId, chainId },
        {
            $setOnInsert: {
                userId: existingVault.userId,
                chainId,
                vaultAddress: normalizedAddress,
                salt: existingVault.salt,
                createdAt: new Date()
            }
        },
        { upsert: true }
    );

    console.log("[uservault] created missing chain vault record", {
        userId: String(existingVault.userId),
        chainId,
        vaultAddress: normalizedAddress
    });

    vaultRecord = await UserVault.findOne({ chainId, vaultAddress: normalizedAddress }).lean();
    if (vaultRecord) registerVaultAddress(vaultRecord.vaultAddress);
    return vaultRecord;
}

async function ensureUserVaultIndexes() {
    const indexes = await UserVault.collection.indexes();
    const hasLegacyVaultIndex = indexes.some((index) => index.name === "vaultAddress_1");

    if (hasLegacyVaultIndex) {
        await UserVault.collection.dropIndex("vaultAddress_1");
        console.log("[uservault] dropped legacy vaultAddress_1 index");
    }

    await UserVault.collection.createIndex(
        { userId: 1, chainId: 1 },
        { unique: true, name: "userId_1_chainId_1" }
    );
    await UserVault.collection.createIndex(
        { chainId: 1, vaultAddress: 1 },
        { unique: true, name: "chainId_1_vaultAddress_1" }
    );
}

// When provider changes, clear every runtime cache that is bound to the old provider.
// Provider 切换时，清理所有绑定到旧 provider 的运行时缓存。
function clearChainRuntimeCache(chainId) {
    signerCache.delete(chainId);
    gasFeeCache.delete(chainId);
    hyperlaneQuoteCache.clear();

    for (const key of contractCache.keys()) {
        if (key.startsWith(`${chainId}:`)) {
            contractCache.delete(key);
        }
    }
}

// Create or rotate the active RPC provider for the given chain.
// 为指定链创建或轮换当前使用的 RPC provider。
async function getProvider(chainCfg) {
    const state = providers[chainCfg.chainId];
    if (state.currentRpcIndex >= chainCfg.rpc.http.length) {
        state.currentRpcIndex = 0;
    }

    const rpcUrl = chainCfg.rpc.http[state.currentRpcIndex];
    const fetchRequest = new ethers.FetchRequest(rpcUrl);
    fetchRequest.timeout = 40000;

    state.provider = new ethers.JsonRpcProvider(fetchRequest, chainCfg.chainId, {
        staticNetwork: true,
        batchStallTime: 30
    });
    clearChainRuntimeCache(chainCfg.chainId);
}

// Load the last scanned block so the monitor can resume after restart.
// 读取上次扫描到的区块高度，支持服务重启后续扫。
async function getLastProcessedBlock(chain) {
    const state = await ChainState.findOne({ chain });
    return state?.lastProcessedBlock || 0;
}

// Persist the latest processed block for a chain.
// 持久化某条链最新已处理的区块高度。
async function setLastProcessedBlock(chain, blockNumber) {
    await ChainState.updateOne(
        { chain },
        { lastProcessedBlock: blockNumber },
        { upsert: true }
    );
}

// Build a globally unique transaction id from chain id, tx hash, and log index.
// 用链 ID、交易哈希和 logIndex 生成全局唯一交易 ID。
function buildTxId(chainId, txHash, logIndex) {
    return ethers.solidityPackedKeccak256(
        ["uint256", "bytes32", "uint256"],
        [chainId, txHash, logIndex]
    );
}

// Normalize EIP-1559 gas fields so all write paths share the same gas policy.
// 统一 EIP-1559 gas 参数，避免不同发交易路径各自拼配置。
function createGasOptions(feeData) {
    const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits("1", "gwei");
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("0.1", "gwei");
    return {
        gasLimit: DEFAULT_GAS_LIMIT,
        maxFeePerGas: maxFeePerGas * 2n,
        maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
    };
}

// Cache fee data for a short time to reduce repeated getFeeData RPC calls.
// 短时间缓存 feeData，减少高频桥接时重复调用 getFeeData。
async function getCachedFeeData(chainId) {
    const now = Date.now();
    const cachedFee = gasFeeCache.get(chainId);
    if (cachedFee && cachedFee.expiresAt > now) {
        return cachedFee.feeData;
    }

    const provider = providers[chainId]?.provider;
    if (!provider) throw new Error(`Provider unavailable for chain ${chainId}`);

    const feeData = await provider.getFeeData();
    gasFeeCache.set(chainId, {
        feeData,
        expiresAt: now + GAS_FEE_CACHE_TTL_MS
    });
    return feeData;
}

// Reuse one nonce-managed signer per chain and rebuild it after provider rotation.
// 每条链复用一个带 nonce 管理的 signer，provider 轮换后自动重建。
function getManagedSigner(chainId) {
    const cachedSigner = signerCache.get(chainId);
    if (cachedSigner) return cachedSigner;

    const provider = providers[chainId]?.provider;
    if (!provider) throw new Error(`Provider unavailable for chain ${chainId}`);

    const signer = new NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY, provider));
    signer.reset();
    signerCache.set(chainId, signer);
    return signer;
}

// Cache write-contract instances so repeated bridge jobs do not recreate them.
// 缓存写操作合约实例，避免重复桥接任务反复创建 Contract。
function getWriteContract(chainId, address, abi, label) {
    const cacheKey = `${chainId}:${label}:${address.toLowerCase()}`;
    const cachedContract = contractCache.get(cacheKey);
    if (cachedContract) return cachedContract;

    const contract = new ethers.Contract(address, abi, getManagedSigner(chainId));
    contractCache.set(cacheKey, contract);
    return contract;
}

function formatDebugUnits(value, decimals) {
    try {
        return ethers.formatUnits(value, decimals);
    } catch (_) {
        return value?.toString?.() || String(value);
    }
}

function normalizeErrorMessage(err) {
    return err?.shortMessage || err?.reason || err?.message || String(err);
}

async function readVaultTokenBalanceForDebug(provider, tokenAddress, vaultAddress, decimals) {
    try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_DEBUG_ABI, provider);
        const balance = await tokenContract.balanceOf(vaultAddress);
        return {
            raw: balance.toString(),
            formatted: formatDebugUnits(balance, decimals)
        };
    } catch (err) {
        return {
            raw: "",
            formatted: "",
            error: normalizeErrorMessage(err)
        };
    }
}

async function readVaultOwnerForDebug(vaultContract) {
    try {
        return await vaultContract.owner();
    } catch (err) {
        return `unavailable: ${normalizeErrorMessage(err)}`;
    }
}

// Only classify real network-like failures as TIMEOUT to avoid false RPC rotation.
// 只把真正像网络超时的错误归类为 TIMEOUT，避免误切 RPC。
function isTimeoutError(err) {
    if (!err) return false;

    const code = String(err.code || "").toUpperCase();
    const shortMessage = String(err.shortMessage || "").toLowerCase();
    const message = String(err.message || "").toLowerCase();
    const combined = `${shortMessage} ${message}`;

    return (
        code === "TIMEOUT" ||
        code === "ETIMEDOUT" ||
        code === "UND_ERR_CONNECT_TIMEOUT" ||
        code === "UND_ERR_HEADERS_TIMEOUT" ||
        code === "UND_ERR_BODY_TIMEOUT" ||
        combined.includes("timeout") ||
        combined.includes("timed out") ||
        combined.includes("socket hang up") ||
        combined.includes("network error") ||
        combined.includes("missing response for request")
    );
}

// Resolve the initial bridge status from chain, tx type, and transfer direction.
// 根据链、交易类型和方向，决定初始 bridgeStatus。
function resolveBridgeStatus(chainId, txType, direction) {
    if (direction !== "in") return BRIDGE_STATUS.DONE;
    if (chainId === CHAIN_IDS.ETH_SEPOLIA && txType === "Native") return BRIDGE_STATUS.PENDING;
    if (chainId === CHAIN_IDS.SCROLL_SEPOLIA && txType === "Native") return BRIDGE_STATUS.PENDING;
    if (chainId !== CHAIN_IDS.ETH_SEPOLIA) return BRIDGE_STATUS.PENDING;
    return BRIDGE_STATUS.DONE;
}

// Cache block timestamps because the same block can contain many relevant logs.
// 缓存区块时间戳，因为同一区块可能包含多条相关日志。
async function getBlockTimestampCached(provider, blockNumber, cache) {
    if (!cache.has(blockNumber)) {
        const block = await provider.getBlock(blockNumber);
        cache.set(blockNumber, new Date(block.timestamp * 1000));
    }
    return cache.get(blockNumber);
}

// Normalize chain data into the internal transaction shape before persistence.
// 先把链上数据标准化成系统内部交易对象，再统一入库。
function buildBaseTransaction(data) {
    return {
        chainId: data.chainId,
        chainName: data.chainName,
        type: data.type,
        blockNumber: data.blockNumber,
        txHash: data.txHash,
        logIndex: data.logIndex,
        from: data.from,
        to: data.to,
        amount: data.amount,
        token: data.token,
        tokenKey: data.tokenKey,
        tokenSymbol: data.tokenSymbol,
        direction: "",
        directionLabel: "",
        timestamp: data.timestamp,
        origSender: data.origSender,
        bridged: false,
        bridgeStatus: "",
        bridgeTxId: "",
        txId: buildTxId(data.chainId, data.txHash, data.logIndex).toString()
    };
}

// One chain transfer can be an inbound vault deposit or an outbound withdrawal.
// 同一笔链上转账，可能是某个 vault 的入金，也可能是另一个 vault 的出金。
function pushTransactionDirections(target, baseTx) {
    if (vaultAddresses.has(baseTx.from)) {
        target.push({
            ...baseTx,
            direction: "out",
            directionLabel: "withdrawal"
        });
    }

    if (vaultAddresses.has(baseTx.to)) {
        target.push({
            ...baseTx,
            direction: "in",
            directionLabel: "deposit"
        });
    }
}

// Collect vault-related deposits and withdrawals from ERC20 Transfer logs.
// 从 ERC20 Transfer 日志中提取与 vault 相关的入金和出金。
async function collectErc20Transactions(logs, chainCfg, provider, timestampCache, logsArray) {
    for (const log of logs) {
        const fromx = "0x" + log.topics[1].slice(26).toLowerCase();
        const tox = "0x" + log.topics[2].slice(26).toLowerCase();
        if (!vaultAddresses.has(fromx) && !vaultAddresses.has(tox)) continue;

        const ti = getTokenInfoByAddress(chainCfg.chainId, log.address);
        if (!ti) continue;

        const timestamp = await getBlockTimestampCached(provider, log.blockNumber, timestampCache);
        const baseTx = buildBaseTransaction({
            chainId: chainCfg.chainId,
            chainName: chainCfg.chainName,
            type: "ERC20",
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            logIndex: log.index,
            from: fromx,
            to: tox,
            amount: ethers.formatUnits(ethers.getBigInt(log.data), ti.token.decimals),
            token: log.address,
            tokenKey: ti.tokenKey,
            tokenSymbol: ti.token.symbol,
            timestamp,
            origSender: fromx
        });

        pushTransactionDirections(logsArray, baseTx);
    }
}

// Scan native ETH transfers that are not covered by ERC20 log queries.
// 扫描 ERC20 日志无法覆盖的原生 ETH 转账。
async function collectNativeTransactions(provider, chainCfg, blockNumber, blockNumberEnd, logsArray) {
    const limit = pLimit(BLOCK_FETCH_CONCURRENCY);
    const tasks = [];

    for (let bn = blockNumber; bn <= blockNumberEnd; bn++) {
        tasks.push(limit(async () => {
            const block = await provider.getBlock(bn, true);
            return {
                timestamp: block?.timestamp,
                transactions: block?.prefetchedTransactions || []
            };
        }));
    }

    const ti = getTokenInfoByAddress(chainCfg.chainId, "0x");
    const results = await Promise.all(tasks);
    const ethTransfers = results.flatMap((result) =>
        (result.transactions || [])
            .filter((tx) => tx && tx.value && tx.value > 0 &&
                (vaultAddresses.has(tx.from?.toLowerCase()) || vaultAddresses.has(tx.to?.toLowerCase())))
            .map((tx) => ({
                ...tx,
                timestamp: new Date(result.timestamp * 1000)
            }))
    );

    for (const tx of ethTransfers) {
        const baseTx = buildBaseTransaction({
            chainId: chainCfg.chainId,
            chainName: chainCfg.chainName,
            type: "Native",
            blockNumber: tx.blockNumber,
            txHash: tx.hash,
            logIndex: tx.index,
            from: tx.from?.toLowerCase(),
            to: tx.to?.toLowerCase(),
            amount: ethers.formatUnits(tx.value, ti.token.decimals),
            token: ti.token.address,
            tokenKey: ti.tokenKey,
            tokenSymbol: ti.token.symbol,
            timestamp: tx.timestamp,
            origSender: tx.from?.toLowerCase()
        });

        pushTransactionDirections(logsArray, baseTx);
    }
}

// Confirm receipts, then bulk-upsert transactions in a stable processing order.
// 先确认 receipt 成功，再按稳定顺序批量 upsert 交易。
async function persistTransactions(provider, logsArray) {
    if (logsArray.length === 0) return;

    logsArray.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return a.logIndex - b.logIndex;
    });

    const limit = pLimit(RECEIPT_CONCURRENCY);
    const settledDocs = await Promise.allSettled(
        logsArray.map((tx) => limit(async () => {
            const receipt = await provider.getTransactionReceipt(tx.txHash);
            if (!receipt || receipt.status !== 1) return null;

            return {
                ...tx,
                bridgeStatus: resolveBridgeStatus(tx.chainId, tx.type, tx.direction),
                retry: 0
            };
        }))
    );

    const failedReceipts = settledDocs.filter((result) => result.status === "rejected");
    if (failedReceipts.length > 0) {
        console.warn("[monitor] receipt check failed", failedReceipts.map((result) => result.reason?.message || String(result.reason)));
    }

    const docs = settledDocs
        .filter((result) => result.status === "fulfilled" && result.value)
        .map((result) => result.value);

    if (docs.length > 0) {
        console.log("[monitor] confirmed docs", docs.map((doc) => ({
            chainId: doc.chainId,
            txHash: doc.txHash,
            direction: doc.direction,
            amount: doc.amount,
            tokenSymbol: doc.tokenSymbol
        })));
    } else if (logsArray.length > 0) {
        console.warn(`[monitor] no confirmed docs from ${logsArray.length} candidate transaction(s)`);
    }

    const operations = docs
        .map((doc) => ({
            updateOne: {
                filter: {
                    txId: doc.txId,
                    chainId: doc.chainId,
                    from: doc.from,
                    to: doc.to,
                    amount: doc.amount,
                    direction: doc.direction
                },
                update: { $setOnInsert: doc },
                upsert: true
            }
        }));

    if (operations.length > 0) {
        try {
            const result = await Transaction.bulkWrite(operations, { ordered: false });
            console.log("[monitor] transaction bulkWrite result", {
                requested: operations.length,
                matched: result.matchedCount,
                modified: result.modifiedCount,
                upserted: result.upsertedCount
            });
        } catch (err) {
            if (err?.code !== 11000) {
                throw err;
            }
            console.warn("[monitor] transaction duplicate key skipped", err.message);
        }
    }
}

// Process TokenHandled only on the target chain to advance the bridge lifecycle.
// 只在目标链处理 TokenHandled 事件，用来推进桥接生命周期。
async function handleTokenHandledEvents(chainId, logs) {
    if (chainId !== TARGET_CHAIN_ID) return;

    for (const log of logs) {
        if (log.address.toLowerCase() !== process.env.HYPERLANE_RECEIVER_ADDRESS.toLowerCase()) continue;

        const decoded = TOKEN_HANDLED_IFACE.decodeEventLog("TokenHandled", log.data, log.topics);
        const txId = decoded[0];
        const token = decoded[1];
        const ti = getTokenInfoByAddress(chainId, token);
        if (!ti) continue;

        const amount = ethers.formatUnits(ethers.getBigInt(decoded[3]), ti.token.decimals);
        const statusMap = {
            0: BRIDGE_STATUS.MINTING,
            1: BRIDGE_STATUS.COMPLETED,
            2: BRIDGE_STATUS.MINT_FAILED
        };
        const depositStatus = statusMap[decoded[4]] || "unknown";

        await Transaction.findOneAndUpdate(
            {
                bridgeStatus: BRIDGE_STATUS.DELIVERED,
                txId,
                amount
            },
            {
                $set: { bridgeStatus: depositStatus }
            },
            { returnDocument: "after" }
        );

        const bridgeTx = await BridgeTx.findOneAndUpdate(
            {
                txId,
                targetTxHash: ""
            },
            {
                $set: { targetTxHash: log.transactionHash }
            },
            { returnDocument: "after" }
        );

        if (bridgeTx) {
            await Transaction.findOneAndUpdate(
                {
                    txHash: log.transactionHash,
                    amount
                },
                {
                    $set: {
                        origSender: bridgeTx.origSender,
                        bridged: true,
                        bridgeTxId: bridgeTx.txId
                    }
                },
                { returnDocument: "after" }
            );
        }
    }
}

// Main block-scan flow: collect transfers, persist them, then update bridge state.
// 单次区块扫描主流程：收集交易、入库、再回写桥接状态。
async function processBlock(chainCfg, blockNumber, blockNumberEnd) {
    let chainName;
    try {
        chainName = chainCfg.chainName;
        const chainId = chainCfg.chainId;
        const provider = providers[chainId].provider;
        const logsArray = [];
        const timestampCache = new Map();

        const logs = await provider.getLogs({
            fromBlock: blockNumber,
            toBlock: blockNumberEnd,
            address: SUPPORTED_TOKEN_ADDRESSES,
            topics: [
                [TRANSFER_TOPIC, TOKEN_HANDLED_TOPIC]
            ]
        });

        await collectErc20Transactions(
            logs.filter((log) => log.topics[0] === TRANSFER_TOPIC),
            chainCfg,
            provider,
            timestampCache,
            logsArray
        );
        await collectNativeTransactions(provider, chainCfg, blockNumber, blockNumberEnd, logsArray);
        if (logsArray.length > 0) {
            console.log(`[monitor] ${chainCfg.chainName} detected ${logsArray.length} candidate transaction(s) from block ${blockNumber} to ${blockNumberEnd}`);
        }
        await persistTransactions(provider, logsArray);
        await handleTokenHandledEvents(
            chainId,
            logs.filter((log) => log.topics[0] === TOKEN_HANDLED_TOPIC)
        );
    } catch (err) {
        const error = new Error(`[${chainName}] process block ${blockNumber} failed: ${err.message}`);
        error.code = isTimeoutError(err) ? "TIMEOUT" : (err.code || "PROCESS_BLOCK_ERROR");
        error.cause = err;
        throw error;
    }
}

// Quote Hyperlane dispatch cost and cache the result for the same message briefly.
// 估算 Hyperlane 发消息成本，并对同一条消息做短时缓存。
async function quoteHyperlaneFee(provider, mailboxAddress, txId, receiver, token, amount) {
    try {
        const cacheKey = [
            mailboxAddress.toLowerCase(),
            txId,
            receiver.toLowerCase(),
            token.toLowerCase(),
            amount.toString()
        ].join(":");
        const now = Date.now();
        const cachedQuote = hyperlaneQuoteCache.get(cacheKey);
        if (cachedQuote && cachedQuote.expiresAt > now) {
            return cachedQuote.value;
        }

        const mailbox = new ethers.Contract(mailboxAddress, [
            "function quoteDispatch(uint32 destinationDomain, bytes32 recipient, bytes calldata messageBody) external view returns (uint256)"
        ], provider);

        const messageBody = ethers.AbiCoder.defaultAbiCoder().encode(
            ["string", "address", "address", "uint256"],
            [txId, receiver, token, amount]
        );

        const quoteValue = await mailbox.quoteDispatch(
            TARGET_CHAIN_ID,
            ethers.zeroPadValue(ethers.getAddress(process.env.HYPERLANE_RECEIVER_ADDRESS), 32),
            messageBody
        );
        hyperlaneQuoteCache.set(cacheKey, {
            value: quoteValue,
            expiresAt: now + HYPERLANE_QUOTE_CACHE_TTL_MS
        });
        return quoteValue;
    } catch (err) {
        console.error("quoteHyperlaneFee failed, using fallback:", err.message);
        return ethers.parseEther("0.00000012");
    }
}

// Process one pending bridge deposit from vault validation to final state writeback.
// 处理一笔待桥接入金：从 vault 校验一直到最终状态回写。
async function processBridge(tx) {
    let handleStatus = "";
    let errMessage = "";

    try {
        const chainId = tx.chainId;
        const provider = providers[chainId].provider;
        const code = await provider.getCode(tx.to);

        // Validate the vault target first; deploy it when the address exists but code is missing.
        // 先校验 vault 目标地址；若地址存在但未部署合约，则尝试补部署。
        handleStatus = BRIDGE_STATUS.CHECK_VAULT;
        if (code === "0x") {
            const userRecord = await ensureUserVaultByAddress(chainId, tx.to);
            if (!userRecord?.salt) {
                errMessage = "vault address not found in users";
                return;
            }

            const predictedVault = await deployVault.computeAddress(chainId, userRecord.salt);
            console.log("[bridge checkvault] computed vault address", {
                txId: tx.txId,
                chainId,
                depositVault: tx.to,
                predictedVault,
                salt: userRecord.salt
            });

            if (predictedVault.toLowerCase() !== tx.to.toLowerCase()) {
                errMessage = `vault address mismatch: deposit=${tx.to}, predicted=${predictedVault}`;
                return;
            }

            const deployed = await deployVault.deploy(chainId, userRecord.salt);
            const deployedAddress = String(deployed.address || "").toLowerCase();
            if (deployedAddress && deployedAddress !== tx.to.toLowerCase()) {
                errMessage = `vault deploy address mismatch: deposit=${tx.to}, deployed=${deployed.address}`;
                return;
            }
            if (deployed.result !== true && deployed.message !== "already deployed") {
                errMessage = deployed.message || "vault deploy failed";
                return;
            }
        }

        const ti = tx.type === "Native"
            ? getWrapperToken(TARGET_CHAIN_ID)
            : getTokenInfoByKey(TARGET_CHAIN_ID, tx.tokenKey);
        if (!ti) return;

        // On first handling, register BridgeTx once. Existing unfinished records stay for manual review.
        // 首次处理时先登记 BridgeTx；若已有未完成记录，则保留给人工确认。
        if (tx.retry === 0) {
            handleStatus = BRIDGE_STATUS.BRIDGE_TX;
            const record = await BridgeTx.findOneAndUpdate(
                { txId: tx.txId, targetTxHash: "" },
                {
                    $setOnInsert: {
                        txId: tx.txId,
                        txHash: tx.txHash,
                        origSender: tx.origSender,
                        recipient: tx.to,
                        token: ti.token.address,
                        tokenKey: ti.tokenKey,
                        tokenSymbol: ti.token.symbol,
                        amount: tx.amount,
                        sourceChainId: tx.chainId,
                        sourceChain: tx.chainName,
                        targetChainId: TARGET_CHAIN_ID,
                        targetChain: TARGET_CHAIN_NAME,
                        sourceTxHash: "",
                        targetTxHash: "",
                        deductTxHash: "",
                        timestamp: tx.timestamp
                    }
                },
                { upsert: true, returnDocument: "before" }
            );
            if (record) return;
        }

        const toAmountWei = ethers.parseUnits(tx.amount, ti.token.decimals);
        const vaultContract = getWriteContract(chainId, tx.to, VAULT_ADDRESS_ABI, "vault");

        // skipDeduct=1 means the vault already paid out, so retries must not deduct again.
        // skipDeduct=1 表示之前已经成功扣款，重试时不能再次扣款。
        if (tx.skipDeduct !== 1) {
            handleStatus = BRIDGE_STATUS.DEDUCTING;
            const gasOption = createGasOptions(await getCachedFeeData(chainId));
            const signerAddress = await getManagedSigner(chainId).getAddress();
            const vaultOwner = await readVaultOwnerForDebug(vaultContract);
            const vaultBalance = tx.type === "Native"
                ? {
                    raw: (await provider.getBalance(tx.to)).toString(),
                    formatted: formatDebugUnits(await provider.getBalance(tx.to), ti.token.decimals)
                }
                : await readVaultTokenBalanceForDebug(provider, tx.token, tx.to, ti.token.decimals);

            console.log("[bridge deduct] start", {
                txId: tx.txId,
                sourceTxHash: tx.txHash,
                chainId,
                chainName: tx.chainName,
                vault: tx.to,
                vaultOwner,
                signerAddress,
                deductRecipient: process.env.SIGNER_ADDRESS,
                txType: tx.type,
                token: tx.token,
                tokenKey: tx.tokenKey,
                tokenSymbol: tx.tokenSymbol,
                amount: tx.amount,
                amountWei: toAmountWei.toString(),
                vaultBalance,
                gasLimit: gasOption.gasLimit.toString(),
                maxFeePerGas: gasOption.maxFeePerGas.toString(),
                maxPriorityFeePerGas: gasOption.maxPriorityFeePerGas.toString()
            });

            try {
                if (tx.type === "Native") {
                    await vaultContract.withdrawETH.staticCall(process.env.SIGNER_ADDRESS, toAmountWei);
                } else {
                    await vaultContract.withdrawToken.staticCall(tx.token, process.env.SIGNER_ADDRESS, toAmountWei);
                }
                console.log("[bridge deduct] staticCall ok", {
                    txId: tx.txId,
                    vault: tx.to,
                    token: tx.token,
                    amountWei: toAmountWei.toString()
                });
            } catch (err) {
                console.error("[bridge deduct] staticCall failed", {
                    txId: tx.txId,
                    vault: tx.to,
                    token: tx.token,
                    amountWei: toAmountWei.toString(),
                    error: normalizeErrorMessage(err)
                });
                throw err;
            }

            const txS = tx.type === "Native"
                ? await vaultContract.withdrawETH(process.env.SIGNER_ADDRESS, toAmountWei, gasOption)
                : await vaultContract.withdrawToken(tx.token, process.env.SIGNER_ADDRESS, toAmountWei, gasOption);

            console.log("[bridge deduct] sent", {
                txId: tx.txId,
                hash: txS.hash
            });
            await BridgeTx.updateOne({ txId: tx.txId }, { $set: { deductTxHash: txS.hash } });
            const receipt = await txS.wait();
            console.log("[bridge deduct] receipt", {
                txId: tx.txId,
                hash: txS.hash,
                status: receipt?.status,
                blockNumber: receipt?.blockNumber,
                gasUsed: receipt?.gasUsed?.toString?.()
            });
            if (!receipt || receipt.status !== 1) throw new Error("deduct failed");
        }

        // Assets from non-target chains are forwarded through Hyperlane messaging.
        // 非目标链资产通过 Hyperlane 发消息转发到目标链处理。
        if (chainId !== CHAIN_IDS.ETH_SEPOLIA && chainId !== CHAIN_IDS.SCROLL_SEPOLIA) {
            handleStatus = BRIDGE_STATUS.MESSAGING;
            const txC = await sendHToHyperlane(tx, ti.token.address, toAmountWei);
            await BridgeTx.updateOne({ txId: tx.txId }, { $set: { sourceTxHash: txC.hash } });
            const receipt = await txC.wait();
            if (!receipt || receipt.status !== 1) throw new Error("messaging failed");
        } else {
            // Target-chain or special-chain flows use local receiver.handle for internal settlement.
            // 目标链或特殊链场景直接调用本地 receiver.handle 完成内部结算。
            handleStatus = BRIDGE_STATUS.SWAP;
            const receiver = getWriteContract(
                TARGET_CHAIN_ID,
                process.env.HYPERLANE_RECEIVER_ADDRESS,
                HYPERLANE_RECEIVER_ABI,
                "hyperlane-receiver"
            );

            const messageBody = ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "address", "address", "uint256"],
                [tx.txId, tx.to, ti.token.address, toAmountWei]
            );

            const tx2 = await receiver.handle(
                TARGET_CHAIN_ID,
                ethers.zeroPadValue(process.env.SIGNER_ADDRESS, 32),
                messageBody,
                {
                    value: 0,
                    ...createGasOptions(await getCachedFeeData(TARGET_CHAIN_ID))
                }
            );
            await BridgeTx.updateOne({ txId: tx.txId }, { $set: { sourceTxHash: tx2.hash } });
            const receipt = await tx2.wait();
            if (!receipt || receipt.status !== 1) throw new Error("internal swap failed");
        }

        handleStatus = BRIDGE_STATUS.DELIVERED;
    } catch (err) {
        errMessage = err.shortMessage || err.message || "unknown error";
        console.error(`[bridge failed] tx ${tx.txHash}: ${errMessage}`);
    } finally {
        if (!handleStatus) return;

        // After deduct or messaging failures, return to pending so the remaining half can resume.
        // 扣款后或发消息后失败时，回到 pending 以便继续补后半程。
        const finalStatus = (
            handleStatus === BRIDGE_STATUS.MESSAGING ||
            handleStatus === BRIDGE_STATUS.DEDUCTING
        ) ? BRIDGE_STATUS.PENDING : handleStatus;

        const updateObj = {
            $set: {
                bridgeStatus: finalStatus
            }
        };

        if (handleStatus === BRIDGE_STATUS.MESSAGING) {
            updateObj.$set.skipDeduct = 1;
        }

        if (errMessage) {
            updateObj.$set.bridgeErrLast = errMessage;
            updateObj.$inc = { retry: 1 };
        }

        await Transaction.updateOne({ _id: tx._id }, updateObj);
    }
}

// Send the bridge message through the source-chain Hyperlane sender contract.
// 通过源链的 Hyperlane sender 合约发送桥接消息。
async function sendHToHyperlane(tx, token, amount) {
    const targetChainCfg = CHAINS_BY_ID.get(tx.chainId);
    if (!targetChainCfg) throw new Error(`Unsupported chainId: ${tx.chainId}`);

    const provider = providers[tx.chainId].provider;
    const contractSender = getWriteContract(
        tx.chainId,
        targetChainCfg.hyperlane.Sender,
        HYPERLANE_SENDER_ABI,
        "hyperlane-sender"
    );
    const gasFeeInWei = await quoteHyperlaneFee(
        provider,
        targetChainCfg.hyperlane.Mailbox,
        tx.txId,
        tx.to,
        token,
        amount
    );

    return contractSender.sendMessage(
        TARGET_CHAIN_ID,
        process.env.HYPERLANE_RECEIVER_ADDRESS,
        tx.txId,
        tx.to,
        token,
        amount,
        {
            value: (gasFeeInWei * 115n) / 100n,
            ...createGasOptions(await getCachedFeeData(tx.chainId))
        }
    );
}

// Lock only the oldest pending item per chain to reduce same-chain nonce contention.
// 每轮只锁每条链最老的一笔 pending，减少同链 nonce 冲突。
async function lockAndGetPendingTransactions(limit = 20) {
    const lockedTxs = [];

    try {
        const candidates = await Transaction.aggregate([
            { $match: { bridgeStatus: BRIDGE_STATUS.PENDING } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: "$chainId",
                    doc: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$doc" } },
            { $limit: limit }
        ]);

        for (const tx of candidates) {
            const locked = await Transaction.findOneAndUpdate(
                {
                    _id: tx._id,
                    bridgeStatus: BRIDGE_STATUS.PENDING
                },
                {
                    $set: { bridgeStatus: BRIDGE_STATUS.PROCESSING },
                    $inc: { lockAttempt: 1 }
                },
                { returnDocument: "after" }
            );

            if (locked) lockedTxs.push(locked);
        }

        console.log(`locked ${lockedTxs.length} pending transactions`);
        return lockedTxs;
    } catch (err) {
        console.error("lock pending bridge queue failed:", err.message);
        return lockedTxs;
    }
}

// Poll the pending bridge queue on a timer and process jobs with concurrency limits.
// 定时扫描 pending bridge 队列，并按并发限制执行任务。
async function scanPendingBridges() {
    try {
        const pendingTxs = await lockAndGetPendingTransactions(RECEIPT_CONCURRENCY);
        const bridgeLimit = pLimit(RECEIPT_CONCURRENCY);
        await Promise.all(
            pendingTxs.map((tx) => bridgeLimit(() => processBridge(tx)))
        );
    } catch (err) {
        console.log("scanPendingBridges error=" + err.message);
    } finally {
        setTimeout(scanPendingBridges, 5000);
    }
}

// Start one chain monitor with timeout handling and automatic RPC rotation.
// 启动单条链的监听器，支持超时处理和 RPC 自动轮换。
async function startMonitor(chainCfg) {
    const chainId = chainCfg.chainId;
    const state = providers[chainId] = {
        currentRpcIndex: 0,
        failCount: 0,
        provider: null
    };

    await getProvider(chainCfg);

    let lastProcessed = await getLastProcessedBlock(chainCfg.chainKey);
    console.log(`[${chainCfg.chainName}] monitor start from block ${lastProcessed}`);

    // Poll forward by confirmed block windows, then persist progress after each batch.
    // 按确认后的区块窗口持续追块，并在每个批次后保存进度。
    async function poll() {
        try {
            const currentBlock = await state.provider.getBlockNumber();
            const targetBlock = currentBlock - chainCfg.confirmations;

            while (lastProcessed < targetBlock) {
                const startBlock = lastProcessed + 1;
                const endBlock = Math.min(startBlock + 199, targetBlock);
                await processBlock(chainCfg, startBlock, endBlock);
                lastProcessed = endBlock;
                await setLastProcessedBlock(chainCfg.chainKey, lastProcessed);
                state.failCount = 0;
            }
        } catch (err) {
            if (err.code === "TIMEOUT") {
                state.failCount++;
                if (state.failCount >= 3) {
                    state.failCount = 0;
                    state.currentRpcIndex++;
                    await getProvider(chainCfg);
                }
            } else {
                console.error(`[${chainCfg.chainName}] poll error:`, err.shortMessage || err.message);
            }
        }

        setTimeout(poll, chainCfg.blockScanInterval * 1000);
    }

    poll();
}

// Load vault addresses into memory for fast deposit and withdrawal direction checks.
// 把 vault 地址加载到内存中，便于快速判断入金和出金方向。
async function getVaultAddress() {
    try {
        const addresses = await UserVault.find({}, { vaultAddress: 1, _id: 0 });
        vaultAddresses.clear();
        for (const addr of addresses) {
            registerVaultAddress(addr.vaultAddress);
        }
    } catch (err) {
        console.error("load vault addresses failed:", err.message);
    }
}

async function syncVaultAddressesIncremental() {
    try {
        const addresses = await UserVault.find({}, { vaultAddress: 1, _id: 0 }).lean();
        let added = 0;
        for (const row of addresses) {
            if (registerVaultAddress(row?.vaultAddress)) added += 1;
        }
        if (added > 0) {
            console.log(`[monitor] synced ${added} new vault address(es), total=${vaultAddresses.size}`);
        }
    } catch (err) {
        console.error("[monitor] incremental vault sync failed:", err.message);
    }
}

// Application bootstrap: load vaults, start chain monitors, and start bridge scanning.
// 应用启动入口：加载 vault 地址、启动所有链监听、启动桥接扫描器。
async function startApplication() {
    console.log("loading vault addresses...");
    await getVaultAddress();
    console.log(`loaded ${vaultAddresses.size} vault addresses`);
    setInterval(syncVaultAddressesIncremental, VAULT_ADDRESS_REFRESH_INTERVAL_MS);

    for (const chainCfg of getChains()) {
        startMonitor(chainCfg);
    }

    console.log("starting pending bridge scanner...");
    scanPendingBridges();
}

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("MongoDB connected");
        await ensureUserVaultIndexes();
        await startApplication();
    })
    .catch((err) => {
        console.error("MongoDB connection failed:", err.message);
        process.exit(1);
    });
