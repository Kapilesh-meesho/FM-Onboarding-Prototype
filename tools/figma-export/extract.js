/* DOM -> Figma-ready JSON.
   Frames are emitted only for elements that actually paint (background, border
   or shadow); everything else is passed through, so the layer tree stays close
   to what a designer would have drawn rather than mirroring every wrapper div.
   Text is captured at the DOM text-node level via Range boxes, which keeps
   inline <b>/<span> runs in the right place. */
window.__CAP__ = function (opts) {
  opts = opts || {};
  var root = document.getElementById("app");
  var rb = root.getBoundingClientRect();
  /* The login shells are position:fixed, so #app collapses to zero height —
     fall back to the viewport rather than capturing an empty frame. */
  if (rb.height < 10 || rb.width < 10) {
    rb = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  var OX = rb.left + (rb.top === 0 ? 0 : window.scrollX), OY = rb.top + (rb.top === 0 ? 0 : window.scrollY);

  function px(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }
  function rgb(s) {
    if (!s) return null;
    var m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    var p = m[1].split(",").map(function (x) { return parseFloat(x); });
    var a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: a };
  }
  function box(r) {
    return { x: px(r.left + window.scrollX - OX), y: px(r.top + window.scrollY - OY),
             w: px(r.width), h: px(r.height) };
  }
  function shadows(cs) {
    var s = cs.boxShadow;
    if (!s || s === "none") return null;
    var out = [], re = /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g, m;
    while ((m = re.exec(s))) {
      var c = rgb(m[1]); if (!c) continue;
      out.push({ x: +m[2], y: +m[3], blur: +m[4], spread: +(m[5] || 0), color: c });
    }
    return out.length ? out : null;
  }
  function radii(cs) {
    var f = function (v) { return Math.round(parseFloat(v) || 0); };
    return [f(cs.borderTopLeftRadius), f(cs.borderTopRightRadius),
            f(cs.borderBottomRightRadius), f(cs.borderBottomLeftRadius)];
  }
  function borders(cs) {
    var sides = ["Top", "Right", "Bottom", "Left"], out = [];
    for (var i = 0; i < 4; i++) {
      var w = parseFloat(cs["border" + sides[i] + "Width"]) || 0;
      var st = cs["border" + sides[i] + "Style"];
      var c = rgb(cs["border" + sides[i] + "Color"]);
      out.push(w > 0 && st !== "none" && c ? { w: w, c: c } : null);
    }
    return out;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, BR: 1 };

  function textNodes(el, cs, out) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType !== 3) continue;
      var raw = n.nodeValue;
      if (!raw || !raw.trim()) continue;
      var rng = document.createRange();
      rng.selectNodeContents(n);
      var rects = rng.getClientRects();
      if (!rects.length) continue;
      var r = rng.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      var b = box(r);
      /* A run that wrapped gets the parent's content width so Figma re-wraps
         it the same way; a single-line run keeps its own ink width. */
      var wrapped = rects.length > 1;
      if (wrapped) {
        var pr = box(el.getBoundingClientRect());
        var pl = parseFloat(cs.paddingLeft) || 0, prr = parseFloat(cs.paddingRight) || 0;
        b.x = pr.x + pl; b.w = Math.max(10, pr.w - pl - prr);
      }
      var lh = cs.lineHeight === "normal" ? null : px(cs.lineHeight);
      var ls = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
      out.push({ t: "text", chars: raw.replace(/\s+/g, " ").trim(),
                 x: b.x, y: b.y, w: b.w, h: b.h, wrap: wrapped,
                 size: px(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
                 color: rgb(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
                 lh: lh, ls: ls, align: cs.textAlign,
                 deco: cs.textDecorationLine, transform: cs.textTransform });
    }
  }

  /* Two-stop linear gradients only — that is all the prototype uses, and it
     keeps the payload small enough to inline in a plugin script. */
  function gradient(cs) {
    var bi = cs.backgroundImage;
    if (!bi || bi.indexOf("linear-gradient") < 0) return null;
    var m = bi.match(/linear-gradient\(([^]*)\)$/);
    if (!m) return null;
    var body = m[1];
    var parts = [], depth = 0, cur = "";
    for (var i = 0; i < body.length; i++) {
      var ch = body[i];
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    var angle = 180;
    if (/^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift());
    else if (/^to\s/.test(parts[0])) { var d = parts.shift();
      angle = /bottom/.test(d) ? 180 : /top/.test(d) ? 0 : /right/.test(d) ? 90 : 270; }
    var stops = parts.map(function (s) { return rgb(s); }).filter(Boolean);
    if (stops.length < 2) return null;
    return { angle: angle, stops: stops };
  }

  function paints(el, cs) {
    var bg = rgb(cs.backgroundColor);
    var gr = gradient(cs);
    var bd = borders(cs), anyB = bd.some(Boolean);
    var sh = shadows(cs);
    return bg || gr || anyB || sh ? { bg: bg, gr: gr, bd: bd, sh: sh } : null;
  }

  function walk(el, depth) {
    if (SKIP[el.tagName]) return [];
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return [];
    if (el.hasAttribute && el.hasAttribute("hidden")) return [];
    var op = parseFloat(cs.opacity);
    if (op === 0) return [];
    var r = el.getBoundingClientRect();
    if (r.width < 0.5 && r.height < 0.5) return [];

    var kids = [];
    textNodes(el, cs, kids);
    if (el.tagName === "IMG" && el.src) {
      var ib = box(r);
      kids.push({ t: "image", src: el.src.slice(0, 32), x: ib.x, y: ib.y, w: ib.w, h: ib.h,
                  full: el.src.length > 200 ? "LOGO" : el.src });
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      var v = el.value || el.getAttribute("placeholder") || "";
      if (v) {
        var ib2 = box(r);
        var pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
        var fs = px(cs.fontSize);
        kids.push({ t: "text", chars: v, x: ib2.x + pl, y: ib2.y + pt,
                    w: Math.max(10, ib2.w - pl - (parseFloat(cs.paddingRight) || 0)),
                    h: fs * 1.35, wrap: false, size: fs,
                    weight: parseInt(cs.fontWeight, 10) || 400,
                    color: rgb(el.value ? cs.color : "rgba(142,150,163,1)") || { r: .5, g: .5, b: .5, a: 1 },
                    lh: null, ls: 0, align: cs.textAlign, deco: "none", transform: "none" });
      }
    }
    if (el.tagName === "SELECT") {
      var so = el.options[el.selectedIndex];
      if (so) {
        var sb = box(r);
        var spl = parseFloat(cs.paddingLeft) || 0, spt = parseFloat(cs.paddingTop) || 0;
        kids.push({ t: "text", chars: so.textContent.trim(), x: sb.x + spl, y: sb.y + spt,
                    w: Math.max(10, sb.w - spl - 20), h: px(cs.fontSize) * 1.35, wrap: false,
                    size: px(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
                    color: rgb(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
                    lh: null, ls: 0, align: "left", deco: "none", transform: "none" });
      }
    }
    for (var i = 0; i < el.children.length; i++) {
      kids = kids.concat(walk(el.children[i], depth + 1));
    }

    var p = paints(el, cs);
    if (!p) return kids;

    var b = box(r);
    var name = (el.tagName.toLowerCase() +
      (el.id ? "#" + el.id : "") +
      (el.className && typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")).slice(0, 40);
    /* children come back in page coordinates; the frame re-bases them */
    kids.forEach(function (k) { k.x = px(k.x - b.x); k.y = px(k.y - b.y); });
    return [{ t: "frame", n: name, x: b.x, y: b.y, w: b.w, h: b.h,
              bg: p.bg, gr: p.gr, bd: p.bd, sh: p.sh, radii: radii(cs),
              clip: cs.overflow !== "visible", op: op < 1 ? op : 1,
              children: kids }];
  }

  var tree = walk(root, 0);
  var rbb = { x:0, y:0, w: rb.width, h: rb.height };
  return { name: opts.name || "Screen", w: Math.round(rbb.w), h: Math.round(rbb.h),
           children: tree.map(function (n) { return n; }) };
};
"extractor ready";
