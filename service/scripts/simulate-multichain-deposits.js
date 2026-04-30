const { ethers, NonceManager } = require("ethers");
const mongoose = require("mongoose");
require("dotenv").config();

const VAULT_ADDRESS_ABI = [
    "function withdrawToken(address token, address to, uint256 amount) external",
    "function withdrawETH(address to, uint256 amount) external"
];

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

const CHAINS = [
    {
        name: "Base Sepolia",
        rpcUrl: "https://sepolia.base.org",
        vaultAddress: "0xF3229B5e35BCA1A4C4C7F328906EDeF91b7b1366",
        tokenAddress: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276",
        amount: "0.00001",
        decimals: 6
    },
    {
        name: "Arbitrum Sepolia",
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        vaultAddress: "0xF3229B5e35BCA1A4C4C7F328906EDeF91b7b1366",
        tokenAddress: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276",
        amount: "1",
        decimals: 6
    },
    {
        name: "Optimism Sepolia",
        rpcUrl: "https://sepolia.optimism.io",
        vaultAddress: "0xF3229B5e35BCA1A4C4C7F328906EDeF91b7b1366",
        tokenAddress: "0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276",
        amount: "1",
        decimals: 6
    }
];

function getRandomDelay(min = 35, max = 500) {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

function createGasOptions(feeData) {
    const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits("1", "gwei");
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("0.1", "gwei");
    return {
        gasLimit: 600000n,
        maxFeePerGas: maxFeePerGas * 2n,
        maxPriorityFeePerGas: maxPriorityFeePerGas * 2n
    };
}

async function sendDepositToAddress(targetAddress) {
    for (const chain of CHAINS) {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const signer = new NonceManager(wallet);
        signer.reset();

        const vaultContract = new ethers.Contract(chain.vaultAddress, VAULT_ADDRESS_ABI, signer);
        const gasOption = createGasOptions(await provider.getFeeData());

        console.log(`[${chain.name}] start -> ${targetAddress}`);
        const tx = await vaultContract.withdrawToken(
            chain.tokenAddress,
            targetAddress,
            ethers.parseUnits(chain.amount, chain.decimals),
            gasOption
        );
        await tx.wait();
        console.log(`[${chain.name}] done -> ${tx.hash}`);
    }
}

async function loadVaultAddresses(limitCount) {
    const docs = await UserVault.find({}, { vaultAddress: 1, _id: 0 }).limit(limitCount);
    return docs
        .map((doc) => doc.vaultAddress?.toLowerCase())
        .filter(Boolean);
}

async function runOnce(limitCount) {
    const addresses = await loadVaultAddresses(limitCount);
    let index = 0;
    for (const addr of addresses) {
        index++;
        console.log(`${index}|addr=${addr}`);
        await sendDepositToAddress(addr);
    }
}

async function runLoop(limitCount) {
    while (true) {
        const delay = getRandomDelay();
        try {
            await runOnce(limitCount);
            console.log(`simulate deposits finished, next run in ${(delay / 1000).toFixed(0)}s`);
        } catch (err) {
            console.error("simulate deposits error:", err.shortMessage || err.message);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
}

async function main() {
    const limitCount = Number(process.argv[2] || 10);
    const mode = (process.argv[3] || "once").toLowerCase();

    if (!Number.isInteger(limitCount) || limitCount <= 0) {
        throw new Error("Usage: node scripts/simulate-multichain-deposits.js <limit> [once|loop]");
    }

    if (mode !== "once" && mode !== "loop") {
        throw new Error("Mode must be 'once' or 'loop'");
    }

    if (mode === "loop") {
        await runLoop(limitCount);
        return;
    }

    await runOnce(limitCount);
}

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        await main();
        await mongoose.disconnect();
    })
    .catch(async (err) => {
        console.error("simulate-multichain-deposits failed:", err.message);
        try {
            await mongoose.disconnect();
        } catch (_) {
        }
        process.exit(1);
    });
