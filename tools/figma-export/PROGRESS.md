# Figma export — page 3 being rebuilt

**Figma file:** https://www.figma.com/design/fMILzWywpzbmqBTKIJwnXc
(Valmo — FM Captain Self-Serve Onboarding (Prototype Mirror), Meesho org, in Drafts)

| Page | Screens | Status |
|---|---|---|
| `1 · New Captain onboarding` | 27 | complete (1.01 – 1.27) |
| `2 · Existing Captain, new hub` | 16 | complete (2.01 – 2.16) |
| `3 · Admin login flows` | 22 | **rebuilding** — the AM's new carting-design step |

Pages 1 and 2 are untouched by the carting-design change and stay as built.
Page 3 grew from 16 screens to 22 and is being rebuilt from scratch: `gen.js`
skips pages 1 and 2, and the first page-3 call clears the page before appending.

After the last page-3 call, re-apply the logo to page 3 only — upload is not
needed again, the hash is `869781bd37fe5d40d1fd1b7a7f1815c54a28d3f0`.

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

## Re-running from scratch

```bash
npm i puppeteer-core          # needs Google Chrome installed at the usual path
node capture.js               # drives the prototype in headless Chrome, writes shots/
node compact.js               # writes packed/
node inflate.test.js          # round-trips every payload before any of it is sent
node gen.js                   # writes calls/ — the ready-to-paste use_figma scripts
```

Then paste each `calls/*.js` into `use_figma` in order. Reset the `skip` values
in `gen.js` to `0` first — they record how many screens per page are already
built, so a resumed run only emits what is outstanding.

After the last call, place the logo:

1. Extract the PNG from the data URI in `index.html`.
2. `upload_assets` it against any rectangle named `Valmo logo`; the POST
   response carries the `imageHash`.
3. Apply that hash to every other `Valmo logo` rectangle — one `use_figma` call
   per page, since a script may only switch pages once.

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
and nothing is written to the file. That caught four transcription slips during
the build, each time before anything reached the canvas.

`shots/`, `calls/` and `node_modules/` are not committed — all three are
regenerable from `packed/` and the scripts.
