"use strict";

const { createEarnHelpers } = require("../modules/earn/helpers");
const { createDomainRules } = require("../modules/common/domain-rules");
const { decimalToScaledBigInt } = require("../modules/common/format");

function buildHelpers() {
    const config = {
        EARN_ALLOWED_SYMBOLS: ["USDT", "USDC", "WETH"],
        EARN_INPUT_DECIMALS: { USDT: 2, USDC: 2, WETH: 3 },
        EARN_MIN_SUBSCRIPTION: { USDT: "10", USDC: "10", WETH: "0.005" },
        TOKEN_DECIMALS_BY_SYMBOL: { USDT: 6, USDC: 6, WETH: 18 },
        TOKENS: { USDT: "0xusdt", USDC: "0xusdc", WETH: "0xweth" },
        EARN_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
        EARN_CONTRACT_ABI: [],
        decimalToScaledBigInt
    };
    const rules = createDomainRules({ ...config, decimalToScaledBigInt });
    return createEarnHelpers({
        ethers: {
            isAddress: () => true,
            Contract: function Contract() { return {}; }
        },
        provider: {},
        backendSigner: {},
        ...config,
        validateEarnAmountInput: rules.validateEarnAmountInput
    });
}

describe("earn helpers", () => {
    test("parses subscribe amount with centralized token rules", () => {
        const helpers = buildHelpers();
        expect(helpers.parseEarnAmount("USDT", "10.50"))
            .toMatchObject({ ok: true, token: "USDT", amount: "10.50", amountRaw: 10500000n });
        expect(helpers.parseEarnAmount("USDT", "10.501"))
            .toMatchObject({ ok: false, error: "max 2 decimals allowed" });
        expect(helpers.parseEarnAmount("WETH", "0.004"))
            .toMatchObject({ ok: false, error: "minimum subscription is 0.005 WETH" });
    });

    test("allows redeem below subscribe minimum but still rejects zero", () => {
        const helpers = buildHelpers();
        expect(helpers.parseEarnAmount("WETH", "0.001", { enforceMin: false }))
            .toMatchObject({ ok: true, token: "WETH", amountRaw: 1000000000000000n });
        expect(helpers.parseEarnAmount("WETH", "0", { enforceMin: false }))
            .toMatchObject({ ok: false, error: "amount must be greater than zero" });
    });
});
