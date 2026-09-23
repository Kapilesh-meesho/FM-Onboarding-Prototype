/* ============================================================================
   Headless walkthrough of the captain onboarding prototype.

   Run:  node test.js
   ========================================================================= */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

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
async function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "http://localhost/",
    pretendToBeVisual: true
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

function doPersonalDetails(doc, { name = "Karan Verma", pin = "560076" } = {}) {
  type(doc, "pd-name", name);
  type(doc, "pd-alt", "9876543210");
  type(doc, "pd-email", "karan.verma@gmail.com");
  click(doc, "pd-verify-email");
  type(doc, "pd-email-otp", "000000");
  click(doc, "pd-email-otp-go");
  type(doc, "pd-pin", pin);
  click(doc, "pd-addpin");
  click(doc, "pd-check");
  clickSel(doc, '[data-selpin="' + pin + '"]');
  click(doc, "pd-continue");
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
    clickSel(doc, '[data-gstchoice="registered"]');
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

function doHubDetails(doc, { address = "No. 42, 4th Cross, Koramangala, Bengaluru",
                              map = "https://maps.google.com/?q=12.9352,77.6245",
                              area = "4000", manpower = "12",
                              maxVehicle = "7MT_20FT" } = {}) {
  type(doc, "hub-address", address);
  type(doc, "hub-map", map);
  type(doc, "hub-area", area);
  type(doc, "hub-manpower", manpower);
  pickMaxVehicle(doc, maxVehicle);
  click(doc, "hub-submit");
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
  eq(api.helpers.R().pd.selected, "560076", "serviceable pincode selected");

  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "KYC → hub details (now before background verification)");
  check(api.helpers.R().kyc.gst.registered === false,
        "LM accepted Non-GST as a complete GST answer (optional toggle)");

  doHubDetails(doc);
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
  eq(lmFan, ["VLS","OpsTech","Captain Service","UMS","Agreement store","Payout profile"],
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
  check(exists(doc, "#kyc-holder"), "with a holder-name field filled in after verification");
  check(disabled(doc, "kyc-holder"), "which is read-only");
  check(!exists(doc, "#kyc-cheque-go"),
        "FM has no cancelled-cheque upload (penny-drop covers the bank)");
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");
  eq(api.helpers.kycStep(api.helpers.R()), "bank-done", "bank lands on its confirmation");
  eq(api.helpers.R().kyc.bank.holder, "Karan Verma", "the penny-drop returns the holder name");
  click(doc, "kyc-ack-bank");

  /* GST: radio choices, GSTIN only after choosing "GST registered" */
  eq(api.helpers.kycStep(api.helpers.R()), "gst", "then GST status");
  check(exists(doc, '[data-gstchoice="registered"]'), "GST registered is offered");
  eq(sel(doc, '[data-gstchoice="none"]').getAttribute("aria-disabled"), "true",
     "FM cannot choose Non-GST — GST is mandatory");
  check(!exists(doc, "#kyc-gstin"), "the GSTIN field is hidden until GST registered is chosen");
  clickSel(doc, '[data-gstchoice="registered"]');
  check(exists(doc, "#kyc-gstin"), "choosing GST registered reveals the GSTIN field");
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

  doHubDetails(doc, { address: "Plot 7, Bommasandra Industrial Area, Bengaluru",
                      map: "https://maps.google.com/?q=12.8156,77.6982",
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
  eq(api.helpers.ceilingFor(api.helpers.R()), 5, "Standalone ceiling reads 5");
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
  check(blurb.indexOf("slab rate for your order volume plus the touchpoint rate") >= 0,
        "it says slab rate plus touchpoint, on one payout line");
  check(blurb.indexOf("on one payout line") >= 0, "and names the single payout line");
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
  eq(fmFan, ["Design & hub-code mapping","Partner ID","Captain Service","UMS",
             "Agreement store","Payout profile"], "FM fan-out list matches the brief");
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

  api.actions.chSetCategory("mall");            // ceiling 2, touchpoint ceiling 2
  eq(api.helpers.ceilingFor(api.helpers.R()), 2, "Mall hub ceiling reads 2");

  /* --- the Area Manager prices above the ceiling --- */
  api.actions.amSubmitRate(true);
  let r = api.helpers.R();
  check(api.helpers.chAboveCeiling(r), "the submitted card is above the mall-hub ceiling");
  eq(r.ch.rateMode, "combined", "only Combined exists");

  api.actions.chApprove();
  eq(api.helpers.R().ch.status, "pending",
     "the Cluster Head cannot settle an above-ceiling card");

  /* --- so it is raised; the captain is told a sign-off is pending, no more --- */
  api.actions.chRaise();
  r = api.helpers.R();
  eq(r.ch.status, "central", "above-ceiling card is raised to Central Admin");
  check(exists(doc, '[data-testid="ch-signoff"]'), "captain sees a pending sign-off state");
  check(mainTxt(doc).indexOf("needs one more sign-off") >= 0,
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
  eq(r.ch.revision.by, "Central Admin", "and records which desk sent it back");
  check(exists(doc, '[data-testid="ch-revision"]'), "captain sees a revision state");
  check(mainTxt(doc).indexOf("being revised by your Area Manager") >= 0,
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
  doPersonalDetails(doc, { name: "Karan LM", pin: "560076" });
  doKyc(doc, "LM");
  doHubDetails(doc, { address: "No. 42, Koramangala" });
  click(doc, "hub-continue");
  api.actions.bgvSet("passed");
  const lmBefore = JSON.parse(JSON.stringify(api.state.roles.LM));
  eq(lmBefore.pd.name, "Karan LM", "LM captured its own name");
  eq(api.helpers.phaseId(), "bgv", "LM parked at background verification");

  /* Switch to FM and run a different set of inputs through it. */
  click(doc, "switch-role");
  eq(api.state.screen, "roles", "switch-role returns to role selection mid-flow");
  pickRole(doc, "FM");
  doPersonalDetails(doc, { name: "Karan FM", pin: "110017" });
  eq(api.state.roles.FM.pd.name, "Karan FM", "FM captured its own name");
  eq(api.state.roles.FM.pd.selected, "110017", "FM selected its own pincode");

  const lmAfter = api.state.roles.LM;
  eq(lmAfter.pd.name, "Karan LM", "LM name untouched by the FM run");
  eq(lmAfter.pd.selected, "560076", "LM pincode untouched by the FM run");
  eq(lmAfter.phaseIdx, lmBefore.phaseIdx, "LM phase index untouched");
  eq(lmAfter.bgv.status, "passed", "LM background verification result untouched");
  eq(lmAfter.kyc.gst.registered, false, "LM Non-GST answer untouched");
  check(api.state.roles.FM.kyc.aadhaar.done === false,
        "FM KYC is independent and still empty");

  /* Resume LM where it was left. */
  click(doc, "switch-role");
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

  /* --- pincode format --- */
  type(doc, "pd-pin", "12ab5");
  click(doc, "pd-addpin");
  check(txt(doc).indexOf(E.pincodeFormat) >= 0, "bad pincode → '" + E.pincodeFormat + "'");
  eq(api.helpers.R().pd.pincodes.length, 0, "bad pincode not added");

  type(doc, "pd-pin", "012345");
  click(doc, "pd-addpin");
  check(txt(doc).indexOf(E.pincodeFormat) >= 0, "pincode starting with 0 rejected");

  /* --- duplicate --- */
  type(doc, "pd-pin", "560076");
  click(doc, "pd-addpin");
  type(doc, "pd-pin", "560076");
  click(doc, "pd-addpin");
  check(txt(doc).indexOf(E.pincodeDupe) >= 0, "duplicate pincode → '" + E.pincodeDupe + "'");
  eq(api.helpers.R().pd.pincodes.length, 1, "duplicate not added twice");

  /* --- max 5 --- */
  ["560034","560102","110017","400059"].forEach(p => {
    type(doc, "pd-pin", p); click(doc, "pd-addpin");
  });
  eq(api.helpers.R().pd.pincodes.length, 5, "five pincodes accepted");
  api.actions.addPincode("560001");
  check(txt(doc).indexOf(E.pincodeMax) >= 0, "sixth pincode → '" + E.pincodeMax + "'");
  eq(api.helpers.R().pd.pincodes.length, 5, "sixth pincode not added");

  /* --- email --- */
  api.actions.removePincode("400059");
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
  check(txt(doc).indexOf(E.account) >= 0, "bad account number → '" + E.account + "'");
  check(txt(doc).indexOf(E.ifsc) >= 0, "bad IFSC → '" + E.ifsc + "'");
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
  section("7. Hub category benchmark ceilings");
  const { win, api } = await boot();
  const C = api.config.HUB_CATEGORIES;

  const expected = [
    ["standalone_mini", "Standalone (mini-hub)", 3.2, 6],
    ["standalone",      "Standalone",            5,   5],
    ["lm_as_fm",        "LM-as-FM",              6,   6],
    ["mall",            "Mall hub",              2,   2],
    ["sah",             "SAH (seller as hub)",   1.5, 1.5]
  ];
  expected.forEach(([key, label, ceiling, tp]) => {
    const c = C[key];
    check(c && c.label === label && c.ceiling === ceiling && c.tp === tp,
          label + " → ceiling " + ceiling + ", touchpoint ₹" + tp,
          c ? "got ceiling " + c.ceiling + ", tp " + c.tp : "category missing");
  });

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
  check(dWithin.indexOf("Raise to Central Admin") === -1,
        "and raising is not offered on a within-ceiling card");
  check(dWithin.indexOf("back to Area Manager") >= 0, "FM CH: reject offered");

  api.actions.amSubmitRate(true);
  const dAbove = devText();
  check(dAbove.indexOf("Raise to Central Admin") >= 0,
        "FM CH: raise offered on an above-ceiling card");
  check(dAbove.indexOf("Approve rate card") === -1,
        "and the Cluster Head cannot approve one");

  api.actions.chRaise();
  const d3 = devText();
  check(d3.indexOf("Central Admin") >= 0, "Central Admin group appears once raised");
  check(d3.indexOf("Approve rate card") >= 0, "Central Admin approve offered");

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
  const pins = () => api.helpers.R().pd.pincodes;

  login(doc);
  pickRole(doc, "LM");

  /* comma-separated, one action */
  type(doc, "pd-pin", "560076, 560034, 110017");
  click(doc, "pd-addpin");
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
  api.actions.addPincodes("560034, 560034, 560034");
  eq(pins(), ["560034"], "a value repeated inside one paste is added once");

  /* a bulk add invalidates a previous availability check */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  api.actions.addPincodes("560076");
  api.helpers.R().pd.emailVerified = true;
  api.actions.checkAvailability();
  api.actions.selectPincode("560076");
  check(api.helpers.R().pd.checked && api.helpers.R().pd.selected === "560076",
        "availability checked and a pincode selected");
  api.actions.addPincodes("560034, 110017");
  check(!api.helpers.R().pd.checked && !api.helpers.R().pd.selected,
        "adding more pincodes clears the stale availability result");

  /* single-value behaviour is unchanged — precise copy, not a batch summary */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
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
  const pinInput = $(doc, "pd-pin");
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
  doPersonalDetails(doc, { pin: "560076" });
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
  eq(seen.ch,  "Continue to security deposit →", "Cluster Head points at the deposit");
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
   10c. Stepping back through the opening phases, and the optional photo
   ====================================================================== */

// a 1x1 gif, enough to stand in for an uploaded image
const TINY_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function testBackAndPhoto() {
  section("10c. Back navigation and the optional location photo");
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
  eq(api.helpers.R().pd.pincodes, ["560076"], "pincodes survive the round trip");
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

  /* ---- the optional location photo ---- */
  api.reset();
  login(doc);
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
  eq(api.helpers.phaseId(), "hub", "back at hub details");

  check(exists(doc, "#hub-photo-btn"), "an upload button sits beside the map link");
  check(!!sel(doc, "#hub-map").closest(".box").querySelector("#hub-photo-btn"),
        "the button is inside the map link field, beside the input");
  check(exists(doc, "#hub-photo-file"), "backed by a real file input");
  eq($(doc, "hub-photo-file").getAttribute("accept"), "image/*", "which accepts images");
  check(!exists(doc, '[data-testid="hub-photo"]'), "no thumbnail before anything is uploaded");
  check($(doc, "hub-photo-btn").textContent.indexOf("Add photo") >= 0, "button offers to add one");

  /* the photo is optional — hub details submits without it */
  doHubDetails(doc, { address: "No. 42, Koramangala" });
  check(api.helpers.R().hub.submitted, "hub details submits with no photo attached");
  check(!api.helpers.R().hub.photo, "and no photo is recorded");
  click(doc, "hub-edit");

  /* uploading renders a thumbnail */
  api.actions.setHubPhoto(TINY_IMG, "gate.jpg");
  check(exists(doc, '[data-testid="hub-photo"]'), "a thumbnail appears once uploaded");
  const thumb = $(doc, "hub-photo-thumb");
  check(!!thumb && thumb.tagName === "IMG", "the thumbnail is a rendered image");
  eq(thumb.getAttribute("src"), TINY_IMG, "showing the uploaded image itself");
  check(txt(doc).indexOf("gate.jpg") >= 0, "the file name is shown");
  check($(doc, "hub-photo-btn").textContent.indexOf("Replace photo") >= 0,
        "the button now offers to replace it");

  /* it can be viewed full size and removed */
  click(doc, "hub-photo-thumb");
  check(exists(doc, "#photo-lb"), "clicking the thumbnail opens it full size");
  click(doc, "photo-lb");
  check(!exists(doc, "#photo-lb"), "and clicking again closes it");
  click(doc, "hub-photo-remove");
  check(!api.helpers.R().hub.photo, "Remove clears the photo");
  check(!exists(doc, '[data-testid="hub-photo"]'), "and the thumbnail goes away");

  /* non-images and oversized images are refused */
  api.actions.setHubPhoto("not-a-data-url", "notes.txt");
  check(txt(doc).indexOf(E.photoType) >= 0, "a non-image is refused");
  check(!api.helpers.R().hub.photo, "and nothing is stored");
  api.actions.setHubPhoto("data:image/png;base64," + "A".repeat(2000001), "huge.png");
  check(txt(doc).indexOf(E.photoSize) >= 0, "an oversized image is refused");
  check(!api.helpers.R().hub.photo, "and nothing is stored");

  /* A file that claims to be an image but does not decode used to be stored
     anyway, rendering as a broken thumbnail with no explanation. */
  api.actions.setHubPhoto(TINY_IMG, "ok.gif");
  api.actions.rejectHubPhoto(E.photoUnreadable);
  check(txt(doc).indexOf(E.photoUnreadable) >= 0, "an undecodable image is refused");
  check(!api.helpers.R().hub.photo, "and any previous photo is cleared rather than left broken");
  check(!exists(doc, '[data-testid="hub-photo"]'), "no broken thumbnail is rendered");

  /* it survives submission and reaches the summary */
  api.actions.setHubPhoto(TINY_IMG, "gate.jpg");
  click(doc, "hub-submit");
  check(api.helpers.R().hub.submitted, "submits with a photo attached");
  check(!!sel(doc, '.kv .row img'), "the submitted summary renders the photo");
  check(txt(doc).indexOf("Location photo") >= 0, "and labels it");

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
  eq(api.state.hubs.length, 3, "existing captain is seeded with 3 hubs");
  login(doc);
  eq(api.state.screen, "panel", "an existing captain lands in the Captain Hub, not onboarding");
  eq(api.state.panel.section, "hubs", "and lands on My Hubs");

  /* --- HB-01 --- */
  let body = txt(doc);
  check(body.indexOf("Active hubs (2)") >= 0, "HB-01 groups two active hubs");
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
  check(body.indexOf("shared across all your hubs") >= 0, "KYC is stated as captain-level");
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
  eq(api.helpers.hubById("hub-beu").gst,
     { registered:true, gstin:"29ZZZZZ9999Z1Z9" }, "a valid GSTIN is added to that hub only");
  eq(api.helpers.hubById("hub-aqt").gst.gstin, "29ABCDE1234F1Z5",
     "the other hub's GSTIN is untouched");

  clickSel(doc, '[data-gst="hub-aqt"]');
  api.actions.gstAskRemove();
  check(exists(doc, '[data-testid="gst-remove-confirm"]'), "removing a GSTIN asks for confirmation");
  click(doc, "gst-remove-go");
  eq(api.helpers.hubById("hub-aqt").gst, { registered:false, gstin:"" }, "the GSTIN is removed");
  api.actions.gstOpen("hub-aqt");
  api.actions.gstSave("29ABCDE1234F1Z5");
  check(api.helpers.hubById("hub-aqt").gst.registered, "and can be added back");

  /* --- HB-07: add a new hub --- */
  click(doc, "hub-add");
  eq(api.state.panel.section, "addhub", "Add new hub opens the GST choice screen");
  body = txt(doc);
  check(body.indexOf("How is this hub registered for GST?") >= 0, "HB-07 heading present");
  check(body.indexOf("Your KYC and bank details carry over automatically") >= 0,
        "HB-07 states that KYC and bank carry over");
  ["existing","none","new"].forEach(c =>
    check(!!sel(doc, '[data-choice="' + c + '"]'), "GST choice offered: " + c));
  check(api.helpers.knownGstins().length > 0, "existing verified GSTINs are available to map");

  /* FM cannot be Non-GST — the rule from onboarding holds here too */
  api.actions.addHubRole("FM");
  check(sel(doc, '[data-choice="none"]').getAttribute("aria-disabled") === "true",
        "Non-GST is not offered for an FM hub");
  check(txt(doc).indexOf("mandatory for First Mile") >= 0, "and says why");
  api.actions.addHubChoice("none");
  check(api.state.panel.addHub.choice !== "none", "choosing Non-GST for FM is refused");

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

  /* a disabled row is inert without relying on a button's disabled attribute */
  api.actions.addHubRole("FM");
  const noneRow = sel(doc, '[data-choice="none"]');
  eq(noneRow.getAttribute("aria-disabled"), "true", "the Non-GST row is marked disabled for FM");
  noneRow.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  check(api.state.panel.addHub.choice !== "none", "and clicking it does nothing");
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
  const hubsBefore = api.state.hubs.length;
  click(doc, "addhub-go");
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
  api.helpers.R().pd.selected = "560076";
  doHubDetails(doc, { address: "12, 1st Main, Jayanagar, Bengaluru" });
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

  eq(api.state.hubs.length, hubsBefore + 1, "the finished hub is added to My Hubs");
  const added = api.state.hubs[api.state.hubs.length - 1];
  check(!!added.code, "the new hub has a hub code (" + added.code + ")");
  eq(added.role, "LM", "with the role it was created for");
  eq(added.gst, { registered:true, gstin:"29ABCDE1234F1Z5" }, "and the GST setup chosen at HB-07");
  eq(added.status, "active", "and is active");

  click(doc, "act-panel");
  eq(api.state.screen, "panel", "Open Captain Panel now goes to the Captain Hub");
  check(txt(doc).indexOf("Active hubs (3)") >= 0, "My Hubs shows the new hub alongside the others");

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
  eq(api.config.ADMIN_TABS.am.map(t => t.id), ["mine"], "AM has only its own requests");

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
  eq(api.helpers.apCeiling(amReq), 5, "a Standalone hub sets a ceiling of 5");
  check(txt(doc).indexOf("₹5.00") >= 0, "the ceiling is shown against the slabs");

  /* within the ceiling → straight through to the Cluster Head */
  api.actions.chSlabField(0, "from", "0");
  api.actions.chSlabField(0, "to", "500");
  api.actions.chSlabField(0, "rate", "4.50");
  api.actions.amRateField("touchpoint", "5.00");
  check(api.helpers.apWithinThreshold(amReq), "4.50 is within the 5.00 ceiling");
  check(txt(doc).indexOf("Within ceiling") >= 0, "the card says so");
  check(!disabled(doc, "ap-approve"), "and approve opens");
  check($(doc, "ap-approve").textContent.indexOf("send to CH") >= 0,
        "sending it straight to the Cluster Head");

  /* above the ceiling → it becomes an approval request instead */
  api.actions.chSlabField(0, "rate", "7.00");
  check(!api.helpers.apWithinThreshold(amReq), "7.00 is above the 5.00 ceiling");
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
  eq(api.config.ADMIN_TABS.ch.map(t => t.id), ["mine","am","users"],
     "CH sees its own requests, AM requests and user mapping");
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
  check(txt(doc).indexOf("Raised to Central Admin") >= 0, "with a confirmation");

  api.actions.adminTab("users");
  check(txt(doc).indexOf("User mapping") >= 0, "the CH has a user mapping table");

  /* --- Zonal Head: monitoring only --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="zh"]');
  check(txt(doc).indexOf("Priya Nair") >= 0, "signed in as the Zonal Head");
  eq(api.config.ADMIN_TABS.zh.map(t => t.id), ["am","ch","users"],
     "the Zonal Head sees AM and CH pendency, and nothing of their own");
  eq(api.config.ADMIN_TABS.zh.map(t => t.label), ["AM pendency","CH pendency","User mapping"],
     "framed as pendency rather than a queue");
  check(api.config.ADMIN_ROLES.zh.desc.indexOf("Monitor") >= 0,
        "and described as monitoring");
  check(api.config.ADMIN_ROLES.zh.desc.indexOf("Approve") === -1, "not approving");

  const zhRows = [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  check(zhRows.length >= 1, "AM pendency lists what is with Area Managers");
  clickSel(doc, '[data-apopen="' + zhRows[0] + '"]');
  check(exists(doc, '[data-testid="zh-monitor-only"]'), "opening one is a view-only screen");
  check(txt(doc).indexOf("Request status") >= 0, "showing where the request sits");
  ["ap-approve","ap-reject","ap-central"].forEach(id =>
    check(!exists(doc, "#" + id), "the Zonal Head has no " + id.replace("ap-", "") + " action"));
  noSd("the ZH monitoring view");

  /* --- FM Central Admin --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="central"]');
  eq(api.config.ADMIN_TABS.central.map(t => t.id), ["mine","design","am","ch","zh","users"],
     "Central has its own approval queue plus the AM, CH and ZH views");
  check(txt(doc).indexOf("National view") >= 0, "described as a national view");

  eq(api.state.admin.tab, "mine", "Central opens on its own queue");
  const centralRows = [...doc.querySelectorAll("[data-apopen]")].map(b => b.getAttribute("data-apopen"));
  check(centralRows.indexOf("OBD-78222") >= 0, "holding what the Cluster Head raised");
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("Central Admin · rate card approval") >= 0, "opens the Central approval");
  check(exists(doc, '[data-testid="central-above-threshold"]'),
        "stating what was over ceiling and by how much");
  check(txt(doc).indexOf("Raised by the Cluster Head") >= 0, "attributed to the Cluster Head");
  check(exists(doc, "#ap-approve"), "Central Admin can approve it");
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
  eq(api.helpers.apCeiling(sample), 2, "whose ceiling is 2");
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
  api.actions.chSlabField(0, "rate", "1.80");
  api.actions.chSlabField(1, "rate", "1.60");
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
  api.actions.chSlabField(0, "rate", "3.50");
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78255").rateEscalated, true, "above ceiling again");
  eq(api.helpers.apById("OBD-78255").stage, "ch", "so it goes to the Cluster Head for approval");

  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-central");
  eq(api.helpers.apById("OBD-78255").stage, "central", "the CH raises it to Central Admin");

  /* --- Central Admin can approve or reject --- */
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="central"]');
  eq(api.state.admin.tab, "mine", "Central opens on its own queue");
  check(apVisible(doc).indexOf("OBD-78255") >= 0, "where the raised request is waiting");
  clickSel(doc, '[data-apopen="OBD-78255"]');
  check(txt(doc).indexOf("Central Admin · rate card approval") >= 0, "opening the approval");
  check(exists(doc, '[data-testid="central-above-threshold"]'), "with the overage stated");
  check(txt(doc).indexOf("Raised by the Cluster Head") >= 0, "attributed to the Cluster Head");
  check(exists(doc, "#ap-approve") && exists(doc, "#ap-reject"),
        "Central Admin can approve or reject");

  /* reject first — it goes back to the AM, not to the captain */
  click(doc, "ap-reject");
  const bounced = api.helpers.apById("OBD-78255");
  eq(bounced.stage, "am", "a Central rejection also returns it to the Area Manager");
  eq(bounced.revision.by, "Central Admin", "naming Central Admin as the sender");
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
  clickSel(doc, '[data-aprole="central"]');
  clickSel(doc, '[data-apopen="OBD-78255"]');
  click(doc, "ap-approve");
  eq(api.helpers.apById("OBD-78255").settled, "approved", "Central Admin approves the rate card");
  eq(api.helpers.apById("OBD-78255").stage, "done", "which settles the request");

  /* --- the touchpoint rate is benchmarked against its own ceiling --- */
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
  api.actions.amCategory("mall");
  api.actions.chSlabField(0, "rate", "1.80");
  api.actions.amRateField("touchpoint", "2.00");

  const req = () => api.helpers.apById("OBD-78222");
  eq(api.helpers.apCeiling(req()), 2, "a mall hub caps slab rates at 2");
  eq(api.helpers.apTpCeiling(req()), 2, "and the touchpoint at 2 as well");
  check(api.helpers.apWithinThreshold(req()), "a card on both ceilings is within threshold");
  check(!exists(doc, '[data-testid="am-tp"].over'), "the touchpoint row is not flagged");

  /* the slab rates stay put; only the touchpoint goes over */
  type(doc, "am-touchpoint", "2.60");
  check(api.helpers.tpOverCeiling(req()), "raising only the touchpoint breaches its ceiling");
  check(!api.helpers.slabOverCeiling(req(), req().rate.slabs[0]),
        "while the slab rate is still inside its own");
  check(!api.helpers.apWithinThreshold(req()),
        "so the card as a whole is above threshold");
  check(exists(doc, '[data-testid="am-tp"].over'), "the touchpoint row is flagged in place");
  eq($(doc, "am-tp-ceiling").textContent.trim(), "₹2.00 · over", "with its ceiling marked over");
  eq($(doc, "am-rate-status").textContent.trim(), "Above ceiling", "and the card chip follows");
  check(txt(doc).indexOf("The touchpoint rate is ₹2.60 against a ₹2.00 ceiling.") >= 0,
        "the notice names the touchpoint, not a slab");
  check(txt(doc).indexOf("highest slab rate") === -1,
        "and does not claim a slab rate is over when none is");
  eq($(doc, "ap-approve").textContent.indexOf("Raise approval request") >= 0, true,
     "so it submits as an approval request");

  /* both over at once reads as one sentence */
  api.actions.chSlabField(0, "rate", "3.00");
  check(txt(doc).indexOf("The highest slab rate is ₹3.00 against a ₹2.00 ceiling, and " +
                         "the touchpoint rate is ₹2.60 against a ₹2.00 ceiling.") >= 0,
        "with both breaches stated together when both are over");

  /* back within the touchpoint ceiling and only the slab is named */
  type(doc, "am-touchpoint", "1.90");
  check(!api.helpers.tpOverCeiling(req()), "lowering it clears the touchpoint breach");
  check(txt(doc).indexOf("touchpoint rate is") === -1, "and the notice drops it");
  check(!apiTpFlagged(doc), "and the row is no longer flagged");

  /* the "what's still missing" hint must not survive the card being completed */
  check($(doc, "am-rate-incomplete").hidden,
        "the incomplete-card hint is gone once every field is filled");
  api.actions.amRateField("touchpoint", "");
  check(!$(doc, "am-rate-incomplete").hidden, "and comes back when one is cleared");
  api.actions.amRateField("touchpoint", "2.60");
  check($(doc, "am-rate-incomplete").hidden, "without needing a full re-render");

  /* it carries downstream: the CH sees the touchpoint ceiling and the breach */
  type(doc, "am-touchpoint", "2.60");
  api.actions.chSlabField(0, "rate", "1.80");
  click(doc, "ap-approve");
  eq(req().stage, "ch", "an over-touchpoint card still routes to the Cluster Head");
  eq(req().rateEscalated, true, "as an approval request");
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="ch"]');
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("Touchpoint ceiling (Mall hub)") >= 0,
        "the CH's read-only card names the touchpoint ceiling");
  check(txt(doc).indexOf("₹2.60 / shipment · above ceiling") >= 0,
        "and flags the touchpoint as above it");
  check(txt(doc).indexOf("The touchpoint rate is ₹2.60 against a ₹2.00 ceiling.") >= 0,
        "with the banner naming the touchpoint breach");
  check(!exists(doc, "#ap-approve"), "the CH cannot settle it");
  api.actions.chRate(4);
  check(exists(doc, "#ap-central"), "and once their own review is done, must raise it");
  click(doc, "ap-central");
  api.actions.adminSwitchRole();
  clickSel(doc, '[data-aprole="central"]');
  clickSel(doc, '[data-apopen="OBD-78222"]');
  check(txt(doc).indexOf("For a Mall hub, the touchpoint rate is ₹2.60") >= 0,
        "and Central Admin is told which ceiling was breached");

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

const apiTpFlagged = (doc) => !!doc.querySelector('[data-testid="am-tp"].over');

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
  check(txt(doc).indexOf("Rate card revisions follow Valmo\u2019s internal approval process") >= 0,
        "the service agreement points at an internal process, naming no desk");
  check(txt(doc).indexOf("Rate card values are set by your Area Manager") >= 0,
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
  clickSel(doc, '[data-aprole="central"]');
  clickSel(doc, '[data-aptab="design"]');
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
  type(doc, "hub-address", "Plot 7, Bommasandra");
  type(doc, "hub-map", "https://maps.google.com/?q=12.9352,77.6245");
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
  clickSel(b.doc, '[data-aprole="central"]');
  b.api.actions.adminTab("design");
  b.api.actions.adminOpen(fresh.id);
  check(txt(b.doc).indexOf("Not set yet") >= 0,
        "the design alignment shows hub type as not set yet");
  check(txt(b.doc).indexOf(fresh.pincode) >= 0,
        "and the serving pincodes include the hub's own");

  b.api.stopTimers();
  b.win.close();
}

/* ------------------------------------------------------------------ run --- */

(async function run() {
  const t0 = Date.now();
  try {
    await testLM();
    await testFMCombined();
    await testFMAboveCeiling();
    await testRoleIndependence();
    await testValidation();
    await testOtpFocusSurvivesCountdown();
    await testAmTwoStrike();
    await testCeilings();
    await testDevPanel();
    await testBulkPincodes();
    await testHubFacilityInputs();
    await testPhaseOrder();
    await testBackAndPhoto();
    await testCaptainHub();
    await testAdminPanel();
    await testCeilingEscalation();
    await testCartingDesign();
    await testFMCaptainCopy();
    await testFMNoSplit();
    await testCopyConsistency();
  } catch (e) {
    bad("harness error", e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n      ") : String(e));
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
