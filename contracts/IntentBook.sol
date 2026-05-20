// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract IntentBook {
    enum Status {
        OPEN,
        PARTIALLY_MATCHED,
        MATCHED,
        CANCELLED,
        EXPIRED
    }

    struct Intent {
        address user;
        string asset;
        string direction;
        uint256 notionalUsd;
        uint256 durationMinutes;
        uint256 maxCostBps;
        string urgency;
        uint256 filledNotionalUsd;
        uint256 createdAt;
        uint256 expiresAt;
        Status status;
    }

    address public operator;
    uint256 public nonce;
    mapping(bytes32 => Intent) public intents;

    event HedgeIntentSubmitted(
        bytes32 indexed intentId,
        address indexed user,
        string asset,
        string direction,
        uint256 notionalUsd,
        uint256 durationMinutes,
        uint256 maxCostBps,
        uint256 createdAt,
        uint256 expiresAt
    );

    event HedgeIntentCancelled(bytes32 indexed intentId, address indexed user);

    event HedgeIntentMatched(
        bytes32 indexed intentId,
        address indexed user,
        uint256 matchedNotionalUsd,
        uint256 filledNotionalUsd,
        Status status
    );

    event HedgeIntentExpired(bytes32 indexed intentId, address indexed user);

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    function setOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "zero operator");
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function submitIntent(
        string memory asset,
        string memory direction,
        uint256 notionalUsd,
        uint256 durationMinutes,
        uint256 maxCostBps,
        string memory urgency
    ) external returns (bytes32 intentId) {
        require(notionalUsd > 0, "zero notional");
        require(durationMinutes > 0, "zero duration");

        uint256 createdAt = block.timestamp;
        uint256 expiresAt = createdAt + durationMinutes * 1 minutes;

        intentId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                address(this),
                nonce++,
                asset,
                direction,
                notionalUsd,
                createdAt
            )
        );

        intents[intentId] = Intent({
            user: msg.sender,
            asset: asset,
            direction: direction,
            notionalUsd: notionalUsd,
            durationMinutes: durationMinutes,
            maxCostBps: maxCostBps,
            urgency: urgency,
            filledNotionalUsd: 0,
            createdAt: createdAt,
            expiresAt: expiresAt,
            status: Status.OPEN
        });

        emit HedgeIntentSubmitted(
            intentId,
            msg.sender,
            asset,
            direction,
            notionalUsd,
            durationMinutes,
            maxCostBps,
            createdAt,
            expiresAt
        );
    }

    function cancelIntent(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        require(intent.user == msg.sender, "not owner");
        require(intent.status == Status.OPEN || intent.status == Status.PARTIALLY_MATCHED, "not cancellable");

        intent.status = Status.CANCELLED;
        emit HedgeIntentCancelled(intentId, msg.sender);
    }

    function markIntentMatched(bytes32 intentId, uint256 matchedNotionalUsd) external onlyOperator {
        Intent storage intent = intents[intentId];
        require(intent.user != address(0), "missing intent");
        require(matchedNotionalUsd > 0, "zero match");
        require(intent.status == Status.OPEN || intent.status == Status.PARTIALLY_MATCHED, "not matchable");
        require(block.timestamp <= intent.expiresAt, "expired");

        uint256 remaining = intent.notionalUsd - intent.filledNotionalUsd;
        require(matchedNotionalUsd <= remaining, "overfill");

        intent.filledNotionalUsd += matchedNotionalUsd;
        intent.status = intent.filledNotionalUsd == intent.notionalUsd
            ? Status.MATCHED
            : Status.PARTIALLY_MATCHED;

        emit HedgeIntentMatched(
            intentId,
            intent.user,
            matchedNotionalUsd,
            intent.filledNotionalUsd,
            intent.status
        );
    }

    function expireIntent(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        require(intent.user != address(0), "missing intent");
        require(block.timestamp > intent.expiresAt, "not expired");
        require(intent.status == Status.OPEN || intent.status == Status.PARTIALLY_MATCHED, "not expirable");

        intent.status = Status.EXPIRED;
        emit HedgeIntentExpired(intentId, intent.user);
    }
}

