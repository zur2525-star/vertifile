/**
 * Deployment script for VertifileRegistry contract.
 *
 * Usage:
 *   POLYGON_PRIVATE_KEY=0x... npx hardhat run contracts/deploy.js --network amoy
 *
 * Or standalone (no Hardhat):
 *   POLYGON_PRIVATE_KEY=0x... POLYGON_NETWORK=amoy node contracts/deploy.js
 */

async function deployWithHardhat() {
  const { ethers } = require('hardhat');
  const Contract = await ethers.getContractFactory('VertifileRegistry');
  console.log('Deploying VertifileRegistry...');
  const contract = await Contract.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\nVertifileRegistry deployed to: ${address}`);
  console.log(`\nSet this in your environment:`);
  console.log(`  export POLYGON_CONTRACT=${address}`);
  return address;
}

async function deployStandalone() {
  const { ethers } = require('ethers');
  const fs = require('fs');
  const path = require('path');

  const privateKey = process.env.POLYGON_PRIVATE_KEY;
  const network = process.env.POLYGON_NETWORK || 'amoy';

  if (!privateKey) {
    console.error('Error: POLYGON_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }

  const NETWORKS = {
    mumbai: { rpc: 'https://rpc-mumbai.maticvigil.com', chainId: 80001, name: 'Mumbai Testnet' },
    amoy: { rpc: 'https://rpc-amoy.polygon.technology', chainId: 80002, name: 'Amoy Testnet' },
    polygon: { rpc: 'https://polygon-rpc.com', chainId: 137, name: 'Polygon Mainnet' }
  };

  const net = NETWORKS[network];
  if (!net) {
    console.error(`Unknown network: ${network}`);
    process.exit(1);
  }

  console.log(`Deploying to ${net.name}...`);

  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId);
  const wallet = new ethers.Wallet(privateKey, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} MATIC`);

  if (balance === 0n) {
    console.error('\nNo MATIC balance! Get testnet MATIC from:');
    console.error('  https://faucet.polygon.technology/');
    process.exit(1);
  }

  // Read compiled contract (compile with solc first)
  const artifactPath = path.join(__dirname, 'VertifileRegistry.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('\nContract not compiled. Run:');
    console.error('  npx solc --abi --bin --optimize contracts/VertifileRegistry.sol -o contracts/');
    console.error('Or use Hardhat: npx hardhat compile');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log('\nDeploying contract...');
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✓ VertifileRegistry deployed to: ${address}`);
  console.log(`\nSet these in your environment:`);
  console.log(`  export POLYGON_CONTRACT=${address}`);
  console.log(`  export POLYGON_NETWORK=${network}`);
  console.log(`  export POLYGON_PRIVATE_KEY=${privateKey.substring(0, 10)}...`);

  // Save deployment info
  const deployInfo = {
    network,
    address,
    deployer: wallet.address,
    timestamp: new Date().toISOString(),
    chainId: net.chainId
  };

  const deployPath = path.join(__dirname, '..', 'data', `deployment-${network}.json`);
  const dir = path.dirname(deployPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log(`\nDeployment info saved to: ${deployPath}`);
}

// Detect if running via Hardhat or standalone
if (typeof require !== 'undefined') {
  try {
    require('hardhat');
    deployWithHardhat().catch(console.error);
  } catch {
    deployStandalone().catch(console.error);
  }
}
