# CYB433 – Group 1 – Academic Credentials Registry

Ethereum smart contract (`contracts/CredentialRegistry.sol`) that issues and verifies university degrees
without storing any personal data on-chain.

- Only a **salted hash** of the graduate's data is stored; the certificate PDF lives on IPFS (only a digest of its CID is on-chain).
- **Two-person rule:** an Issuer (Registrar) creates a credential, a *different* Approver (Dean) activates it.
- **Revocation** with a hashed reason, still possible while the contract is paused.
- **Emergency pause** by the Admin (University Council) if a key is compromised.

## Team

| Member | Student ID | Part |
|---|---|---|
| Ammar M. Aljohani | 4406104 | Contract Part A (data model, roles, modifiers), architecture |
| Essam A. Aloufi | 4400572 | Contract Part B (business logic), industry analysis |
| Feras A. Alharbi | 4405255 | Unit tests, coverage, gas optimization |
| Yazan N. Alhubayshi | 4404686 | Slither audit, Sepolia deployment, scripts |

## Deployment (Sepolia)

- Contract address: `0x33DAC99c8a00303580df85CC93765fFF52B1d449`
- Etherscan (verified): https://sepolia.etherscan.io/address/0x33DAC99c8a00303580df85CC93765fFF52B1d449#code
- Deployment tx: `0xc565466e756d6a728aae4263af633b57210a28f11e43aa8f89c04d2176ca80d1`
- Admin / deployer: `0xB49915C69450eBfA621B58319BB4E2CD672490A1`
- Live write transactions: 1 × `grantRole`, 3 × `issueCredential` (see report, Table 11)

## Results

| Item | Result |
|---|---|
| Unit tests | 31 passing |
| Coverage | 100% lines, branches, functions, statements |
| Slither final | 0 High, 0 Medium |
| Gas: `issueCredential` | 147,376 → 94,798 (−35.7%) |
| Gas: deployment | 1,023,545 → 913,562 (−10.7%) |

## How to run

```bash
npm install
npm test                                   # 31 unit tests
npm run coverage                           # coverage report
REPORT_GAS=true npx hardhat test           # gas report
slither .                                  # static analysis (pip install slither-analyzer)

cp .env.example .env                       # fill SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify --network sepolia <ADDRESS> <ADMIN_ADDRESS>
CONTRACT_ADDRESS=<ADDRESS> npx hardhat run scripts/interact.js --network sepolia
```

`interact.js` sends the live write transactions (grant roles, issue, approve). Approval needs a second
wallet in `APPROVER_PRIVATE_KEY`, because the contract blocks the issuer from approving his own credential.

## Repository layout

```
contracts/CredentialRegistry.sol     test/CredentialRegistry.test.js
scripts/deploy.js  scripts/interact.js
audit/slither-initial.txt  audit/slither-final.txt
gas/gas-before.txt  gas/gas-after.txt
docs/architecture.png  docs/LIFECYCLE.md  docs/DEPLOYMENT.md
hardhat.config.js  package.json  .env.example  .gitignore
```
