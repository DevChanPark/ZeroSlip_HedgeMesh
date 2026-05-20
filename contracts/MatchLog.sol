// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MatchLog {
    address public operator;

    event HedgeMatched(
        bytes32 indexed matchId,
        string asset,
        uint256 matchedNotionalUsd,
        uint256 residualNotionalUsd,
        uint256 estimatedSavingsBps,
        uint256 createdAt
    );

    event AgentDecisionLogged(
        bytes32 indexed decisionId,
        string decisionType,
        uint256 internalMatchUsd,
        uint256 residualUsd,
        uint256 estimatedSavingsBps,
        uint256 createdAt
    );

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

    function logMatch(
        bytes32 matchId,
        string memory asset,
        uint256 matchedNotionalUsd,
        uint256 residualNotionalUsd,
        uint256 estimatedSavingsBps
    ) external onlyOperator {
        emit HedgeMatched(
            matchId,
            asset,
            matchedNotionalUsd,
            residualNotionalUsd,
            estimatedSavingsBps,
            block.timestamp
        );
    }

    function logAgentDecision(
        bytes32 decisionId,
        string memory decisionType,
        uint256 internalMatchUsd,
        uint256 residualUsd,
        uint256 estimatedSavingsBps
    ) external onlyOperator {
        emit AgentDecisionLogged(
            decisionId,
            decisionType,
            internalMatchUsd,
            residualUsd,
            estimatedSavingsBps,
            block.timestamp
        );
    }
}

