// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IRelayEscrow} from "../interfaces/IRelayEscrow.sol";

/// @title EscrowActor (test only)
/// @notice A badge-holding contract that takes part in deals and controls how it receives MSTC: accept,
/// refuse, burn more gas than the payout stipend, or try to re-enter the escrow.
contract EscrowActor {
    enum Mode {
        Accept,
        Refuse,
        BurnGas,
        Reenter
    }

    IRelayEscrow public immutable ESCROW;
    Mode public mode;
    bytes public reentryCall;
    uint256[8] private _sink;

    /// @notice Result of a re-entry attempt made from `receive`.
    event ReentryAttempt(bool success, bytes4 errorSelector);

    error Refused();

    constructor(IRelayEscrow escrow) {
        ESCROW = escrow;
    }

    function setMode(Mode mode_, bytes calldata reentryCall_) external {
        mode = mode_;
        reentryCall = reentryCall_;
    }

    function createListing(
        uint8 category,
        uint256 price,
        bytes32 termsHash
    ) external payable returns (uint256) {
        IRelayEscrow.ListingAuthorization memory noAuth;
        return
            ESCROW.createListing{value: msg.value}(
                category,
                price,
                0,
                termsHash,
                bytes32(0),
                noAuth
            );
    }

    function acceptListing(uint256 id) external payable {
        ESCROW.acceptListing{value: msg.value}(id);
    }

    function markDelivered(uint256 id, bytes32 proofHash) external {
        ESCROW.markDelivered(id, proofHash);
    }

    function confirmReceipt(uint256 id) external {
        ESCROW.confirmReceipt(id);
    }

    function raiseDispute(uint256 id, bytes32 evidenceHash) external {
        ESCROW.raiseDispute(id, evidenceHash);
    }

    function cancelListing(uint256 id) external {
        ESCROW.cancelListing(id);
    }

    function withdraw() external {
        ESCROW.withdraw();
    }

    // The receive hook is deliberately complex: it is the behaviour under test.
    // solhint-disable-next-line no-complex-fallback
    receive() external payable {
        Mode current = mode;
        if (current == Mode.Refuse) revert Refused();
        if (current == Mode.BurnGas) {
            // Eight storage writes cost far more than the 30 000 gas payout stipend.
            for (uint256 i; i < _sink.length; ++i) _sink[i] = block.timestamp + i + 1;
        } else if (current == Mode.Reenter) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = address(ESCROW).call(reentryCall);
            emit ReentryAttempt(success, result.length >= 4 ? bytes4(result) : bytes4(0));
        }
    }
}
