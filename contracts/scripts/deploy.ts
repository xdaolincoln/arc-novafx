import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

async function main() {
  const signers = await ethers.getSigners();
  
  if (signers.length === 0) {
    throw new Error("No signers found. Please set PRIVATE_KEY in .env file");
  }

  const deployer = signers[0];
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy Settlement Contract
  const Settlement = await ethers.getContractFactory("Settlement");
  const settlement = await Settlement.deploy(
    "Arc FX Settlement",  // EIP712 name
    "1",                   // EIP712 version
    deployer.address       // initialOwner
  );

  await settlement.waitForDeployment();

  const settlementAddress = await settlement.getAddress();
  console.log("Settlement deployed to:", settlementAddress);

  // Save deployment info to JSON
  const deploymentInfo = {
    network: "arc-testnet",
    chainId: 5042002,
    deployer: deployer.address,
    contracts: {
      Settlement: {
        address: settlementAddress,
        deployedAt: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber(),
      },
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, "arc-testnet.json");
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));

  // Copy ABI to frontend
  const artifactPath = path.join(__dirname, "../artifacts/contracts/Settlement.sol/Settlement.json");
  if (!fs.existsSync(artifactPath)) {
    console.warn("⚠️  Warning: Artifact file not found. Make sure to compile contracts first.");
  } else {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    
    const frontendAbiDir = path.join(__dirname, "../../frontend/src/abi");
    if (!fs.existsSync(frontendAbiDir)) {
      fs.mkdirSync(frontendAbiDir, { recursive: true });
    }

    // Save ABI with contract address
    const abiWithAddress = {
      address: settlementAddress,
      abi: artifact.abi,
      network: "arc-testnet",
      chainId: 5042002,
      deployedAt: new Date().toISOString(),
    };

    const frontendAbiFile = path.join(frontendAbiDir, "Settlement.json");
    fs.writeFileSync(frontendAbiFile, JSON.stringify(abiWithAddress, null, 2));
    console.log("ABI copied to:", frontendAbiFile);
  }

  // Save addresses
  console.log("\n=== Deployment Summary ===");
  console.log("Settlement Contract:", settlementAddress);
  console.log("Deployment info saved to:", deploymentFile);
  console.log("\nUpdate these addresses in backend/.env and frontend/.env.local");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

