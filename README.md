# Valmo — Captain Self-Serve Onboarding Prototype

A clickable prototype of Valmo's captain self-serve onboarding, covering **two roles with
two different journeys**: the existing **LM Captain** flow (9 phases, as designed) and the
new **FM Captain** flow (7 phases, which diverges after role selection).

Everything is one file. Open `index.html` in a browser — no build step, no server, no
dependencies. All CSS and JS are inline and the Valmo logo is embedded as a data URI.

```bash
open index.html
```

**Design source:** Figma file
[`Self-serve captain onboarding`](https://www.figma.com/design/T6DMr5qro6WZS908w41Qc9/Self-serve-captain-onboarding),
page *First time user flows* (`0:1`) — 58 captain-facing frames. Colours, spacing,
typography and component styling are taken from the frames themselves rather than
approximated.

---

## Running it

| | |
|---|---|
| Open the prototype | `open index.html` |
| Run the tests | `npm install && npm test` |

Demo OTP is `000000` everywhere (login, email verification, DigiLocker).

Progress is persisted to `localStorage` under `valmo.captain.onboarding.v1`. Use
**Reset entire demo** in the dev panel to clear it.

---

## The two flows

### Shared entry

Login (phone) → OTP (6 cells, resend countdown, lockout after 3 wrong attempts) → role
selection.

The role selection screen splits roles into **Active** and **Inactive** sections. Each role
carries its own onboarding state, so a role in flight shows *Continue onboarding* with its
step number, and a completed role moves up to *Active roles*. **⇄ Switch role** in the rail
returns you to the picker mid-flow and resumes exactly where you left off.

### LM Captain — 9 phases

```
Personal details → KYC → Background verification → Cluster Head review
→ Security deposit → Hub details → Area Manager verification → Agreements → Activation
```

### FM Captain — 7 phases

```
Personal details → KYC → Background verification → Cluster Head review
→ Hub details → Agreements → Activation
```

The shared phases reuse the same screens and components. The differences below are
deliberate product decisions, not gaps in the build.

---

## FM-specific decisions

**1. No security deposit phase.** FM hubs don't take one.

**2. No standalone Area Manager phase.** The AM still does the work — hub category, hub
design, lat-long, mapping — but it happens in a separate system outside the captain-facing
flow, so it isn't a step the captain waits on as its own screen.

**3. KYC differs in four ways.**

| | LM | FM |
|---|---|---|
| GST | Optional toggle — *Non-GST* is a valid, complete answer | **Mandatory.** GSTIN required |
| MSME registration certificate | — | **Required upload** |
| Cancelled cheque | Optional upload | **Not collected** — the ₹1 penny-drop already proves the account |
| Continue enabled when | Aadhaar + PAN + bank + GST status | Aadhaar + PAN + bank + GST + MSME, all five |

**4. Hub category is an Area Manager input, never a captain field.** Cluster Head review
blocks on a *waiting on hub classification* state until the AM sets it. Once set, it is
shown read-only next to the benchmark ceiling it drives.

**5. Cluster Head review includes rate card approval against a benchmark ceiling**
determined by that hub category:

| Category | Ceiling (₹/shipment) | Touchpoint rate |
|---|---|---|
| Standalone (mini-hub) | 3.2 | ₹6 |
| Standalone | 5 | ₹5 |
| LM-as-FM | 6 | ₹6 |
| Mall hub | 2 | ₹2 |
| SAH (seller as hub) | 1.5 | ₹1.5 |

A rate **within** the ceiling clears at Cluster Head. A rate **above** it escalates to the
**Zonal Head**, who gets their own contact card and approve/reject states.

Two rate card modes:

- **Combined** — one blended *slab rate + touchpoint* figure for the hub.
- **Split** — the pilot gets slab rate + touchpoint as its own line; the captain gets the
  slab rate net of the pilot's per-shipment cut.

> ⚠️ **The captain-side split formula is not confirmed.** It is rendered in the UI with an
> explicit *"indicative — formula being confirmed"* caveat and is deliberately **not**
> implemented as a hardened calculation: it uses a visible placeholder cut, doesn't gate
> anything downstream, and carries copy telling the reader not to quote it to a partner.
> Swap `indicativeCaptainSplit()` for the real formula once payouts confirm it.

**6. Hub details submission does not generate a hub code for FM.** It confirms submission
and tells the captain the code is finalised later. (LM still mints its hub code at submit.)

**7. Activation differs.**

- **No Oracle vendor ID.** An internal **Partner ID** is created instead, and auto-payouts
  key off that.
- Fan-out is: *Design & hub-code mapping → Partner ID → Captain Service → UMS → Agreement
  store → Payout profile*.
- **Design & hub-code mapping** is a passive checklist item standing in for work done by a
  separate system fed by the AM's survey.
- **The FM hub code is generated when that checklist item completes** — not at hub details.

**8. Seller-to-hub mapping is out of scope** and appears nowhere in the flow. It's handled
by a different system. (The *SAH — seller as hub* category name is unrelated; that's a hub
classification, not a mapping feature.)

### Shared behaviour worth calling out

**Serviceable pincodes take a pasted list.** Rather than adding one at a time, a captain
can type or paste several — separated by commas, semicolons, slashes or whitespace — and
they are added in one action. Pasting a separated list adds it immediately without pressing
*Add*. Partial success is the normal case and is reported by reason, for example
*"Added 3. Skipped 1 not a valid pincode (notapin); 1 already added."* — shown in amber
rather than red, because some entries did land. The 5-pincode cap still holds, and adding
any new pincode clears a previous availability result so a stale one can't be carried
forward.

**Hub details captures the facility spec**, for both roles:

| Field | Validation |
|---|---|
| Area of the hub (sq ft) | integer, 100–1,000,000 |
| Estimated manpower | integer, 1–5,000 |
| Vehicle types the location can accommodate | at least one of the 24 listed types; several can be chosen |

All three are required to submit, and they appear in the submitted summary alongside the
address. For FM these are the inputs that feed the Area Manager's survey and, through it,
the hub categorisation that sets the benchmark ceiling.

Vehicle types are a **multi-select** — a hub can usually take several sizes, so the picker
is a chip grid with *Select all* and *Clear selection*, and the selection is stored in list
order rather than click order. The original requirement asked for the hub's *max* vehicle
size; rather than ask for that separately, it is **derived** from the selection by parsing
the tonnage out of each type name (`vehicleTonnage` / `largestVehicle`), shown live in the
picker header and recorded as *Max vehicle size* in the summary next to the full list. A
saved single selection from the earlier one-dropdown shape is migrated into the array on
load.

> **On the vehicle list:** the supplied list had 25 entries, two of which —
> `0.8MT_4W_TataAce` and `0.8MT_4W _TataAce` — are the same vehicle, the second carrying a
> stray space before the underscore. `dedupeVehicles()` collapses them on normalised
> whitespace and keeps the clean spelling, so the dropdown shows 24 distinct options rather
> than two that look identical. The raw list is kept in `VEHICLE_TYPES_RAW` so the
> collapsing stays visible and testable; if that second entry is genuinely a separate
> vehicle, correct it there.

### LM behaviour worth calling out

- **Area Manager two-strike rule** — one rejection sends the captain back to reconfirm hub
  details; a second rejection auto-escalates the case to the Cluster Head, and it leaves
  the AM entirely.
- **Agreements** — the accept checkbox stays disabled until the service agreement has been
  scrolled to the end. Rate card and service agreement are accepted separately and stored
  separately for audit.
- **Activation** fans out to VLS, OpsTech, Captain Service, UMS, Agreement store and Payout
  profile, with the Oracle vendor ID created via VLS.

---

## Why the dev panel exists

There is a floating **⚙ Simulate backend** panel, bottom-right, collapsible.

Onboarding is not a single-actor flow. Half the state transitions belong to people the
captain never sees: a Cluster Head approving a rate card, an Area Manager classifying a hub
or failing a facility check, a Zonal Head ruling on an above-benchmark rate, a payment
gateway timing out. Without something standing in for them, most of this prototype is
simply unreachable — you would get as far as "Cluster Head review in progress" and stop.

The panel is contextual to the current phase and exposes exactly those actors:

| Phase | Simulated actions |
|---|---|
| Background verification | mark passed / mark failed |
| Cluster Head (LM) | approve / reject |
| Cluster Head (FM) | set hub category (one button per category), then approve combined / approve split / submit above benchmark → escalate to ZH / reject |
| Zonal Head (FM, once escalated) | approve as ZH / reject as ZH |
| Security deposit (LM only) | force success / failure / quote expired |
| Area Manager (LM only) | approve / reject (two-strike counter shown) |
| Agreements | mark agreement scrolled to end |
| Activation | force failure / force success |
| Always | reset entire demo |

Every reject path is reachable and routes the captain back to the right earlier phase to
fix and resubmit.

### A note on the admin screens

The brief for this build said the admin-side consoles referenced at page `109:2` had no
design. **They do exist** — that page is called *Admin Panels · Onboarding Approvals* and
holds 25 frames (`ch-detail`, `ch-reject`, `am-detail`, `am-vls-missing`, `am-reject`,
`zh-sd-detail`, panel selection, per-role request lists, user mapping, and geo-binding for
area/cluster/zone).

That doesn't change this prototype — it is captain-facing, and the dev panel is still the
right way to drive backend state from a single self-contained file. But if the intent was
to build those consoles for real rather than simulate them, the designs are there to
build from.

---

## Tests

`test.js` drives the real app in jsdom — no mocks of the app's own logic.

```bash
npm install && npm test
```

**271 assertions across 11 groups:**

1. **LM Captain** — full 9-phase walk, hub code at submit, Oracle vendor ID, 6-target fan-out
2. **FM Captain** — 7 phases, combined mode within benchmark; asserts no SD phase, no AM
   phase, mandatory GST, MSME required, no cheque upload, no hub code at submit, Partner ID
   instead of vendor ID, hub code issued at activation
3. **FM escalation** — split mode, above benchmark → ZH reject → resubmit → ZH approve,
   plus the caveat rendering and the CH reject/resubmit path
4. **Role independence** — LM parked mid-flow is byte-identical after a full FM run; both
   subtrees round-trip through localStorage; resume lands on the right phase
5. **Validation** — pincode format, duplicate, max-5, PAN, IFSC, GSTIN, map link, hub
   address, email, email-OTP lockout, login-OTP lockout, with the error copy asserted
5b. **OTP entry** — focus survives the resend countdown; six keystrokes land in order via
   the app's own auto-advance; SMS-autofill/paste of a full code into one cell spreads
   across all six; partial paste fills forward from the focused cell
6. **LM two-strike rule** — first rejection routes back to hub details, second escalates
7. **Benchmark ceilings** — all five categories, ceiling and touchpoint rate
8. **Dev panel** — every simulated actor reachable, every reject path has a route out
9. **Bulk pincode entry** — comma/semicolon/slash/whitespace separated input, partial
   success reporting, within-batch duplicates, the 5-pincode cap, stale-availability reset,
   and paste-to-add
10. **Hub facility inputs** — vehicle list de-duplication, all 24 options rendered in
   order, multi-select with toggle-off, select-all/clear, tonnage parsing and largest-type
   derivation (including the 10MT-vs-9MT case a string compare gets wrong),
   area/manpower/vehicles required, range and membership validation, values preserved on a
   rejected submit and prefilled on reopen, captured for both roles

Three notes on how the tests drive the app:

- `markAgreementRead()` stands in for scroll-to-end, because jsdom has no layout and
  therefore no real `scrollHeight`. The test separately asserts the checkbox is disabled
  before and enabled after.
- Activation fan-out runs on real timers; the tests wait for it rather than stubbing it.
- The harness awaits the app's own `DOMContentLoaded` boot before driving anything. jsdom
  fires that after the constructor returns, so without the wait the app's boot lands
  mid-test and re-renders the DOM out from under whatever is being driven.

### Two bugs this suite was extended to cover

Both were found by driving the deployed build in a real browser, not by the original suite:

1. **The resend countdown made the OTP field untypeable.** The 1-second tick called a full
   `render()`, replacing `app.innerHTML` and dropping focus to `<body>`. The tick now
   patches only the countdown text. The original tests missed this because they set each
   cell's `.value` on a freshly-queried element and never depended on focus surviving.
2. **SMS autofill and paste dropped five of six digits.** The input handler took
   `slice(-1)` of the cell's value, so a full code arriving in one cell kept one digit.
   Multi-digit input now spreads across the remaining cells, and there is an explicit
   `paste` handler.

---

## File layout

```
index.html   the entire prototype — inline CSS + JS, embedded logo
test.js      jsdom walkthrough of both flows
package.json jsdom dev dependency + `npm test`
```

`window.__APP__` exposes `state`, `actions`, `validate`, `config` and `helpers` for the
tests and for poking at the prototype from the console.
