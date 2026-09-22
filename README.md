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
[`Self-serve captain onboarding`](https://www.figma.com/design/T6DMr5qro6WZS908w41Qc9/Self-serve-captain-onboarding)
— page *First time user flows* (`0:1`, 58 captain-facing onboarding frames), page
*Logged-in · Profile & Hubs* (`96:2`, 17 frames) and page *Admin Panels · Onboarding
Approvals* (`109:2`). Colours, spacing, typography and
component styling are taken from the frames themselves rather than approximated.

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

### Logging in

The dev panel's **Log in as** switch on the login screen decides which journey you get:

- **New captain · no hubs yet** → role selection → full onboarding, as designed.
- **Existing captain · 3 hubs** → straight into the **Captain Hub**, with the three hubs
  from `HB-01` already seeded (two active, one inactive).

Onboarding always ends by creating a hub the captain then owns, so a new captain who
completes a flow lands in the same Captain Hub with one hub.

### LM Captain — 9 phases

```
Personal details → KYC → Hub details → Background verification → Cluster Head review
→ Security deposit → Area Manager verification → Agreements → Activation
```

### FM Captain — 7 phases

```
Personal details → KYC → Hub details → Background verification → Cluster Head review
→ Agreements → Activation
```

**Hub details sits before background verification.** The facility is described up front, so
everything downstream has something to work from — in particular the Area Manager's survey
and, for FM, the hub categorisation that sets the rate ceiling at Cluster Head review.

Two things follow from the order, and both are handled rather than left to break:

- **An Area Manager rejection still returns to the Area Manager.** Hub details is now early
  in the flow, so reopening it from an AM rejection and resubmitting jumps straight back to
  the AM instead of walking the captain forward through background verification, Cluster
  Head review and the deposit a second time.
- **Continue-button labels are derived from the phase list**, not hardcoded, so reordering
  phases cannot leave a button pointing at the wrong screen. Each phase carries an explicit
  mid-sentence name (`lc`) because lowercasing the title produced *"cluster Head review"*
  and *"area Manager verification"*.

The shared phases reuse the same screens and components. The differences below are
deliberate product decisions, not gaps in the build.

---

## FM-specific decisions

**1. No security deposit phase.** FM hubs don't take one.

**2. No standalone Area Manager phase.** The AM still does the work — hub category, hub
design, lat-long, mapping — but it happens in a separate system outside the captain-facing
flow, so it isn't a step the captain waits on as its own screen.

### KYC is one record at a time

Both roles walk KYC as a sequence, matching `KYC-01`…`KYC-14`: **Aadhaar → PAN → bank →
GST**, each on its own card, with a confirmation screen between them rather than one long
scrollable form. The Aadhaar confirmation shows the record fetched from Aadhaar (name, date
of birth, address); the bank step carries a read-only *account holder name* filled in after
the penny-drop; GST is a two-way radio where the GSTIN field appears only once *GST
registered* is chosen. The final card (`KYC-14`) summarises all four, and each row there can
be reopened and redone individually.

**3. KYC differs in four ways.**

| | LM | FM |
|---|---|---|
| GST | Optional toggle — *Non-GST* is a valid, complete answer | **Mandatory.** GSTIN required |
| MSME registration certificate | — | **Optional upload** |
| Cancelled cheque | Optional upload | **Not collected** — the ₹1 penny-drop already proves the account |
| Continue enabled when | Aadhaar + PAN + bank + GST status | Aadhaar + PAN + bank + GST |

MSME is collected for FM but does not gate anything: the block is labelled *Optional*, GST
is the only starred requirement, and the summary records the certificate as *Not provided*
rather than claiming an upload that never happened. Because the required items can complete
without it, the card flips to its summary while MSME is still outstanding — so the upload
stays available there too, otherwise it could never be attached at all. It is likewise not
carried over when adding a second hub, since there may be nothing to carry.

**4. Hub category and its rate ceiling are never shown to an FM captain.** Not at Cluster
Head review, not in the application summary, not in the rail's phase label, not on
agreements — and not even the word *ceiling* on an escalated rate. The captain sees the
touchpoint rate and the proposed rate; the classification that produced them, and the
threshold it sets, stay internal.

The mechanics are unchanged underneath: the category is still an Area Manager input, it
still determines the benchmark ceiling, and a rate above the ceiling still escalates — to
the Cluster Head, and from there to Central Admin. Only the narration is gone. An escalated
request tells the captain the rate *needs sign-off*, not why.

**5. The rate card is approved against a benchmark ceiling** determined by that hub
category:

| Category | Ceiling (₹/shipment) | Touchpoint rate |
|---|---|---|
| Standalone (mini-hub) | 3.2 | ₹6 |
| Standalone | 5 | ₹5 |
| LM-as-FM | 6 | ₹6 |
| Mall hub | 2 | ₹2 |
| SAH (seller as hub) | 1.5 | ₹1.5 |

A rate **within** the ceiling clears at Cluster Head. A rate **above** it the Cluster Head
cannot settle at all — it goes to **Central Admin**. Neither case is annotated on the
captain's screen: the rate is shown as a plain figure, because the ceiling it is being
measured against is not something the captain is shown.

The ceiling table above describes internal behaviour and the dev panel, not anything the
captain reads.

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

**The first three phases can be stepped back through.** Personal details, KYC and hub
details all carry a *← Back* control naming the page it returns to, and captured values are
still there and still editable. A verified KYC item is reopened individually — *Edit KYC
details* brings the blocks back, and *Edit* on any one of them clears just that item's
verified flag while keeping its values, so the form prefills and Continue re-gates until it
is verified again. A submitted hub can be reopened the same way. Back stops at hub details:
past that the flow has handed off to background checks and Cluster Head review, so there is
nothing the captain can usefully edit.

**Hub details captures the facility spec**, for both roles:

| Field | Validation |
|---|---|
| Area of the hub (sq ft) | integer, 100–1,000,000 |
| Estimated manpower | integer, 1–5,000 |
| Max vehicle size the location can accommodate | one of the 24 listed types |

All three are required to submit, and they appear in the submitted summary alongside the
address. A **photo of the location is optional** — the button sits inside the Google Maps
link field, beside the input, and an uploaded image renders as a small thumbnail with its
file name, click-to-enlarge, and Remove. It is stored as a data URL downscaled to 640px via
canvas, because a full-size phone photo would exhaust the `localStorage` quota on its own.
Files that are not images, are too large, or do not decode are refused with a reason rather
than stored as a broken thumbnail. For FM these are the inputs that feed the Area Manager's survey and, through it,
the hub categorisation that sets the benchmark ceiling.

Vehicle size is **one input**: the captain picks only the largest vehicle the hub can take,
and everything smaller is assumed to fit. The field stays one row tall and opens a panel on
click — a search box over a list ordered smallest capacity first, each row showing its rated
tonnage. Picking a row sets the max and closes the panel; there is nothing else to tick.

The "and all smaller" rule is made visible rather than left implied. The chosen row is
marked **max**, every row below it is tinted and marked **fits**, and rows above show only
their tonnage — so the cut-off is legible at a glance. The footer and hint state the count
(*"13 smaller types also fit"*), and the submitted summary records both the max and how
many smaller types it covers.

**Capacity order comes from the supplied list, not from parsing tonnage.** The order settles
cases tonnage alone cannot — `3.5MT_4W` ranks below `3.5MT_14FT`, and `6MT_4W_TataAce` above
`5MT_17FT` — so a type's index in `VEHICLE_TYPES` *is* its capacity rank (`vehicleRank`),
and `impliedVehicles` / `smallerThan` slice from it. An earlier saved multi-select collapses
to its largest entry on load.

The dropdown panel is patched in place rather than re-rendered — the same reason the OTP
countdown is: a full `render()` would replace the search input and drop focus mid-typing.

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

## Captain Hub — the logged-in area

Figma page `96:2`. A separate surface from onboarding: 1280-wide with its own dark sidebar
(Valmo Support, Home, Payments, Loss Management, Incentive Center), a user card showing the
active hub code, and Log Out pinned to the bottom.

**My Profile › Personal Details** (`PR-01`) shows the KYC record — masked Aadhaar and PAN —
stated as captain-level and *shared across all your hubs*, plus the payout bank account.
Changing the bank account runs the full designed journey (`PR-02`…`PR-08`): OTP challenge →
wrong code → lockout after three → new account form with account/IFSC/holder validation →
₹1 penny-drop → failure → retry → updated. The penny-drop outcome is a dev-panel action.

**My Profile › My Hubs** (`HB-01`) lists the hubs the captain owns, grouped Active /
Onboarding in progress / Inactive. Each hub carries its own code, address, role and **its
own GST registration** — one hub can be GST-registered while another is Non-GST. Per-hub
GSTIN management is the designed flow (`HB-02`…`HB-06`): add, update, reject an invalid
GSTIN, and remove behind a confirmation.

**Add new hub** (`HB-07`) asks how the new hub is registered for GST — reuse an
already-verified GSTIN, continue as Non-GST, or verify a new one — then hands off into the
**original onboarding flow**.

Payments, Loss Management and Incentive Center are in the sidebar because the design has
them, but they are explicitly marked out of scope rather than faked.

### How adding a hub re-enters onboarding

`HB-07` states that *"Your KYC and bank details carry over automatically"*, so a second hub
does not re-ask for them. The handoff creates a fresh onboarding draft for the chosen role,
copies the captain-level record into it (personal details, Aadhaar, PAN, bank, background
verification) and marks those phases complete, applies the GST choice, and drops the captain
into the same onboarding flow — same rail, same dev panel, same Cluster Head / Area Manager
/ Zonal Head logic — starting at **hub details**, the first phase that is actually about
this hub. Carried-over phases are skipped rather than re-walked, so the captain is not shown
a background check they have already passed. On activation the finished hub joins My Hubs.

One note on that screen:

- **The button reads "Continue to hub details", matching the design.** That was not true
  when hub details sat later in the flow — starting there would have skipped Cluster Head
  review and left an FM hub with no category or rate ceiling. With hub details now ahead of
  background verification it is the correct first stop, so the design's own label is used.
- **Role choice is an addition.** `HB-07` assumes a single role context, but this prototype
  has two, so the screen asks which role the new hub is for. FM hubs cannot choose Non-GST,
  since GST is mandatory for First Mile — the same rule the onboarding KYC enforces.

## Admin panel

Figma page `109:2`. The **Log in as** switch offers *Captain* or **Admin panel**; Admin opens
the panel picker from `panel-select`, with four consoles:

| Panel | |
|---|---|
| **Area Manager** | Infra hard-gate checklist and VLS field pre-check |
| **Cluster Head** | Interview, hub type, rate card, approve / reject / escalate |
| **Zonal Head** | Above-benchmark rate cards escalated by Cluster Heads |
| **FM Central Admin** | National view of AM, CH and ZH requests, plus user mapping |

Each console shares a shell — sidebar with the signed-in role and scope, admin breadcrumb,
SLA chip — over a request table with search and status filters, and stat tiles. Each row
carries the captain's phone under their name, and the search matches it however it is typed
— spaced as displayed, unspaced, with `+91`, or as a bare `91`-prefixed number — alongside
request ID, captain name and pincode. Opening a
request gives the full-page review: the AM infra checklist, the AM rate card, the CH review,
and the Central Admin approval. Every review carries the read-only *Captain & hub context* card and an
SLA card.

### The rate card

Authored by the Area Manager; read-only for every desk downstream.

*Hub payout type* offers **Combined** and **Split**, with Split disabled — it is not
supported yet. The value is refused in state as well as disabled in the dropdown, so the
rule does not depend on the select to enforce it.

The rate card is **slab-based**: each slab takes an order-volume band and a single rate for
it — there is no separate forward and reverse rate — plus one **touchpoint rate** for the
hub, paid on top of the slab rate. The Area Manager can add as many slabs as needed; a new
one starts where the previous band ended, and the top band's upper bound is left blank to
mean *and above*. Submission needs a hub type **and** a complete rate card: every slab needs
a starting volume, a rate and an upper bound above its start, and the hub needs a touchpoint
rate. Each slab shows its ceiling as it is typed and flags the row if it goes over.

The approved card is what the **captain** then sees — the same bands and the same touchpoint
rate, on the Cluster Head screen and again on agreements. The hub category and the benchmark
ceiling that produced it stay internal.

### The AM infra checklist

Nine hard gates — CCTV, fire extinguisher, computer/laptop + internet, scanner/handheld
devices, scan table, scan stand, power backup, printer, address match — where **any failure
requires rejection**, as the design states.

The tenth item, **max vehicle size review**, is deliberately not a hard gate. It is a
pass/fail on the size the *captain* declared, and failing it means that declaration was
wrong — not that the facility is unfit. So a fail opens the **same vehicle dropdown the
captain uses** and the AM sets the correct size; once set, the review is settled and
approval opens. A failed review never forces rejection the way a hard gate does.

The captain's declared size and the AM's correction are stored separately, so it stays
visible that a correction happened — the context card shows the effective size with an
*AM updated* flag.

### The approval chain

```
AM: infra + hub type + rate card → CH: interview + rating → agreements
                                 ↘ (above ceiling) CH raises → Central Admin → agreements
                                 ↙ (rejected at either desk) back to AM to revise
```

The **Area Manager** works in two pages. **Step 1** is the infra check — the nine hard gates
and the max vehicle size review. It has to pass before **step 2** opens: the **hub type**
(Standalone, Mall hub, LM-as-FM, SAH…) and the **rate card** — an order-volume band and rate
per slab, plus one touchpoint rate. The two pages navigate both ways, so a reviewer can go
back and correct the checklist without losing the rate card.

The hub type sets the **ceiling**, which is shown against every slab as it is typed and
flags any row that exceeds it. A card within ceiling goes *Approve & send to CH*; a card
above it goes *Raise approval request to CH* instead — it can still be submitted, it just
travels as an approval request.

The **Cluster Head** does the interview and rating. The rate card is read-only here,
attributed to the Area Manager. A within-ceiling request the CH settles themselves; an
above-ceiling one they cannot, and the approve action is replaced by *Raise to Central
Admin*. **Central Admin** has the last word: approve and the request settles; reject and it
goes back down.

The **Zonal Head approves nothing.** Their panel is AM pendency and CH pendency — what is
sitting with whom — and opening a request gives a read-only status view with no actions at
all. A desk only gets a working screen for requests actually at its own stage; everyone else
gets that status view, worded for whoever is reading it rather than always for a Zonal Head,
so nobody can act outside their remit.

**Rejection sends the rate card back to the Area Manager, not to the captain.** The rate
card is the Area Manager's work, so a rejection at either the Cluster Head or the Central
Admin desk returns the request to stage `am` with a `revision` record naming the desk and
the reason. It reappears in the Area Manager's queue, and because the infra check is already
done, opening it lands directly on the rate-card page with the send-back explained in a
banner. Repricing within ceiling clears the escalation and the request goes back up as an
ordinary approval.

`OBD-78255` is seeded to demonstrate exactly this: a mall hub priced at ₹3.00 / ₹2.80
against a ₹2.00 ceiling, sitting in the Cluster Head's queue with both *Raise to Central
Admin* and *Reject · send back to AM* available.

**A request's status is only ever *Pending* or *SLA breach*.** Which desk holds it is its
*stage*, tracked separately and surfaced as the tab it appears under and as "pending with"
on the read-only status view — so there are no stage-specific statuses like *AM pending* or
*CH pending*, and the design's *VLS fields missing* is not a status either. A settled
request leaves the working queues entirely, since every tab filters by stage; whether it was
approved or rejected is recorded on the request as `settled`.

**Security deposit is removed throughout**, since FM hubs do not take one. That means the
`zh-sd-detail` frame (*ZH adjust SD*) is not built at all, the *Model SD* and *Current SD*
rows are absent from the context card, the CH form drops *Raise security deposit?* and
*Final SD after CH*, its button reads *Approve & send to agreements* rather than *send to
deposit*, and the Zonal Head's remit is monitoring instead. The Zonal Head card on
the picker is described accordingly.

**Not built, as scoped:** the `geo-bind-am` / `geo-bind-ch` / `geo-bind-zh` binding screens.

The designs are LM's and are implemented as-is apart from the security-deposit removal and
the FM naming — FM-specific changes come later.

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
| Login / OTP | log in as a new captain, or as an existing captain with hubs |
| Captain Hub · bank change | penny-drop succeeded / failed |
| Always | reset entire demo |

Every reject path is reachable and routes the captain back to the right earlier phase to
fix and resubmit.

### A note on the admin screens

An earlier brief for this build said the admin-side consoles referenced at page `109:2` had
no design. **They do exist** — that page is called *Admin Panels · Onboarding Approvals* and
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

**783 assertions across 16 groups:**

1. **LM Captain** — full 9-phase walk, hub code at submit, Oracle vendor ID, 6-target fan-out
2. **FM Captain** — 7 phases, combined mode within benchmark; asserts no SD phase, no AM
   phase, mandatory GST, MSME required, no cheque upload, no hub code at submit, Partner ID
   instead of vendor ID, hub code issued at activation
3. **FM escalation** — split mode, above benchmark, the caveat rendering and the captain's
   reject/resubmit path
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
10. **Hub facility inputs** — vehicle list de-duplication; dropdown open/close incl.
   Escape, outside-click and click-inside; all 24 options in ascending capacity order;
   single-select that closes on pick; the implied-smaller rule (row marking, counts, and
   that larger types are excluded); rank ordering where tonnage is ambiguous; search that
   does not disturb the choice; clear; area/manpower/max-vehicle required; range and
   membership validation; values preserved on a rejected submit and prefilled on reopen;
   captured for both roles
10b. **Phase order** — both role orders pinned, hub details asserted ahead of background
   verification and Cluster Head review, every continue-button label checked against the
   screen it actually leads to, and proper nouns checked for capitalisation
10c. **Back navigation and the location photo** — Back absent on page 1 and past hub
   details, present and correctly labelled on pages 2 and 3, values still editable after a
   round trip, per-item KYC reopen with re-gating, reopening a submitted hub, and the photo:
   optional, thumbnail rendering, enlarge, remove, and refusal of non-images, oversized
   files and undecodable images
11. **Captain Hub** — the login switch; existing captain seeding and landing; `HB-01`
   grouping, per-hub codes and GST state; `PR-01` masking; the full bank-change journey
   including lockout, validation and a failed penny-drop; per-hub GSTIN add/update/remove;
   `HB-07` choices with FM's Non-GST block; the handoff into onboarding with carried-over
   KYC; and a finished hub appearing in My Hubs for both a new and an existing captain.
   Includes a regression group driving the `HB-07` GST choices by clicking and typing
   rather than calling actions — see below.
12. **Admin panel** — the Captain/Admin login switch and the four role cards; each desk's
   own queue and tabs; search by request ID, captain name **and phone**; the nine AM hard
   gates with any failure forcing rejection; the max-vehicle review and its correction flow;
   the AM's two pages and the gate between them; hub type and slab-wise rate card capture
   with per-slab ceilings; the CH's read-only view of that card; role-aware dispatch, so a
   desk never gets a working screen for a request at someone else's stage; and statuses
   limited to *Pending* and *SLA breach*
13. **Above-ceiling rate card** — `OBD-78255` reaching the CH flagged over its mall-hub
   ceiling with both *Raise to Central Admin* and *Reject · send back to AM* offered; a
   rejection at either desk returning the request to the Area Manager with a `revision`
   record rather than closing it; the AM opening straight onto the rate page with the
   send-back explained; repricing within ceiling clearing the escalation; Central Admin
   approving and rejecting; the read-only status view being worded for whoever opens it
   rather than always for a Zonal Head; and no request left stranded at a desk with no
   actions

Three notes on how the tests drive the app:

- `markAgreementRead()` stands in for scroll-to-end, because jsdom has no layout and
  therefore no real `scrollHeight`. The test separately asserts the checkbox is disabled
  before and enabled after.
- Activation fan-out runs on real timers; the tests wait for it rather than stubbing it.
- The harness awaits the app's own `DOMContentLoaded` boot before driving anything. jsdom
  fires that after the constructor returns, so without the wait the app's boot lands
  mid-test and re-renders the DOM out from under whatever is being driven.

### Bugs this suite was extended to cover

Both were found by driving the deployed build in a real browser, not by the original suite:

1. **The resend countdown made the OTP field untypeable.** The 1-second tick called a full
   `render()`, replacing `app.innerHTML` and dropping focus to `<body>`. The tick now
   patches only the countdown text. The original tests missed this because they set each
   cell's `.value` on a freshly-queried element and never depended on focus surviving.
2. **SMS autofill and paste dropped five of six digits.** The input handler took
   `slice(-1)` of the cell's value, so a full code arriving in one cell kept one digit.
   Multi-digit input now spreads across the remaining cells, and there is an explicit
   `paste` handler.
3. **A new GSTIN could not be typed on `HB-07`.** The three GST choices were `<button>`
   elements with the GSTIN field and the existing-GSTIN `<select>` nested *inside* them —
   invalid HTML, and in a real browser the click bubbled to the button, re-rendered the row
   and destroyed the field before a character could land. The rows are now
   `<div role="radio">`, nested controls stop propagation, and selecting the already-selected
   choice no longer re-renders. The tests missed it because they called `addHubChoice()`
   directly instead of clicking the field; the regression test now clicks and types.

---

## File layout

```
index.html   the entire prototype — inline CSS + JS, embedded logo
test.js      jsdom walkthrough of both flows
package.json jsdom dev dependency + `npm test`
```

`window.__APP__` exposes `state`, `actions`, `validate`, `config` and `helpers` for the
tests and for poking at the prototype from the console.
