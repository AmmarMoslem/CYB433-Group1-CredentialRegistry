# Sepolia Deployment Record

## Contract

| Item | Value |
|---|---|
| Network | Ethereum Sepolia testnet |
| Contract | `CredentialRegistry` |
| Address | `0x33DAC99c8a00303580df85CC93765fFF52B1d449` |
| Etherscan (verified, Exact Match) | https://sepolia.etherscan.io/address/0x33DAC99c8a00303580df85CC93765fFF52B1d449#code |
| Compiler | solc 0.8.24, optimizer on, 200 runs |
| Deployer / Admin (University Council) | `0xB49915C69450eBfA621B58319BB4E2CD672490A1` |

## Process

1. A new course-only wallet was funded with 0.05 Sepolia ETH from the Google Cloud Web3 faucet.
2. `npx hardhat run scripts/deploy.js --network sepolia` deployed the contract.
3. `npx hardhat verify --network sepolia <ADDRESS> <ADMIN_ADDRESS>` verified the source on Etherscan.
4. `scripts/interact.js` sent the live write transactions.

The RPC URL, private key and Etherscan API key are read only from `.env`, which is listed in `.gitignore`. Checked with `git check-ignore -v .env` and `git log --all -- .env` (no history).

## Roles on the live contract

| Role | Holder |
|---|---|
| DEFAULT_ADMIN_ROLE | `0xB49915C69450eBfA621B58319BB4E2CD672490A1` |
| ISSUER_ROLE | `0xB49915C69450eBfA621B58319BB4E2CD672490A1` |
| APPROVER_ROLE | not granted on Sepolia (approval path covered by unit tests 12–13) |

## Write transactions

| # | Function | Sender | Transaction hash |
|---|---|---|---|
| 0 | Contract creation | Admin | `0xc565466e756d6a728aae4263af633b57210a28f11e43aa8f89c04d2176ca80d1` |
| 1 | `grantRole(ISSUER_ROLE, admin)` | Admin | `0xb98504831305412929d88034315f1a2e173032f587182894fd03e4d0de4fd398` |
| 2 | `issueCredential` | Admin (issuer) | `0x47f3efdeba550881bdee4e3b57da4aa20860ed5eed3537f8552b00627e724c24` |
| 3 | `issueCredential` | Admin (issuer) | `0xcb10b2c9c5709126fcc842cb1445c1ba3f07bd9c8b8751dc5071ca809850c0d7` |
| 4 | `issueCredential` | Admin (issuer) | `0x4e6a918da9a52f460e7fe89689cd0fad3674325f15190bcd603d4065935329f3` |

## Separation of Duties on the live network

Credential hash `0x1c15f9cda52c456e5498b5b358ba6b1b52c771242fe1289ac32bd80b89917c15` (transaction 2):

| When | `verifyCredential` result |
|---|---|
| After issue (admin wallet only) | `valid = false`, `status = 1` (Pending). The issuing wallet cannot approve its own credential (`SelfApproval`), so approval needs a second wallet with APPROVER_ROLE. |

## Note: "nonce too low"

The first `interact.js` run confirmed `grantRole` and then failed with `nonce too low`. The public RPC endpoint is load-balanced, and a lagging node returned a stale nonce. The script was changed to track nonces locally; the second run detected the role was already granted and sent the three `issueCredential` transactions.
