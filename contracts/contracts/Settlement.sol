// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Settlement Contract
 * @dev Escrow contract cho atomic settlement của FX trades
 *
 * - Off-chain EIP-712 signed quotes (maker + taker)
 * - Escrow funding supporting fee-on-transfer tokens (balance delta)
 * - Prevent quote replay
 * - Prevent over-funding & already-funded checks
 * - Single-settle reverts on insufficient escrow (so caller knows)
 * - Batch-settle skips insufficient trades and emits SettleSkipped
 * - CEI pattern, SafeERC20, nonReentrant, Ownable emergency
 *
 * NOTE: This contract intentionally chooses safety over fancy netting behavior.
 */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Settlement is EIP712, ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // -----------------------
    // Custom Errors (gas saving)
    // -----------------------
    error InvalidParticipants();
    error TokenAddressZero();
    error TokenMustBeDifferent();
    error InvalidAmounts();
    error InvalidSettlementTime();
    error InvalidSignatures();
    error QuoteAlreadyUsed();
    error InvalidState();
    error Unauthorized();
    error FundingWindowPassed();
    error NoTokensReceived();
    error AlreadyFundedFully();
    error InsufficientEscrow();
    error TradeExpired();
    error NotExpired();

    // -----------------------
    // Events
    // -----------------------
    event TradeCreated(
        uint256 indexed tradeId,
        address indexed taker,
        address indexed maker,
        bytes32 quoteId,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 settlementTime
    );
    event TradeFunded(uint256 indexed tradeId, address indexed funder, address token, uint256 amount, uint256 totalBalance);
    event TradeSettled(uint256 indexed tradeId, address indexed settledBy, uint256 paidFrom, uint256 paidTo);
    event TradeCancelled(uint256 indexed tradeId, address indexed by);
    event TradeRefunded(uint256 indexed tradeId, address indexed to, address token, uint256 amount);
    event SettleSkipped(uint256 indexed tradeId, string reason);

    // -----------------------
    // Types & Storage
    // -----------------------
    enum State { Created, FundedByTaker, FundedByMaker, FundedBoth, Settled, Cancelled, Expired }

    struct Trade {
        // pack uint256 first
        uint256 fromAmount;
        uint256 toAmount;
        uint256 settlementTime;
        // then addresses
        address taker;
        address maker;
        address fromToken;
        address toToken;
        // small members
        bytes32 quoteId;
        State state;
    }

    // trades
    mapping(uint256 => Trade) public trades;
    // escrow balances: tradeId => token => balance
    mapping(uint256 => mapping(address => uint256)) public escrowBalances;
    // prevent replay
    mapping(bytes32 => bool) public quoteUsed;

    uint256 public tradeCounter;
    uint256 public constant DEFAULT_GRACE_PERIOD = 3600; // 1 hour
    uint256 public gracePeriod = DEFAULT_GRACE_PERIOD;

    // EIP-712 typehash
    bytes32 private constant TRADE_TYPEHASH = keccak256(
        "Trade(address taker,address maker,address fromToken,address toToken,uint256 fromAmount,uint256 toAmount,uint256 settlementTime,bytes32 quoteId)"
    );

    constructor(string memory name, string memory version, address initialOwner) EIP712(name, version) Ownable(initialOwner) {
        tradeCounter = 1;
    }

    // -----------------------
    // Helpers / Views
    // -----------------------

    function _hashTrade(
        address taker,
        address maker,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 settlementTime,
        bytes32 quoteId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            TRADE_TYPEHASH,
            taker,
            maker,
            fromToken,
            toToken,
            fromAmount,
            toAmount,
            settlementTime,
            quoteId
        ));
    }

    function verifySignatures(
        address taker,
        address maker,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 settlementTime,
        bytes32 quoteId,
        bytes calldata takerSig,
        bytes calldata makerSig
    ) public view returns (bool) {
        bytes32 structHash = _hashTrade(taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId);
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredTaker = ECDSA.recover(digest, takerSig);
        address recoveredMaker = ECDSA.recover(digest, makerSig);
        return (recoveredTaker == taker && recoveredMaker == maker);
    }

    function isExpired(Trade memory t) public view returns (bool) {
        return block.timestamp > (t.settlementTime + gracePeriod);
    }

    function remainingToFund(uint256 tradeId) public view returns (uint256 takerRemaining, uint256 makerRemaining) {
        Trade storage t = trades[tradeId];
        uint256 takerBal = escrowBalances[tradeId][t.fromToken];
        uint256 makerBal = escrowBalances[tradeId][t.toToken];
        takerRemaining = takerBal >= t.fromAmount ? 0 : (t.fromAmount - takerBal);
        makerRemaining = makerBal >= t.toAmount ? 0 : (t.toAmount - makerBal);
    }

    // -----------------------
    // Admin
    // -----------------------
    function setGracePeriod(uint256 _seconds) external onlyOwner {
        gracePeriod = _seconds;
    }

    // -----------------------
    // Core: createTrade
    // -----------------------
    function createTrade(
        address taker,
        address maker,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 settlementTime,
        bytes32 quoteId,
        bytes calldata takerSig,
        bytes calldata makerSig
    ) external returns (uint256) {
        if (taker == address(0) || maker == address(0)) revert InvalidParticipants();
        if (fromToken == address(0) || toToken == address(0)) revert TokenAddressZero();
        if (fromToken == toToken) revert TokenMustBeDifferent();
        if (fromAmount == 0 || toAmount == 0) revert InvalidAmounts();
        if (settlementTime <= block.timestamp) revert InvalidSettlementTime();

        if (!verifySignatures(taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId, takerSig, makerSig)) {
            revert InvalidSignatures();
        }

        bytes32 tradeHash = _hashTrade(taker, maker, fromToken, toToken, fromAmount, toAmount, settlementTime, quoteId);
        if (quoteUsed[tradeHash]) revert QuoteAlreadyUsed();
        quoteUsed[tradeHash] = true;

        uint256 tradeId = tradeCounter++;
        trades[tradeId] = Trade({
            taker: taker,
            maker: maker,
            fromToken: fromToken,
            toToken: toToken,
            fromAmount: fromAmount,
            toAmount: toAmount,
            settlementTime: settlementTime,
            quoteId: quoteId,
            state: State.Created
        });

        emit TradeCreated(tradeId, taker, maker, quoteId, fromToken, toToken, fromAmount, toAmount, settlementTime);
        return tradeId;
    }

    // -----------------------
    // Funding (single function)
    // -----------------------
    /**
     * @notice fundTrade: both taker and maker use this function.
     * @param tradeId - trade id
     * @param amountToFund - amount caller wants to transfer (may include fee)
     */
    function fundTrade(uint256 tradeId, uint256 amountToFund) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.taker == address(0) && t.maker == address(0)) revert InvalidState(); // non-existent
        bool isTaker = msg.sender == t.taker;
        bool isMaker = msg.sender == t.maker;
        if (!isTaker && !isMaker) revert Unauthorized();
        if (t.state == State.Settled || t.state == State.Cancelled || t.state == State.Expired) revert InvalidState();
        if (block.timestamp >= t.settlementTime + gracePeriod) revert FundingWindowPassed();

        address tokenToFund = isTaker ? t.fromToken : t.toToken;
        uint256 requiredAmount = isTaker ? t.fromAmount : t.toAmount;

        // prevent funding after fully funded
        uint256 currentBalance = escrowBalances[tradeId][tokenToFund];
        if (currentBalance >= requiredAmount) revert AlreadyFundedFully();

        // Do transfer and compute received (balance delta)
        IERC20 token = IERC20(tokenToFund);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amountToFund);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert NoTokensReceived();

        // Do not allow caller to over-supply more than needed (optional policy).
        // We'll accept extra but cap contribution to requiredAmount - currentBalance and refund the extra immediately.
        uint256 remaining = requiredAmount - currentBalance;
        uint256 credit = received;
        uint256 excess = 0;
        if (credit > remaining) {
            excess = credit - remaining;
            credit = remaining;
        }

        // credit the escrow with the needed amount
        escrowBalances[tradeId][tokenToFund] = currentBalance + credit;

        // if there's excess, refund immediately to sender (best-effort)
        if (excess > 0) {
            // attempt refund; if refund fails (shouldn't with standard ERC20), continue (no revert)
            // use safeTransfer which will revert on failure
            IERC20(tokenToFund).safeTransfer(msg.sender, excess);
        }

        // Update state
        uint256 takerBal = escrowBalances[tradeId][t.fromToken];
        uint256 makerBal = escrowBalances[tradeId][t.toToken];
        bool takerOk = takerBal >= t.fromAmount;
        bool makerOk = makerBal >= t.toAmount;
        if (takerOk && makerOk) {
            t.state = State.FundedBoth;
        } else if (takerOk) {
            t.state = State.FundedByTaker;
        } else if (makerOk) {
            t.state = State.FundedByMaker;
        }

        emit TradeFunded(tradeId, msg.sender, tokenToFund, credit, escrowBalances[tradeId][tokenToFund]);
    }

    // -----------------------
    // Settlement
    // -----------------------
    /**
     * @notice Single settle: revert on problems so caller knows
     */
    function settle(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state != State.FundedBoth) revert InvalidState();
        if (isExpired(t)) revert TradeExpired();
        if (block.timestamp < t.settlementTime) revert InvalidSettlementTime();

        uint256 balFrom = escrowBalances[tradeId][t.fromToken];
        uint256 balTo = escrowBalances[tradeId][t.toToken];

        if (balFrom < t.fromAmount || balTo < t.toAmount) revert InsufficientEscrow();

        _executeSettlement(tradeId, t, balFrom, balTo);
    }

    /**
     * @notice Batch settle: skip problematic trades (emit SettleSkipped)
     */
    function batchSettle(uint256[] calldata tradeIds) external nonReentrant {
        for (uint i = 0; i < tradeIds.length; ++i) {
            uint256 tid = tradeIds[i];
            Trade storage t = trades[tid];

            if (t.state != State.FundedBoth) {
                emit SettleSkipped(tid, "NotFundedBoth");
                continue;
            }
            if (isExpired(t)) {
                emit SettleSkipped(tid, "Expired");
                continue;
            }
            if (block.timestamp < t.settlementTime) {
                emit SettleSkipped(tid, "NotReachedTime");
                continue;
            }

            uint256 balFrom = escrowBalances[tid][t.fromToken];
            uint256 balTo = escrowBalances[tid][t.toToken];

            if (balFrom < t.fromAmount || balTo < t.toAmount) {
                emit SettleSkipped(tid, "InsufficientEscrow");
                continue;
            }

            _executeSettlement(tid, t, balFrom, balTo);
        }
    }

    function _executeSettlement(uint256 tradeId, Trade storage t, uint256 balFrom, uint256 balTo) private {
        // CEI pattern: set state and zero balances before external calls
        t.state = State.Settled;
        escrowBalances[tradeId][t.fromToken] = 0;
        escrowBalances[tradeId][t.toToken] = 0;

        // Transfer full escrow balances to counterparties
        // Maker receives tokens that taker put in (fromToken)
        IERC20(t.fromToken).safeTransfer(t.maker, balFrom);
        // Taker receives tokens that maker put in (toToken)
        IERC20(t.toToken).safeTransfer(t.taker, balTo);

        emit TradeSettled(tradeId, msg.sender, balFrom, balTo);
    }

    // -----------------------
    // Cancel / Refund / Emergency
    // -----------------------
    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state == State.Settled || t.state == State.Cancelled) revert InvalidState();
        if (msg.sender != t.taker && msg.sender != t.maker && msg.sender != owner()) revert Unauthorized();

        // Prevent user cancelling if fully funded (admin must handle emergency)
        if (t.state == State.FundedBoth) revert InvalidState();

        t.state = State.Cancelled;
        emit TradeCancelled(tradeId, msg.sender);

        _refundAllEscrow(tradeId);
    }

    function refundIfExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state == State.Settled || t.state == State.Cancelled) revert InvalidState();
        if (!isExpired(t)) revert NotExpired();

        t.state = State.Expired;
        _refundAllEscrow(tradeId);
    }

    function emergencyCancel(uint256 tradeId) external onlyOwner nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state == State.Settled || t.state == State.Cancelled) revert InvalidState();

        t.state = State.Cancelled;
        emit TradeCancelled(tradeId, msg.sender);
        _refundAllEscrow(tradeId);
    }

    function _refundAllEscrow(uint256 tradeId) internal {
        Trade storage t = trades[tradeId];

        uint256 balFrom = escrowBalances[tradeId][t.fromToken];
        if (balFrom > 0) {
            escrowBalances[tradeId][t.fromToken] = 0;
            IERC20(t.fromToken).safeTransfer(t.taker, balFrom);
            emit TradeRefunded(tradeId, t.taker, t.fromToken, balFrom);
        }

        uint256 balTo = escrowBalances[tradeId][t.toToken];
        if (balTo > 0) {
            escrowBalances[tradeId][t.toToken] = 0;
            IERC20(t.toToken).safeTransfer(t.maker, balTo);
            emit TradeRefunded(tradeId, t.maker, t.toToken, balTo);
        }
    }

    // -----------------------
    // View helper: getTrade
    // -----------------------
    function getTrade(uint256 tradeId) external view returns (
        address taker,
        address maker,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 toAmount,
        uint256 settlementTime,
        bytes32 quoteId,
        State state,
        uint256 takerBalance,
        uint256 makerBalance
    ) {
        Trade storage t = trades[tradeId];
        taker = t.taker;
        maker = t.maker;
        fromToken = t.fromToken;
        toToken = t.toToken;
        fromAmount = t.fromAmount;
        toAmount = t.toAmount;
        settlementTime = t.settlementTime;
        quoteId = t.quoteId;
        state = t.state;
        takerBalance = escrowBalances[tradeId][t.fromToken];
        makerBalance = escrowBalances[tradeId][t.toToken];
    }
}
