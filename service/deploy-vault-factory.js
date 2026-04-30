// deploy-vault-factory.js
const { ethers, NonceManager } = require("ethers");
const { getChains } = require("../server-api/config/chainConfig");
require("dotenv").config();

// === 配置 ===
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_DEPLOYER = process.env.FACTORY_ADDRESS;


if (!PRIVATE_KEY) throw new Error("請在 .env 填 PRIVATE_KEY");

const DEPLOYER_ABI = [
    "function deploy(uint256 value, bytes32 salt, bytes memory code) external returns (address)",
    "function computeAddress(bytes32 salt, bytes32 memory codeHash) external view returns (address)"
];

const USER_VAULT_ABI = [
    "function initialize(bytes32 _emailHash, address _backendSigner, tuple(address usdt, address usdc, address weth, address oracleUsdt, address oracleUsdc, address oracleWeth) _config) external",
    "function owner() external view returns (address)",
    "function tokenConfig() external view returns (tuple(address usdt, address usdc, address weth, address oracleUsdt, address oracleUsdc, address oracleWeth))"
];

const deployVault = {

    getSalt(email) {
        return ethers.keccak256(ethers.toUtf8Bytes(email));
    },

    async computeAddress(chainId, salt) {
        const config = getChains().find(c => c.chainId === chainId);
        if (!config) {
            throw new Error(`Unsupported chainId: ${chainId}`);
        }

        const provider = new ethers.JsonRpcProvider(config.rpc.http[0]);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const deployer = new ethers.Contract(PUBLIC_DEPLOYER, DEPLOYER_ABI, wallet);
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address"],
            [wallet.address]
        );

        let vaultFactoryBytecode = process.env.USER_VAULT_BYTECODE;
        vaultFactoryBytecode += encoded.slice(2);

        const codeHash = ethers.keccak256(vaultFactoryBytecode);
        return deployer.computeAddress(salt, codeHash);
    },


    async deploy(chainId, salt) {
        const data = {
            result: false,
            chainId: chainId,
            salt: salt,
            message: "",
            address: ""
        }
        let chainName;
        try {
            //console.log(getChains());
            const config = getChains().find(c => c.chainId === chainId);
            if (!config) {
                throw new Error(`Unsupported chainId: ${chainId}`);
            }

            //console.log(config);

            chainName = config.chainName;
            console.log(`\n=== 在 ${chainName} 部署 VaultFactory ===`);
            //console.log("chainId=" + chainId);
            //console.log("salt=" + SALT);
            //console.log("email=" + email);

            //console.log("http rpc=" + config.rpc.http[0]);
            const provider = new ethers.JsonRpcProvider(config.rpc.http[0]);
            const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

            //const signer = new NonceManager(wallet);
            //signer.reset();

            const deployer = new ethers.Contract(PUBLIC_DEPLOYER, DEPLOYER_ABI, wallet);
            //const deployer = new ethers.Contract(PUBLIC_DEPLOYER, DEPLOYER_ABI, signer);

            //console.log("wallet=" + wallet.address);
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address"],
                [wallet.address]
            );

            let VAULT_FACTORY_BYTECODE = process.env.USER_VAULT_BYTECODE;
            VAULT_FACTORY_BYTECODE += encoded.slice(2);


            // 計算 codeHash
            const codeHash = ethers.keccak256(VAULT_FACTORY_BYTECODE);
            //console.log(codeHash);

            // 使用 codeHash 計算預期地址
            const predicted = await deployer.computeAddress(salt, codeHash);   // ← 已修正為 codeHash

            console.log(`預期地址: ${predicted} : ${chainId}`);
            //console.log(predicted);
            //console.log(SALT);

            //return;

            // 檢查是否已部署
            let deployAble = true;
            const code = await provider.getCode(predicted);
            if (code !== "0x") {
                //console.log("已存在合約，跳過部署");
                if (chainId === 11155111) {
                    try {
                        const existingVault = new ethers.Contract(predicted, USER_VAULT_ABI, wallet);
                        const currentConfig = await existingVault.tokenConfig();
                        console.log("[vault already deployed] current tokenConfig", {
                            vault: predicted,
                            usdt: currentConfig.usdt,
                            usdc: currentConfig.usdc,
                            weth: currentConfig.weth,
                            oracleUsdt: currentConfig.oracleUsdt,
                            oracleUsdc: currentConfig.oracleUsdc,
                            oracleWeth: currentConfig.oracleWeth
                        });
                    } catch (configErr) {
                        console.log("[vault already deployed] tokenConfig read failed:", configErr.message);
                    }
                }
                deployAble = false;
                data.message = "already deployed"; data.address = predicted;
                return data;
            }

            const predictedQ = ethers.getCreate2Address(
                PUBLIC_DEPLOYER,
                salt,
                codeHash
            );

            const feeData = await provider.getFeeData();
            const gasOption = {
                gasLimit: 6000000,
                maxFeePerGas: feeData.maxFeePerGas * 2n,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n
            }

            if (deployAble) {
                // 部署
                console.log("開始部署..." + predicted + " : " + chainId);
                const tx = await deployer.deploy(0, salt, VAULT_FACTORY_BYTECODE, { ...gasOption });
                //console.log("交易 Hash:", tx.hash);

                const receipt = await tx.wait();
                if (receipt.status !== 1) throw new Error("vault deploy failed");

                // 3. 額外等待，讓節點完全同步 nonce
                // await new Promise(resolve => setTimeout(resolve, 2000));

                console.log("實際地址:", predictedQ);

                if (predicted.toLowerCase() === predictedQ.toLowerCase()) {
                    console.log("🎉 成功！地址完全相同");
                } else {
                    console.log("❌ 地址不一致");
                    data.message = "generated address not match"; data.address = predictedQ;
                    return data;
                }
            }

            // 呼叫 initialize
            if (chainId === 11155111) {
                //signer.reset();
                const userVault = new ethers.Contract(predictedQ, USER_VAULT_ABI, wallet);
                //const userVault = new ethers.Contract(predictedQ, USER_VAULT_ABI, signer);
                console.log("正在初始化 UserVault...");

                const _signerAddress = process.env.SIGNER_ADDRESS;
                const tokenConfig = config.tokens;
                const oracleConfig = config.oracle;
                console.log("[vault initialize] config", {
                    usdt: tokenConfig.USDT.address,
                    usdc: tokenConfig.USDC.address,
                    weth: tokenConfig.WETH.address,
                    oracleUsdt: oracleConfig.USDT,
                    oracleUsdc: oracleConfig.USDC,
                    oracleWeth: oracleConfig.WETH
                });
                const txInit = await userVault.initialize(
                    salt,
                    _signerAddress,
                    {
                        usdt: tokenConfig.USDT.address,
                        usdc: tokenConfig.USDC.address,
                        weth: tokenConfig.WETH.address,
                        oracleUsdt: oracleConfig.USDT,
                        oracleUsdc: oracleConfig.USDC,
                        oracleWeth: oracleConfig.WETH
                    },
                    { ...gasOption });
                console.log("initial hash=" + txInit.hash);
                const receipt1 = await txInit.wait(); // wait 1 block confirmation
                if (receipt1.status !== 1) throw new Error("vault address initial failed");
                try {
                    const currentConfig = await userVault.tokenConfig();
                    console.log("[vault initialize] current tokenConfig", {
                        vault: predictedQ,
                        usdt: currentConfig.usdt,
                        usdc: currentConfig.usdc,
                        weth: currentConfig.weth,
                        oracleUsdt: currentConfig.oracleUsdt,
                        oracleUsdc: currentConfig.oracleUsdc,
                        oracleWeth: currentConfig.oracleWeth
                    });
                } catch (configErr) {
                    console.log("[vault initialize] tokenConfig read failed:", configErr.message);
                }

                console.log("✅ UserVault 初始化成功！");
                data.result = true; data.address = predictedQ;
                return data;

            } else {
                data.result = true; data.address = predictedQ;
                return data;
            }

        } catch (err) {
            console.error(`deploy [${chainName}] 错误: ${err.message}`);
            return { result: false, message: err.message };
        }
    }
}

// async function main() {
//     const email = "test32a@hotmail.com";
//     const SALT = ethers.keccak256(ethers.toUtf8Bytes(email));
//     console.log(SALT);
//     //0x110653f41246d478452c696a3acdddf06bc16dfa
//     await deployVault.deploy(11155111, SALT); // ETH Sepolia
//     //     await deployVault.deploy(84532, SALT); // Base Sepolia
//     //     await deployVault.deploy(421614, SALT); // Arb Sepolia
//     //     await deployVault.deploy(11155420, SALT);  // op Sepolia
// }

// main().catch((error) => {
//     console.error("錯誤:", error.message);
//     process.exit(1);
// });

module.exports = {
    deployVault
};

