#!/bin/bash
# ============================================================
# Vertifile — Setup & Deployment Script
# ============================================================

set -e

PURPLE='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${PURPLE}"
echo "╔══════════════════════════════════════════════╗"
echo "║         Vertifile — Setup Script             ║"
echo "║     Document Protection Platform v4.0        ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ---- Step 1: Install Server Dependencies ----
echo -e "${YELLOW}[1/6] Installing server dependencies...${NC}"
npm install
echo -e "${GREEN}  ✓ Server dependencies installed${NC}"

# ---- Step 2: Install Viewer Dependencies ----
echo -e "${YELLOW}[2/6] Installing Electron viewer dependencies...${NC}"
cd viewer && npm install && cd ..
echo -e "${GREEN}  ✓ Viewer dependencies installed${NC}"

# ---- Step 3: Create data directory ----
echo -e "${YELLOW}[3/6] Setting up data directory...${NC}"
mkdir -p data
echo -e "${GREEN}  ✓ Data directory ready${NC}"

# ---- Step 4: Test server ----
echo -e "${YELLOW}[4/6] Testing server startup...${NC}"
node -e "
  require('./db');
  console.log('  Database OK');
  require('./blockchain');
  console.log('  Blockchain module OK');
  require('./obfuscate');
  console.log('  Obfuscation module OK');
"
echo -e "${GREEN}  ✓ All modules loaded successfully${NC}"

# ---- Step 5: Show configuration ----
echo -e "${YELLOW}[5/6] Configuration${NC}"
echo ""
echo "  Copy .env.example to .env and configure:"
echo "    cp .env.example .env"
echo ""
echo "  Required:"
echo "    ADMIN_SECRET     — Secret for admin dashboard"
echo ""
echo "  Optional (Blockchain):"
echo "    POLYGON_PRIVATE_KEY  — Wallet private key"
echo "    POLYGON_CONTRACT     — Deployed contract address"
echo "    POLYGON_NETWORK      — amoy | mumbai | polygon"
echo ""

# ---- Step 6: Summary ----
echo -e "${YELLOW}[6/6] Ready!${NC}"
echo ""
echo -e "  ${GREEN}Start server:${NC}        npm start"
echo -e "  ${GREEN}Start dev:${NC}           npm run dev"
echo -e "  ${GREEN}Build viewer:${NC}        cd viewer && npm run build"
echo -e "  ${GREEN}Build Windows:${NC}       cd viewer && npm run build:win"
echo -e "  ${GREEN}Dashboard:${NC}           http://localhost:3002/dashboard"
echo -e "  ${GREEN}API Docs:${NC}            http://localhost:3002/api/docs"
echo ""

# ---- Blockchain Deployment ----
echo -e "${PURPLE}── Blockchain Deployment ──${NC}"
echo ""
echo "  1. Get testnet MATIC from https://faucet.polygon.technology/"
echo "  2. Deploy contract:"
echo "     POLYGON_PRIVATE_KEY=0x... npx hardhat run contracts/deploy.js --network amoy"
echo "  3. Set POLYGON_CONTRACT in your .env"
echo "  4. Restart server"
echo ""

# ---- Railway Deployment ----
echo -e "${PURPLE}── Railway Deployment ──${NC}"
echo ""
echo "  1. Install Railway CLI: npm install -g @railway/cli"
echo "  2. Login: railway login"
echo "  3. Init: railway init"
echo "  4. Deploy: railway up"
echo "  5. Set env vars: railway variables set ADMIN_SECRET=..."
echo ""

echo -e "${GREEN}Setup complete!${NC}"
