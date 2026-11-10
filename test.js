/* ============================================================================
   Headless walkthrough of the captain onboarding prototype.

   Run:  node test.js
   ========================================================================= */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

/* The page carries Leaflet inline. The harness takes it out, so the app runs the
   way it does with no map library: the Google-embed fallback, or the stand-in
   below when a test needs to tap the map. */
const LEAFLET_JS = /<script>\s*\/\* @preserve\s*\n \* Leaflet [\s\S]*?<\/script>/;
const PAGE = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
if (!LEAFLET_JS.test(PAGE)) throw new Error("inlined Leaflet script not found in index.html");
const HTML = PAGE.replace(LEAFLET_JS, "");

/* ------------------------------------------------------------- harness --- */

let passed = 0, failed = 0;
const failures = [];
let group = "";

function section(name) { group = name; console.log("\n" + name); }
function ok(msg)  { passed++; console.log("  [32m✓[0m " + msg); }
function bad(msg, detail) {
  failed++;
  failures.push(group + " → " + msg + (detail ? "\n      " + detail : ""));
  console.log("  [31m✗[0m " + msg + (detail ? "\n      " + detail : ""));
}
function check(cond, msg, detail) { cond ? ok(msg) : bad(msg, detail); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  a === e ? ok(msg) : bad(msg, "expected " + e + ", got " + a);
}

/* ------------------------------------------------------------ jsdom env --- */

/* The app boots on DOMContentLoaded. jsdom fires that asynchronously, after the
   constructor returns — so the harness must wait for it, or the app's own boot()
   lands mid-test and re-renders the DOM out from under whatever we are driving. */
async function boot({ beforeParse } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "http://localhost/",
    pretendToBeVisual: true,
    beforeParse
  });
  const win = dom.window;

  await new Promise((resolve) => {
    if (win.document.readyState === "complete") return resolve();
    win.addEventListener("load", () => resolve(), { once: true });
    win.document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });
  // let the boot handler's own render settle before anyone queries the DOM
  await new Promise((r) => win.setTimeout(r, 0));

  const doc = win.document;
  const api = win.__APP__;
  if (!api) throw new Error("window.__APP__ missing — app script did not run");
  api.reset();
  return { dom, win, doc, api };
}

const $ = (doc, id) => doc.getElementById(id);
const sel = (doc, q) => doc.querySelector(q);
/* Just the phase's own content column, and just the summary column beside it —
   scoped so an assertion about one screen cannot match the left nav rail, whose
   step labels describe other phases. */
const mainTxt = (doc) => {
  const col = doc.querySelector(".col-left");
  return col ? col.textContent.replace(/\s+/g, " ") : "";
};
const apVisible = (doc) =>
  [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
const railTxt = (doc) => {
  const rail = doc.querySelector(".rail");
  return rail ? rail.textContent.replace(/\s+/g, " ") : "";
};
const sideTxt = (doc) => {
  const col = doc.querySelector(".col-side");
  return col ? col.textContent.replace(/\s+/g, " ") : "";
};
/* What the app actually renders. body.textContent would also sweep in the
   inline <script> source — so assertions could match code comments instead of
   anything on screen — and the dev panel, which is not captain-facing. */
const txt = (doc) => {
  const app = doc.getElementById("app");
  if (!app) return "";
  const clone = app.cloneNode(true);
  [...clone.querySelectorAll("script,style")].forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, " ");
};

function click(doc, id) {
  const el = $(doc, id);
  if (!el) throw new Error("click: #" + id + " not found");
  if (el.disabled) throw new Error("click: #" + id + " is disabled");
  el.dispatchEvent(new (el.ownerDocument.defaultView.MouseEvent)("click", { bubbles: true }));
}
function clickSel(doc, q) {
  const el = sel(doc, q);
  if (!el) throw new Error("click: " + q + " not found");
  el.dispatchEvent(new (el.ownerDocument.defaultView.MouseEvent)("click", { bubbles: true }));
}
function type(doc, id, value) {
  const el = $(doc, id);
  if (!el) throw new Error("type: #" + id + " not found");
  el.value = value;
  el.dispatchEvent(new (el.ownerDocument.defaultView.Event)("input", { bubbles: true }));
}
function setCheck(doc, id, v) {
  const el = $(doc, id);
  if (!el) throw new Error("check: #" + id + " not found");
  el.checked = v;
  el.dispatchEvent(new (el.ownerDocument.defaultView.Event)("change", { bubbles: true }));
}
function exists(doc, q) { return !!sel(doc, q); }
function disabled(doc, id) { const el = $(doc, id); return !el || el.disabled; }

function waitFor(win, fn, label, ms = 9000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v = false;
      try { v = fn(); } catch (e) { /* mid-render */ }
      if (v) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error("timeout waiting for " + label));
      win.setTimeout(poll, 60);
    })();
  });
}

/* --------------------------------------------------------- flow drivers --- */

function login(doc, phone = "7004301290") {
  type(doc, "phone", phone);
  click(doc, "go-otp");
  for (let i = 0; i < 6; i++) {
    const cell = sel(doc, '.otp-cell[data-i="' + i + '"]');
    cell.value = "0";
    cell.dispatchEvent(new (doc.defaultView.Event)("input", { bubbles: true }));
  }
  click(doc, "verify-otp");
}

function pickRole(doc, code) { clickSel(doc, '[data-pick="' + code + '"]'); }

function doPersonalDetails(doc, { name = "Karan Verma" } = {}) {
  type(doc, "pd-name", name);
  type(doc, "pd-alt", "9876543210");
  type(doc, "pd-email", "karan.verma@gmail.com");
  click(doc, "pd-verify-email");
  type(doc, "pd-email-otp", "000000");
  click(doc, "pd-email-otp-go");
  setCheck(doc, "pd-tnc", true);
  click(doc, "pd-continue");
}

/* Hub details: the pincodes the hub will service, then the hub's own. */
function pickPincode(doc, pin) {
  type(doc, "hub-pins", pin);
  click(doc, "hub-addpin");
  type(doc, "hub-pin", pin);
}

/* KYC is a sequence of one-record-at-a-time cards (KYC-01…KYC-14), each with a
   confirmation screen between — so the driver walks it rather than filling a
   single page. */
function doKyc(doc, role) {
  const api = doc.defaultView.__APP__;

  // Aadhaar → DigiLocker OTP → confirmation
  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  click(doc, "kyc-ack-aadhaar");

  // PAN → confirmation
  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  click(doc, "kyc-ack-pan");

  // bank → confirmation
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  click(doc, "kyc-ack-bank");

  // GST
  if (role === "FM") {
    type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
    click(doc, "kyc-gst-go");
  } else {
    clickSel(doc, '[data-gstchoice="none"]');
    click(doc, "kyc-gst-go");
  }
  click(doc, "kyc-continue");
}

function pickMaxVehicle(doc, type) {
  const api = doc.defaultView.__APP__;
  if (!doc.getElementById("veh-toggle")) throw new Error("pickMaxVehicle: dropdown not on screen");
  if (!api.helpers.vehUI().open) click(doc, "veh-toggle");
  const row = sel(doc, '#veh-list [data-veh="' + type + '"]');
  if (!row) throw new Error("pickMaxVehicle: no row for " + type);
  row.dispatchEvent(new (doc.defaultView.MouseEvent)("click", { bubbles: true }));
}

/* A Google Maps link pinned at the centre of a pincode's area — so a driver's
   pin always lands inside the pincode it picked. */
function mapFor(doc, pin) {
  const a = doc.defaultView.__APP__.helpers.PIN_AREAS[pin];
  if (!a) throw new Error("mapFor: no area for " + pin);
  return "https://maps.google.com/?q=" + a.lat + "," + a.lng;
}

function doHubDetails(doc, { pin = "560076",
                              address = "No. 42, 4th Cross, Koramangala, Bengaluru",
                              map,
                              area = "4000", manpower = "12",
                              maxVehicle = "7MT_20FT" } = {}) {
  if (pin && exists(doc, "#hub-pins")) pickPincode(doc, pin);
  if (!map) map = mapFor(doc, doc.defaultView.__APP__.helpers.R().hub.selected || pin);
  type(doc, "hub-address", address);
  type(doc, "hub-map", map);
  type(doc, "hub-area", area);
  type(doc, "hub-manpower", manpower);
  pickMaxVehicle(doc, maxVehicle);
  click(doc, "hub-submit");
}

/* Slabs come from the central structure — five, in 2,500-order steps — so a
   test prices every one of them. */
function priceAllSlabs(api, rate) {
  const r = api.helpers.apById(api.state.admin.selected);
  r.rate.slabs.forEach((sl, i) => api.actions.chSlabField(i, "rate", rate));
}

function doAgreements(doc, api) {
  setCheck(doc, "ag-rate", true);
  api.actions.markAgreementRead();      // stands in for scroll-to-end (no layout in jsdom)
  setCheck(doc, "ag-service", true);
  click(doc, "ag-activate");
}

/* =========================================================================
   1. LM Captain — full flow, end to end
   ====================================================================== */

async function testLM() {
  section("1. LM Captain — full 9-phase flow");
  const { win, doc, api } = await boot();

  login(doc);
  check(api.state.screen === "roles", "login + OTP reaches role selection");

  pickRole(doc, "LM");
  eq(api.state.activeRole, "LM", "LM role opened");
  eq(api.config.PHASES.LM.length, 9, "LM has 9 phases");

  doPersonalDetails(doc);
  eq(api.helpers.phaseId(), "kyc", "personal details → KYC");
  check(!exists(doc, "#hub-pins") && !exists(doc, '[data-testid="pincode-picker"]'),
        "personal details no longer asks for pincodes");

  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "KYC → hub details (now before background verification)");
  check(api.helpers.R().kyc.gst.registered === false,
        "LM accepted Non-GST as a complete GST answer (optional toggle)");

  check(exists(doc, '[data-testid="pincode-picker"]'),
        "hub details carries the serviceable-pincode check");
  doHubDetails(doc);
  eq(api.helpers.R().hub.selected, "560076", "serviceable pincode selected on hub details");
  eq(api.helpers.R().hub.pincode, "560076", "and recorded as the hub's pincode");
  const lmHubCode = api.helpers.R().hub.hubCode;
  check(!!lmHubCode && /^[A-Z]{3}$/.test(lmHubCode),
        "LM hub code generated at hub submit (" + lmHubCode + ")");

  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "bgv", "hub details → background verification");

  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "BGV passed → Cluster Head review");

  api.actions.chApprove();
  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "sd", "CH approved → security deposit (LM only)");

  click(doc, "sd-pay");
  click(doc, "sd-continue");
  eq(api.helpers.phaseId(), "am", "deposit paid → Area Manager verification");

  api.actions.amApprove();
  click(doc, "am-continue");
  eq(api.helpers.phaseId(), "ag", "AM approved → agreements");

  check(disabled(doc, "ag-service"),
        "service agreement checkbox is disabled before scroll-to-end");
  setCheck(doc, "ag-rate", true);
  check(disabled(doc, "ag-activate"), "activate stays disabled with only the rate accepted");
  api.actions.markAgreementRead();
  check(!disabled(doc, "ag-service"), "service checkbox enables after reading to the end");
  setCheck(doc, "ag-service", true);
  click(doc, "ag-activate");

  eq(api.helpers.phaseId(), "act", "agreements accepted → activation");
  await waitFor(win, () => api.helpers.R().act.status === "active", "LM activation");

  const lm = api.helpers.R();
  eq(lm.act.status, "active", "LM activation completes");
  check(!!lm.act.vendorId, "LM mints an Oracle vendor ID (" + lm.act.vendorId + ")");
  check(!lm.act.partnerId, "LM does not mint an FM Partner ID");
  eq(Object.keys(lm.act.done).length, 6, "all 6 LM fan-out targets completed");
  const lmFan = api.config.FANOUT.LM.map(f => f.label);
  eq(lmFan, ["Vendor account","Hub setup","Captain profile","Login access","Agreements","Payments"],
     "LM fan-out list matches the brief");
  check(lm.complete, "LM role marked complete");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   2. FM Captain — full flow, combined mode, within benchmark
   ====================================================================== */

async function testFMCombined() {
  section("2. FM Captain — 7 phases, combined rate, within benchmark");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");

  const ids = api.config.PHASES.FM.map(p => p.id);
  eq(ids, ["pd","kyc","hub","bgv","ch","ag","act"], "FM phase list has no SD and no AM");
  eq(ids.indexOf("hub") < ids.indexOf("bgv"), true, "hub details comes before background verification");
  check(ids.indexOf("sd") === -1, "FM has no security deposit phase");
  check(ids.indexOf("am") === -1, "FM has no standalone Area Manager phase");

  doPersonalDetails(doc);
  eq(api.helpers.phaseId(), "kyc", "FM personal details → KYC");

  /* --- KYC is walked one record at a time (KYC-01…KYC-14) --- */
  eq(api.helpers.kycStep(api.helpers.R()), "aadhaar", "KYC opens on Aadhaar, not a combined form");
  check(exists(doc, "#kyc-aadhaar"), "the Aadhaar field is on screen");
  check(!exists(doc, "#kyc-pan"), "PAN is not on the same page");
  check(!exists(doc, "#kyc-acc"), "nor the bank account");
  check(!exists(doc, "[data-gstchoice]"), "nor GST");

  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");

  /* a confirmation screen sits between records, showing the fetched record */
  eq(api.helpers.kycStep(api.helpers.R()), "aadhaar-done", "Aadhaar lands on its confirmation");
  check(exists(doc, '[data-testid="aadhaar-fetched"]'), "which shows what was fetched from Aadhaar");
  check(txt(doc).indexOf("Aadhaar verified") >= 0, "and says Aadhaar is verified");
  check(txt(doc).indexOf("14 Aug 1990") >= 0, "including the date of birth");
  check(exists(doc, "#kyc-ack-aadhaar"), "with a continue button onto PAN");
  check(!exists(doc, "#kyc-pan"), "PAN still is not shown yet");
  click(doc, "kyc-ack-aadhaar");

  eq(api.helpers.kycStep(api.helpers.R()), "pan", "then PAN, on its own card");
  check(exists(doc, "#kyc-pan") && exists(doc, "#kyc-pan-father"), "PAN and father's name together");
  check(!exists(doc, "#kyc-aadhaar"), "Aadhaar is no longer on screen");
  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  eq(api.helpers.kycStep(api.helpers.R()), "pan-done", "PAN lands on its confirmation");
  click(doc, "kyc-ack-pan");

  eq(api.helpers.kycStep(api.helpers.R()), "bank", "then the bank account");
  check(!exists(doc, "#kyc-holder"), "with no account holder name field before verification");
  check(!exists(doc, "#kyc-cheque-go"),
        "FM has no cancelled-cheque upload (penny-drop covers the bank)");
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  eq(api.helpers.kycStep(api.helpers.R()), "bank-done", "bank lands on its confirmation");
  eq(api.helpers.R().kyc.bank.holder, "Karan Verma", "the penny-drop returns the holder name");
  click(doc, "kyc-ack-bank");

  /* GST: the GSTIN straight away — no Non-GST option, a deliberate link instead */
  eq(api.helpers.kycStep(api.helpers.R()), "gst", "then GST status");
  check(!exists(doc, "[data-gstchoice]"), "FM isn’t offered a Non-GST option to pick");
  check(exists(doc, "#kyc-gstin"), "the GSTIN field is on screen straight away");
  check(exists(doc, "#kyc-nogst-open"), "with a Don’t have GST? link under it");
  type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
  click(doc, "kyc-gst-go");

  /* complete (KYC-14) */
  eq(api.helpers.kycStep(api.helpers.R()), "complete", "all four records done → the summary");
  check(!disabled(doc, "kyc-continue"),
        "FM Continue enables on Aadhaar, PAN, bank and GST — MSME is not required");
  check(!api.helpers.R().kyc.msme.done, "and no MSME certificate has been uploaded");
  check(exists(doc, '[data-testid="msme-optional-upload"]'),
        "the optional MSME upload is offered on the completed card");
  check(txt(doc).indexOf("Not provided") >= 0,
        "the summary records MSME as not provided rather than claiming an upload");
  click(doc, "kyc-msme-go");
  check(!exists(doc, '[data-testid="msme-optional-upload"]'),
        "the upload prompt goes away once a certificate is attached");
  check(txt(doc).indexOf("Uploaded") >= 0, "and the summary flips to Uploaded");
  check(!disabled(doc, "kyc-continue"), "Continue stays enabled after uploading it");
  click(doc, "kyc-continue");
  eq(api.helpers.phaseId(), "hub", "FM KYC → hub details (now before background verification)");

  doHubDetails(doc, { address: "Plot 7, 16th Main, BTM Layout 2nd Stage, Bengaluru",
                      area: "6500", manpower: "18", maxVehicle: "10MT_32FT" });
  check(!api.helpers.R().hub.hubCode,
        "FM hub details submit does NOT generate a hub code");
  check(exists(doc, '[data-testid="fm-no-hubcode"]'),
        "FM is told the hub code is finalised later");
  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "bgv", "FM hub details → background verification");

  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "FM BGV → Cluster Head review");

  /* --- hub category gate: internal, and not explained to the captain --- */
  check(exists(doc, '[data-testid="waiting-category"]'),
        "FM Cluster Head holds the request while the category is unset");
  check(!api.helpers.chCanDecide(api.helpers.R()),
        "Cluster Head cannot decide before the AM sets hub category");
  /* The captain is shown a plain "under review" state — none of the internal
     mechanics about who classifies the hub or when. */
  const waitingCopy = txt(doc);
  check(waitingCopy.indexOf("Cluster Head review in progress") >= 0,
        "the captain sees a plain review-in-progress state");
  ["Area Manager input", "not something you fill in", "hub classification",
   "site survey", "benchmark rate ceiling is determined"].forEach(phrase => {
    check(waitingCopy.indexOf(phrase) === -1,
          "no hub-category explainer shown to the captain: \"" + phrase + "\"");
  });
  api.actions.chApprove();
  eq(api.helpers.R().ch.status, "pending",
     "approve is a no-op while hub type is unset");

  api.actions.chSetCategory("standalone");     // ceiling 5, touchpoint 5
  eq(api.helpers.ceilingFor(api.helpers.R()), 3.5, "a Bengaluru Standalone hub’s ceiling reads 3.50");
  check(api.helpers.chCanDecide(api.helpers.R()),
        "Cluster Head can decide once the category arrives");
  /* The category and the ceiling it drives are internal — the captain sees
     neither, on any FM screen. */
  ["Hub category", "Standalone", "Benchmark ceiling", "benchmark ceiling"].forEach(phrase => {
    check(mainTxt(doc).indexOf(phrase) === -1,
          "Cluster Head review does not show: \"" + phrase + "\"");
    check(sideTxt(doc).indexOf(phrase) === -1,
          "the application summary does not show: \"" + phrase + "\"");
  });
  check(railTxt(doc).indexOf("Hub category") === -1,
        "and the rail does not label the phase with it either");

  /* The Area Manager authors the rate card; the Cluster Head only judges it. */
  api.actions.chApprove();
  eq(api.helpers.R().ch.status, "pending",
     "approve is a no-op before the Area Manager submits a rate card");

  api.actions.amSubmitRate(false);
  const submitted = api.helpers.R().ch;
  check(submitted.slabs.length > 1, "the Area Manager's card carries slab bands");
  check(!!submitted.touchpoint, "and one touchpoint rate");
  check(!api.helpers.chAboveCeiling(api.helpers.R()),
        "this one sits inside both ceilings");

  api.actions.chApprove();
  const ch = api.helpers.R().ch;
  eq(ch.status, "approved", "within-ceiling rate clears at the Cluster Head");
  eq(ch.decidedBy, "ch", "decided by the Cluster Head, not raised");
  eq(ch.rateMode, "combined", "combined rate card mode recorded");
  check(txt(doc).indexOf("within ceiling") === -1,
        "a within-ceiling rate is shown without a 'within ceiling' suffix");
  check(txt(doc).indexOf("set by Area Manager") === -1,
        "and the category is not attributed to the Area Manager");
  check(!exists(doc, '[data-testid="split-caveat"]'),
        "no split caveat shown in combined mode");

  /* --- the approved rate card reaches the captain, slab-wise --- */
  const capCh = api.helpers.R().ch;
  check(capCh.slabs.length > 1, "approval books a slab rate card for the captain");
  check(!!capCh.touchpoint, "with a touchpoint rate");
  check(exists(doc, '[data-testid="captain-rate-card"]'), "shown on the Cluster Head screen");
  const rateTxt = mainTxt(doc);
  check(rateTxt.indexOf("Approved rate card") >= 0, "labelled as the approved rate card");
  capCh.slabs.forEach(sl => {
    check(rateTxt.indexOf(api.helpers.slabLabel(sl)) >= 0,
          "the captain sees the band: " + api.helpers.slabLabel(sl));
    check(rateTxt.indexOf("₹" + sl.rate) >= 0, "and its rate: ₹" + sl.rate);
  });
  check(rateTxt.indexOf("Touchpoint rate") >= 0, "and the touchpoint rate");
  check(rateTxt.indexOf("₹" + capCh.touchpoint) >= 0, "with its value");

  /* --- the combined blurb describes the card, it does not blend it --- */
  check(exists(doc, '[data-testid="combined-blurb"]'), "the combined blurb is shown");
  const blurb = sel(doc, '[data-testid="combined-blurb"]').textContent;
  check(blurb.indexOf("order rate plus the touchpoint rate") >= 0,
        "it says order rate plus touchpoint");
  check(blurb.indexOf("paid together") >= 0, "and that they are paid together");
  check(blurb.indexOf("blended") === -1, "no 'blended figure' claim");
  check(blurb.indexOf("single per-shipment rate") === -1,
        "and no single per-shipment rate that would contradict the slabs above");
  check(!/₹\d/.test(blurb),
        "the blurb quotes no figure of its own — the slabs and touchpoint are the only ones");
  /* the legacy blended field must not reach the captain's screen */
  api.helpers.R().ch.rate = 99.99;
  api.render();
  check(mainTxt(doc).indexOf("99.99") === -1,
        "the legacy r.ch.rate is never displayed on the FM rate card");
  /* still no category or ceiling */
  ["Hub category","ceiling","Standalone"].forEach(w =>
    check(rateTxt.indexOf(w) === -1, "the slab card reveals no internals: " + w));

  eq($(doc, "ch-continue").textContent.trim(), "Continue →",
     "the button after Cluster Head approval just says Continue");
  check(mainTxt(doc).toLowerCase().indexOf("deposit") === -1, "and nothing on the screen mentions a deposit");
  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "ag",
     "FM CH approved → agreements (no security deposit, no AM phase)");

  check(exists(doc, '[data-testid="agreement-rate-card"]'),
        "agreements shows the agreed rate card slab-wise");
  const agTxt = mainTxt(doc);
  api.helpers.R().ch.slabs.forEach(sl =>
    check(agTxt.indexOf(api.helpers.slabLabel(sl)) >= 0,
          "agreements lists the band: " + api.helpers.slabLabel(sl)));
  check(agTxt.indexOf("Touchpoint rate") >= 0, "and the touchpoint rate");
  check(mainTxt(doc).indexOf("Hub category") === -1,
        "the agreements card does not show hub category");
  check(sideTxt(doc).indexOf("Hub category") === -1,
        "and neither does the application summary beside it");
  check(mainTxt(doc).indexOf("Agreed rate") >= 0, "it shows the agreed rate instead");
  doAgreements(doc, api);
  eq(api.helpers.phaseId(), "act", "FM agreements → activation");

  await waitFor(win, () => api.helpers.R().act.status === "active", "FM activation");

  const fm = api.helpers.R();
  eq(fm.act.status, "active", "FM activation completes");
  check(!!fm.act.partnerId, "FM mints an internal Partner ID (" + fm.act.partnerId + ")");
  check(!fm.act.vendorId, "FM does NOT mint an Oracle vendor ID");
  check(!!fm.hub.hubCode,
        "FM hub code is issued at design & hub-code mapping (" + fm.hub.hubCode + ")");
  const fmFan = api.config.FANOUT.FM.map(f => f.label);
  eq(fmFan, ["Hub code","Partner ID","Captain profile","Login access",
             "Agreements","Payments"], "FM fan-out list matches the brief");
  check(api.config.FANOUT.FM[0].passive === true,
        "design & hub-code mapping is a passive checklist item");
  /* Seller-to-hub mapping is out of scope. "SAH (seller as hub)" is a category
     name and is allowed; any seller *mapping* affordance is not. */
  const fmProse = txt(doc).toLowerCase();
  check(fmProse.indexOf("seller-to-hub") === -1 &&
        fmProse.indexOf("seller to hub") === -1 &&
        fmProse.indexOf("map seller") === -1 &&
        fmProse.indexOf("seller mapping") === -1,
        "no seller-to-hub mapping anywhere in the FM flow");
  check(!sel(doc, '[id*="seller"]') && !sel(doc, '[data-testid*="seller"]'),
        "no seller-mapping control rendered in the FM flow");
  check(fm.complete, "FM role marked complete");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   3. FM above ceiling — CH raises, Central Admin rejects, AM reprices, approved
   ====================================================================== */

async function testFMAboveCeiling() {
  section("3. FM above ceiling — raise, Central reject, AM revision, approve");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "reached Cluster Head review");

  api.actions.chSetCategory("mall");            // Bengaluru: 3.50 a slab, touchpoint fixed at 2
  eq(api.helpers.ceilingFor(api.helpers.R()), 3.5, "a Bengaluru Mall hub’s first-slab ceiling reads 3.50");

  /* --- the Area Manager prices above the ceiling --- */
  api.actions.amSubmitRate(true);
  let r = api.helpers.R();
  check(api.helpers.chAboveCeiling(r), "the submitted card is above the mall-hub ceiling");
  eq(r.ch.rateMode, "combined", "only Combined exists");
  check(!exists(doc, '[data-testid="captain-rate-card"]') && txt(doc).indexOf("Proposed rate card") === -1,
        "while the Cluster Head reviews it, the captain sees no rate card");

  api.actions.chApprove();
  eq(api.helpers.R().ch.status, "pending",
     "the Cluster Head cannot settle an above-ceiling card");

  /* --- so it is raised; the captain is told a sign-off is pending, no more --- */
  api.actions.chRaise();
  r = api.helpers.R();
  eq(r.ch.status, "central", "above-ceiling card is raised to Central Admin");
  check(!exists(doc, '[data-testid="captain-rate-card"]'), "and none while it waits for BizFin either");
  check(exists(doc, '[data-testid="ch-signoff"]'), "captain sees a pending sign-off state");
  check(mainTxt(doc).indexOf("need one more approval") >= 0,
        "copy says only that one more sign-off is needed");
  check(txt(doc).indexOf("Zonal Head") === -1, "no Zonal Head anywhere on the page");
  check(txt(doc).indexOf("Central Admin") === -1, "and the deciding desk is not named either");
  check(txt(doc).indexOf("Rakesh Sharma") >= 0,
        "the Cluster Head stays the captain's contact");
  ["Hub category", "hub category", "ceiling", "benchmark", "Mall hub"].forEach(phrase => {
    check(mainTxt(doc).indexOf(phrase) === -1,
          "the sign-off state does not reveal: \"" + phrase + "\"");
  });

  /* --- Central Admin rejects; the card goes back to the Area Manager --- */
  api.actions.centralReject();
  r = api.helpers.R();
  eq(r.ch.status, "revision", "a Central Admin rejection sends the card back to the AM");
  eq(r.ch.revision.by, "BizFin", "and records which desk sent it back");
  check(exists(doc, '[data-testid="ch-revision"]'), "captain sees a revision state");
  check(mainTxt(doc).indexOf("Your Area Manager is updating your rates") >= 0,
        "copy names only the Area Manager");
  check(mainTxt(doc).indexOf("reject") === -1 && mainTxt(doc).indexOf("Reject") === -1,
        "the captain is not told it was rejected");
  ["Zonal Head", "hub category", "Hub category", "ceiling", "benchmark"].forEach(phrase => {
    check(txt(doc).indexOf(phrase) === -1,
          "the revision state does not reveal: \"" + phrase + "\"");
  });

  /* --- the AM reprices inside the ceiling and it clears at the Cluster Head --- */
  api.actions.amReprice();
  r = api.helpers.R();
  eq(r.ch.status, "pending", "repricing puts it back in front of the Cluster Head");
  check(!api.helpers.chAboveCeiling(r), "and the revised card is inside both ceilings");
  eq(r.ch.revision, null, "the revision marker is cleared");

  api.actions.chApprove();
  r = api.helpers.R();
  eq(r.ch.status, "approved", "the revised card clears at the Cluster Head");
  eq(r.ch.decidedBy, "ch", "attributed to the Cluster Head");
  check(exists(doc, '[data-testid="captain-rate-card"]') && txt(doc).indexOf("Approved rate card") >= 0,
        "once approved, the captain sees the final rate card");

  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "ag", "approved request moves on to agreements");

  /* --- a Cluster Head rejection routes to the AM, never to the captain --- */
  api.helpers.goPhase("ch");
  api.actions.chReject();
  r = api.helpers.R();
  eq(r.ch.status, "revision", "a Cluster Head rejection also goes back to the AM");
  eq(r.ch.revision.by, "Cluster Head", "recorded as the Cluster Head's send-back");
  check(!exists(doc, "#ch-back-pd"),
        "the captain is given no corrections to make \u2014 it is not their rate card");

  /* --- Central Admin can also approve outright --- */
  api.actions.amSubmitRate(true);
  api.actions.chRaise();
  api.actions.centralApprove();
  r = api.helpers.R();
  eq(r.ch.status, "approved", "Central Admin approval clears the phase");
  eq(r.ch.decidedBy, "central", "attributed internally to Central Admin");
  check(mainTxt(doc).indexOf("Your request and rate card were approved") >= 0,
        "but the captain copy names no desk");
  check(txt(doc).indexOf("Central Admin") === -1,
        "and still does not say Central Admin");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   4. Role independence
   ====================================================================== */

async function testRoleIndependence() {
  section("4. Role independence — FM must not disturb LM");
  const { win, doc, api } = await boot();

  login(doc);

  /* LM: get partway in, then leave it alone. */
  pickRole(doc, "LM");
  doPersonalDetails(doc, { name: "Karan LM" });
  doKyc(doc, "LM");
  doHubDetails(doc, { address: "No. 42, Koramangala" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  const lmBefore = JSON.parse(JSON.stringify(api.state.roles.LM));
  eq(lmBefore.pd.name, "Karan LM", "LM captured its own name");
  eq(api.helpers.phaseId(), "bgv", "LM parked at background verification");

  /* Switch to FM and run a different set of inputs through it. */
  check(!exists(doc, "#switch-role") && !exists(doc, ".rail #logout"),
        "the onboarding rail has no Log out or Switch role");
  click(doc, "save-exit");
  eq(api.state.screen, "roles", "Save & Exit returns to role selection mid-flow");
  pickRole(doc, "FM");
  doPersonalDetails(doc, { name: "Karan FM" });
  eq(api.state.roles.FM.pd.name, "Karan FM", "FM captured its own name");
  eq(api.state.roles.FM.hub.selected, null, "FM's hub pincode is its own \u2014 not yet picked");

  const lmAfter = api.state.roles.LM;
  eq(lmAfter.pd.name, "Karan LM", "LM name untouched by the FM run");
  eq(lmAfter.hub.selected, "560076", "LM hub pincode untouched by the FM run");
  eq(lmAfter.phaseIdx, lmBefore.phaseIdx, "LM phase index untouched");
  eq(lmAfter.bgv.status, "passed", "LM background verification result untouched");
  eq(lmAfter.kyc.gst.registered, false, "LM Non-GST answer untouched");
  check(api.state.roles.FM.kyc.aadhaar.done === false,
        "FM KYC is independent and still empty");

  /* Resume LM where it was left. */
  click(doc, "save-exit");
  pickRole(doc, "LM");
  eq(api.state.activeRole, "LM", "LM reopened");
  eq(api.helpers.phaseId(), "bgv", "LM resumed exactly where it was left");

  /* Persistence: both subtrees round-trip through localStorage. */
  const raw = win.localStorage.getItem(api.STORE_KEY);
  check(!!raw, "state persisted to localStorage");
  const saved = JSON.parse(raw);
  eq(saved.roles.LM.pd.name, "Karan LM", "LM persisted independently");
  eq(saved.roles.FM.pd.name, "Karan FM", "FM persisted independently");

  /* A completed role moves to Active; an in-flight one offers Continue. */
  api.state.roles.FM.complete = true;
  api.actions.switchRole();
  const body = txt(doc);
  check(body.indexOf("Active roles (1)") >= 0, "completed role counted under Active roles");
  check(body.indexOf("Continue onboarding") >= 0,
        "in-progress role offers 'Continue onboarding'");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   5. Validation error paths
   ====================================================================== */

async function testValidation() {
  section("5. Validation error paths");
  const { win, doc, api } = await boot();
  const E = api.errors;

  login(doc);
  pickRole(doc, "LM");

  /* --- pincode rules, now on hub details --- */
  api.helpers.goPhase("hub");
  type(doc, "hub-pins", "12ab5");
  click(doc, "hub-addpin");
  check(txt(doc).indexOf(E.pincodeFormat) >= 0, "bad pincode → '" + E.pincodeFormat + "'");
  eq(api.helpers.R().hub.pincodes.length, 0, "bad pincode not added");

  type(doc, "hub-pins", "012345");
  click(doc, "hub-addpin");
  check(txt(doc).indexOf(E.pincodeFormat) >= 0, "pincode starting with 0 rejected");

  /* --- duplicate --- */
  type(doc, "hub-pins", "560076");
  click(doc, "hub-addpin");
  type(doc, "hub-pins", "560076");
  click(doc, "hub-addpin");
  check(txt(doc).indexOf(E.pincodeDupe) >= 0, "duplicate pincode → '" + E.pincodeDupe + "'");
  eq(api.helpers.R().hub.pincodes.length, 1, "duplicate not added twice");

  /* --- max 5 --- */
  ["560034","560102","110017","400059"].forEach(p => {
    type(doc, "hub-pins", p); click(doc, "hub-addpin");
  });
  eq(api.helpers.R().hub.pincodes.length, 5, "five pincodes accepted");
  api.actions.addPincode("560001");
  check(txt(doc).indexOf(E.pincodeMax) >= 0, "sixth pincode → '" + E.pincodeMax + "'");
  eq(api.helpers.R().hub.pincodes.length, 5, "sixth pincode not added");

  /* --- a hub cannot be submitted without a chosen pincode --- */
  api.actions.removePincode("400059");
  api.actions.hubSubmit({ address: "No. 42, Koramangala", mapLink: "https://maps.google.com/?q=12.9352,77.6245",
                          areaSqft: "4000", manpower: "12", maxVehicle: "7MT_20FT" });
  check(!api.helpers.R().hub.submitted, "hub details refuse to submit with no pincode picked");
  check(txt(doc).indexOf(E.pincodeSelect) >= 0, "and say why: '" + E.pincodeSelect + "'");

  /* --- email --- */
  api.helpers.goPhase("pd");
  type(doc, "pd-email", "not-an-email");
  api.actions.sendEmailOtp();
  check(txt(doc).indexOf(E.email) >= 0, "invalid email → '" + E.email + "'");

  /* --- email OTP lockout after 3 wrong codes --- */
  type(doc, "pd-email", "karan.verma@gmail.com");
  click(doc, "pd-verify-email");
  api.actions.confirmEmailOtp("111111");
  api.actions.confirmEmailOtp("222222");
  api.actions.confirmEmailOtp("333333");
  check(api.helpers.R().pd.emailLocked, "email verification locks after 3 wrong codes");

  /* --- KYC field regexes (checked against the validators directly) --- */
  check(!api.validate.pan("ABCD1234F"),   "PAN regex rejects a short PAN");
  check(!api.validate.pan("12345ABCDE"),  "PAN regex rejects a transposed PAN");
  check(api.validate.pan("ABCDE1234F"),   "PAN regex accepts a well-formed PAN");
  check(!api.validate.ifsc("HDFC1001234"),"IFSC regex rejects a non-zero 5th character");
  check(!api.validate.ifsc("HDFC000123"), "IFSC regex rejects a short IFSC");
  check(api.validate.ifsc("HDFC0001234"), "IFSC regex accepts a well-formed IFSC");
  check(!api.validate.gstin("29ABCDE1234"),        "GSTIN rejects wrong length");
  check(api.validate.gstin("29ABCDE1234F1Z5"),     "GSTIN accepts 15 characters");
  check(!api.validate.mapLink("maps.google.com"),  "map link rejects a bare host");
  check(!api.validate.mapLink("https://example.com/x"), "map link rejects a non-Maps URL");
  check(api.validate.mapLink("https://maps.google.com/?q=12.9,77.6"),
        "map link accepts a Google Maps URL");
  check(api.validate.mapLink("https://maps.app.goo.gl/abc123"),
        "map link accepts a Maps short link");

  /* --- KYC error copy surfaces in the UI, on each record's own card --- */
  api.helpers.goPhase("kyc");

  /* a bad Aadhaar is caught before the flow moves on */
  type(doc, "kyc-aadhaar", "12345");
  click(doc, "kyc-aadhaar-go");
  check(txt(doc).indexOf(E.aadhaar) >= 0, "bad Aadhaar → '" + E.aadhaar + "'");
  check(!api.helpers.R().kyc.aadhaar.done, "Aadhaar not marked verified on a bad input");
  check(!exists(doc, "#kyc-pan"), "and the flow does not advance to PAN");

  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  click(doc, "kyc-ack-aadhaar");

  type(doc, "kyc-pan", "BADPAN");
  type(doc, "kyc-pan-father", "");
  click(doc, "kyc-pan-go");
  check(txt(doc).indexOf(E.pan) >= 0, "bad PAN → '" + E.pan + "'");
  check(txt(doc).indexOf(E.panFather) >= 0, "missing father's name → '" + E.panFather + "'");
  check(!api.helpers.R().kyc.pan.done, "PAN not marked verified on a bad input");
  check(!exists(doc, "#kyc-acc"), "and the flow does not advance to the bank step");

  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  click(doc, "kyc-ack-pan");

  type(doc, "kyc-acc", "12");
  type(doc, "kyc-ifsc", "BADIFSC");
  click(doc, "kyc-bank-go");
  check(txt(doc).indexOf(api.vx.accShort) >= 0, "short account number → '" + api.vx.accShort + "'");
  check(txt(doc).indexOf(api.vx.ifscFormat) >= 0, "bad IFSC → '" + api.vx.ifscFormat + "'");
  check(!api.helpers.R().kyc.bank.done, "bank not marked verified on a bad input");

  /* --- map link error copy --- */
  api.helpers.goPhase("hub");
  type(doc, "hub-address", "");
  type(doc, "hub-map", "notalink");
  click(doc, "hub-submit");
  check(txt(doc).indexOf(E.mapLink) >= 0, "bad map link → '" + E.mapLink + "'");
  check(txt(doc).indexOf(E.hubAddress) >= 0, "empty hub address → '" + E.hubAddress + "'");
  check(!api.helpers.R().hub.submitted, "hub not submitted while invalid");

  /* --- login + OTP lockout --- */
  api.reset();
  type(doc, "phone", "12345");
  check(disabled(doc, "go-otp"), "Login stays disabled for an invalid phone number");
  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 6; i++) {
      const c = sel(doc, '.otp-cell[data-i="' + i + '"]');
      if (!c) break;
      c.value = "9";
      c.dispatchEvent(new (doc.defaultView.Event)("input", { bubbles: true }));
    }
    const vb = $(doc, "verify-otp");
    if (vb && !vb.disabled) click(doc, "verify-otp");
  }
  check(api.state.otpLocked, "OTP locks after 3 wrong attempts");
  check(txt(doc).indexOf(E.otpLocked) >= 0, "lockout copy shown");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   5b. OTP entry survives the resend countdown
   Regression: the countdown tick used to call a full render(), replacing
   app.innerHTML every second. That destroyed the OTP inputs and dropped focus
   to <body>, so a real user could not type a 6-digit code while it ran.
   ====================================================================== */

async function testOtpFocusSurvivesCountdown() {
  section("5b. OTP entry survives the resend countdown");
  const { win, doc, api } = await boot();

  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  eq(api.state.screen, "otp", "reached the OTP screen with the countdown running");
  check(api.state.otpSeconds > 2, "countdown is running (" + api.state.otpSeconds + "s)");

  /* focus must survive a tick */
  const cell0 = sel(doc, '.otp-cell[data-i="0"]');
  cell0.focus();
  eq(doc.activeElement === cell0, true, "first OTP cell takes focus");

  const before = api.state.otpSeconds;
  await new Promise(r => win.setTimeout(r, 1300));
  check(api.state.otpSeconds < before,
        "countdown ticked down (" + before + " → " + api.state.otpSeconds + ")");
  check(sel(doc, '.otp-cell[data-i="0"]') === cell0,
        "OTP cell is not replaced by the countdown tick");
  check(doc.activeElement === cell0,
        "OTP cell keeps focus across a countdown tick");

  /* type the way a keyboard does: always into whatever currently has focus,
     relying on the app's own auto-advance rather than re-querying cells */
  sel(doc, '.otp-cell[data-i="0"]').focus();
  let focusEscaped = null;
  for (const ch of "000000") {
    const el = doc.activeElement;
    if (!el || !el.classList || !el.classList.contains("otp-cell")) {
      focusEscaped = el ? (el.tagName || "?") : "none";
      break;
    }
    el.value = ch;
    el.dispatchEvent(new (doc.defaultView.Event)("input", { bubbles: true }));
  }
  check(focusEscaped === null,
        "focus stays inside the OTP row for all six keystrokes",
        focusEscaped ? "focus escaped to <" + focusEscaped + ">" : "");
  eq(api.state.otp.join(""), "000000", "all six digits land in order");

  const verify = $(doc, "verify-otp");
  check(verify && !verify.disabled, "Verify OTP enables once six digits are entered");
  click(doc, "verify-otp");
  eq(api.state.screen, "roles", "typed-by-keyboard OTP verifies and reaches role selection");

  /* SMS autofill / paste: the whole code arrives in ONE cell. The handler used
     to keep only the last digit and drop the other five. */
  api.reset();
  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  const pasteTarget = sel(doc, '.otp-cell[data-i="0"]');
  pasteTarget.focus();
  pasteTarget.value = "000000";
  pasteTarget.dispatchEvent(new (doc.defaultView.Event)("input", { bubbles: true }));
  eq(api.state.otp.join(""), "000000", "a 6-digit code autofilled into one cell spreads across all six");
  const cellValues = [0,1,2,3,4,5].map(i => sel(doc, '.otp-cell[data-i="' + i + '"]').value).join("");
  eq(cellValues, "000000", "every cell shows its digit after autofill");
  const vb2 = $(doc, "verify-otp");
  check(vb2 && !vb2.disabled, "Verify enables straight after autofill");
  click(doc, "verify-otp");
  eq(api.state.screen, "roles", "autofilled OTP verifies");

  /* a partial paste mid-row fills forward from that cell, not from the start */
  api.reset();
  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  const mid = sel(doc, '.otp-cell[data-i="2"]');
  mid.focus();
  mid.value = "789";
  mid.dispatchEvent(new (doc.defaultView.Event)("input", { bubbles: true }));
  eq(api.state.otp.join(""), "__789".replace(/_/g, ""), "partial paste fills forward from the focused cell");
  eq(api.state.otp, ["","","7","8","9",""], "earlier and later cells are left alone");

  /* the countdown still resolves to a working Resend control */
  api.reset();
  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  api.state.otpSeconds = 1;
  await new Promise(r => win.setTimeout(r, 1400));
  check(!!sel(doc, "#resend"), "countdown expiring swaps in the Resend OTP button");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   6. LM two-strike Area Manager rule
   ====================================================================== */

async function testAmTwoStrike() {
  section("6. LM Area Manager two-strike rule");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
  doHubDetails(doc);
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  eq(api.helpers.phaseId(), "am", "reached Area Manager verification");

  api.actions.amReject("Loading bay too narrow.");
  let r = api.helpers.R();
  eq(r.am.status, "rejected", "first AM rejection keeps the case with the AM");
  eq(r.am.rejections, 1, "first strike counted");
  check(!!sel(doc, "#am-fix-hub"), "captain is routed back to reconfirm hub details");

  click(doc, "am-fix-hub");
  eq(api.helpers.phaseId(), "hub", "AM rejection routes the captain back to hub details");
  check(!api.helpers.R().hub.submitted, "hub details reopened for editing");

  doHubDetails(doc, { address: "No. 42, 4th Cross, Koramangala, Bengaluru (rear gate)" });
  click(doc, "hub-continue");
  /* Hub details now sits before background verification, so resubmitting after an
     AM rejection must jump straight back to the AM rather than walking the captain
     forward through BGV, Cluster Head and the deposit all over again. */
  eq(api.helpers.phaseId(), "am",
     "resubmitted hub details returns to the Area Manager, not back through BGV");
  eq(api.helpers.R().am.status, "pending", "the AM check is pending again");

  api.actions.amReject("Still not compliant.");
  r = api.helpers.R();
  eq(r.am.rejections, 2, "second strike counted");
  eq(r.am.status, "escalated", "two AM rejections auto-escalate to the Cluster Head");
  check(exists(doc, '[data-testid="am-escalated"]'), "two-strike escalation state is shown");
  check(txt(doc).indexOf("Cluster Head") >= 0, "escalated case names the Cluster Head");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   7. Benchmark ceiling table
   ====================================================================== */

async function testCeilings() {
  section("7. Hub type ceilings and touchpoints — from the rate card sheet");
  const { win, api } = await boot();
  const C = api.config.HUB_CATEGORIES, H = api.helpers;

  /* the touchpoint is fixed per hub type */
  const expected = [
    ["standalone_mini", "Standalone (mini-hub)", 6],
    ["standalone",      "Standalone",            5],
    ["lm_as_fm",        "LM-as-FM",              6],
    ["mall",            "Mall hub",              2],
    ["sah",             "SAH (seller as hub)",   0]
  ];
  expected.forEach(([key, label, tp]) => {
    const c = C[key];
    check(c && c.label === label && c.tp === tp && c.tpCeiling === tp && H.fixedTp(key) === tp.toFixed(2),
          label + " → touchpoint fixed at ₹" + tp.toFixed(2),
          c ? "got tp " + c.tp + ", ceiling " + c.tpCeiling : "category missing");
  });

  /* slab ceilings: six 2,500-order columns, a slab held to the one it starts in */
  eq(api.config.CEILING_COLS, [0, 2500, 5000, 7500, 10000, 12500], "six columns, 2,500 orders apart");
  eq([0, 2500, 5000, 7500, 10000].map(f => H.slabCeiling("standalone_mini", "Anywhere", f)),
     [3.2, 3, 2.73, 2.55, 2.38], "mini-hub ceilings step down by slab, the same in every city");
  eq(H.slabCeiling("standalone_mini", "", 12500), 2.2, "and the column above 12,500 is 2.20");
  eq(H.slabCeiling("sah", "Mumbai, Maharashtra", 7500), 1.5, "SAH is 1.50 everywhere");
  eq(H.slabCeiling("lm_as_fm", "Bengaluru", 0), 6, "LM-as-FM keeps its flat 6.00 — the sheet leaves it blank");
  eq(H.slabCeiling("standalone", "Bengaluru, Karnataka", 0), 3.5, "Standalone in Bengaluru: 3.50");
  eq([0, 2500, 5000, 7500, 10000].map(f => H.slabCeiling("standalone", "New Delhi, Delhi", f)),
     [2.65, 2.5, 2.25, 2, 1.75], "Standalone in Delhi steps down from 2.65");
  eq(H.slabCeiling("mall", "Mumbai, Maharashtra", 0), 3.85, "Mall hub in Mumbai starts at 3.85");
  eq(H.cityKey("New Delhi, Delhi"), "Delhi", "“New Delhi” reads as the sheet’s Delhi");
  eq(H.slabCeiling("standalone", "Resolved from pincode", 0), null, "a city off the sheet has no Standalone ceiling");

  /* above or within */
  const card = rates => ({ slabs:rates.map((r, i) => ({ from:String(i * 2500), to:"", rate:r })) });
  check(!H.cardAbove("standalone_mini", "", card(["3.20", "3.00", "2.73", "2.55", "2.38"])),
        "a mini-hub card exactly on every ceiling is within");
  check(H.cardAbove("standalone_mini", "", card(["3.00", "2.90", "2.80", "2.40", "2.30"])),
        "one slab over its own ceiling (2.80 against 2.73) puts it above");
  check(H.cardAbove("standalone", "Kochi", card(["1.00", "1.00", "1.00", "1.00", "1.00"])),
        "a Standalone card in a city with no ceilings goes to BizFin, however low");
  eq(H.slabCeiling("standalone", "Jaipur, Rajasthan", 0), 2.55, "every city on the sheet has its ceilings (Jaipur 2.55)");
  eq(H.ceilingText("standalone_mini", ""), "₹3.20 → ₹2.20", "stepped ceilings read first to last");
  eq(H.ceilingText("standalone", "Bengaluru"), "₹3.50", "flat ceilings read as one figure");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   8. Dev-panel reject paths all reachable
   ====================================================================== */

async function testDevPanel() {
  section("8. Dev panel — every simulated actor is reachable");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");

  const devText = () => $(doc, "dev").textContent.replace(/\s+/g, " ");

  eq(api.helpers.phaseId(), "hub", "at hub details");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "bgv", "at background verification");
  check(devText().indexOf("Mark BGV passed") >= 0 && devText().indexOf("Mark BGV failed") >= 0,
        "BGV: pass and fail actions offered");

  api.actions.bgvSet("failed");
  check(!!sel(doc, "#bgv-retry"), "failed BGV offers a resubmit route");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");

  check(devText().indexOf("pick hub type") >= 0,
        "FM Area Manager: hub type buttons offered (one per category)");
  api.config.FANOUT; // no-op, keeps the config surface referenced
  Object.keys(api.config.HUB_CATEGORIES).forEach(k => {
    check(devText().indexOf(api.config.HUB_CATEGORIES[k].label) >= 0,
          "hub type button present: " + api.config.HUB_CATEGORIES[k].label);
  });

  api.actions.chSetCategory("sah");
  const d2 = devText();
  check(d2.indexOf("Submit rate card within ceiling") >= 0,
        "FM AM: submit within ceiling offered");
  check(d2.indexOf("Submit rate card above ceiling") >= 0,
        "FM AM: submit above ceiling offered");
  check(d2.indexOf("Approve rate card") === -1,
        "no Cluster Head decision until a rate card exists");

  api.actions.amSubmitRate(false);
  const dWithin = devText();
  check(dWithin.indexOf("Approve rate card") >= 0,
        "FM CH: approve offered on a within-ceiling card");
  check(dWithin.indexOf("Raise to BizFin") === -1,
        "and raising is not offered on a within-ceiling card");
  check(dWithin.indexOf("back to Area Manager") >= 0, "FM CH: reject offered");

  api.actions.amSubmitRate(true);
  const dAbove = devText();
  check(dAbove.indexOf("Raise to BizFin") >= 0,
        "FM CH: raise offered on an above-ceiling card");
  check(dAbove.indexOf("Approve rate card") === -1,
        "and the Cluster Head cannot approve one");

  api.actions.chRaise();
  const d3 = devText();
  check(d3.indexOf("BizFin") >= 0, "the BizFin group appears once raised");
  check(d3.indexOf("Approve rate card") >= 0, "BizFin approve offered");

  api.actions.centralReject();
  const d3b = devText();
  check(d3b.indexOf("Area Manager revision") >= 0,
        "the AM revision group appears after a rejection");
  check(d3b.indexOf("Reprice within ceiling and resubmit") >= 0,
        "and offers a reprice-and-resubmit");
  api.actions.amReprice();
  api.actions.chApprove();

  /* LM-only actors */
  api.actions.switchRole();
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
  doHubDetails(doc, { address: "No. 42, Koramangala" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chApprove();
  click(doc, "ch-continue");
  const d4 = devText();
  check(d4.indexOf("Force success") >= 0 && d4.indexOf("Force failure") >= 0 &&
        d4.indexOf("Force quote expired") >= 0,
        "security deposit: success / failure / quote-expired all offered (LM only)");

  api.actions.sdSet("expired");
  check(!!sel(doc, "#sd-requote"), "expired quote offers a re-quote route");
  api.actions.sdSet("failed");
  check(!!sel(doc, "#sd-retry"), "failed payment offers a retry route");
  api.actions.sdSet("paid");
  click(doc, "sd-continue");
  const d5 = devText();
  check(d5.indexOf("Area Manager decision") >= 0, "Area Manager approve/reject offered (LM only)");

  api.actions.amApprove();
  click(doc, "am-continue");
  check(devText().indexOf("scrolled to end") >= 0,
        "agreements: scroll-to-end simulation offered");

  api.actions.markAgreementRead();
  setCheck(doc, "ag-rate", true);
  setCheck(doc, "ag-service", true);
  click(doc, "ag-activate");
  check(devText().indexOf("Force failure") >= 0, "activation: force-failure offered");
  api.actions.actFail();
  eq(api.helpers.R().act.status, "failed", "activation failure reachable");
  check(!!sel(doc, "#act-retry"), "failed activation offers a retry route");

  api.actions.actRetry();
  await waitFor(win, () => api.helpers.R().act.status === "active", "retry activation");
  eq(api.helpers.R().act.status, "active", "retry after failure activates");

  check(devText().indexOf("Reset entire demo") >= 0, "reset action always available");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   9. Bulk pincode entry
   ====================================================================== */

async function testBulkPincodes() {
  section("9. Bulk pincode entry — comma-separated paste");
  const { win, doc, api } = await boot();
  const E = api.errors;
  const pins = () => api.helpers.R().hub.pincodes;

  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");

  /* comma-separated, one action */
  type(doc, "hub-pins", "560076, 560034, 110017");
  click(doc, "hub-addpin");
  eq(pins(), ["560076","560034","110017"], "a comma-separated list adds all three at once");
  check(txt(doc).indexOf("3 of 5 added") >= 0, "counter reflects the bulk add");

  /* mixed separators: spaces, semicolons, newlines, slashes */
  api.actions.removePincode("560034");
  api.actions.removePincode("110017");
  eq(pins(), ["560076"], "reset to a single pincode");
  api.actions.addPincodes("560034 110017;400059/560102");
  eq(pins(), ["560076","560034","110017","400059","560102"],
     "spaces, semicolons and slashes all work as separators");

  /* the 5-pincode cap still holds across a bulk add */
  api.actions.addPincodes("560001, 700001");
  eq(pins().length, 5, "bulk add cannot exceed the 5-pincode cap");
  check(txt(doc).indexOf("beyond the 5-pincode limit") >= 0,
        "overflow is reported rather than silently dropped");

  /* partial success: valid added, the rest explained by reason */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");
  api.actions.addPincodes("560076, notapin, 560076, 000000, 560034");
  eq(pins(), ["560076","560034"], "valid entries are added, invalid and duplicate ones are not");
  const msg = txt(doc);
  check(msg.indexOf("Added 2") >= 0, "reports how many were added");
  check(msg.indexOf("not a valid pincode") >= 0, "reports the invalid entries");
  check(msg.indexOf("already added") >= 0, "reports the duplicate");

  /* within-batch duplicates collapse to one */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");
  api.actions.addPincodes("560034, 560034, 560034");
  eq(pins(), ["560034"], "a value repeated inside one paste is added once");

  /* a bulk add invalidates a previous availability check */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");
  api.actions.addPincodes("560076");
  api.actions.typeHubPincode("560076");
  api.actions.addPincodes("560034, 110017");
  eq(api.helpers.R().hub.pincodes, ["560076", "560034", "110017"], "more pincodes join the list");
  eq(api.helpers.R().hub.selected, "560076", "and the hub’s own pincode is left as it was");

  /* single-value behaviour is unchanged — precise copy, not a batch summary */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");
  api.actions.addPincode("12ab5");
  check(txt(doc).indexOf(E.pincodeFormat) >= 0,
        "a single bad value still gives the precise format error");
  api.actions.addPincode("560076");
  api.actions.addPincode("560076");
  check(txt(doc).indexOf(E.pincodeDupe) >= 0,
        "a single duplicate still gives the precise duplicate error");

  /* a paste carrying a separator adds immediately */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.helpers.goPhase("hub");
  const pinInput = $(doc, "hub-pins");
  const pasteEvt = new win.Event("paste", { bubbles: true, cancelable: true });
  pasteEvt.clipboardData = { getData: () => "560076, 560034" };
  pinInput.dispatchEvent(pasteEvt);
  eq(pins(), ["560076","560034"], "pasting a separated list adds it without pressing Add");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   10. Hub facility inputs
   ====================================================================== */

async function testHubFacilityInputs() {
  section("10. Hub details — area, manpower, max vehicle");
  const { win, doc, api } = await boot();
  const E = api.errors;

  /* vehicle list is de-duplicated on normalised whitespace */
  const raw = api.config.VEHICLE_TYPES_RAW, list = api.config.VEHICLE_TYPES;
  eq(raw.length, 25, "source list has 25 entries as supplied");
  eq(list.length, 24, "de-duplicated list has 24 distinct vehicle types");
  check(raw.indexOf("0.8MT_4W _TataAce") >= 0,
        "source list does contain the stray-space variant");
  check(list.indexOf("0.8MT_4W _TataAce") === -1,
        "the stray-space variant is not offered");
  check(list.indexOf("0.8MT_4W_TataAce") >= 0, "the clean spelling is kept");
  eq(new Set(list).size, list.length, "no duplicates remain in the offered list");
  ["1.5MT_4W_Dost","42MT_18W","5MT_14FT","10MT_32FT","2MT_4W_Bolero"].forEach(v => {
    check(list.indexOf(v) >= 0, "list includes " + v);
  });

  login(doc);
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "reached hub details, straight after KYC");

  /* the three inputs are rendered, with every vehicle type selectable */
  check(exists(doc, "#hub-area"), "area input rendered");
  check(exists(doc, "#hub-manpower"), "manpower input rendered");
  check(exists(doc, "#veh-toggle"), "vehicle dropdown rendered");
  check(exists(doc, "#veh-panel"), "dropdown panel present");

  /* closed by default, and the panel is hidden rather than laid out */
  check(!api.helpers.vehUI().open, "dropdown starts closed");
  check($(doc, "veh-panel").hidden, "panel is hidden while closed");
  check(txt(doc).indexOf("Select the largest vehicle") >= 0,
        "closed control prompts for the largest vehicle");

  /* opening reveals every type exactly once, smallest capacity first */
  click(doc, "veh-toggle");
  check(api.helpers.vehUI().open, "clicking the control opens the dropdown");
  check(!$(doc, "veh-panel").hidden, "panel is visible once open");
  const opts = [...doc.querySelectorAll("#veh-list [data-veh]")].map(c => c.getAttribute("data-veh"));
  eq(opts.length, 24, "dropdown offers all 24 vehicle types");
  eq(opts, list, "dropdown options are in ascending capacity order");
  eq(opts[0], "0.8MT_4W_TataAce", "smallest type first");
  eq(opts[opts.length - 1], "42MT_18W", "largest type last");
  check([...doc.querySelectorAll("#veh-list [data-veh]")].every(
          r => r.getAttribute("aria-selected") === "false"),
        "nothing is selected to begin with");

  /* the supplied order is authoritative where tonnage alone is ambiguous */
  check(api.helpers.vehicleRank("3.5MT_4W") < api.helpers.vehicleRank("3.5MT_14FT"),
        "equal tonnages keep the supplied order (3.5MT_4W below 3.5MT_14FT)");
  check(api.helpers.vehicleRank("5MT_17FT") < api.helpers.vehicleRank("6MT_4W_TataAce"),
        "ranking follows the supplied list, not string order");
  check(api.helpers.vehicleRank("9MT_6W") < api.helpers.vehicleRank("10MT_22FT"),
        "10MT outranks 9MT (string compare would get this wrong)");
  eq(api.helpers.vehicleRank("Lorry"), -1, "an unknown type has no rank");

  /* one input: picking a type sets the hub max and closes the panel */
  api.actions.setMaxVehicle("7MT_20FT");
  eq(api.helpers.R().hub.maxVehicle, "7MT_20FT", "picking a type sets the hub's max size");
  check(!api.helpers.vehUI().open, "picking closes the dropdown — there is nothing else to tick");
  check(typeof api.actions.toggleVehicle === "undefined",
        "there is no multi-select toggle any more");

  /* everything smaller is implied, and shown as such */
  const implied = api.helpers.impliedVehicles("7MT_20FT");
  eq(implied[implied.length - 1], "7MT_20FT", "the chosen type is included");
  eq(implied.length, api.helpers.vehicleRank("7MT_20FT") + 1,
     "everything at or below the chosen rank is implied to fit");
  check(implied.indexOf("0.8MT_4W_TataAce") >= 0, "the smallest type fits under a 7MT max");
  check(implied.indexOf("8MT") === -1, "a larger type does not fit");
  eq(api.helpers.smallerThan("0.8MT_4W_TataAce"), [],
     "nothing is smaller than the smallest type");
  eq(api.helpers.smallerThan("7MT_20FT").length, 13, "13 smaller types fit under 7MT_20FT");

  click(doc, "veh-toggle");
  const rows = [...doc.querySelectorAll("#veh-list [data-veh]")];
  const maxRow = rows.find(r => r.getAttribute("data-veh") === "7MT_20FT");
  eq(maxRow.getAttribute("aria-selected"), "true", "the chosen row is marked selected");
  check(maxRow.classList.contains("on"), "and styled as the max");
  check(rows.filter(r => r.classList.contains("inc")).length === 13,
        "the 13 smaller rows are shown as included");
  check(rows.filter(r => r.classList.contains("on")).length === 1,
        "exactly one row is the max");
  check(!rows.find(r => r.getAttribute("data-veh") === "8MT").classList.contains("inc"),
        "larger rows are not marked as included");
  check(txt(doc).indexOf("Also fits 13 smaller types") >= 0,
        "the footer states how many smaller types are covered");
  check(txt(doc).indexOf("assumed to fit") >= 0,
        "the hint spells out that smaller types are assumed to fit");

  /* the closed control shows the single choice */
  const toks = [...doc.querySelectorAll("#veh-toggle .ms-tok")].map(t => t.textContent);
  eq(toks, ["7MT_20FT"], "control shows exactly one selected type");

  /* search filters without disturbing the choice */
  api.actions.openVehicles(true);
  api.actions.filterVehicles("32FT");
  const filtered = [...doc.querySelectorAll("#veh-list [data-veh]")].map(c => c.getAttribute("data-veh"));
  eq(filtered, ["10MT_32FT"], "search narrows the list");
  api.actions.filterVehicles("nothingmatches");
  check(txt(doc).indexOf("No vehicle type matches") >= 0, "an empty search result says so");
  api.actions.filterVehicles("");
  eq([...doc.querySelectorAll("#veh-list [data-veh]")].length, 24, "clearing the search restores all");
  eq(api.helpers.R().hub.maxVehicle, "7MT_20FT", "searching never changes the choice");

  /* Escape and outside clicks close it */
  api.actions.openVehicles(true);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check(!api.helpers.vehUI().open, "Escape closes the dropdown");
  api.actions.openVehicles(true);
  doc.body.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  check(!api.helpers.vehUI().open, "a click outside closes the dropdown");
  api.actions.openVehicles(true);
  $(doc, "veh-panel").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  check(api.helpers.vehUI().open, "a click inside the panel does not close it");

  eq(api.helpers.vehicleTonnage("42MT_18W"), 42, "tonnage parsed from the type name");
  eq(api.helpers.vehicleTonnage("0.8MT_4W_TataAce"), 0.8, "fractional tonnage parsed");

  /* clear resets the single choice */
  api.actions.openVehicles(true);
  api.actions.filterVehicles("");
  check(!exists(doc, "#veh-all"), "there is no Select all — only one type can be chosen");
  click(doc, "veh-none");
  eq(api.helpers.R().hub.maxVehicle, "", "Clear resets the choice");
  check(disabled(doc, "veh-none"), "Clear is disabled when nothing is chosen");
  api.actions.setMaxVehicle("7MT_20FT");

  /* an unknown type cannot be injected */
  api.actions.setMaxVehicle("Lorry");
  eq(api.helpers.R().hub.maxVehicle, "7MT_20FT", "a type outside the list is ignored");

  /* all three are required */
  api.actions.setMaxVehicle("");          // the picker tests above left one chosen
  type(doc, "hub-address", "No. 42, 4th Cross, Koramangala, Bengaluru");
  type(doc, "hub-map", "https://maps.google.com/?q=12.9352,77.6245");
  click(doc, "hub-submit");
  check(!api.helpers.R().hub.submitted, "submit blocked with the facility fields empty");
  let body = txt(doc);
  check(body.indexOf(E.hubArea) >= 0, "missing area → '" + E.hubArea + "'");
  check(body.indexOf(E.hubManpower) >= 0, "missing manpower → '" + E.hubManpower + "'");
  check(body.indexOf(E.hubVehicle) >= 0, "missing vehicle → '" + E.hubVehicle + "'");

  /* ranges and types */
  check(!api.validate.hubArea("50"), "area below 100 sq ft rejected");
  check(!api.validate.hubArea("0"), "zero area rejected");
  check(!api.validate.hubArea("4000.5"), "non-integer area rejected");
  check(!api.validate.hubArea("abc"), "non-numeric area rejected");
  check(!api.validate.hubArea("2000000"), "area above 1,000,000 sq ft rejected");
  check(api.validate.hubArea("4000"), "4000 sq ft accepted");
  check(!api.validate.hubManpower("0"), "zero manpower rejected");
  check(!api.validate.hubManpower("6000"), "manpower above 5,000 rejected");
  check(api.validate.hubManpower("12"), "12 people accepted");
  check(!api.validate.vehicle("Truck"), "a vehicle outside the list is rejected");
  check(!api.validate.vehicle("0.8MT_4W _TataAce"), "the stray-space spelling is rejected");
  check(api.validate.vehicle("7MT_20FT"), "a listed vehicle is accepted");

  /* an out-of-range value keeps the captain's input on screen */
  api.actions.hubSubmit({ areaSqft: "50" });
  eq(api.helpers.R().hub.areaSqft, "50", "rejected input is preserved, not cleared");
  check(!api.helpers.R().hub.submitted, "still not submitted");

  /* valid submit records all three and shows them in the summary */
  doHubDetails(doc, { area: "4000", manpower: "12", maxVehicle: "7MT_20FT" });
  const h = api.helpers.R().hub;
  check(h.submitted, "valid facility details submit successfully");
  eq(h.areaSqft, "4000", "area recorded");
  eq(h.manpower, "12", "manpower recorded");
  eq(h.maxVehicle, "7MT_20FT", "max vehicle size recorded");
  body = txt(doc);
  check(body.indexOf("Area of the hub") >= 0 && body.indexOf("4,000 sq ft") >= 0,
        "summary shows the area, formatted");
  check(body.indexOf("Estimated manpower") >= 0, "summary shows manpower");
  check(body.indexOf("Max vehicle size") >= 0 && body.indexOf("7MT_20FT") >= 0,
        "summary shows the derived max vehicle size");
  check(body.indexOf("Smaller types also accommodated") >= 0,
        "summary states that smaller types are covered");
  check(body.indexOf("Also fits 13 smaller types") >= 0,
        "and how many of them there are, framed the same way as on the picker");

  /* values survive a reopen after an AM rejection */
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  eq(api.helpers.phaseId(), "am", "walked forward to the Area Manager");
  api.actions.amReject("Loading bay too narrow.");
  click(doc, "am-fix-hub");
  eq($(doc, "hub-area").value, "4000", "area is prefilled on reopen");
  eq($(doc, "hub-manpower").value, "12", "manpower is prefilled on reopen");
  eq(api.helpers.R().hub.maxVehicle, "7MT_20FT", "max vehicle size is preserved on reopen");
  check(txt(doc).indexOf("7MT_20FT") >= 0, "the reopened control still shows the selection");

  /* FM captures the same three fields */
  api.actions.switchRole();
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  eq(api.helpers.phaseId(), "hub", "FM reached hub details, straight after KYC");
  check(exists(doc, "#hub-area") && exists(doc, "#hub-manpower") && exists(doc, "#veh-toggle"),
        "FM hub details captures area, manpower and vehicle types too");
  doHubDetails(doc, { address: "Plot 7, Bommasandra", area: "6500",
                      manpower: "18", maxVehicle: "10MT_32FT" });
  const fh = api.helpers.R().hub;
  eq([fh.areaSqft, fh.manpower, fh.maxVehicle], ["6500","18","10MT_32FT"],
     "FM records its own facility spec with a single max vehicle size");
  eq(api.helpers.smallerThan(fh.maxVehicle).length, 18,
     "and 18 smaller types are implied to fit");
  check(!fh.hubCode, "FM still gets no hub code at submit");
  check(txt(doc).indexOf("10MT_32FT") >= 0, "FM summary shows the max vehicle size");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   10b. Phase order and the labels derived from it
   ====================================================================== */

async function testPhaseOrder() {
  section("10b. Phase order — hub details before background verification");
  const { win, doc, api } = await boot();

  const lm = api.config.PHASES.LM.map(p => p.id);
  const fm = api.config.PHASES.FM.map(p => p.id);
  eq(lm, ["pd","kyc","hub","bgv","ch","sd","am","ag","act"], "LM order puts hub details third");
  eq(fm, ["pd","kyc","hub","bgv","ch","ag","act"], "FM order puts hub details third");
  check(lm.indexOf("hub") < lm.indexOf("bgv"), "LM: hub details precedes background verification");
  check(fm.indexOf("hub") < fm.indexOf("bgv"), "FM: hub details precedes background verification");
  check(lm.indexOf("hub") < lm.indexOf("ch"), "LM: hub details precedes Cluster Head review");
  check(fm.indexOf("hub") < fm.indexOf("ch"),
        "FM: hub details precedes Cluster Head review, so the AM has something to classify");
  check(lm.indexOf("am") > lm.indexOf("sd"), "LM: Area Manager still follows the deposit");

  /* Every continue button is derived from the phase list, so a future reorder
     cannot leave a button pointing at the wrong screen. */
  login(doc);
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  const seen = {};
  doKyc(doc, "LM");
  doHubDetails(doc);
  seen.hub = $(doc, "hub-continue").textContent.trim();
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  seen.bgv = $(doc, "bgv-continue").textContent.trim();
  click(doc, "bgv-continue");
  api.actions.chApprove();
  seen.ch = $(doc, "ch-continue").textContent.trim();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  seen.sd = $(doc, "sd-continue").textContent.trim();
  click(doc, "sd-continue");
  api.actions.amApprove();
  seen.am = $(doc, "am-continue").textContent.trim();

  eq(seen.hub, "Continue to background verification →", "hub details points at BGV");
  eq(seen.bgv, "Continue to Cluster Head review →", "BGV points at Cluster Head review");
  eq(seen.ch,  "Continue →", "Cluster Head approval just says Continue");
  eq(seen.sd,  "Continue to Area Manager verification →", "deposit points at the Area Manager");
  eq(seen.am,  "Continue to agreements →", "Area Manager points at agreements");
  /* Proper nouns must survive: deriving the label by lowercasing the phase
     title produced "cluster Head review" and "area Manager verification". */
  check(seen.bgv.indexOf("cluster Head") === -1 && seen.sd.indexOf("area Manager") === -1,
        "proper nouns in phase names are not lowercased");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   10c. Stepping back through the opening phases, and no location photo
   ====================================================================== */

// a 1x1 gif, standing in for a photo an older save still carries
const TINY_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function testBackAndPhoto() {
  section("10c. Back navigation, and no location photo");
  const { win, doc, api } = await boot();
  const E = api.errors;

  login(doc);
  pickRole(doc, "LM");

  /* page 1 has nowhere to go back to */
  eq(api.helpers.phaseId(), "pd", "on personal details");
  check(!api.helpers.canGoBack(api.helpers.R()), "no Back on the first page");
  check(!exists(doc, "#phase-back"), "and no Back button rendered");

  doPersonalDetails(doc);
  eq(api.helpers.phaseId(), "kyc", "on KYC");

  /* page 2 → page 1, and the captured values are still editable */
  check(api.helpers.canGoBack(api.helpers.R()), "Back is available on KYC");
  eq(api.helpers.backLabel(api.helpers.R()), "← Back to personal details",
     "Back names the page it returns to");
  click(doc, "phase-back");
  eq(api.helpers.phaseId(), "pd", "Back returns to personal details");
  eq($(doc, "pd-name").value, "Karan Verma", "the captured name is still there");
  type(doc, "pd-name", "Karan V Verma");
  eq(api.helpers.R().pd.name, "Karan V Verma", "and can be edited");
  check(api.helpers.R().pd.emailVerified, "the verified email survives the round trip");
  click(doc, "pd-continue");
  eq(api.helpers.phaseId(), "kyc", "forward again to KYC");

  /* a verified KYC item can be reopened and redone */
  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "KYC complete → hub details");
  click(doc, "phase-back");
  eq(api.helpers.phaseId(), "kyc", "Back returns to KYC");
  check(!exists(doc, "#kyc-pan"), "the completed card shows its summary, not the forms");
  eq(api.helpers.kycStep(api.helpers.R()), "complete", "KYC sits on its completed summary");
  check(exists(doc, '[data-kycedit="pan"]'),
        "each record on the summary can be reopened individually");
  clickSel(doc, '[data-kycedit="pan"]');
  check(exists(doc, "#kyc-pan"), "reopening PAN brings its own card back");
  eq(api.helpers.kycStep(api.helpers.R()), "pan", "and the sequence lands on that record");
  eq($(doc, "kyc-pan").value, "ABCDE1234F", "prefilled with what was entered");
  check(!api.helpers.R().kyc.pan.done, "and it is no longer counted as verified");
  check(disabled(doc, "kyc-continue"), "Continue is disabled until it is verified again");
  type(doc, "kyc-pan", "ZZZZZ9999Z");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  eq(api.helpers.R().kyc.pan.value, "ZZZZZ9999Z", "the edited PAN is saved");
  click(doc, "kyc-ack-pan");
  eq(api.helpers.kycStep(api.helpers.R()), "complete",
     "re-verifying returns to the summary, not back through the whole sequence");
  check(!disabled(doc, "kyc-continue"), "and Continue opens again");
  click(doc, "kyc-continue");
  eq(api.helpers.phaseId(), "hub", "forward again to hub details");

  /* page 3 → page 2 */
  check(api.helpers.canGoBack(api.helpers.R()), "Back is available on hub details");
  eq(api.helpers.backLabel(api.helpers.R()), "← Back to KYC verification",
     "Back names KYC, with its proper-noun casing intact");

  /* beyond hub details the flow has handed off, so Back stops */
  doHubDetails(doc);
  check(exists(doc, "#hub-edit"), "a submitted hub can be reopened for correction");
  click(doc, "hub-edit");
  check(!api.helpers.R().hub.submitted, "Edit hub details reopens the form");
  eq($(doc, "hub-address").value, "No. 42, 4th Cross, Koramangala, Bengaluru",
     "prefilled with what was submitted");
  click(doc, "hub-submit");
  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "bgv", "on background verification");
  check(!api.helpers.canGoBack(api.helpers.R()),
        "no Back from background verification — the flow has handed off");
  check(!exists(doc, "#phase-back"), "and no Back button is rendered there");

  /* ---- no location photo: hub details takes the map pin and nothing else ---- */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "back at hub details");
  check(!exists(doc, "#hub-photo-btn") && !exists(doc, "#hub-photo-file") &&
        !exists(doc, 'input[type="file"]'), "hub details has no photo upload");
  check(mainTxt(doc).toLowerCase().indexOf("photo") < 0, "and doesn’t mention a photo");
  check(typeof api.actions.setHubPhoto === "undefined", "nor any action to attach one");
  check(!("photo" in api.helpers.R().hub), "the hub record has no photo field");
  doHubDetails(doc, { address: "No. 42, Koramangala" });
  check(api.helpers.R().hub.submitted, "hub details submits");
  check(txt(doc).indexOf("Location photo") < 0, "and the summary shows no photo row");

  /* a save from before the photo was dropped loads without it */
  const KEY = "valmo.captain.onboarding.v1";
  const saved = JSON.parse(win.localStorage.getItem(KEY));
  saved.roles.LM.hub.photo = TINY_IMG;
  saved.roles.LM.hub.photoName = "gate.jpg";
  saved.hubs = (saved.hubs || []).concat([{ id: "h-old", code: "OLD", name: "Old hub", role: "LM",
    status: "active", photo: TINY_IMG, photoName: "gate.jpg" }]);
  win.localStorage.setItem(KEY, JSON.stringify(saved));
  check(api.reload(), "an older save still loads");
  check(!("photo" in api.helpers.R().hub) && !("photoName" in api.helpers.R().hub),
        "its hub details lose the photo");
  check(api.state.hubs.every((h) => !("photo" in h) && !("photoName" in h)), "and so do its hubs");
  api.actions.hubEdit();                     // any change saves the state again
  check(win.localStorage.getItem(KEY).indexOf(TINY_IMG) < 0, "and once saved again, no image data is kept");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   11. Captain Hub — logged-in Profile & Hubs (Figma page 96:2)
   ====================================================================== */

function devClick(doc, action) {
  const el = doc.querySelector('[data-dev="' + action + '"]');
  if (!el) throw new Error('dev action "' + action + '" not offered');
  if (el.disabled) throw new Error('dev action "' + action + '" is disabled');
  el.dispatchEvent(new (doc.defaultView.MouseEvent)("click", { bubbles: true }));
}
const devText = (doc) => $(doc, "dev").textContent.replace(/\s+/g, " ");
/* Central Admin is three roles; the backend simulator picks which is signed in. */
/* The existing captain starts with one of every notification. A group that
   drives its own flow from a quiet bell clears them first. */
function quietBell(api) {
  const ids = api.config.EXISTING_NOTE_IDS;
  api.state.rateUpdates = api.state.rateUpdates.filter(u => ids.indexOf(u.id) < 0);
  api.state.amChanges = api.state.amChanges.filter(c => ids.indexOf(c.id) < 0);
  api.state.hubEdits = api.state.hubEdits.filter(e => ids.indexOf(e.id) < 0);
  api.render();
}

function asCentral(doc, persona) {
  clickSel(doc, '[data-aprole="central"]');
  devClick(doc, "ca:" + persona);
}

async function testCaptainHub() {
  section("11. Captain Hub — login switch, profile, hubs");
  const { win, doc, api } = await boot();
  const E = api.errors;

  /* --- the dev panel offers the login switch before signing in --- */
  check(devText(doc).indexOf("Log in as") >= 0, "login screen offers a 'Log in as' switch");
  check(devText(doc).indexOf("Captain · new") >= 0, "'new captain' option offered");
  check(devText(doc).indexOf("Captain · existing") >= 0, "'existing captain' option offered");
  check(devText(doc).indexOf("Admin panel") >= 0, "'admin panel' option offered");

  /* --- new captain goes to onboarding, as before --- */
  devClick(doc, "as:new");
  login(doc);
  eq(api.state.screen, "roles", "a new captain lands on role selection");
  eq(api.state.hubs.length, 0, "a new captain owns no hubs");

  /* --- existing captain lands in the Captain Hub --- */
  api.reset();
  devClick(doc, "as:existing");
  eq(api.state.hubs.length, 4, "existing captain is seeded with 4 hubs");
  eq(api.state.hubs.map(h => h.role).join(","), "LM,LM,LM,FM", "three LM hubs and one live FM hub");
  login(doc);
  eq(api.state.screen, "panel", "an existing captain lands in the Captain Hub, not onboarding");
  eq(api.state.panel.section, "hubs", "and lands on My Hubs");

  /* --- HB-01 --- */
  let body = txt(doc);
  check(body.indexOf("Active hubs (3)") >= 0, "HB-01 groups three active hubs");
  check(body.indexOf("Inactive hubs (1)") >= 0, "HB-01 groups one inactive hub");
  ["AQT","BEU","JYP"].forEach(c =>
    check(body.indexOf("Hub " + c) >= 0, "hub code " + c + " listed"));
  check(body.indexOf("29ABCDE1234F1Z5") >= 0, "a GST-registered hub shows its GSTIN");
  check(body.indexOf("Non-GST") >= 0, "a Non-GST hub is labelled as such");
  check(body.indexOf("Deactivated on 12 Apr 2026") >= 0, "the inactive hub shows its end date");
  check(exists(doc, "#hub-add"), "Add new hub button present");
  check(!!sel(doc, '[data-gst="hub-aqt"]'), "GST-registered hub offers Manage GSTIN");
  check(sel(doc, '[data-gst="hub-beu"]').textContent.indexOf("Add GSTIN") >= 0,
        "Non-GST hub offers Add GSTIN instead");
  check(!sel(doc, '[data-gst="hub-jyp"]'), "an inactive hub offers no GST action");

  /* --- the sidebar shows the active hub and switches to the profile tab --- */
  check(sel(doc, ".hub-user").textContent.indexOf("Karan Verma") >= 0, "sidebar shows the captain");
  check(sel(doc, ".hub-user .hbadge").textContent.indexOf("AQT") >= 0,
        "sidebar badge shows the active hub code");
  click(doc, "hub-user");
  eq(api.state.panel.tab, "personal", "the sidebar user card opens Personal Details");

  /* --- PR-01 --- */
  body = txt(doc);
  check(body.indexOf("KYC details") >= 0, "PR-01 shows the KYC card");
  check(body.indexOf("used for all your hubs") >= 0, "KYC is stated as captain-level");
  check(body.indexOf("XXXX XXXX 1234") >= 0, "Aadhaar is masked");
  check(body.indexOf("ABCDE••••F") >= 0, "PAN is masked");
  check(body.indexOf("HDFC Bank •••• 4321") >= 0, "bank account is masked");
  check(exists(doc, "#bank-edit"), "bank account is editable");

  /* --- PR-02…PR-04: OTP challenge, wrong code, lockout --- */
  click(doc, "bank-edit");
  check(exists(doc, '[data-testid="bank-edit"]'), "editing bank opens the OTP challenge");
  check(exists(doc, "#bank-otp"), "OTP field shown before any account change");
  api.actions.bankOtp("111111");
  check(txt(doc).indexOf(E.otpWrong) >= 0, "a wrong bank OTP is rejected");
  api.actions.bankOtp("222222");
  api.actions.bankOtp("333333");
  check(exists(doc, '[data-testid="bank-otp-locked"]'), "three wrong codes lock the bank change");
  check(api.state.profile.bank.acc === "123456784321", "the bank account is untouched while locked");

  /* --- PR-05…PR-08: form, penny-drop, failure, success --- */
  api.actions.bankCancel();
  click(doc, "bank-edit");
  api.actions.bankOtp("000000");
  check(exists(doc, "#bank-acc"), "a correct OTP opens the new-account form");

  api.actions.bankSubmit("12", "BADIFSC", "Karan Verma");
  check(txt(doc).indexOf(E.account) >= 0, "a bad account number is rejected");
  api.actions.bankSubmit("987654321098", "BADIFSC", "Karan Verma");
  check(txt(doc).indexOf(E.ifsc) >= 0, "a bad IFSC is rejected");
  api.actions.bankSubmit("987654321098", "ICIC0004321", "");
  check(txt(doc).indexOf("Account holder name is required") >= 0, "holder name is required");

  api.actions.bankSubmit("987654321098", "ICIC0004321", "Karan Verma");
  eq(api.state.panel.bank.step, "verifying", "a valid form starts the penny-drop");
  check(devText(doc).indexOf("Penny-drop") >= 0, "dev panel offers the penny-drop outcome");

  devClick(doc, "bank:fail");
  eq(api.state.panel.bank.step, "failed", "a failed penny-drop is surfaced");
  eq(api.state.profile.bank.acc, "123456784321", "a failed penny-drop does not change the account");

  click(doc, "bank-retry");
  eq(api.state.panel.bank.step, "form", "the captain can go back to the form after a failure");
  api.actions.bankSubmit("987654321098", "ICIC0004321", "Karan Verma");
  devClick(doc, "bank:ok");
  eq(api.state.panel.bank.step, "done", "a successful penny-drop confirms the change");
  eq(api.state.profile.bank.acc, "987654321098", "the new account is saved");
  eq(api.state.profile.bank.ifsc, "ICIC0004321", "the new IFSC is saved");
  click(doc, "bank-done");
  check(!api.state.panel.bank.open, "the bank editor closes");

  /* --- HB-02…HB-06: per-hub GSTIN --- */
  api.actions.panelTab("hubs");
  clickSel(doc, '[data-gst="hub-beu"]');
  check(exists(doc, '[data-testid="gst-edit"]'), "Add GSTIN opens the editor on that hub");
  api.actions.gstSave("TOOSHORT");
  check(txt(doc).indexOf(E.gstin) >= 0, "an invalid GSTIN is rejected");
  check(!api.helpers.hubById("hub-beu").gst.registered, "the hub stays Non-GST on a bad GSTIN");
  api.actions.gstSave("29ZZZZZ9999Z1Z9");
  check(!api.helpers.hubById("hub-beu").gst.registered, "verifying a GSTIN does not save it on its own");
  check(exists(doc, '[data-testid="gst-check"]'), "the GST portal’s record is shown to review first");
  click(doc, "gst-confirm");
  eq(api.helpers.hubById("hub-beu").gst,
     { registered:true, gstin:"29ZZZZZ9999Z1Z9" }, "a verified GSTIN is saved to that hub only");
  eq(api.helpers.hubById("hub-aqt").gst.gstin, "29ABCDE1234F1Z5",
     "the other hub's GSTIN is untouched");

  clickSel(doc, '[data-gst="hub-aqt"]');
  api.actions.gstAskRemove();
  check(exists(doc, '[data-testid="gst-remove-confirm"]'), "removing a GSTIN asks for confirmation");
  click(doc, "gst-remove-go");
  eq(api.helpers.hubById("hub-aqt").gst, { registered:false, gstin:"" }, "the GSTIN is removed");
  api.actions.gstOpen("hub-aqt");
  api.actions.gstSave("29ABCDE1234F1Z5");
  click(doc, "gst-confirm");
  check(api.helpers.hubById("hub-aqt").gst.registered, "and can be added back");

  /* --- HB-07: add a new hub --- */
  click(doc, "hub-add");
  eq(api.state.panel.section, "addhub", "Add new hub opens the GST choice screen");
  body = txt(doc);
  check(body.indexOf("How is this hub registered for GST?") >= 0, "HB-07 heading present");
  check(body.indexOf("Your KYC and bank details are already saved") >= 0,
        "HB-07 states that KYC and bank carry over");
  ["existing","none","new"].forEach(c =>
    check(!!sel(doc, '[data-choice="' + c + '"]'), "GST choice offered: " + c));
  check(api.helpers.knownGstins().length > 0, "existing verified GSTINs are available to map");

  /* FM has no Non-GST option — "Don't have GST for this hub?" is the way in */
  api.actions.addHubRole("FM");
  check(!sel(doc, '[data-choice="none"]'), "Non-GST is not offered as an option for an FM hub");
  check(exists(doc, "#addhub-nogst"), "a Don’t have GST for this hub? link is, instead");
  api.actions.addHubChoice("none");
  check(api.state.panel.addHub.choice !== "none", "the Non-GST radio route stays shut for FM");

  api.actions.addHubChoice("new");
  api.actions.addHubContinue();
  check(txt(doc).indexOf(E.gstin) >= 0, "a new GSTIN must be valid before continuing");
  eq(api.state.screen, "panel", "and the captain stays on the add-hub screen");

  /* Regression: the GST choices used to be <button> elements with the GSTIN field
     and the existing-GSTIN <select> nested inside them. Clicking either control
     bubbled to the button, re-rendered the row and destroyed the field, so a new
     GSTIN could not be typed at all. Drive them the way a person does. */
  api.actions.addHubRole("LM");
  api.actions.addHubChoice("new");
  const rows = [...doc.querySelectorAll("[data-choice]")];
  check(rows.every(r => r.tagName !== "BUTTON"),
        "GST choice rows are not <button> elements");
  check(rows.every(r => r.getAttribute("role") === "radio"),
        "GST choice rows expose themselves as radios");

  const gIn = $(doc, "addhub-gstin");
  check(!gIn.closest("button"), "the new-GSTIN field is not nested inside a button");
  gIn.focus();
  check(doc.activeElement === gIn, "the new-GSTIN field takes focus");
  // a click on the field must not re-select the row and rebuild it
  gIn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  check($(doc, "addhub-gstin") === gIn, "clicking the field does not replace it");
  check(doc.activeElement === gIn, "clicking the field keeps focus");
  // type it the way a keyboard does
  gIn.value = "29ZZZZZ9999Z1Z9";
  gIn.dispatchEvent(new win.Event("input", { bubbles: true }));
  eq(api.state.panel.addHub.gstin, "29ZZZZZ9999Z1Z9", "the typed GSTIN reaches state");
  check($(doc, "addhub-gstin") === gIn, "typing does not replace the field");

  const sIn = (api.actions.addHubChoice("existing"), $(doc, "addhub-existing"));
  check(sIn && !sIn.closest("button"), "the existing-GSTIN select is not inside a button");
  sIn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  check($(doc, "addhub-existing") === sIn, "clicking the select does not rebuild the row");

  /* FM: no Non-GST row at all — the deliberate link opens the declaration */
  api.actions.addHubRole("FM");
  check(!sel(doc, '[data-choice="none"]'), "there is no Non-GST row for FM");
  click(doc, "addhub-nogst");
  check(exists(doc, '[data-testid="addhub-nogst"]'), "Don’t have GST for this hub? opens the declaration");
  check(!sel(doc, "[data-choice]"), "in place of the GSTIN choices");
  eq($(doc, "addhub-go").textContent.trim(), "Continue without GST →", "and the button says so");
  click(doc, "addhub-go");
  eq(api.state.screen, "panel", "it won’t continue without a reason and the confirmation");
  check(txt(doc).indexOf("Pick why you don’t have GST.") >= 0 &&
        txt(doc).indexOf("Tick the box to confirm you don’t have GST.") >= 0, "and says what’s missing");
  click(doc, "addhub-nogst-cancel");
  check(!!sel(doc, '[data-choice="new"]'), "I have a GSTIN goes back to the GSTIN choices");
  api.actions.addHubRole("LM");

  /* the typed GSTIN actually carries through to the new hub */
  api.actions.addHubChoice("new");
  const gIn2 = $(doc, "addhub-gstin");
  gIn2.value = "29ZZZZZ9999Z1Z9";
  gIn2.dispatchEvent(new win.Event("input", { bubbles: true }));
  click(doc, "addhub-go");
  eq(api.state.screen, "flow", "a typed new GSTIN lets the captain continue");
  eq(api.helpers.R().kyc.gst.gstin, "29ZZZZZ9999Z1Z9", "and is applied to the new hub");
  api.actions.openPanel("hubs", "hubs");

  /* --- the bridge back into the ORIGINAL onboarding flow --- */
  click(doc, "hub-add");                       // reopen HB-07 after the checks above
  api.actions.addHubRole("LM");
  api.actions.addHubChoice("existing");
  /* a hub mid-onboarding is listed as in progress until it activates */
  const settled = () => api.state.hubs.filter(h => h.status !== "in_progress").length;
  const inFlight = () => api.state.hubs.filter(h => h.status === "in_progress");
  const hubsBefore = settled();
  click(doc, "addhub-go");
  eq(inFlight().length, 1, "starting a hub lists it as in progress (one per role)");
  eq(api.state.screen, "flow", "Add new hub hands off to the onboarding flow");
  eq(api.state.activeRole, "LM", "into the role chosen for the new hub");
  eq(api.helpers.phaseId(), "hub", "starting at hub details, the first hub-specific phase");

  const nr = api.helpers.R();
  check(nr.pd.name === "Karan Verma" && nr.pd.emailVerified,
        "personal details carry over from the captain record");
  check(nr.kyc.aadhaar.done && nr.kyc.pan.done && nr.kyc.bank.done,
        "KYC carries over and is not asked again");
  eq(nr.bgv.status, "passed", "background verification carries over");
  eq(nr.kyc.gst.gstin, "29ABCDE1234F1Z5", "the chosen GSTIN is applied to the new hub");
  check(txt(doc).indexOf("Hub details") >= 0, "the onboarding rail is back on screen");

  /* finish it and confirm the hub joins My Hubs */
  check(exists(doc, '[data-testid="pincode-picker"]'),
        "an added hub starts with its own serviceable-pincode check");
  doHubDetails(doc, { address: "12, 1st Main, Jayanagar, Bengaluru" });
  eq(api.helpers.R().hub.pincode, "560076", "and records the pincode it picked");
  click(doc, "hub-continue");
  /* background verification was carried over, so the walk skips it entirely
     rather than re-running a check this captain already passed */
  eq(api.helpers.phaseId(), "ch", "carried-over background verification is skipped");
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  api.actions.amApprove();
  click(doc, "am-continue");
  doAgreements(doc, api);
  api.stopTimers();
  api.actions.finishActivation();

  eq(settled(), hubsBefore + 1, "the finished hub is added to My Hubs");
  eq(inFlight().length, 0, "replacing its in-progress entry");
  const added = api.state.hubs[api.state.hubs.length - 1];
  check(!!added.code, "the new hub has a hub code (" + added.code + ")");
  eq(added.role, "LM", "with the role it was created for");
  eq(added.gst, { registered:true, gstin:"29ABCDE1234F1Z5" }, "and the GST setup chosen at HB-07");
  eq(added.status, "active", "and is active");

  click(doc, "act-panel");
  eq(api.state.screen, "panel", "Open Captain Panel now goes to the Captain Hub");
  check(txt(doc).indexOf("Active hubs (4)") >= 0, "My Hubs shows the new hub alongside the others");

  /* --- a first-time captain also ends up with a hub --- */
  api.reset();
  devClick(doc, "as:new");
  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chSetCategory("standalone");
  api.actions.amSubmitRate(false);
  api.actions.chApprove();
  click(doc, "ch-continue");
  doAgreements(doc, api);
  api.stopTimers();
  api.actions.finishActivation();
  eq(api.state.hubs.length, 1, "a first-time captain's onboarding produces their first hub");
  eq(api.state.hubs[0].role, "FM", "recorded against the right role");
  eq(api.state.hubs[0].rateCard && api.state.hubs[0].rateCard.slabs, api.helpers.R().ch.slabs,
     "carrying the rate card approved in onboarding, for later updates");
  check(!!api.state.profile.name, "and fills in the captain record the Captain Hub reads");
  click(doc, "act-panel");
  check(txt(doc).indexOf("Active hubs (1)") >= 0, "which then shows in My Hubs");

  /* --- out-of-scope sidebar sections say so rather than 404ing --- */
  api.actions.panelNav("payments");
  check(txt(doc).indexOf("Not part of this prototype") >= 0,
        "Payments is honestly marked out of scope");
  api.actions.panelNav("hubs");
  check(txt(doc).indexOf("Active hubs") >= 0, "and you can get back to My Hubs");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   12. Admin panel — Figma page 109:2, built for FM
   ====================================================================== */

async function testAdminPanel() {
  section("12. Admin panel — AM, CH, ZH and FM Central Admin");
  const { win, doc, api } = await boot();

  /* --- reached from the login switch --- */
  devClick(doc, "as:admin");
  login(doc);
  eq(api.state.screen, "adminselect", "logging in as Admin opens the panel picker");
  check(txt(doc).indexOf("Welcome to Valmo Admin Panel") >= 0, "panel-select heading present");
  check(txt(doc).indexOf("admin.meeshosupply.com/valmo") >= 0, "console URL chip shown");

  /* --- the four role cards --- */
  const roles = [...doc.querySelectorAll("[data-aprole]")].map(b => b.getAttribute("data-aprole"));
  eq(roles, ["am","ch","zh","central"], "four panels offered, in design order");
  const cardTxt = txt(doc);
  ["Area Manager","Cluster Head","Zonal Head","FM Central Admin"].forEach(r =>
    check(cardTxt.indexOf(r) >= 0, "card offered: " + r));
  check(cardTxt.indexOf("LM Central Admin") === -1,
        "the LM label is replaced with FM Central Admin");

  /* --- security deposit is gone everywhere --- */
  const sdWords = ["security deposit","Security deposit","Model SD","Current SD",
                   "Final SD","send to deposit","SD after CH"];
  const noSd = (where) => sdWords.forEach(w =>
    check(txt(doc).indexOf(w) === -1, where + " has no security-deposit reference: \"" + w + "\""));
  noSd("the panel picker");

  /* --- Area Manager --- */
  clickSel(doc, '[data-aprole="am"]');
  eq(api.state.screen, "admin", "choosing a panel opens the admin console");
  eq(api.state.admin.role, "am", "as the Area Manager");
  check(txt(doc).indexOf("FM Onboarding") >= 0, "the console is titled FM Onboarding");
  check(txt(doc).indexOf("Meesho Admin Console") >= 0, "with the admin breadcrumb");
  check(txt(doc).indexOf("Priya Sharma") >= 0, "and the signed-in Area Manager");
  eq(api.config.ADMIN_TABS.am.map(t => t.id), ["mine", "edits", "rates"],
     "AM has its own requests, captains\u2019 hub edits, and rate card updates");

  const amRows = [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  check(amRows.length === 3, "three AM-stage requests listed");
  /* --- status is only ever Pending or SLA breach --- */
  eq(Object.keys(api.config.AP_STATUS), ["pending","sla_breach"],
     "there are exactly two statuses");
  eq(Object.keys(api.config.AP_STATUS).map(k => api.config.AP_STATUS[k].label),
     ["Pending","SLA breach"], "labelled Pending and SLA breach");
  check(txt(doc).indexOf("Pending") >= 0, "the list shows Pending");
  check(txt(doc).indexOf("SLA breach") >= 0, "and SLA breach");
  ["AM pending","CH pending","ZH pending","Central pending","VLS fields missing"].forEach(l =>
    check(txt(doc).indexOf(l) === -1, "no stage-specific status: \"" + l + "\""));
  check(api.state.adminRequests.every(r => r.status === "pending" || r.status === "sla_breach"),
        "every request carries one of the two");
  /* which desk holds it is the stage, not the status */
  check(api.state.adminRequests.some(r => r.stage === "am") &&
        api.state.adminRequests.some(r => r.stage === "ch"),
        "the desk a request sits with is tracked separately as its stage");

  /* the captain's phone sits under their name in the table */
  check(txt(doc).indexOf("+91 98450 22119") >= 0, "the captain's phone is shown in the row");
  check(txt(doc).indexOf("+91 99012 31447") >= 0, "each request shows its own captain's phone");

  /* search and status filters narrow the table */
  const found = () => [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  api.actions.adminFilter("search", "Neha");
  eq(found().length, 1, "search narrows the list by captain name");

  /* the phone is searchable, in whatever shape it is typed */
  api.actions.adminFilter("search", "99012 31447");
  eq(found(), ["OBD-78231"], "searching the phone as displayed finds the request");
  api.actions.adminFilter("search", "9901231447");
  eq(found(), ["OBD-78231"], "and without the space");
  api.actions.adminFilter("search", "+91 99012 31447");
  eq(found(), ["OBD-78231"], "and with the country code");
  api.actions.adminFilter("search", "919901231447");
  eq(found(), ["OBD-78231"], "and as a bare 91-prefixed number");
  api.actions.adminFilter("search", "31447");
  eq(found(), ["OBD-78231"], "a partial phone match works too");
  api.actions.adminFilter("search", "560038");
  eq(found(), ["OBD-78222"], "pincode search still works alongside it");
  api.actions.adminFilter("search", "OBD-78240");
  eq(found(), ["OBD-78240"], "and request ID search");
  api.actions.adminFilter("search", "");
  api.actions.adminFilter("status", "sla_breach");
  eq([...doc.querySelectorAll("[data-apopen]")].length, 1, "status filter narrows the list");
  api.actions.adminFilter("status", "all");

  /* --- AM infra checklist --- */
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("step 1 of 3 · infra check") >= 0,
        "opens on the infra check, step 1 of 3");
  check(txt(doc).indexOf("Area Manager infra check") >= 0, "with the hard-gate card");
  const gates = [...doc.querySelectorAll("[data-gate]")].map(b => b.getAttribute("data-gate"));
  eq([...new Set(gates)],
     ["cctv","fire","computer","scanner","scanTable","scanStand","power","printer","address"],
     "all nine hard gates present, in the given order");
  check(txt(doc).indexOf("1. CCTV installed and operational") >= 0, "the list is numbered");
  check(txt(doc).indexOf("Fire extinguisher") >= 0, "fire extinguisher is a gate");
  check(txt(doc).indexOf("Scanner / handheld devices available") >= 0, "scanner is a gate");
  check(txt(doc).indexOf("Scan table") >= 0 && txt(doc).indexOf("Scan stand") >= 0,
        "scan table and scan stand are separate gates");
  check(txt(doc).indexOf("Power backup provisioned") >= 0, "power backup is a gate");
  check(disabled(doc, "ap-approve"), "approve is blocked until every gate is answered");

  /* 10. max vehicle size review — a pass/fail on the captain's declared size,
     with its own update flow rather than being a hard gate */
  check(exists(doc, '[data-testid="am-vehicle-review"]'), "the max vehicle size review is present");
  check(txt(doc).indexOf("10. Max. vehicle size review") >= 0, "numbered tenth");
  check(txt(doc).indexOf("Captain declared: 7MT_20FT") >= 0, "showing what the captain declared");
  check(!!sel(doc, '[data-vehreview="yes"]') && !!sel(doc, '[data-vehreview="no"]'),
        "offered as pass / fail");
  noSd("the AM detail");
  check(txt(doc).indexOf("Captain & hub context") >= 0, "the read-only context card is shown");
  check(txt(doc).indexOf("AM SLA") >= 0, "with the SLA card");

  /* a failed hard gate forces rejection */
  api.actions.amGate("cctv", "no");
  check(exists(doc, "#ap-reject"), "a failed hard gate switches the action to reject");
  check(!exists(doc, "#ap-approve"), "and approve is no longer offered");
  check(txt(doc).indexOf("Hard gate failed") >= 0, "the card says a hard gate failed");

  api.config.AM_GATES.forEach(g => api.actions.amGate(g.id, "yes"));
  check(disabled(doc, "ap-approve"),
        "nine passing gates are not enough — the vehicle review is still open");

  /* failing the review opens the picker and requires a corrected size */
  clickSel(doc, '[data-vehreview="no"]');
  check(exists(doc, '[data-testid="am-vehicle-picker"]'),
        "failing the review opens the vehicle picker");
  check(exists(doc, "#veh-toggle"), "which is the same vehicle dropdown the captain uses");
  api.actions.setMaxVehicle("3.5MT_14FT");
  const amReq = api.helpers.apById("OBD-78222");
  eq(amReq.am.maxVehicle, "3.5MT_14FT", "the AM's corrected size is recorded");
  eq(amReq.am.declaredVehicle, "7MT_20FT", "the captain's declared size is kept separately");
  check(api.helpers.amVehicleSettled(amReq), "and the review is settled");

  /* --- the carting design is a second page, the rate card a third --- */
  check(!exists(doc, "#am-category"), "hub type is not on the infra page");
  check(!exists(doc, '[data-testid="am-slabs"]'), "nor the rate card");
  check(!exists(doc, "#ch-touchpoint"), "the rate card no longer sits with the Cluster Head");
  check(exists(doc, "#am-to-design"), "the infra page continues to the carting design");
  check(!disabled(doc, "am-to-design"), "which opens once the infra check passes");
  check(txt(doc).indexOf("Infra check passed") >= 0, "and says the infra check passed");
  check(!api.helpers.amInfraReady(api.helpers.apById("OBD-78231")),
        "a request with unanswered gates is not infra-ready");

  click(doc, "am-to-design");
  eq(api.state.admin.amStep, "design", "the AM moves to the carting design page");
  check(txt(doc).indexOf("step 2 of 3 · FM Carting Design Input") >= 0, "which is step 2 of 3");
  check(disabled(doc, "am-design-validate"), "Validate is closed until the design is filled in");
  type(doc, "am-fmsc", "SSY");
  api.actions.designField("onboarding", "expansion");
  check(!disabled(doc, "am-design-validate"), "and opens once FMSC and the type are given");
  click(doc, "am-design-validate");
  click(doc, "am-design-send");
  eq(api.state.admin.amStep, "rate", "sending the design moves on to the rate card");
  check(txt(doc).indexOf("step 3 of 3 · rate card") >= 0, "which is step 3 of 3");
  check(!exists(doc, "[data-gate]"), "the checklist is not on the rate card page");
  check(exists(doc, "#am-category"), "the AM selects the hub type here");
  check(exists(doc, '[data-testid="am-slabs"]'), "and fills in the rate card");
  check(exists(doc, "#am-touchpoint"), "including the touchpoint rate");
  check(disabled(doc, "ap-approve"), "submission is blocked until the card is complete");
  check(txt(doc).indexOf("Select a hub type first") >= 0,
        "with no hub type there is no ceiling to measure against");

  /* the three pages navigate both ways */
  click(doc, "am-to-design");
  eq(api.state.admin.amStep, "design", "and can step back to the carting design");
  click(doc, "am-to-infra");
  eq(api.state.admin.amStep, "infra", "and back again to the infra check");
  check(exists(doc, "[data-gate]"), "with the checklist intact");
  click(doc, "am-to-design"); click(doc, "am-to-rate");

  api.actions.amCategory("standalone");
  eq(api.helpers.apCeiling(amReq), 3.5, "a Bengaluru Standalone hub sets a 3.50 slab ceiling");
  check(txt(doc).indexOf("₹3.50") >= 0, "the ceiling is shown against the slabs");
  eq(amReq.rate.touchpoint, "5.00", "and the hub type sets the touchpoint: 5.00 for Standalone");
  check(!exists(doc, "input#am-touchpoint"), "the AM can’t type the touchpoint — it’s shown, not an input");
  check(sel(doc, '[data-testid="am-tp-fixed"]').textContent.indexOf("₹5.00") >= 0, "it reads ₹5.00");
  api.actions.amRateField("touchpoint", "9.00");
  eq(amReq.rate.touchpoint, "5.00", "and it can’t be changed by action either");

  /* within the ceiling → straight through to the Cluster Head */
  eq(amReq.rate.slabs.map(sl => sl.from + "-" + sl.to), ["0-2500", "2501-5000", "5001-7500", "7501-10000", "10001-"],
     "five slabs in steps of 2,500 orders, the last open-ended");
  check(!exists(doc, '[data-field="from"]') && !exists(doc, '[data-field="to"]') && !exists(doc, "#ch-slab-add"),
        "the AM can't type the bands or add a slab — only the rates");
  api.actions.chSlabField(0, "to", "900");
  eq(amReq.rate.slabs[0].to, "2500", "and a band can't be changed by action either");
  priceAllSlabs(api, "3.40");
  check(api.helpers.apWithinThreshold(amReq), "3.40 is within the 3.50 ceiling");
  check(txt(doc).indexOf("Within ceiling") >= 0, "the card says so");
  check(!disabled(doc, "ap-approve"), "and approve opens");
  check($(doc, "ap-approve").textContent.indexOf("send to CH") >= 0,
        "sending it straight to the Cluster Head");

  /* above the ceiling → it becomes an approval request instead */
  api.actions.chSlabField(0, "rate", "7.00");
  check(!api.helpers.apWithinThreshold(amReq), "7.00 is above the 3.50 ceiling");
  check(txt(doc).indexOf("Above ceiling") >= 0, "the card flags it");
  check(exists(doc, '[data-testid="am-over-ceiling"]'), "and explains what happens next");
  check(!disabled(doc, "ap-approve"), "it can still be submitted");
  check($(doc, "ap-approve").textContent.indexOf("Raise approval request to CH") >= 0,
        "but as an approval request rather than a straight approval");
  check(!!sel(doc, ".slab-row.over"), "the offending slab is flagged in the row");

  click(doc, "ap-approve");
  eq(amReq.stage, "ch", "either way it routes to the Cluster Head");
  eq(amReq.rateEscalated, true, "carrying the flag that it is above ceiling");
  check(txt(doc).indexOf("Approval request raised") >= 0, "with a confirmation");

  /* --- Cluster Head --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  eq(api.config.ADMIN_TABS.ch.map(t => t.id), ["mine","am","rates"],
     "CH sees its own requests, AM requests and rate card updates to review");
  check(txt(doc).indexOf("Rakesh Sharma") >= 0, "signed in as the Cluster Head");

  /* a within-ceiling request the CH can settle */
  clickSel(doc, '[data-apopen="OBD-78219"]');
  check(txt(doc).indexOf("CH review · approve request") >= 0, "opens the CH review");
  noSd("the CH review");
  check(exists(doc, '[data-testid="ch-rate-readonly"]'),
        "the rate card is shown read-only — the CH no longer authors it");
  check(!exists(doc, "[data-slab]"), "there are no slab inputs here");
  check(txt(doc).indexOf("set by the Area Manager") >= 0, "attributed to the Area Manager");
  eq([...doc.querySelectorAll("[data-rating]")].length, 5, "a 1–5 rating is offered");

  api.actions.chRate(2);
  check(exists(doc, "#ap-reject"), "a rating of 2 offers rejection");
  api.actions.chRate(4);
  check(exists(doc, "#ap-approve"), "a rating of 4 offers approval");
  check(txt(doc).indexOf("send to agreements") >= 0,
        "a within-ceiling request is settled by the Cluster Head");
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78219").settled, "approved", "and approved");
  eq(api.helpers.apById("OBD-78219").stage, "done", "which settles it");
  check(!apVisible(doc).length || apVisible(doc).indexOf("OBD-78219") === -1,
        "a settled request drops out of the working queue");

  /* an above-ceiling request the CH must raise onward */
  api.actions.adminOpen("OBD-78222");
  api.actions.chRate(4);
  check(exists(doc, '[data-testid="ch-rate-escalated"]'),
        "an above-ceiling card is flagged as raised by the Area Manager");
  check(!exists(doc, "#ap-approve"), "the Cluster Head cannot settle it");
  check(exists(doc, "#ap-central"), "but can raise it to Central Admin");
  click(doc, "ap-central");
  eq(api.helpers.apById("OBD-78222").stage, "central", "which routes it to Central Admin");
  check(txt(doc).indexOf("Raised to BizFin") >= 0, "with a confirmation");

  check(Object.keys(api.config.ADMIN_TABS).every(k =>
          api.config.ADMIN_TABS[k].every(t => t.id !== "users" && t.label !== "User mapping")),
        "no admin panel has a User mapping tab");

  /* --- Zonal Head: monitoring only --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="zh"]');
  check(txt(doc).indexOf("Priya Nair") >= 0, "signed in as the Zonal Head");
  eq(api.config.ADMIN_TABS.zh.map(t => t.id), ["am","ch","rates"],
     "the Zonal Head sees AM and CH pendency, and rate card updates to approve");
  eq(api.config.ADMIN_TABS.zh.map(t => t.label), ["AM pendency","CH pendency","Rate card updates"],
     "onboarding framed as pendency rather than a queue");
  check(api.config.ADMIN_ROLES.zh.desc.indexOf("monitor") >= 0 &&
        api.config.ADMIN_ROLES.zh.desc.indexOf("Approve rate card updates") >= 0,
        "described as approving rate card updates and monitoring the rest");

  const zhRows = [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  check(zhRows.length >= 1, "AM pendency lists what is with Area Managers");
  clickSel(doc, '[data-apopen="' + zhRows[0] + '"]');
  check(exists(doc, '[data-testid="zh-monitor-only"]'), "opening one is a view-only screen");
  check(txt(doc).indexOf("Request status") >= 0, "showing where the request sits");
  ["ap-approve","ap-reject","ap-central"].forEach(id =>
    check(!exists(doc, "#" + id), "the Zonal Head has no " + id.replace("ap-", "") + " action"));
  noSd("the ZH monitoring view");

  /* --- FM Central Admin: three roles, picked in the backend simulator --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="central"]');
  check(exists(doc, '[data-testid="ap-central-pick"]'), "Central Admin first asks which role is signed in");
  check(devText(doc).indexOf("Central Admin role") >= 0, "and the backend simulator offers the three");
  eq(Object.keys(api.config.CENTRAL_TABS), ["bizfin", "design", "ops"], "BizFin, the Design team and FM Central Ops");
  eq(api.config.CENTRAL_TABS.bizfin.map(t => t.id), ["mine", "rates", "slabs"],
     "BizFin: above-ceiling rate cards at onboarding, above-ceiling updates, and slab settings");
  eq(api.config.CENTRAL_TABS.design.map(t => t.id), ["design"], "the Design team: the carting design queue");
  eq(api.config.CENTRAL_TABS.ops.map(t => t.id), ["am", "ch", "rates", "bulk", "slabs"],
     "FM Central Ops: AM and CH pendency, rate card updates, bulk updates and slab settings — no national view");
  devClick(doc, "ca:bizfin");
  check(txt(doc).indexOf("Central Admin · BizFin") >= 0, "signed in as BizFin");

  eq(api.state.admin.tab, "mine", "BizFin opens on its own queue");
  const centralRows = [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  check(centralRows.indexOf("OBD-78222") >= 0, "holding what the Cluster Head raised");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("BizFin · rate card approval") >= 0, "opens the BizFin approval");
  check(exists(doc, '[data-testid="central-above-threshold"]'),
        "stating what was over ceiling and by how much");
  check(txt(doc).indexOf("Raised by the Cluster Head") >= 0, "attributed to the Cluster Head");
  check(exists(doc, "#ap-approve"), "BizFin can approve it");
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78222").settled, "approved", "and does");
  eq(api.helpers.apById("OBD-78222").stage, "done", "which settles the request");
  noSd("the Central console");


  /* --- binding screens are deliberately absent --- */
  const allTabs = Object.keys(api.config.ADMIN_TABS)
    .reduce((acc, k) => acc.concat(api.config.ADMIN_TABS[k].map(t => t.label)), []);
  ["Area binding","Cluster binding","Zone binding","binding"].forEach(b =>
    check(allTabs.join(" ").indexOf(b) === -1, "no binding screen: " + b));

  /* --- switching back to the captain flow --- */
  api.actions.adminSwitchRole();
  click(doc, "ap-logout");
  eq(api.state.screen, "login", "logging out returns to the login screen");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   13. Above-ceiling rate card: CH → Central Admin, and revision send-backs
   ====================================================================== */

async function testCeilingEscalation() {
  section("13. Above-ceiling rate card — raise, reject and revise");
  const { win, doc, api } = await boot();

  devClick(doc, "as:admin");
  login(doc);

  /* --- a request already sitting with the CH, priced above its ceiling --- */
  clickSel(doc, '[data-aprole="ch"]');
  const sample = api.helpers.apById("OBD-78255");
  eq(sample.stage, "ch", "the sample sits with the Cluster Head");
  eq(sample.hubCategory, "mall", "on a mall hub");
  eq(api.helpers.apCeiling(sample), 3.5, "whose ceiling in Bengaluru is 3.50");
  check(!api.helpers.apWithinThreshold(sample), "and its rate card is above that");
  eq(sample.rateEscalated, true, "so it arrived as an approval request");
  check(apVisible(doc).indexOf("OBD-78255") >= 0, "and it is in the CH queue");

  clickSel(doc, '[data-apopen="OBD-78255"]');
  check(exists(doc, '[data-testid="ch-rate-escalated"]'),
        "the CH is told the rate card is above ceiling");
  check(exists(doc, '[data-testid="ch-rate-readonly"]'), "with the rate card shown read-only");
  check(txt(doc).indexOf("above ceiling") >= 0, "and the offending slabs flagged");
  check(!exists(doc, "#ap-approve"), "the CH cannot settle it themselves");
  check(exists(doc, "#ap-central"), "but can raise it to Central Admin");
  check(exists(doc, "#ap-reject"), "and can reject it instead");

  /* --- reject sends it back to the AM to revise --- */
  api.actions.chField("reason", "Rate is too high for this catchment.");
  click(doc, "ap-reject");
  const back = api.helpers.apById("OBD-78255");
  eq(back.stage, "am", "rejecting returns it to the Area Manager, not to the captain");
  eq(back.settled, null, "the request is not closed");
  eq(back.status, "pending", "it is pending again");
  eq(back.rateEscalated, false, "and no longer carries the escalation flag");
  check(!!back.revision, "a revision note is attached");
  eq(back.revision.by, "Cluster Head", "naming who sent it back");
  eq(back.revision.reason, "Rate is too high for this catchment.", "and why");
  check(txt(doc).indexOf("Sent back to the Area Manager") >= 0, "with a confirmation");

  /* --- the AM sees why, and lands on the rate card --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  check(apVisible(doc).indexOf("OBD-78255") >= 0, "it is back in the AM queue");
  clickSel(doc, '[data-apopen="OBD-78255"]');
  eq(api.state.admin.amStep, "rate",
     "a returned request opens on the rate card, not the checklist");
  check(exists(doc, '[data-testid="am-revision"]'), "with the send-back explained");
  check(txt(doc).indexOf("Sent back by the Cluster Head") >= 0, "naming the desk");
  check(txt(doc).indexOf("Rate is too high for this catchment.") >= 0, "and the reason");

  /* reprice within the ceiling and it goes straight through */
  priceAllSlabs(api, "1.80");
  check(api.helpers.apWithinThreshold(api.helpers.apById("OBD-78255")),
        "repriced inside the ceiling");
  check($(doc, "ap-approve").textContent.indexOf("send to CH") >= 0,
        "so it submits as a straight approval again");
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78255").stage, "ch", "and returns to the Cluster Head");
  eq(api.helpers.apById("OBD-78255").revision, null, "with the revision note cleared");
  eq(api.helpers.apById("OBD-78255").rateEscalated, false, "and no escalation");

  /* --- price it above ceiling again and walk it up to Central Admin --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  api.actions.adminOpen("OBD-78255");
  api.actions.chField("reason", "Still worth another look.");
  click(doc, "ap-reject");

  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  api.actions.chSlabField(0, "rate", "3.90");
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78255").rateEscalated, true, "above ceiling again");
  eq(api.helpers.apById("OBD-78255").stage, "ch", "so it goes to the Cluster Head for approval");

  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-central");
  eq(api.helpers.apById("OBD-78255").stage, "central", "the CH raises it to Central Admin");

  /* --- BizFin can approve or reject --- */
  api.actions.adminSwitchRole();
  asCentral(doc, "bizfin");
  eq(api.state.admin.tab, "mine", "BizFin opens on its own queue");
  check(apVisible(doc).indexOf("OBD-78255") >= 0, "where the raised request is waiting");
  clickSel(doc, '[data-apopen="OBD-78255"]');
  check(txt(doc).indexOf("BizFin · rate card approval") >= 0, "opening the approval");
  check(exists(doc, '[data-testid="central-above-threshold"]'), "with the overage stated");
  check(txt(doc).indexOf("Raised by the Cluster Head") >= 0, "attributed to the Cluster Head");
  check(exists(doc, "#ap-approve") && exists(doc, "#ap-reject"),
        "Central Admin can approve or reject");

  /* reject first — it goes back to the AM, not to the captain */
  click(doc, "ap-reject");
  const bounced = api.helpers.apById("OBD-78255");
  eq(bounced.stage, "am", "a Central rejection also returns it to the Area Manager");
  eq(bounced.revision.by, "BizFin", "naming BizFin as the sender");
  eq(bounced.settled, null, "and the request stays open");

  /* send it back up the same way and approve it this time */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-approve");
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-central");
  api.actions.adminSwitchRole();
  asCentral(doc, "bizfin");
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78255").settled, "approved", "Central Admin approves the rate card");
  eq(api.helpers.apById("OBD-78255").stage, "done", "which settles the request");

  /* --- every slab has its own ceiling; the touchpoint is fixed --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-apopen="OBD-78222"]');
  api.config.AM_GATES.forEach(g => api.actions.amGate(g.id, "yes"));
  clickSel(doc, '[data-vehreview="yes"]');
  click(doc, "am-to-design");
  api.actions.designField("fmsc", "SSY");
  api.actions.designField("onboarding", "expansion");
  api.actions.designValidate();
  api.actions.designSend();
  api.actions.amCategory("standalone_mini");
  priceAllSlabs(api, "2.30");

  const req = () => api.helpers.apById("OBD-78222");
  eq(req().rate.touchpoint, "6.00", "a mini-hub’s touchpoint is fixed at 6.00");
  eq(api.helpers.apTpCeiling(req()), 6, "so its touchpoint ceiling is the same 6.00");
  eq([...doc.querySelectorAll("[data-slabrow] .cv")].map(c => c.textContent.trim()),
     ["₹3.20", "₹3.00", "₹2.73", "₹2.55", "₹2.38"], "each slab shows its own ceiling, stepping down");
  check(api.helpers.apWithinThreshold(req()), "2.30 a slab is within every one of them");

  /* the same rate can be within one slab's ceiling and over another's */
  api.actions.chSlabField(0, "rate", "2.80");
  check(!api.helpers.slabOverCeiling(req(), req().rate.slabs[0]), "2.80 is within the first slab’s 3.20");
  api.actions.chSlabField(2, "rate", "2.80");
  check(api.helpers.slabOverCeiling(req(), req().rate.slabs[2]), "but over the third slab’s 2.73");
  eq(doc.querySelectorAll(".slab-row.over").length, 1, "only that slab is flagged");
  eq(sel(doc, '[data-slabrow="2"] .cv').textContent.trim(), "₹2.73 · over", "with its ceiling marked over");
  eq($(doc, "am-rate-status").textContent.trim(), "Above ceiling", "and the card chip follows");
  check(txt(doc).indexOf("Slab 3 (5,001–7,500 orders) is ₹2.80 against a ₹2.73 ceiling.") >= 0,
        "the notice names the slab, its rate and its ceiling");
  api.actions.chSlabField(4, "rate", "2.50");
  check(txt(doc).indexOf("against a ₹2.73 ceiling, and 1 more slab is over.") >= 0,
        "a second slab over is counted, not listed");
  api.actions.chSlabField(4, "rate", "2.30");

  /* the "what's still missing" hint must not survive the card being completed */
  check($(doc, "am-rate-incomplete").hidden,
        "the incomplete-card hint is gone once every slab is priced");
  api.actions.chSlabField(1, "rate", "");
  check(!$(doc, "am-rate-incomplete").hidden, "and comes back when one is cleared");
  api.actions.chSlabField(1, "rate", "2.90");
  check($(doc, "am-rate-incomplete").hidden, "without needing a full re-render");

  /* it carries downstream */
  click(doc, "ap-approve");
  eq(req().stage, "ch", "an over-ceiling card still routes to the Cluster Head");
  eq(req().rateEscalated, true, "as an approval request");
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("Slab ceilings (Standalone (mini-hub), Bengaluru)") >= 0 &&
        txt(doc).indexOf("₹3.20 → ₹2.20") >= 0, "the CH's read-only card names the ceilings it was held to");
  check(txt(doc).indexOf("₹6.00 / touchpoint · fixed for Standalone (mini-hub)") >= 0,
        "and shows the touchpoint as fixed for the hub type");
  check(txt(doc).indexOf("₹2.80 / shipment · above ceiling") >= 0, "with the slab over its ceiling flagged");
  check(!exists(doc, "#ap-approve"), "the CH cannot settle it");
  api.actions.chRate(4);
  check(exists(doc, "#ap-central"), "and once their own review is done, must raise it");
  click(doc, "ap-central");
  api.actions.adminSwitchRole();
  asCentral(doc, "bizfin");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("For a Standalone (mini-hub), slab 3 (5,001–7,500 orders) is ₹2.80") >= 0,
        "and BizFin is told which ceiling was breached");

  /* --- a desk looking at someone else's request gets read-only, not ZH copy --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  api.actions.adminOpen("OBD-78255");           /* now settled, so off the CH's desk */
  check(exists(doc, '[data-testid="zh-monitor-only"]'), "a closed request opens read-only");
  check(txt(doc).indexOf("Zonal Head panel") === -1,
        "and does not tell a Cluster Head it is the Zonal Head's panel");
  check(txt(doc).indexOf("pending with the Closed") === -1,
        "nor describe a closed request as pending with 'Closed'");
  check(txt(doc).indexOf("it was approved") >= 0, "it states the outcome instead");

  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="zh"]');
  api.actions.adminOpen("OBD-78219");
  check(txt(doc).indexOf("Zonal Head panel") >= 0,
        "while the Zonal Head still gets the monitoring wording");
  check(txt(doc).indexOf("pending with the Cluster Head") >= 0, "naming the desk holding it");

  /* --- nothing is ever stranded at a desk that cannot act --- */
  const stuck = api.state.adminRequests.filter(r => r.stage === "zh");
  eq(stuck.length, 0,
     "no request sits at the Zonal Head, who has no actions to move it on");

  api.stopTimers();
  win.close();
}


/* =========================================================================
   18. FM captain copy — nothing internal leaks through
   ====================================================================== */

/* Words the FM captain must never be shown. The hub category, the ceiling it
   drives and every desk above the Cluster Head are internal (README decision 4). */
const FM_FORBIDDEN = ["Zonal Head", "hub category", "Hub category",
                      "ceiling", "Ceiling", "benchmark", "Benchmark"];

function scanFM(doc, where) {
  const seen = txt(doc);
  FM_FORBIDDEN.forEach(w =>
    check(seen.indexOf(w) === -1, where + ": no \"" + w + "\""));
}

async function testFMCaptainCopy() {
  section("18. FM captain copy — nothing internal leaks");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  scanFM(doc, "role picker");
  doPersonalDetails(doc);
  scanFM(doc, "personal details");
  doKyc(doc, "FM");
  scanFM(doc, "KYC");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  scanFM(doc, "hub details");
  click(doc, "hub-continue");
  scanFM(doc, "hub submitted");
  api.actions.bgvSet("passed");
  scanFM(doc, "background verification");
  click(doc, "bgv-continue");
  scanFM(doc, "Cluster Head review, awaiting hub type");

  api.actions.chSetCategory("mall");
  scanFM(doc, "Cluster Head review, hub type set");
  api.actions.amSubmitRate(true);
  scanFM(doc, "rate card submitted");
  api.actions.chRaise();
  scanFM(doc, "pending sign-off");
  api.actions.centralReject();
  scanFM(doc, "in revision");
  api.actions.amReprice();
  api.actions.chApprove();
  scanFM(doc, "approved");

  click(doc, "ch-continue");
  scanFM(doc, "agreements");
  /* the agreement text itself, which the captain scrolls through in full */
  check(txt(doc).indexOf("The rates shown for your hub on Valmo One apply") >= 0 &&
        txt(doc).indexOf("it applies only once you agree to it") >= 0 &&
        txt(doc).indexOf("never applies to days before you agree") >= 0,
        "the service agreement says a revision applies only once the captain agrees, never backdated, naming no desk");
  check(txt(doc).indexOf("Your rates are set by your Area Manager") >= 0,
        "the rate card checkbox credits the Area Manager");
  check(txt(doc).indexOf("captured during Cluster Head review") === -1,
        "and no longer says the Cluster Head captured the values");

  doAgreements(doc, api);
  scanFM(doc, "activation");
  api.stopTimers();
  api.actions.finishActivation();
  scanFM(doc, "activated");

  win.close();
}

/* =========================================================================
   19. FM captain — Combined is the only payout type
   ====================================================================== */

async function testFMNoSplit() {
  section("19. FM captain — no Split anywhere");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");

  const noSplit = (where) => {
    check(txt(doc).indexOf("Split") === -1 && txt(doc).indexOf("split") === -1,
          where + ": no Split on screen");
    check(!exists(doc, '[data-testid="split-caveat"]') &&
          !exists(doc, '[data-testid="split-caveat-ag"]'),
          where + ": no split caveat block");
    check(devText().indexOf("Split") === -1 && devText().indexOf("split") === -1,
          where + ": no Split option in the dev panel");
  };
  const devText = () => {
    const d = doc.getElementById("devbar");
    return d ? d.textContent : "";
  };

  api.actions.chSetCategory("standalone");
  noSplit("hub type set");
  api.actions.amSubmitRate(false);
  noSplit("rate card submitted");
  eq(api.helpers.R().ch.rateMode, "combined", "the only mode the AM can author");
  api.actions.chApprove();
  noSplit("approved");

  /* the split helper is gone from the surface entirely */
  check(typeof api.helpers.indicativeCaptainSplit === "undefined",
        "indicativeCaptainSplit is no longer exported \u2014 nothing computes a split");

  click(doc, "ch-continue");
  noSplit("agreements");
  check(exists(doc, '[data-testid="agreement-rate-card"]'),
        "agreements shows the agreed card");
  check(mainTxt(doc).indexOf("Agreed rate card") >= 0,
        "labelled without a payout mode in brackets");

  /* even if old state carried a split mode, nothing renders one */
  api.helpers.R().ch.rateMode = "split";
  api.render();
  noSplit("agreements with a stale split mode in state");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   14. FM Carting Design Input — hub code, validation, and design alignment
   ====================================================================== */

async function testCartingDesign() {
  section("14. FM Carting Design Input and design alignment");
  const { win, doc, api } = await boot();

  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');

  /* --- a hub code is assigned the moment the AM picks the request up --- */
  const before = api.helpers.apById("OBD-78222").hubCode;
  eq(before, "", "a request carries no hub code until an Area Manager opens it");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  const code = api.helpers.apById("OBD-78222").hubCode;
  eq(code.length, 3, "opening it assigns a 3-letter hub code");
  check(/^[A-Z]{3}$/.test(code), "made only of capital letters");
  check(api.config.KNOWN_HUB_CODES.indexOf(code) === -1,
        "and not one the network already uses");
  check(txt(doc).indexOf("Hub code " + code) >= 0, "shown at the top of the infra check");
  api.actions.adminOpen("OBD-78222");
  eq(api.helpers.apById("OBD-78222").hubCode, code, "the code sticks across reopens");

  /* --- the design page sits between the infra check and the rate card --- */
  api.config.AM_GATES.forEach(g => api.actions.amGate(g.id, "yes"));
  clickSel(doc, '[data-vehreview="yes"]');
  check(txt(doc).indexOf("Continue to carting design") >= 0,
        "the infra check continues to the carting design, not the rate card");
  click(doc, "am-to-design");
  check(txt(doc).indexOf("step 2 of 3 · FM Carting Design Input") >= 0, "which is step 2 of 3");
  check(exists(doc, "#am-fmsc"), "with an FMSC box");
  check(exists(doc, "#am-fmcds"), "an FMCDs box");
  check(exists(doc, "#am-onboarding"), "and an onboarding type");
  eq([...$(doc, "am-onboarding").options].slice(1).map(o => o.textContent),
     ["Split from existing", "New expansion", "Multitouch"],
     "offering the three onboarding types");

  /* --- FMSC is mandatory, FMCDs are not --- */
  check(disabled(doc, "am-design-validate"), "Validate is closed with nothing filled in");
  api.actions.designField("onboarding", "split");
  check(disabled(doc, "am-design-validate"), "and stays closed without an FMSC");
  type(doc, "am-fmsc", "SSY");
  check(!disabled(doc, "am-design-validate"), "FMSC plus a type is enough — FMCDs are optional");

  /* --- validation rejects codes the network does not know --- */
  type(doc, "am-fmcds", "KRM, ZZZ");
  click(doc, "am-design-validate");
  check(exists(doc, '[data-testid="am-design-error"]'), "an unknown code fails validation");
  check(txt(doc).indexOf("ZZZ") >= 0, "naming the code that does not exist");
  check(txt(doc).indexOf("does not exist in the system") >= 0, "and why it failed");
  check(!exists(doc, '[data-testid="am-design-send"]'), "so the design cannot be sent");
  eq(api.helpers.apById("OBD-78222").design.validated, false, "and nothing is marked validated");

  type(doc, "am-fmcds", "KRM, HSR");
  click(doc, "am-design-validate");
  check(!exists(doc, '[data-testid="am-design-error"]'), "correcting it clears the error");
  eq(api.helpers.apById("OBD-78222").design.validated, true, "the codes are validated");
  check(exists(doc, '[data-testid="am-design-send"]'),
        "and Validate becomes Send Design for Approval");
  check(txt(doc).indexOf("Send Design for Approval") >= 0, "with that label");

  /* editing after a pass sends you back through Validate */
  type(doc, "am-fmsc", "SS");
  eq(api.helpers.apById("OBD-78222").design.validated, false,
     "editing a field invalidates the previous run");
  check(!exists(doc, '[data-testid="am-design-send"]'), "so Send is withdrawn");
  type(doc, "am-fmsc", "SSY");
  click(doc, "am-design-validate");

  /* --- sending the design moves the AM on to the rate card --- */
  check(!api.helpers.designReady(api.helpers.apById("OBD-78222")),
        "the rate card is closed until the design is sent");
  api.actions.amStep("rate");
  eq(api.state.admin.amStep, "design", "so stepping to it is refused");
  click(doc, "am-design-send");
  eq(api.state.admin.amStep, "rate", "sending it opens the rate card");
  const sent = api.helpers.apById("OBD-78222");
  eq(sent.design.sent, true, "the design is marked sent");
  eq(sent.design.fmsc, "SSY", "with the FMSC recorded");
  eq(api.helpers.parseCodes(sent.design.fmcds), ["KRM", "HSR"], "and the cross-docks parsed");
  eq(sent.stage, "am", "the request itself stays with the Area Manager");

  click(doc, "am-to-design");
  check(exists(doc, '[data-testid="am-design-sent"]'), "the design page says it is with Central");
  check($(doc, "am-fmsc").disabled, "and is locked against further edits");

  /* --- Central Admin aligns the design --- */
  api.actions.adminSwitchRole();
  asCentral(doc, "design");
  check(apVisible(doc).indexOf("OBD-78222") >= 0, "it appears in Central Admin's design queue");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("Design alignment") >= 0, "opening it shows the design alignment");

  const shown = txt(doc);
  ["City", "Hub code", "Lat-Long / Map link", "Pincodes serving", "Max vehicle size",
   "Hub type", "Hub address", "Hub pincode", "State",
   "Split from / New expansion", "Multitouch"].forEach(f =>
    check(shown.indexOf(f) >= 0, "the design inputs include " + f));
  check(shown.indexOf("Split from existing") >= 0, "the onboarding type is resolved");
  check(shown.indexOf("Not set yet") >= 0,
        "hub type is honestly blank — the AM sets it later, on the rate card");

  /* the mapping is the only thing Central may change */
  check(exists(doc, "#cad-fmsc"), "the FMSC is editable here");
  check(exists(doc, "#cad-fmcds"), "and so are the cross-docks");
  type(doc, "cad-fmsc", "QQQ");
  click(doc, "cad-save");
  check(exists(doc, '[data-testid="central-design-error"]'),
        "a mapping Central mistypes is refused too");
  eq(api.helpers.apById("OBD-78222").design.approved, false, "and nothing is approved");
  type(doc, "cad-fmsc", "IND");
  click(doc, "cad-save");
  check(exists(doc, '[data-testid="central-design-edited"]'), "a valid change is recorded");

  click(doc, "cad-approve");
  const done = api.helpers.apById("OBD-78222");
  eq(done.design.approved, true, "Approve Design settles the alignment");
  eq(done.design.fmsc, "IND", "with Central's corrected mapping");
  check(apVisible(doc).indexOf("OBD-78222") === -1, "and it leaves the design queue");

  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  api.actions.adminOpen("OBD-78222");
  api.actions.amStep("design");
  check(exists(doc, '[data-testid="am-design-approved"]'),
        "the Area Manager sees the design approved");
  check(txt(doc).indexOf("IND") >= 0, "with the mapping Central corrected it to");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   20. Copy and seed-data consistency
   ====================================================================== */

async function testCopyConsistency() {
  section("20. Copy and seed-data consistency");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  /* --- one framing for the vehicle count, picker and summary alike --- */
  pickPincode(doc, "560076");
  type(doc, "hub-address", "Plot 7, Bommasandra");
  type(doc, "hub-map", mapFor(doc, "560076"));
  type(doc, "hub-area", "4000");
  type(doc, "hub-manpower", "12");
  pickMaxVehicle(doc, "7MT_20FT");
  const picker = txt(doc);
  const m = picker.match(/Also fits (\d+) smaller types?/);
  check(!!m, "the picker frames the count as 'Also fits N smaller types'");
  check(picker.indexOf(" of 23") === -1, "and not as 'N of 23'");
  click(doc, "hub-submit");
  const summary = txt(doc);
  check(summary.indexOf("Also fits " + m[1] + " smaller types") >= 0,
        "the submitted summary uses the same framing and the same number");
  check(summary.indexOf(" of 23") === -1, "the 'N of 23' framing is gone");
  click(doc, "hub-continue");

  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chSetCategory("standalone");
  api.actions.amSubmitRate(false);

  /* --- the header follows the state --- */
  check(txt(doc).indexOf("Cluster Head is reviewing your request") >= 0,
        "while pending, the header says the Cluster Head is reviewing");
  api.actions.chApprove();
  check(txt(doc).indexOf("Your rate card is approved") >= 0,
        "once approved, the header says the rate card is approved");
  check(txt(doc).indexOf("Cluster Head is reviewing your request") === -1,
        "and no longer claims it is still under review");

  /* --- the approval date reads like the activation date --- */
  check(/Approved on \d{2} \w+ \d{4}/.test(txt(doc)),
        "the approval date is a day stamp like '23 Sept 2026'");
  check(!/Approved on \w{3} \w{3} \d{2}/.test(txt(doc)),
        "not a raw toDateString");

  /* --- one default hub name in both places --- */
  click(doc, "ch-continue");
  doAgreements(doc, api);
  api.stopTimers();
  api.actions.finishActivation();
  const shownName = txt(doc).match(/\d{6} Hub/);
  check(!!shownName, "activation names the hub '<pincode> Hub'");
  const hub = api.state.hubs.find(h => h.role === "FM");
  eq(hub.name, shownName[0],
     "and the hub Captain Hub lists carries exactly that name");
  check(hub.name.indexOf("New Hub") === -1, "no separate 'New Hub' default");
  win.close();

  /* --- seeded admin data is internally consistent --- */
  const b = await boot();
  b.api.actions.openAdminRole("am");
  const reqs = b.api.state.adminRequests;
  const r19 = reqs.find(r => r.id === "OBD-78219");
  check(r19.address.indexOf("Indiranagar") === -1,
        "OBD-78219 no longer claims an Indiranagar address on a 560076 pincode");
  check(r19.address.indexOf("BTM Layout") >= 0, "it sits in BTM Layout, which is 560076");
  reqs.forEach(r => {
    check(r.pincodesServing.indexOf(r.pincode) >= 0,
          r.id + " serves its own pincode " + r.pincode);
  });

  /* --- hub type is honestly unset until the AM reaches the rate card --- */
  const fresh = reqs.find(r => r.stage === "am" && !r.hubCategory);
  check(!!fresh, "a request the AM has not priced yet exists");
  b.api.actions.adminOpen(fresh.id);
  b.api.actions.amStep("design");
  b.api.actions.designField("fmsc", "SSY");
  b.api.actions.designField("onboarding", "split");
  b.api.actions.designValidate();
  b.api.actions.designSend();
  b.api.actions.adminSwitchRole();
  asCentral(b.doc, "design");
  b.api.actions.adminOpen(fresh.id);
  check(txt(b.doc).indexOf("Not set yet") >= 0,
        "the design alignment shows hub type as not set yet");
  check(txt(b.doc).indexOf(fresh.pincode) >= 0,
        "and the serving pincodes include the hub's own");

  b.api.stopTimers();
  b.win.close();
}

/* =========================================================================
   21. Pincodes live on hub details — entered, never checked
   ====================================================================== */

async function testPincodesOnHub() {
  section("21. Pincodes live on hub details — entered, never checked");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");

  /* --- personal details asks only about the person --- */
  check(!exists(doc, "#hub-pins") && !exists(doc, "#pd-pin"),
        "personal details has no pincode field");
  check(txt(doc).indexOf("Pincodes this hub will service") === -1, "and no pincode section");
  check(txt(doc).indexOf("Check availability") === -1, "and no availability check");
  doPersonalDetails(doc);
  eq(api.helpers.phaseId(), "kyc", "personal details continues with no pincode at all");
  eq(api.config.PHASES.FM[0].sub, "Name, email, alternate phone",
     "the rail no longer lists pincode under personal details");
  eq(api.config.PHASES.FM[2].sub, "Pincode, address and facility",
     "it lists it under hub details instead");

  /* --- hub details lists them, between the facility size and the vehicle --- */
  doKyc(doc, "FM");
  eq(api.helpers.phaseId(), "hub", "KYC → hub details");
  const order = txt(doc);
  check(order.indexOf("Pincodes this hub will service") >= 0, "hub details lists the pincodes to service");
  const picker = sel(doc, '[data-testid="pincode-picker"]');
  const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & win.Node.DOCUMENT_POSITION_FOLLOWING);
  check(isBefore($(doc, "hub-address"), picker) && isBefore($(doc, "hub-map"), picker),
        "it comes after the address and map link");
  check(isBefore($(doc, "hub-area"), picker) && isBefore($(doc, "hub-manpower"), picker),
        "and after hub area and estimated manpower");
  check(isBefore(picker, $(doc, "veh-toggle")), "and before max vehicle size");
  check(txt(doc).indexOf("The 6-digit pincode the hub sits in.") >= 0, "the hub pincode field says what it wants");
  check(!exists(doc, "#hub-check") && txt(doc).indexOf("Check availability") === -1,
        "there is no availability check any more");
  type(doc, "hub-pins", "560076, 700001");
  click(doc, "hub-addpin");
  eq(api.helpers.R().hub.pincodes, ["560076", "700001"], "any valid pincodes are taken, as entered");
  check(!sel(doc, ".pchip.ok") && !sel(doc, ".pchip.no") &&
        sel(doc, '[data-testid="pincode-picker"]').textContent.indexOf("✓") === -1,
        "none is marked available or unavailable");
  check(!exists(doc, "[data-selpin]"), "and there is nothing to pick from");
  type(doc, "hub-pin", "560076");
  eq(api.helpers.R().hub.selected, "560076", "the hub pincode is whatever is typed");
  eq($(doc, "hub-city").value, "Bengaluru, Karnataka", "and resolves the city");

  /* --- picks survive a submit failure elsewhere on the form --- */
  api.actions.hubSubmit({ address: "", mapLink: "", areaSqft: "", manpower: "", maxVehicle: "" });
  eq(api.helpers.R().hub.selected, "560076", "a failed submit keeps the hub pincode");
  check(txt(doc).indexOf(api.errors.pincodeSelect) === -1, "and does not complain about it");

  /* --- both are needed to submit, nothing more --- */
  api.actions.removePincode("560076");
  api.actions.removePincode("700001");
  api.actions.typeHubPincode("");
  api.actions.hubSubmit({ address: "Plot 7, Bommasandra Industrial Area", mapLink: mapFor(doc, "560076"), areaSqft: "4000", manpower: "12",
                          maxVehicle: "7MT_20FT" });
  check(!api.helpers.R().hub.submitted, "with no pincodes at all it won’t submit");
  eq(api.helpers.R().hub.errors.hubPin, api.errors.pincodeSelect, "it asks for the hub’s pincode");
  eq(api.helpers.R().hub.errors.pincode, api.errors.pincodeNone, "and for at least one to service");
  api.actions.addPincodes("700001");
  api.actions.typeHubPincode("700001");
  api.actions.hubSubmit({});
  check(api.helpers.R().hub.submitted, "a pincode VALMO had never listed is fine");
  check(txt(doc).indexOf("Pincodes serviced") >= 0 && txt(doc).indexOf("700001") >= 0,
        "and the summary lists the pincodes it services");
  click(doc, "hub-edit");

  /* --- an older save that kept pincodes on personal details is migrated --- */
  const old = JSON.parse(win.localStorage.getItem(api.STORE_KEY));
  old.roles.FM.pd.pincodes = ["560034", "560102"];
  old.roles.FM.pd.checked = true;
  old.roles.FM.pd.selected = "560034";
  delete old.roles.FM.hub.pincodes; delete old.roles.FM.hub.checked; delete old.roles.FM.hub.selected;
  win.localStorage.setItem(api.STORE_KEY, JSON.stringify(old));
  check(api.reload(), "the older save loads");
  const mig = api.state.roles.FM;
  eq(mig.hub.pincodes, ["560034", "560102"], "its pincodes move onto hub details");
  eq(mig.hub.selected, "560034", "with the pick intact");
  check(mig.pd.pincodes === undefined, "and personal details no longer carries them");

  api.stopTimers();
  win.close();

  /* --- an existing captain adding a hub now chooses its pincode --- */
  const b = await boot();
  b.api.state.loginAs = "existing";
  b.api.helpers.seedExistingCaptain();
  login(b.doc);
  b.api.actions.openPanel("hubs", "hubs");
  b.api.actions.addHubOpen();
  b.api.actions.addHubRole("LM");
  b.api.actions.addHubChoice("none");
  b.api.actions.addHubContinue();
  eq(b.api.helpers.phaseId(), "hub", "adding a hub starts at hub details");
  check(exists(b.doc, '[data-testid="pincode-picker"]'),
        "with the pincodes to service, which it never had before");
  eq(b.api.helpers.R().hub.pincode, "", "the new hub has no pincode until one is entered");
  doHubDetails(b.doc, { pin: "560102", address: "Unit 3, HSR Layout, Bengaluru" });
  eq(b.api.helpers.R().hub.pincode, "560102", "and records the one entered");
  b.api.stopTimers();
  b.win.close();

}

/* =========================================================================
   22. Map preview and pin-location checks
   ====================================================================== */

async function testMapPin() {
  section("22. Map preview and pin-location checks");
  const { win, doc, api } = await boot();
  const H = api.helpers, E = api.errors;
  const at = (pin) => "https://maps.google.com/?q=" + H.PIN_AREAS[pin].lat + "," + H.PIN_AREAS[pin].lng;

  /* --- the link formats Google Maps hands out --- */
  eq(H.parseMapLink("https://maps.google.com/?q=12.9081,77.6040"), { lat: 12.9081, lng: 77.604 },
     "?q=lat,lng");
  eq(H.parseMapLink("https://www.google.com/maps/@12.9116,77.6474,17z"), { lat: 12.9116, lng: 77.6474 },
     "/@lat,lng,zoom");
  eq(H.parseMapLink("https://www.google.com/maps/place/Hub/@12.0,77.0,17z/data=!3d12.9081!4d77.6040"),
     { lat: 12.9081, lng: 77.604 }, "a place link reads the pin, not where the map was scrolled");
  eq(H.parseMapLink("https://maps.google.com/?q=12.9081%2C77.6040"), { lat: 12.9081, lng: 77.604 },
     "an encoded comma");
  eq(H.parseMapLink("https://maps.app.goo.gl/AbC123"), null, "a short link carries no coordinates");
  eq(H.parseMapLink("https://maps.google.com/?q=Koramangala"), null, "nor does a text search");

  /* --- every outcome of the check --- */
  const k = (link, pin) => H.checkMapPin(link, pin);
  check(k(at("560076"), "560076").ok, "a pin at the pincode's centre passes");
  const wrong = k(at("560034"), "560076");
  eq(wrong.code, "elsewhere", "a pin in a neighbouring pincode fails");
  check(wrong.msg.indexOf("560034 (Koramangala)") >= 0 && wrong.msg.indexOf("560076") >= 0,
        "and names both the pincode it is in and the one it should be in");
  const far = k("https://maps.google.com/?q=12.30,76.65", "560076");
  eq(far.code, "far", "a pin in another city fails");
  check(/123\.\d km/.test(far.msg), "with how far off it is: " + far.msg.slice(0, 40));
  eq(k("https://maps.google.com/?q=51.5,-0.12", "560076").code, "india", "a pin abroad fails");
  eq(k("https://maps.google.com/?q=12.9,190.2", "560076").code, "range", "impossible coordinates fail");
  const shared = k("https://maps.app.goo.gl/AbC123", "560076");
  check(shared.ok && shared.code === "shared", "a short share link from the Maps app is accepted as it is");
  check(!shared.msg, "with no advice to swap it for the full link");
  check(H.isShortMapLink("https://goo.gl/maps/xyz789"), "the older goo.gl/maps form counts too");
  eq(k("https://maps.google.com/?q=Koramangala", "560076").msg, E.mapNoPin, "a pinless link too");
  eq(k("notalink", "560076").msg, E.mapLink, "a non-maps link is a format error");
  const pending = k(at("560076"), null);
  check(pending.ok && pending.pending, "with no pincode chosen there is nothing to check it against yet");

  /* --- on hub details --- */
  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  pickPincode(doc, "560076");
  /* the harness has no Leaflet, so the map falls back to Google's embed: before
     a link there is nothing to show, and it says to paste one */
  check(exists(doc, '#hub-map-preview [data-testid="map-off"]'), "before a link, the map says to paste one");
  check(!exists(doc, '[data-testid="map-pin-ok"]') && !exists(doc, '[data-testid="map-pin-bad"]'),
        "with no pin to judge");

  const input = $(doc, "hub-map");
  type(doc, "hub-map", at("560076"));
  check($(doc, "hub-map") === input, "typing patches the preview in place — the field is never redrawn");
  check(exists(doc, '[data-testid="map-preview"]'), "a valid link draws the preview");
  const frame = sel(doc, '[data-testid="map-preview"] iframe');
  check(!!frame && frame.getAttribute("src").indexOf("q=12.9081,77.604") >= 0 &&
        frame.getAttribute("src").indexOf("output=embed") >= 0,
        "as an embedded Google map at the pin");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "marked inside the pincode");
  check(sel(doc, '[data-testid="map-pin-ok"]').textContent.indexOf("560076 · BTM Layout") >= 0,
        "naming the pincode and its area");
  check(txt(doc).indexOf("Open in Google Maps") >= 0, "with a link out to Google Maps");

  /* a wrong pin is flagged while typing, because its coordinates already read */
  type(doc, "hub-map", at("560034"));
  check(exists(doc, '[data-testid="map-pin-bad"]'), "a pin in another pincode is flagged on the map");
  check($(doc, "hub-map-hint").textContent.indexOf("560034 (Koramangala)") >= 0,
        "and explained under the field straight away");
  check($(doc, "hub-map-box").classList.contains("bad"), "with the field marked");

  /* a half-typed link is left alone until the captain leaves the field */
  type(doc, "hub-map", "https://maps.goo");
  check(!$(doc, "hub-map-box").classList.contains("bad"), "a half-typed link is not shouted at");
  $(doc, "hub-map").dispatchEvent(new win.Event("change", { bubbles: true }));
  check($(doc, "hub-map-box").classList.contains("bad"), "but is flagged once the field is left");
  eq($(doc, "hub-map-hint").textContent, api.vx.mapNotGoogle, "with the format error");

  /* submit runs the same check */
  doHubDetails(doc, { pin: null, map: at("560034") });
  check(!H.R().hub.submitted, "a hub pinned outside its pincode cannot be submitted");
  check(txt(doc).indexOf("not the hub’s pincode 560076") >= 0, "and says why");

  /* choosing the pincode the pin is actually in clears it */
  api.actions.addPincodes("560034");
  api.actions.typeHubPincode("560034");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "re-entering the pincode re-checks the pin");
  doHubDetails(doc, { pin: null, map: at("560034") });
  check(H.R().hub.submitted, "and the hub submits");
  check(txt(doc).indexOf("Map location") >= 0 && txt(doc).indexOf("12.93520, 77.62450") >= 0,
        "the summary records where the pin landed");

  /* a short share link goes straight through — it opens in Google Maps */
  const sh = await boot();
  login(sh.doc);
  pickRole(sh.doc, "FM");
  doPersonalDetails(sh.doc);
  doKyc(sh.doc, "FM");
  pickPincode(sh.doc, "560076");
  type(sh.doc, "hub-map", "https://maps.app.goo.gl/AbC123");
  $(sh.doc, "hub-map").dispatchEvent(new sh.win.Event("change", { bubbles: true }));
  check(!$(sh.doc, "hub-map-box").classList.contains("bad"), "hub details: a short share link is not flagged");
  check($(sh.doc, "hub-map-hint").textContent.indexOf("Short links") === -1, "and gets no short-link advice");
  const out = sel(sh.doc, '[data-testid="map-preview-shared"] a');
  check(!!out && out.getAttribute("href") === "https://maps.app.goo.gl/AbC123",
        "its preview is a link out to it in Google Maps");
  doHubDetails(sh.doc, { pin: null, map: "https://maps.app.goo.gl/AbC123" });
  check(sh.api.helpers.R().hub.submitted, "and hub details submits with it");
  check(txt(sh.doc).indexOf("Google Maps share link") >= 0, "the summary shows it as a share link");
  sh.api.stopTimers();
  sh.win.close();

  api.stopTimers();
  win.close();
}

/* =========================================================================
   23. API failures — the reason, and resuming from the same step
   ====================================================================== */

async function testApiFailures() {
  section("23. API failures — reason shown, resume from the same step");
  const { win, doc, api } = await boot();
  const A = api.actions, H = api.helpers, C = api.config;
  const failBox = (d = doc) => sel(d, '[data-testid="api-fail"]');
  const failText = (d = doc) => (failBox(d) ? failBox(d).textContent : "");

  login(doc);
  pickRole(doc, "FM");

  /* --- personal details: the email code --- */
  type(doc, "pd-name", "Karan Verma");
  type(doc, "pd-email", "karan.verma@gmail.com");
  check(devText(doc).indexOf("Fail next email code · times out (504)") >= 0,
        "the dev panel offers an email failure on personal details");
  devClick(doc, "fail:email:timeout");
  check(devText(doc).indexOf("Armed · Fail next email code") >= 0, "and shows it armed");
  click(doc, "pd-verify-email");
  check(!!failBox(), "a failed email code shows a failure notice");
  check(failText().indexOf("Email verification didn’t go through") >= 0, "naming what failed");
  check(failText().indexOf(C.API_FAIL.email.timeout) >= 0, "with the service’s reason");
  check(failText().indexOf(C.FAIL_SAVED) >= 0, "and that nothing entered is lost");
  check(/^Error 504 · Ref EMAIL-504-\d{5} · \d{1,2} \w+ 20\d\d, /.test(
          sel(doc, '[data-testid="api-fail-ref"]').textContent),
        "with an error code, a reference and a time for Support");
  check(!exists(doc, "#pd-email-otp"), "no code box opens");
  eq($(doc, "pd-email").value, "karan.verma@gmail.com", "the email stays filled in");
  eq($(doc, "pd-verify-email").textContent, "Resume", "its button becomes Resume");
  check(devText(doc).indexOf("Armed ·") === -1, "the armed failure is spent on that one call");
  click(doc, "pd-verify-email");
  check(!failBox(), "resuming clears the notice");
  check(exists(doc, "#pd-email-otp"), "and sends the code");
  type(doc, "pd-email-otp", "000000");
  click(doc, "pd-email-otp-go");
  setCheck(doc, "pd-tnc", true);
  click(doc, "pd-continue");
  eq(H.phaseId(), "kyc", "personal details completes after the resume");

  /* --- Aadhaar: fails at the OTP send, then at the DigiLocker fetch --- */
  check(devText(doc).indexOf("Fail next Aadhaar check · service down (503)") >= 0,
        "on each KYC card the dev panel offers that card’s failures");
  check(devText(doc).indexOf("Fail next PAN check") === -1, "and only that card’s");
  A.armFail("aadhaar", "timeout");
  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  check(failText().indexOf("Aadhaar verification didn’t go through") >= 0 &&
        failText().indexOf(C.API_FAIL.aadhaar.timeout) >= 0, "Aadhaar: the DigiLocker timeout is explained");
  eq($(doc, "kyc-aadhaar").value, "123412341234", "the Aadhaar number stays filled in");
  eq($(doc, "kyc-aadhaar-go").textContent, "Resume verification →",
     "the card’s button becomes Resume verification");
  click(doc, "kyc-aadhaar-go");
  check(!failBox() && exists(doc, "#kyc-aadhaar-otp"), "resuming sends the OTP");
  A.armFail("aadhaar", "down");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  check(failText().indexOf(C.API_FAIL.aadhaar.down) >= 0, "a fetch that fails after a good OTP is explained too");
  check(!H.R().kyc.aadhaar.done, "and Aadhaar is not marked verified");
  check(!exists(doc, "#kyc-aadhaar-otp"), "the spent OTP box closes");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  check(H.R().kyc.aadhaar.done && !H.R().fail, "resuming with a fresh OTP verifies Aadhaar");
  click(doc, "kyc-ack-aadhaar");

  /* --- PAN: the failure survives leaving and coming back --- */
  A.armFail("pan", "down");
  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  check(failText().indexOf(C.API_FAIL.pan.down) >= 0, "PAN: the maintenance window is explained");
  check(/Error 503 · Ref PAN-503-\d{5}/.test(failText()), "with the 503 code");
  click(doc, "save-exit");
  eq(api.state.screen, "roles", "the captain can save and exit from a failure");
  const paused = sel(doc, '[data-role-card="FM"] [data-testid="role-paused"]');
  check(!!paused && paused.textContent.indexOf("PAN verification didn’t go through") >= 0,
        "the role card says what is waiting");
  eq(sel(doc, '[data-pick="FM"]').textContent, "Resume onboarding", "and offers to resume");
  check(api.reload(), "the failure is saved with the application");
  pickRole(doc, "FM");
  eq(H.phaseId(), "kyc", "resuming reopens KYC");
  check(failText().indexOf(C.API_FAIL.pan.down) >= 0, "on the PAN card, still explaining the failure");
  eq($(doc, "kyc-pan").value, "ABCDE1234F", "with the PAN still filled in");
  eq($(doc, "kyc-pan-father").value, "Suresh Verma", "and the father’s name");
  click(doc, "kyc-pan-go");
  check(H.R().kyc.pan.done && !failBox(), "resume verifies the PAN");
  click(doc, "kyc-ack-pan");

  /* --- bank and GST --- */
  A.armFail("bank", "timeout");
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  check(failText().indexOf(C.API_FAIL.bank.timeout) >= 0, "bank: the penny-drop timeout is explained");
  check(!H.R().kyc.bank.done, "the account is not marked verified");
  click(doc, "kyc-bank-go");
  check(H.R().kyc.bank.done, "resume verifies the account");
  click(doc, "kyc-ack-bank");

  A.armFail("gst", "down");
  type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
  click(doc, "kyc-gst-go");
  check(failText().indexOf(C.API_FAIL.gst.down) >= 0, "GST: the portal maintenance is explained");
  eq($(doc, "kyc-gstin").value, "29ABCDE1234F1Z5", "the GSTIN stays filled in");
  click(doc, "kyc-gst-go");
  check(H.R().kyc.gst.done, "resume verifies the GSTIN");
  click(doc, "kyc-continue");
  eq(H.phaseId(), "hub", "KYC completes after four resumed failures");

  /* --- hub details makes no call that can fail --- */
  eq(devText(doc).indexOf("Simulate an API failure"), -1, "hub details has nothing to fail — no availability check");
  doHubDetails(doc);
  click(doc, "hub-continue");

  /* --- background verification fails in place --- */
  eq(H.phaseId(), "bgv", "at background verification");
  devClick(doc, "bgvfail:timeout");
  check(txt(doc).indexOf("Background verification paused") >= 0, "BGV: the check is paused, not failed");
  check(failText().indexOf(C.API_FAIL.bgv.timeout) >= 0, "with the partner’s reason");
  check(devText(doc).indexOf("Mark BGV passed") === -1, "no outcome can arrive until it is resumed");
  click(doc, "bgv-resume");
  check(!failBox() && txt(doc).indexOf("Background verification in progress") >= 0,
        "resume sends it again");
  A.bgvSet("passed");
  eq(H.R().bgv.status, "passed", "and it can then clear");
  eq(Object.keys(api.state.failNext).length, 0, "nothing is left armed");

  api.stopTimers();
  win.close();

  /* --- activation resumes from the system that failed --- */
  const b = await boot();
  login(b.doc);
  pickRole(b.doc, "LM");
  doPersonalDetails(b.doc);
  doKyc(b.doc, "LM");
  doHubDetails(b.doc);
  click(b.doc, "hub-continue");
  b.api.actions.bgvSet("passed");
  click(b.doc, "bgv-continue");
  b.api.actions.chApprove();
  click(b.doc, "ch-continue");
  click(b.doc, "sd-pay");
  click(b.doc, "sd-continue");
  b.api.actions.amApprove();
  click(b.doc, "am-continue");
  doAgreements(b.doc, b.api);
  const act = () => b.api.helpers.R().act;
  await waitFor(b.win, () => Object.keys(act().done).length >= 2, "two systems done");
  b.api.actions.actFail();
  const doneAtFail = Object.keys(act().done);
  const failedSys = b.api.config.FANOUT.LM.filter(f => doneAtFail.indexOf(f.id) < 0)[0];
  check(failText(b.doc).indexOf(failedSys.label + " is taking too long right now.") >= 0,
        "activation names the system that failed (" + failedSys.label + ")");
  check(txt(b.doc).indexOf("Activation paused") >= 0, "and calls activation paused");
  /* the admin status chip shares the .st class — it must not stop a status line wrapping */
  const stBox = b.win.getComputedStyle(sel(b.doc, ".status-head .st"));
  check(stBox.whiteSpace !== "nowrap" && stBox.display === "block",
        "a long status line wraps inside the card (white-space " + stBox.whiteSpace + ")");
  eq(b.doc.querySelectorAll(".tl .tlrow.bad, .tl .bad").length >= 1, true, "the failed system is marked");
  eq($(b.doc, "act-retry").textContent, "Resume activation", "the button is Resume activation");
  click(b.doc, "act-retry");
  eq(Object.keys(act().done).sort(), doneAtFail.sort(), "resuming keeps the systems that finished");
  check(!failBox(b.doc), "and clears the notice");
  await waitFor(b.win, () => act().status === "active", "resumed activation");
  eq(Object.keys(act().done).length, 6, "and carries on through the rest");
  b.api.stopTimers();
  b.win.close();

  /* --- Captain Hub: the bank not answering is not a failed account --- */
  const c = await boot();
  c.api.state.loginAs = "existing";
  c.api.helpers.seedExistingCaptain();
  login(c.doc);
  c.api.actions.openPanel("profile", "personal");
  c.api.actions.bankEditStart();
  c.api.actions.bankOtp("000000");
  c.api.actions.bankSubmit("998877665544", "ICIC0000123", "Karan Verma");
  check(devText(c.doc).indexOf("Bank times out (504)") >= 0, "bank change: the dev panel offers a bank timeout");
  devClick(c.doc, "bank:timeout");
  eq(c.api.state.panel.bank.step, "error", "the change pauses");
  check(failText(c.doc).indexOf(C.API_FAIL.bank.timeout) >= 0, "with the bank’s reason");
  check(txt(c.doc).indexOf("Verification failed") === -1, "and is not reported as a failed account");
  click(c.doc, "bank-resume");
  eq(c.api.state.panel.bank.step, "verifying", "resume re-sends the same penny-drop");
  eq(c.api.state.panel.bank.draft.acc, "998877665544", "with the same details");
  devClick(c.doc, "bank:ok");
  eq(c.api.state.profile.bank.acc, "998877665544", "and the new account is saved");
  c.api.stopTimers();
  c.win.close();

  /* --- an existing captain's paused hub says so on the hub list --- */
  const e = await boot();
  e.api.state.loginAs = "existing";
  e.api.helpers.seedExistingCaptain();
  login(e.doc);
  e.api.actions.openPanel("hubs", "hubs");
  /* an FM hub added without GST, declined by the AM: the GSTIN check pauses */
  e.api.actions.addHubOpen();
  e.api.actions.addHubRole("FM");
  e.api.actions.addHubNoGst(true);
  e.api.actions.addHubContinue({ reason: e.api.config.NO_GST_REASONS[0], confirm: true });
  doHubDetails(e.doc, { pin: "560102", address: "Unit 3, HSR Layout, Bengaluru" });
  click(e.doc, "hub-continue");
  eq(e.api.helpers.phaseId(), "ch", "the added hub reaches the review");
  devClick(e.doc, "nogst:decline");
  e.api.actions.armFail("gst", "down");
  type(e.doc, "ch-gstin", "29ABCDE1234F1Z5");
  click(e.doc, "ch-gstin-go");
  click(e.doc, "save-exit");
  eq(e.api.state.screen, "panel", "saving and exiting returns to the hub list");
  const pausedHub = sel(e.doc, '[data-testid="hub-paused"]');
  check(!!pausedHub && pausedHub.textContent.indexOf("didn’t go through") >= 0 &&
        pausedHub.textContent.indexOf(C.API_FAIL.gst.down) >= 0,
        "the in-progress hub says what is waiting, and why");
  clickSel(e.doc, "[data-resume]");
  eq(e.api.helpers.phaseId(), "ch", "Resume onboarding reopens the review");
  check(!!failBox(e.doc), "with the failure still explained");
  click(e.doc, "ch-gstin-go");
  eq(e.api.helpers.R().kyc.gst.registered, true, "and the GSTIN check resumes and goes through");
  e.api.stopTimers();
  e.win.close();
}

/* =========================================================================
   24. GSTIN verification — the GST portal and the name on the bank account
   ====================================================================== */

async function testGstVerification() {
  section("24. GSTIN verification — portal record and fuzzy name match");
  const { win, doc, api } = await boot();
  const H = api.helpers, E = api.errors, C = api.config, A = api.actions;
  const level = (a, b) => {
    const s = H.nameScore(a, b);
    return s >= C.NAME_MATCH ? "match" : (s >= C.NAME_SIMILAR ? "similar" : "mismatch");
  };

  /* --- the fuzzy match --- */
  eq(H.nameScore("KARAN VERMA", "Karan Verma"), 1, "case does not matter");
  eq(H.nameScore("VERMA KARAN", "Karan Verma"), 1, "nor does word order");
  eq(H.nameScore("Mr. Karan Verma", "KARAN VERMA"), 1, "nor honorifics");
  eq(H.nameScore("M/s Verma Logistics Pvt Ltd", "VERMA LOGISTICS"), 1, "nor legal-form words");
  eq(level("KARAN VERMAA", "Karan Verma"), "match", "a spelling slip still matches");
  eq(level("KARN VERMA", "Karan Verma"), "match", "so does a dropped letter");
  eq(level("VERMA KARAN KUMAR", "Karan Verma"), "similar", "an extra middle name is similar");
  eq(level("K VERMA", "Karan Verma"), "similar", "an initial is similar");
  eq(level("KIRAN VERMA", "Karan Verma"), "similar", "a one-letter name variant is similar, not a match");
  eq(level("KARAN SHARMA", "Karan Verma"), "mismatch", "a different surname does not match");
  eq(level("RAVI VERMA", "Karan Verma"), "mismatch", "nor a different first name");
  eq(level("KARAN", "Karan Verma"), "mismatch", "nor a first name alone");
  eq(level("SHREE GANESH TRANSPORT CO", "Karan Verma"), "mismatch", "nor another business");
  eq(H.gstNameCheck({ legal:"SHREE GANESH TRANSPORT CO", trade:"KARAN VERMA" }, "Karan Verma").on,
     "trade", "the trade name counts when it is the closer one");

  /* --- the GST portal --- */
  const own = H.gstLookup("29BBBBB2222B1Z5", { pan:"BBBBB2222B", name:"Priya Sharma" });
  eq(own.legal, "PRIYA SHARMA", "a GSTIN on the captain’s own PAN is in their own name");
  eq(own.state, "Karnataka", "registered in the state its first two digits name");
  eq(H.gstLookup("29ZZZZZ9999Z1Z9", null).legal, "VERMA KARAN KUMAR", "other PANs come from the registry");
  eq(H.gstLookup("29QQQQQ1111Q1Z1", null), null, "an unknown PAN has no registration");
  check(!api.validate.gstin("29ABCDE1234F1ZZ5") && !api.validate.gstin("2XABCDE1234F1Z5") &&
        !api.validate.gstin("29ABCDE1234F0Z5"), "the GSTIN format is checked, not just its length");

  /* --- Captain Hub: Manage GSTIN now verifies --- */
  api.state.loginAs = "existing";
  H.seedExistingCaptain();
  login(doc);
  A.openPanel("hubs", "hubs");
  clickSel(doc, '[data-gst="hub-aqt"]');
  check(devText(doc).indexOf("Fail next GSTIN check") >= 0, "the dev panel can fail the GST portal here");
  check(devText(doc).indexOf("GST portal · demo records") >= 0, "and lists the demo records");
  devClick(doc, "gstfill:29AAJFS4321M1ZQ");
  eq($(doc, "gst-input").value, "29AAJFS4321M1ZQ", "a demo record fills the field");
  eq($(doc, "gst-save").textContent, "Verify new GSTIN", "the editor verifies before anything is saved");

  click(doc, "gst-save");
  check(txt(doc).indexOf(E.gstName) >= 0, "a GSTIN in another name is refused");
  const chk = sel(doc, '[data-testid="gst-check"]');
  eq(chk && chk.getAttribute("data-level"), "mismatch", "with the name check shown");
  check(chk.textContent.indexOf("SHREE GANESH TRANSPORT CO") >= 0 && chk.textContent.indexOf("Karan Verma") >= 0,
        "naming the GST legal name and the bank account name side by side");
  check(chk.textContent.indexOf("Doesn’t match your bank account name") >= 0, "and the verdict");
  eq(H.hubById("hub-aqt").gst.gstin, "29ABCDE1234F1Z5", "the hub keeps its GSTIN");

  A.gstSave("29AAGCV7788L1Z2");
  check(txt(doc).indexOf("This GSTIN was cancelled on 31 Mar 2025. Use an active GSTIN.") >= 0,
        "a cancelled registration is refused, with its date");
  A.gstSave("29QQQQQ1111Q1Z1");
  check(txt(doc).indexOf(E.gstNotFound) >= 0, "an unregistered GSTIN is refused");
  A.gstSave("29ABCDE1234F1Z");
  check(txt(doc).indexOf(E.gstin) >= 0, "a malformed GSTIN is refused before the portal is asked");
  A.gstSave("29ABCDE1234F1Z5");
  check(txt(doc).indexOf("already the hub’s GSTIN") >= 0, "and re-entering the current GSTIN says so");

  /* the GST portal failing is resumable, like any backend call */
  A.armFail("gst", "timeout");
  type(doc, "gst-input", "29ZZZZZ9999Z1Z9");
  click(doc, "gst-save");
  check(sel(doc, '[data-testid="api-fail"]').textContent.indexOf(C.API_FAIL.gst.timeout) >= 0,
        "a GST portal timeout is explained");
  eq($(doc, "gst-save").textContent, "Resume verification", "and resumable");
  click(doc, "gst-save");
  eq(api.state.panel.gst.mode, "verified", "resuming runs the verification");
  check(!exists(doc, '[data-testid="api-fail"]'), "and clears the failure");

  /* a similar name is accepted, labelled so, and still has to be saved */
  check(txt(doc).indexOf("GSTIN verified") >= 0, "the verified record is shown");
  eq(sel(doc, '[data-testid="gst-check"]').getAttribute("data-level"), "similar", "as a similar name");
  check(txt(doc).indexOf("Close to your bank account name: accepted · 80%") >= 0,
        "with its score");
  eq(H.hubById("hub-aqt").gst.gstin, "29ABCDE1234F1Z5", "nothing is saved until the captain saves it");
  click(doc, "gst-again");
  eq(api.state.panel.gst.mode, "edit", "another GSTIN can be tried instead");
  type(doc, "gst-input", "29ABCDE1234F2Z4");
  click(doc, "gst-save");
  eq(sel(doc, '[data-testid="gst-check"]').getAttribute("data-level"), "match",
     "a second registration on the captain’s own PAN matches outright");
  click(doc, "gst-confirm");
  eq(H.hubById("hub-aqt").gst, { registered:true, gstin:"29ABCDE1234F2Z4" }, "saving applies it to the hub");
  check(exists(doc, '[data-testid="gst-saved"]'), "and the hub card confirms it");

  /* the name is checked against the bank account, not the profile */
  api.state.profile.bank.holder = "Priya Sharma";
  A.gstOpen("hub-beu");
  A.gstSave("29ABCDE1234F1Z5");
  check(txt(doc).indexOf(E.gstName) >= 0,
        "once the bank account is in another name, the captain’s own GSTIN no longer matches it");
  api.state.profile.bank.holder = "Karan Verma";

  /* --- Add a new hub: a new GSTIN is verified too --- */
  A.addHubOpen();
  A.addHubRole("FM");
  A.addHubChoice("new");
  type(doc, "addhub-gstin", "29AAJFS4321M1ZQ");
  click(doc, "addhub-go");
  eq(api.state.screen, "panel", "add a hub: a GSTIN in another name stops the hand-off");
  eq(sel(doc, '[data-testid="gst-check"]').getAttribute("data-level"), "mismatch", "showing the name check");
  A.armFail("gst", "down");
  type(doc, "addhub-gstin", "29ZZZZZ9999Z1Z9");
  click(doc, "addhub-go");
  check(sel(doc, '[data-testid="api-fail"]').textContent.indexOf(C.API_FAIL.gst.down) >= 0,
        "a GST portal outage is explained");
  eq($(doc, "addhub-go").textContent, "Resume verification →", "and resumable");
  click(doc, "addhub-go");
  eq(api.state.screen, "flow", "a verified new GSTIN continues to hub details");
  eq(H.R().kyc.gst.gstin, "29ZZZZZ9999Z1Z9", "carrying the GSTIN");
  api.stopTimers();
  win.close();

  /* --- KYC: the GST step runs the same check --- */
  const b = await boot();
  login(b.doc);
  pickRole(b.doc, "FM");
  doPersonalDetails(b.doc, { name: "Priya Sharma" });
  type(b.doc, "kyc-aadhaar", "123412341234");
  click(b.doc, "kyc-aadhaar-go");
  type(b.doc, "kyc-aadhaar-otp", "000000");
  click(b.doc, "kyc-aadhaar-confirm");
  click(b.doc, "kyc-ack-aadhaar");
  type(b.doc, "kyc-pan", "BBBBB2222B");
  type(b.doc, "kyc-pan-father", "Mohan Sharma");
  click(b.doc, "kyc-pan-go");
  click(b.doc, "kyc-ack-pan");
  type(b.doc, "kyc-acc", "123456789012");
  type(b.doc, "kyc-ifsc", "HDFC0001234");
  click(b.doc, "kyc-bank-go");
  click(b.doc, "kyc-ack-bank");
  check(devText(b.doc).indexOf("GST portal · demo records") >= 0, "KYC: the demo records are listed");
  type(b.doc, "kyc-gstin", "29ZZZZZ9999Z1Z9");
  click(b.doc, "kyc-gst-go");
  check(txt(b.doc).indexOf(b.api.errors.gstName) >= 0, "a GSTIN in someone else’s name is refused");
  check(sel(b.doc, '[data-testid="gst-check"]').textContent.indexOf("Priya Sharma") >= 0,
        "against the name the penny-drop returned for the bank account");
  check(!b.api.helpers.R().kyc.gst.done, "and GST is not marked verified");
  type(b.doc, "kyc-gstin", "29BBBBB2222B1Z5");
  click(b.doc, "kyc-gst-go");
  check(b.api.helpers.R().kyc.gst.done, "a GSTIN on the captain’s own PAN verifies");
  const nameRow = sel(b.doc, '[data-testid="kyc-gst-name"]');
  check(!!nameRow && nameRow.textContent.indexOf("Matches your bank account name · 100%") >= 0,
        "and the KYC summary records the name check");
  b.api.stopTimers();
  b.win.close();
}

/* =========================================================================
   25. Area Manager corrects the map pin — no trip back to the captain
   ====================================================================== */

async function testAmMapEdit() {
  section("25. Area Manager edits the map link without the captain re-verifying");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions;
  const at = (pin, dLat = 0, dLng = 0) => "https://maps.google.com/?q=" +
    (H.PIN_AREAS[pin].lat + dLat).toFixed(4) + "," + (H.PIN_AREAS[pin].lng + dLng).toFixed(4);

  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');

  /* every seeded request now carries the captain's pin, inside its pincode
     — except OBD-78240, which the captain dropped in Koramangala */
  api.state.adminRequests.forEach(r => {
    const chk = H.checkMapPin(r.mapLink, r.pincode);
    if (r.id === "OBD-78240") eq(chk.code, "elsewhere", r.id + ": the captain’s pin is outside its pincode");
    else check(chk.ok, r.id + ": the captain’s pin is inside " + r.pincode);
  });
  eq(H.apById("OBD-78231").address, "No. 8, Old Airport Road, Domlur, Bengaluru",
     "OBD-78231’s address now agrees with its pincode (560071, Domlur)");

  A.adminOpen("OBD-78240");
  const row = () => sel(doc, '[data-testid="ap-map-row"]');
  check(row().textContent.indexOf("12.9352, 77.6245") >= 0, "the context card shows where the pin is");
  check(row().querySelector("a").getAttribute("href").indexOf("google.com/maps?q=12.9352,77.6245") >= 0,
        "linking to it on Google Maps");
  check(sel(doc, '[data-testid="ap-map-warn"]').textContent.indexOf("560034 (Koramangala)") >= 0,
        "and warns that it sits in another pincode");
  check(exists(doc, "#ap-map-edit"), "the Area Manager can edit it");

  const before = JSON.stringify({ roles: api.state.roles, profile: api.state.profile, hubs: api.state.hubs });
  const req = () => H.apById("OBD-78240");
  const stage0 = req().stage, status0 = req().status, gates0 = JSON.stringify(req().am.gates);

  click(doc, "ap-map-edit");
  check(exists(doc, '[data-testid="ap-map-editor"]'), "Edit opens the map editor");
  eq($(doc, "ap-map").value, req().mapLink, "starting from the captain’s link");
  check(exists(doc, '[data-testid="map-pin-bad"]'), "previewing it as outside the pincode");
  check($(doc, "ap-map-hint").textContent.indexOf("not asked to verify it again") >= 0,
        "and saying the captain is not asked to verify the change");

  const input = $(doc, "ap-map");
  type(doc, "ap-map", at("560102", 0.0004, -0.0003));
  check($(doc, "ap-map") === input, "typing previews in place without redrawing the field");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "a pin in HSR Layout previews as inside 560102");

  type(doc, "ap-map", at("560076"));
  click(doc, "ap-map-save");
  check(txt(doc).indexOf("not the hub’s pincode 560102") >= 0, "a pin outside the pincode cannot be saved");
  eq(req().am.mapLink, "", "and nothing is changed");

  type(doc, "ap-map", at("560102", 0.0004, -0.0003));
  click(doc, "ap-map-save");
  eq(req().am.mapLink, at("560102", 0.0004, -0.0003), "a pin inside the pincode is saved");
  check(!exists(doc, '[data-testid="ap-map-editor"]'), "the editor closes");
  check(exists(doc, '[data-testid="ap-map-updated"]'), "the row is tagged AM updated");
  check(!exists(doc, '[data-testid="ap-map-warn"]'), "and the pincode warning clears");
  check(txt(doc).indexOf("the captain is notified, with nothing to re-verify") >= 0,
        "saying the captain is notified, with nothing to re-verify");
  eq(req().mapLink, "https://maps.google.com/?q=12.9352,77.6245", "the captain’s submission is kept as it was");
  eq(H.apMapLink(req()), req().am.mapLink, "the panel uses the corrected pin from here on");

  /* nothing is triggered for the captain */
  eq(req().stage, stage0, "the request stays at the same desk");
  eq(req().status, status0, "with the same status");
  eq(JSON.stringify(req().am.gates), gates0, "and the infra checks untouched");
  eq(JSON.stringify({ roles: api.state.roles, profile: api.state.profile, hubs: api.state.hubs }), before,
     "no captain-side state changes — no re-verification is raised");

  check(api.reload(), "the correction is saved");
  A.adminOpen("OBD-78240");
  check(exists(doc, '[data-testid="ap-map-updated"]'), "and survives a reload");

  /* cancelling discards a draft; putting the captain's link back clears the correction */
  click(doc, "ap-map-edit");
  type(doc, "ap-map", at("560102", -0.0006, 0.0005));
  click(doc, "ap-map-cancel");
  eq(req().am.mapLink, at("560102", 0.0004, -0.0003), "Cancel keeps the saved correction");
  click(doc, "ap-map-edit");
  type(doc, "ap-map", at("560102"));
  click(doc, "ap-map-save");
  check(exists(doc, '[data-testid="ap-map-updated"]'), "a second correction replaces the first");
  check(H.checkMapPin(H.apMapLink(req()), "560102").ok, "still inside the pincode");
  click(doc, "ap-map-edit");
  type(doc, "ap-map", "https://maps.app.goo.gl/HsrHub42");
  click(doc, "ap-map-save");
  eq(req().am.mapLink, "https://maps.app.goo.gl/HsrHub42", "a short share link can be saved too");
  check(sel(doc, '[data-testid="ap-map-row"]').textContent.indexOf("Google Maps share link") >= 0,
        "and shows as a share link");

  /* only the Area Manager edits it */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  A.adminOpen("OBD-78219");
  check(exists(doc, '[data-testid="ap-map-row"]'), "the Cluster Head sees the map link");
  check(!exists(doc, "#ap-map-edit"), "but cannot edit it");
  A.amMapEdit();
  check(!exists(doc, '[data-testid="ap-map-editor"]'), "even by calling the action directly");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   26. Editing a live hub — the captain asks, the Area Manager decides
   ====================================================================== */

async function testHubEdits() {
  section("26. Hub edits — captain requests, Area Manager approves or rejects");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions;
  const hub = (id) => H.hubById(id);

  devClick(doc, "as:existing");
  login(doc);
  quietBell(api);
  eq(api.state.screen, "panel", "the existing captain is on My Hubs");
  check(exists(doc, '[data-hubedit="hub-aqt"]') && exists(doc, '[data-hubedit="hub-beu"]'),
        "every active hub offers Edit hub details");
  check(!exists(doc, '[data-hubedit="hub-jyp"]'), "an inactive hub does not");

  /* --- the form starts from the hub's current details --- */
  clickSel(doc, '[data-hubedit="hub-aqt"]');
  check(exists(doc, '[data-testid="hub-edit"]'), "the editor opens on that hub");
  eq($(doc, "he-address").value, "Koramangala, Bengaluru", "address prefilled");
  eq($(doc, "he-pin").value, "560034", "pincode prefilled");
  eq($(doc, "he-map").value, hub("hub-aqt").mapLink, "map link prefilled");
  eq($(doc, "he-area").value, "4200", "area prefilled");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "and the current pin previews inside its pincode");

  click(doc, "he-submit");
  check(sel(doc, '[data-testid="hub-edit-error"]').textContent.indexOf("Nothing has changed yet") >= 0,
        "an unchanged form is not sent");

  type(doc, "he-pin", "70001");
  click(doc, "he-submit");
  check(txt(doc).indexOf(api.errors.pincodeFormat) >= 0, "a malformed pincode is refused");
  check(txt(doc).indexOf("VALMO isn’t opening hubs") === -1, "but there is no serviceability check any more");
  type(doc, "he-pin", "560102");
  type(doc, "he-area", "50");
  click(doc, "he-submit");
  check(txt(doc).indexOf("not the hub’s pincode 560102") >= 0,
        "moving the pincode without moving the pin is caught");
  check(txt(doc).indexOf(api.errors.hubArea) >= 0, "and an impossible area");
  eq(api.state.hubEdits.length, 0, "nothing is sent while anything is wrong");

  type(doc, "he-address", "Plot 21, 27th Main, HSR Layout, Bengaluru");
  type(doc, "he-pin", "560102");
  const mapIn = $(doc, "he-map");
  type(doc, "he-map", mapFor(doc, "560102"));
  check($(doc, "he-map") === mapIn, "the map preview patches in place while typing");
  check(sel(doc, "#he-map-preview [data-testid=\"map-pin-ok\"]").textContent.indexOf("560102") >= 0,
        "and shows the new pin inside the new pincode");
  type(doc, "he-area", "5200");
  check(!exists(doc, "#he-note"), "the form asks for no note \u2014 that conversation happens offline");
  click(doc, "he-submit");

  eq(api.state.hubEdits.length, 1, "a valid edit is sent");
  const e1 = api.state.hubEdits[0];
  eq(e1.status, "pending", "and waits with the Area Manager");
  eq(H.hubEditChanged(e1).map(f => f.id), ["address", "pincode", "mapLink", "areaSqft"], "recording every change");
  eq(hub("hub-aqt").address, "Koramangala, Bengaluru", "the hub keeps its current details meanwhile");
  check(exists(doc, '[data-testid="hub-edit-pending"]'), "the hub card says the edit is awaiting approval");
  check(!exists(doc, '[data-hubedit="hub-aqt"]'), "and takes one request at a time");
  A.hubEditOpen("hub-aqt");
  check(!exists(doc, '[data-testid="hub-edit"]'), "even through the action");
  check(api.reload(), "the request is saved");
  eq(H.hubEditOf("hub-aqt").status, "pending", "and survives a reload");

  /* --- the Area Manager decides it in the admin panel --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  const editsTab = sel(doc, '[data-aptab="edits"]');
  const pendingAll = api.state.hubEdits.filter(e => e.status === "pending").length;
  eq(pendingAll, 5, "the captain\u2019s request joins the four the portfolio already has waiting");
  eq(editsTab && editsTab.textContent, "Hub edits (" + pendingAll + ")",
     "the Area Manager\u2019s Hub edits tab counts every pending one");
  clickSel(doc, '[data-aptab="edits"]');
  const aqtRow = sel(doc, '[data-testid="ap-hub-row"][data-hubrow="hub-aqt"]');
  eq(aqtRow && aqtRow.getAttribute("data-status"), "pending", "the captain\u2019s hub is listed with its edit to review");
  check(aqtRow.textContent.indexOf("Hub AQT") >= 0 && aqtRow.textContent.indexOf("Karan Verma") >= 0,
        "with the hub and the captain");
  clickSel(doc, '[data-apedit="' + e1.id + '"]');
  check(exists(doc, '[data-testid="ap-edit-detail"]'), "Review opens the request");
  eq(doc.querySelectorAll('[data-testid="ap-edit-changed"]').length, 4, "showing all four changes, now against requested");
  check(txt(doc).indexOf("4,200 sq ft") >= 0 && txt(doc).indexOf("5,200 sq ft") >= 0, "area before and after");
  check(exists(doc, '[data-testid="ap-edit-detail"] [data-testid="map-pin-ok"]'),
        "the requested pin on a map, inside the requested pincode");
  check(txt(doc).indexOf("Captain\u2019s note") === -1, "and no captain\u2019s note to read");

  click(doc, "ap-edit-approve");
  eq(H.hubEditById(e1.id).status, "approved", "approving decides the request");
  check(api.state.admin.toast.indexOf("approved") >= 0, "with a confirmation");
  const aqt = hub("hub-aqt");
  eq([aqt.address, aqt.pincode, aqt.city, aqt.mapLink, aqt.areaSqft],
     ["Plot 21, 27th Main, HSR Layout, Bengaluru", "560102", "Bengaluru, Karnataka", mapFor(doc, "560102"), "5200"],
     "and the hub now runs on the new details");
  A.adminEditOpen(e1.id);
  check(!exists(doc, "#ap-edit-approve") && txt(doc).indexOf("Approved on") >= 0,
        "a decided request is read-only");
  A.adminEditBack();

  /* --- back on the captain's side --- */
  A.logout();
  devClick(doc, "as:existing");
  eq(hub("hub-aqt").pincode, "560102", "signing back in as the captain keeps the approved change");
  login(doc);
  check(exists(doc, '[data-testid="hub-edit-approved"]'), "the hub card says the edit was approved");
  check(sel(doc, '[data-hub="hub-aqt"]').textContent.indexOf("Plot 21, 27th Main, HSR Layout") >= 0,
        "and shows the new address");
  clickSel(doc, '[data-hedismiss="' + e1.id + '"]');
  check(!exists(doc, '[data-testid="hub-edit-approved"]'), "the notice can be dismissed");
  check(exists(doc, '[data-hubedit="hub-aqt"]'), "and the hub can be edited again");

  /* --- a rejected edit leaves the hub as it was --- */
  clickSel(doc, '[data-hubedit="hub-beu"]');
  type(doc, "he-area", "3500");
  click(doc, "he-submit");
  const e2 = H.hubEditOf("hub-beu");
  check(!!e2, "a hub keeps its own pincode even where VALMO isn\u2019t opening new hubs (560038)");
  eq(H.hubEditChanged(e2).map(f => f.id), ["areaSqft"], "an area-only edit records just the area");
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  A.adminTab("edits");
  A.adminEditOpen(e2.id);
  click(doc, "ap-edit-reject");
  check(txt(doc).indexOf("Say why you’re rejecting it") >= 0, "rejecting needs a reason");
  eq(H.hubEditById(e2.id).status, "pending", "so nothing is decided without one");
  type(doc, "ap-edit-reason", "The extra area isn’t covered by the lease.");
  click(doc, "ap-edit-reject");
  eq(H.hubEditById(e2.id).status, "rejected", "with a reason it is rejected");
  eq(hub("hub-beu").areaSqft, "3000", "and the hub keeps its area");
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  const rej = sel(doc, '[data-testid="hub-edit-rejected"]');
  check(!!rej && rej.textContent.indexOf("The extra area isn’t covered by the lease.") >= 0 &&
        rej.textContent.indexOf("Your hub details are unchanged.") >= 0,
        "the captain sees the reason, and that nothing changed");
  check(exists(doc, '[data-hubedit="hub-beu"]'), "and can send a new edit");

  /* --- the dev panel can stand in for the Area Manager --- */
  clickSel(doc, '[data-hubedit="hub-beu"]');
  type(doc, "he-address", "Plot 14, 4th Cross, Indiranagar, Bengaluru");
  click(doc, "he-submit");
  const e3 = H.hubEditOf("hub-beu");
  check(devText(doc).indexOf("Area Manager · hub edit " + e3.id) >= 0, "the dev panel offers the AM decision");
  devClick(doc, "he:approve:" + e3.id);
  eq(hub("hub-beu").address, "Plot 14, 4th Cross, Indiranagar, Bengaluru", "and approving it applies the edit");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   27. Rate card updates — published with an effective date, the captain told
   ====================================================================== */

async function testRateUpdates() {
  section("27. Rate card updates — approved, agreed by the captain, then published from a day");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions;
  const kdg = () => H.hubById("hub-kdg");
  const today = H.todayIso(), soon = H.addDaysIso(today, 3);
  const setDate = (id, v) => { const el = $(doc, id); el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const setRate = (i, v) => { const el = sel(doc, '[data-rslab="' + i + '"][data-rfield="rate"]'); el.value = v;
                              el.dispatchEvent(new win.Event("input", { bubbles: true })); };

  devClick(doc, "as:existing");
  login(doc);
  quietBell(api);

  /* --- the rate card in force, as a table --- */
  const sec = () => sel(doc, '[data-hub="hub-kdg"] [data-testid="hub-rate"]');
  check(!!sec(), "the FM hub card has a rate card section");
  const rowsOf = (q) => [...doc.querySelectorAll(q + " tbody tr")]
    .map(r => [...r.querySelectorAll("td")].map(c => c.textContent.trim()).filter(Boolean).join(" "));
  const table = rowsOf('[data-hub="hub-kdg"] [data-testid="hub-rate-table"]');
  eq(table.length, 6, "a row for each of the five slabs, then the touchpoint rate");
  eq(table[0], "Slab 1 0 – 2,500 ₹3.40 / shipment", "each slab with its orders and rate");
  eq(table[4], "Slab 5 10,001 and above ₹3.00 / shipment", "the top slab open-ended");
  eq(table[5], "Touchpoint rate ₹5.00 / touchpoint", "and the touchpoint rate last");
  check(sec().textContent.indexOf("In force since 01 Sept 2026") >= 0, "with the day it took effect");
  check(!exists(doc, '[data-hub="hub-aqt"] [data-testid="hub-rate"]'), "LM hubs have no rate card section");
  check(!exists(doc, '[data-testid="bell-count"]'), "the bell has nothing new");
  check(!/agree/i.test(sec().textContent), "and there is nothing to agree to");

  /* --- its history, five to a page --- */
  clickSel(doc, '[data-ratehist="hub-kdg"]');
  eq(api.state.panel.section, "ratehistory", "View historic rate card updates opens the history");
  const items = () => [...doc.querySelectorAll('[data-testid="rate-hist-item"]')];
  eq(items().length, 5, "showing the last five rate cards");
  eq(items().map(i => i.getAttribute("data-state")), ["current", "past", "past", "past", "past"],
     "newest first: the one in force, then the ones before it");
  check(items()[0].textContent.indexOf("From 01 Sept 2026 · in force today") >= 0, "with its effective date");
  check(items()[1].textContent.indexOf("01 Aug 2026 – 31 Aug 2026") >= 0, "a past one with the dates it applied");
  check(items()[1].textContent.indexOf("You agreed on 27 Jul 2026") >= 0, "and when the captain agreed to it");
  check(!!items()[0].querySelector(".rate-tbl"), "each shown as its full table");
  const pager = () => sel(doc, '[data-testid="rate-hist-pager"]').textContent.replace(/\s+/g, " ");
  check(pager().indexOf("Showing 1–5 of 7") >= 0 && pager().indexOf("Page 1 of 2") >= 0, "the pager counts them");
  check($(doc, "rh-newer").disabled && !$(doc, "rh-older").disabled, "only Older is open on the first page");
  click(doc, "rh-older");
  eq(items().length, 2, "the next page holds the rest");
  check(items()[1].textContent.indexOf("Agreed when the hub was onboarded") >= 0, "down to the onboarding card");
  check(pager().indexOf("Showing 6–7 of 7") >= 0 && $(doc, "rh-older").disabled, "and it ends there");
  click(doc, "rh-newer");
  eq(items().length, 5, "Newer goes back");
  click(doc, "hub-back-hubs");
  eq(api.state.panel.section, "hubs", "and back to My Hubs");

  /* --- the Area Manager updates it --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="rates"]');
  eq(doc.querySelectorAll('[data-testid="ap-rate-row"]').length, 12,
     "the Area Manager sees every live FM hub under them — the captain’s and eleven others");
  const kdgRow = () => sel(doc, '[data-testid="ap-rate-row"][data-ratehub="hub-kdg"]');
  check(kdgRow().textContent.indexOf("v7 · in force since 01 Sept 2026") >= 0, "KDG on its seventh version");
  clickSel(doc, '[data-aprate="hub-kdg"]');
  check(exists(doc, '[data-testid="ap-rate-editor"]'), "Update rate card opens the editor");
  eq([...doc.querySelectorAll('[data-rfield="rate"]')].map(i => i.value)[0], "3.40", "starting from the rates in force");
  check(!exists(doc, "input#ap-rate-tp"), "the touchpoint can’t be typed");
  check(sel(doc, '[data-testid="ap-rate-tp"]').textContent.indexOf("₹5.00") >= 0 &&
        sel(doc, '[data-testid="ap-rate-tp"]').textContent.indexOf("Fixed for Standalone hubs") >= 0,
        "it shows the Standalone touchpoint, fixed");
  eq(doc.querySelectorAll('[data-rfield="rate"]').length, 5, "one rate per slab");
  check(!exists(doc, '[data-rfield="from"]') && !exists(doc, '[data-rfield="to"]') && !exists(doc, "#ap-rate-add"),
        "the slabs themselves can’t be changed here");
  eq($(doc, "ap-rate-from").value, H.addDaysIso(today, 1), "it applies from tomorrow unless changed");
  eq($(doc, "ap-rate-from").getAttribute("min"), today, "and can’t be set before today");
  check(!exists(doc, "#ap-rate-reason") && !exists(doc, "#ap-rate-note"), "with no reason or note — that’s offline");
  check(sel(doc, '[data-testid="ap-rate-history"]').querySelectorAll('[data-testid="ap-rate-version"]').length === 7,
        "the version log lists every version");

  click(doc, "ap-rate-send");
  check(sel(doc, '[data-testid="ap-rate-error"]').textContent.indexOf("rates in force today") >= 0,
        "an unchanged card is not sent");
  setRate(0, "3.50");
  setDate("ap-rate-from", H.addDaysIso(today, -2));
  click(doc, "ap-rate-send");
  check(sel(doc, '[data-testid="ap-rate-error"]').textContent.indexOf("never backdated") >= 0,
        "a day in the past is refused");
  setDate("ap-rate-from", soon);
  setRate(1, "four");
  click(doc, "ap-rate-send");
  check(sel(doc, '[data-testid="ap-rate-error"]').textContent.indexOf("Every slab needs a rate") >= 0,
        "an incomplete slab is caught");
  setRate(1, "3.30");
  click(doc, "ap-rate-send");

  const u = H.rateUpdateFor("hub-kdg");
  check(!!u, "a valid update is sent");
  eq(u.status, "ch", "to the Cluster Head first");
  eq(u.effectiveFrom, soon, "with the day it applies from");
  eq([u.to.slabs[0].rate, u.to.slabs[1].rate, u.to.touchpoint], ["3.50", "3.30", "5.00"],
     "carrying the new card, with the fixed touchpoint");
  eq(kdg().rateCard.slabs[0].rate, "3.40", "the card in force stays until the new one applies");
  check(api.state.admin.toast.indexOf("It applies from " + H.fmtIso(soon)) >= 0,
        "the AM is told it went for review, and from when it applies");
  check(kdgRow().textContent.indexOf("With the Cluster Head") >= 0, "the list says it is in review");
  clickSel(doc, '[data-aprate="hub-kdg"]');
  check(!exists(doc, '[data-testid="ap-rate-editor"]'), "one update at a time");
  A.adminRateBack();

  /* --- the captain hears nothing while it is in review --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  check(!exists(doc, '[data-testid="bell-count"]'), "while it is with the Cluster Head the captain’s bell is quiet");
  check(!exists(doc, '[data-testid="hub-rate-next"]'), "and no change is shown on the hub");

  /* --- the Cluster Head approves it: it goes to the captain to agree --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="ch"]');
  const chWaiting = api.state.rateUpdates.filter(x => x.status === "ch" && H.ruChain(x).chId === "blr-east").length;
  eq(sel(doc, '[data-aptab="rates"]').textContent, "Rate card updates (" + chWaiting + ")",
     "the Cluster Head’s tab counts what waits on them");
  clickSel(doc, '[data-aptab="rates"]');
  clickSel(doc, '[data-apru="' + u.id + '"]');
  const checks = sel(doc, '[data-testid="ru-checks"]').textContent;
  check(checks.indexOf("Within the Standalone ceilings") >= 0, "within the hub type’s ceilings");
  check(checks.indexOf("Applies from" + H.fmtIso(soon)) >= 0, "applying from the day the AM picked");
  check(checks.indexOf("The captain agrees before it applies") >= 0, "once the captain agrees");
  check($(doc, "ap-ru-approve").textContent.indexOf("send to the Zonal Head") >= 0,
        "the Cluster Head’s approval sends it to the Zonal Head");
  click(doc, "ap-ru-approve");
  const pub = H.rateUpdateById(u.id);
  eq(pub.status, "zh", "approved by the CH, it waits for the ZH");
  check(api.state.admin.toast.indexOf("sent to the Zonal Head, Priya Nair") >= 0, "the Cluster Head is told so");
  check(!api.state.rateNotices.some(n => n.ref === u.id), "and the captain hears nothing yet");
  check(sel(doc, '[data-testid="ap-ru-row"][data-ru="' + u.id + '"] [data-testid="ru-waiting-on"]').textContent
          .indexOf("With ZHPriya Nair") >= 0, "the CH’s list says it’s with the ZH");

  /* --- the Zonal Head approves it: it goes to the captain to agree --- */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="zh"]');
  check(sel(doc, '[data-aptab="rates"]').textContent.indexOf("Rate card updates (") === 0,
        "the Zonal Head has a Rate card updates tab with a count");
  clickSel(doc, '[data-aptab="rates"]');
  clickSel(doc, '[data-apru="' + u.id + '"]');
  check($(doc, "ap-ru-approve").textContent.indexOf("send to the captain to agree") >= 0,
        "within the ceilings, the ZH’s approval sends it to the captain");
  click(doc, "ap-ru-approve");
  eq(pub.status, "captain", "approved, it waits for the captain to agree");
  eq(kdg().rateCards.length, 7, "nothing is published yet");
  check(api.state.admin.toast.indexOf("sent to Karan Verma to agree") >= 0, "the Zonal Head is told so");
  const notice = api.state.rateNotices.filter(n => n.ref === u.id)[0];
  check(!!notice && notice.channels["In-app"] === "Delivered" && notice.channels.SMS === "Delivered" &&
        notice.channels.Email === "Delivered", "the captain is asked in the app, by SMS and by email — each delivery logged");
  eq((pub.trail || []).map(x => x.by + ":" + x.what),
     ["am:sent", "ch:approved", "zh:approved", "system:sent to the captain"], "every step so far on its trail");
  check(sel(doc, '[data-testid="ap-ru-row"][data-ru="' + u.id + '"] [data-testid="ru-waiting-on"]').textContent
          .indexOf("With captainKaran Verma") >= 0, "the desk’s list says it’s with the captain");

  /* --- the captain reviews and agrees --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "1", "the bell shows one notification");
  const ask = sel(doc, '[data-hub="hub-kdg"] [data-testid="hub-rate-ask"]');
  check(!!ask && ask.textContent.indexOf("Updated rates to agree") >= 0 && ask.textContent.indexOf(H.fmtIso(soon)) >= 0,
        "the hub card asks the captain to agree, with the day it would apply");
  check(!exists(doc, '[data-hub="hub-kdg"] [data-testid="hub-rate-next"]'), "nothing is scheduled yet");
  click(doc, "bell");
  const note = sel(doc, '[data-note^="rateagree:"]');
  check(!!note && note.textContent.indexOf("Rate card update to agree · Kudlu Gate Hub (KDG)") >= 0,
        "the notification names the hub");
  check(note.textContent.indexOf("apply only once you agree") >= 0, "and says nothing applies until they agree");
  check(!/hub type|ceiling|benchmark|Standalone/i.test(note.textContent), "never the hub type or ceilings");
  note.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  eq([api.state.panel.section, api.state.panel.rateUpdateId], ["rateagree", u.id], "it opens the update to agree");
  check(sel(doc, '[data-testid="rate-current"]').textContent.indexOf("₹3.40") >= 0 &&
        sel(doc, '[data-testid="rate-new"]').textContent.indexOf("₹3.50") >= 0, "the current card beside the updated one");
  check(txt(doc).indexOf("or from the day you agree if that’s later") >= 0, "prospective only, said plainly");
  check(sel(doc, '[data-testid="rate-questions"]').textContent.indexOf("Priya Sharma") >= 0,
        "questions go to the Area Manager");
  check(disabled(doc, "rate-agree"), "Agree waits for the tick");
  A.rateAgree();
  eq(pub.status, "captain", "and can’t be forced by action");
  setCheck(doc, "rate-agree-check", true);
  check(!disabled(doc, "rate-agree"), "ticking it opens Agree");
  click(doc, "rate-agree");
  eq(pub.status, "published", "agreeing publishes it");
  eq(H.ruPhase(pub), "scheduled", "scheduled until its day");
  eq(pub.version, 8, "as the hub’s eighth version");
  eq(kdg().rateCard.version, 7, "the seventh stays in force until then");
  eq(H.versionInForce(kdg(), soon).v, 8, "from that day billing reads the new card");
  eq(H.versionInForce(kdg(), H.addDaysIso(soon, -1)).v, 7, "and the old one up to the day before");
  eq((pub.trail || []).map(x => x.by + ":" + x.what),
     ["am:sent", "ch:approved", "zh:approved", "system:sent to the captain", "captain:agreed", "system:published"],
     "every step on its trail");
  check(txt(doc).indexOf("Updated rate card agreed") >= 0, "the captain sees it agreed");
  check(!exists(doc, '[data-testid="bell-count"]'), "and the bell clears");
  click(doc, "hub-back-hubs");
  const next = sel(doc, '[data-hub="hub-kdg"] [data-testid="hub-rate-next"]');
  check(!!next && next.textContent.indexOf("New rates from " + H.fmtIso(soon)) >= 0 &&
        next.textContent.indexOf("You agreed on") >= 0, "the hub card shows the agreed rates and the day they apply");
  check(next.textContent.indexOf("₹3.50") >= 0, "in full");
  check(sec().textContent.indexOf("₹3.40") >= 0, "with today’s rates still in force above them");
  clickSel(doc, '[data-ratehist="hub-kdg"]');
  eq(items()[0].getAttribute("data-state"), "upcoming", "the history has the new card on top, marked upcoming");
  check(items()[0].textContent.indexOf("You agreed on") >= 0, "with the day it was agreed");
  click(doc, "hub-back-hubs");

  /* --- a second update waits until the scheduled one applies --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="rates"]');
  check(kdgRow().textContent.indexOf("Scheduled") >= 0, "the AM’s list shows it scheduled");
  clickSel(doc, '[data-aprate="hub-kdg"]');
  check(!exists(doc, '[data-testid="ap-rate-editor"]') &&
        sel(doc, '[data-testid="ap-rate-where"]').textContent.indexOf("applies from " + H.fmtIso(soon)) >= 0,
        "and no second update until it applies");
  check(sel(doc, '[data-testid="ru-checks"]').textContent.indexOf("Captain agreed") >= 0,
        "the update records the captain’s agreement");
  A.adminRateBack();

  /* --- agreed after its day: it applies from the day of agreement, never backdated --- */
  const btm = H.rateUpdateById("RCU-51130");
  btm.effectiveFrom = H.addDaysIso(today, -4);
  clickSel(doc, '[data-aprate="nh-btm"]');
  devClick(doc, "ru:approve:RCU-51130");
  eq(btm.status, "zh", "the simulator stands in for the Cluster Head, then");
  check(devText(doc).indexOf("Zonal Head · RCU-51130") >= 0, "the Zonal Head");
  devClick(doc, "ru:approve:RCU-51130");
  eq(btm.status, "captain", "a late approval goes to the captain all the same");
  check(sel(doc, '[data-testid="ap-rate-where"]').textContent.indexOf("Waiting for Naveen Reddy to agree") >= 0,
        "the AM sees who it’s waiting on");
  check(devText(doc).indexOf("Naveen Reddy agrees to RCU-51130") >= 0, "the simulator can stand in for the captain");
  devClick(doc, "ru:agree:RCU-51130");
  A.adminRateBack();
  eq(btm.status, "published", "agreed, it publishes");
  eq(btm.effectiveFrom, today, "but from the day of agreement, not the day asked for");
  check(btm.trail.some(x => x.what === "effective date moved" && x.note.indexOf("Agreed after") === 0),
        "with the move on its trail");

  /* --- a new hub type brings its own touchpoint --- */
  clickSel(doc, '[data-aprate="nh-bld"]');
  const sel2 = $(doc, "ap-rate-type"); sel2.value = "lm_as_fm"; sel2.dispatchEvent(new win.Event("change", { bubbles: true }));
  eq(api.state.admin.rateDraft.touchpoint, "6.00", "moving Standalone to LM-as-FM moves the touchpoint from 5.00 to 6.00");
  check(sel(doc, '[data-testid="ap-rate-tp"]').textContent.indexOf("₹6.00") >= 0, "and the editor shows it");
  A.adminRateBack();

  /* --- a hub type change on its own: nothing for the captain to agree to --- */
  clickSel(doc, '[data-aprate="nh-jpn"]');
  const sel3 = $(doc, "ap-rate-type"); sel3.value = "lm_as_fm"; sel3.dispatchEvent(new win.Event("change", { bubbles: true }));
  click(doc, "ap-rate-send");
  const jpnU = H.rateUpdateFor("nh-jpn");
  eq(jpnU.status, "ch", "a hub-type-only update goes for review too");
  clickSel(doc, '[data-aprate="nh-jpn"]');
  devClick(doc, "ru:approve:" + jpnU.id);
  devClick(doc, "ru:approve:" + jpnU.id);
  A.adminRateBack();
  eq(H.ruPhase(jpnU), "scheduled", "and is published once the CH and ZH approve");
  check(!api.state.rateNotices.some(n => n.ref === jpnU.id),
        "without asking the captain — mini-hub and LM-as-FM share the 6.00 touchpoint, so the rates are the same");
  const jpnHub = H.allHubById("nh-jpn");
  check(H.rateVersions(jpnHub).length > H.captainVersions(jpnHub).length, "and it stays out of the captain’s history");
  eq(jpnHub.category, "standalone_mini", "the hub type changes on the update’s day, not before");
  eq(H.versionInForce(jpnHub, jpnU.effectiveFrom).category, "lm_as_fm", "and from that day it’s LM-as-FM");

  /* --- above the ceilings: BizFin decides, then the captain --- */
  A.adminSwitchRole();
  asCentral(doc, "bizfin");
  clickSel(doc, '[data-aptab="rates"]');
  clickSel(doc, '[data-apru="RCU-51151"]');
  click(doc, "ap-ru-approve");
  const dml = H.rateUpdateById("RCU-51151");
  eq([dml.status, dml.approvedBy], ["captain", "central"], "BizFin approves above-ceiling updates, which go to the captain");
  H.captainAgree(dml);
  eq(dml.status, "published", "and publish when the captain agrees");

  /* --- the bell also carries hub edit outcomes --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  clickSel(doc, '[data-hubedit="hub-aqt"]');
  type(doc, "he-area", "4600");
  click(doc, "he-submit");
  const he = H.hubEditOf("hub-aqt");
  devClick(doc, "he:approve:" + he.id);
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "1", "a decided hub edit shows on the bell");
  click(doc, "bell");
  check(sel(doc, '[data-note^="edit:"]').textContent.indexOf("Hub edit approved · Koramangala Hub") >= 0,
        "saying which way it went");
  clickSel(doc, '[data-note^="edit:"]');
  eq(api.state.panel.section, "hubs", "and leading to My Hubs");
  clickSel(doc, '[data-hedismiss="' + he.id + '"]');
  check(!exists(doc, '[data-testid="bell-count"]'), "dismissing it on the hub card clears the bell");

  /* --- the dev panel can send one too; the bell rides on onboarding's top bar --- */
  api.state.rateUpdates.filter(x => x.hubId === "hub-kdg" && x.status === "published")
    .forEach(x => { x.effectiveFrom = today; H.rateVersions(kdg()).filter(v => v.v === x.version)[0].effectiveFrom = today; });
  H.syncAllRates();
  api.render();
  eq(kdg().rateCard.version, 8, "once its day comes, the new card is the one in force");
  check(devText(doc).indexOf("Send a rate card update for KDG") >= 0, "the dev panel offers a quick update");
  devClick(doc, "rate:send:hub-kdg");
  eq(H.rateUpdateFor("hub-kdg").status, "ch", "which goes to the Cluster Head");
  devClick(doc, "ru:approve:" + H.rateUpdateFor("hub-kdg").id);
  devClick(doc, "ru:approve:" + H.rateUpdateFor("hub-kdg").id);
  eq(H.ruPhase(H.rateUpdateFor("hub-kdg")), "captain", "approving it there, as the CH and then the ZH, sends it to the captain");
  check(api.reload(), "it is saved");
  check(!!H.rateUpdateFor("hub-kdg") && H.rateUpdateFor("hub-kdg").status === "captain" &&
        H.rateVersions(H.hubById("hub-kdg")).length === 8, "and survives a reload, still waiting on the captain");
  A.addHubOpen();
  A.addHubRole("LM");
  A.addHubChoice("none");
  A.addHubContinue();
  eq(api.state.screen, "flow", "adding a hub opens onboarding");
  check(!!sel(doc, ".topbar #bell"), "whose top bar carries the bell for a captain who runs hubs");
  click(doc, "bell");
  clickSel(doc, '[data-note^="rateagree:"]');
  eq([api.state.screen, api.state.panel.section], ["panel", "rateagree"],
     "and a rate card update to agree there still opens it");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   28. The hub pincode can be typed straight into its field
   ====================================================================== */

async function testTypedHubPincode() {
  section("28. Typing the hub pincode after the map link");
  const { win, doc, api } = await boot();
  const H = api.helpers, E = api.errors, A = api.actions;
  const hint = () => $(doc, "hub-pin-hint").textContent;

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  eq(H.phaseId(), "hub", "at hub details");
  type(doc, "hub-address", "Plot 7, 16th Main, BTM Layout 2nd Stage, Bengaluru");
  type(doc, "hub-map", mapFor(doc, "560076"));
  check(!exists(doc, '[data-testid="map-pin-ok"]'), "with no pincode yet the pin waits to be checked");

  const pin = $(doc, "hub-pin");
  check(!pin.disabled, "the Hub pincode field after the map link can be typed in");
  eq(hint(), "The 6-digit pincode the hub sits in.", "and says what it wants");

  pin.focus();
  type(doc, "hub-pin", "5600");
  check($(doc, "hub-pin") === pin, "a part-typed pincode is left alone — nothing redraws mid-entry");
  type(doc, "hub-pin", "560076");
  eq(H.R().hub.selected, "560076", "a complete pincode becomes the hub’s pincode — no check");
  eq(doc.activeElement && doc.activeElement.id, "hub-pin", "the caret stays in the field");
  eq($(doc, "hub-pin").value, "560076", "which still shows it");
  eq($(doc, "hub-city").value, "Bengaluru, Karnataka", "the city resolves from it");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "and the map pin is checked against it at once");
  eq(H.R().hub.pincodes, [], "it doesn’t join the pincodes to service on its own");

  /* any well-formed pincode is taken; a malformed one isn't */
  type(doc, "hub-pin", "700001");
  eq(H.R().hub.selected, "700001", "a pincode VALMO has no list for is taken as typed");
  check(!$(doc, "hub-pin-box").classList.contains("bad"), "and isn’t marked");
  type(doc, "hub-pin", "012345");
  eq(hint(), E.pincodeFormat, "a malformed pincode is refused");
  check($(doc, "hub-pin-box").classList.contains("bad"), "the field is marked");
  eq(H.R().hub.selected, null, "and nothing is the hub’s pincode");

  /* clearing the field means there is no hub pincode */
  type(doc, "hub-pin", "");
  eq(H.R().hub.selected, null, "clearing the field clears the hub’s pincode");
  click(doc, "hub-submit");
  eq(hint(), E.pincodeSelect, "submitting without one says so at the field");
  check(!H.R().hub.submitted, "and nothing is submitted");

  /* the list to service is separate, and capped at five */
  A.addPincodes("560034, 560102, 110017, 400059, 560001");
  eq(H.R().hub.pincodes.length, 5, "the list to service is full");
  A.addPincodes("560038");
  eq(H.R().hub.pincodes.length, 5, "a sixth can’t join it");
  type(doc, "hub-pin", "560001");
  eq(H.R().hub.selected, "560001", "the hub pincode doesn’t care how full the list is");
  A.removePincode("560034");
  eq($(doc, "hub-pin").value, "560001", "and removing a pincode from the list leaves the field alone");

  /* the typed pincode is the one the hub is submitted with */
  doHubDetails(doc, { pin: null, map: mapFor(doc, "560001") });
  check(H.R().hub.submitted, "hub details submits");
  eq(H.R().hub.pincode, "560001", "with the pincode typed into the field");
  eq(H.R().hub.pincodes, ["560102", "110017", "400059", "560001"], "and the pincodes it will service");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   29. The Area Manager's portfolio — every hub under them, in both tabs
   ====================================================================== */

async function testAmPortfolio() {
  section("29. AM portfolio — Hub edits and Rate card updates over every hub");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;
  const rowsOf = (id) => [...doc.querySelectorAll('[data-testid="' + id + '"]')];
  const tiles = (id) => [...doc.querySelectorAll('[data-testid="' + id + '"] b')].map(b => b.textContent);
  const setSelect = (id, v) => { const el = $(doc, id); el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };

  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  check(txt(doc).indexOf("Area: Bengaluru South & East") >= 0, "the Area Manager’s patch matches the hubs they hold");

  /* --- the sample hubs are sound --- */
  const net = api.state.networkHubs.filter(h => H.hubChain(h).amId === "blr-se");
  eq(net.length, 11, "eleven other captains’ hubs are seeded under the Area Manager");
  eq(new Set(net.map(h => h.captain)).size, 11, "each run by its own captain");
  check(net.every(h => H.checkMapPin(h.mapLink, h.pincode).code === "ok"), "every hub’s pin sits inside its pincode");
  check(net.every(h => H.slabsValid(h.rateCard.slabs) && !H.cardAbove(h.category, h.city, h.rateCard) &&
                       h.rateCard.touchpoint === H.fixedTp(h.category)),
        "and every agreed rate card is complete, within its hub type’s and city’s ceilings, on its fixed touchpoint");
  check(api.state.hubEdits.filter(e => e.status === "pending")
          .every(e => H.checkMapPin(e.after.mapLink, e.after.pincode).ok),
        "every requested pin sits inside the pincode it asks for");

  /* --- Hub edits: every hub, the ones to review first --- */
  clickSel(doc, '[data-aptab="edits"]');
  eq(sel(doc, '[data-aptab="edits"]').textContent, "Hub edits (4)", "four edits are waiting for review");
  let rows = rowsOf("ap-hub-row");
  eq(rows.length, 11, "the tab lists every hub under the Area Manager");
  const states = rows.map(r => r.getAttribute("data-status"));
  eq(states.slice(0, 4), ["pending", "pending", "pending", "pending"], "with the ones to review first");
  eq([states.filter(s => s === "approved").length, states.filter(s => s === "rejected").length,
      states.filter(s => s === "none").length], [1, 1, 5], "then one approved, one rejected and five with no request");
  eq(tiles("ap-hub-stats"), ["11", "4", "1", "1"], "the tiles count hubs, edits to review, approved and rejected");

  $(doc, "ap-hub-search").focus();
  type(doc, "ap-hub-search", "whitefield");
  eq(rowsOf("ap-hub-row").map(r => r.getAttribute("data-hubrow")), ["nh-whf"], "search finds a hub by its area");
  eq(doc.activeElement && doc.activeElement.id, "ap-hub-search", "and keeps the caret in the search box");
  type(doc, "ap-hub-search", "98451 77230");
  eq(rowsOf("ap-hub-row").map(r => r.getAttribute("data-hubrow")), ["nh-ind"], "or by the captain’s phone");
  type(doc, "ap-hub-search", "");
  setSelect("ap-hub-filter", "pending");
  eq(rowsOf("ap-hub-row").length, 4, "the filter narrows to edits to review");
  setSelect("ap-hub-filter", "none");
  eq(rowsOf("ap-hub-row").length, 5, "or to hubs with no request");
  setSelect("ap-hub-filter", "all");

  /* --- reviewing a relocation, approving it --- */
  clickSel(doc, '[data-apedit="HE-40241"]');
  check(exists(doc, '[data-testid="ap-edit-detail"]'), "Review opens the request");
  eq(doc.querySelectorAll('[data-testid="ap-edit-changed"]').length, 4, "a move to BTM Layout changes all four details");
  check(exists(doc, '[data-testid="ap-edit-detail"] [data-testid="map-pin-ok"]'), "its new pin sits in 560076");
  click(doc, "ap-edit-approve");
  const hsr = H.networkHubById("nh-hsr");
  eq([hsr.pincode, hsr.city, hsr.areaSqft], ["560076", "Bengaluru, Karnataka", "3000"],
     "approving it moves that captain’s hub");
  check(hsr.address.indexOf("BTM Layout 1st Stage") >= 0, "address included");
  check(api.state.admin.toast.indexOf("HE-40241 approved") >= 0, "with a confirmation");
  eq(sel(doc, '[data-hubrow="nh-hsr"]').getAttribute("data-status"), "approved", "and the list shows it approved");
  eq(sel(doc, '[data-aptab="edits"]').textContent, "Hub edits (3)", "three left to review");

  /* --- rejecting one needs a reason, and changes nothing --- */
  clickSel(doc, '[data-apedit="HE-40235"]');
  click(doc, "ap-edit-reject");
  check(txt(doc).indexOf("Say why you’re rejecting it") >= 0, "rejecting needs a reason");
  type(doc, "ap-edit-reason", "The adjoining shed isn’t on the lease.");
  click(doc, "ap-edit-reject");
  eq(H.hubEditById("HE-40235").status, "rejected", "with one it is rejected");
  eq(H.networkHubById("nh-elc").areaSqft, "1800", "and the hub keeps its area");

  /* --- a hub with no request, and one with history --- */
  clickSel(doc, '[data-aphub="nh-mrt"]');
  check(exists(doc, '[data-testid="ap-hub-view"]'), "View hub opens the hub");
  check(sel(doc, '[data-testid="ap-hub-details"]').textContent.indexOf("No. 5, Outer Ring Road, Marathahalli") >= 0,
        "with its current details");
  check(exists(doc, '[data-testid="ap-hub-view"] [data-testid="map-pin-ok"]'), "its pin on a map");
  check(!exists(doc, '[data-testid="ap-hub-history"]') && !exists(doc, '[data-testid="ap-hub-history-empty"]') &&
        txt(doc).indexOf("History") === -1, "and no history section \u2014 changes are logged, not shown");
  click(doc, "ap-hub-back");
  clickSel(doc, '[data-aphub="nh-bom"]');
  check(sel(doc, '[data-testid="ap-hub-details"]').textContent.indexOf("9,500 sq ft") >= 0,
        "an approved edit is already live on its hub");
  eq(H.hubEditById("HE-40188").status, "approved", "its approved edit is kept in the log, not shown");
  clickSel(doc, '[data-aprate="nh-bom"]');
  check(exists(doc, '[data-testid="ap-rate-editor"]'), "the hub links straight to updating its rate card");
  click(doc, "ap-rate-back");
  click(doc, "ap-hub-back");

  /* --- Rate card updates: every FM hub, open ones first --- */
  clickSel(doc, '[data-aptab="rates"]');
  rows = rowsOf("ap-rate-row");
  eq(rows.length, 11, "the tab lists every live FM hub under the Area Manager");
  eq(rows.slice(0, 6).map(r => r.getAttribute("data-ratehub")),
     ["nh-hsr", "nh-btm", "nh-dml", "nh-elc", "nh-ind", "nh-mrt"],
     "sent back to the AM first, then in review, then with the captain, then scheduled");
  eq(rows.slice(0, 7).map(r => r.getAttribute("data-status")),
     ["revision", "ch", "central", "ch", "captain", "scheduled", "live"], "every stage is in the samples");
  eq(tiles("ap-rate-stats"), ["11", "3", "1", "1", "1"],
     "the tiles count hubs, updates in review, with captains, scheduled and sent back");
  check(sel(doc, '[data-ratehub="nh-jpn"]').textContent.indexOf("v2 · in force since 01 Oct 2026") >= 0,
        "a hub whose update is in force shows its second version");
  check(sel(doc, '[data-ratehub="nh-mrt"]').textContent.indexOf("from " + H.fmtIso(H.addDaysIso(H.todayIso(), 7))) >= 0,
        "a scheduled one shows the day it applies");
  check(sel(doc, '[data-ratehub="nh-ind"]').textContent.indexOf("Mall hub") >= 0, "each with its hub type");
  setSelect("ap-rate-filter", "review");
  eq(rowsOf("ap-rate-row").length, 3, "the filter narrows to updates in review");
  setSelect("ap-rate-filter", "scheduled");
  eq(rowsOf("ap-rate-row").length, 1, "or scheduled");
  setSelect("ap-rate-filter", "revision");
  eq(rowsOf("ap-rate-row").length, 1, "or sent back");
  setSelect("ap-rate-filter", "captain");
  eq(rowsOf("ap-rate-row").map(r => r.getAttribute("data-ratehub")), ["nh-ind"], "or waiting for the captain");
  setSelect("ap-rate-filter", "live");
  eq(rowsOf("ap-rate-row").length, 5, "or with nothing open");
  setSelect("ap-rate-filter", "all");
  type(doc, "ap-rate-search", "mall hub");
  eq(rowsOf("ap-rate-row").map(r => r.getAttribute("data-ratehub")), ["nh-ind", "nh-mrt"],
     "search reads hub type too, the one with the captain first");
  type(doc, "ap-rate-search", "");

  /* --- updating another captain's card: approved, then agreed by them --- */
  clickSel(doc, '[data-aprate="nh-krm"]');
  check(txt(doc).indexOf("Sunil Rao") >= 0, "the update names that hub’s own captain");
  eq([...doc.querySelectorAll('[data-rfield="rate"]')].map(i => i.value), ["3.40", "3.30", "3.20", "3.10", "3.00"],
     "starting from their card, slab by slab");
  const r0 = sel(doc, '[data-rslab="0"][data-rfield="rate"]');
  r0.value = "3.50"; r0.dispatchEvent(new win.Event("input", { bubbles: true }));
  click(doc, "ap-rate-send");
  check(api.state.admin.toast.indexOf("Sent to the Cluster Head for review") >= 0, "it goes to the Cluster Head");
  const krmUp = H.rateUpdateFor("nh-krm");
  eq(krmUp && krmUp.captain, "Sunil Rao", "recorded against that hub’s captain");
  clickSel(doc, '[data-aprate="nh-krm"]');
  check(devText(doc).indexOf("Cluster Head · " + krmUp.id) >= 0, "the dev panel can stand in for the Cluster Head");
  devClick(doc, "ru:approve:" + krmUp.id);
  eq(H.ruPhase(krmUp), "zh", "the Cluster Head’s approval sends it to the Zonal Head");
  check(devText(doc).indexOf("Zonal Head · " + krmUp.id) >= 0, "who the dev panel can stand in for too");
  devClick(doc, "ru:approve:" + krmUp.id);
  eq(H.ruPhase(krmUp), "captain", "whose approval sends it to the captain");
  check(api.state.rateNotices.some(n => n.ref === krmUp.id && n.captain === "Sunil Rao"), "Sunil Rao is asked to agree");
  check(devText(doc).indexOf("Sunil Rao agrees to " + krmUp.id) >= 0, "the dev panel can stand in for him");
  devClick(doc, "ru:agree:" + krmUp.id);
  eq(H.ruPhase(krmUp), "scheduled", "agreed, it’s published for its day");
  const krm = H.networkHubById("nh-krm");
  eq([krm.rateCard.version, H.versionInForce(krm, krmUp.effectiveFrom).slabs[0].rate], [1, "3.50"],
     "version 2 applies from its day; version 1 stays until then");
  A.adminRateBack();
  check(sel(doc, '[data-ratehub="nh-krm"]').textContent.indexOf("Scheduled") >= 0, "the list shows it scheduled");
  clickSel(doc, '[data-aprate="nh-jpn"]');
  check(sel(doc, '[data-testid="ap-rate-history"]').textContent.indexOf("RCU-50988") >= 0,
        "a hub’s versions log the update behind each one");
  check(sel(doc, '[data-testid="ap-rate-history"]').textContent.indexOf("19 Sept 2026") >= 0 &&
        sel(doc, '[data-testid="ap-rate-history"]').textContent.indexOf("asked 17 Sept 2026") >= 0,
        "and when its captain was asked and agreed");
  A.adminRateBack();

  /* --- the signed-in captain's bell carries only their own hubs --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  check(api.state.rateUpdates.some(u => u.status === "captain" && u.hubId.indexOf("nh-") === 0),
        "other captains have rate card updates to agree to");
  check(H.captainNotes().every(n => C.EXISTING_NOTE_IDS.indexOf(n.id) >= 0),
        "but none of them reach this captain’s bell — only their own");
  check(devText(doc).indexOf("Area Manager · hub edit") === -1, "nor the dev panel’s hub edit actions");

  /* --- once the captain is loaded, their hubs join the Area Manager's lists --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="edits"]');
  eq(rowsOf("ap-hub-row").length, 15, "fifteen hubs: the eleven, plus the captain’s four");
  check(sel(doc, '[data-hubrow="hub-jyp"]').getAttribute("data-status") === "inactive",
        "the captain’s inactive hub is listed as inactive");
  clickSel(doc, '[data-aptab="rates"]');
  eq(rowsOf("ap-rate-row").length, 12, "and twelve FM hubs on the rate card list");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   30. Changes the Area Manager makes directly — the captain is told, not asked
   ====================================================================== */

async function testAmDirectChanges() {
  section("30. AM direct changes — map pin, hub details, hub type");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions;
  const at = (pin, dLat = 0, dLng = 0) => "https://maps.google.com/?q=" +
    (H.PIN_AREAS[pin].lat + dLat).toFixed(4) + "," + (H.PIN_AREAS[pin].lng + dLng).toFixed(4);
  const setSelect = (id, v) => { const el = $(doc, id); el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const changes = () => api.state.amChanges;
  const asAdmin = () => { A.logout(); devClick(doc, "as:admin"); login(doc); clickSel(doc, '[data-aprole="am"]'); };
  const asCaptain = () => { A.logout(); devClick(doc, "as:existing"); login(doc); };

  devClick(doc, "as:existing");
  login(doc);
  quietBell(api);
  asAdmin();

  /* --- 1. a map pin corrected on an onboarding request notifies its captain --- */
  A.adminOpen("OBD-78219");                       // Karan Verma's own hub application
  click(doc, "ap-map-edit");
  type(doc, "ap-map", at("560076", 0.0003, 0.0002));
  click(doc, "ap-map-save");
  check(api.state.admin.toast.indexOf("Karan Verma has been notified") >= 0, "saving the pin says the captain was notified");
  const mapChange = changes().filter(c => c.requestId === "OBD-78219")[0];
  check(!!mapChange && mapChange.kind === "map" && mapChange.notify && !mapChange.seen, "a notification is raised for them");
  check(txt(doc).indexOf("the captain is notified, with nothing to re-verify") >= 0, "and the context card says so");
  eq(H.apById("OBD-78219").stage, "ch", "nothing goes back to the captain — the request stays where it was");
  A.adminOpen("OBD-78240");
  click(doc, "ap-map-edit");
  type(doc, "ap-map", at("560102"));
  click(doc, "ap-map-save");
  check(changes().some(c => c.requestId === "OBD-78240" && c.captain === "Neha S"), "another request’s captain is notified too");

  /* --- 2. the AM edits a live hub's address, coordinates and max vehicle size --- */
  A.adminTab("edits");
  clickSel(doc, '[data-aphub="hub-aqt"]');
  click(doc, "ah-edit");
  check(exists(doc, '[data-testid="ap-hub-editor"]'), "Edit hub details opens on the hub");
  eq([$(doc, "ah-address").value, $(doc, "ah-map").value, $(doc, "ah-vehicle").value],
     ["Koramangala, Bengaluru", "12.9349, 77.6251", "7MT_20FT"], "prefilled with the address, coordinates and vehicle");
  click(doc, "ah-save");
  check(sel(doc, '[data-testid="ap-hub-error"]').textContent.indexOf("Nothing has changed yet") >= 0,
        "an unchanged form is not saved");
  type(doc, "ah-map", "somewhere near the lake");
  click(doc, "ah-save");
  check(sel(doc, '[data-testid="ap-hub-error"]').textContent.indexOf("Enter coordinates like") >= 0,
        "unreadable coordinates are refused");
  const mapIn = $(doc, "ah-map");
  type(doc, "ah-map", "12.9116, 77.6474");
  check($(doc, "ah-map") === mapIn, "typing coordinates previews in place");
  check(exists(doc, '#ah-map-preview [data-testid="map-pin-bad"]'), "a pin in HSR Layout previews as outside 560034");
  click(doc, "ah-save");
  check(txt(doc).indexOf("not the hub’s pincode 560034") >= 0, "and is refused on save");
  type(doc, "ah-address", "No. 3, 1st Cross, Koramangala 5th Block, Bengaluru");
  type(doc, "ah-map", "12.9338, 77.6236");
  check(exists(doc, '#ah-map-preview [data-testid="map-pin-ok"]'), "coordinates inside the pincode preview as inside");
  setSelect("ah-vehicle", "9MT_6W");
  click(doc, "ah-save");
  const aqt = H.hubById("hub-aqt");
  eq([aqt.address, aqt.mapLink, aqt.maxVehicle],
     ["No. 3, 1st Cross, Koramangala 5th Block, Bengaluru", "https://maps.google.com/?q=12.9338,77.6236", "9MT_6W"],
     "saving applies all three straight to the hub");
  check(api.state.admin.toast.indexOf("Karan Verma has been notified") >= 0, "and notifies its captain");
  check(!api.state.hubEdits.some(e => e.hubId === "hub-aqt" && e.status === "pending"),
        "nothing is waiting for the captain to approve");
  check(changes().some(c => c.hubId === "hub-aqt" && c.kind === "details" &&
          c.fields.join(",") === "address,mapLink,maxVehicle"), "the change is logged against the hub");
  click(doc, "ap-hub-back");

  clickSel(doc, '[data-aphub="nh-krm"]');
  check(!exists(doc, "#ah-edit") && exists(doc, '[data-testid="ap-hub-edit-blocked"]'),
        "while a captain’s own edit is waiting, the AM decides it first");
  click(doc, "ap-hub-back");
  clickSel(doc, '[data-aphub="nh-dml"]');
  click(doc, "ah-edit");
  setSelect("ah-vehicle", "10MT_22FT");
  click(doc, "ah-save");
  eq(H.networkHubById("nh-dml").maxVehicle, "10MT_22FT", "another captain’s hub can be changed the same way");
  check(changes().some(c => c.hubId === "nh-dml" && c.captain === "Kavya Joshi" && c.notify && !c.seen &&
          c.after.maxVehicle === "10MT_22FT"), "notifying that captain");
  click(doc, "ap-hub-back");

  /* --- 3. hub type and rate changes go to the Cluster Head, then are published --- */
  A.adminTab("rates");
  clickSel(doc, '[data-aprate="hub-kdg"]');
  eq($(doc, "ap-rate-type").value, "standalone", "the update starts from the hub’s type");
  setSelect("ap-rate-type", "lm_as_fm");
  eq($(doc, "ap-rate-send").textContent, "Send to the Cluster Head", "a hub type change is sent for review");
  click(doc, "ap-rate-send");
  const typeUp = H.rateUpdateFor("hub-kdg");
  check(!!typeUp && typeUp.status === "ch" && typeUp.toCategory === "lm_as_fm", "it goes to the Cluster Head");
  eq(H.hubById("hub-kdg").category, "standalone", "and the hub type doesn’t change yet");
  check(!changes().some(c => c.hubId === "hub-kdg" && c.kind === "type"), "nor is a change logged yet");
  clickSel(doc, '[data-aprate="hub-kdg"]');
  check(devText(doc).indexOf("Cluster Head · " + typeUp.id) >= 0, "the dev panel can stand in for the Cluster Head");
  devClick(doc, "ru:approve:" + typeUp.id);
  devClick(doc, "ru:approve:" + typeUp.id);
  eq(typeUp.to.touchpoint, "6.00", "the new type brings LM-as-FM’s 6.00 touchpoint with it");
  eq(H.ruPhase(typeUp), "captain", "so, approved, it goes to the captain to agree to the new rates");
  check(api.state.rateNotices.some(n => n.ref === typeUp.id), "who is asked — the hub type itself stays internal");
  eq(H.hubById("hub-kdg").category, "standalone", "nothing changes until they agree");
  A.adminRateBack();

  /* the editor flags rates over a new type's ceilings, but no longer refuses them */
  clickSel(doc, '[data-aprate="nh-bom"]');
  setSelect("ap-rate-type", "standalone_mini");
  check(exists(doc, '[data-rslabrow="0"].over') && exists(doc, '[data-testid="ap-rate-above"]'),
        "rates over the mini-hub ceilings are flagged, with the route they will take");
  A.adminRateBack();

  /* an update above its ceilings: the CH approves, the ZH (or FM Central Ops for them), then BizFin */
  clickSel(doc, '[data-aprate="nh-bld"]');
  const b0 = sel(doc, '[data-rslab="0"][data-rfield="rate"]');
  b0.value = "5.40"; b0.dispatchEvent(new win.Event("input", { bubbles: true }));
  click(doc, "ap-rate-send");
  const bldUp = H.rateUpdateFor("nh-bld");
  check(!!bldUp && bldUp.status === "ch" && H.ruAbove(bldUp), "it still goes to the Cluster Head first");
  check(api.state.admin.toast.indexOf("then the Zonal Head") >= 0 &&
        api.state.admin.toast.indexOf("BizFin approves it after them") >= 0, "the AM is told where it goes next");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-aptab="rates"]');
  check(exists(doc, '[data-ru="' + bldUp.id + '"]'), "it is in the Cluster Head’s queue");
  clickSel(doc, '[data-apru="' + bldUp.id + '"]');
  check(sel(doc, '[data-testid="ru-checks"]').textContent.indexOf("Above the Standalone ceilings") >= 0,
        "marked above its ceilings");
  check($(doc, "ap-ru-approve").textContent.indexOf("send to the Zonal Head") >= 0 && !exists(doc, "#ap-ru-raise"),
        "the Cluster Head approves it on to the Zonal Head — there is no separate raise");
  click(doc, "ap-ru-approve");
  eq(bldUp.status, "zh", "so it goes to the Zonal Head");
  A.adminSwitchRole();
  asCentral(doc, "ops");
  clickSel(doc, '[data-aptab="rates"]');
  check(exists(doc, '[data-ru="' + bldUp.id + '"] .btn-primary'), "FM Central Ops can stand in for the Zonal Head");
  clickSel(doc, '[data-apru="' + bldUp.id + '"]');
  check($(doc, "ap-ru-approve").textContent.indexOf("send to BizFin") >= 0, "above the ceilings, that approval goes to BizFin");
  click(doc, "ap-ru-approve");
  eq(bldUp.status, "central", "and it’s with BizFin");
  A.adminSwitchRole();
  asCentral(doc, "bizfin");
  clickSel(doc, '[data-aptab="rates"]');
  clickSel(doc, '[data-apru="' + bldUp.id + '"]');
  click(doc, "ap-ru-approve");
  eq(bldUp.status, "captain", "BizFin approves it, which sends it to the captain");
  eq((bldUp.trail || []).map(x => x.by + ":" + x.what).join(","),
     "am:sent,ch:approved,ops:approved,system:sent to BizFin,central:approved,system:sent to the captain",
     "with its whole route on the trail");

  /* sending one back to the Area Manager, who revises and resubmits */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-aptab="rates"]');
  clickSel(doc, '[data-apru="RCU-51130"]');
  click(doc, "ap-ru-reject");
  check(txt(doc).indexOf("Say why you’re sending it back") >= 0, "sending one back needs a reason");
  type(doc, "ap-ru-reason", "Keep the first slab where it is.");
  click(doc, "ap-ru-reject");
  eq(H.rateUpdateById("RCU-51130").status, "revision", "with one it goes back to the Area Manager");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="rates"]');
  eq(sel(doc, '[data-ratehub="nh-btm"]').getAttribute("data-status"), "revision", "the AM sees it sent back");
  clickSel(doc, '[data-aprate="nh-btm"]');
  check(sel(doc, '[data-testid="ap-rate-sentback"]').textContent.indexOf("Keep the first slab where it is.") >= 0,
        "with the reason");
  const btm0 = () => sel(doc, '[data-rslab="0"][data-rfield="rate"]');
  eq(btm0().value, "5.40", "the editor starts from what was proposed");
  eq($(doc, "ap-rate-send").textContent, "Resubmit to the Cluster Head", "and resubmits it");
  btm0().value = "5.20"; btm0().dispatchEvent(new win.Event("input", { bubbles: true }));
  click(doc, "ap-rate-send");
  eq(H.rateUpdateById("RCU-51130").status, "ch", "back with the Cluster Head");
  eq(H.rateUpdateById("RCU-51130").to.slabs[0].rate, "5.20", "revised");
  clickSel(doc, '[data-aprate="nh-hsr"]');
  click(doc, "ap-rate-withdraw");
  eq(H.rateUpdateById("RCU-51123").status, "withdrawn", "a sent-back update can be withdrawn instead");
  eq(H.rateUpdateFor("nh-hsr"), null, "leaving the hub on the card in force");

  /* --- the captain's side --- */
  asCaptain();
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "3",
     "the captain has three notifications: the map pin, the hub details and the new rates");
  click(doc, "bell");
  const notes = () => [...doc.querySelectorAll("[data-note]")].map(n => n.textContent);
  check(notes().some(n => n.indexOf("Map pin corrected · OBD-78219") >= 0), "the map pin correction");
  check(notes().some(n => n.indexOf("Hub details updated · Koramangala Hub") >= 0), "the hub details change");
  check(notes().some(n => n.indexOf("Rate card update to agree · Kudlu Gate Hub (KDG)") >= 0),
        "and the new rates the type change brought, to agree");
  check(!notes().some(n => /hub type|mall hub|lm-as-fm|ceiling/i.test(n)), "nothing about the hub type at all");
  clickSel(doc, '[data-note="amchange:' + mapChange.id + '"]');
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "2", "reading the map pin note clears it");
  click(doc, "bell");
  clickSel(doc, '[data-note^="rateagree:"]');
  setCheck(doc, "rate-agree-check", true);
  click(doc, "rate-agree");
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "1", "and agreeing to the rate card update clears that");
  eq(H.ruPhase(typeUp), "scheduled", "agreed, it’s published for its day");
  eq(H.hubById("hub-kdg").category, "standalone", "the hub type doesn’t change before that day");
  eq(H.versionInForce(H.hubById("hub-kdg"), typeUp.effectiveFrom).category, "lm_as_fm", "and does from it");
  check(api.state.amChanges.some(c => c.hubId === "hub-kdg" && c.kind === "type" && !c.notify),
        "logged for the Area Manager, never notified");
  click(doc, "hub-back-hubs");
  click(doc, "bell");
  clickSel(doc, '[data-note^="amchange:"]');
  eq(api.state.panel.section, "hubs", "the hub details note leads to My Hubs");
  const card = sel(doc, '[data-hub="hub-aqt"] [data-testid="hub-am-updated"]');
  check(!!card && card.textContent.indexOf("Address: No. 3, 1st Cross, Koramangala 5th Block") >= 0 &&
        card.textContent.indexOf("Max vehicle size: 9MT_6W") >= 0 && card.textContent.indexOf("Map pin: 12.9338, 77.6236") >= 0,
        "where the hub card says what changed");
  check(card.textContent.indexOf("nothing for you to do") >= 0, "with nothing for the captain to do");
  clickSel(doc, '[data-amdismiss]');
  check(!exists(doc, '[data-testid="bell-count"]'), "dismissing it clears the bell");
  const kdgHub = H.hubById("hub-kdg");
  check(!/lm-as-fm|standalone|hub type/i.test(sel(doc, '[data-hub="hub-kdg"]').textContent),
        "the captain never sees the hub type behind the card");
  H.rateVersions(kdgHub).filter(v => v.ref === typeUp.id)[0].effectiveFrom = H.todayIso();
  H.syncAllRates();
  eq(kdgHub.category, "lm_as_fm", "the hub type takes effect on the update’s day");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   31. Sample captains — each has notifications, and can be signed in as
   ====================================================================== */

async function testSampleCaptains() {
  section("31. Sample captains — sign in as any of them, with their own notifications");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;
  const notes = () => [...doc.querySelectorAll("[data-note]")].map(n => n.textContent);
  const signInAs = (hubId) => {
    if (api.state.screen !== "login") A.logout();
    $(doc, "dev-sample").value = hubId;
    devClick(doc, "as:sample");
    login(doc);
  };

  check(devText(doc).indexOf("Captain · sample, the one above") >= 0, "the login switch offers the sample captains");
  eq([...doc.querySelectorAll("#dev-sample option")].length, 11, "all eleven of them");

  /* --- every sample captain signs in to their own hub and their own notifications --- */
  const expected = {
    "nh-krm": "Hub details updated · Koramangala FM Hub", "nh-hsr": "Hub details updated · HSR Layout FM Hub",
    "nh-ind": "Rate card update to agree · Indiranagar FM Hub (IND)", "nh-whf": null,
    "nh-elc": "Hub details updated · Electronic City FM Hub", "nh-bom": "Hub edit approved · Bommasandra FM Hub",
    "nh-bld": "Hub edit not approved · Bellandur FM Hub", "nh-jpn": "Hub details updated · JP Nagar FM Hub",
    "nh-mrt": null, "nh-dml": "Hub details updated · Domlur FM Hub",
    "nh-btm": "Hub details updated · BTM Layout FM Hub"
  };
  C.PORTFOLIO_HUBS.forEach(ph => {
    signInAs(ph.id);
    const who = ph.captain;
    check(api.state.screen === "panel" && txt(doc).indexOf(who) >= 0, who + " lands in their own Captain Hub");
    check(exists(doc, '[data-hub="' + ph.id + '"]') && api.state.hubs.length === 1, "  with their hub, " + ph.code);
    const count = sel(doc, '[data-testid="bell-count"]');
    if (!expected[ph.id]) {               // already agreed to their update — nothing waiting
      check(!count, "  and nothing on their bell — their rate card update is already agreed");
      return;
    }
    check(!!count && +count.textContent >= 1, "  and a notification on their bell");
    click(doc, "bell");
    check(notes().some(n => n.indexOf(expected[ph.id]) >= 0), "  “" + expected[ph.id] + "”");
    check(notes().every(n => n.indexOf(ph.name) >= 0), "  all of it about their own hub");
    click(doc, "bell");
  });

  /* --- updates still in review stay out of sight --- */
  signInAs("nh-elc");
  click(doc, "bell");
  check(!notes().some(n => n.indexOf("Rate card update") >= 0),
        "Electronic City’s update is still with the Cluster Head, so its captain hears nothing yet");
  click(doc, "bell");
  check(!exists(doc, '[data-hub="nh-elc"] [data-testid="hub-rate-next"]'), "and their hub card shows no change");

  /* --- a sample captain takes their side of the flow --- */
  signInAs("nh-whf");
  check(sel(doc, '[data-hub="nh-whf"] [data-testid="hub-rate"]').textContent.indexOf("₹5.30") >= 0,
        "Deepa Nair’s hub is already on its new card");
  clickSel(doc, '[data-ratehist="nh-whf"]');
  eq([...doc.querySelectorAll('[data-testid="rate-hist-item"]')].map(i => i.getAttribute("data-state")),
     ["current", "past"], "her history: the card she agreed to in force, the one before it past");
  check(sel(doc, '[data-testid="rate-hist-item"]').textContent.indexOf("You agreed on 30 Sept 2026") >= 0,
        "with the day she agreed");
  signInAs("nh-ind");
  check(exists(doc, '[data-hub="nh-ind"] [data-testid="hub-rate-ask"]'), "Vikram Shetty is asked to agree to his");
  click(doc, "bell");
  clickSel(doc, '[data-note^="rateagree:"]');
  eq(api.state.panel.section, "rateagree", "his notice opens the update to agree");
  setCheck(doc, "rate-agree-check", true);
  click(doc, "rate-agree");
  eq(H.ruPhase(H.rateUpdateById("RCU-51138")), "scheduled", "he agrees, and it’s scheduled for its day");
  click(doc, "hub-back-hubs");
  check(exists(doc, '[data-hub="nh-ind"] [data-testid="hub-rate-next"]') &&
        !exists(doc, '[data-hub="nh-ind"] [data-testid="hub-rate-ask"]'), "his hub card now shows it agreed and coming");
  signInAs("nh-mrt");
  const mrtNext = sel(doc, '[data-hub="nh-mrt"] [data-testid="hub-rate-next"]');
  check(!!mrtNext && mrtNext.textContent.indexOf("New rates from " + H.fmtIso(H.addDaysIso(H.todayIso(), 7))) >= 0,
        "Arjun Menon’s hub card shows new rates scheduled for next week");
  signInAs("nh-bom");
  clickSel(doc, '[data-hedismiss]');
  check(!exists(doc, '[data-testid="bell-count"]'), "Ritu Agarwal dismisses her approved edit and her bell clears");
  check(api.reload(), "a sample captain stays signed in across a reload");
  eq(api.state.sampleCaptain, "nh-bom", "as the same captain");
  check(exists(doc, '[data-hub="nh-bom"]'), "on the same hub");

  /* --- signing back in as the existing captain puts everyone back --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  eq(api.state.sampleCaptain, null, "the existing captain is back");
  eq(api.state.hubs.map(h => h.code).join(","), "AQT,BEU,JYP,KDG", "with their own four hubs");
  eq(api.state.networkHubs.length, 14, "and every sample hub back with its captain, three more on other patches");
  check(api.helpers.captainNotes().every(n => C.EXISTING_NOTE_IDS.indexOf(n.id) >= 0),
        "the sample captains’ notifications never reach them — only their own");
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="rates"]');
  eq(sel(doc, '[data-ratehub="nh-whf"]').getAttribute("data-status"), "live",
     "the Area Manager sees Deepa Nair’s hub on its new card");
  eq(sel(doc, '[data-ratehub="nh-mrt"]').getAttribute("data-status"), "scheduled", "and Arjun Menon’s scheduled");
  clickSel(doc, '[data-aptab="edits"]');
  clickSel(doc, '[data-aphub="nh-krm"]');
  check(api.state.amChanges.some(c => c.hubId === "nh-krm" && c.captain === "Sunil Rao" && c.notify),
        "and each sample change is logged against the captain it notified");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   32. A leaner admin panel — offline conversations, logged history, samples everywhere
   ====================================================================== */

async function testLeanAdmin() {
  section("32. Lean admin — no notes, history logged, samples in every tab");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;

  devClick(doc, "as:admin");
  login(doc);

  /* --- 6. every tab of every admin panel has samples --- */
  const rowsIn = () => doc.querySelectorAll(
    '[data-apopen], [data-testid="ap-hub-row"], [data-testid="ap-rate-row"], [data-testid="ap-ru-row"], ' +
    '[data-testid="slab-set-row"], [data-testid="ap-bulk-editor"]').length;
  C.ADMIN_ROLE_ORDER.forEach(role => {
    if (api.state.screen === "admin") A.adminSwitchRole();
    clickSel(doc, '[data-aprole="' + role + '"]');
    const personas = role === "central" ? Object.keys(C.CENTRAL_TABS) : [null];
    personas.forEach(p => {
      if (p) devClick(doc, "ca:" + p);
      (p ? C.CENTRAL_TABS[p] : C.ADMIN_TABS[role]).forEach(tab => {
        A.adminTab(tab.id);
        check(rowsIn() > 0, C.ADMIN_ROLES[role].label + (p ? " · " + C.CENTRAL_PERSONAS[p].label : "") +
              " › " + tab.label + " has sample rows");
      });
    });
  });
  check(!Object.keys(C.ADMIN_TABS).some(k => C.ADMIN_TABS[k].some(t => t.id === "users" || t.id === "zh")),
        "5. no panel has User mapping, and Central has no ZH requests tab — nothing ever waits with the ZH");
  eq(H.apById("OBD-78263").stage, "central", "Central’s own queue has a request the Cluster Head raised");
  check(H.apById("OBD-78240").design.sent && !H.apById("OBD-78240").design.approved,
        "and its design queue a design waiting for alignment");

  /* --- 4. "Decided by you" keeps only what is still pending further along --- */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  A.adminTab("rates");
  const decidedIds = () => [...doc.querySelectorAll('[data-testid="ap-ru-row"]')]
    .filter(r => !r.querySelector(".btn-primary")).map(r => r.getAttribute("data-ru"));
  check(["RCU-50988", "RCU-51102", "RCU-51117"].every(id => decidedIds().indexOf(id) === -1),
        "the Cluster Head’s decided list leaves out updates already published");
  eq(decidedIds().sort(), ["RCU-51123", "RCU-51138", "RCU-51151", "RCU-51174"],
     "and keeps the ones still pending — with BizFin, the captain, or sent back, across the cluster’s AMs");
  check(H.rateUpdateById("RCU-50988").trail.some(x => x.by === "ch"), "a published one is still logged with its trail");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  A.adminTab("rates");
  clickSel(doc, '[data-aprate="nh-hsr"]');
  click(doc, "ap-rate-withdraw");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  A.adminTab("rates");
  check(decidedIds().indexOf("RCU-51123") === -1, "a withdrawn update drops off as well");

  /* --- 1. no reason or note on an update — but the day it applies from --- */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  A.adminTab("rates");
  clickSel(doc, '[data-aprate="nh-krm"]');
  check(!exists(doc, "#ap-rate-reason") && !exists(doc, "#ap-rate-note"), "the AM’s update has no reason or note");
  check(txt(doc).indexOf("Why the rates are changing") === -1 && txt(doc).indexOf("Note for the Cluster Head") === -1,
        "not even as labels");
  check(exists(doc, "#ap-rate-from"), "but it does say the day it applies from — rates change prospectively");
  const r0 = sel(doc, '[data-rslab="0"][data-rfield="rate"]');
  r0.value = "3.50"; r0.dispatchEvent(new win.Event("input", { bubbles: true }));
  click(doc, "ap-rate-send");
  const krmUp = H.rateUpdateFor("nh-krm");
  check(!!krmUp && krmUp.status === "ch", "a changed card goes straight to the Cluster Head");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  A.adminTab("rates");
  clickSel(doc, '[data-apru="' + krmUp.id + '"]');
  const checks = sel(doc, '[data-testid="ru-checks"]').textContent;
  check(checks.indexOf("Reason the captain sees") === -1 && checks.indexOf("Note for the desks") === -1,
        "the Cluster Head’s review shows no reason or note");
  check(checks.indexOf("Applies from" + H.fmtIso(krmUp.effectiveFrom)) >= 0, "and says when it applies");
  click(doc, "ap-ru-approve");
  eq(H.rateUpdateDecide(krmUp, "zh", "approve"), "", "the Zonal Head approves it after");
  A.logout();
  $(doc, "dev-sample").value = "nh-krm";
  devClick(doc, "as:sample");
  login(doc);
  click(doc, "bell");
  clickSel(doc, '[data-note^="rateagree:"]');
  const page = sel(doc, '[data-testid="rate-update"]').textContent;
  check(page.indexOf("Why it changed") === -1, "the captain gets no reason for the change");
  check(page.indexOf(H.fmtIso(krmUp.effectiveFrom)) >= 0, "only the day it applies from");
  check(exists(doc, "#rate-agree"), "and the card to agree to");

  /* --- 1. the captain's hub edit carries no note --- */
  A.logout();
  $(doc, "dev-sample").value = "nh-mrt";
  devClick(doc, "as:sample");
  login(doc);
  clickSel(doc, '[data-hubedit="nh-mrt"]');
  check(!exists(doc, "#he-note") && txt(doc).indexOf("What changed?") === -1,
        "a captain’s hub edit asks for no note");

  /* --- 3. no History on View hub, but every change is logged --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  A.adminTab("edits");
  clickSel(doc, '[data-aphub="nh-bom"]');
  check(!exists(doc, '[data-testid="ap-hub-history"]') && txt(doc).indexOf("History") === -1,
        "View hub shows no history");
  click(doc, "ah-edit");
  $(doc, "ah-vehicle").value = "16MT_10W";
  $(doc, "ah-vehicle").dispatchEvent(new win.Event("change", { bubbles: true }));
  click(doc, "ah-save");
  check(api.state.amChanges.some(c => c.hubId === "nh-bom" && c.after.maxVehicle === "16MT_10W"),
        "while the AM’s change is logged");
  check(api.state.hubEdits.some(e => e.hubId === "nh-bom" && e.status === "approved"), "as are the captain’s edits");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   33. Dropping the pin on the map — captain and Area Manager
   ====================================================================== */

/* The harness strips the page’s Leaflet, so the app never gets it. This stand-in
   records what the app asks of it (the view, the tiles, the pin and the
   handlers) and lets a test fire a tap or a drag the way Leaflet would. */
function mockLeaflet() {
  const maps = [];
  const layer = (kind, props) => Object.assign({
    kind, handlers: {}, map: null,
    on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; },
    fire(ev, d) { (this.handlers[ev] || []).forEach((f) => f(d)); },
    addTo(m) { this.map = m; m.layers.push(this); return this; },
    remove() { if (this.map) this.map.removeLayer(this); return this; },
    setLatLng(ll) { this.latlng = { lat: ll[0], lng: ll[1] }; return this; },
    getLatLng() { const p = this.latlng; return { lat: p.lat, lng: p.lng, wrap: () => ({ lat: p.lat, lng: p.lng }) }; },
    setIcon(i) { this.icon = i; return this; }
  }, props);
  return {
    maps,
    map(el, opts) {
      const m = {
        el, opts, view: null, views: 0, handlers: {}, layers: [], removed: false,
        attributionControl: { prefix: undefined, setPrefix(p) { this.prefix = p; } },
        setView(ll, zoom) {
          this.view = { lat: ll[0], lng: ll[1], zoom }; this.views++;
          (this.handlers.moveend || []).forEach((f) => f());
          return this;
        },
        getCenter() { return { lat: this.view.lat, lng: this.view.lng }; },
        getZoom() { return this.view.zoom; },
        on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; },
        fire(ev, d) { (this.handlers[ev] || []).forEach((f) => f(d)); },
        removeLayer(l) { this.layers = this.layers.filter((x) => x !== l); l.map = null; return this; },
        remove() { this.removed = true; return this; },
        pin() { return this.layers.filter((l) => l.kind === "marker")[0]; }
      };
      el.classList.add("leaflet-container");
      maps.push(m);
      return m;
    },
    tileLayer(url, opts) { return layer("tiles", { url, opts }); },
    marker(ll, opts) { return layer("marker", { latlng: { lat: ll[0], lng: ll[1] }, opts, icon: opts.icon }); },
    divIcon(o) { return o; }
  };
}

async function testMapPick() {
  section("33. Dropping the pin on the map — captain and Area Manager");
  const L = mockLeaflet();
  const { win, doc, api } = await boot({ beforeParse: (w) => { w.L = L; } });
  const H = api.helpers, A = api.actions;
  const area = (pin) => H.PIN_AREAS[pin];
  const mapAt = (q) => { const f = sel(doc, q + " .map-frame"); return f && f._lm ? L.maps.find((m) => m.el === f) : null; };
  const where = (k) => [k.latlng.lat, k.latlng.lng];
  const tap = (m, lat, lng) => m.fire("click", { latlng: { lat, lng, wrap: () => ({ lat, lng }) } });
  const drag = (m, lat, lng) => { const k = m.pin(); k.setLatLng([lat, lng]); k.fire("dragend"); };

  /* --- where a map opens --- */
  const view = (link, pin, near) => H.mapStartView(H.checkMapPin(link, pin), pin, near);
  eq(view("https://maps.google.com/?q=12.9,77.6", "560076"), { lat: 12.9, lng: 77.6, zoom: 16 }, "a map with a pin opens on it");
  eq(view("", "560076"), { lat: 12.9081, lng: 77.604, zoom: 14 }, "without one, on the hub’s pincode");
  eq(view("", null, "560034"), { lat: 12.9352, lng: 77.6245, zoom: 14 }, "or on a pincode the captain has mentioned");
  eq(view("", null, ""), H.MAP_HOME, "or on central Bengaluru");

  /* --- the captain, on hub details --- */
  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  let m = mapAt("#hub-map-preview");
  check(!!m, "hub details opens with a map the pin can be dropped on");
  eq(m.view, H.MAP_HOME, "with no pincode yet it opens on central Bengaluru");
  const tiles = m.layers.find((l) => l.kind === "tiles");
  check(!!tiles && /^https:\/\/tile\.openstreetmap\.de\//.test(tiles.url),
        "over OpenStreetMap tiles from a server that also serves a page opened from disk");
  check(/OpenStreetMap/.test(tiles.opts.attribution), "credited to OpenStreetMap");
  eq(m.opts.scrollWheelZoom, false, "scrolling the page past it doesn’t zoom the map");
  check(!m.pin(), "there is no pin until one is dropped");
  check(sel(doc, '[data-testid="map-pick-hint"]').textContent.indexOf("Tap the map") >= 0, "the map says to tap it");
  check($(doc, "hub-map-hint").textContent.indexOf("Tap the map to mark your hub") >= 0,
        "and so does the hint under the link field");

  /* the frame used to share data-pick with the role cards, so a click on it
     picked a role called "hub-map" */
  clickSel(doc, "#hub-map-preview .map-frame");
  eq([api.state.activeRole, H.phaseId()], ["FM", "hub"], "a click on the map is not taken for a role pick");

  tap(m, 12.90834, 77.60419);
  eq($(doc, "hub-map").value, "https://maps.google.com/?q=12.90834,77.60419", "a tap fills the link field with the pin");
  eq(H.R().hub.mapLink, "https://maps.google.com/?q=12.90834,77.60419", "and saves it");
  check(!!m.pin() && m.pin().opts.draggable, "a pin appears that can be dragged");
  eq(where(m.pin()), [12.90834, 77.60419], "where the map was tapped");
  check(/\bwait\b/.test(m.pin().icon.className), "navy while there is no pincode to check it against");
  check(mainTxt(doc).indexOf("Pick the hub pincode to check this pin") >= 0, "and the map says so");
  check(sel(doc, '#hub-map-preview [data-testid="map-coords"]').textContent.indexOf("12.90834, 77.60419") >= 0,
        "the latitude and longitude show under the map");
  eq(L.maps.filter((x) => !x.removed).length, 1, "a tap moves the pin without redrawing the map");

  /* choosing the hub pincode checks the pin, and the map stays where it was */
  const left = Object.assign({}, m.view);
  A.typeHubPincode("560076");
  const m2 = mapAt("#hub-map-preview");
  check(m.removed && !!m2 && m2 !== m, "a re-render lets the old map go and mounts a new one");
  eq(m2.view, left, "which opens where the last one was left");
  check(/\bok\b/.test(m2.pin().icon.className), "the pin turns green inside 560076");
  check(exists(doc, '[data-testid="map-pin-ok"]'), "and is marked inside the pincode");
  m = m2;

  /* dragging it out of the pincode flags it; the map doesn't move */
  const views = m.views;
  drag(m, area("560034").lat, area("560034").lng);
  check($(doc, "hub-map").value.indexOf("q=12.9352,77.6245") >= 0, "dragging the pin moves the link with it");
  check(/\bbad\b/.test(m.pin().icon.className), "the pin turns red outside the pincode");
  check($(doc, "hub-map-hint").textContent.indexOf("560034 (Koramangala)") >= 0,
        "and the field says which pincode it landed in");
  check($(doc, "hub-map-box").classList.contains("bad"), "marking the field");
  eq(m.views, views, "a drag doesn’t move the map");

  tap(m, area("560076").lat + 0.001, area("560076").lng);
  check(!$(doc, "hub-map-box").classList.contains("bad"), "a tap back inside the pincode clears it");
  check(/\bok\b/.test(m.pin().icon.className), "and the pin is green again");

  tap(m, 12.908345678, 77.604194321);
  eq($(doc, "hub-map").value, "https://maps.google.com/?q=12.90835,77.60419", "a tap is kept to five decimal places");
  A.mapPick("hub-map", NaN, 77.6);
  eq(H.R().hub.mapLink, "https://maps.google.com/?q=12.90835,77.60419", "a point without coordinates is ignored");

  /* a pasted link moves the pin and brings the map to it */
  type(doc, "hub-map", "https://www.google.com/maps/place/BTM/@12.9112,77.6062,17z");
  eq(where(m.pin()), [12.9112, 77.6062], "a pasted link moves the pin");
  eq([m.view.lat, m.view.lng], [12.9112, 77.6062], "and the map follows it");
  type(doc, "hub-map", "");
  check(!m.pin(), "clearing the link takes the pin away");
  check(exists(doc, '[data-testid="map-pick-hint"]'), "and the map asks for a tap again");
  type(doc, "hub-map", "https://maps.app.goo.gl/AbC123");
  check(sel(doc, '[data-testid="map-preview-shared"]').textContent.indexOf("tap the map to drop the pin instead") >= 0,
        "a share link can’t be shown, so the map offers a tap instead");
  tap(m, 12.909, 77.605);
  eq($(doc, "hub-map").value, "https://maps.google.com/?q=12.909,77.605", "and a tap replaces it with the pin");

  A.addPincodes("560076");
  doHubDetails(doc, { pin: null, map: $(doc, "hub-map").value });
  check(H.R().hub.submitted, "hub details submits with the tapped pin");
  eq(H.R().hub.mapLink, "https://maps.google.com/?q=12.909,77.605", "keeping it");
  check(m.removed && H.liveMaps().length === 0, "the summary has no map, and the last one is let go");
  A.mapPick("hub-map", 12.95, 77.6);
  eq(H.R().hub.mapLink, "https://maps.google.com/?q=12.909,77.605", "a stray tap after submitting changes nothing");

  /* --- the captain asks to move a live hub's pin --- */
  A.logout();
  devClick(doc, "as:existing");
  login(doc);
  A.hubEditOpen("hub-aqt");
  m = mapAt("#he-map-preview");
  check(!!m && !!m.handlers.click, "Edit hub details in the Captain Hub has a map to tap");
  eq(where(m.pin()), [12.9349, 77.6251], "opening on the hub’s current pin");
  check(m.pin().opts.draggable, "which can be dragged");
  tap(m, 12.93387, 77.62133);
  eq($(doc, "he-map").value, "https://maps.google.com/?q=12.93387,77.62133", "a tap fills the link");
  eq(api.state.panel.hubEdit.draft.mapLink, "https://maps.google.com/?q=12.93387,77.62133", "and the draft");
  check(exists(doc, '#he-map-preview [data-testid="map-pin-ok"]'), "checked against the hub’s pincode, 560034");
  click(doc, "he-submit");
  const sent = api.state.hubEdits[api.state.hubEdits.length - 1];
  eq([sent.hubId, sent.after.mapLink], ["hub-aqt", "https://maps.google.com/?q=12.93387,77.62133"],
     "the edit sent to the Area Manager carries the tapped pin");

  /* --- the Area Manager --- */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');

  // View hub: the pin can be looked at, not moved
  A.adminTab("edits");
  A.adminHubOpen("nh-whf");
  const vm = mapAt('[data-testid="ap-hub-view"]');
  check(!!vm && !vm.handlers.click, "View hub shows the pin on a map that takes no taps");
  check(!!vm.pin() && !vm.pin().opts.draggable, "and whose pin can’t be dragged");
  const whf = H.allHubById("nh-whf").mapLink;
  A.mapPick("ah-map", 12.97, 77.75);
  eq(H.allHubById("nh-whf").mapLink, whf, "a pick with no editor open changes nothing");

  // editing the live hub: a tap fills the coordinates
  click(doc, "ah-edit");
  const em = mapAt("#ah-map-preview");
  check(vm.removed, "opening the editor lets the view map go");
  check(!!em && !!em.handlers.click && em.pin().opts.draggable, "the editor’s map takes a tap or a drag");
  tap(em, 12.96946, 77.75299);
  eq($(doc, "ah-map").value, "12.96946, 77.75299", "a tap fills the hub coordinates as latitude, longitude");
  eq(api.state.admin.hubDraft.coords, "12.96946, 77.75299", "in the draft too");
  drag(em, 12.9701, 77.7512);
  eq($(doc, "ah-map").value, "12.9701, 77.7512", "dragging the pin updates them");
  check(exists(doc, '#ah-map-preview [data-testid="map-pin-ok"]'), "inside the hub’s pincode, 560066");
  click(doc, "ah-save");
  eq(H.allHubById("nh-whf").mapLink, "https://maps.google.com/?q=12.9701,77.7512", "saved to the hub as a Maps link");
  check(api.state.amChanges.some((c) => c.hubId === "nh-whf" && c.fields.indexOf("mapLink") >= 0),
        "and the captain is told");

  // correcting the pin on an onboarding request
  A.adminTab("mine");
  A.adminOpen("OBD-78219");
  click(doc, "ap-map-edit");
  const am = mapAt("#ap-map-preview");
  check(!!am && !!am.handlers.click, "the pin correction on a request has a map to tap");
  tap(am, 12.90992, 77.60313);
  eq($(doc, "ap-map").value, "https://maps.google.com/?q=12.90992,77.60313", "a tap fills the link");
  click(doc, "ap-map-save");
  eq(H.apMapLink(H.apById("OBD-78219")), "https://maps.google.com/?q=12.90992,77.60313",
     "and Save applies it as the Area Manager’s correction");
  check(exists(doc, '[data-testid="ap-map-updated"]'), "tagged AM updated");

  // a captain's requested pin, under review: looked at, not moved
  A.adminTab("edits");
  const withPin = api.state.hubEdits.find((e) => e.status === "pending" &&
    H.hubEditChanged(e).some((f) => f.id === "mapLink"));
  A.adminEditOpen(withPin.id);
  const rm = mapAt('[data-testid="ap-edit-detail"]');
  check(!!rm && !rm.handlers.click && !rm.pin().opts.draggable,
        "a requested pin under review can be looked at, not moved");

  const open = L.maps.filter((x) => !x.removed);
  eq(open.length, doc.querySelectorAll(".map-frame").length, "every map on screen is mounted once");
  eq(H.liveMaps().length, open.length, "and every map a render replaced has been let go");

  /* --- without Leaflet a pick still lands; the pin shows on Google's embed --- */
  const plain = await boot();
  login(plain.doc);
  pickRole(plain.doc, "FM");
  doPersonalDetails(plain.doc);
  doKyc(plain.doc, "FM");
  plain.api.actions.typeHubPincode("560076");
  plain.api.actions.mapPick("hub-map", 12.9101, 77.6071);
  eq($(plain.doc, "hub-map").value, "https://maps.google.com/?q=12.9101,77.6071", "without Leaflet a pick still fills the field");
  const frame = sel(plain.doc, "#hub-map-preview iframe");
  check(!!frame && frame.getAttribute("src").indexOf("q=12.9101,77.6071") >= 0, "and Google’s embed shows the pin");
  check(exists(plain.doc, '[data-testid="map-pin-ok"]'), "checked inside 560076");
  plain.api.stopTimers();
  plain.win.close();

  api.stopTimers();
  win.close();
}

/* =========================================================================
   34. Central slabs, Central Admin's three roles, and bulk rate card updates
   ====================================================================== */

async function testCentralRates() {
  section("34. Slab settings, Central Admin roles and bulk rate card updates");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;
  const today = H.todayIso();
  const fire = (el, ev) => el.dispatchEvent(new win.Event(ev, { bubbles: true }));

  devClick(doc, "as:existing");
  login(doc);
  A.logout();
  devClick(doc, "as:admin");
  login(doc);

  /* --- slabs: five, in steps of 2,500, for every hub type --- */
  eq(C.DEFAULT_SLAB_BREAKS, [2500, 5000, 7500, 10000], "every hub type starts on five slabs, 2,500 orders apart");
  check(["standalone_mini", "standalone", "lm_as_fm", "mall", "sah"].every(k => H.slabBreaks(k).join() === "2500,5000,7500,10000"),
        "the same for all five hub types");

  /* --- Central Admin asks which role is signed in --- */
  clickSel(doc, '[data-aprole="central"]');
  check(exists(doc, '[data-testid="ap-central-pick"]'), "Central Admin opens on a role prompt");
  check(!exists(doc, "[data-aptab]"), "with no tabs until a role is picked");
  devClick(doc, "ca:ops");
  check(txt(doc).indexOf("Central Admin · FM Central Ops") >= 0, "the simulator signs in FM Central Ops");
  check(!/Tajinder|Roopesh|Vidhi|Agrim|Adrija/.test(doc.documentElement.outerHTML),
        "and no real person is named anywhere in the tool");

  /* --- FM Central Ops proposes a slab change; BizFin approves it --- */
  A.adminTab("slabs");
  eq(doc.querySelectorAll('[data-testid="slab-set-row"]').length, 5, "slab settings shows the five slabs");
  const to0 = () => sel(doc, '[data-slabto="0"]');
  to0().value = "2000"; fire(to0(), "input"); fire(to0(), "change");
  sel(doc, '[data-slabto="1"]').value = "1500"; fire(sel(doc, '[data-slabto="1"]'), "input");
  click(doc, "slab-submit");
  check(sel(doc, '[data-testid="slab-error"]').textContent.indexOf("end above the one before it") >= 0,
        "slabs have to rise");
  click(doc, "slab-reset");
  click(doc, "slab-submit");
  check(sel(doc, '[data-testid="slab-error"]').textContent.indexOf("already in use") >= 0, "an unchanged structure isn’t sent");
  click(doc, "slab-add");
  eq(doc.querySelectorAll('[data-testid="slab-set-row"]').length, 6, "＋ Add slab adds one 2,500 orders above the last");
  eq(sel(doc, '[data-slabto="4"]').value, "12500", "ending at 12,500");
  clickSel(doc, '[data-slabrm="0"]');
  eq(doc.querySelectorAll('[data-testid="slab-set-row"]').length, 5, "removing one folds it into the next");
  click(doc, "slab-submit");
  const req = api.state.slabSettings.requests[0];
  check(!!req && req.status === "pending" && req.by === "FM Central Ops", "FM Central Ops’ change goes to BizFin");
  eq(req.breaks, [5000, 7500, 10000, 12500], "carrying the new slabs");
  eq(req.types, ["standalone_mini"], "for the hub type being edited");
  eq(H.slabBreaks("standalone_mini"), [2500, 5000, 7500, 10000], "nothing changes until BizFin approves");
  check(disabled(doc, "slab-submit"), "and FM Central Ops can’t send another while it waits");
  devClick(doc, "ca:bizfin");
  eq(sel(doc, '[data-aptab="slabs"]').textContent, "Slab settings (1)", "BizFin’s Slab settings tab counts it");
  A.adminTab("slabs");
  clickSel(doc, '[data-slabdecide="reject:' + req.id + '"]');
  check(sel(doc, '[data-testid="slab-error"]').textContent.indexOf("Say why") >= 0, "rejecting needs a reason");
  clickSel(doc, '[data-slabdecide="approve:' + req.id + '"]');
  eq(req.status, "approved", "BizFin approves it");
  eq(H.slabBreaks("standalone_mini"), [5000, 7500, 10000, 12500], "and the mini-hub slabs change");
  eq(H.slabBreaks("standalone"), [2500, 5000, 7500, 10000], "only for that hub type");
  eq(api.state.slabSettings.log[0].approvedBy, "BizFin", "logged with who approved it");

  /* BizFin can change a structure directly, for every hub type at once */
  clickSel(doc, '[data-slabtype="lm_as_fm"]');
  click(doc, "slab-add");
  $(doc, "slab-all").checked = true; fire($(doc, "slab-all"), "change");
  click(doc, "slab-submit");
  check(api.state.admin.toast.indexOf("Slab structure saved") >= 0, "BizFin saves it straight away");
  check(["standalone_mini", "standalone", "lm_as_fm", "mall", "sah"].every(k => H.slabBreaks(k).join() === "2500,5000,7500,10000,12500"),
        "applied to every hub type — six slabs now");
  clickSel(doc, '[data-slabtype="standalone"]');
  clickSel(doc, '[data-slabrm="4"]');
  click(doc, "slab-submit");
  eq([H.slabBreaks("standalone"), H.slabBreaks("mall").length], [[2500, 5000, 7500, 10000], 5],
     "or to one hub type — Standalone back to five, the rest on six");
  eq(api.state.slabSettings.log.length, 3, "every change is logged");

  /* new cards are priced on it; cards already priced keep theirs */
  eq(H.allHubById("nh-whf").rateCard.slabs.length, 5, "a hub’s card in force keeps its slabs");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  A.adminTab("rates");
  clickSel(doc, '[data-aprate="nh-whf"]');
  eq(doc.querySelectorAll('[data-rfield="rate"]').length, 6, "an update to it is priced on the new slabs");
  eq(sel(doc, '[data-rslab="5"][data-rfield="rate"]').value, "4.80", "each starting from the rate its orders had before");
  A.adminRateBack();
  A.adminTab("mine");
  A.adminOpen("OBD-78240");
  A.amStep("rate");
  A.amCategory("mall");
  eq(H.apById("OBD-78240").rate.slabs.length, 6, "and so is a new onboarding rate card");
  check(!exists(doc, '[data-field="from"]'), "with the bands fixed for the AM");

  /* --- FM Central Ops acts on AM and CH steps --- */
  A.adminSwitchRole();
  asCentral(doc, "ops");
  eq(C.CENTRAL_TABS.ops.map(t => t.id), ["am", "ch", "rates", "bulk", "slabs"], "FM Central Ops’ tabs");
  eq(api.state.admin.tab, "am", "opening on AM pendency");
  A.adminTab("am");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("AM verification · step 1 of 3") >= 0 && exists(doc, "[data-gate]"),
        "it can work an Area Manager’s step");
  check(!!H.apById("OBD-78222").hubCode, "picking it up assigns the hub code, as the AM would");
  A.adminBack();
  A.adminTab("ch");
  clickSel(doc, '[data-apopen="OBD-78219"]');
  check(txt(doc).indexOf("CH review · approve request") >= 0, "and a Cluster Head’s");
  A.adminBack();
  A.adminTab("rates");
  clickSel(doc, '[data-apru="RCU-51144"]');
  check(exists(doc, "#ap-ru-approve"), "it decides rate card updates with the Cluster Head");
  click(doc, "ap-ru-approve");
  const elc = H.rateUpdateById("RCU-51144");
  eq(elc.status, "zh", "approving one at the CH step sends it to the ZH");
  clickSel(doc, '[data-apru="RCU-51144"]');
  check(exists(doc, "#ap-ru-approve"), "where FM Central Ops can decide it too");
  click(doc, "ap-ru-approve");
  eq([elc.status, elc.approvedBy], ["captain", "ops"], "approving it there sends it to the captain");
  check(elc.trail.some(x => x.by === "ops" && x.what === "approved"), "logged as FM Central Ops");

  /* --- bulk rate card updates --- */
  A.adminTab("bulk");
  check(exists(doc, '[data-testid="ap-bulk"]'), "FM Central Ops has a bulk rate update");
  const codes = $(doc, "ap-bulk-codes");
  codes.value = "KRM, BOM, WHF, YLK, DML, AQT, XYZ, KRM"; fire(codes, "input");
  check(H.bulkPlan(api.state.admin.bulk).codes.join() === "KRM,BOM,WHF,YLK,DML,AQT,XYZ", "comma separated codes, once each");
  const plan = () => [...doc.querySelectorAll('[data-testid="bulk-row"]')].reduce((o, r) => {
    o[r.getAttribute("data-code")] = r.getAttribute("data-result"); return o; }, {});
  const why = (code) => sel(doc, '[data-testid="bulk-row"][data-code="' + code + '"]').textContent;
  eq(doc.querySelectorAll('[data-bulkrate]').length, 5, "the new card is priced on the listed hubs’ slabs");
  check(why("YLK").indexOf("Not onboarded through the tool yet") >= 0, "a hub not onboarded through the tool is left out");
  check(why("XYZ").indexOf("No hub with this code") >= 0, "an unknown code is left out");
  check(why("DML").indexOf("already in review") >= 0, "a hub with an update in review is left out");
  check(why("AQT").indexOf("Not an FM hub") >= 0, "an LM hub is left out");
  check(why("WHF").indexOf("different slab structure") >= 0, "a hub type on other slabs is left out");
  check(!exists(doc, "#ap-bulk-tp"), "there is no touchpoint to set — each hub keeps its type’s");
  ["3.50", "3.45", "3.40", "3.35", "3.30"].forEach((v, i) => {
    const el = sel(doc, '[data-bulkrate="' + i + '"]'); el.value = v; fire(el, "input"); });
  eq([plan().KRM, plan().BOM], ["publish", "publish"], "within their ceilings (3.50 in Bengaluru) they go straight to the captains");
  $(doc, "ap-bulk-from").value = H.addDaysIso(today, -1); fire($(doc, "ap-bulk-from"), "change");
  click(doc, "ap-bulk-go");
  check(sel(doc, '[data-testid="bulk-error"]').textContent.indexOf("never backdated") >= 0, "a past date is refused");
  $(doc, "ap-bulk-from").value = H.addDaysIso(today, 2); fire($(doc, "ap-bulk-from"), "change");
  eq($(doc, "ap-bulk-go").textContent, "Send to 2 captains", "the button says what will happen");
  click(doc, "ap-bulk-go");
  const bulk = api.state.bulkUpdates[api.state.bulkUpdates.length - 1];
  eq([bulk.published, bulk.toBizFin, bulk.excluded.map(x => x.code)],
     [["KRM", "BOM"], [], ["WHF", "YLK", "DML", "AQT", "XYZ"]], "the bulk update is logged with what happened to each");
  const krmU = api.state.rateUpdates.filter(u => u.bulkId === bulk.id && u.hubCode === "KRM")[0];
  eq([krmU.status, krmU.effectiveFrom], ["captain", H.addDaysIso(today, 2)],
     "within the ceilings: no internal approval needed — straight to the captain");
  check(api.state.rateNotices.some(n => n.ref === krmU.id && n.captain === "Sunil Rao"), "who is asked to agree");
  H.captainAgree(krmU);
  eq(H.ruPhase(krmU), "scheduled", "and once he does, it’s published for its day");
  eq(krmU.to.touchpoint, "5.00", "on the touchpoint fixed for Standalone");
  check(sel(doc, '[data-testid="bulk-log"]').textContent.indexOf(bulk.id) >= 0, "listed under recent bulk updates");

  /* above a hub's ceilings it goes to BizFin first */
  $(doc, "ap-bulk-codes").value = "JPN"; fire($(doc, "ap-bulk-codes"), "input");
  ["3.30", "3.20", "3.10", "3.00", "2.90", "2.80"].forEach((v, i) => {
    const el = sel(doc, '[data-bulkrate="' + i + '"]'); el.value = v; fire(el, "input"); });
  eq(plan().JPN, "bizfin", "3.30 is above the mini-hub’s ceiling, so it goes to BizFin");
  click(doc, "ap-bulk-go");
  const jpnU = api.state.rateUpdates.filter(u => u.source === "bulk" && u.hubCode === "JPN")[0];
  eq(jpnU.status, "central", "waiting for BizFin");
  check(!api.state.rateNotices.some(n => n.ref === jpnU.id), "the captain hears nothing yet");
  devClick(doc, "ca:bizfin");
  A.adminTab("rates");
  clickSel(doc, '[data-apru="' + jpnU.id + '"]');
  check(txt(doc).indexOf("Bulk update " + jpnU.bulkId + " by FM Central Ops") >= 0, "BizFin sees it came in bulk");
  click(doc, "ap-ru-reject");
  type(doc, "ap-ru-reason", "Too high for JP Nagar’s volumes.");
  click(doc, "ap-ru-reject");
  eq(jpnU.status, "rejected", "BizFin can decline a bulk update — there is no Area Manager to send it back to");
  eq(H.rateUpdateFor("nh-jpn"), null, "and the hub stays on its card in force");

  /* --- an older save, from when captains agreed to updates --- */
  const KEY = "valmo.captain.onboarding.v1";
  const saved = JSON.parse(win.localStorage.getItem(KEY));
  const old = saved.rateUpdates.filter(u => u.hubId === "nh-btm")[0];
  old.status = "agreed"; old.agreedOn = "10 Oct 2026"; delete old.version; delete old.effectiveFrom;
  const waiting = saved.rateUpdates.filter(u => u.hubId === "nh-elc")[0];
  waiting.status = "captain";
  saved.slabSettings = undefined; saved.rateNotices = undefined;
  win.localStorage.setItem(KEY, JSON.stringify(saved));
  check(api.reload(), "an older save still loads");
  const migrated = H.rateUpdateById(old.id);
  eq([migrated.status, migrated.effectiveFrom], ["published", "2026-10-10"],
     "an update its captain had agreed to is published from the day they agreed");
  check(H.rateVersions(H.allHubById("nh-btm")).some(v => v.ref === old.id), "as the hub’s next version");
  eq(H.rateUpdateById(waiting.id).status, "captain", "one still waiting on its captain keeps waiting");
  eq(H.slabBreaks("standalone"), [2500, 5000, 7500, 10000], "and the slab settings start from the default");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   35. FM without GST — a deliberate choice the Area Manager approves
   ====================================================================== */

/* Onboarding up to the GST card, the FM way. */
function kycToGst(doc) {
  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  click(doc, "kyc-ack-aadhaar");
  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  click(doc, "kyc-ack-pan");
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  click(doc, "kyc-ack-bank");
}
/* "Don't have GST?", a reason, the confirmation. */
function declareNoGst(doc, win, reason, confirm) {
  click(doc, "kyc-nogst-open");
  const r = $(doc, "kyc-nogst-reason");
  r.value = reason; r.dispatchEvent(new win.Event("change", { bubbles: true }));
  $(doc, "kyc-nogst-confirm").checked = !!confirm;
  click(doc, "kyc-nogst-go");
}

async function testNoGst() {
  section("35. FM without GST — a deliberate choice the Area Manager approves");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;
  const reason = C.NO_GST_REASONS[0];

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  kycToGst(doc);
  eq(H.kycStep(H.R()), "gst", "at the GST card");
  check(!exists(doc, "[data-gstchoice]") && txt(doc).indexOf("Non-GST") === -1, "no Non-GST option is shown");

  /* the deliberate path */
  click(doc, "kyc-nogst-open");
  check(exists(doc, '[data-testid="kyc-nogst"]'), "Don’t have GST? opens a declaration");
  check(!exists(doc, "#kyc-gstin"), "in place of the GSTIN field");
  check(txt(doc).indexOf("Your Area Manager has to approve this") >= 0 &&
        txt(doc).indexOf("goes live only after your Area Manager approves") >= 0,
        "saying the Area Manager has to approve it");
  check(devText(doc).indexOf("GST portal") === -1 && devText(doc).indexOf("GSTIN check") === -1,
        "and the simulator offers no GSTIN check — none is made");
  eq([...$(doc, "kyc-nogst-reason").options].map(o => o.value).slice(1), C.NO_GST_REASONS, "with the reasons to pick from");
  click(doc, "kyc-nogst-go");
  check(txt(doc).indexOf("Pick why you don’t have GST.") >= 0, "a reason is required");
  check(txt(doc).indexOf("Tick the box to confirm you don’t have GST.") >= 0, "and the confirmation");
  check(!H.R().kyc.gst.done, "so nothing is recorded yet");
  click(doc, "kyc-nogst-cancel");
  check(exists(doc, "#kyc-gstin") && !exists(doc, '[data-testid="kyc-nogst"]'), "I have a GSTIN goes back");
  declareNoGst(doc, win, reason, false);
  eq($(doc, "kyc-nogst-reason").value, reason, "a picked reason survives a failed attempt");
  check(txt(doc).indexOf("Tick the box") >= 0, "the confirmation alone still holds it up");
  $(doc, "kyc-nogst-confirm").checked = true;
  click(doc, "kyc-nogst-go");

  const g = () => H.R().kyc.gst;
  eq([g().registered, g().done, g().noGst.reason, g().noGst.decision], [false, true, reason, null],
     "recorded as no GST, with the reason, waiting on the Area Manager");
  eq(H.kycStep(H.R()), "complete", "KYC completes");
  check(sel(doc, '[data-testid="kyc-gst-row"]').textContent.indexOf("No GST · Awaiting Area Manager approval") >= 0,
        "the summary says where it stands");
  check(!disabled(doc, "kyc-continue"), "and the captain carries on");
  click(doc, "kyc-continue");
  eq(H.phaseId(), "hub", "to hub details");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
  A.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(H.phaseId(), "ch", "and on to the review");

  /* the Area Manager's call comes first */
  check(txt(doc).indexOf("Area Manager is checking your request to continue without GST") >= 0,
        "the captain sees the Area Manager reviewing it");
  check(devText(doc).indexOf("Area Manager · no-GST declaration") >= 0, "the simulator offers the AM’s call");
  check(devText(doc).indexOf("pick hub type") === -1, "before the hub type");
  A.chSetCategory("standalone");
  eq(H.R().ch.category, null, "and no hub type can be set until it’s decided");
  devClick(doc, "nogst:approve");
  eq(g().noGst.decision, "approved", "approved");
  check(txt(doc).indexOf("Continuing without GST approved") >= 0, "the captain sees it approved");
  check(devText(doc).indexOf("pick hub type") >= 0, "and the review carries on to the hub type");
  A.chSetCategory("standalone");
  A.amSubmitRate(false);
  A.chApprove();
  click(doc, "ch-continue");
  doAgreements(doc, api);
  await waitFor(win, () => H.R().act.status === "active", "FM activation without GST");
  const hub = api.state.hubs[api.state.hubs.length - 1];
  eq([hub.gst.registered, hub.gst.noGst && hub.gst.noGst.decision], [false, "approved"],
     "the hub goes live without GST, the approval on record");
  api.stopTimers();
  win.close();

  /* --- declined: a GSTIN on the review screen, then on --- */
  const b = await boot();
  login(b.doc);
  pickRole(b.doc, "FM");
  doPersonalDetails(b.doc);
  kycToGst(b.doc);
  declareNoGst(b.doc, b.win, C.NO_GST_REASONS[1], true);
  click(b.doc, "kyc-continue");
  doHubDetails(b.doc, { address: "Plot 7, Bommasandra" });
  click(b.doc, "hub-continue");
  b.api.actions.bgvSet("passed");
  click(b.doc, "bgv-continue");
  devClick(b.doc, "nogst:decline");
  check(exists(b.doc, '[data-testid="nogst-declined"]'), "a decline asks the captain for a GSTIN");
  check(txt(b.doc).indexOf("Your Area Manager needs a GSTIN for this hub") >= 0, "saying why");
  check(devText(b.doc).indexOf("Waiting for the captain to add a GSTIN") >= 0, "the simulator waits on the captain");
  type(b.doc, "ch-gstin", "29AAJFS4321M1ZQ");
  click(b.doc, "ch-gstin-go");
  check(txt(b.doc).indexOf(b.api.errors.gstName) >= 0, "the GSTIN is checked as on KYC — someone else’s is refused");
  type(b.doc, "ch-gstin", "29ABCDE1234F1Z5");
  click(b.doc, "ch-gstin-go");
  const bg = b.api.helpers.R().kyc.gst;
  eq([bg.registered, bg.gstin, bg.noGst], [true, "29ABCDE1234F1Z5", undefined], "a verified GSTIN settles it");
  check(exists(b.doc, '[data-testid="waiting-category"]'), "and the review carries on");
  check(devText(b.doc).indexOf("pick hub type") >= 0, "to the hub type");
  b.api.stopTimers();
  b.win.close();

  /* --- a GSTIN found later, from the KYC summary, replaces the declaration --- */
  const c = await boot();
  login(c.doc);
  pickRole(c.doc, "FM");
  doPersonalDetails(c.doc);
  kycToGst(c.doc);
  declareNoGst(c.doc, c.win, reason, true);
  c.api.actions.kycReopen("gst");
  check(exists(c.doc, "#kyc-gstin"), "reopening GST shows the GSTIN field");
  type(c.doc, "kyc-gstin", "29ABCDE1234F1Z5");
  click(c.doc, "kyc-gst-go");
  eq([c.api.helpers.R().kyc.gst.registered, c.api.helpers.R().kyc.gst.noGst], [true, undefined],
     "verifying one drops the no-GST declaration");
  c.api.stopTimers();
  c.win.close();

  /* --- the Area Manager's review in the admin panel --- */
  const d = await boot();
  devClick(d.doc, "as:admin");
  login(d.doc);
  clickSel(d.doc, '[data-aprole="am"]');
  clickSel(d.doc, '[data-apopen="OBD-78231"]');
  const req = () => d.api.helpers.apById("OBD-78231");
  check(sel(d.doc, '[data-testid="ap-gst-row"]').textContent.indexOf("No GST · Awaiting Area Manager approval") >= 0,
        "the context card says the captain has no GST");
  check(exists(d.doc, '[data-testid="am-nogst"]'), "the infra check carries a Continuing without GST row");
  check(sel(d.doc, '[data-testid="am-nogst"]').textContent.indexOf("My turnover is below the GST threshold") >= 0,
        "with the captain’s reason");
  d.api.config.AM_GATES.forEach(x => d.api.actions.amGate(x.id, "yes"));
  clickSel(d.doc, '[data-vehreview="yes"]');
  check(disabled(d.doc, "am-to-design"), "every gate passed, it still waits on the GST call");
  clickSel(d.doc, '[data-nogst="no"]');
  eq(req().noGst.decision, "declined", "declining is recorded");
  check(sel(d.doc, '[data-testid="am-nogst"]').textContent.indexOf("The captain is asked to add a GSTIN") >= 0,
        "and says the captain is asked for a GSTIN");
  check(disabled(d.doc, "am-to-design"), "the request waits");
  check(!exists(d.doc, "#ap-reject"), "a decline isn’t a failed hard gate — nothing to reject");
  check(devText(d.doc).indexOf("Captain adds a GSTIN") >= 0, "the simulator can stand in for the captain");
  clickSel(d.doc, '[data-nogst="yes"]');
  eq(req().noGst.decision, "approved", "the AM can change their mind and approve");
  check(!disabled(d.doc, "am-to-design"), "which opens the next step");
  clickSel(d.doc, '[data-nogst="no"]');
  devClick(d.doc, "nogst:gstin");
  eq(req().noGst, null, "once the captain adds a GSTIN the declaration is gone");
  check(sel(d.doc, '[data-testid="ap-gst-row"]').textContent.indexOf("GSTIN verified") >= 0, "the context card follows");
  check(!exists(d.doc, '[data-testid="am-nogst"]') && !disabled(d.doc, "am-to-design"), "and the AM carries on");
  d.api.stopTimers();
  d.win.close();

  /* --- an existing captain adding an FM hub without GST --- */
  const e = await boot();
  e.api.state.loginAs = "existing";
  e.api.helpers.seedExistingCaptain();
  login(e.doc);
  e.api.actions.openPanel("hubs", "hubs");
  e.api.actions.addHubOpen();
  e.api.actions.addHubRole("FM");
  click(e.doc, "addhub-nogst");
  const er = $(e.doc, "addhub-nogst-reason");
  er.value = C.NO_GST_REASONS[2]; er.dispatchEvent(new e.win.Event("change", { bubbles: true }));
  $(e.doc, "addhub-nogst-confirm").checked = true;
  click(e.doc, "addhub-go");
  eq(e.api.helpers.phaseId(), "hub", "with a reason and the confirmation it goes on to hub details");
  const eg = e.api.helpers.R().kyc.gst;
  eq([eg.registered, eg.noGst.reason, eg.noGst.decision], [false, "Other", null],
     "carrying the declaration for the Area Manager to review");
  e.api.stopTimers();
  e.win.close();
}

/* =========================================================================
   36. Who each request and update is pending with — AM, CH and ZH
   ====================================================================== */

async function testHierarchy() {
  section("36. AM and CH pendency, and who a rate card update waits on");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions, C = api.config;
  const setSelect = (id, v) => { const el = $(doc, id); el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const ids = () => [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  const pendingWith = (id) => sel(doc, '[data-apopen="' + id + '"]').closest("tr")
    .querySelector('[data-testid="ap-pending-with"]').textContent;

  /* the sample hierarchy */
  eq(Object.keys(C.AREA_MANAGERS).length, 4, "four Area Managers");
  eq([H.chainOf("mumbai").ch.name, H.chainOf("mumbai").zh.name], ["Vikas Patil", "Sameer Kulkarni"],
     "each reporting to a Cluster Head, and on to a Zonal Head");
  eq(H.chainOf("").am.name, "Priya Sharma", "work with no AM set is the signed-in AM’s");

  devClick(doc, "as:admin");
  login(doc);

  /* --- FM Central Ops: AM and CH pendency, no national view --- */
  asCentral(doc, "ops");
  check(!exists(doc, '[data-aptab="all"]'), "there is no national view");
  eq(api.state.admin.tab, "am", "Central Ops opens on AM pendency");
  const amIds = api.state.adminRequests.filter(r => r.stage === "am").map(r => r.id);
  eq(ids().sort(), amIds.sort(), "every request at an AM’s step, across the network");
  check(exists(doc, '[data-testid="ap-pending-with"]'), "with a Pending with column");
  check(pendingWith("OBD-78288").indexOf("Farah Shaikh · AM") >= 0 &&
        pendingWith("OBD-78288").indexOf("CH Vikas Patil · ZH Sameer Kulkarni") >= 0,
        "naming the AM it waits on, with their CH and ZH beneath");
  setSelect("ap-f-am", "blr-west");
  eq(ids(), ["OBD-78274"], "filtered to one Area Manager");
  setSelect("ap-f-am", "all");
  setSelect("ap-f-zh", "west");
  eq(ids(), ["OBD-78288"], "or to one Zonal Head’s zone");
  setSelect("ap-f-zh", "all");

  A.adminTab("ch");
  check(ids().indexOf("OBD-78263") >= 0, "CH pendency keeps what’s gone on to BizFin");
  check(pendingWith("OBD-78263").indexOf("BizFin") >= 0, "marked as with BizFin");
  check(pendingWith("OBD-78292").indexOf("Vikas Patil · CH") >= 0 && pendingWith("OBD-78292").indexOf("AM Farah Shaikh") >= 0,
        "a CH row names the CH, then the AM and ZH");
  setSelect("ap-f-ch", "blr-west");
  eq(ids(), ["OBD-78281"], "filtered to one Cluster Head");
  check(!exists(doc, "#ap-f-am"), "the CH tab filters by CH, not AM");
  setSelect("ap-f-ch", "all");

  /* --- rate card updates: who it waits on, the chain on demand --- */
  A.adminTab("rates");
  const row = (id) => sel(doc, '[data-testid="ap-ru-row"][data-ru="' + id + '"]');
  check(exists(doc, '[data-testid="ap-ru-filters"]') && exists(doc, "#ap-ru-am") && exists(doc, "#ap-ru-ch") &&
        exists(doc, "#ap-ru-zh"), "filters by AM, CH and ZH above the list");
  check(!sel(doc, ".ap-table thead").textContent.match(/Area Manager|Cluster Head|Zonal Head/),
        "and no column for any of them");
  check(row("RCU-51160").querySelector('[data-testid="ru-waiting-on"]').textContent.indexOf("With ZHPriya Nair") >= 0,
        "the status names the one person it waits on");
  check(!exists(doc, '[data-testid="ap-ru-expanded"]'), "the chain is closed by default");
  clickSel(doc, '[data-ruexp="RCU-51160"]');
  const exp = sel(doc, '[data-testid="ap-ru-expanded"][data-ru="RCU-51160"]');
  check(!!exp && exp.textContent.indexOf("Meena Iyer") >= 0 && exp.textContent.indexOf("Anita Rao") >= 0 &&
        exp.textContent.indexOf("Priya Nair") >= 0, "the chevron opens the AM, CH and ZH");
  eq(exp.querySelector(".hier-cell.on").getAttribute("data-desk"), "zh", "with the desk it waits on marked");
  check(exp.textContent.indexOf("+91 99860 22451") >= 0, "and their phone numbers");
  clickSel(doc, '[data-ruexp="RCU-51160"]');
  check(!exists(doc, '[data-testid="ap-ru-expanded"]'), "a second click closes it");
  setSelect("ap-ru-ch", "blr-east");
  check(!row("RCU-51160") && !!row("RCU-51130"), "filtering by Cluster Head narrows the list");
  setSelect("ap-ru-ch", "all");
  clickSel(doc, '[data-apru="RCU-51160"]');
  check(exists(doc, '[data-testid="ru-review-hierarchy"]') &&
        sel(doc, '[data-testid="ru-review-hierarchy"] .hier-cell.on').getAttribute("data-desk") === "zh",
        "the update’s own page carries the hierarchy card");
  A.adminRuBack();

  /* BizFin sees who raised it */
  A.adminSwitchRole();
  asCentral(doc, "bizfin");
  A.adminTab("rates");
  check(row("RCU-51168").querySelector('[data-testid="ru-waiting-on"]').textContent.indexOf("With BizFin") >= 0,
        "BizFin’s list says it’s with BizFin");
  clickSel(doc, '[data-ruexp="RCU-51168"]');
  check(sel(doc, '[data-testid="ap-ru-expanded"]').textContent.indexOf("Farah Shaikh") >= 0,
        "and opens on Mumbai’s AM, CH and ZH");

  /* --- each desk sees only its own patch --- */
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  A.adminTab("am");
  check(ids().indexOf("OBD-78270") >= 0 && ids().indexOf("OBD-78274") === -1 && ids().indexOf("OBD-78288") === -1,
        "the Cluster Head sees their own AMs’ requests, not another cluster’s");
  A.adminTab("rates");
  check(!row("RCU-51160"), "nor another cluster’s rate card updates");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="zh"]');
  check(ids().indexOf("OBD-78274") >= 0 && ids().indexOf("OBD-78288") === -1,
        "the Zonal Head sees their zone, not another");
  check(pendingWith("OBD-78274").indexOf("Meena Iyer · AM") >= 0, "with who each one waits on");
  A.adminTab("rates");
  check(!!row("RCU-51160") && !!row("RCU-51160").querySelector(".btn-primary"),
        "the Zonal Head reviews rate card updates their Cluster Heads approved");
  check(!row("RCU-51168"), "only in their own zone");
  clickSel(doc, '[data-apru="RCU-51160"]');
  click(doc, "ap-ru-reject");
  check(txt(doc).indexOf("Say why you’re sending it back") >= 0, "sending one back needs a reason");
  type(doc, "ap-ru-reason", "Hold the MG Road rates until the mall’s lease renews.");
  click(doc, "ap-ru-reject");
  const mgr = H.rateUpdateById("RCU-51160");
  eq([mgr.status, mgr.rejectedBy], ["revision", "zh"], "the Zonal Head sends it back to the Area Manager");
  A.adminTab("am");
  A.adminSwitchRole();
  clickSel(doc, '[data-aprole="am"]');
  check(ids().indexOf("OBD-78270") === -1, "the Area Manager sees only their own requests");
  A.adminTab("rates");
  check(!exists(doc, '[data-ratehub="nh-pny"]'), "and only their own hubs");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   37. Sample notifications — one of every kind on the existing captain's bell
   ====================================================================== */

async function testSampleNotes() {
  section("37. Sample notifications — every scenario on the existing captain’s bell");
  const { win, doc, api } = await boot();
  const H = api.helpers, A = api.actions;
  const notes = () => [...doc.querySelectorAll("[data-note]")];
  const note = (id) => sel(doc, '[data-note$=":' + id + '"]');

  devClick(doc, "as:existing");
  login(doc);
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "5", "the existing captain’s bell has five notifications");
  click(doc, "bell");
  eq(notes().map(n => n.getAttribute("data-note").split(":")[0]),
     ["rateagree", "amchange", "amchange", "edit", "edit"], "one of every kind");
  check(note("RCU-50961").textContent.indexOf("Rate card update to agree · Kudlu Gate Hub (KDG)") >= 0 &&
        note("RCU-50961").classList.contains("act"), "a rate card update to agree to, marked as needing action");
  check(note("AMC-30090").textContent.indexOf("Hub details updated · Kudlu Gate Hub") >= 0 &&
        note("AMC-30090").textContent.indexOf("max vehicle size") >= 0, "hub details the Area Manager changed");
  check(note("AMC-30094").textContent.indexOf("Map pin corrected · OBD-78219") >= 0,
        "a map pin corrected on their onboarding request");
  check(note("HE-40150").textContent.indexOf("Hub edit approved · Kudlu Gate Hub") >= 0, "a hub edit approved");
  check(note("HE-40162").textContent.indexOf("Hub edit not approved · Koramangala Hub") >= 0 &&
        note("HE-40162").textContent.indexOf("site check") >= 0, "and one not approved, with the reason");
  check(!notes().some(n => /hub type|ceiling|benchmark|Standalone/i.test(n.textContent)), "none naming the hub type");

  /* each leads where it should */
  note("AMC-30094").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "4", "reading the map pin note clears it");
  check(exists(doc, '[data-hub="hub-kdg"] [data-testid="hub-am-updated"]'), "the hub card says what the AM changed");
  check(exists(doc, '[data-hub="hub-kdg"] [data-testid="hub-rate-ask"]'), "and asks to agree to the new rates");
  click(doc, "bell");
  note("RCU-50961").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  eq(api.state.panel.section, "rateagree", "the rate card update opens to agree");
  setCheck(doc, "rate-agree-check", true);
  click(doc, "rate-agree");
  eq(H.rateUpdateById("RCU-50961").status, "published", "agreeing publishes it");
  eq(sel(doc, '[data-testid="bell-count"]').textContent, "3", "and takes it off the bell");
  click(doc, "hub-back-hubs");
  clickSel(doc, '[data-amdismiss]');
  [...doc.querySelectorAll("[data-hedismiss]")].forEach(b => b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  check(!exists(doc, '[data-testid="bell-count"]'), "dismissing the rest on the hub cards clears the bell");

  /* the map pin correction is on the Area Manager’s side too */
  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  clickSel(doc, '[data-aprole="am"]');
  clickSel(doc, '[data-aptab="mine"]');
  eq(H.apMapLink(H.apById("OBD-78219")), "https://maps.google.com/?q=12.9083,77.6041",
     "the Area Manager’s side carries the same pin correction the captain was told about");
  check(H.checkMapPin(H.apMapLink(H.apById("OBD-78219")), "560076").code === "ok", "inside its pincode");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   38. No em dashes in any text on screen
   ====================================================================== */

async function testNoEmDashes() {
  section("38. No em dashes in any text on screen");
  const { win, doc, api } = await boot();
  const A = api.actions, H = api.helpers;
  const seen = [];
  const sweep = (where) => {
    const body = doc.body.cloneNode(true);
    body.querySelectorAll("script, style").forEach(e => e.remove());
    const text = body.textContent + [...doc.querySelectorAll("[placeholder], [aria-label], [title]")]
      .map(e => [e.getAttribute("placeholder"), e.getAttribute("aria-label"), e.getAttribute("title")].join(" ")).join(" ") +
      [...doc.querySelectorAll("input, textarea")].map(e => e.value).join(" ");
    if (text.indexOf("—") >= 0) {
      const i = text.indexOf("—");
      seen.push(where + ": …" + text.slice(Math.max(0, i - 40), i + 20).replace(/\s+/g, " ") + "…");
    }
  };

  sweep("login");
  ["LM", "FM"].forEach(role => {
    A.resetAll();
    login(doc);
    sweep("roles");
    pickRole(doc, role);
    api.config.PHASES[role].forEach(p => { H.goPhase(p.id); sweep(role + " " + p.id); });
  });

  A.resetAll();
  devClick(doc, "as:existing");
  login(doc);
  sweep("Captain Hub");
  click(doc, "bell"); sweep("bell"); click(doc, "bell");
  A.openRateAgree("RCU-50961"); sweep("rate card update to agree");
  A.openRateHistory("hub-kdg"); sweep("rate card history");
  A.openPanel("hubs", "hubs");
  clickSel(doc, '[data-hubedit="hub-beu"]'); sweep("hub edit form");
  A.addHubOpen(); A.addHubRole("FM"); sweep("add hub"); click(doc, "addhub-nogst"); sweep("add hub without GST");

  A.logout();
  devClick(doc, "as:admin");
  login(doc);
  sweep("admin role picker");
  ["am", "ch", "zh"].forEach(role => {
    A.adminSwitchRole();
    clickSel(doc, '[data-aprole="' + role + '"]');
    api.config.ADMIN_TABS[role].forEach(t => {
      A.adminTab(t.id); sweep(role + " " + t.id);
      const open = sel(doc, "[data-apopen], [data-apru], [data-aprate], [data-apedit]");
      if (open) { open.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); sweep(role + " " + t.id + " detail"); }
    });
  });
  ["bizfin", "design", "ops"].forEach(p => {
    A.adminSwitchRole();
    asCentral(doc, p);
    api.config.CENTRAL_TABS[p].forEach(t => {
      A.adminTab(t.id); sweep(p + " " + t.id);
      const open = sel(doc, "[data-apopen], [data-apru]");
      if (open) { open.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); sweep(p + " " + t.id + " detail"); }
    });
  });

  eq(seen, [], "no em dash on any screen swept");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   39. Panel DS v1: the designer's revision, with the product calls on it
   ====================================================================== */

async function testPanelDs() {
  section("39. Panel DS v1: design pass, Terms consent, input checks");
  const { win, doc, api } = await boot();
  const A = api.actions, H = api.helpers, VX = api.vx, E = api.errors;
  const leave = (id, value) => {           // type into a field, then move on from it
    const el = $(doc, id);
    el.value = value;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }));
  };
  const hintOf = (id) => {
    const fl = $(doc, id).closest(".fl");
    const h = fl && fl.querySelector(".hint");
    return h ? h.textContent : "";
  };

  /* --- the design system --- */
  const css = [...doc.querySelectorAll("style")].map(s => s.textContent).join("\n");
  check(/--font:'Mier B02',/.test(css), "Mier B02 leads the font stack, as the designer set it");
  check(/body\{[^}]*font-size:13px;line-height:20px/.test(css.replace(/\s+/g, "")), "body text is 13/20");

  /* --- the OTP flow is unchanged: no resend cap, no armable expiry --- */
  login(doc);
  pickRole(doc, "FM");
  A.logout();
  type(doc, "phone", "7004301290");
  click(doc, "go-otp");
  check(devText(doc).indexOf("Simulate a check result") < 0, "the OTP screen offers no check to arm");
  for (let i = 0; i < 5; i++) A.resendOtp();
  eq(api.state.otpError, "", "five resends in a row are all allowed");
  eq(api.state.otpSeconds, 25, "and each restarts the timer");
  A.resetAll();

  /* --- Terms consent gates personal details --- */
  login(doc);
  pickRole(doc, "FM");
  type(doc, "pd-name", "Karan Verma");
  type(doc, "pd-email", "karan.verma@gmail.com");
  click(doc, "pd-verify-email");
  type(doc, "pd-email-otp", "000000");
  click(doc, "pd-email-otp-go");
  check(exists(doc, "#pd-tnc"), "personal details asks for Terms consent");
  check($(doc, "pd-continue").disabled, "Continue stays off until it is ticked");
  setCheck(doc, "pd-tnc", true);
  check(!$(doc, "pd-continue").disabled, "and comes on once it is");

  /* --- fields are checked on leaving them, and clear once fixed --- */
  leave("pd-name", "Karan 2");
  eq(hintOf("pd-name"), VX.nameChars, "a name with a digit is flagged on leaving the field");
  leave("pd-name", "Karan Verma");
  check(hintOf("pd-name") !== VX.nameChars, "and the error clears once it is fixed");
  leave("pd-alt", "7004301290");
  eq(hintOf("pd-alt"), VX.phoneSame, "the alternate number can’t be the login number");
  leave("pd-alt", "5876543210");
  eq(hintOf("pd-alt"), VX.phoneStart, "nor start with 0 to 5");
  leave("pd-alt", "9876543210");
  click(doc, "pd-continue");
  eq(H.phaseId(), "kyc", "personal details completes");

  /* --- the demo Aadhaar still verifies --- */
  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  check(exists(doc, "#kyc-aadhaar-otp"), "the demo Aadhaar 1234 1234 1234 is accepted");
  check(devText(doc).indexOf("Simulate a check result") < 0, "no check to arm while the Aadhaar OTP is open");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  click(doc, "kyc-ack-aadhaar");

  /* --- no PAN is turned away for its type --- */
  type(doc, "kyc-pan", "ABCCE1234F");                // 4th letter C: a company PAN
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  check(H.R().kyc.pan.done, "a company PAN verifies like any other");
  check(VX.panType === undefined, "and no message exists to turn one away");
  click(doc, "kyc-ack-pan");

  /* --- bank format checks, and a ₹1 check that is debited and refunded --- */
  check(txt(doc).indexOf("₹1 will be deducted from this account") >= 0, "the ₹1 check is described as deducted");
  type(doc, "kyc-acc", "1234-5678-9012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  check(txt(doc).indexOf(VX.accNonDigit) >= 0, "an account number with dashes is refused");
  type(doc, "kyc-acc", "123456789012");
  devClick(doc, "vx:pennyClosed");
  click(doc, "kyc-bank-go");
  check(txt(doc).indexOf(VX.pennyClosed) >= 0, "an armed ₹1 check result is reported");
  check(!H.R().kyc.bank.done, "and the account is not verified");
  click(doc, "kyc-bank-go");
  check(H.R().kyc.bank.done, "the armed result is spent on that one call");
  click(doc, "kyc-ack-bank");

  /* --- an armed GSTIN result, then a clean one --- */
  devClick(doc, "vx:gstinSusp");
  type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
  click(doc, "kyc-gst-go");
  check(txt(doc).indexOf(VX.gstinSusp) >= 0, "a suspended GSTIN is reported");
  click(doc, "kyc-gst-go");
  check(H.R().kyc.gst.done, "and the next try verifies");
  click(doc, "kyc-continue");

  /* --- hub details: the pincode rules are as they were --- */
  H.goPhase("hub");
  A.addPincodes("110017");
  check(H.R().hub.pincodes.indexOf("110017") >= 0, "a pincode in another state is still accepted");
  A.addPincodes("012345");
  eq(H.R().hub.errors.pincode, E.pincodeFormat, "one starting with 0 gets the usual format message");
  check(VX.pinStart === undefined && VX.pinServ === undefined, "no new pincode messages exist");
  check(devText(doc).indexOf("not serviceable") < 0, "and no pincode check can be armed");
  const pinHintBefore = hintOf("hub-pin");
  leave("hub-pin", "56");
  eq(hintOf("hub-pin"), pinHintBefore, "pincode fields aren’t checked on leaving them");

  /* --- new hub field rules --- */
  leave("hub-address", "PO Box 42, Bengaluru 560001");
  eq(hintOf("hub-address"), VX.addrPo, "a PO Box is not a hub address");
  leave("hub-address", "Plot 7");
  eq(hintOf("hub-address"), VX.addrShort, "nor is a short one");
  leave("hub-area", "4,000");
  eq(hintOf("hub-area"), VX.areaDec, "area takes a whole number with no commas");
  leave("hub-manpower", "6000");
  eq(hintOf("hub-manpower"), VX.manMax, "manpower is capped at 5,000");

  /* --- the back button sits in the section header --- */
  const back = $(doc, "phase-back");
  check(back && back.classList.contains("hdr-back") && back.closest(".hdr-ttl"),
        "Back is a chevron beside the section title");
  check(!sel(doc, ".cfoot #phase-back"), "and no longer sits in the card footer");

  /* --- no em dash in any message the checks can show --- */
  const msgs = Object.values(VX).concat(Object.values(E).filter(v => typeof v === "string"));
  eq(msgs.filter(m => m.indexOf("—") >= 0), [], "no em dash in any validation message");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   40. City rates: BizFin sets Standalone and Mall ceilings by city
   ====================================================================== */

async function testCityRates() {
  section("40. City rates: BizFin sets ceilings by city");
  const { win, doc, api } = await boot();
  const A = api.actions, H = api.helpers;
  const fire = (el, t) => el.dispatchEvent(new win.Event(t, { bubbles: true }));
  const put = (q, v) => { const el = sel(doc, q); el.value = v; fire(el, "input"); };
  const rateBox = (i) => '[data-cityrate="' + i + '"]';
  const cityErr = () => (sel(doc, '[data-testid="city-error"]') || { textContent:"" }).textContent;

  /* --- the sheet, loaded --- */
  eq(H.cityList("standalone").length, 256, "every Standalone city on the sheet is loaded");
  eq(H.cityList("mall").length, 194, "and every Mall hub city");
  eq(H.ceilingRow("standalone", "Hansi"), [1.525, 1.5, 1.5, 1.5, 1.5, 1.5], "a row keeps the sheet’s third decimal");
  eq(H.slabCeiling("standalone", "Chennai", 0), 3.5, "Standalone in Chennai starts at 3.50");
  eq(H.slabCeiling("mall", "Chennai", 0), 2.35, "while a Mall hub there starts at 2.35");
  eq(H.slabCeiling("mall", "Jalandhar", 12500), 2.05, "and Jalandhar’s Mall row is its own");
  eq(H.slabCeiling("standalone", "Hamirpur-up", 0), 2.2, "a lower-case sheet name still matches");
  eq([H.fixedTp("standalone", "Agra"), H.fixedTp("mall", "Agra"), H.fixedTp("standalone_mini", "Agra")],
     ["5.00", "2.00", "6.00"], "each city carries its hub type’s touchpoint");
  eq(H.slabCeiling("standalone", "Kochi", 0), null, "a city off the sheet has no ceilings yet");

  /* --- BizFin opens it on Bengaluru --- */
  devClick(doc, "as:admin");
  login(doc);
  asCentral(doc, "bizfin");
  A.adminTab("slabs");
  clickSel(doc, '[data-slabtype="standalone_mini"]');
  check(exists(doc, '[data-testid="city-flat"]') && !exists(doc, "#city-toggle"),
        "a mini-hub is priced the same in every city, with no city to pick");
  clickSel(doc, '[data-slabtype="standalone"]');
  check(exists(doc, '[data-testid="ap-city-rates"]'), "Standalone has city rates");
  eq($(doc, "city-toggle").textContent, "Bengaluru", "opening on Bengaluru");
  check($(doc, "city-panel").hidden, "with the city list closed");
  const css = [...doc.querySelectorAll("style")].map(x => x.textContent).join("");
  check(/\.city-list\{max-height:396px\}/.test(css), "the list is ten cities tall, and scrolls for the rest");
  check(/\.city-table\{/.test(css) && doc.querySelectorAll('[data-testid="city-rate-table"] tbody tr').length === 7,
        "the rates read down the page: six bands and the touchpoint");
  eq([...doc.querySelectorAll('[data-testid="city-rate-table"] tbody td:first-child')].map(td => td.textContent),
     ["0–2,500", "2,500–5,000", "5,000–7,500", "7,500–10,000", "10,000–12,500", "Above 12,500", "Touchpoint rate"],
     "one row for each band, then the touchpoint");
  click(doc, "city-toggle");
  check(!$(doc, "city-panel").hidden, "the picker opens the list");
  eq(doc.querySelectorAll("#city-list [data-citypick]").length, 256, "with every city in it");
  check(doc.activeElement === $(doc, "city-search"), "and puts the cursor in its search box");
  eq($(doc, "city-count").textContent, "256 cities", "counting them");
  put("#city-search", "pur");
  const hits = [...doc.querySelectorAll("#city-list [data-citypick]")].map(b => b.textContent);
  check(hits.length > 1 && hits.every(t => /pur/i.test(t)), "typing narrows it to the cities that match");
  check(/^\d+ of 256 cities$/.test($(doc, "city-count").textContent), "and says how many of them");
  put("#city-search", "zzz");
  check(txt(doc).indexOf("No city matches") >= 0, "a search with no match says so");
  put("#city-search", "mysore");
  $(doc, "city-search").dispatchEvent(new win.KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
  eq($(doc, "city-toggle").textContent, "Mysore", "Enter picks the first match");
  check($(doc, "city-panel").hidden, "and closes the list");
  click(doc, "city-toggle");
  clickSel(doc, '#city-list [data-citypick="bengaluru"]');
  eq($(doc, "city-toggle").textContent, "Bengaluru", "a click on a city picks it");
  eq(sel(doc, rateBox(0)).value, "3.50", "its ceilings filled in");
  eq($(doc, "city-tp").value, "5.00", "and its touchpoint");
  check(txt(doc).indexOf("Bengaluru: From the rate card sheet.") >= 0, "saying where they come from");

  /* --- one city --- */
  click(doc, "city-toggle");
  put("#city-search", "del");
  clickSel(doc, '#city-list [data-citypick="delhi"]');
  eq(sel(doc, rateBox(0)).value, "2.65", "picking Delhi shows Delhi’s ceilings");
  click(doc, "city-save");
  check(cityErr().indexOf("already on") >= 0, "saving them unchanged says so");
  put(rateBox(0), "two");
  click(doc, "city-save");
  check(cityErr().indexOf("0–2,500 ceiling") >= 0, "a ceiling that isn’t a rate is refused, naming the column");
  put(rateBox(0), "2.80");
  put("#city-tp", "5.50");
  click(doc, "city-save");
  eq(H.slabCeiling("standalone", "New Delhi, Delhi", 0), 2.8, "Delhi’s new ceiling holds Standalone cards there");
  eq(H.fixedTp("standalone", "Delhi"), "5.50", "and its new touchpoint");
  eq(H.slabCeiling("mall", "Delhi", 0), 2.65, "Mall hubs in Delhi are untouched");
  check(txt(doc).indexOf("Delhi: Changed by BizFin on") >= 0, "the city says who changed it");
  check(sel(doc, '[data-testid="city-log"]').textContent.indexOf("Delhi") >= 0, "and the change is logged");

  /* --- every city at once --- */
  setCheck(doc, "city-all", true);
  check(exists(doc, '[data-testid="city-all-warn"]'), "ticking All cities warns first");
  check(sel(doc, '[data-testid="city-all-warn"]').textContent.indexOf("This changes all 256 Standalone cities") >= 0,
        "naming how many cities it changes");
  check($(doc, "city-toggle").disabled && $(doc, "city-toggle").textContent === "All 256 cities",
        "the city picker stands down");
  eq($(doc, "city-save").textContent, "Apply to all 256 cities", "and the button says what it does");
  eq(sel(doc, rateBox(0)).value, "", "every column starts blank, to keep each city’s own rate");
  click(doc, "city-save");
  check(cityErr().indexOf("at least one column") >= 0, "nothing filled in, nothing changes");
  put(rateBox(5), "1.40");
  click(doc, "city-save");
  check(cityErr().indexOf("Tick the box") >= 0, "it won’t apply until the warning is acknowledged");
  check(H.slabCeiling("standalone", "Agra", 12500) === 3, "and nothing has changed yet");
  setCheck(doc, "city-ack", true);
  click(doc, "city-save");
  check(H.cityList("standalone").every(c => c.row[5] === 1.4), "the top column is 1.40 in every city");
  eq(H.slabCeiling("standalone", "Agra", 0), 3.25, "the columns left blank keep each city’s own rate");
  eq(H.slabCeiling("standalone", "Delhi", 0), 2.8, "including a city changed earlier");
  check(!$(doc, "city-all").checked && !exists(doc, '[data-testid="city-all-warn"]'), "and the editor goes back to one city");
  check(sel(doc, '[data-testid="city-log"]').textContent.indexOf("All 256 cities") >= 0, "the change is logged for all cities");

  /* --- a new city --- */
  click(doc, "city-add");
  check(exists(doc, '[data-testid="city-new"]'), "Add city opens a form");
  eq($(doc, "city-new-tp").value, "5.00", "with the hub type’s touchpoint filled in");
  put("#city-new-name", "bengaluru");
  click(doc, "city-new-save");
  check(cityErr().indexOf("already on the list") >= 0, "a city already there can’t be added again");
  put("#city-new-name", "Kochi");
  click(doc, "city-new-save");
  check(cityErr().indexOf("ceiling as a rate") >= 0, "every ceiling is needed");
  ["2.60", "2.40", "2.20", "2.00", "1.80", "1.60"].forEach((v, i) => put('[data-citynew="' + i + '"]', v));
  click(doc, "city-new-save");
  eq(H.cityList("standalone").length, 257, "Kochi joins the Standalone cities");
  eq(H.slabCeiling("standalone", "Kochi, Kerala", 0), 2.6, "and holds Standalone cards there to its ceilings");
  eq(H.slabCeiling("mall", "Kochi", 0), null, "Mall hubs are added separately");
  eq($(doc, "city-toggle").textContent, "Kochi", "the new city is picked");
  eq($(doc, "city-count").textContent, "257 cities · 1 added by BizFin", "and counted as added");
  click(doc, "city-toggle");
  check(sel(doc, '#city-list [data-citypick="kochi"]').textContent.indexOf("added") >= 0 &&
        sel(doc, '#city-list [data-citypick="delhi"]').textContent.indexOf("changed") >= 0,
        "the list marks the cities added or changed");
  doc.body.dispatchEvent(new win.MouseEvent("click", { bubbles:true }));
  check($(doc, "city-panel").hidden, "a click elsewhere closes it");
  check(!H.cardAbove("standalone", "Kochi", { slabs:[{ from:"0", to:"2500", rate:"2.50" }] }),
        "a card under Kochi’s ceilings is now within them");

  /* --- kept across a reload, and read-only for FM Central Ops --- */
  check(api.reload(), "the save reloads");
  eq(H.slabCeiling("standalone", "Delhi", 0), 2.8, "with Delhi’s rates kept");
  eq(H.slabCeiling("standalone", "Kochi", 0), 2.6, "and Kochi still there");
  A.adminSwitchRole();
  asCentral(doc, "ops");
  A.adminTab("slabs");
  clickSel(doc, '[data-slabtype="standalone"]');
  check(exists(doc, '[data-testid="ap-city-rates"]') && !exists(doc, "#city-save") && !exists(doc, "#city-all") &&
        !exists(doc, "#city-add"), "FM Central Ops sees city rates but can’t change them");
  check(txt(doc).indexOf("Only BizFin can change city rates.") >= 0, "and is told so");

  api.stopTimers();
  win.close();
}

/* =========================================================================
   41. The Area Manager rejects an application
   ====================================================================== */

const contactText = (doc) => sel(doc, '[data-testid="am-app-rejected-contact"]').textContent;
async function testAmRejectsApplication() {
  section("41. The Area Manager rejects an application");
  const { win, doc, api } = await boot();
  const A = api.actions, H = api.helpers;

  /* --- a new FM captain, with the Area Manager at Cluster Head review --- */
  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  doHubDetails(doc, { address: "Plot 7, 16th Main, BTM Layout 2nd Stage, Bengaluru" });
  click(doc, "hub-continue");
  A.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(H.phaseId(), "ch", "the application is with the Area Manager");
  const firstId = H.R().requestId;
  check(devText(doc).indexOf("Reject the application") >= 0, "the simulator lets the Area Manager reject it");
  devClick(doc, "cat:standalone");
  check(devText(doc).indexOf("Reject the application") >= 0, "while they price it, too");
  devClick(doc, "amapp:reject");

  /* --- the captain is told, and pointed to the Area Manager --- */
  check(exists(doc, '[data-testid="am-app-rejected"]'), "the captain sees the application was rejected");
  check(txt(doc).indexOf("Your application was rejected") >= 0, "in plain words");
  check(contactText(doc).indexOf("for any details") >= 0, "and told to contact the Area Manager for any details");
  check(txt(doc).indexOf("Start a new application") < 0, "with nothing else to do but acknowledge it");
  const contact = contactText(doc);
  check(contact.indexOf("Priya Sharma") >= 0 && contact.indexOf("+91 98450 11223") >= 0,
        "with the Area Manager to call for details");
  check(txt(doc).indexOf(firstId) >= 0, "naming the application");
  check(!exists(doc, "#phase-back"), "there is no going back into it");
  eq($(doc, "am-app-rejected-ok").textContent, "Acknowledged", "one button acknowledges it");
  check(devText(doc).indexOf("Waiting for the captain to acknowledge it") >= 0 &&
        devText(doc).indexOf("Reject the application") < 0, "the simulator waits on the captain");
  check(api.reload(), "a reload keeps it");
  check(exists(doc, '[data-testid="am-app-rejected"]'), "and the captain still sees it until they acknowledge it");

  /* --- acknowledged: the application closes and its details go --- */
  click(doc, "am-app-rejected-ok");
  eq(api.state.screen, "roles", "acknowledging it goes back to picking a role");
  const closed = api.state.closedApps.slice(-1)[0];
  check(closed && closed.requestId === firstId && closed.deprecated, "the application is kept only as a deprecated record");
  const fm = api.state.roles.FM;
  check(!fm.started && fm.pd.name === "" && fm.kyc.aadhaar.value === "" && fm.kyc.gst.gstin === "" &&
        !fm.hub.selected && !fm.hub.pincodes.length, "none of its details are kept on the captain");
  check(sel(doc, '[data-testid="closed-app-notice"]').textContent.indexOf(firstId) >= 0,
        "the role picker says the application was rejected");
  check(exists(doc, '[data-pick="FM"]'), "and offers FM again");

  /* --- a new application starts clean, and the same details go through --- */
  pickRole(doc, "FM");
  check(H.R().requestId && H.R().requestId !== firstId, "a new application gets a new request ID");
  eq(H.phaseId(), "pd", "starting from personal details");
  eq($(doc, "pd-name").value, "", "with nothing filled in");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  eq(H.phaseId(), "hub", "the same Aadhaar, PAN, bank account and GSTIN verify again");
  A.switchRole();
  eq(api.state.screen, "roles", "back on the role picker");
  check(!exists(doc, '[data-testid="closed-app-notice"]'), "the notice goes once a new one is started");
  api.stopTimers();
  win.close();

  /* --- a live captain's new-hub application --- */
  const b = await boot();
  b.api.state.loginAs = "existing";
  b.api.helpers.seedExistingCaptain();
  login(b.doc);
  const liveHubs = b.api.state.hubs.filter(h => h.status === "active").length;
  const aadhaar = b.api.state.profile.aadhaar;
  b.api.actions.openPanel("hubs", "hubs");
  b.api.actions.addHubOpen();
  b.api.actions.addHubRole("FM");
  b.api.actions.addHubChoice("existing");
  b.api.actions.addHubContinue();
  doHubDetails(b.doc, { pin: "560102", address: "Unit 3, 5th Cross, HSR Layout, Bengaluru" });
  click(b.doc, "hub-continue");
  if (b.api.helpers.phaseId() === "bgv") { b.api.actions.bgvSet("passed"); click(b.doc, "bgv-continue"); }
  eq(b.api.helpers.phaseId(), "ch", "the new hub's application reaches the Area Manager");
  check(b.api.state.hubs.some(h => h.status === "in_progress" && h.role === "FM"), "and is listed as in progress");
  devClick(b.doc, "amapp:reject");
  check(txt(b.doc).indexOf("Your application was rejected") >= 0, "the captain is told it was rejected");
  eq($(b.doc, "am-app-rejected-ok").textContent, "Acknowledged", "with the same one button");
  click(b.doc, "am-app-rejected-ok");
  eq([b.api.state.screen, b.api.state.panel.section], ["panel", "hubs"], "acknowledging it opens My Hubs");
  check(exists(b.doc, '[data-testid="closed-hub-notice"]'), "which says the new hub was rejected");
  check(!b.api.state.hubs.some(h => h.status === "in_progress" && h.role === "FM"), "the in-progress hub is gone");
  eq(b.api.state.hubs.filter(h => h.status === "active").length, liveHubs, "the captain’s live hubs are untouched");
  eq(b.api.state.profile.aadhaar, aadhaar, "and so is their account");
  check(exists(b.doc, "#hub-add"), "they can add a new hub");
  b.api.stopTimers();
  b.win.close();
}

/* ------------------------------------------------------------------ run --- */

(async function run() {
  const t0 = Date.now();
  /* each group runs on its own — a harness error in one is reported and the
     rest still run */
  const groups = [testLM, testFMCombined, testFMAboveCeiling, testRoleIndependence, testValidation, testOtpFocusSurvivesCountdown, testAmTwoStrike, testCeilings, testDevPanel, testBulkPincodes, testHubFacilityInputs, testPhaseOrder, testBackAndPhoto, testCaptainHub, testAdminPanel, testCeilingEscalation, testCartingDesign, testFMCaptainCopy, testFMNoSplit, testCopyConsistency, testPincodesOnHub, testMapPin, testApiFailures, testGstVerification, testAmMapEdit, testHubEdits, testRateUpdates, testTypedHubPincode, testAmPortfolio, testAmDirectChanges, testSampleCaptains, testLeanAdmin, testMapPick, testCentralRates, testNoGst, testHierarchy, testSampleNotes, testNoEmDashes, testPanelDs, testCityRates, testAmRejectsApplication];
  for (const g of groups) {
    try {
      await g();
    } catch (e) {
      bad("harness error in " + g.name, e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n      ") : String(e));
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n" + "─".repeat(64));
  console.log(`  ${passed} passed, ${failed} failed  ·  ${secs}s`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach(f => console.log("   • " + f));
  }
  console.log("─".repeat(64) + "\n");
  process.exit(failed ? 1 : 0);
})();
