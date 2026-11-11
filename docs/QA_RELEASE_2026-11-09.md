# BOW OA QA release — 9 November 2026

## Environment and scope

QA URL: https://bow-approval-qa.percival-0ae.workers.dev

The current local application was deployed directly to QA. Active version after the approved Secret update: `a543ca4e-afcb-4213-9a16-1b5b7fb651b6` (100% traffic). Production was not deployed, migrated, or configured. Existing QA passwords, projects and attachments were preserved. The previously requested dedicated `admin` account was added from the local salted hash, without replacing existing accounts. Existing short staff passwords require change at sign-in.

The checkout contains earlier feature work that is not committed. This is a direct deployment of the verified working tree, not a claim that GitHub contains this release. Before production promotion, review and commit the intended source and ensure Git-triggered builds cannot replace this QA build with older branch content.

## Completed

- Reviewed the prior QA version and its DB, FILES, OCR, ASSETS and environment bindings.
- Backed up QA D1 and 11 committed R2 attachments before migration. Restored to an isolated local database and verified checksums; restored sessions revoked and queued mail disabled.
- Took a read-only production backup with its committed attachment and verified an isolated restore. No production data was changed.
- Applied additive D1 migration `0004_launch_controls.sql`. No migrations remain pending in QA.
- Deployed Worker, static assets and the new OCR container image.
- Preserved the existing ABN Lookup Secret and confirmed a real official lookup.
- Verified live OCR against text PDF, image PNG and scanned PDF fixtures: total AUD 1,320 and expected invoice date for all three.
- Verified current static assets, secure login cookie, unauthenticated denial and cross-origin write rejection.
- Created a temporary employee through the API, verified mandatory password change and session revocation, and denied account management and impersonation to that employee.
- Verified customer login and project-scoped portal access, with internal workspace denial.
- Verified a private R2 receipt can be read by an authorized Admin and cannot be read without authentication or by an unrelated employee (404 intentionally hides the file).
- Regression suite: 168 passed. Public build, migration/asset release checks and `git diff --check` passed.
- Saved the explicitly approved existing OpenAI key as a QA-only Cloudflare Secret and enabled `gpt-6-luna`. A real call through the live Worker returned and persisted a structured report for a synthetic contract, leaving missing ABN and bank fields empty. This isolated fixture tests the AI integration, not the complete approval journey; its temporary account was revoked and fixture cancelled afterwards.
- Set the agreed QA sender to `BOW OA <notifications@wiseway.ai>`; this does not enable sending without a Resend key.

Temporary verification accounts are disabled and their sessions revoked after the check. The synthetic request is cancelled and the synthetic project/customer are inactive; audit history and the receipt are retained. Other QA data remains unchanged.

## Remaining configuration, in order

1. **QA contract AI — completed:** the user explicitly approved the QA Secret destination on 9 November. Secret configured, model enabled and real synthetic-contract call verified; no production Secret was changed.
2. **QA invitations — deferred by user on 9 November:** no Resend key was created and no email was sent. When resumed, create a sending-only key restricted to wiseway.ai, store it as `RESEND_API_KEY`, and add a unique 32-byte `CUSTOMER_MAIL_KEY`. Do not print or commit either secret. Send only the agreed test to percival@wiseway.ai, then verify provider delivery and recipient inbox separately.
3. **Email DNS:** the Resend dashboard currently shows verified DKIM and sending SPF/MX for wiseway.ai. Its partial verification comes from a failed tracking CNAME (`abn-guard`). Leave tracking unused for BOW; do not alter unrelated domain/mail records just to enable BOW invitations.
4. **Account readiness:** each real staff member should rotate the shared development password; customer credentials should be provisioned individually. No existing password was silently reset during this release.
5. **Business QA acceptance:** exercise the complete approved service path, supplier reselection, contract and signed contract, invoice/ABN/bank confirmation, and staged/final payments with designated users. Boundary rules (> AUD 5,000 Director approvals and every last payment requiring Project Director sign-off) passed local automated and emulator tests; full live multi-role acceptance remains outstanding.
6. **Production promotion:** review the source/branch and configure production-specific secrets, then refresh the backup immediately before a separately authorized production release. Apply additive migrations first and preserve bindings/vars/assets. Do not import local or QA data into the live workspace.

## Private recovery artifacts

Ignored local directories in this checkout:

- `backups/qa-20261109-before-release`
- `restores/qa-20261109-verification`
- `backups/prod-20261109-prelaunch`
- `restores/prod-20261109-verification`

Backups contain sensitive operational data and are private local files, not repository assets. They do not contain Cloudflare Secret values. An isolated SQLite restore validates recovery material; it is not a live Cloudflare recovery rehearsal or an automatic production rollback.
