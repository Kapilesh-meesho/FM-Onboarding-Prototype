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
- **Existing captain · 4 hubs** → straight into the **Captain Hub**, with the hubs from
  `HB-01` already seeded — three LM hubs (two active, one inactive) and one live FM hub,
  **KDG · Kudlu Gate Hub**, with an agreed rate card for the Area Manager to update.

Onboarding always ends by creating a hub the captain then owns, so a new captain who
completes a flow lands in the same Captain Hub with one hub.

**Switching who signs in keeps what the others did.** Signing in as the Area Manager does
not re-seed over a hub edit the captain just sent, and signing back in as the existing
captain does not re-seed over the Area Manager's decision — so the captain ↔ Area Manager
round trips below can be walked through the login switch. **Reset entire demo** starts over.

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

**2. No standalone Area Manager phase in the captain flow.** The AM does the work — infra
check, carting design, hub type and the rate card — on their own console in the admin panel,
which this prototype builds. It is not a step the captain waits on as its own screen.

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
agreements — and not the words *ceiling*, *benchmark* or *hub category* anywhere in the FM
captain flow, which a test sweeps every screen to enforce. The captain sees the slab bands
and the touchpoint rate; the classification that produced them, and the threshold it sets,
stay internal.

The same applies to the desks. A card raised above ceiling tells the captain only that it
*needs one more sign-off*, and does not name the desk deciding it. A rejection at either
desk tells the captain the Area Manager is revising the card — no reason, no desk, and not
the word *rejected*. A Central Admin approval reads simply *your request and rate card were
approved*. The Cluster Head stays the captain's only named contact throughout.

**5. The rate card is approved against a benchmark ceiling** determined by that hub
category:

| Category | Slab ceiling (₹/shipment) | Touchpoint ceiling (₹/shipment) |
|---|---|---|
| Standalone (mini-hub) | 3.2 | 6 |
| Standalone | 5 | 5 |
| LM-as-FM | 6 | 6 |
| Mall hub | 2 | 2 |
| SAH (seller as hub) | 1.5 | 1.5 |

**The touchpoint rate is benchmarked separately**, against a ceiling of its own, because it
is paid per touchpoint rather than per slab. A card is above threshold if *any* slab rate
exceeds the slab ceiling **or** the touchpoint rate exceeds the touchpoint ceiling — either
one alone is enough to turn the submission into an approval request.

The chain, on both the captain side and the admin panel:

- The **Area Manager** sets the hub type and authors the rate card — slabs plus one
  touchpoint rate.
- **Within both ceilings**, the **Cluster Head** approves it.
- **Above either ceiling**, the Cluster Head cannot settle it and raises it to **Central
  Admin**, which approves or rejects.
- A rejection at either desk sends the card **back to the Area Manager** to revise. It does
  not go to the captain.
- The **Zonal Head approves nothing.** ZH is monitor-only.

Neither case is annotated on the captain's screen: the card is shown as plain figures,
because the ceiling it is measured against is not something the captain is shown. The
ceiling table above describes internal behaviour and the dev panel, not anything the
captain reads.

**Combined is the only payout type.** The captain is paid the slab rate for their order
volume plus the touchpoint rate, on one payout line — which is what the blurb under the
card says. There is no blended per-shipment figure, and no Split mode: the admin panel's
payout select offers *Split (not available yet)* disabled, and nothing in the captain flow
offers it at all.

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

**The serviceable-pincode check lives on hub details.** It used to sit on personal details,
which now asks only about the person (name, email, alternate phone). The hub's pincode is
typed straight into the **Hub pincode** field after the map link — a complete pincode runs
the same availability check, joins the list and becomes the hub's pincode when VALMO serves
it, with the city and the map pin checked at once — or picked from the serviceable results,
which sit between the hub area / estimated manpower row and max vehicle size. The two stay in
step: a pick fills the field, and a typed pincode shows as chosen in the check. An existing
captain adding a hub now picks one too, which they previously never did. An older save that kept
the picks on personal details is migrated onto hub details on load.

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

**The map pin is previewed and checked against the hub's pincode.** Hub details reads the
coordinates out of the pasted Google Maps link — `?q=lat,lng`, `/@lat,lng,zoom`, a place
link's `!3d…!4d…` pin (which wins over where the map was scrolled), and
`/place|search|dir/lat,lng` — and shows the pin on an embedded Google map with a link out.
The pin is then checked against the pincode the captain picked:

| Pin | Result |
|---|---|
| Nearest the hub's pincode and within 4 km of its centre | ✓ *Inside 560076 · BTM Layout* |
| Nearer another pincode | ✗ *This pin is in 560034 (Koramangala), not the hub's pincode 560076.* |
| More than 4 km from the pincode's area | ✗ names the distance |
| Outside India, or impossible coordinates | ✗ |
| A short `maps.app.goo.gl` share link | ✓ accepted as it is — it opens in Google Maps; it has no coordinates in it, so it isn't previewed or pincode-checked here |
| A text search with no pin | ✗ asks for a link with the hub pinned |
| No pincode picked yet | previewed, checked once one is picked |

The check runs live once a link has coordinates (a half-typed link is left alone until the
field is left), blocks submit with the same message, and the preview is patched in place so
the field keeps focus. Reverse geocoding is **simulated** from pincode centroids
(`PIN_AREAS`) so the prototype stays self-contained; the embed needs no API key.

**A failed backend call says why, and resumes from the same step.** Every call a captain
makes can fail the way the real service would — the email code, DigiLocker/UIDAI (at the
OTP send or the fetch after it), the Income Tax PAN service, the bank's penny-drop, the GST
portal, the pincode availability check, the background-check partner, and each activation
system. The notice names what didn't go through, **the service's reason**, an error code
with a reference and time for Support, and that nothing entered is lost. The card's own
button becomes **Resume verification** (or *Resume*, *Resume check*, *Resume activation*)
and re-runs the same call with the details already entered.

The failure is saved with the application. After **Save & Exit** the role card says which
step is waiting and offers **Resume onboarding**, and an existing captain's hub
mid-onboarding is listed under *Onboarding in progress* with the reason. A resumed
activation carries on from the system that failed rather than re-running the ones that
finished. The dev panel arms a failure — timeout (504) or service down (503) — for the next
call on the step the captain is on; background verification and activation fail in place.

**GSTINs are verified, and the registered name matched to the bank account.** The KYC GST
step, **Manage GSTIN** on an existing hub and a new GSTIN on *Add new hub* all run the same
check: the GSTIN's format (state code, PAN, entity number, `Z`, check character — no longer
just *15 characters*), a lookup on the GST portal (which can fail and be resumed like any
call), the registration's status, and then a **fuzzy match** of its legal and trade names
against the **bank account holder** — the name the penny-drop returned, not the profile
name. On Manage GSTIN the portal's record and the name check are shown for the captain to
save; nothing is applied on its own.

The match ignores case, punctuation, word order, honorifics (*Mr*, *Shri*, *Smt*…) and
legal-form words (*M/s*, *Pvt*, *Ltd*, *LLP*…). Each word of the shorter name pairs with its
closest word in the other — exactly, as an initial (a weak match), or by Jaro-Winkler for
spelling slips — and missing or extra words count against it:

| Score | Result | Examples against *Karan Verma* |
|---|---|---|
| ≥ 95% | **Matches** | *KARAN VERMA*, *VERMA KARAN*, *Mr. Karan Verma*, *KARAN VERMAA* |
| 78–95% | **Similar — accepted**, and labelled so | *VERMA KARAN KUMAR*, *K VERMA*, *KIRAN VERMA* |
| < 78% | **Refused**, both names shown side by side | *KARAN SHARMA*, *KARAN*, *SHREE GANESH TRANSPORT CO* |

The GST portal is **simulated**. A GSTIN carries its holder's PAN in characters 3–12, so a
GSTIN on the captain's own PAN resolves to their proprietorship in their verified name, and
the dev panel lists demo records for the other outcomes:

| GSTIN | Record | Against *Karan Verma* |
|---|---|---|
| `29ABCDE1234F1Z5` | KARAN VERMA · Proprietorship | match |
| `29ZZZZZ9999Z1Z9` | VERMA KARAN KUMAR · Proprietorship | similar (80%) |
| `29AAJFS4321M1ZQ` | SHREE GANESH TRANSPORT CO · Partnership | refused |
| `29AAGCV7788L1Z2` | VERMA FREIGHT PRIVATE LIMITED | cancelled 31 Mar 2025 — refused |
| any other PAN | — | not registered — refused |

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
GSTIN, and remove behind a confirmation — and adding or updating one now **verifies** it
with the GST portal and the bank-name match before it can be saved (see above).

A hub an existing captain is still onboarding is listed under *Onboarding in progress* with
**Resume onboarding**, and with the reason when a backend call failed on it.

**Edit hub details** on any active hub asks the Area Manager to change its address,
pincode, map link or area. The form starts from the hub's current values; a changed
pincode must be one VALMO serves (a hub keeping its own pincode is fine), the map pin is
checked against the pincode being asked for with the same live preview as onboarding, the
area is range-checked, and an unchanged form isn't sent. The hub keeps running on its
current details while the request waits — the card says so, one request per hub at a time
— and afterwards the card says which way it went, with the Area Manager's reason on a
rejection, until dismissed.

**The bell** sits at the top right of the Captain Hub, and of onboarding's top bar once the
captain runs hubs, with a count. It carries **rate card updates** to agree to and decided
hub edits. An FM hub's card shows its agreed rate card, and *Review update* while one is
waiting. Opening a rate card update shows the current and updated cards side by side, when
the change applies, the Area Manager's reason and the Combined rate card blurb, then a
*"I have read the updated rate card"* tick and **one action: Agree**. There is deliberately
**no reject or decline**; a captain with questions is pointed to call their Area Manager.
Agreeing makes the update the hub's rate card, as its next version.

**Add new hub** (`HB-07`) asks how the new hub is registered for GST — reuse an
already-verified GSTIN, continue as Non-GST, or verify a new one — then hands off into the
**original onboarding flow**.

**A Captain Hub bank change whose bank doesn't answer** pauses with the bank's reason and
**Resume verification**, which re-sends the same penny-drop — it is not reported as a failed
account.

Payments, Loss Management and Incentive Center are in the sidebar because the design has
them, but they are explicitly marked out of scope rather than faked.

### How adding a hub re-enters onboarding

`HB-07` states that *"Your KYC and bank details carry over automatically"*, so a second hub
does not re-ask for them. The handoff creates a fresh onboarding draft for the chosen role,
copies the captain-level record into it (personal details, Aadhaar, PAN, bank, background
verification) and marks those phases complete, applies the GST choice, and drops the captain
into the same onboarding flow — same rail, same dev panel, same Area Manager / Cluster Head
/ Central Admin logic — starting at **hub details**, the first phase that is actually about
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
| **Area Manager** | Infra hard-gate checklist and VLS field pre-check; map pin corrections; captains' **hub edits**; **rate card updates** |
| **Cluster Head** | Interview and the AM's rate card — approve within ceiling, raise above it, or send back |
| **Zonal Head** | Monitoring only — AM and CH pendency. Approves nothing |
| **FM Central Admin** | Design alignment and above-ceiling rate cards, plus user mapping |

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
rate. Each slab shows its ceiling as it is typed and flags the row if it goes over, and so
does the touchpoint rate against its own ceiling.

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

### The Area Manager corrects the map pin

The context card shows where the captain's pin is — linking to Google Maps — and warns when
it sits outside the request's pincode. For the **Area Manager** only, *Edit* opens the same
live preview and pincode check the captain's link went through; saving applies the
correction straight to the request, tags the row **AM updated** with the date, and keeps
the captain's submission as it was. Nothing is sent back to the captain to verify: the
request's desk, status and infra checks are untouched. Putting the captain's link back
clears the correction, other desks see the pin read-only, and Central Admin's design inputs
read their lat-long from the effective pin. `OBD-78240` is seeded with the captain's pin
dropped in Koramangala for its HSR Layout pincode, for the Area Manager to fix.

### Hub edits

The Area Manager's **Hub edits** tab (with a pending count) lists captains' requests to
change a live hub. Reviewing one shows each detail *now* against *requested*, the requested
pin on a map with its pincode check, and the captain's note. **Approve** writes the new
details onto the hub; **Reject** needs a reason, which the captain sees, and leaves the hub
exactly as it was. A decided request stays listed, read-only.

### Rate card updates

The Area Manager's **Rate card updates** tab lists live FM hubs with the rate card each
captain agreed to. Updating one starts from the agreed slabs and touchpoint; the Area
Manager changes them, picks the payout cycle it applies from (the first of next month, or
the month after) and says why. An unchanged card, an incomplete one, or one without a reason
isn't sent, and a hub takes one update at a time. The agreed card stays in force until the
captain agrees from their bell; the list shows *Waiting for the captain* meanwhile.

Rate card updates go **straight from the Area Manager to the captain** — they do not run
the Cluster Head / Central Admin ceiling chain that a new hub's rate card does.

### The approval chain

```
AM: infra → carting design → hub type + rate card → CH: interview + rating → agreements
                  ↘ design sent to Central Admin for alignment, in parallel
                                 ↘ (above ceiling) CH raises → Central Admin → agreements
                                 ↙ (rejected at either desk) back to AM to revise
```

The **Area Manager** works in three pages, and a **hub code** — three random letters — is
assigned the moment they open a request. It shows at the top of every step and sticks for
the life of the request.

**Step 1** is the infra check — the nine hard gates and the max vehicle size review. It has
to pass before **step 2** opens.

**Step 2 is the FM Carting Design Input**: how the hub maps onto the sorting network. The
**FMSC** is one hub code and is required; the **FMCDs** are comma-separated cross-dock codes
and may be left empty. An **Onboarding Type** picks between *Split from existing*, *New
expansion* and *Multitouch*. **Validate** checks every code against the ones the network
knows, and names any that do not exist rather than accepting a typo. Only a clean run turns
the button into **Send Design for Approval**; editing a field afterwards withdraws it and
the codes have to pass again. Sending the design opens step 3 — the request itself stays
with the Area Manager, and the design is reviewed by Central Admin in parallel.

**Step 3** is the **hub type** (Standalone, Mall hub, LM-as-FM, SAH…) and the **rate card**
— an order-volume band and rate per slab, plus one touchpoint rate. The three pages navigate
both ways, so a reviewer can go back and correct the checklist without losing the rate card.

The hub type sets two **ceilings** — one for slab rates and one for the touchpoint rate.
Both are shown inline as the figures are typed, and the offending row is flagged the moment
it goes over, whether that is a slab or the touchpoint. A card within both ceilings goes
*Approve & send to CH*; a card over either one goes *Raise approval request to CH* instead —
it can still be submitted, it just travels as an approval request.

The over-ceiling notice names whichever part is actually over, and both when both are:
*"The highest slab rate is ₹3.00 against a ₹2.00 ceiling, and the touchpoint rate is ₹2.60
against a ₹2.00 ceiling."* The same sentence is reused on the Cluster Head's banner and on
Central Admin's, so the three desks cannot end up describing the breach differently.

### Design alignment

Central Admin has a second queue beside the rate-card one: **Design approvals**, holding
every design an Area Manager has sent and nobody has aligned yet. It is filtered on the
design, not on the request's stage, because the two run in parallel.

Opening one shows **Design alignment** — city, hub code, lat-long and map link, pincodes
served, max vehicle size, hub type, hub address, hub pincode, state, whether it is a split
or a new expansion, and whether it is multitouch. All of it is read-only except the **FM →
FMSC mapping**, which Central Admin may re-point before approving; a code they mistype is
refused the same way the Area Manager's was. **Approve Design** settles it, and the Area
Manager sees the approval — and any corrected mapping — on their step 2.

**Hub type reads "Not set yet" on most designs**, because the Area Manager sets it on step 3
and the design goes out at the end of step 2. The screen says so rather than showing a blank.
If hub type needs to be aligned alongside the rest of the design, it belongs on step 2.

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

The designs are LM's, implemented with the security deposit removed, FM naming throughout,
and the FM approval chain in place of LM's.

## Why the dev panel exists

There is a floating **⚙ Simulate backend** panel, bottom-right, collapsible.

Onboarding is not a single-actor flow. Half the state transitions belong to people the
captain never sees: an Area Manager pricing a hub or failing a facility check, a Cluster
Head approving a rate card, Central Admin ruling on one that is above ceiling, a payment
gateway timing out. Without something standing in for them, most of this prototype is
simply unreachable — you would get as far as "Cluster Head review in progress" and stop.

The panel is contextual to the current phase and exposes exactly those actors:

| Phase | Simulated actions |
|---|---|
| Background verification | mark passed / mark failed |
| Cluster Head (LM) | approve / reject |
| Area Manager (FM) | pick hub type (one button per type), then submit rate card within ceiling / above ceiling |
| Cluster Head (FM) | approve rate card (within ceiling only) / raise to Central Admin (above ceiling only) / reject → back to Area Manager |
| Central Admin (FM, once raised) | approve rate card / reject → back to Area Manager |
| Area Manager revision (FM, after a rejection) | reprice within ceiling and resubmit |
| Security deposit (LM only) | force success / failure / quote expired |
| Area Manager (LM only) | approve / reject (two-strike counter shown) |
| Agreements | mark agreement scrolled to end |
| Activation | force failure / force success |
| Personal details, KYC cards, hub details | fail the next email code / Aadhaar / PAN / penny-drop / GSTIN / availability call — timeout (504) or service down (503) |
| KYC GST step, Manage GSTIN, Add new hub | GST portal demo records — fill the GSTIN field with a matching, similar, mismatching, cancelled or unregistered GSTIN |
| Background verification (pending) | partner times out / partner is down |
| Login / OTP | log in as a new captain, an existing captain with hubs, or the admin panel — without re-seeding over what is there |
| Captain Hub · bank change | penny-drop succeeded / failed / bank times out / IMPS down |
| Captain Hub · hub edit pending | Area Manager approves / rejects it |
| Captain Hub · live FM hub | Area Manager sends a sample rate card update |
| Always | reset entire demo |

Every reject path is reachable. For LM that routes the captain back to the right earlier
phase to fix and resubmit. For FM the rate card is the Area Manager's work, so a rejection
at either desk routes it back to the Area Manager, never to the captain.

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

**1458 assertions across 28 groups:**

1. **LM Captain** — full 9-phase walk, hub code at submit, Oracle vendor ID, 6-target fan-out
2. **FM Captain** — 7 phases, a within-ceiling card authored by the AM and approved by the
   CH; asserts no SD phase, no AM phase, mandatory GST, MSME optional and not gating, no
   cheque upload, no hub code at submit, Partner ID instead of vendor ID, hub code issued at
   activation, and the Combined blurb quoting no figure of its own
3. **FM above ceiling** — the AM prices over the ceiling, the CH cannot settle it and raises
   it, Central Admin rejects, the card goes back to the AM, is repriced and approved; plus a
   CH rejection routing to the AM rather than the captain, and a Central Admin approval that
   names no desk
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
   the AM's three pages and the gates between them; hub type and slab-wise rate card capture
   with per-slab ceilings; the CH's read-only view of that card; role-aware dispatch, so a
   desk never gets a working screen for a request at someone else's stage; and statuses
   limited to *Pending* and *SLA breach*
13. **Above-ceiling rate card** — the touchpoint rate's own ceiling: a card sitting on both
   ceilings passing, the touchpoint alone breaching, the row and chip flipping live without
   a re-render, the notice naming only what is over (and both when both are), the breach
   travelling to the CH and Central Admin with the ceiling named, and the
   "what's still missing" hint clearing when the card completes; plus `OBD-78255` reaching
   the CH flagged over its mall-hub
   ceiling with both *Raise to Central Admin* and *Reject · send back to AM* offered; a
   rejection at either desk returning the request to the Area Manager with a `revision`
   record rather than closing it; the AM opening straight onto the rate page with the
   send-back explained; repricing within ceiling clearing the escalation; Central Admin
   approving and rejecting; the read-only status view being worded for whoever opens it
   rather than always for a Zonal Head; and no request left stranded at a desk with no
   actions

14. **FM Carting Design Input** — the hub code assigned on first open and sticking across
   reopens; the design page sitting between the infra check and the rate card; FMSC required
   and FMCDs optional; validation naming codes the network does not know; Validate becoming
   Send Design for Approval, and an edit withdrawing it; the rate card staying closed until
   the design is sent; Central Admin's design queue, all eleven design-alignment fields,
   a mapping correction and *Approve Design*; and the Area Manager seeing the result
18. **FM captain copy** — a sweep over every FM screen, from the role picker through the
   raise, reject, revise and approve path to activation, asserting no rendered captain text
   contains *Zonal Head*, *hub category*, *ceiling* or *benchmark*; plus the rewritten
   service-agreement clause and rate card checkbox
19. **No Split** — nothing in the FM flow, the dev panel or the helper surface offers a
   Split payout, even when stale state carries a split mode
20. **Copy and seed-data consistency** — one framing for the vehicle count on the picker
   and the summary; the phase header following the state rather than always saying the
   Cluster Head is reviewing; the approval date as a day stamp; one default hub name across
   activation and Captain Hub; and seeded requests whose address matches their pincode and
   whose serving pincodes include their own
21. **Pincodes on hub details** — personal details asks only about the person; hub details
   carries the availability check after the address, map link, area and manpower and
   before max vehicle size; an unserviceable pincode cannot
   be forced in; the pick survives a failed submit; an older save is migrated; an existing
   captain adding a hub picks one; and the availability notice counts properly
28. **Typing the hub pincode** — the field after the map link takes a pincode: a complete
   serviceable one is chosen with the caret kept in place, the city resolved and the map pin
   checked; unserviceable, malformed and sixth pincodes are refused at the field; a pick from
   the check fills it; clearing it clears the hub's pincode; a failed check resumes and
   chooses what was typed; and the typed pincode is the one the hub submits with
22. **Map pin** — every link format parsed, every outcome of the check (inside, another
   pincode, too far, abroad, impossible, text search, no pincode yet), the embedded map and
   badges, live checking that keeps the field, a half-typed link left alone until the field
   is left, submit blocked with the same message, the summary row, and a short share link
   accepted as it is — linked out to Google Maps, submitting, and saved by the Area Manager
23. **API failures and resume** — each failing call (email, Aadhaar at send and at fetch,
   PAN, bank, GST, availability, BGV, activation) shows the reason, a reference and that
   nothing is lost, keeps what was entered, and resumes from the same step; the failure
   survives Save & Exit and a reload, shows on the role card and on an existing captain's
   in-progress hub; resumed activation keeps the systems that finished; and a Captain Hub
   bank change pauses rather than failing the account
24. **GSTIN verification** — the fuzzy match (order, case, honorifics, legal-form words,
   spelling slips, middle names, initials, wrong surnames, lone first names, other
   businesses), the trade name counting when closer, the simulated GST portal, the stricter
   format; Manage GSTIN refusing a mismatch, a cancelled and an unregistered GSTIN, resuming
   a portal timeout, accepting a similar name only when saved, and checking against the
   bank account rather than the profile; and the same check on *Add new hub* and in KYC
25. **AM map pin correction** — seeded pins inside their pincodes (bar `OBD-78240`), the
   context card's pin and warning, the editor's live preview, an out-of-pincode pin refused,
   a correction saved with *AM updated*, the captain's submission and every captain-side
   value untouched, the request's desk, status and checks unchanged, a reload, Cancel, and
   no Edit for any other desk
26. **Hub edits** — the form prefilled from the hub, every validation, one request at a
   time, the Area Manager's tab, now-against-requested review, approve applying all four
   changes, reject needing a reason and changing nothing, both outcomes shown to the captain
   after signing back in through the login switch, and the dev panel shortcut
27. **Rate card updates** — the FM hub's agreed card, the bell, the AM's tab and editor
   (unchanged, unexplained and incomplete cards refused, slabs added and removed, the cycle
   picked), one update at a time, the agreed card in force until agreed, the bell count and
   notification, the agreement page with no reject or decline, Agree gated on the tick, the
   card replaced as its next version, hub edit outcomes on the bell, the dev panel shortcut,
   and the bell on onboarding's top bar

Three notes on how the tests drive the app:

- `markAgreementRead()` stands in for scroll-to-end, because jsdom has no layout and
  therefore no real `scrollHeight`. The test separately asserts the checkbox is disabled
  before and enabled after.
- Activation fan-out runs on real timers; the tests wait for it rather than stubbing it.
- The harness awaits the app's own `DOMContentLoaded` boot before driving anything. jsdom
  fires that after the constructor returns, so without the wait the app's boot lands
  mid-test and re-renders the DOM out from under whatever is being driven.

### Bugs this suite was extended to cover

These were found by driving the build in a real browser, not by the original suite:

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
4. **Long status lines ran off the card.** The admin panel's `.st` status-chip rule (inline,
   padded, `nowrap`) also matched the text column of every captain status block, so
   *"Activation in progress…"* and *"Background verification in progress…"* ran on one line
   past the card. It is reset inside `.status-head`, and a test checks the computed style.
5. **A hub outside the new-hub list couldn't be edited at all.** Indiranagar Hub runs in
   560038, which isn't on the serviceable list for *new* hubs, so its own pincode failed the
   check. A hub keeping its pincode is now accepted; only a changed one must be serviceable.

---

## File layout

```
index.html   the entire prototype — inline CSS + JS, embedded logo
test.js      jsdom walkthrough of both flows
package.json jsdom dev dependency + `npm test`
```

`window.__APP__` exposes `state`, `actions`, `validate`, `config` and `helpers` for the
tests and for poking at the prototype from the console.
