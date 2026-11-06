// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice V2 of JobEscrow: on-chain A2A cap, delegate only while Funded, review-window refund. Holds one job's HBAR. All amounts are in TINYBAR (1 HBAR = 1e8), which is what msg.value is on Hedera.
/// Never use `1 ether` here: on Hedera that is 1e10 HBAR.
contract JobEscrowV2 {
    enum State { Created, Funded, Submitted, Released, Refunded }

    bytes32 public immutable agreementId;
    address public immutable client;
    address payable public immutable agent;     // lister payout address
    address public immutable operator;          // backend relayer (calls submit/delegate on behalf of users)
    address public immutable verifier;          // platform verdict signer
    uint256 public immutable price;             // tinybar
    uint64 public immutable deadline;           // unix seconds
    uint256 public immutable maxDelegatedBps;   // A2A cap as basis points of price (<= 10000)
    uint64 public immutable reviewWindow;       // seconds after submit before anyone may refund the client

    State public state;
    uint256 public delegated;                   // tinybar paid out to sub-agents (A2A)
    bytes32 public deliverableHash;
    uint64 public submittedAt;                  // block.timestamp of submit()
    mapping(uint256 => bool) public usedNonce;

    uint8 public constant FAIL = 0;
    uint8 public constant PASS = 1;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VERDICT_TYPEHASH = keccak256("Verdict(bytes32 agreementId,uint8 result,uint256 nonce)");
    bytes32 private constant DELEGATION_TYPEHASH =
        keccak256("Delegation(bytes32 agreementId,address subAgent,uint256 amount,uint256 nonce)");
    // secp256k1 half order, to reject malleable signatures
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event Funded(bytes32 indexed agreementId, address client, uint256 amount);
    event Submitted(bytes32 indexed agreementId, bytes32 deliverableHash);
    event Released(bytes32 indexed agreementId, address agent, uint256 amount);
    event Refunded(bytes32 indexed agreementId, address client, uint256 amount);
    event Delegated(bytes32 indexed agreementId, address subAgent, uint256 amount);

    error WrongState();
    error NotAllowed();
    error WrongAmount();
    error BadSignature();
    error NonceUsed();
    error TransferFailed();
    error TooEarly();
    error CapExceeded();
    error BadConfig();

    constructor(
        bytes32 _agreementId,
        address _client,
        address payable _agent,
        address _operator,
        address _verifier,
        uint256 _price,
        uint64 _deadline,
        uint256 _maxDelegatedBps,
        uint64 _reviewWindow
    ) {
        if (_maxDelegatedBps > 10_000) revert BadConfig();
        agreementId = _agreementId;
        client = _client;
        agent = _agent;
        operator = _operator;
        verifier = _verifier;
        price = _price;
        deadline = _deadline;
        maxDelegatedBps = _maxDelegatedBps;
        reviewWindow = _reviewWindow;
    }

    // ---------------- money in ----------------
    function fund() external payable {
        if (msg.sender != client) revert NotAllowed();
        if (state != State.Created) revert WrongState();
        if (msg.value != price) revert WrongAmount();
        state = State.Funded;
        emit Funded(agreementId, client, msg.value);
    }

    // ---------------- work ----------------
    /// @notice Agent (or the operator on its behalf) records that the work is done.
    function submit(bytes32 _deliverableHash) external {
        if (msg.sender != agent && msg.sender != operator) revert NotAllowed();
        if (state != State.Funded) revert WrongState();
        deliverableHash = _deliverableHash;
        submittedAt = uint64(block.timestamp);
        state = State.Submitted;
        emit Submitted(agreementId, _deliverableHash);
    }

    // ---------------- A2A ----------------
    /// @notice Pay a sub-agent out of this job's funds. Needs the verifier's signed approval of exactly this payment.
    function delegate(address payable subAgent, uint256 amount, uint256 nonce, bytes calldata sig) external {
        if (msg.sender != operator) revert NotAllowed();
        if (state != State.Funded) revert WrongState();
        if (amount == 0 || amount > address(this).balance) revert WrongAmount();
        if (delegated + amount > (price * maxDelegatedBps) / 10_000) revert CapExceeded();
        if (usedNonce[nonce]) revert NonceUsed();
        bytes32 digest = _digest(keccak256(abi.encode(DELEGATION_TYPEHASH, agreementId, subAgent, amount, nonce)));
        if (_recover(digest, sig) != verifier) revert BadSignature();
        usedNonce[nonce] = true;
        delegated += amount;
        emit Delegated(agreementId, subAgent, amount);
        _send(subAgent, amount);
    }

    // ---------------- settlement ----------------
    /// @notice PASS verdict signed by the verifier: everything left goes to the agent.
    function release(uint256 nonce, bytes calldata sig) external {
        if (state != State.Submitted) revert WrongState();
        _checkVerdict(PASS, nonce, sig);
        state = State.Released;
        uint256 amount = address(this).balance;
        emit Released(agreementId, agent, amount);
        _send(agent, amount);
    }

    /// @notice FAIL verdict signed by the verifier: everything left goes back to the client.
    function refund(uint256 nonce, bytes calldata sig) external {
        if (state != State.Submitted) revert WrongState();
        _checkVerdict(FAIL, nonce, sig);
        _refundClient();
    }

    /// @notice Escape hatch: the agent never submitted before the deadline.
    function refundAfterDeadline() external {
        if (state != State.Funded) revert WrongState();
        if (block.timestamp <= deadline) revert TooEarly();
        _refundClient();
    }

    /// @notice Verifier never answered within reviewWindow after submit: anyone may refund the remainder to the client.
    function refundIfNoVerdict() external {
        if (state != State.Submitted) revert WrongState();
        if (block.timestamp <= uint256(submittedAt) + reviewWindow) revert TooEarly();
        _refundClient();
    }

    // ---------------- internals ----------------
    function _refundClient() private {
        state = State.Refunded;
        uint256 amount = address(this).balance;
        emit Refunded(agreementId, client, amount);
        _send(payable(client), amount);
    }

    function _checkVerdict(uint8 result, uint256 nonce, bytes calldata sig) private {
        if (usedNonce[nonce]) revert NonceUsed();
        bytes32 digest = _digest(keccak256(abi.encode(VERDICT_TYPEHASH, agreementId, result, nonce)));
        if (_recover(digest, sig) != verifier) revert BadSignature();
        usedNonce[nonce] = true;
    }

    function _send(address payable to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("AgentForge"), keccak256("1"), block.chainid, address(this))
        );
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
