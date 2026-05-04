// deploy-vault-factory.js
const { ethers } = require("ethers");
const { getChains } = require("../server-api/config/chainConfig");
require("dotenv").config();

// === 配置 ===
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_DEPLOYER = process.env.FACTORY_ADDRESS;
let BYTECODE = "0x6080604052348015600e575f5ffd5b506104558061001c5f395ff3fe60806040526004361061003e575f3560e01c8063158ef93e14610042578063c4d66de814610076578063d5438eae14610097578063de236dc4146100cd575b5f5ffd5b34801561004d575f5ffd5b505f5461006190600160a01b900460ff1681565b60405190151581526020015b60405180910390f35b348015610081575f5ffd5b5061009561009036600461023c565b6100ee565b005b3480156100a2575f5ffd5b505f546100b5906001600160a01b031681565b6040516001600160a01b03909116815260200161006d565b6100e06100db366004610270565b610171565b60405190815260200161006d565b5f54600160a01b900460ff161561014b5760405162461bcd60e51b815260206004820152601f60248201527f436f6e747261637420697320616c726561647920696e697469616c697a656400604482015260640160405180910390fd5b5f80546001600160a81b0319166001600160a01b0390921691909117600160a01b179055565b5f5f8585858560405160200161018a94939291906103a6565b60408051601f19818403018152908290525f805463fa31de0160e01b8452919350916001600160a01b039182169163fa31de019134916101d3918e918e169088906004016103db565b60206040518083038185885af11580156101ef573d5f5f3e3d5ffd5b50505050506040513d601f19601f820116820180604052508101906102149190610408565b9998505050505050505050565b80356001600160a01b0381168114610237575f5ffd5b919050565b5f6020828403121561024c575f5ffd5b61025582610221565b9392505050565b634e487b7160e01b5f52604160045260245ffd5b5f5f5f5f5f5f60c08789031215610285575f5ffd5b863563ffffffff81168114610298575f5ffd5b95506102a660208801610221565b9450604087013567ffffffffffffffff8111156102c1575f5ffd5b8701601f810189136102d1575f5ffd5b803567ffffffffffffffff8111156102eb576102eb61025c565b604051601f8201601f19908116603f0116810167ffffffffffffffff8111828210171561031a5761031a61025c565b6040528181528282016020018b1015610331575f5ffd5b816020840160208301375f6020838301015280965050505061035560608801610221565b925061036360808801610221565b9598949750929591949360a090920135925050565b5f81518084528060208401602086015e5f602082860101526020601f19601f83011685010191505092915050565b608081525f6103b86080830187610378565b6001600160a01b0395861660208401529390941660408201526060015292915050565b63ffffffff84168152826020820152606060408201525f6103ff6060830184610378565b95945050505050565b5f60208284031215610418575f5ffd5b505191905056fea2646970667358221220faaf8bb54045e508bc3145c2d940529837a4c380d1187d6d360cdc2c7d6139c864736f6c63430008220033";

const email = "f2998e436d87044e2762d9f843f9672f648362cb7974d33b9da72a775a3f22ba";
const SALT = ethers.keccak256(ethers.toUtf8Bytes(email));

if (!PRIVATE_KEY) throw new Error("請在 .env 填 PRIVATE_KEY");

const DEPLOYER_ABI = [
    "function deploy(uint256 value, bytes32 salt, bytes memory code) external returns (address)",
    "function computeAddress(bytes32 salt, bytes32 memory codeHash) external view returns (address)"
];

const ABI = [
    "function initialize(address _mailbox) external",
];


const deployVault = {
    getSalt(email) {
        return ethers.keccak256(ethers.toUtf8Bytes(email));
    },


    async deploy(chainId) {
        let chainName;
        try {
            const config = getChains().find(c => c.chainId === chainId);
            if (!config) {
                throw new Error(`Unsupported chainId: ${chainId}`);
            }

            //console.log(config);

            chainName = config.chainName;
            console.log(`\n=== 在 ${chainName} 部署 Hyperlane Sender ===`);
            //console.log("salt=" + SALT);
            //console.log("email=" + email);

            const mailbox = config.hyperlane.Mailbox;
            const provider = new ethers.JsonRpcProvider(config.rpc.http[0]);
            const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
            const deployer = new ethers.Contract(PUBLIC_DEPLOYER, DEPLOYER_ABI, wallet);

            // 計算 codeHash
            const codeHash = ethers.keccak256(BYTECODE);

            // 使用 codeHash 計算預期地址
            const predicted = await deployer.computeAddress(SALT, codeHash);   // ← 已修正為 codeHash

            console.log(`預期地址: ${predicted}`);

            // 檢查是否已部署
            let deployAble = true;
            const code = await provider.getCode(predicted);
            if (code !== "0x") {
                console.log("已存在合約，跳過部署");
                deployAble = false;
                return false;
            }

            const predictedQ = ethers.getCreate2Address(
                PUBLIC_DEPLOYER,
                SALT,
                codeHash
            );

            if (deployAble) {
                // 部署
                console.log("開始部署...");
                const tx = await deployer.deploy(0, SALT, BYTECODE, { gasLimit: 5000000 });
                console.log("交易 Hash:", tx.hash);

                await tx.wait();

                // 3. 額外等待，讓節點完全同步 nonce
                await new Promise(resolve => setTimeout(resolve, 3500));

                console.log("實際地址:", predictedQ);

                if (predicted.toLowerCase() === predictedQ.toLowerCase()) {
                    console.log("🎉 成功！地址完全相同");
                } else {
                    console.log("❌ 地址不一致");
                    return false;
                }
            }

            // 呼叫 initialize
            const hyperlaneSender = new ethers.Contract(predictedQ, ABI, wallet);
            console.log("正在初始化 hyperlaneSender...");

            const txInit = await hyperlaneSender.initialize(
                mailbox,
                { gasLimit: 5000000 });
            await txInit.wait(2); // wait 2 block confirmation

            console.log("✅ hyperlaneSender 初始化成功！");
            return true;
        } catch (err) {
            console.error(`deploy [${chainName}] 错误: ${err.message}`);
        }
    }
}

async function main() {
    await deployVault.deploy(84532); // Base Sepolia
    await deployVault.deploy(421614); // Arb Sepolia
    await deployVault.deploy(11155420); // Op Sepolia
}

main().catch((error) => {
    console.error("錯誤:", error.message);
    process.exit(1);
});

module.exports = {
    deployVault
};

