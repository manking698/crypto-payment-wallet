// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDCx is ERC20 {
    /**
     * @dev default 100000000000 USDT / 100 billion (6 decimals)
     * assign to deploy owner
     */
    constructor() ERC20("USDC", "USDC") {

        uint256 totalSupply = 100000000000 * 10 ** decimals();
        _mint(0x10E4592CA6afF3E192e339d4dF153Bf40E1f1F4a, totalSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}