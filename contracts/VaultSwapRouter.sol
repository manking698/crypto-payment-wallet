// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Simple settlement router for UserVault swap flow:
// - pulls tokenIn from caller (vault)
// - sends tokenOut from router liquidity to recipient (vault)
// Pricing is calculated in UserVault via oracle prices.
contract VaultSwapRouter is Ownable {
    using SafeERC20 for IERC20;
    event SwapExecuted(
        address indexed vault,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    constructor(address owner_) Ownable(owner_) {}

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external returns (bool) {
        require(tokenIn != address(0) && tokenOut != address(0), "Invalid token");
        require(tokenIn != tokenOut, "Same token");
        require(amountIn > 0 && amountOut > 0, "Invalid amount");
        require(recipient != address(0), "Invalid recipient");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, recipient);
        return true;
    }
}
