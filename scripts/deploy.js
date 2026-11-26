const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network : ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance : ${ethers.formatEther(balance)} ETH`);

  // The deployer wallet becomes the Admin (University Council).
  const Registry = await ethers.getContractFactory("CredentialRegistry");
  const registry = await Registry.deploy(deployer.address);
  const tx = registry.deploymentTransaction();
  console.log(`Deploy tx: ${tx.hash}`);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log(`CredentialRegistry deployed at: ${address}`);
  if (network.name === "sepolia") {
    console.log(`Etherscan: https://sepolia.etherscan.io/address/${address}`);
    console.log(`Verify   : npx hardhat verify --network sepolia ${address} ${deployer.address}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
