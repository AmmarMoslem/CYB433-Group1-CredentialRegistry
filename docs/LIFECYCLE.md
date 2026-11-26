# Credential Lifecycle & Business Rules

Maps every state transition and business rule of `contracts/CredentialRegistry.sol` to the code that enforces it and the unit test that proves it. Line numbers refer to `contracts/CredentialRegistry.sol` on `main`.

## State machine

```
None ──issueCredential──► Pending ──approveCredential──► Active ──revokeCredential──► Revoked
                             │
                             └──────rejectCredential──► Rejected

Active ──(block.timestamp > validUntil, validUntil ≠ 0)──► expired (verifyCredential returns valid = false)
```

`Rejected` and `Revoked` are final. Expiry needs no transaction: validity is computed on every `verifyCredential` call.

## Transitions

| Transition | Function | Required role | Modifiers | Reverts with | Event | Tests |
|---|---|---|---|---|---|---|
| None → Pending | `issueCredential` (L115) | ISSUER_ROLE | `onlyIssuer`, `whenNotPaused` | `Unauthorized`, `InvalidHash`, `AlreadyExists`, `InvalidExpiry`, `EnforcedPause` | `CredentialIssued` | 5–11, 29 |
| Pending → Active | `approveCredential` (L138) | APPROVER_ROLE, not the issuer | `onlyApprover`, `whenNotPaused`, `inStatus(Pending)` | `Unauthorized`, `NotFound`, `InvalidStatus`, `SelfApproval`, `EnforcedPause` | `CredentialApproved` | 12–16, 19, 29 |
| Pending → Rejected | `rejectCredential` (L151) | APPROVER_ROLE | `onlyApprover`, `whenNotPaused`, `inStatus(Pending)` | `Unauthorized`, `InvalidHash`, `InvalidStatus`, `EnforcedPause` | `CredentialRejected` | 17, 18, 29 |
| Active → Revoked | `revokeCredential` (L166) | APPROVER_ROLE | `onlyApprover`, `inStatus(Active)` (no pause check) | `Unauthorized`, `InvalidHash`, `InvalidStatus` | `CredentialRevoked` | 20–23, 30 |
| Active → expired | `verifyCredential` (L181), view | anyone | — | — | — | 24–27 |

## Business rules

| # | Rule | Enforced at | Test |
|---|---|---|---|
| 1 | Only an account with ISSUER_ROLE can create a credential | `onlyIssuer` L71–74 | 4, 6 |
| 2 | Roles are granted and revoked only by the Admin (University Council) | OpenZeppelin `AccessControl` | 3, 4 |
| 3 | Credential hash and document digest cannot be zero | L120 → `InvalidHash` | 7, 8 |
| 4 | A credential hash can exist only once, even after revocation and across issuers | L122 → `AlreadyExists` | 9, 23 |
| 5 | An expiry date, if set, must be in the future | L124 → `InvalidExpiry` | 10 |
| 6 | A new credential is Pending and not valid until approved | L130, L192 | 5, 25 |
| 7 | The issuer can never approve his own credential (Separation of Duties) | L145 → `SelfApproval` | 13 |
| 8 | Only Pending can be approved or rejected; only Active can be revoked; unknown hashes revert | `_checkStatus` L101–107 → `NotFound` / `InvalidStatus` | 15, 16, 18, 19, 21 |
| 9 | Rejection and revocation need a non-zero reason hash | L157, L171 → `InvalidHash` | 18, 22 |
| 10 | When paused, issue/approve/reject stop, but revocation still works | `whenNotPaused` on L118, L141, L154; none on revoke (L165 note) | 29, 30 |
| 11 | A credential is valid only if Active and not expired | L192 | 24, 26 |
| 12 | Verification without personal data: a wrong salt gives a different hash | off-chain hashing; L181 | 27 |

## Why a public ledger instead of a central database

- **Independent verification:** an employer checks a degree in seconds without contacting the university.
- **Tamper evidence:** every issue, approval and revocation is a permanent, timestamped record; no silent edits.
- **Availability:** verification keeps working if the university's own systems fail.
- **Built-in governance:** the two-person rule is enforced by code, not by internal policy.
- **Trade-offs:** gas cost per credential, limited throughput, data cannot be deleted (so only salted hashes are stored), and security depends on protecting the Admin key.
