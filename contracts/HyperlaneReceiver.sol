// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-monorepo/main/solidity/contracts/interfaces/IMailbox.sol";
import "https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-monorepo/main/solidity/contracts/interfaces/IMessageRecipient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract Receiver is IMessageRecipient, Ownable {
    
    enum depositStatus{
        None, 
        Success, 
        Failed
    }
   
    // chain => mailbox
    mapping(address => bool) public trustedSendersMailboxs; //hyperlane source mailbox (target mailbox)

    // chain => trusted sender
    mapping(uint32 => address) public trustedSenders;

    // allowed tokens
    mapping(address => bool) public supportedTokens;

    mapping(string => bytes) public failedMessages;

    mapping(string => bool) public processed;    

    event MailboxSet(address mailbox, bool allowed);
    event SenderSet(uint32 chain, address sender);
    event TokenAdded(address token);
    event MessageReceived(
        uint32 origin,
        address handleSender,
        string txId,
        address receiver,
        address token,
        uint256 amount
    );
    event TokenHandled(
        string txId,
        address token,
        address to,
        uint256 amount,
        uint8 status
    );
        

    constructor() Ownable(msg.sender) {

        // default sepolia chain token
        supportedTokens[0x8103bA460035D0039746DA9fb59C6207CCf93A3A] = true; // USDC
        supportedTokens[0xAe7687fAe0D59Fc722564FA0e39885d5C43a3276] = true; // USDT
        supportedTokens[0x1E96C6BE8340F075524998c1f4d4f46525f3DBb7] = true; // WETH
        trustedSendersMailboxs[0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766] = true; // base sepolia
        trustedSendersMailboxs[0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8] = true; // arb sepolia
        trustedSendersMailboxs[0x6966b0E55883d49BFB24539356a2f8A673E02039] = true; // op sepolia
    }

    function setTrustedMailbox(address mbox, bool allowed) external onlyOwner {
        trustedSendersMailboxs[mbox] = allowed;
        emit MailboxSet(mbox, allowed);
    }

    function setTrustedSender(uint32 chain, address sender) external onlyOwner {
        trustedSenders[chain] = sender;
        emit SenderSet(chain, sender);
    }     


   function addToken(address token) external onlyOwner {
        supportedTokens[token] = true;
        emit TokenAdded(token);
    }

    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }    
    

    function handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _body
    ) external payable override {

        // msg.sender = hyperlane receive mailbox address = 0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766
        // _origin = hyperlane sender source domain id = 421614
        // sender = hyperlane sender contract address

        address senderAddr = address(uint160(uint256(_sender)));

        // 1. check mailbox
        require(trustedSendersMailboxs[msg.sender], "Invalid mailbox");

        // 2. verify sender
        require(senderAddr == trustedSenders[_origin], "Invalid sender");


        // decode message
        (
            string memory txId,
            address receiver,
            address token,
            uint256 amount
        ) = abi.decode(_body, (string, address, address, uint256));

        require(!processed[txId], "Already processed");

        // token whitelist
        require(supportedTokens[token], "Token not supported");

        uint256 balance = IERC20(token).balanceOf(address(this));

        emit MessageReceived(
            _origin,
            senderAddr,
            txId,
            receiver,
            token,
            amount
        );


        if (balance < amount) {
            failedMessages[txId] = _body;
            emit TokenHandled(txId, token, receiver, amount, uint8(depositStatus.Failed));
            return;
        }

        IERC20(token).transfer(receiver, amount);
        processed[txId] = true;
        emit TokenHandled(txId, token, receiver, amount, uint8(depositStatus.Success));

    }

    function retry(string memory txId) external onlyOwner {

        bytes memory body = failedMessages[txId];
        require(body.length > 0, "No failed message");

        (
            string memory _txId,
            address receiver,
            address token,
            uint256 amount
        ) = abi.decode(body, (string, address, address, uint256));

        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance >= amount, "balance insufficient");

        require(!processed[txId], "Already processed");

        // 执行 transfer
        IERC20(token).transfer(receiver, amount);
        emit TokenHandled(_txId, token, receiver, amount, uint8(depositStatus.Success));

        processed[txId] = true;

        // 删除记录
        delete failedMessages[_txId];
    }    
}

// https://explorer.hyperlane.xyz/?origin=basesepolia