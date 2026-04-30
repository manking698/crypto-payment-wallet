// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "https://cdn.jsdelivr.net/npm/@chainlink/contracts@0.8.0/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface ISwapRouter {
    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external returns (bool);
}

contract UserVault is Ownable {
    using SafeERC20 for IERC20;

    bytes32 public userEmailHash;
    address public backendSigner;
    address public swapRouter;
    address private constant DEFAULT_SWAP_ROUTER = 0xcD422cb896895060DcbA6C3d779269af634C73Ff;

    IERC20 public usdt;
    IERC20 public usdc;
    IERC20 public weth;

    AggregatorV3Interface public usdtOracle;
    AggregatorV3Interface public usdcOracle;
    AggregatorV3Interface public wethOracle;

    uint8 private constant USDT_DECIMALS = 6;
    uint8 private constant USDC_DECIMALS = 6;
    uint8 private constant WETH_DECIMALS = 18;

    event ETHWithdrawn(address indexed from, address indexed to, uint256 amount);
    event SwapRouterUpdated(address indexed newRouter);
    event VaultSwap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    struct TokenConfig {
        address usdt;
        address usdc;
        address weth;
        address oracleUsdt;
        address oracleUsdc;
        address oracleWeth;
    }
    TokenConfig public tokenConfig;

    constructor(address owner_) Ownable(owner_) {}

    function initialize(bytes32 _emailHash, address _backendSigner, TokenConfig calldata _config) external {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        require(backendSigner == address(0), "Already initialized");
        userEmailHash = _emailHash;
        backendSigner = _backendSigner;

        tokenConfig = _config;
        usdt = IERC20(_config.usdt);
        usdc = IERC20(_config.usdc);
        weth = IERC20(_config.weth);
        usdtOracle = AggregatorV3Interface(_config.oracleUsdt);
        usdcOracle = AggregatorV3Interface(_config.oracleUsdc);
        wethOracle = AggregatorV3Interface(_config.oracleWeth);

        // Temporary hardcoded router for bootstrap.
        // Replace later by calling setSwapRouter(realRouter).
        swapRouter = DEFAULT_SWAP_ROUTER;
        emit SwapRouterUpdated(DEFAULT_SWAP_ROUTER);
    }

    receive() external payable {}

    function getUsdtPrice() public view returns (uint256) {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        (, int256 price, , , ) = usdtOracle.latestRoundData();
        require(price > 0, "Invalid oracle usdt price");
        return uint256(price);
    }

    function getUsdcPrice() public view returns (uint256) {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        (, int256 price, , , ) = usdcOracle.latestRoundData();
        require(price > 0, "Invalid oracle usdc price");
        return uint256(price);
    }

    function getWethPrice() public view returns (uint256) {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        (, int256 price, , , ) = wethOracle.latestRoundData();
        require(price > 0, "Invalid oracle weth price");
        return uint256(price);
    }

    function totalVaultBalanceUSD() public view returns (uint256) {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        uint256 usdtBalance = usdt.balanceOf(address(this));
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 wethBalance = weth.balanceOf(address(this));

        uint256 usdtPrice = getUsdtPrice();
        uint256 usdcPrice = getUsdcPrice();
        uint256 wethPrice = getWethPrice();

        uint256 usdtValue = Math.mulDiv(usdtBalance, usdtPrice, 10 ** USDT_DECIMALS);
        uint256 usdcValue = Math.mulDiv(usdcBalance, usdcPrice, 10 ** USDC_DECIMALS);
        uint256 wethValue = Math.mulDiv(wethBalance, wethPrice, 10 ** WETH_DECIMALS);
        return usdtValue + usdcValue + wethValue;
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
        emit ETHWithdrawn(address(this), to, amount);
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function setSwapRouter(address _swapRouter) external onlyOwner {
        require(_swapRouter != address(0), "Invalid swap router");
        swapRouter = _swapRouter;
        emit SwapRouterUpdated(_swapRouter);
    }

    function _tokenDecimals(address token) internal view returns (uint8) {
        if (token == address(usdt)) return USDT_DECIMALS;
        if (token == address(usdc)) return USDC_DECIMALS;
        if (token == address(weth)) return WETH_DECIMALS;
        revert("Unsupported token");
    }

    function _tokenPrice(address token) internal view returns (uint256) {
        if (token == address(usdt)) return getUsdtPrice();
        if (token == address(usdc)) return getUsdcPrice();
        if (token == address(weth)) return getWethPrice();
        revert("Unsupported token");
    }

    function quoteSwapOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        require(tokenIn != tokenOut, "Same token");
        uint8 decIn = _tokenDecimals(tokenIn);
        uint8 decOut = _tokenDecimals(tokenOut);
        uint256 priceIn = _tokenPrice(tokenIn);
        uint256 priceOut = _tokenPrice(tokenOut);
        require(priceIn > 0 && priceOut > 0, "Invalid price");

        uint256 usdValue = Math.mulDiv(amountIn, priceIn, 10 ** decIn);
        return Math.mulDiv(usdValue, 10 ** decOut, priceOut);
    }

    function swapToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external onlyOwner returns (uint256 amountOut) {
        require(block.chainid == 11155111, "Function only available on ETH chain");
        require(tokenIn != tokenOut, "Same token");
        require(swapRouter != address(0), "Swap router not set");
        require(amountIn > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");

        amountOut = quoteSwapOut(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        IERC20(tokenIn).safeIncreaseAllowance(swapRouter, amountIn);
        bool ok = ISwapRouter(swapRouter).executeSwap(tokenIn, tokenOut, amountIn, amountOut, recipient);
        require(ok, "Swap failed");

        emit VaultSwap(tokenIn, tokenOut, amountIn, amountOut, recipient);
    }
}
