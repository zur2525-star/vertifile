/**
 * Vertifile Blockchain Integration
 * Connects to Polygon (Mumbai testnet / Mainnet) for on-chain document registration.
 *
 * Usage:
 *   const chain = require('./blockchain');
 *   await chain.init();                           // Connect to Polygon
 *   await chain.register(hash, signature, org);   // Queue for on-chain registration
 *   const result = await chain.verify(hash, sig); // Verify on-chain
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const logger = require('./services/logger');

// Contract ABI — only the functions we need
const CONTRACT_ABI = [
  "function register(bytes32 docHash, bytes32 sigHash, string orgName) external",
  "function registerBatch(bytes32[] docHashes, bytes32[] sigHashes, string orgName) external",
  "function verify(bytes32 docHash, bytes32 sigHash) external view returns (bool verified, uint40 timestamp, string orgName)",
  "function isRegistered(bytes32 docHash) external view returns (bool)",
  "function totalDocuments() external view returns (uint256)",
  "function getOrgCount() external view returns (uint256)",
  "event DocumentRegistered(bytes32 indexed docHash, uint16 orgIdx, uint40 timestamp)"
];

// Network configs
const NETWORKS = {
  mumbai: {
    name: 'Polygon Mumbai Testnet',
    rpc: 'https://rpc-mumbai.maticvigil.com',
    chainId: 80001,
    explorer: 'https://mumbai.polygonscan.com'
  },
  amoy: {
    name: 'Polygon Amoy Testnet',
    rpc: 'https://rpc-amoy.polygon.technology',
    chainId: 80002,
    explorer: 'https://amoy.polygonscan.com'
  },
  polygon: {
    name: 'Polygon Mainnet',
    rpc: 'https://polygon-rpc.com',
    chainId: 137,
    explorer: 'https://polygonscan.com'
  }
};

// State file for persisting contract address
const STATE_FILE = path.join(__dirname, 'data', 'blockchain-state.json');

let provider = null;
let wallet = null;
let contract = null;
let networkConfig = null;
let initialized = false;

// ================================================================
// BATCH QUEUE
// ================================================================
const BATCH_SIZE = 10;          // Flush when queue reaches this size
const FLUSH_INTERVAL_MS = 60000; // Flush every 60 seconds
let queue = [];                  // { hash, signature, orgName }
let flushTimer = null;
let flushing = false;

/**
 * Convert a hex string (SHA-256 hash) to bytes32 by keccak256 hashing it.
 * This maps our 64-char hex hashes into Solidity bytes32 format.
 */
function toBytes32(hexString) {
  return ethers.keccak256(ethers.toUtf8Bytes(hexString));
}

/**
 * Load persisted state (contract address, network).
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (state.contractAddress && typeof state.contractAddress !== 'string') {
        logger.warn('[BLOCKCHAIN] Invalid state file, resetting');
        return {};
      }
      return state;
    }
  } catch (e) { /* ignore */ }
  return {};
}

/**
 * Save state to disk.
 */
function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Initialize blockchain connection.
 * Requires environment variables:
 *   POLYGON_PRIVATE_KEY — wallet private key
 *   POLYGON_CONTRACT    — deployed contract address
 *   POLYGON_NETWORK     — 'mumbai', 'amoy', or 'polygon' (default: amoy)
 */
async function init() {
  if (initialized) return true;

  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  const contractAddress = process.env.POLYGON_CONTRACT;
  const network = process.env.POLYGON_NETWORK || 'amoy';

  if (!privateKey || !contractAddress) {
    logger.info('[BLOCKCHAIN] Skipped — POLYGON_PRIVATE_KEY and POLYGON_CONTRACT not set');
    return false;
  }

  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
    logger.info('[BLOCKCHAIN] Invalid private key format');
    return false;
  }

  networkConfig = NETWORKS[network];
  if (!networkConfig) {
    logger.error(`[BLOCKCHAIN] Unknown network: ${network}. Use: mumbai, amoy, polygon`);
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(networkConfig.rpc, networkConfig.chainId);
    wallet = new ethers.Wallet(privateKey, provider);
    contract = new ethers.Contract(contractAddress, CONTRACT_ABI, wallet);

    // Verify connection with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC connection timeout')), 10000)
    );
    const totalDocs = await Promise.race([contract.totalDocuments(), timeoutPromise]);
    const balance = await Promise.race([provider.getBalance(wallet.address), timeoutPromise]);

    logger.info(`[BLOCKCHAIN] Connected to ${networkConfig.name}`);
    logger.info(`  Wallet:   ${wallet.address}`);
    logger.info(`  Contract: ${contractAddress}`);
    logger.info(`  Balance:  ${ethers.formatEther(balance)} MATIC`);
    logger.info(`  On-chain: ${totalDocs} documents`);

    // Save state
    saveState({ network, contractAddress, walletAddress: wallet.address });

    initialized = true;

    // Start periodic flush timer
    startFlushTimer();

    return true;
  } catch (error) {
    logger.error('[BLOCKCHAIN] Connection failed:', error.message);
    return false;
  }
}

/**
 * Start the periodic flush timer.
 */
function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (queue.length > 0) {
      flushQueue().catch(e => logger.error('[BLOCKCHAIN] Periodic flush error:', e.message));
    }
  }, FLUSH_INTERVAL_MS);
  // Don't prevent process exit
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Stop the periodic flush timer.
 */
function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Flush the queue — send all pending registrations to the blockchain.
 * Groups items by orgName and uses registerBatch for efficiency.
 * Failed items are logged to audit_log for retry.
 */
async function flushQueue() {
  if (queue.length === 0) return { flushed: 0 };
  if (flushing) return { flushed: 0, skipped: true };
  flushing = true;

  // Drain the queue atomically
  const batch = queue.splice(0);
  logger.info(`[BLOCKCHAIN] Flushing queue: ${batch.length} items`);

  // Group by orgName for batch registration
  const byOrg = {};
  for (const item of batch) {
    const org = item.orgName || 'unknown';
    if (!byOrg[org]) byOrg[org] = [];
    byOrg[org].push(item);
  }

  let totalFlushed = 0;
  let totalFailed = 0;

  for (const [orgName, items] of Object.entries(byOrg)) {
    try {
      if (items.length === 1) {
        // Single item — use individual register
        const item = items[0];
        const docHash = toBytes32(item.hash);
        const sigHash = toBytes32(item.signature);
        const exists = await contract.isRegistered(docHash);
        if (exists) {
          logger.info(`[BLOCKCHAIN] Already registered: ${item.hash.substring(0, 16)}...`);
          totalFlushed++;
          continue;
        }
        const tx = await contract.register(docHash, sigHash, orgName);
        const receipt = await tx.wait();
        logger.info(`[BLOCKCHAIN] Registered: ${item.hash.substring(0, 16)}... tx=${receipt.hash}`);
        totalFlushed++;
      } else {
        // Multiple items — use batch register
        const documents = items.map(i => ({ hash: i.hash, signature: i.signature }));
        const docHashes = documents.map(d => toBytes32(d.hash));
        const sigHashes = documents.map(d => toBytes32(d.signature));
        const tx = await contract.registerBatch(docHashes, sigHashes, orgName);
        const receipt = await tx.wait();
        logger.info(`[BLOCKCHAIN] Batch registered: ${items.length} docs for ${orgName}, tx=${receipt.hash}`);
        totalFlushed += items.length;
      }
    } catch (error) {
      logger.error(`[BLOCKCHAIN] Flush failed for ${orgName} (${items.length} items):`, error.message);
      totalFailed += items.length;
      // Log failed items for retry via audit_log
      for (const item of items) {
        try {
          // Try to access db for logging — use require to avoid circular dep at top level
          const db = require('./db');
          await db.log('blockchain_pending', {
            hash: item.hash,
            signature: item.signature,
            orgName: item.orgName,
            error: error.message,
            queuedAt: item.queuedAt
          });
        } catch (logErr) {
          logger.error('[BLOCKCHAIN] Could not log failed item:', logErr.message);
        }
      }
    }
  }

  flushing = false;
  logger.info(`[BLOCKCHAIN] Flush complete: ${totalFlushed} registered, ${totalFailed} failed`);
  return { flushed: totalFlushed, failed: totalFailed };
}

/**
 * Register a document hash on-chain (queued).
 * Items are batched and sent periodically or when the queue is full.
 * @param {string} hash     — SHA-256 hex hash (64 chars)
 * @param {string} signature — HMAC signature hex (64 chars)
 * @param {string} orgName  — Organization name
 * @returns {object}  { success, queued }
 */
async function register(hash, signature, orgName) {
  if (!initialized) {
    return { success: false, error: 'Blockchain not initialized' };
  }

  queue.push({ hash, signature, orgName, queuedAt: new Date().toISOString() });
  logger.info(`[BLOCKCHAIN] Queued: ${hash.substring(0, 16)}... (queue: ${queue.length}/${BATCH_SIZE})`);

  // Auto-flush if batch size reached
  if (queue.length >= BATCH_SIZE) {
    // Fire and forget — caller doesn't wait for on-chain confirmation
    flushQueue().catch(e => logger.error('[BLOCKCHAIN] Auto-flush error:', e.message));
  }

  return { success: true, queued: true, queueSize: queue.length };
}

/**
 * Register a document hash on-chain immediately (bypasses queue).
 * Use this when you need synchronous on-chain confirmation.
 * @param {string} hash     — SHA-256 hex hash (64 chars)
 * @param {string} signature — HMAC signature hex (64 chars)
 * @param {string} orgName  — Organization name
 * @returns {object}  { success, txHash, blockNumber, gasUsed }
 */
async function registerImmediate(hash, signature, orgName) {
  if (!initialized) {
    return { success: false, error: 'Blockchain not initialized' };
  }

  try {
    const docHash = toBytes32(hash);
    const sigHash = toBytes32(signature);

    // Check if already registered
    const exists = await contract.isRegistered(docHash);
    if (exists) {
      return { success: true, alreadyRegistered: true };
    }

    const tx = await contract.register(docHash, sigHash, orgName);
    const receipt = await tx.wait();

    logger.info(`[BLOCKCHAIN] Registered (immediate): ${hash.substring(0, 16)}... tx=${receipt.hash}`);

    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorer: `${networkConfig.explorer}/tx/${receipt.hash}`
    };
  } catch (error) {
    logger.error('[BLOCKCHAIN] Register failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Batch register multiple documents on-chain (up to 50).
 * @param {Array} documents — [{ hash, signature }]
 * @param {string} orgName
 * @returns {object}  { success, txHash, count }
 */
async function registerBatch(documents, orgName) {
  if (!initialized) {
    return { success: false, error: 'Blockchain not initialized' };
  }

  try {
    const docHashes = documents.map(d => toBytes32(d.hash));
    const sigHashes = documents.map(d => toBytes32(d.signature));

    const tx = await contract.registerBatch(docHashes, sigHashes, orgName);
    const receipt = await tx.wait();

    logger.info(`[BLOCKCHAIN] Batch registered: ${documents.length} docs, tx=${receipt.hash}`);

    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      count: documents.length,
      explorer: `${networkConfig.explorer}/tx/${receipt.hash}`
    };
  } catch (error) {
    logger.error('[BLOCKCHAIN] Batch register failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Verify a document on-chain.
 * @param {string} hash      — SHA-256 hex hash
 * @param {string} signature — HMAC signature hex (optional)
 * @returns {object}  { verified, timestamp, orgName, onChain }
 */
async function verify(hash, signature) {
  if (!initialized) {
    return { onChain: false, reason: 'Blockchain not initialized' };
  }

  try {
    const docHash = toBytes32(hash);
    const sigHash = signature ? toBytes32(signature) : ethers.ZeroHash;

    const [verified, timestamp, orgName] = await contract.verify(docHash, sigHash);

    return {
      onChain: true,
      verified,
      timestamp: Number(timestamp),
      registeredAt: timestamp > 0 ? new Date(Number(timestamp) * 1000).toISOString() : null,
      orgName,
      explorer: `${networkConfig.explorer}/address/${contract.target}`
    };
  } catch (error) {
    logger.error('[BLOCKCHAIN] Verify failed:', error.message);
    return { onChain: false, error: error.message };
  }
}

/**
 * Get blockchain stats.
 */
async function getStats() {
  if (!initialized) {
    return { connected: false };
  }

  try {
    const [totalDocs, orgCount, balance] = await Promise.all([
      contract.totalDocuments(),
      contract.getOrgCount(),
      provider.getBalance(wallet.address)
    ]);

    return {
      connected: true,
      network: networkConfig.name,
      wallet: wallet.address,
      contract: contract.target,
      totalDocuments: Number(totalDocs),
      organizations: Number(orgCount),
      balance: ethers.formatEther(balance) + ' MATIC',
      explorer: networkConfig.explorer,
      queueSize: queue.length
    };
  } catch (error) {
    return { connected: true, error: error.message };
  }
}

/**
 * Check if blockchain is enabled and connected.
 */
function isConnected() {
  return initialized;
}

/**
 * Get current queue size.
 */
function getQueueSize() {
  return queue.length;
}

module.exports = {
  init,
  register,
  registerImmediate,
  registerBatch,
  verify,
  getStats,
  isConnected,
  toBytes32,
  flushQueue,
  getQueueSize,
  stopFlushTimer
};
