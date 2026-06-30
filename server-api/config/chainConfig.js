require("dotenv").config();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ====================== 多鏈 Token 配置 ======================
const CHAIN_CONFIGS = {
    sepolia: {
        chainId: 11155111,
        name: "ETH Sepolia",
        blockExplorer: "https://sepolia.etherscan.io",
        tokens: {
            ETH: { symbol: "ETH", decimals: 18, address: "0x0000000000000000000000000000000000000000", isNative: true },
            USDT: { symbol: "USDT", decimals: 6, address: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276", isFilter: true },
            USDC: { symbol: "USDC", decimals: 6, address: "0x8103bA460035D0039746DA9fb59C6207CCf93A3A", isFilter: true },
            WETH: { symbol: "WETH", decimals: 18, address: "0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7", isFilter: true, isWrapperToken: true }
        },
        oracle: {
            USDT: "0x3E2f17A06E3a5DaC2B1B10efB22FF9E176e456C1",
            USDC: "0x18B1Fb50B96079C4278014363af66412cad4Dd75",
            WETH: "0xa931b04Ab75ea2baF3c1307573b64f7C5243A2A2"
        },
        hyperlane: {
            Sender: "0xc16Ba4eD94F38BCd0f221bb18907EBcEACf3a92f",
            Mailbox: "0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766"
        },
        RPC: {
            http: [
                "https://rpc.sepolia.ethpandaops.io",
                "https://eth-sepolia-testnet.api.pocket.network",
                "https://rpc.owlracle.info/sepolia/70d38ce1826c4a60bb2a8e05a6c8b20f",
                "https://api.zan.top/eth-sepolia",
                "https://sepolia.rpc.sentio.xyz",
                "https://ethereum-sepolia-public.nodies.app",
                "https://eth-sepolia.api.onfinality.io/public",
                "https://sepolia.gateway.tenderly.co",
                "https://1rpc.io/sepolia",
                "https://eth-sepolia.g.alchemy.com/v2/oBUuDpANEqYYdeWGf9BTB",
                "https://ethereum-sepolia-rpc.publicnode.com"
            ]
        },
        confirmations: 3,
        blockScanInterval: 40, // unit : second(s)
    },
    baseSepolia: {
        chainId: 84532,
        name: "Base Sepolia",
        blockExplorer: "https://sepolia.basescan.org",
        tokens: {
            ETH: { symbol: "ETH", decimals: 18, address: "0x0000000000000000000000000000000000000000", isNative: true },
            USDT: { symbol: "USDT", decimals: 6, address: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276", isFilter: true },
            USDC: { symbol: "USDC", decimals: 6, address: "0x8103bA460035D0039746DA9fb59C6207CCf93A3A", isFilter: true },
            WETH: { symbol: "WETH", decimals: 18, address: "0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7", isFilter: true, isWrapperToken: true }
        },
        oracle: {
            USDT: "0x0000000000000000000000000000000000000000",
            USDC: "0x0000000000000000000000000000000000000000",
            WETH: "0x0000000000000000000000000000000000000000"
        },
        hyperlane: {
            Sender: "0xc16Ba4eD94F38BCd0f221bb18907EBcEACf3a92f",
            Mailbox: "0x6966b0E55883d49BFB24539356a2f8A673E02039"
        },
        RPC: {
            http: [
                "https://sepolia.base.org",
                "https://base-sepolia.g.alchemy.com/v2/oBUuDpANEqYYdeWGf9BTB",
                "https://base-sepolia-public.nodies.app",
                "https://base-sepolia.api.onfinality.io/public",
                "https://base-sepolia-rpc.publicnode.com",
                "https://base-sepolia.g.alchemy.com/v2/dJuXXVEjn9U0JpfogvNfL"
            ]
        },
        confirmations: 10,
        blockScanInterval: 30, // unit : second(s)        
    },
    arbitrumSepolia: {
        chainId: 421614,
        name: "Arbitrum Sepolia",
        blockExplorer: "https://sepolia.arbiscan.io",
        tokens: {
            ETH: { symbol: "ETH", decimals: 18, address: "0x0000000000000000000000000000000000000000", isNative: true },
            USDT: { symbol: "USDT", decimals: 6, address: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276", isFilter: true },
            USDC: { symbol: "USDC", decimals: 6, address: "0x8103bA460035D0039746DA9fb59C6207CCf93A3A", isFilter: true },
            WETH: { symbol: "WETH", decimals: 18, address: "0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7", isFilter: true, isWrapperToken: true }
        },
        oracle: {
            USDT: "0x0000000000000000000000000000000000000000",
            USDC: "0x0000000000000000000000000000000000000000",
            WETH: "0x0000000000000000000000000000000000000000"
        },
        hyperlane: {
            Sender: "0xc16Ba4eD94F38BCd0f221bb18907EBcEACf3a92f",
            Mailbox: "0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8"
        },
        RPC: {
            http: [
                "https://sepolia-rollup.arbitrum.io/rpc",
                "https://arbitrum-sepolia-rpc.publicnode.com",
                "https://arb-sepolia.g.alchemy.com/v2/oBUuDpANEqYYdeWGf9BTB",
                "https://arb-sepolia.g.alchemy.com/v2/dJuXXVEjn9U0JpfogvNfL"
            ],
        },
        confirmations: 10,
        blockScanInterval: 35, // unit : second(s)      
    },
    optimismSepolia: {
        chainId: 11155420,
        name: "Optimism Sepolia",
        blockExplorer: "https://sepolia-optimism.etherscan.io",
        tokens: {
            ETH: { symbol: "ETH", decimals: 18, address: "0x0000000000000000000000000000000000000000", isNative: true },
            USDT: { symbol: "USDT", decimals: 6, address: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276", isFilter: true },
            USDC: { symbol: "USDC", decimals: 6, address: "0x8103bA460035D0039746DA9fb59C6207CCf93A3A", isFilter: true },
            WETH: { symbol: "WETH", decimals: 18, address: "0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7", isFilter: true, isWrapperToken: true }
        },
        oracle: {
            USDT: "0x0000000000000000000000000000000000000000",
            USDC: "0x0000000000000000000000000000000000000000",
            WETH: "0x0000000000000000000000000000000000000000"
        },
        hyperlane: {
            Sender: "0xc16Ba4eD94F38BCd0f221bb18907EBcEACf3a92f",
            Mailbox: "0x6966b0E55883d49BFB24539356a2f8A673E02039"
        },
        RPC: {
            http: [
                "https://optimism-sepolia.api.onfinality.io/public",
                "https://optimism-sepolia.drpc.org",
                "https://optimism-sepolia.gateway.tenderly.co",
                "https://optimism-sepolia-rpc.publicnode.com",
                "https://sepolia.optimism.io",
                "https://opt-sepolia.g.alchemy.com/v2/oBUuDpANEqYYdeWGf9BTB"
            ],
        },
        confirmations: 10,
        blockScanInterval: 35, // unit : second(s)      
    },
    scrollSepolia: {
        chainId: 534351,
        name: "Scroll Sepolia",
        blockExplorer: "https://sepolia.scrollscan.com",
        tokens: {
            ETH: { symbol: "ETH", decimals: 18, address: "0x0000000000000000000000000000000000000000", isNative: true },
            USDT: { symbol: "USDT", decimals: 6, address: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276", isFilter: true },
            USDC: { symbol: "USDC", decimals: 6, address: "0x8103bA460035D0039746DA9fb59C6207CCf93A3A", isFilter: true },
            WETH: { symbol: "WETH", decimals: 18, address: "0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7", isFilter: true, isWrapperToken: true }
        },
        oracle: {
            USDT: "0x0000000000000000000000000000000000000000",
            USDC: "0x0000000000000000000000000000000000000000",
            WETH: "0x0000000000000000000000000000000000000000"
        },
        hyperlane: {
            Sender: "0x0000000000000000000000000000000000000000",
            Mailbox: "0x0000000000000000000000000000000000000000"
        },
        RPC: {
            http: [
                "https://scroll-sepolia-rpc.publicnode.com",
            ],
        },
        confirmations: 10,
        blockScanInterval: 35, // unit : second(s)      
    },
}

function getFilterTokenAddresses() {
    const allAddresses = new Set();

    for (const chainKey in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainKey];
        for (const tokenKey in chain.tokens) {
            const token = chain.tokens[tokenKey]
            if (token.isFilter && token.address) {
                allAddresses.add(token.address.toLowerCase());
            }
        }
    }

    return Array.from(allAddresses);     // ← 推荐返回数组
}

/**
 * 根据 chainId 和 token key 获取地址
 * 示例: getTokenAddressByKey(11155111, "USDT")
 */
function getTokenAddressByKey(chainId, tokenKey) {
    // 遍历所有链配置
    for (const chainName in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainName];

        // 如果找到匹配的 chainId
        if (chain.chainId === chainId) {
            // 返回对应 token 的 address
            return chain.tokens[tokenKey]?.address.toLowerCase() || null;
        }
    }

    return null; // 没找到返回 null
}


function getChains() {
    const chains = [];

    for (const chainName in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainName];
        const tokens = [];

        for (const tokenKey in chain.tokens) {
            const token = chain.tokens[tokenKey];
            const p = {
                tokenKey: tokenKey,
                symbol: token.symbol,
                adress: token.address.toLowerCase(),
                decimals: token.decimals,
                isNative: token.isNative || false,
                isFilter: token.isFilter || false
            }
            tokens.push(p);
        }

        chains.push({
            chainKey: chainName,
            chainId: chain.chainId,
            chainName: chain.name,
            blockExplorer: chain.blockExplorer,
            tokens: chain.tokens,
            token: tokens,
            oracle: chain.oracle,
            hyperlane: chain.hyperlane,
            rpc: chain.RPC,
            confirmations: chain.confirmations,
            blockScanInterval: chain.blockScanInterval
        });

    }
    return chains;
}


function normalizeAddress(token) {
    if (!token || token === "0x" || token === "") {
        return ZERO_ADDRESS;
    }
    return token.toLowerCase();
}

/**
 * 获取 token 完整信息
 */
/**
 * 根據 chainId 和 token address 取得 token 資訊
 */
function getTokenInfoByAddress(chainId, tokenAddress) {
    //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    let addr = tokenAddress.toLowerCase();
    // console.log("addr before=" + addr);
    // console.log("addr after=" + normalizeAddress(addr));
    addr = normalizeAddress(addr);
    //console.log("ok");

    // 遍歷所有鏈配置
    for (const chainName in CHAIN_CONFIGS) {
        //console.log("chain name=" + chainName);
        const chain = CHAIN_CONFIGS[chainName];

        // 檢查是否是我們要找的 chainId
        if (chain.chainId === chainId) {
            //  console.log("chainid match")
            // 在這個鏈的 tokens 中尋找地址
            for (const tokenKey in chain.tokens) {
                //console.log("tokenKey=" + tokenKey);
                const token = chain.tokens[tokenKey];

                if (token.address && token.address.toLowerCase() === addr) {
                    return { tokenKey, token };                    // 找到就返回整個 token 物件
                }
            }

            // 如果這個鏈沒找到，就不用繼續找其他鏈了
            break;
        }
    }

    return null;   // 沒找到返回 null
}


function getTokenInfoByKey(chainId, tokenKey) {
    // 遍历所有链配置
    for (const chainName in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainName];

        // 如果找到匹配的 chainId
        if (chain.chainId === chainId) {
            // 返回对应 token 的 address
            const token = chain.tokens[tokenKey];
            return { tokenKey, token };
        }
    }

    return null; // 没找到返回 null
}

/**
 * 根據 chainId 獲取有 isWrapperToken: true 的 token
 */
function getWrapperToken(chainId) {
    // 先找到對應的鏈
    for (const chainName in CHAIN_CONFIGS) {
        const chain = CHAIN_CONFIGS[chainName];

        if (chain.chainId === chainId) {

            // 遍歷該鏈的所有 token
            for (const tokenKey in chain.tokens) {
                const token = chain.tokens[tokenKey];

                if (token.isWrapperToken === true) {
                    return { tokenKey, token };           // 返回整個 token 物件
                }
            }
        }
    }

    return null;   // 沒找到就返回 null
}



module.exports = {
    CHAIN_CONFIGS,
    getFilterTokenAddresses,
    getTokenAddressByKey,
    getChains,
    getTokenInfoByAddress,
    getTokenInfoByKey,
    getWrapperToken
}
