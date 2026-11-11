# BOW OA — Xero UI reference

Prepared 6 November 2026 for a local BOW OA design iteration.

## Evidence and scope

The reference is Xero's public product documentation and published interface imagery. It is not a capture of an authenticated Xero organisation.

| Source | Evidence used | Boundary |
| --- | --- | --- |
| [Introducing a new bills experience in Xero](https://blog.xero.com/product-updates/bills-to-pay-refresh/) | Historical bills-list imagery; status tabs; visible search and date/filter controls; a green **New bill** action on the right; table rows and overflow actions. | Published in 2022 and updated in 2023. It establishes that documented design, not the complete current Xero application. |
| [Introducing a fresh, full-page experience for your bills](https://blog.xero.com/uk/product-updates/bills-full-page-experience/) | The 31 July 2026 update describes full-page bill details, optional Quick View from the list, and actions for progressing through bill review. | A published rollout description. Availability in a particular customer account was not verified. |

REA evidence bundle: [`evidence/xero-ui-2026-11-06.json`](../evidence/xero-ui-2026-11-06.json).

Successful REA observation: `ev_445fc5313c3229421740a935ff0bb9d980aa16d546d5d21e38ada2068c6eba65` (`capture_browser_scenario`, controlled replay, observed). REA launched a temporary Chromium process, opened the historical bills article, waited for the selected page element, and retained the requested DOM capture. The record reports complete requested coverage and termination of the owned process. This is evidence of the public reference page, not exercised accounting or approval behaviour. An earlier capture with an ambiguous wait selector failed and is not used as successful validation.

## Design mapping

The following are BOW design choices informed by the evidence, rather than claims that Xero implements BOW's workflows.

| Area | BOW OA application |
| --- | --- |
| Lists | Use aligned headers and rows for requests, projects, suppliers, customer projects, documents, services, and payments. Put names and references first; align monetary values consistently. |
| Search and filters | Keep search visible above the register. Group status, date, and other filters in a predictable toolbar, with the current scope clear. |
| Actions | Place the primary creation action at the right of the page heading. Use a consistent primary button, outlined secondary buttons, and quieter text actions. Keep destructive actions distinct. |
| Request details | Keep full-page review with a clear title, status, amount, creator, next owner, and associated actions. Preserve natural page scrolling and access to documents, payment records, and approval history. |
| Forms | Use aligned labels, consistent control heights, restrained borders, and a clear footer containing Cancel, Save draft where supported, and Submit. Creating inside a project remains bound to that project. |
| Customer portal | Present assigned projects and services as lists. Keep confirmation controls only where the existing customer permission and workflow allow them; Admin preview remains read-only. |
| Mobile | Retain readable type and usable touch targets. Allow tab navigation to scroll; convert wide data presentation into labelled rows or a bounded table scroll area rather than shrinking text. |

## Preserved boundaries

- BOW OA name and logo remain; no Xero branding is copied.
- Existing approval routes, project context, supplier/ABN data, contract review, payment rules, and account permissions remain authoritative.
- Visual reference work does not add bulk approvals, payments, or other unimplemented accounting actions.
- Work is local only. No production release is implied.
- Authentication-dependent Xero interaction details remain unverified. BOW build, regression, desktop, and mobile verification must be reported separately after implementation.

## Local validation — 6 November 2026

- JavaScript syntax checks passed for main, business, customer and supplier UI modules; `npm run build` passed.
- Existing automated suite: 109 passed, 0 failed. The first sandboxed attempt could not bind temporary loopback ports; the permitted local rerun passed.
- Browser checks: project register; request register and date filter; custom date dialog; service details; supplier document register; completed reimbursement payment table and expanded evidence; Customers to read-only customer portal; Settings workflow editor controls.
- Project-context creation still displays the selected project without a project selector. Mobile service form footer stays within the viewport (390 × 844, footer bottom 832).
- Responsive inspection at desktop default, 1024 × 900, and 390 × 844. Mobile rows reflow to labelled list entries; tab strips can scroll horizontally. The page itself does not overflow horizontally in the inspected tablet/mobile states.
- No request, approval, payment, invitation, customer decision or workflow design was submitted during browser validation. No production deployment or Git push.

Implementation uses `app/xero-inspired.css`, loaded after the component stylesheet, plus list markup in the existing UI modules. The reference does not imply feature parity with Xero: bulk approval, accounting integrations and Xero Quick View were not added. Existing BOW approval rules, customer access, ABN/AI behaviour and payment execution semantics remain in place.
