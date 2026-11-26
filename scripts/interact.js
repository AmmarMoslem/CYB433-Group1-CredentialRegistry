// The admin also issues credentials in the demo. Approval uses a second funded wallet.
const { ethers } = require("hardhat");

// A load-balanced RPC can return a stale nonce after the previous transaction.
const nonces = {};
async function nextNonce(signer) {
  const a = signer.address;
  if (nonces[a] === undefined) nonces[a] = await ethers.provider.getTransactionCount(a, "pending");
  return nonces[a]++;
}

async function send(label, signer, fn) {
  const tx = await fn({ nonce: await nextNonce(signer) });
  const r = await tx.wait();
  console.log(`${label.padEnd(34)} tx: ${tx.hash}  (gas ${r.gasUsed})`);
}

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) throw new Error("Set CONTRACT_ADDRESS=0x...");
  const [admin, approver] = await ethers.getSigners();
  const registry = await ethers.getContractAt("CredentialRegistry", address);

  const ISSUER_ROLE = await registry.ISSUER_ROLE();
  const APPROVER_ROLE = await registry.APPROVER_ROLE();

  // Use sample graduate data for the demo.
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const credHash = ethers.solidityPackedKeccak256(
    ["string", "string", "string", "uint256", "bytes32"],
    ["Demo Graduate", "4400000", "BSc Cybersecurity", 2026, salt]
  );
  const docDigest = ethers.keccak256(ethers.toUtf8Bytes("ipfs://demo-certificate-cid"));
  console.log(`Credential hash: ${credHash}\nSalt (give to graduate): ${salt}\n`);

  if (!(await registry.hasRole(ISSUER_ROLE, admin.address)))
    await send("1. grantRole(ISSUER_ROLE)", admin, (o) => registry.grantRole(ISSUER_ROLE, admin.address, o));
  else console.log("1. grantRole(ISSUER_ROLE)            already granted (earlier run)");
  await send("2. issueCredential", admin, (o) => registry.issueCredential(credHash, docDigest, 0, o));

  if (approver) {
    if (!(await registry.hasRole(APPROVER_ROLE, approver.address)))
      await send("3. grantRole(APPROVER_ROLE)", admin, (o) => registry.grantRole(APPROVER_ROLE, approver.address, o));
    await send("4. approveCredential", approver, (o) => registry.connect(approver).approveCredential(credHash, o));
  } else {
    // Single-wallet fallback: still produces 3+ write transactions.
    const second = ethers.keccak256(ethers.toUtf8Bytes("demo-2-" + salt));
    await send("3. issueCredential (second)", admin, (o) => registry.issueCredential(second, docDigest, 0, o));
    const third = ethers.keccak256(ethers.toUtf8Bytes("demo-3-" + salt));
    await send("4. issueCredential (third)", admin, (o) => registry.issueCredential(third, docDigest, 0, o));
    console.log("No APPROVER_PRIVATE_KEY set: skipping approval (SelfApproval protection).");
  }

  const v = await registry.verifyCredential(credHash);
  console.log(`\nverifyCredential -> valid=${v.valid} status=${v.status} issuer=${v.issuer}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
