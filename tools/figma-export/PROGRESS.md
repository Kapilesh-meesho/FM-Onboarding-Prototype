# Figma export — complete

**Figma file:** https://www.figma.com/design/fMILzWywpzbmqBTKIJwnXc
(Valmo — FM Captain Self-Serve Onboarding (Prototype Mirror), Meesho org, in Drafts)

| Page | Screens | Status |
|---|---|---|
| `1 · New Captain onboarding` | 27 | complete (1.01 – 1.27) |
| `2 · Existing Captain, new hub` | 16 | complete (2.01 – 2.16) |
| `3 · Admin login flows` | 22 | complete (3.01 – 3.22) |

65 screens, logo applied on every one.

Page 3 carries the AM's carting-design step: 3.06 – 3.09 are the new step 2
(FMSC, FMCDs, onboarding type, validate, send), 3.13 – 3.14 are Central
Admin's design queue and the eleven-field design alignment view, and the rate
card moved to step 3 at 3.10 – 3.12.

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
