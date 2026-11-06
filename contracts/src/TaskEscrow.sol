// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ONE contract for a whole task: client -> agent A (root leg 0) and agent A -> agent B (sub-legs, max 2 hops).
/// The client's HBAR is locked here. After a verified PASS the contract pays A. A then pays each sub-agent B over
/// Hedera x402 (an account-to-account transfer made outside this contract); the backend records the Hedera
/// transaction id with recordPayout(). Anything A does not pay within `payoutGrace` is marked Defaulted on-chain.
///
/// All amounts are TINYBAR (1 HBAR = 1e8), the unit msg.value and address.balance use on Hedera.
/// Never use `1 ether`: on Hedera that is 1e10 HBAR.
contract TaskEscrow {
    enum State { Created, Funded, Submitted, Released, Refunded }
    enum LegStatus { Pending, Paid, Defaulted }

    struct Leg {
        address payable payee; // leg 0: agent A. leg i>0: sub-agent B_i
        uint256 price;         // tinybar. leg 0 = amount the client locks
        bytes32 termsHash;     // hash of the off-chain terms/rationale designed by the Solidity agent
        LegStatus status;
    }

    struct Terms {
        bytes32 agreementId;
        address client;
        address payable agent;
        address operator;      // backend relayer: submits, adds sub-legs, records payouts
        address verifier;      // platform verdict signer
        address designer;      // Solidity agent that designed and deployed this contract
        uint256 price;         // tinybar, root leg
        uint64 deadline;       // unix seconds
        uint16 maxSubBps;      // cap on the sum of sub-leg prices, in basis points of `price`
        uint8 maxSubLegs;
        uint32 payoutGrace;    // seconds A has after release to pay each sub-agent
        bytes32 termsHash;     // root leg terms hash
    }

    bytes32 public immutable agreementId;
    address public immutable client;
    address payable public immutable agent;
    address public immutable operator;
    address public immutable verifier;
    address public immutable designer;
    uint256 public immutable price;
    uint64 public immutable deadline;
    uint16 public immutable maxSubBps;
    uint8 public immutable maxSubLegs;
    uint32 public immutable payoutGrace;

    State public state;
    uint64 public releasedAt;
    bytes32 public deliverableHash;
    uint256 public subTotal;                 // sum of sub-leg prices
    Leg[] private _legs;
    mapping(uint256 => bool) public usedNonce;

    uint8 public constant FAIL = 0;
    uint8 public constant PASS = 1;
    uint8 public constant MAX_SUB_LEGS_HARD = 5;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant VERDICT_TYPEHASH = keccak256("Verdict(bytes32 agreementId,uint8 result,uint256 nonce)");
    bytes32 private constant SUBLEG_TYPEHASH =
        keccak256("SubLeg(bytes32 agreementId,address subAgent,uint256 price,bytes32 termsHash,uint256 nonce)");
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event Funded(bytes32 indexed agreementId, address client, uint256 amount);
    event SubLegAdded(bytes32 indexed agreementId, uint256 legId, address subAgent, uint256 price, bytes32 termsHash);
    event Submitted(bytes32 indexed agreementId, bytes32 deliverableHash);
    event Released(bytes32 indexed agreementId, address agent, uint256 amount);
    event Refunded(bytes32 indexed agreementId, address client, uint256 amount);
    /// @param hederaTxId the x402 settlement transaction id, e.g. "0.0.7162784@1793970887.617954312"
    event PayoutRecorded(bytes32 indexed agreementId, uint256 legId, address payee, uint256 price, string hederaTxId);
    event PayoutDefaulted(bytes32 indexed agreementId, uint256 legId, address debtor, address payee, uint256 price);

    error WrongState();
    error NotAllowed();
    error WrongAmount();
    error NotFunded();
    error BadSignature();
    error NonceUsed();
    error TransferFailed();
    error TooEarly();
    error CapExceeded();
    error TooManyLegs();
    error BadLeg();

    constructor(Terms memory t) {
        agreementId = t.agreementId;
        client = t.client;
        agent = t.agent;
        operator = t.operator;
        verifier = t.verifier;
        designer = t.designer;
        price = t.price;
        deadline = t.deadline;
        maxSubBps = t.maxSubBps;
        maxSubLegs = t.maxSubLegs > MAX_SUB_LEGS_HARD ? MAX_SUB_LEGS_HARD : t.maxSubLegs;
        payoutGrace = t.payoutGrace;
        _legs.push(Leg({payee: t.agent, price: t.price, termsHash: t.termsHash, status: LegStatus.Pending}));
    }

    // ---------------- funding ----------------
    /// @notice Wallet path (MetaMask): the client sends exactly the price.
    function fund() external payable {
        if (msg.sender != client) revert NotAllowed();
        if (state != State.Created) revert WrongState();
        if (msg.value != price) revert WrongAmount();
        state = State.Funded;
        emit Funded(agreementId, client, msg.value);
    }

    /// @notice x402 path: the client paid this contract's Hedera account with a native transfer, which runs no
    /// contract code. Anyone may call this once the balance covers the price; it flips the state and emits Funded.
    function confirmFunding() external {
        if (state != State.Created) revert WrongState();
        if (address(this).balance < price) revert NotFunded();
        state = State.Funded;
        emit Funded(agreementId, client, address(this).balance);
    }

    // ---------------- A -> B legs (max 2 hops: client->A, A->B) ----------------
    /// @notice Add a sub-leg A -> B. Needs the verifier's signed approval of exactly these terms. No B -> C: a sub-agent
    /// cannot subcontract because only the operator adds legs and every leg's debtor is `agent`.
    function addSubLeg(address payable subAgent, uint256 subPrice, bytes32 subTermsHash, uint256 nonce, bytes calldata sig)
        external
        returns (uint256 legId)
    {
        if (msg.sender != operator) revert NotAllowed();
        if (state != State.Funded && state != State.Submitted) revert WrongState();
        if (subAgent == address(0) || subAgent == agent || subPrice == 0) revert BadLeg();
        if (_legs.length - 1 >= maxSubLegs) revert TooManyLegs();
        if ((subTotal + subPrice) * 10_000 > price * maxSubBps) revert CapExceeded();
        if (usedNonce[nonce]) revert NonceUsed();
        bytes32 digest = _digest(keccak256(abi.encode(SUBLEG_TYPEHASH, agreementId, subAgent, subPrice, subTermsHash, nonce)));
        if (_recover(digest, sig) != verifier) revert BadSignature();
        usedNonce[nonce] = true;
        subTotal += subPrice;
        legId = _legs.length;
        _legs.push(Leg({payee: subAgent, price: subPrice, termsHash: subTermsHash, status: LegStatus.Pending}));
        emit SubLegAdded(agreementId, legId, subAgent, subPrice, subTermsHash);
    }

    // ---------------- work ----------------
    function submit(bytes32 _deliverableHash) external {
        if (msg.sender != agent && msg.sender != operator) revert NotAllowed();
        if (state != State.Funded) revert WrongState();
        deliverableHash = _deliverableHash;
        state = State.Submitted;
        emit Submitted(agreementId, _deliverableHash);
    }

    // ---------------- settlement ----------------
    /// @notice PASS verdict for the whole task (A's result including B's part): the contract pays A everything it holds.
    function release(uint256 nonce, bytes calldata sig) external {
        if (state != State.Submitted) revert WrongState();
        _checkVerdict(PASS, nonce, sig);
        state = State.Released;
        releasedAt = uint64(block.timestamp);
        _legs[0].status = LegStatus.Paid;
        uint256 amount = address(this).balance;
        emit Released(agreementId, agent, amount);
        _send(agent, amount);
    }

    /// @notice FAIL verdict: everything goes back to the client. Sub-legs are voided (owed() turns false).
    function refund(uint256 nonce, bytes calldata sig) external {
        if (state != State.Submitted) revert WrongState();
        _checkVerdict(FAIL, nonce, sig);
        _refundClient();
    }

    /// @notice Escape hatch: nothing was submitted before the deadline.
    function refundAfterDeadline() external {
        if (state != State.Funded) revert WrongState();
        if (block.timestamp <= deadline) revert TooEarly();
        _refundClient();
    }

    // ---------------- A pays B over x402 (outside the contract), recorded here ----------------
    /// @notice The backend verified (on the mirror node) that A paid sub-leg `legId` through x402 and records the receipt.
    function recordPayout(uint256 legId, string calldata hederaTxId) external {
        if (msg.sender != operator) revert NotAllowed();
        if (state != State.Released) revert WrongState();
        if (legId == 0 || legId >= _legs.length) revert BadLeg();
        Leg storage l = _legs[legId];
        if (l.status != LegStatus.Pending) revert WrongState();
        l.status = LegStatus.Paid;
        emit PayoutRecorded(agreementId, legId, l.payee, l.price, hederaTxId);
    }

    /// @notice After the grace period A has not paid: mark the debt Defaulted. Anyone may call; feeds A's trust score.
    function markDefault(uint256 legId) external {
        if (state != State.Released) revert WrongState();
        if (legId == 0 || legId >= _legs.length) revert BadLeg();
        Leg storage l = _legs[legId];
        if (l.status != LegStatus.Pending) revert WrongState();
        if (block.timestamp <= uint256(releasedAt) + payoutGrace) revert TooEarly();
        l.status = LegStatus.Defaulted;
        emit PayoutDefaulted(agreementId, legId, agent, l.payee, l.price);
    }

    // ---------------- views ----------------
    function legCount() external view returns (uint256) { return _legs.length; }

    function leg(uint256 legId) external view returns (address payee, uint256 legPrice, bytes32 termsHash, LegStatus status) {
        Leg storage l = _legs[legId];
        return (l.payee, l.price, l.termsHash, l.status);
    }

    /// @notice True when the task was released and A still has to pay this sub-leg.
    function owed(uint256 legId) external view returns (bool) {
        return state == State.Released && legId != 0 && legId < _legs.length && _legs[legId].status == LegStatus.Pending;
    }

    // ---------------- internals ----------------
    function _refundClient() private {
        state = State.Refunded;
        _legs[0].status = LegStatus.Defaulted; // root leg not paid out
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
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("AgentForge"), keccak256("1"), block.chainid, address(this)));
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
