// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  CredentialRegistry
 * @notice CYB433 Group 1 - Academic Credentials Registry.
 *         Issues and verifies university degrees without storing personal data on-chain.
 *
 * Domain security challenge and how it is solved:
 *  1. Who is trusted to issue?   Only ISSUER_ROLE (Registrar), granted by the Admin (University Council).
 *  2. No single-person fraud:    a credential starts Pending and must be approved by a DIFFERENT
 *                                account holding APPROVER_ROLE (Dean) -> Separation of Duties.
 *  3. Withdrawal:                the Approver can revoke an Active credential; the reason is stored
 *                                as a hash. Revocation still works while the contract is paused.
 *  4. Privacy:                   only credentialHash = keccak256(name, studentId, degree, year, salt)
 *                                is stored. The salt is given to the graduate only, so the hash
 *                                cannot be brute-forced. The certificate PDF lives on IPFS; only
 *                                a digest of its CID is stored.
 *
 * Lifecycle:  None -> Pending -> Active -> Revoked
 *                       Pending -> Rejected
 *                       Active  -> (expired when block.timestamp > validUntil, if validUntil != 0)
 */
contract CredentialRegistry is AccessControl, Pausable {
    // =====================================================================
    // PART A - Data model & access control            (Owner: Ammar)
    // =====================================================================

    /// @dev DEFAULT_ADMIN_ROLE (from AccessControl) = University Council.
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");     // Registrar
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE"); // Dean / accreditation committee

    /// @dev None must be 0 so an unset mapping entry means "does not exist".
    enum Status { None, Pending, Active, Revoked, Rejected }

    /// @dev Packed: issuer (20) + issuedAt (5) + validUntil (5) + status (1) = 31 bytes -> 1 slot.
    ///      Whole struct = 3 slots (v1 used 6). The approver/revoker address is NOT stored:
    ///      it is recorded permanently in the indexed CredentialApproved / Rejected / Revoked
    ///      events, which is cheaper and still fully auditable on-chain.
    struct Credential {
        address issuer;          // slot 0
        uint40 issuedAt;         // slot 0
        uint40 validUntil;       // slot 0  (0 = never expires)
        Status status;           // slot 0
        bytes32 documentDigest;  // slot 1  (digest of the IPFS CID of the certificate PDF)
        bytes32 reasonHash;      // slot 2  (hash of the rejection / revocation reason)
    }

    /// @dev Key = salted credential hash. No personal data on-chain.
    mapping(bytes32 => Credential) private _credentials;

    uint256 public totalIssued;

    event CredentialIssued(bytes32 indexed credentialHash, address indexed issuer, bytes32 documentDigest, uint40 validUntil);
    event CredentialApproved(bytes32 indexed credentialHash, address indexed approver);
    event CredentialRejected(bytes32 indexed credentialHash, address indexed approver, bytes32 reasonHash);
    event CredentialRevoked(bytes32 indexed credentialHash, address indexed revoker, bytes32 reasonHash);

    error ZeroAddress();
    error InvalidHash();
    error AlreadyExists(bytes32 credentialHash);
    error NotFound(bytes32 credentialHash);
    error InvalidStatus(bytes32 credentialHash, Status current, Status expected);
    error InvalidExpiry(uint40 validUntil);
    error SelfApproval();
    error Unauthorized(address caller, bytes32 role);

    modifier onlyIssuer() {
        if (!hasRole(ISSUER_ROLE, msg.sender)) revert Unauthorized(msg.sender, ISSUER_ROLE);
        _;
    }

    modifier onlyApprover() {
        if (!hasRole(APPROVER_ROLE, msg.sender)) revert Unauthorized(msg.sender, APPROVER_ROLE);
        _;
    }

    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized(msg.sender, DEFAULT_ADMIN_ROLE);
        _;
    }

    /// @dev Existence + state-transition guard. Reads the status slot once.
    modifier inStatus(bytes32 credentialHash, Status expected) {
        _checkStatus(credentialHash, expected);
        _;
    }

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Emergency stop, e.g. if an Issuer key is stolen. Admin then calls revokeRole.
    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    function _checkStatus(bytes32 credentialHash, Status expected) private view {
        Status current = _credentials[credentialHash].status;
        if (current != expected) {
            if (current < Status.Pending) revert NotFound(credentialHash); // i.e. Status.None
            revert InvalidStatus(credentialHash, current, expected);
        }
    }

    // =====================================================================
    // PART B - Business logic                          (Owner: Essam)
    // =====================================================================

    /// @notice Registrar creates a credential. It is NOT valid until a different Approver approves it.
    /// @param validUntil 0 = no expiry, otherwise a future unix timestamp.
    function issueCredential(bytes32 credentialHash, bytes32 documentDigest, uint40 validUntil)
        external
        onlyIssuer
        whenNotPaused
    {
        if (credentialHash == bytes32(0) || documentDigest == bytes32(0)) revert InvalidHash();
        Credential storage c = _credentials[credentialHash];
        if (c.status != Status.None) revert AlreadyExists(credentialHash);
        // slither-disable-next-line timestamp
        if (validUntil != 0 && validUntil <= block.timestamp) revert InvalidExpiry(validUntil);

        // Write only non-zero fields: slot 0 in one SSTORE, slot 1 in another.
        c.issuer = msg.sender;
        c.issuedAt = uint40(block.timestamp);
        c.validUntil = validUntil;
        c.status = Status.Pending;
        c.documentDigest = documentDigest;
        unchecked { ++totalIssued; } // cannot overflow in practice

        emit CredentialIssued(credentialHash, msg.sender, documentDigest, validUntil);
    }

    /// @notice Dean activates a Pending credential. Must not be the account that issued it.
    function approveCredential(bytes32 credentialHash)
        external
        onlyApprover
        whenNotPaused
        inStatus(credentialHash, Status.Pending)
    {
        Credential storage c = _credentials[credentialHash];
        if (c.issuer == msg.sender) revert SelfApproval();
        c.status = Status.Active;
        emit CredentialApproved(credentialHash, msg.sender);
    }

    /// @notice Dean rejects a suspicious Pending credential. Final state.
    function rejectCredential(bytes32 credentialHash, bytes32 reasonHash)
        external
        onlyApprover
        whenNotPaused
        inStatus(credentialHash, Status.Pending)
    {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        Credential storage c = _credentials[credentialHash];
        c.status = Status.Rejected;
        c.reasonHash = reasonHash;
        emit CredentialRejected(credentialHash, msg.sender, reasonHash);
    }

    /// @notice Withdraw an Active credential (fraud, administrative error). Final state.
    /// @dev Intentionally NOT whenNotPaused: revocation must work during an incident.
    function revokeCredential(bytes32 credentialHash, bytes32 reasonHash)
        external
        onlyApprover
        inStatus(credentialHash, Status.Active)
    {
        if (reasonHash == bytes32(0)) revert InvalidHash();
        Credential storage c = _credentials[credentialHash];
        c.status = Status.Revoked;
        c.reasonHash = reasonHash;
        emit CredentialRevoked(credentialHash, msg.sender, reasonHash);
    }

    /// @notice Anyone verifies for free. The verifier recomputes the hash from the data + salt
    ///         the graduate shared with them.
    /// @return valid true only if Active and not expired.
    function verifyCredential(bytes32 credentialHash)
        external
        view
        returns (bool valid, Status status, address issuer, uint40 issuedAt, uint40 validUntil)
    {
        Credential storage c = _credentials[credentialHash]; // slot 0 read once
        status = c.status;
        issuer = c.issuer;
        issuedAt = c.issuedAt;
        validUntil = c.validUntil;
        // slither-disable-next-line timestamp
        valid = _isActive(status) && (validUntil == 0 || block.timestamp <= validUntil);
    }

    function getCredential(bytes32 credentialHash) external view returns (Credential memory) {
        return _credentials[credentialHash];
    }

    function _isActive(Status s) private pure returns (bool) {
        return s == Status.Active;
    }
}
