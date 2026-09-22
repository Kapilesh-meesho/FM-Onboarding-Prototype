/* Emits ready-to-paste use_figma scripts, a few screens at a time.
   The payload is deflate-raw + base64 split into short checksummed chunks:
   small batches keep each transcription short, and the checksum names the
   exact chunk when one is wrong instead of failing as an opaque parse error. */
const fs = require("fs"), path = require("path");
const { INFLATE } = require("./inflate.js");
const { toB64 } = require("./encode.js");

const M = JSON.parse(fs.readFileSync(path.join(__dirname, "packed/manifest.json"), "utf8"));
const BUILDER = fs.readFileSync(path.join(__dirname, "builder.js"), "utf8").trim();
const OUT = path.join(__dirname, "calls");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { key: "1.", name: "1 · New Captain onboarding", skip: 0 },
  { key: "2.", name: "2 · Existing Captain, new hub", skip: 0 },
  { key: "3.", name: "3 · Admin login flows", skip: 0 },
];
const COLS = 4, GAPX = 160, GAPY = 240, PER_CALL = 2, CHUNK = 220;

const sum = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

const index = [];
for (const pg of PAGES) {
  const rows = M.filter((m) => m.name.startsWith(pg.key));
  const placed = rows.map((m, i) => {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, "packed", m.file), "utf8"));
    const col = i % COLS, rowN = Math.floor(i / COLS);
    let y = 0;
    for (let r = 0; r < rowN; r++) {
      y += Math.max(...rows.slice(r * COLS, r * COLS + COLS).map((x) => x.h)) + GAPY;
    }
    d.x = col * (1440 + GAPX);
    d.y = y;
    return d;
  }).slice(pg.skip);

  for (let p = 0; p * PER_CALL < placed.length; p++) {
    const slice = placed.slice(p * PER_CALL, (p + 1) * PER_CALL);
    const b64 = toB64(JSON.stringify(slice));
    const chunks = [];
    for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));

    const code = [
      INFLATE,
      "",
      BUILDER,
      "",
      "const C=[",
      chunks.map((c) => '"' + c + '"').join(",\n"),
      "];",
      'const B64=C.join("");',
      "let h=0; for(let i=0;i<B64.length;i++) h=(h*31+B64.charCodeAt(i))>>>0;",
      `if(B64.length!==${b64.length}||h!==${sum(b64)}) return {error:"payload corrupted",want:{len:${b64.length},sum:${sum(b64)}},got:{len:B64.length,sum:h},bad:C.map((c,i)=>{let x=0;for(let k=0;k<c.length;k++)x=(x*31+c.charCodeAt(k))>>>0;return i+":"+c.length+":"+x;})};`,
      "const SCREENS=UNPACK(B64);",
      "const page = figma.root.children.find(p => p.name === " + JSON.stringify(pg.name) + ");",
      "await figma.setCurrentPageAsync(page);",
      "const built=[];",
      "for (const s of SCREENS) built.push(await build(s, s.x, s.y, null));",
      "return {page: page.name, screens: built.map(b=>b.name), nodes: built.reduce((a,b)=>a+b.nodes,0)};",
    ].join("\n");

    const file = `${pg.key.replace(".", "")}-${String(p + 1).padStart(2, "0")}.js`;
    fs.writeFileSync(path.join(OUT, file), code);
    fs.writeFileSync(path.join(OUT, file + ".sums"),
      chunks.map((c, i) => `${i}:${c.length}:${sum(c)}`).join("\n"));
    index.push({ file, page: pg.name, screens: slice.map((s) => s.n), chunks: chunks.length, bytes: code.length });
  }
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(index.map((x) => `${x.file}  ${(x.bytes / 1024).toFixed(1)}KB  ${x.chunks} chunks  ${x.screens.join(", ")}`).join("\n"));
