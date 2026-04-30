// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-monorepo/main/solidity/contracts/interfaces/IMailbox.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Sender {

    // https://docs.hyperlane.xyz/docs/reference/addresses/deployments/mailbox
    // arb sepolia  = 0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8
    // base sepolia = 0x6966b0E55883d49BFB24539356a2f8A673E02039
    // eth sepoloa = 0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766
    // Op (optimism) sepolia = 	0x6966b0E55883d49BFB24539356a2f8A673E02039
    IMailbox public mailbox; 
    bool public initialized;

    constructor() {
    }

    modifier initializer() {
        require(!initialized, "Contract is already initialized");
        _;
        initialized = true;
    }

    function initialize(address _mailbox) external initializer {
        mailbox = IMailbox(_mailbox);
    }

 
    function sendMessage(
        uint32 destinationDomain, // hyperlane receive domain id
        address hyperlaneReceiver, // hyperlane receiver address
        string memory txId,
        address receiver,
        address token,
        uint256 amount
    ) external payable returns (bytes32) {

        bytes memory body = abi.encode(
            txId,
            receiver,
            token,
            amount
        );

        bytes32 messageId =  mailbox.dispatch{value: msg.value}(
            destinationDomain,
            bytes32(uint256(uint160(hyperlaneReceiver))),
            body
        );

        return messageId;
    }
}