# Figma export — where this got to

**Figma file:** https://www.figma.com/design/fMILzWywpzbmqBTKIJwnXc
(Valmo — FM Captain Self-Serve Onboarding (Prototype Mirror), Meesho org, in Drafts)

## Done

| Page | Screens | Status |
|---|---|---|
| `1 · New Captain onboarding` | 27 | **complete** (1.01 – 1.27) |
| `2 · Existing Captain, new hub` | 16 | **complete** (2.01 – 2.16) |
| `3 · Admin login flows` | 16 | not started |

## Remaining calls

Each file in `calls/` is a complete, ready-to-paste `use_figma` script. Run them
in order; they append to their page, so only run one once.

- [ ] `calls/3-01.js` — 3.01 Login switch · admin, 3.02 Admin role picker
- [ ] `calls/3-02.js` — 3.03 AM · my requests, 3.04 AM · infra checklist
- [ ] `calls/3-03.js` — 3.05 AM · infra checklist passed, 3.06 AM · rate card
- [ ] `calls/3-04.js` — 3.07 AM · rate card within ceiling, 3.08 above ceiling
- [ ] `calls/3-05.js` — 3.09 CH · my requests, 3.10 CH · review within ceiling
- [ ] `calls/3-06.js` — 3.11 CH · review above ceiling, 3.12 ZH · pendency monitor
- [ ] `calls/3-07.js` — 3.13 ZH · CH pendency, 3.14 ZH · request status
- [ ] `calls/3-08.js` — 3.15 Central Admin · queue, 3.16 rate card approval

`calls/` is derived — `node gen.js` regenerates it. The `skip` values in
`gen.js` record which screens are already built, so regenerating only ever
emits what is still outstanding.

## Still to do after the last call

1. **The Valmo logo is a grey placeholder** on every screen. Fix in two steps:
   `upload_assets` the PNG once against any rectangle named `Valmo logo`, read
   that rectangle's `imageHash` back with `use_figma`, then apply the same hash
   to every other `RECTANGLE[name=Valmo logo]` in the file in one script.
   The PNG is the data URI embedded in `index.html` — decode it to a file first.
2. A final `get_screenshot` per page to confirm the grid reads correctly.

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
and nothing is written to the file.

## Re-running from scratch

```bash
npm i puppeteer-core          # needs Google Chrome installed at the usual path
node capture.js               # drives the prototype, writes shots/
node compact.js               # writes packed/
node inflate.test.js          # round-trips every payload before any of it is sent
node gen.js                   # writes calls/
```

`shots/` and `node_modules/` are not committed — both are regenerable.
