"use strict";

const { ethers } = require("ethers");

function createVaultAddressResolver(input) {
    const {
        backendSigner,
        factoryAddress,
        factoryAbi,
        vaultFactoryBytecode
    } = input || {};

    function getSalt(email) {
        return ethers.keccak256(ethers.toUtf8Bytes(String(email || "")));
    }

    async function computeVaultAddress(email) {
        const factory = new ethers.Contract(factoryAddress, factoryAbi, backendSigner);
        const salt = getSalt(email);
        const codeHash = ethers.keccak256(vaultFactoryBytecode);
        return factory.computeAddress(salt, codeHash);
    }

    return {
        getSalt,
        computeVaultAddress
    };
}

module.exports = {
    createVaultAddressResolver
};

