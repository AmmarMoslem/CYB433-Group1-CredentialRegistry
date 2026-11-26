require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, PRIVATE_KEY, APPROVER_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

// Use a second wallet to demonstrate approval on Sepolia.
const sepoliaAccounts = [PRIVATE_KEY, APPROVER_PRIVATE_KEY].filter(Boolean);

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: { url: SEPOLIA_RPC_URL || "", accounts: sepoliaAccounts },
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    // GAS_OUTPUT=gas/gas-after.txt writes the report to a file
    noColors: true,
    outputFile: process.env.GAS_OUTPUT || undefined,
  },
};
