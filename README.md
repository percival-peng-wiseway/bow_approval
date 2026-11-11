# BOW OA

An approval workspace for corporate reimbursements, project expenses, and project service purchases. The interface is in English and amounts are in AUD. It runs locally on Node.js or on Cloudflare Workers with D1, private R2 attachments, and a separate OCR Container.

## Features

- **Home:** a single Request entry point and a list of items requiring attention.
- **Company Expenses:** PM, Admin, Finance and Directors can submit an expense name, amount, date and receipt. Admin and Finance both approve, then Finance records payment. No supervisor step.
- **Project Workspace:** reimbursements go through PM then Finance. Amounts strictly above AUD 2,000 create a separate Director acknowledgement task without blocking payment. Projects also track the paying entity, optional budget and commitments.
- **Service purchases (v2):** optional customer confirmation; Director and Finance budget/supplier approval; requester contract preparation; Finance contract review; executed-contract recording; invoice ABN and supplier-detail review; independently verified invoice payment details; payment milestones with PM verification. Final and retention payments additionally require Director acceptance.
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

Supplier selection no longer requires a contract or ABN check. Once Director and Finance approve the chosen supplier, the request moves to **Contract preparation** and the requester uploads the service contract. The requester can enter or correct the supplier ABN and select **Check official ABN**. PDF and image contracts use the existing OCR service; text contracts are read directly. The server queries the official ABN Lookup service for registered/business names, ABN status and GST registration.

A matching active supplier is marked **ABN checked**. Missing identifiers, unreadable documents, unavailable lookups, name mismatches, inactive ABNs and missing GST registration are marked **Needs review**. Finance sees the saved findings and requester notes alongside the contract. Checks are optional while the manual review flow is available; unverified contracts are clearly labelled and never shown as checked. These are identity checks, not bank-account verification.

Checks are bound to the requester, request, supplier name and contract file hashes. Changing the supplier or contract requires another check; checks expire for submission after 24 hours. Existing approved requests are preserved.

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

The login page offers **Staff version** and **Customer version**. Customers sign in at `/#customer` with their own username and password; email setup is not required. Admin creates a customer under **Customers**, chooses **Set password**, and assigns projects in **Project settings**. Usernames are case-insensitive and unique across staff and customer accounts. Passwords have a minimum of six characters. Login records contain salted scrypt hashes, separate from workspace records. Pending credential invitation emails hold an encrypted copy until delivery or cancellation. Password resets invalidate existing sessions. Deactivating a customer blocks project/document access and password login. Sessions expire after 12 hours.

Admin can also open a project and select **Invite customer**, enter a customer email and company, set the username/password, and queue an invitation in one step. Reinviting an existing customer resets their login across all assigned projects; the form explains this before submission. Invitation retries with the same invitation ID do not create another account or reset the password again. Password changes, customer deactivation and project access changes invalidate queued credential invitations. Pending invitations expire after seven days.

The optional legacy email-link API remains supported: invitation links expire in 72 hours and requested sign-in links expire in 15 minutes. The standalone `/#customer-demo` route still provides fictional projects in browser memory; it does not call workspace APIs, send mail or change real requests.

The phone layout uses a collapsible navigation drawer, full-width request lists, a separate request detail view with a back button, and bottom-sheet forms. Customer service rows retain inline details and confirmation controls on narrow screens.

New service requests default to internal Director / Finance approval. Select **Notify customer and request confirmation** to enable the customer-first flow for that request (an active project customer is required):

1. Customer reviews the scope, background, approach and estimated budget.
2. Confirmation releases the existing Director and Finance pre-approval flow. A decline or change request returns the item to the applicant.
3. Supplier quotes receive dual internal approval. The requester then uploads the selected supplier’s service contract for Finance review before staged payments can be planned. When customer confirmation is enabled, an increased supplier budget needs a fresh customer confirmation before further internal approval.
4. Completed services appear in the customer's archive. The project team uses **Publish completion** to share a completion summary and selected documents.

Customer responses are versioned; edits and withdrawn pending confirmations require a new response while customer confirmation is enabled. Withdraw and edit a request to change this choice; disabling it archives the previous response and cancels any obsolete confirmation mail. Existing requests retain their routing until edited. Customer ownership cannot be changed after a project has shared service requests. Existing projects without a customer retain their current approval flow. Once a customer is assigned, their portal includes non-draft engineering service summaries and progress, including existing services. Existing services are shown for information; they do not gain a new approval gate merely because a customer was invited.

Customers receive a separate, server-filtered portal. Internal workspace APIs, reimbursements, supplier quotes, ABN findings, approval notes and payment receipts are inaccessible. The project team can use **Share contracts with customer** on a service to select files from the chosen supplier’s contracts, add a note, or revoke access by unchecking all files. Only explicitly shared contracts and published completion files are downloadable by the assigned active customer.

### Email delivery

The initial adapter uses Resend's HTTPS API. Configure a verified sender in `EMAIL_FROM` and an API key in the server-only `RESEND_API_KEY` secret. `PUBLIC_APP_URL` is set independently for QA and production in Wrangler; set it for local email testing if needed. Local `npm run dev` loads the ignored `.env` file; copy `.env.example` to start. The agreed sender is `BOW OA <notifications@wiseway.ai>`. The domain must be verified in Resend before delivery. A localhost URL is only usable on the development computer: set a public HTTPS `PUBLIC_APP_URL` before inviting remote customers. Do not commit secrets or put keys in browser code.

```sh
npx wrangler secret put RESEND_API_KEY --env QA
npx wrangler secret put EMAIL_FROM --env QA
npx wrangler secret put RESEND_API_KEY --env prod
npx wrangler secret put EMAIL_FROM --env prod
```

Local invitation passwords are encrypted using AES-GCM and a private automatically generated `.local/customer-mail.key`. Cloud environments need a separate `CUSTOMER_MAIL_KEY` secret containing 64 random hexadecimal characters before credential invitations can be created. Keep this key while encrypted messages remain pending; do not commit it. Delivered or cancelled invitations remove the encrypted password. Admin mail APIs omit both plaintext email bodies and encrypted credentials.

Pending confirmations generate durable outbox records. Invitation and sign-in links are stored only in private email payloads, and token hashes are used for redemption. Background processing sends queued notifications when configured. Expired or superseded notices are cancelled. Failed messages remain visible to Admin and can be retried within the provider's idempotency window using their original message ID. An accepted API response is labeled **Sent to provider**, not delivered to the inbox. Delivery/bounce webhooks are not configured.

Without sender credentials, messages stay **Queued** and the UI explicitly says email delivery is not configured. No real customer email is sent by the test suite. Apply migration `0003_customer_portal.sql` before deploying this version.


## Requester contract preparation and Contract AI (local)

New service requests capture `serviceFlowVersion: 2`. New requests also capture `invoiceFlowVersion: 1` for the invoice-before-payment gate. Existing service requests without these markers keep their original route and are not migrated automatically.

1. In **Project settings**, set the paying legal entity and optionally a project budget. The service request copies the entity and records a cost code.
2. The requester describes the scope, deliverable and estimated budget. If customer confirmation is selected, the customer confirms before internal Director + Finance pre-approval.
3. The requester compares supplier proposals and marks a Preferred option. Finance and Director approve the supplier. Final selection remains explicit; selecting another supplier restarts approval.
4. The requester uploads the contract and optionally checks it with AI/ABN Lookup. Finance reviews it. The requester then uploads the executed agreement, signatory, actual signing date and optional defects period end. This records an external signing; it does not provide electronic signatures.
5. After signing, the requester uploads a **Supplier invoice**, runs **Check invoice ABN**, and enters its supplier identity, payment details, amount and dates. Finance reviews the invoice. A contract/invoice ABN mismatch blocks approval; unresolved lookup findings require a recorded Finance resolution. Approval saves the invoice supplier details and their source in **Suppliers**. Supplier credit and reputation screening is deferred; an ABN result is not a credit check.
6. Finance records independent verification of the payment destination using a trusted contact or supplier portal, then schedules the unpaid contract balance. Types are **Deposit / advance**, **Progress**, **Final**, and **Retention**. Only retention can follow a final milestone.
7. For each payment, the requester selects a Finance-approved invoice and provides delivery or advance-payment evidence. The same invoice can support multiple instalments up to its available total. New invoices go through ABN and Finance review first. Changed bank details invalidate prior payment verification. The PM verifies each milestone. A PM applicant is routed to an independent Director instead. Final/retention milestones additionally require Director acceptance before Finance review and payment recording. Contractual invoice due dates override planned dates in payment reminders. Response deadlines are recorded for manual monitoring, not calculated by a jurisdictional rules engine.
8. Full payment by advance/progress alone does not complete the service. The requester provides completion evidence, PM verifies it and Director signs off. Explicit customer publication remains a separate action.

After signing, use **Request variation** while awaiting payment setup or payment documents. Each variation records scope, price change (including reductions), time impact and evidence. For customer-confirmed services, attach separately obtained written customer consent. Finance and Director both approve; the requester records the signed variation. Original contract value and paid evidence are retained, the previous payment plan is archived, and Finance schedules only the revised unpaid balance. This initial version records written customer consent for variations; it does not send a separate portal approval invitation.

Project commitments include executed service contracts/variations and submitted reimbursements. Legacy services without signing records are excluded. Budget availability is informational and does not yet block overspending. Formal termination of an executed contract is not implemented, so ordinary Withdraw/Cancel controls are unavailable after signing. AI extraction never changes approved budgets, bank-verification attestations or payment plans automatically.

Admin can open **Settings → Contract AI → API settings** to save an OpenAI API key, choose a model (default `gpt-6-luna`) and enable analysis. The key is stored in `APP_DATA_DIR/ai-settings.json` (default `.local/ai-settings.json`) with `0600` permissions. The settings API returns configuration metadata only; keys are excluded from the shared workspace, public assets and exports. Blank key input preserves an existing key; **Remove saved API key** removes it. Configuration is local only; no cloud release or cloud key provisioning is included.

The requester’s **Check with AI** button sends the chosen PDF, image or text contract files to OpenAI’s Responses API with `store: false` and a strict structured-output schema. The report includes supplier identity/ABN, payment terms, milestones, payee information, deliverables, buyer-side review points, evidence references and uncertainties. It is a review aid, not an official ABN registration check, legal advice or payment authorization. An identified ABN triggers official verification after the AI check; the manual **Check official ABN** action remains available. Results are tied to the requester, request, selected supplier and exact file hashes; changed files cannot reuse an old report. Missing keys, failed requests and invalid responses produce an explicit error, never a simulated report.

Without an API key, requesters can still upload, save and submit contracts for manual Finance review. AI integration tests use synthetic provider responses; a real model response must be verified after an API key is configured. No Langfuse tracing service is configured and no contracts are sent to it.

References: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Local admin delegation

The dedicated `admin` account can select **Act on behalf** in the header to work as an active internal staff member. Selecting `admin` returns to management mode. The selection is per tab and resets on reload or sign-out. Other Admin accounts cannot delegate. Customer identities are not available in this selector.

Delegated operations still follow the selected person's assignments, current approval stage and existing validation rules. Successful workspace operations retain the selected actor and add `performedBy: admin` to new history entries plus a workspace admin audit entry. Delegated POST attempts/results are also recorded in the private `admin-actions.jsonl` file without request bodies or credentials. Workflow edits remain saved proposals until separately connected to live approval rules. This delegation implementation is local only.

## Workspace review and task management

Home groups work into **Needs your action**, **Waiting for others**, **Returned**, and **Completed**, with the responsible people, next task, and upcoming/overdue instalments. Service overviews summarize the approved budget, selected quote, contract amount, ABN check state, and extracted bank details. Missing bank details display **Not found**. The detailed AI report is expandable under **Quotes & contracts**; extracted values do not create payment instructions.

Returns recorded from this version onward retain the reviewer, reason, and a baseline of relevant fields. Resubmission adds **What changed**, including replaced files. Historical returns remain in Activity. The document register includes current and earlier contracts, quotes, invoices, acceptance evidence, and payment receipts, with customer sharing status. Payment checklists distinguish supporting documents, Director acceptance for the final instalment, Finance approval, and an actual recorded payment.

**Project → Customer Access → Manage access** controls budgets for informational updates, explicitly shared contracts, and completion reports/files. A customer confirmation always includes the amount being confirmed. These settings are enforced in the server-side customer projection and file authorization. Internal notes and extracted banking information are never added to that projection.

**Settings → Notifications** stores each staff member's email preferences. Email is opt-in; Home remains available without email setup. Action, return, and seven-day/overdue payment notices use durable, deduplicated outbox records. Obsolete tasks and disabled preferences cancel queued notifications. Staff can see and retry only their own failed reminders. Resend still requires the server-side configuration described above; tests use an injected sender and never send real mail.

**Settings → Approval workflows** keeps draft revisions, confirmation metadata, and version history. **Confirm design** marks a saved, structurally valid proposal as confirmed for later implementation. It does not activate a workflow engine or replace the implemented approval rules (service v2 for new service requests). New submissions record their execution version and routing snapshot. Existing requests keep their current state. D1 workspace metadata preserves saved designs and notification preferences alongside separately stored entities.

Admins can open **Customers → View customer portal**, or use the same button under a project's **Customer Access** tab. The real customer portal opens as **Admin preview · Read only**, using the same server-filtered project and document visibility as the customer. **Back to workspace** returns to the staff session. Previewing does not impersonate the customer, submit a decision, send an invitation, or change the request state.

## Launch controls

See [release readiness](docs/LAUNCH_READINESS.md) for the current approval thresholds, staff access, account security, provider setup and release gates. Staff accounts and password changes are available in Settings. Assign project members before employees submit project expenses.

For cloud contract AI, configure `OPENAI_API_KEY` as a Cloudflare Secret and enable the model in Settings → Contract AI. Run migrations through `0004_launch_controls.sql` before the new Worker. Production provider secrets are not copied from local configuration.

`npm run check:release` verifies migrations and public assets. `npm run backup:cloud -- QA /private/new-backup-folder` creates a D1 + R2 backup; `npm run restore:isolated -- /private/backup /private/new-restore` verifies recovery without modifying any remote environment. These commands contain no automatic production deployment or overwrite.
