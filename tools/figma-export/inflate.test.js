/* Round-trips every packed screen through deflateRaw -> base64 -> the inline
   inflate, so a payload is never sent to Figma without proof it decodes. */
const zlib = require("zlib");
const fs = require("fs"), path = require("path");
const { INFLATE } = require("./inflate.js");
const { toB64 } = require("./encode.js");

global.figma = { base64Decode: (s) => new Uint8Array(Buffer.from(s, "base64")) };
eval(INFLATE);

const M = JSON.parse(fs.readFileSync(path.join(__dirname, "packed/manifest.json"), "utf8"));
let ok = 0, fail = 0, rawTot = 0, b64Tot = 0;
for (const m of M) {
  const raw = fs.readFileSync(path.join(__dirname, "packed", m.file), "utf8");
  const b64 = toB64(raw);
  rawTot += raw.length; b64Tot += b64.length;
  const back = UNPACK(b64);
  if (JSON.stringify(back) === JSON.stringify(JSON.parse(raw))) ok++;
  else { fail++; console.log("MISMATCH", m.name); }
}
console.log(`${ok} ok, ${fail} failed`);
console.log(`raw ${(rawTot / 1024).toFixed(0)}KB -> b64 ${(b64Tot / 1024).toFixed(0)}KB`);
console.log(`inflate source ${INFLATE.length}B`);
