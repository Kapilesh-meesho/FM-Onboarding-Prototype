/* Squeezes each captured screen into a form small enough to inline in a
   use_figma script. Colours and text styles are pooled per screen; everything
   else is a positional array with trailing defaults trimmed. */
const fs = require("fs"), path = require("path");
const IN = path.join(__dirname, "shots"), OUT = path.join(__dirname, "packed");
fs.mkdirSync(OUT, { recursive: true });

const hex = (c) => {
  if (!c) return null;
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  const base = h(c.r) + h(c.g) + h(c.b);
  return c.a != null && c.a < 0.999 ? base + h(c.a) : base;
};
const n0 = (n) => {                       // integers unless a half-pixel matters
  const r = Math.round(n);
  return Math.abs(n - r) < 0.34 ? r : Math.round(n * 2) / 2;
};

function pack(screen) {
  const P = [], pi = new Map(), S = [], si = new Map();
  const col = (c) => {
    const k = hex(c); if (k == null) return -1;
    if (!pi.has(k)) { pi.set(k, P.length); P.push(k); }
    return pi.get(k);
  };
  const sty = (t) => {
    const align = (t.align === "start" || t.align === "left") ? "" : t.align;
    const k = [t.size, t.weight, col(t.color), t.lh == null ? "" : n0(t.lh),
               t.ls || 0, align, t.deco === "none" ? "" : t.deco,
               t.transform === "none" ? "" : t.transform].join("|");
    if (!si.has(k)) { si.set(k, S.length); S.push(k); }
    return si.get(k);
  };
  const trim = (a) => {                   // drop trailing defaults
    while (a.length && (a[a.length - 1] === 0 ||
           (Array.isArray(a[a.length - 1]) && a[a.length - 1].length === 0))) a.pop();
    return a;
  };

  function node(n) {
    if (n.t === "text") {
      const s = sty(n), centred = /center|right|end/.test(n.align || "");
      /* A left-aligned single-line run can auto-size in Figma; anything wrapped
         or aligned off the left edge needs its measured box. */
      const needBox = n.wrap || centred;
      const a = [1, n.chars, n0(n.x), n0(n.y), s];
      if (needBox) a.push(n0(n.w), n.wrap ? 1 : 0);
      return a;
    }
    if (n.t === "image") return [2, n0(n.x), n0(n.y), n0(n.w), n0(n.h)];

    const bdRaw = (n.bd || []).map((b) => (b ? [Math.round(b.w * 2) / 2, col(b.c)] : 0));
    let bd = 0;
    if (bdRaw.some((b) => b !== 0)) {
      const k = bdRaw.map((b) => JSON.stringify(b));
      bd = k.every((x) => x === k[0]) ? bdRaw[0] : bdRaw;   // uniform → one pair
    }
    const rr = n.radii || [];
    const rad = rr.some(Boolean) ? (rr.every((v) => v === rr[0]) ? rr[0] : rr) : 0;
    const sh = (n.sh || []).length
      ? n.sh.map((s) => [n0(s.x), n0(s.y), n0(s.blur), n0(s.spread), col(s.color)]) : 0;
    const gr = n.gr ? [n.gr.angle, n.gr.stops.map(col)] : 0;
    const name = (n.n || "").replace(/^div\.?/, "").replace(/^(span|button|input|a|h[1-6]|p|b|i|select|textarea|label)\./, "");
    return trim([0, name, n0(n.x), n0(n.y), n0(n.w), n0(n.h), col(n.bg), rad, bd, sh,
                 n.clip ? 1 : 0, n.op != null && n.op < 1 ? Math.round(n.op * 100) / 100 : 0,
                 gr, (n.children || []).map(node)]);
  }

  const c = (screen.children || []).map(node);
  return { n: screen.name, w: screen.w, h: screen.h, P, S, c };
}

const manifest = JSON.parse(fs.readFileSync(path.join(IN, "manifest.json"), "utf8"));
const out = [];
for (const m of manifest) {
  const json = JSON.stringify(pack(JSON.parse(fs.readFileSync(path.join(IN, m.file), "utf8"))));
  fs.writeFileSync(path.join(OUT, m.file), json);
  out.push({ ...m, packed: json.length });
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(out, null, 2));
const tot = out.reduce((a, x) => a + x.packed, 0);
console.log(`${out.length} screens · ${(tot / 1024).toFixed(0)} KB packed`);
console.log("largest:", [...out].sort((a, b) => b.packed - a.packed).slice(0, 4)
  .map((x) => `${x.name} ${(x.packed / 1024).toFixed(1)}KB`).join(" · "));
