# Figma export: complete

**Figma file:** https://www.figma.com/design/fMILzWywpzbmqBTKIJwnXc
(Valmo — FM Captain Self-Serve Onboarding (Prototype Mirror), Meesho org, in Drafts)

| Page | Screens | Status |
|---|---|---|
| `1 · New Captain onboarding` | 29 | complete (1.01 to 1.29) |
| `2 · Existing Captain, new hub` | 16 | complete (2.01 to 2.16) |
| `3 · Admin login flows` | 22 | complete (3.01 to 3.22) |
| `4 · Captain without GST` | 9 | complete (4.01 to 4.09) |
| `5 · Captain Hub after go-live` | 8 | complete (5.01 to 5.08) |
| `6 · Rate card updates and Central Admin` | 22 | complete (6.01 to 6.22) |

106 screens, rebuilt from the prototype on 27 Oct 2026. No text layer carries
an em dash.

Page 1 walks the whole FM approval chain. 1.13 to 1.14 type the GSTIN straight
in, 1.17 to 1.19 add serviceable pincodes and pick vehicles, and 1.24 to 1.26
cover the captain's view of a card raised above ceiling, sent back, and then
approved. The captain only ever sees the approved rate card.

Page 3 carries the AM's three verification steps (infra check, carting design,
rate card), the Design team's queue, the Cluster Head's review, the Zonal
Head's pendency views and the BizFin approval.

Page 4 is the captain who has no GST: the declaration, the AM's review of it,
a decline that asks for a GSTIN, and a later hub added without GST.

Page 5 is the live captain in Captain Hub: agreeing to a rate card update,
notifications, rate card history and editing hub details.

Page 6 is the rate card update chain (AM, Cluster Head, Zonal Head, BizFin)
plus Central Admin: FM Central Ops pendency views, bulk update, slab settings
and the slab change BizFin approves, and the AM's hub edit queue.

## What the file is

A faithful mirror, not a design system. Real text layers, real colours, real
shadows and gradients, a layer tree that follows the DOM — but frames are
absolutely positioned, with no components and no auto-layout. Good for review
and reference; restructuring work would rebuild from these rather than edit
them in place.

Known limitations, all inherent to capturing a running page:

- **Emoji icons render blank.** The role-picker icons (📍 👥 🛡) are emoji in
  the prototype and Inter has no glyphs for them. The rupee one (₹) does render.
- **Text wraps a little differently.** Figma's Inter measures marginally wider
  than Chrome's, so a few tight labels break a line earlier. Fixed-width runs
  are given 10px of slack at build time to keep single lines on one line.
- **Inline runs inside a wrapping block.** Where a block mixes an inline
  `<span>` with loose text and the whole thing wraps, each run is captured
  separately and the second can land on the first. One case existed in the file
  (the AM rate-card over-ceiling notice) and was stacked by hand.
- **Demo IDs drift.** Request IDs and the AM's minted hub code are generated at
  random on each run, so a re-capture changes them even when nothing else moved.
- **Captain Hub screens carry no logo rectangle.** They render the panel header
  rather than the onboarding one, so page 2 has 10 logos across 16 screens, page 4 has 8 across 9, and page 5
  has none.

## Re-running from scratch

```bash
npm i puppeteer-core          # needs Google Chrome installed at the usual path
node capture.js               # drives the prototype in headless Chrome, writes shots/
node compact.js               # writes packed/
node inflate.test.js          # round-trips every payload before any of it is sent
node gen.js                   # writes calls/ — the ready-to-paste use_figma scripts
```

Then paste each `calls/*.js` into `use_figma` in order. The `skip` values in
`gen.js` are all `0`, which rebuilds everything; raise one to the number of
screens already built on that page to resume a partial run. The first call of a
page whose `skip` is `0` clears that page before appending, so a rebuild does
not leave the old frames behind.

The logo hash `869781bd37fe5d40d1fd1b7a7f1815c54a28d3f0` is baked into the
generated calls, so the logo lands with each screen and needs no separate pass.
If the file is ever recreated from nothing, upload the PNG first:

1. Extract it from the data URI in `index.html`.
2. `upload_assets` it against any rectangle named `Valmo logo`; the POST
   response carries the `imageHash`.
3. Put that hash in `gen.js` and regenerate.

## How the pipeline works

```
index.html ──► capture.js ──► shots/   (headless Chrome, real layout)
                  │
                  └─ flows.js   the click path to each screen
shots/   ──► compact.js ──► packed/    (pooled colours + text styles, positional arrays)
packed/  ──► gen.js     ──► calls/     (deflate-raw + base64, chunked with checksums)
calls/   ──► use_figma                 (inflate + build inside the Figma plugin sandbox)
```

The payload is compressed because the plugin sandbox has no `fetch` — every byte
has to be inlined in the script. It is chunked with a per-chunk checksum because
a long base64 blob is easy to garble in transit: a bad chunk is reported by index
and nothing is written to the file. That caught every transcription slip during
the build, each time before anything reached the canvas.

`shots/`, `calls/` and `node_modules/` are not committed — all three are
regenerable from `packed/` and the scripts.
