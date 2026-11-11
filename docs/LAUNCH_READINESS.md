# Release readiness — 9 November 2026

Initial implementation evidence is recorded below. QA was subsequently deployed on 9 November 2026; see [the QA release record](QA_RELEASE_2026-11-09.md) for live verification and remaining configuration. Production has not been deployed or migrated, and existing passwords were not reset.

## Approval policy

New services capture `directorPolicyVersion: 1` on creation. At budget, increased budget, supplier upper-price and variation approvals, use the GST-inclusive total service value. Above AUD 5,000, Finance and the Project Director plus the other Directors must approve. With the current three-Director roster this means the other two Directors. A Director who submitted the request cannot approve it; the remaining independent Directors still must approve. Exactly AUD 5,000 uses the normal gate. Adding Directors extends the independent approval roster; do not add new Director roles without reviewing this policy.

Already completed approval stages are preserved. Existing requests still awaiting budget, supplier or variation approval use the additional-Director rule for the remaining gate; prior votes are retained and policy adoption is logged on the next approval. Every unpaid last service instalment, including legacy Ready to pay records, now requires the captured Project Director's release. Marking the last instalment Progress or Advance does not bypass this. Final/Retention still require acceptance; an advance release does not mark the work complete. Returned payment evidence clears the release. Paid history remains intact. Project reimbursements retain the separate > AUD 2,000 acknowledgement rule.

## Local implementation

- Server-enforced staff request/project projection; scoped committed R2 attachment reads and reuse.
- Staff directory and account management in Settings, local and D1. Temporary/reset passwords require first-login change. Short legacy staff passwords trigger change at login. Password changes/resets and disabling revoke sessions. Workflow anchor accounts and active assignees cannot be disabled without transferring responsibility.
- Project members let staff submit to assigned projects. Employees see their own requests; PMs and Project Directors see assigned project requests; additional approvers see requests requiring their action and prior participation. Finance/Admin see all.
- Cloud contract AI uses the existing Responses adapter and prompt, structured schema, `store:false`, and `gpt-6-luna` default. OPENAI_API_KEY remains a Cloudflare Secret. Only model/enabled preferences enter D1. No real key in the source, public assets or workspace exports.
- Dedicated admin delegation works in cloud with `performedBy` on approval events and the workspace audit. Normal accounts cannot use X-Act-As. Admin remains responsible for each delegated action.
- Settings → Launch readiness reports credential rotation, Director coverage, provider configuration and the remaining QA rehearsal. It never treats a configuration flag as a tested release.
- Four incremental D1 migrations. Existing account passwords and records are preserved.

## Required before production

1. Review and commit the intended code. Do not push to an auto-deploy branch until the migration/release order is set. Existing local working changes include earlier feature work.
2. Take a full remote backup to a private folder using `npm run backup:cloud -- prod /absolute/private/new-backup`. It exports D1 plus every committed attachment, with checksums. This command reads remote data only; it has not been run against production in this change.
3. Rehearse `npm run restore:isolated -- /private/backup /private/new-restore`. It restores into a new local SQLite database and attachments, clears sessions and disables queued mail. It refuses an existing destination and corrupt/missing attachments. This is a recovery verification tool, not a remote production restore. Keep Cloudflare secrets separately in the organisation's credential vault; they are not exported. Production restore requires a reviewed D1/R2 recovery procedure and downtime decision.
4. Apply migrations **0001–0004** in QA, then deploy the reviewed build to QA. Run real QA flows, including a file OCR call, employee access, customer access, supplier selection, contract AI/ABN, signing, invoices, total approval thresholds, variations, final/progress/advance payments, returns and concurrency. A Worker dry run skips OCR image validation when `--containers-rollout=none` is used.
5. Rotate active staff production passwords. Use Settings → Manage staff to reset each temporary password, then require first-login change. Do not retain shared development passwords. Record secure customer password provisioning as part of onboarding.
6. Configure QA/prod `OPENAI_API_KEY` separately, then enable Contract AI in Settings. The authorized local key was not written to Cloudflare.
7. Configure Resend only after authorisation: verify wiseway.ai, set `RESEND_API_KEY`, sender `BOW OA <notifications@wiseway.ai>`, correct HTTPS `PUBLIC_APP_URL` and private `CUSTOMER_MAIL_KEY` (64 hexadecimal characters representing 32 random bytes). Without this, invitations stay queued/unavailable and are not sent. A provider-accepted email is not proof of inbox delivery. Use the agreed test recipient before inviting customers.
8. Run `npm test`, `npm run build`, `npm run check:release`, Worker bundling and Docker OCR build. The CI workflow performs these checks without deployment or secrets.
9. Deploy production only after QA review. Apply additive migrations first and preserve D1/R2/OCR/ASSETS bindings and existing vars/secrets. Never import a local workspace over existing production records. The import endpoint remains empty-workspace-only. Verify assets, login, permissions and provider integrations after release.

## Operational limits

Supplier credit/reputation checks remain deferred as requested. The system records payments made outside the application; it does not transfer funds. AI findings do not replace Finance's review or independently verified bank instructions. Email setup, live cloud QA, production backup and an operational restore rehearsal remain external release work until actually executed and evidenced.

## Evidence from this local verification

- Full regression suite: 168 tests passed.
- Desktop and 390 px mobile browser: employee creation, mandatory first-login password change, new login and no horizontal overflow or browser exceptions.
- Real GPT-6 Luna call through the cloud adapter with synthetic contract text: valid structured report saved; absent ABN and bank details left empty. No real contract was sent. The adapter follows the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
- Docker image built for local development and the AMD64 image used by Wrangler's container emulator.
- Local Worker/D1/R2/OCR emulator: additional Director approvals, account lifecycle, session revocation, staff isolation, admin delegation, private attachment download, concurrency conflict, and all three OCR fixtures passed.
- Full emulator database and its committed attachment exported and restored into a new isolated directory; checksums verified, sessions revoked, queued email disabled.

These checks were local. They do not establish that production migrations, provider secrets, live QA, staff password rotation or a production-data backup/restore have been completed.
