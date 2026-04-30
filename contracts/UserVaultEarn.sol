// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title UserVaultEarn
/// @notice Basic earn pool for USDT/USDC/WETH with owner-managed APY and manual reward claim.
/// @dev Expected flow:
/// 1) Vault transfers token to this contract
/// 2) Backend (owner) calls depositFor(beneficiary, token, amount)
contract UserVaultEarn is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant APY_BPS_DENOMINATOR = 10_000;
    uint256 public constant HOURS_PER_YEAR = 365 * 24;
    uint256 public constant ACCRUAL_INTERVAL = 1 hours;

    struct TokenConfig {
        bool enabled;
        uint256 apyBps; // e.g. 300 = 3.00%
    }

    struct Position {
        uint256 principal;
        uint256 accruedStored;
        uint256 lastAccruedAt;
    }

    mapping(address => TokenConfig) public tokenConfigs;
    mapping(address => mapping(address => Position)) private positions; // beneficiary => token => position

    event TokenConfigUpdated(address indexed token, bool enabled, uint256 apyBps);
    event Deposited(address indexed beneficiary, address indexed token, uint256 amount);
    event Redeemed(address indexed beneficiary, address indexed token, uint256 amount, address receiver);
    event RewardClaimed(address indexed beneficiary, address indexed token, uint256 reward, address receiver);

    constructor(address owner_) Ownable(owner_) {}

    function setTokenConfig(address token, bool enabled, uint256 apyBps) external onlyOwner {
        require(token != address(0), "invalid token");
        require(apyBps <= 10_000, "apy too high");
        tokenConfigs[token] = TokenConfig({ enabled: enabled, apyBps: apyBps });
        emit TokenConfigUpdated(token, enabled, apyBps);
    }

    function setApyBps(address token, uint256 apyBps) external onlyOwner {
        require(token != address(0), "invalid token");
        require(apyBps <= 10_000, "apy too high");
        TokenConfig storage cfg = tokenConfigs[token];
        require(cfg.enabled, "token not enabled");
        cfg.apyBps = apyBps;
        emit TokenConfigUpdated(token, cfg.enabled, apyBps);
    }

    function getApyBps(address token) external view returns (uint256) {
        return tokenConfigs[token].apyBps;
    }

    function getPosition(address beneficiary, address token)
        external
        view
        returns (uint256 principal, uint256 accruedStored, uint256 claimable, uint256 lastAccruedAt)
    {
        Position memory p = positions[beneficiary][token];
        principal = p.principal;
        accruedStored = p.accruedStored;
        claimable = p.accruedStored + _pendingReward(p, tokenConfigs[token].apyBps, block.timestamp);
        lastAccruedAt = p.lastAccruedAt;
    }

    function depositFor(address beneficiary, address token, uint256 amount) external onlyOwner {
        require(beneficiary != address(0), "invalid beneficiary");
        require(amount > 0, "invalid amount");
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.enabled, "token not enabled");

        Position storage p = positions[beneficiary][token];
        _accrueInPlace(p, cfg.apyBps);
        p.principal += amount;
        if (p.lastAccruedAt == 0) p.lastAccruedAt = block.timestamp;

        emit Deposited(beneficiary, token, amount);
    }

    function redeemFor(address beneficiary, address token, uint256 amount, address receiver) external onlyOwner {
        require(beneficiary != address(0), "invalid beneficiary");
        require(receiver != address(0), "invalid receiver");
        require(amount > 0, "invalid amount");
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.enabled, "token not enabled");

        Position storage p = positions[beneficiary][token];
        _accrueInPlace(p, cfg.apyBps);
        require(p.principal >= amount, "insufficient principal");
        p.principal -= amount;

        IERC20(token).safeTransfer(receiver, amount);
        emit Redeemed(beneficiary, token, amount, receiver);
    }

    function claimFor(address beneficiary, address token, address receiver) external onlyOwner returns (uint256 reward) {
        require(beneficiary != address(0), "invalid beneficiary");
        require(receiver != address(0), "invalid receiver");
        TokenConfig memory cfg = tokenConfigs[token];
        require(cfg.enabled, "token not enabled");

        Position storage p = positions[beneficiary][token];
        _accrueInPlace(p, cfg.apyBps);
        reward = p.accruedStored;
        require(reward > 0, "no rewards");
        p.accruedStored = 0;

        IERC20(token).safeTransfer(receiver, reward);
        emit RewardClaimed(beneficiary, token, reward, receiver);
    }

    function _accrueInPlace(Position storage p, uint256 apyBps) private {
        if (p.lastAccruedAt == 0) {
            p.lastAccruedAt = block.timestamp;
            return;
        }
        uint256 pending = _pendingReward(p, apyBps, block.timestamp);
        if (pending > 0) {
            p.accruedStored += pending;
        }
        p.lastAccruedAt = block.timestamp;
    }

    function _pendingReward(Position memory p, uint256 apyBps, uint256 nowTs) private pure returns (uint256) {
        if (p.principal == 0 || p.lastAccruedAt == 0 || nowTs <= p.lastAccruedAt || apyBps == 0) return 0;
        uint256 elapsed = nowTs - p.lastAccruedAt;
        uint256 elapsedHours = elapsed / ACCRUAL_INTERVAL;
        if (elapsedHours == 0) return 0;
        return (p.principal * apyBps * elapsedHours) / APY_BPS_DENOMINATOR / HOURS_PER_YEAR;
    }
}
