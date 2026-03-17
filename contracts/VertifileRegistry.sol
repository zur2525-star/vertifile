// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VertifileRegistry
 * @notice On-chain document hash registry for Vertifile.
 *         Stores SHA-256 hashes + HMAC signatures on Polygon.
 *         Once registered, a hash can never be removed — immutable proof.
 */
contract VertifileRegistry {
    address public owner;

    struct Record {
        bytes32 sigHash;      // keccak256 of HMAC signature (not raw sig — privacy)
        uint40  timestamp;    // block.timestamp when registered
        uint16  orgIndex;     // index into orgs array (saves gas vs storing string)
        bool    exists;
    }

    // docHash (SHA-256 hex → keccak256) => Record
    mapping(bytes32 => Record) public records;

    // Authorized registrars (server wallets)
    mapping(address => bool) public registrars;

    // Organization list (index-based to save storage)
    string[] public orgs;
    mapping(string => uint16) public orgIndex;

    uint256 public totalDocuments;

    // Events
    event DocumentRegistered(bytes32 indexed docHash, uint16 orgIdx, uint40 timestamp);
    event RegistrarUpdated(address indexed registrar, bool authorized);
    event OrgAdded(uint16 indexed index, string name);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegistrar() {
        require(registrars[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
        registrars[msg.sender] = true;
    }

    /**
     * @notice Register a document hash on-chain.
     * @param docHash  keccak256 of the SHA-256 hex string
     * @param sigHash  keccak256 of the HMAC signature hex string
     * @param orgName  Organization name (auto-indexed)
     */
    function register(bytes32 docHash, bytes32 sigHash, string calldata orgName) external onlyRegistrar {
        require(!records[docHash].exists, "Already registered");

        // Auto-register org if new
        uint16 oi = orgIndex[orgName];
        if (oi == 0 && (orgs.length == 0 || keccak256(bytes(orgs[0])) != keccak256(bytes(orgName)))) {
            orgs.push(orgName);
            oi = uint16(orgs.length - 1);
            orgIndex[orgName] = oi;
            emit OrgAdded(oi, orgName);
        }

        records[docHash] = Record({
            sigHash: sigHash,
            timestamp: uint40(block.timestamp),
            orgIndex: oi,
            exists: true
        });

        totalDocuments++;
        emit DocumentRegistered(docHash, oi, uint40(block.timestamp));
    }

    /**
     * @notice Batch register multiple documents (saves gas).
     * @param docHashes  Array of document hash keccak256s
     * @param sigHashes  Array of signature hash keccak256s
     * @param orgName    Organization (same for entire batch)
     */
    function registerBatch(
        bytes32[] calldata docHashes,
        bytes32[] calldata sigHashes,
        string calldata orgName
    ) external onlyRegistrar {
        require(docHashes.length == sigHashes.length, "Length mismatch");
        require(docHashes.length <= 50, "Max 50 per batch");

        uint16 oi = orgIndex[orgName];
        if (oi == 0 && (orgs.length == 0 || keccak256(bytes(orgs[0])) != keccak256(bytes(orgName)))) {
            orgs.push(orgName);
            oi = uint16(orgs.length - 1);
            orgIndex[orgName] = oi;
            emit OrgAdded(oi, orgName);
        }

        uint40 ts = uint40(block.timestamp);
        for (uint256 i = 0; i < docHashes.length; i++) {
            if (!records[docHashes[i]].exists) {
                records[docHashes[i]] = Record({
                    sigHash: sigHashes[i],
                    timestamp: ts,
                    orgIndex: oi,
                    exists: true
                });
                totalDocuments++;
                emit DocumentRegistered(docHashes[i], oi, ts);
            }
        }
    }

    /**
     * @notice Verify a document exists on-chain and optionally check signature.
     * @param docHash  keccak256 of the SHA-256 hex string
     * @param sigHash  keccak256 of the HMAC signature (pass 0x0 to skip sig check)
     * @return verified  Whether the document is registered and signature matches
     * @return timestamp When it was registered (0 if not found)
     * @return orgName  Organization that registered it
     */
    function verify(bytes32 docHash, bytes32 sigHash) external view returns (
        bool verified,
        uint40 timestamp,
        string memory orgName
    ) {
        Record memory r = records[docHash];
        if (!r.exists) {
            return (false, 0, "");
        }

        // If sigHash provided, check it matches
        if (sigHash != bytes32(0) && r.sigHash != sigHash) {
            return (false, r.timestamp, orgs[r.orgIndex]);
        }

        return (true, r.timestamp, orgs[r.orgIndex]);
    }

    /**
     * @notice Check if a document hash is registered (simple boolean).
     */
    function isRegistered(bytes32 docHash) external view returns (bool) {
        return records[docHash].exists;
    }

    // ===== Admin functions =====

    function setRegistrar(address registrar, bool authorized) external onlyOwner {
        registrars[registrar] = authorized;
        emit RegistrarUpdated(registrar, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    function getOrgCount() external view returns (uint256) {
        return orgs.length;
    }
}
