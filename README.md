# BOW Approval

An approval workspace for corporate reimbursements, project expenses, and project service purchases. The interface is in English and amounts are in AUD. It runs locally on Node.js or on Cloudflare Workers with D1, private R2 attachments, and a separate OCR Container.

## Features

- **Home:** a single Request entry point and a list of items requiring attention.
- **Corporation:** submit an amount, expense date, and invoice. Supervisor, Admin, and Finance reviews follow the applicant's role and workflow rules.
- **Projects:** view reimbursements and service purchases separately, assign a PM and Director, and configure the large-expense review threshold.
- **Service purchases:** Director and Finance pre-approval, applicant submission of quotes and contracts, approval by both reviewers, a payment plan, and supporting documents for each instalment. Final payments require acceptance evidence, Director approval, and Finance review.
- Return for changes, withdrawal, Director review, cancellation of unpaid amounts, attachments, and activity history.
- Server-side authentication, authorization, and shared data. The former demo role switcher has been removed.
- Invoice OCR for local and cloud environments. Payment records document payments made outside the application; the application does not initiate bank transfers.

## Getting started

Node.js 22 or later is required. Run `npm ci` after cloning; cloud deployment also requires Docker.

```sh
git clone https://github.com/percival-peng-wiseway/bow_approval.git
cd bow_approval
npm ci
```

Initialize accounts before the first run. In Bash, use the following commands to enter an initial password without placing it in source code or shell history:

```bash
read -r -s -p "Initial password: " APPROVAL_INITIAL_PASSWORD
printf '%s' "$APPROVAL_INITIAL_PASSWORD" | node scripts/create-accounts.mjs
unset APPROVAL_INITIAL_PASSWORD
npm run dev
```

Open <http://127.0.0.1:4185/>. For subsequent starts, run `npm run dev` directly. The initialization script refuses to overwrite existing accounts. Set `PORT` to change the port or `APP_DATA_DIR` to use a different private data directory. The server listens on the local loopback interface by default.

## Local data and authentication

- `.local/accounts.json`: password hashes generated with scrypt and a unique salt for each account.
- `.local/workspace.json`: shared requests, projects, attachments, and approval records.
- `.local/browser-import.json`: a backup of imported browser workspace data.
- Sessions use HttpOnly, SameSite=Strict cookies and expire after 12 hours; HTTPS adds Secure. Cloud sessions persist in D1 across deployments. Local sessions are invalidated when the Node.js server restarts.
- The server derives the acting user from the session and validates each operation against the workflow rules. Revision checks prevent concurrent changes from overwriting one another.
- This is a shared workspace for one organization. Signed-in members can read shared data; writes and approvals are restricted by role and workflow stage.

To migrate an earlier browser-based workspace, sign in with the Admin account in the original browser while the server workspace is still empty. The application imports `approval-workspace-v1`, preserves the browser copy, and does not overwrite existing server data. Legacy identity IDs remain available for historical references.

Private runtime data, environment files, research captures, and screenshots are excluded from Git. When moving to another computer, transfer private data separately and configure the runtime environment.

## Invoice OCR (optional)

Use **Scan invoice** in a reimbursement form to scan PDF, PNG, JPEG, or WebP files. The application extracts amounts and dates and retains the original document. Review the extracted information before submitting.

OCR requires Python with `pypdf`, `pypdfium2`, and `Pillow`, plus Tesseract with the `eng` language pack. Specify their locations using environment variables:

```sh
INVOICE_PYTHON=/path/to/python3 INVOICE_TESSERACT=/path/to/tesseract npm run dev
```

Manual entry and attachment uploads remain available without OCR. The default OCR paths target the original development computer and may need to be changed on other systems.

## Contract ABN checks

Uploading a supplier contract during service sourcing starts an ABN check. The applicant can also enter or correct the supplier ABN and select **Check ABN**. PDF and image contracts use the existing OCR service; text contracts are read directly. The server queries the official ABN Lookup service for registered/business names, ABN status and GST registration.

A matching active supplier is marked **ABN checked**. Missing identifiers, unreadable documents, unavailable lookups, name mismatches, inactive ABNs and missing GST registration are marked **Needs review**. Findings require an applicant explanation before submission; Finance and the Director see the saved findings and explanation alongside the contract. These are identity checks, not bank-account verification.

Checks are bound to the applicant, request, supplier name and contract file hashes. Changing the supplier or contract requires another check; checks expire for submission after 24 hours. Existing approved requests are preserved.

Configure `ABN_LOOKUP_GUID` as a server-only environment variable locally, or store it in `.local/abn-lookup-guid` with file permissions `0600` (inside `APP_DATA_DIR` if overridden). Set it independently for each Cloudflare environment:

```sh
npx wrangler secret put ABN_LOOKUP_GUID --env QA
npx wrangler secret put ABN_LOOKUP_GUID --env prod
```

Enter the credential at the hidden prompt; never commit it or place it in public assets. Cloud check snapshots are stored in D1 via migration `0002_contract_abn_checks.sql`. Local snapshots are stored privately under `.local/abn-checks/`. A missing credential or provider failure produces **Needs review**, never a simulated success.

## Tests

```sh
npm test
```

The test suite covers business rules, authentication, authorization, identity spoofing, revision conflicts, migration, and session invalidation. Server tests use temporary directories and servers without modifying the actual workspace.

Run `node tests/auth-browser.mjs` for end-to-end checks of the authenticated reimbursement and service approval flows through payment recording. Set `CLOUD_TEST_URL` to run this browser suite against a QA Worker. It creates synthetic test records and must not be run against production. The script currently uses absolute paths to Chrome and Playwright on the development computer; adjust those paths for another environment. Other browser scripts that use the Demo role switcher are retained as historical tests.

## Project structure

- `app/`: interface and approval domain logic.
- `server.mjs`: HTTP server, API routes, and invoice scanning endpoints.
- `server/`: accounts, sessions, and shared data persistence.
- `cloud/`: Cloudflare Worker, D1 persistence, authentication, and private downloads.
- `migrations/`: versioned D1 schema.
- `ocr/`: document extraction, invoice parsing, and the cloud Container.
- `scripts/create-accounts.mjs`: account initialization.
- `tests/`: domain, API, and browser tests. Invoice fixtures are synthetic test documents.

## Branches

- `main`: the main development branch.
- `QA`: the branch for QA validation.
- `prod`: the branch for production releases.

Cloudflare environments are isolated: `QA` deploys to `bow-approval-qa`, and `prod` deploys to `bow-approval`. Each uses its own D1 database, private R2 bucket, and OCR Container. Git-triggered deployment settings are described in [Cloudflare deployment](docs/CLOUDFLARE.md).

## Deployment scope

For Cloudflare setup, account provisioning, migration, and test commands, see [Cloudflare deployment](docs/CLOUDFLARE.md). The Worker serves the UI and authenticated API; D1 stores accounts, sessions, requests and audit records; R2 stores private attachments. OCR runs in a dedicated Container with no internet access and sleeps after two idle minutes.

Bank and accounting integrations are not connected. Customer email uses the optional Resend configuration below. Internal staff share one workspace; customer accounts have a separate, restricted portal. Tamper-proof auditing is not implemented.

The workflows were independently implemented using public product information. This repository does not contain ApprovalMax's private source code or APIs. Research evidence and historical implementation notes remain in the original development workspace under `evidence/` and are not included in this repository.

## Customer projects and confirmations

**Enter customer preview** opens `/#customer-demo` immediately without email verification. It uses public, fictional projects in browser memory, including a confirmation and a completed handover. Preview decisions do not call workspace APIs, send mail or change real requests. Reloading resets the sample. Real customer access remains at `/#customer` and requires an email sign-in link.

Admin manages customers under **Customers** (company, contact, email and active status). Assign the customer in **Project settings**, then send the invitation. Customer accounts use single-use email sign-in links instead of shared passwords. Invitations expire in 72 hours; requested sign-in links expire in 15 minutes. Sessions expire after 12 hours. Deactivating a customer immediately blocks project and document access.

For newly submitted services in a customer project, the order is:

1. Customer reviews the scope, background, approach and estimated budget.
2. Confirmation releases the existing Director and Finance pre-approval flow. A decline or change request returns the item to the applicant.
3. Quotes/contracts, ABN checks, dual internal approval and staged payments continue as before. An increased supplier budget needs a fresh customer confirmation before further internal approval.
4. Completed services appear in the customer's archive. The project team uses **Publish completion** to share a completion summary and selected documents.

Customer responses are versioned; edits and withdrawn pending confirmations require a new response. Customer ownership cannot be changed after a project has shared service requests. Existing projects without a customer retain their current approval flow; historical internal requests are not automatically shared.

Customers receive a separate, server-filtered portal. Internal workspace APIs, reimbursements, supplier quotes/contracts, ABN findings, approval notes and payment receipts are inaccessible. Only explicitly published completion files are downloadable by the assigned active customer.

### Email delivery

The initial adapter uses Resend's HTTPS API. Configure a verified sender in `EMAIL_FROM` and an API key in the server-only `RESEND_API_KEY` secret. `PUBLIC_APP_URL` is set independently for QA and production in Wrangler; set it for local email testing if needed. Local Node reads these values from its process environment. Do not commit secrets or put keys in browser code.

```sh
npx wrangler secret put RESEND_API_KEY --env QA
npx wrangler secret put EMAIL_FROM --env QA
npx wrangler secret put RESEND_API_KEY --env prod
npx wrangler secret put EMAIL_FROM --env prod
```

Pending confirmations generate durable outbox records. Invitation and sign-in links are stored only in private email payloads, and token hashes are used for redemption. Background processing sends queued notifications when configured. Expired or superseded notices are cancelled. Failed messages remain visible to Admin and can be retried within the provider's idempotency window using their original message ID. An accepted API response is labeled **Sent to provider**, not delivered to the inbox. Delivery/bounce webhooks are not configured.

Without sender credentials, messages stay **Queued** and the UI explicitly says email delivery is not configured. No real customer email is sent by the test suite. Apply migration `0003_customer_portal.sql` before deploying this version.
