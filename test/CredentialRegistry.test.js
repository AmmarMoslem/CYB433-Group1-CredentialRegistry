const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const Status = { None: 0, Pending: 1, Active: 2, Revoked: 3, Rejected: 4 };
const ZERO = ethers.ZeroHash;

// Off-chain: graduate data + random salt -> hash. Only the hash goes on-chain.
function credentialHash(name, studentId, degree, year, salt) {
  return ethers.solidityPackedKeccak256(
    ["string", "string", "string", "uint256", "bytes32"],
    [name, studentId, degree, year, salt]
  );
}

describe("CredentialRegistry", function () {
  async function deployFixture() {
    const [admin, issuer, approver, outsider, issuer2] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CredentialRegistry");
    const registry = await Registry.deploy(admin.address);

    const ISSUER_ROLE = await registry.ISSUER_ROLE();
    const APPROVER_ROLE = await registry.APPROVER_ROLE();
    await registry.connect(admin).grantRole(ISSUER_ROLE, issuer.address);
    await registry.connect(admin).grantRole(APPROVER_ROLE, approver.address);

    const salt = ethers.hexlify(ethers.randomBytes(32));
    const credHash = credentialHash("Student Name", "4400000", "BSc Cybersecurity", 2026, salt);
    const docDigest = ethers.keccak256(ethers.toUtf8Bytes("ipfs://bafy-example-cid"));
    const reason = ethers.keccak256(ethers.toUtf8Bytes("fraud detected"));

    return { registry, admin, issuer, approver, outsider, issuer2, ISSUER_ROLE, APPROVER_ROLE, credHash, docDigest, reason, salt };
  }

  async function issuedFixture() {
    const f = await deployFixture();
    await f.registry.connect(f.issuer).issueCredential(f.credHash, f.docDigest, 0);
    return f;
  }

  async function activeFixture() {
    const f = await issuedFixture();
    await f.registry.connect(f.approver).approveCredential(f.credHash);
    return f;
  }

  describe("Deployment & roles", function () {
    it("1. grants DEFAULT_ADMIN_ROLE to the admin only", async function () {
      const { registry, admin, issuer } = await loadFixture(deployFixture);
      const ADMIN = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(ADMIN, admin.address)).to.equal(true);
      expect(await registry.hasRole(ADMIN, issuer.address)).to.equal(false);
    });

    it("2. reverts deployment with a zero admin address", async function () {
      const Registry = await ethers.getContractFactory("CredentialRegistry");
      await expect(Registry.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Registry, "ZeroAddress");
    });

    it("3. only admin can grant roles", async function () {
      const { registry, outsider, ISSUER_ROLE } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).grantRole(ISSUER_ROLE, outsider.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("4. admin can revoke the issuer role, after which issuing fails", async function () {
      const { registry, admin, issuer, ISSUER_ROLE, credHash, docDigest } = await loadFixture(deployFixture);
      await registry.connect(admin).revokeRole(ISSUER_ROLE, issuer.address);
      await expect(registry.connect(issuer).issueCredential(credHash, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "Unauthorized");
    });
  });

  describe("issueCredential", function () {
    it("5. issuer creates a Pending credential and emits CredentialIssued", async function () {
      const { registry, issuer, credHash, docDigest } = await loadFixture(deployFixture);
      await expect(registry.connect(issuer).issueCredential(credHash, docDigest, 0))
        .to.emit(registry, "CredentialIssued").withArgs(credHash, issuer.address, docDigest, 0);
      const c = await registry.getCredential(credHash);
      expect(c.status).to.equal(Status.Pending);
      expect(c.issuer).to.equal(issuer.address);
      expect(c.documentDigest).to.equal(docDigest);
    });

    it("6. outsider and approver cannot issue", async function () {
      const { registry, outsider, approver, credHash, docDigest, ISSUER_ROLE } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).issueCredential(credHash, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "Unauthorized").withArgs(outsider.address, ISSUER_ROLE);
      await expect(registry.connect(approver).issueCredential(credHash, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("7. rejects a zero credential hash", async function () {
      const { registry, issuer, docDigest } = await loadFixture(deployFixture);
      await expect(registry.connect(issuer).issueCredential(ZERO, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "InvalidHash");
    });

    it("8. rejects a zero document digest", async function () {
      const { registry, issuer, credHash } = await loadFixture(deployFixture);
      await expect(registry.connect(issuer).issueCredential(credHash, ZERO, 0))
        .to.be.revertedWithCustomError(registry, "InvalidHash");
    });

    it("9. rejects a duplicate credential, even from another issuer", async function () {
      const { registry, admin, issuer, issuer2, ISSUER_ROLE, credHash, docDigest } = await loadFixture(issuedFixture);
      await registry.connect(admin).grantRole(ISSUER_ROLE, issuer2.address);
      await expect(registry.connect(issuer).issueCredential(credHash, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "AlreadyExists").withArgs(credHash);
      await expect(registry.connect(issuer2).issueCredential(credHash, docDigest, 0))
        .to.be.revertedWithCustomError(registry, "AlreadyExists");
    });

    it("10. rejects an expiry date in the past", async function () {
      const { registry, issuer, credHash, docDigest } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 10;
      await expect(registry.connect(issuer).issueCredential(credHash, docDigest, past))
        .to.be.revertedWithCustomError(registry, "InvalidExpiry");
    });

    it("11. increments totalIssued", async function () {
      const { registry, issuer, docDigest, salt } = await loadFixture(deployFixture);
      const h1 = credentialHash("A", "1", "BSc", 2026, salt);
      const h2 = credentialHash("B", "2", "BSc", 2026, salt);
      await registry.connect(issuer).issueCredential(h1, docDigest, 0);
      await registry.connect(issuer).issueCredential(h2, docDigest, 0);
      expect(await registry.totalIssued()).to.equal(2);
    });
  });

  describe("approveCredential / rejectCredential", function () {
    it("12. approver moves Pending -> Active and emits CredentialApproved", async function () {
      const { registry, approver, credHash } = await loadFixture(issuedFixture);
      await expect(registry.connect(approver).approveCredential(credHash))
        .to.emit(registry, "CredentialApproved").withArgs(credHash, approver.address);
      const c = await registry.getCredential(credHash);
      expect(c.status).to.equal(Status.Active);
      expect(c.issuer).to.not.equal(approver.address); // issuer and approver are different people
    });

    it("13. the issuer cannot approve his own credential (SelfApproval)", async function () {
      const { registry, admin, issuer, APPROVER_ROLE, credHash } = await loadFixture(issuedFixture);
      await registry.connect(admin).grantRole(APPROVER_ROLE, issuer.address); // issuer now holds both roles
      await expect(registry.connect(issuer).approveCredential(credHash))
        .to.be.revertedWithCustomError(registry, "SelfApproval");
    });

    it("14. a non-approver cannot approve", async function () {
      const { registry, issuer, outsider, credHash } = await loadFixture(issuedFixture);
      await expect(registry.connect(issuer).approveCredential(credHash)).to.be.revertedWithCustomError(registry, "Unauthorized");
      await expect(registry.connect(outsider).approveCredential(credHash)).to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("15. cannot approve a non-existent credential", async function () {
      const { registry, approver } = await loadFixture(deployFixture);
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      await expect(registry.connect(approver).approveCredential(unknown))
        .to.be.revertedWithCustomError(registry, "NotFound").withArgs(unknown);
    });

    it("16. cannot approve twice", async function () {
      const { registry, approver, credHash } = await loadFixture(activeFixture);
      await expect(registry.connect(approver).approveCredential(credHash))
        .to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(credHash, Status.Active, Status.Pending);
    });

    it("17. approver rejects Pending -> Rejected with a reason hash", async function () {
      const { registry, approver, credHash, reason } = await loadFixture(issuedFixture);
      await expect(registry.connect(approver).rejectCredential(credHash, reason))
        .to.emit(registry, "CredentialRejected").withArgs(credHash, approver.address, reason);
      const c = await registry.getCredential(credHash);
      expect(c.status).to.equal(Status.Rejected);
      expect(c.reasonHash).to.equal(reason);
    });

    it("18. reject requires a reason and a Pending credential", async function () {
      const { registry, approver, credHash, reason } = await loadFixture(issuedFixture);
      await expect(registry.connect(approver).rejectCredential(credHash, ZERO)).to.be.revertedWithCustomError(registry, "InvalidHash");
      await registry.connect(approver).approveCredential(credHash);
      await expect(registry.connect(approver).rejectCredential(credHash, reason)).to.be.revertedWithCustomError(registry, "InvalidStatus");
    });

    it("31. a non-approver cannot reject", async function () {
      const { registry, issuer, outsider, credHash, reason, APPROVER_ROLE } = await loadFixture(issuedFixture);
      await expect(registry.connect(issuer).rejectCredential(credHash, reason))
        .to.be.revertedWithCustomError(registry, "Unauthorized").withArgs(issuer.address, APPROVER_ROLE);
      await expect(registry.connect(outsider).rejectCredential(credHash, reason))
        .to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("19. a rejected credential cannot be approved later", async function () {
      const { registry, approver, credHash, reason } = await loadFixture(issuedFixture);
      await registry.connect(approver).rejectCredential(credHash, reason);
      await expect(registry.connect(approver).approveCredential(credHash)).to.be.revertedWithCustomError(registry, "InvalidStatus");
    });
  });

  describe("revokeCredential", function () {
    it("20. approver revokes Active -> Revoked; verify then returns false", async function () {
      const { registry, approver, credHash, reason } = await loadFixture(activeFixture);
      await expect(registry.connect(approver).revokeCredential(credHash, reason))
        .to.emit(registry, "CredentialRevoked").withArgs(credHash, approver.address, reason);
      const v = await registry.verifyCredential(credHash);
      expect(v.valid).to.equal(false);
      expect(v.status).to.equal(Status.Revoked);
    });

    it("21. cannot revoke a Pending credential", async function () {
      const { registry, approver, credHash, reason } = await loadFixture(issuedFixture);
      await expect(registry.connect(approver).revokeCredential(credHash, reason))
        .to.be.revertedWithCustomError(registry, "InvalidStatus");
    });

    it("22. revoke needs the approver role and a non-zero reason", async function () {
      const { registry, approver, issuer, credHash, reason } = await loadFixture(activeFixture);
      await expect(registry.connect(issuer).revokeCredential(credHash, reason)).to.be.revertedWithCustomError(registry, "Unauthorized");
      await expect(registry.connect(approver).revokeCredential(credHash, ZERO)).to.be.revertedWithCustomError(registry, "InvalidHash");
    });

    it("23. a revoked credential cannot be revoked again or re-issued", async function () {
      const { registry, approver, issuer, credHash, docDigest, reason } = await loadFixture(activeFixture);
      await registry.connect(approver).revokeCredential(credHash, reason);
      await expect(registry.connect(approver).revokeCredential(credHash, reason)).to.be.revertedWithCustomError(registry, "InvalidStatus");
      await expect(registry.connect(issuer).issueCredential(credHash, docDigest, 0)).to.be.revertedWithCustomError(registry, "AlreadyExists");
    });
  });

  describe("verifyCredential & expiry", function () {
    it("24. returns valid=true for an Active credential without expiry", async function () {
      const { registry, issuer, credHash } = await loadFixture(activeFixture);
      const v = await registry.verifyCredential(credHash);
      expect(v.valid).to.equal(true);
      expect(v.status).to.equal(Status.Active);
      expect(v.issuer).to.equal(issuer.address);
    });

    it("25. a Pending credential is not valid yet", async function () {
      const { registry, credHash } = await loadFixture(issuedFixture);
      expect((await registry.verifyCredential(credHash)).valid).to.equal(false);
    });

    it("26. becomes invalid after validUntil (time.increase)", async function () {
      const { registry, issuer, approver, credHash, docDigest } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + 3600;
      await registry.connect(issuer).issueCredential(credHash, docDigest, expiry);
      await registry.connect(approver).approveCredential(credHash);
      expect((await registry.verifyCredential(credHash)).valid).to.equal(true);
      await time.increase(3601);
      const v = await registry.verifyCredential(credHash);
      expect(v.valid).to.equal(false);
      expect(v.status).to.equal(Status.Active); // stored status unchanged, validity is time-based
    });

    it("27. unknown hash and wrong salt both fail verification", async function () {
      const { registry, credHash } = await loadFixture(activeFixture);
      const wrongSalt = credentialHash("Student Name", "4400000", "BSc Cybersecurity", 2026, ethers.hexlify(ethers.randomBytes(32)));
      expect(wrongSalt).to.not.equal(credHash);
      const v = await registry.verifyCredential(wrongSalt);
      expect(v.valid).to.equal(false);
      expect(v.status).to.equal(Status.None);
    });
  });

  describe("pause (emergency stop)", function () {
    it("28. only admin can pause and unpause", async function () {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).pause()).to.be.revertedWithCustomError(registry, "Unauthorized");
      await expect(registry.connect(admin).pause()).to.emit(registry, "Paused").withArgs(admin.address);
      await expect(registry.connect(outsider).unpause()).to.be.revertedWithCustomError(registry, "Unauthorized");
      await expect(registry.connect(admin).unpause()).to.emit(registry, "Unpaused");
    });

    it("29. paused contract blocks issue, approve and reject", async function () {
      const { registry, admin, issuer, approver, credHash, docDigest, reason } = await loadFixture(issuedFixture);
      await registry.connect(admin).pause();
      const other = ethers.keccak256(ethers.toUtf8Bytes("other"));
      await expect(registry.connect(issuer).issueCredential(other, docDigest, 0)).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(approver).approveCredential(credHash)).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(approver).rejectCredential(credHash, reason)).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("30. revocation still works while paused (incident response)", async function () {
      const { registry, admin, approver, credHash, reason } = await loadFixture(activeFixture);
      await registry.connect(admin).pause();
      await expect(registry.connect(approver).revokeCredential(credHash, reason)).to.emit(registry, "CredentialRevoked");
    });
  });
});
