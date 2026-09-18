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
const txt = (doc) => doc.body.textContent.replace(/\s+/g, " ");

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

function doKyc(doc, role) {
  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");

  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");

  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");

  if (role === "FM") {
    type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
    click(doc, "kyc-gst-go");
    click(doc, "kyc-msme-go");
  } else {
    click(doc, "kyc-gst-no");
    click(doc, "kyc-gst-go");
  }
  click(doc, "kyc-continue");
}

/* Drive the vehicle dropdown the way a person does: open it, tick the rows that
   need changing, close it. Idempotent — checkboxes toggle, so a form reopened
   with a selection already on must not have it flipped back off. */
function pickVehicles(doc, list) {
  const api = doc.defaultView.__APP__;
  const want = new Set(list);
  if (!doc.getElementById("veh-toggle")) throw new Error("pickVehicles: dropdown not on screen");
  if (!api.helpers.vehUI().open) click(doc, "veh-toggle");
  for (let guard = 0; guard <= 60; guard++) {
    const next = [...doc.querySelectorAll("#veh-list [data-veh]")].find(
      (cb) => want.has(cb.getAttribute("data-veh")) !== cb.checked
    );
    if (!next) {
      click(doc, "veh-toggle");                       // close
      return;
    }
    next.checked = !next.checked;
    next.dispatchEvent(new (doc.defaultView.Event)("change", { bubbles: true }));
  }
  throw new Error("pickVehicles: selection did not settle");
}

function doHubDetails(doc, { address = "No. 42, 4th Cross, Koramangala, Bengaluru",
                              map = "https://maps.google.com/?q=12.9352,77.6245",
                              area = "4000", manpower = "12",
                              vehicles = ["3.5MT_14FT", "7MT_20FT"] } = {}) {
  type(doc, "hub-address", address);
  type(doc, "hub-map", map);
  type(doc, "hub-area", area);
  type(doc, "hub-manpower", manpower);
  pickVehicles(doc, vehicles);
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
  eq(api.helpers.phaseId(), "bgv", "KYC → background verification");
  check(api.helpers.R().kyc.gst.registered === false,
        "LM accepted Non-GST as a complete GST answer (optional toggle)");

  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "BGV passed → Cluster Head review");

  api.actions.chApprove();
  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "sd", "CH approved → security deposit (LM only)");

  click(doc, "sd-pay");
  click(doc, "sd-continue");
  eq(api.helpers.phaseId(), "hub", "deposit paid → hub details");

  doHubDetails(doc);
  const lmHubCode = api.helpers.R().hub.hubCode;
  check(!!lmHubCode && /^[A-Z]{3}$/.test(lmHubCode),
        "LM hub code generated at hub submit (" + lmHubCode + ")");

  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "am", "hub details → Area Manager verification");

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
  eq(ids, ["pd","kyc","bgv","ch","hub","ag","act"], "FM phase list has no SD and no AM");
  check(ids.indexOf("sd") === -1, "FM has no security deposit phase");
  check(ids.indexOf("am") === -1, "FM has no standalone Area Manager phase");

  doPersonalDetails(doc);
  eq(api.helpers.phaseId(), "kyc", "FM personal details → KYC");

  /* --- FM KYC differences --- */
  check(!exists(doc, "#kyc-gst-no"),
        "FM KYC has no Non-GST toggle — GST is mandatory");
  check(!exists(doc, "#kyc-cheque-go"),
        "FM KYC has no cancelled-cheque upload (penny-drop covers the bank)");
  check(exists(doc, "#kyc-msme-go"), "FM KYC has the MSME certificate upload");

  type(doc, "kyc-aadhaar", "123412341234");
  click(doc, "kyc-aadhaar-go");
  type(doc, "kyc-aadhaar-otp", "000000");
  click(doc, "kyc-aadhaar-confirm");
  type(doc, "kyc-pan", "ABCDE1234F");
  type(doc, "kyc-pan-father", "Suresh Verma");
  click(doc, "kyc-pan-go");
  type(doc, "kyc-acc", "123456789012");
  type(doc, "kyc-ifsc", "HDFC0001234");
  click(doc, "kyc-bank-go");

  check(disabled(doc, "kyc-continue"),
        "FM Continue still disabled with Aadhaar+PAN+bank done but GST/MSME missing");

  type(doc, "kyc-gstin", "29ABCDE1234F1Z5");
  click(doc, "kyc-gst-go");
  check(disabled(doc, "kyc-continue"), "FM Continue still disabled without MSME");

  click(doc, "kyc-msme-go");
  check(!disabled(doc, "kyc-continue"),
        "FM Continue enables only once Aadhaar, PAN, bank, GST and MSME are all done");
  click(doc, "kyc-continue");
  eq(api.helpers.phaseId(), "bgv", "FM KYC → background verification");

  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "FM BGV → Cluster Head review");

  /* --- hub category gate --- */
  check(exists(doc, '[data-testid="waiting-category"]'),
        "FM Cluster Head blocks with a waiting-on-hub-classification state");
  check(!api.helpers.chCanDecide(api.helpers.R()),
        "Cluster Head cannot decide before the AM sets hub category");
  api.actions.chApprove("combined");
  eq(api.helpers.R().ch.status, "pending",
     "approve is a no-op while hub category is unset");

  api.actions.chSetCategory("standalone");     // ceiling 5, touchpoint 5
  eq(api.helpers.ceilingFor(api.helpers.R()), 5, "Standalone ceiling reads 5");
  check(api.helpers.chCanDecide(api.helpers.R()),
        "Cluster Head can decide once the category arrives");
  check(txt(doc).indexOf("Standalone") >= 0,
        "hub category is shown read-only alongside its benchmark ceiling");

  api.actions.chApprove("combined");
  const ch = api.helpers.R().ch;
  eq(ch.status, "approved", "within-ceiling rate clears at Cluster Head");
  eq(ch.decidedBy, "ch", "decided by Cluster Head, not escalated");
  eq(ch.rateMode, "combined", "combined rate card mode recorded");
  check(!api.helpers.isAboveCeiling(api.helpers.R()), "booked rate is within the ceiling");
  check(!exists(doc, '[data-testid="split-caveat"]'),
        "no split caveat shown in combined mode");

  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "hub", "FM CH approved → hub details (no security deposit)");

  doHubDetails(doc, { address: "Plot 7, Bommasandra Industrial Area, Bengaluru",
                      map: "https://maps.google.com/?q=12.8156,77.6982",
                      area: "6500", manpower: "18", vehicles: ["10MT_32FT"] });
  check(!api.helpers.R().hub.hubCode,
        "FM hub details submit does NOT generate a hub code");
  check(exists(doc, '[data-testid="fm-no-hubcode"]'),
        "FM is told the hub code is finalised later");

  click(doc, "hub-continue");
  eq(api.helpers.phaseId(), "ag", "FM hub details → agreements (no AM phase)");

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
   3. FM escalation — split mode, above benchmark → ZH reject → resubmit → approve
   ====================================================================== */

async function testFMEscalation() {
  section("3. FM escalation — split, above benchmark, ZH reject then approve");
  const { win, doc, api } = await boot();

  login(doc);
  pickRole(doc, "FM");
  doPersonalDetails(doc);
  doKyc(doc, "FM");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  eq(api.helpers.phaseId(), "ch", "reached Cluster Head review");

  api.actions.chSetCategory("mall");            // ceiling 2, touchpoint 2
  eq(api.helpers.ceilingFor(api.helpers.R()), 2, "Mall hub ceiling reads 2");

  api.actions.chEscalate("split", 4.5);
  let r = api.helpers.R();
  eq(r.ch.status, "escalated", "above-ceiling rate escalates to Zonal Head");
  eq(r.ch.rateMode, "split", "split rate card mode recorded");
  check(api.helpers.isAboveCeiling(r), "4.5 is above the 2.0 mall-hub ceiling");
  check(txt(doc).indexOf("Zonal Head") >= 0, "Zonal Head contact card is shown");
  check(exists(doc, '[data-testid="split-caveat"]'),
        "split mode shows the 'indicative, formula being confirmed' caveat");
  check(txt(doc).indexOf("indicative") >= 0 || txt(doc).indexOf("Indicative") >= 0,
        "caveat copy marks the captain split as indicative");
  const indic = api.helpers.indicativeCaptainSplit(r);
  check(typeof indic === "number" && indic < r.ch.rate,
        "captain split is derived but shown as indicative only (" + indic + ")");

  api.actions.zhReject("Rate is not supportable for a mall hub.");
  r = api.helpers.R();
  eq(r.ch.status, "zh_rejected", "Zonal Head rejection recorded");
  check(txt(doc).indexOf("Zonal Head rejected") >= 0, "captain sees the ZH rejection state");

  api.actions.chEscalate("split", 3.9);         // resubmit, still above ceiling
  r = api.helpers.R();
  eq(r.ch.status, "escalated", "resubmission re-escalates to Zonal Head");
  eq(r.ch.rate, 3.9, "resubmitted rate recorded");

  api.actions.zhApprove();
  r = api.helpers.R();
  eq(r.ch.status, "approved", "Zonal Head approval clears the phase");
  eq(r.ch.decidedBy, "zh", "approval is attributed to the Zonal Head");

  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "hub", "ZH-approved request moves on to hub details");

  /* every reject path routes somewhere the captain can act */
  api.helpers.goPhase("ch");
  api.actions.chReject("Hub address does not match the surveyed site.");
  eq(api.helpers.R().ch.status, "rejected", "Cluster Head reject reachable");
  check(exists(doc, "#ch-back-pd"),
        "rejected state offers a route back to personal details");
  click(doc, "ch-resubmit");
  eq(api.helpers.R().ch.status, "pending", "captain can resubmit after a CH rejection");

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

  /* --- KYC error copy surfaces in the UI --- */
  api.helpers.goPhase("kyc");
  type(doc, "kyc-pan", "BADPAN");
  type(doc, "kyc-pan-father", "");
  click(doc, "kyc-pan-go");
  check(txt(doc).indexOf(E.pan) >= 0, "bad PAN → '" + E.pan + "'");
  check(txt(doc).indexOf(E.panFather) >= 0, "missing father's name → '" + E.panFather + "'");
  check(!api.helpers.R().kyc.pan.done, "PAN not marked verified on a bad input");

  type(doc, "kyc-acc", "12");
  type(doc, "kyc-ifsc", "BADIFSC");
  click(doc, "kyc-bank-go");
  check(txt(doc).indexOf(E.account) >= 0, "bad account number → '" + E.account + "'");
  check(txt(doc).indexOf(E.ifsc) >= 0, "bad IFSC → '" + E.ifsc + "'");

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
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  doHubDetails(doc);
  click(doc, "hub-continue");
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

  eq(api.helpers.phaseId(), "bgv", "at background verification");
  check(devText().indexOf("Mark BGV passed") >= 0 && devText().indexOf("Mark BGV failed") >= 0,
        "BGV: pass and fail actions offered");

  api.actions.bgvSet("failed");
  check(!!sel(doc, "#bgv-retry"), "failed BGV offers a resubmit route");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");

  check(devText().indexOf("set hub category") >= 0,
        "FM Cluster Head: hub category buttons offered (one per category)");
  api.config.FANOUT; // no-op, keeps the config surface referenced
  Object.keys(api.config.HUB_CATEGORIES).forEach(k => {
    check(devText().indexOf(api.config.HUB_CATEGORIES[k].label) >= 0,
          "category button present: " + api.config.HUB_CATEGORIES[k].label);
  });

  api.actions.chSetCategory("sah");
  const d2 = devText();
  check(d2.indexOf("Approve combined") >= 0, "FM CH: approve combined offered");
  check(d2.indexOf("Approve split") >= 0, "FM CH: approve split offered");
  check(d2.indexOf("above benchmark") >= 0, "FM CH: escalate-to-ZH offered");
  check(d2.indexOf("Reject") >= 0, "FM CH: reject offered");

  api.actions.chEscalate("combined", 9);
  const d3 = devText();
  check(d3.indexOf("Approve as ZH") >= 0, "ZH approve offered once escalated");
  check(d3.indexOf("Reject as ZH") >= 0, "ZH reject offered once escalated");

  /* LM-only actors */
  api.actions.switchRole();
  pickRole(doc, "LM");
  doPersonalDetails(doc);
  doKyc(doc, "LM");
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
  doHubDetails(doc, { address: "No. 42, Koramangala", map: "https://maps.google.com/?q=1,1" });
  click(doc, "hub-continue");
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
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  eq(api.helpers.phaseId(), "hub", "reached hub details");

  /* the three inputs are rendered, with every vehicle type selectable */
  check(exists(doc, "#hub-area"), "area input rendered");
  check(exists(doc, "#hub-manpower"), "manpower input rendered");
  check(exists(doc, "#veh-toggle"), "vehicle dropdown rendered");
  check(exists(doc, "#veh-panel"), "dropdown panel present");

  /* closed by default, and the panel is hidden rather than laid out */
  check(!api.helpers.vehUI().open, "dropdown starts closed");
  check($(doc, "veh-panel").hidden, "panel is hidden while closed");
  check(txt(doc).indexOf("Select vehicle types") >= 0, "closed control shows a placeholder");

  /* opening reveals every type exactly once, in list order */
  click(doc, "veh-toggle");
  check(api.helpers.vehUI().open, "clicking the control opens the dropdown");
  check(!$(doc, "veh-panel").hidden, "panel is visible once open");
  const opts = [...doc.querySelectorAll("#veh-list [data-veh]")].map(c => c.getAttribute("data-veh"));
  eq(opts.length, 24, "dropdown offers all 24 vehicle types");
  eq(opts, list, "dropdown options match the de-duplicated list, in order");
  check([...doc.querySelectorAll("#veh-list [data-veh]")].every(c => !c.checked),
        "nothing is selected to begin with");

  /* multi-select: several types at once, kept in list order, and toggleable off */
  api.actions.toggleVehicle("10MT_32FT");
  api.actions.toggleVehicle("2.2MT_4W_Bolero");
  api.actions.toggleVehicle("7MT_20FT");
  eq(api.helpers.R().hub.vehicles, ["2.2MT_4W_Bolero","7MT_20FT","10MT_32FT"],
     "multiple vehicle types can be chosen, stored in list order not click order");
  eq([...doc.querySelectorAll("#veh-list [data-veh]")].filter(c => c.checked).length, 3,
     "three rows show as checked");
  check(txt(doc).indexOf("3 of 24 selected") >= 0, "footer reports the count");
  api.actions.toggleVehicle("7MT_20FT");
  eq(api.helpers.R().hub.vehicles, ["2.2MT_4W_Bolero","10MT_32FT"],
     "ticking a selected type again removes it");

  /* the closed control summarises the selection instead of listing 24 chips */
  const toks = [...doc.querySelectorAll("#veh-toggle .ms-tok")].map(t => t.textContent);
  eq(toks, ["2.2MT_4W_Bolero","10MT_32FT"], "control shows the selected types as tokens");
  api.actions.setVehicles(list.slice(0, 6));
  eq([...doc.querySelectorAll("#veh-toggle .ms-tok")].length, 3,
     "control shows at most three tokens");
  check(sel(doc, "#veh-toggle .ms-more").textContent === "+3 more",
       "control summarises the remainder as '+N more'");
  api.actions.setVehicles(["2.2MT_4W_Bolero","10MT_32FT"]);

  /* search filters the list without closing or losing the selection */
  api.actions.filterVehicles("32FT");
  const filtered = [...doc.querySelectorAll("#veh-list [data-veh]")].map(c => c.getAttribute("data-veh"));
  eq(filtered, ["10MT_32FT"], "search narrows the list");
  check($(doc, "veh-list").querySelector('[data-veh="10MT_32FT"]').checked,
        "a filtered row keeps its checked state");
  api.actions.filterVehicles("nothingmatches");
  check(txt(doc).indexOf("No vehicle type matches") >= 0, "an empty search result says so");
  api.actions.filterVehicles("");
  eq([...doc.querySelectorAll("#veh-list [data-veh]")].length, 24, "clearing the search restores all");
  eq(api.helpers.R().hub.vehicles, ["2.2MT_4W_Bolero","10MT_32FT"],
     "searching never changes the selection");

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

  /* the max vehicle size is derived from the selection, not asked for separately */
  eq(api.helpers.largestVehicle(["2.2MT_4W_Bolero","10MT_32FT"]), "10MT_32FT",
     "largest of a selection is derived by tonnage");
  eq(api.helpers.largestVehicle(["0.8MT_4W_TataAce","1.5MT_4W_Dost"]), "1.5MT_4W_Dost",
     "fractional tonnages compare numerically, not as strings");
  eq(api.helpers.largestVehicle(["10MT_22FT","9MT_6W"]), "10MT_22FT",
     "10MT beats 9MT (string compare would get this wrong)");
  eq(api.helpers.largestVehicle([]), null, "empty selection has no largest");
  eq(api.helpers.vehicleTonnage("42MT_18W"), 42, "tonnage parsed from the type name");
  eq(api.helpers.vehicleTonnage("0.8MT_4W_TataAce"), 0.8, "fractional tonnage parsed");
  check(txt(doc).indexOf("Largest selected: 10MT_32FT") >= 0,
        "field shows the derived largest type live");

  /* select-all and clear */
  api.actions.openVehicles(true);
  api.actions.filterVehicles("");
  click(doc, "veh-all");
  eq(api.helpers.R().hub.vehicles.length, 24, "Select all picks every type");
  click(doc, "veh-none");
  eq(api.helpers.R().hub.vehicles, [], "Clear empties the selection");
  check(disabled(doc, "veh-none"), "Clear is disabled when nothing is selected");

  /* Select all respects an active search rather than ignoring it */
  api.actions.filterVehicles("MT_4W");
  const visible = [...doc.querySelectorAll("#veh-list [data-veh]")].map(c => c.getAttribute("data-veh"));
  click(doc, "veh-all");
  eq(api.helpers.R().hub.vehicles, list.filter(v => visible.indexOf(v) >= 0),
     "Select all with a search active picks only the visible types");
  api.actions.filterVehicles("");
  click(doc, "veh-none");

  /* an unknown type cannot be injected */
  api.actions.toggleVehicle("Lorry");
  eq(api.helpers.R().hub.vehicles, [], "a type outside the list is ignored");

  /* all three are required */
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
  doHubDetails(doc, { area: "4000", manpower: "12", vehicles: ["7MT_20FT"] });
  const h = api.helpers.R().hub;
  check(h.submitted, "valid facility details submit successfully");
  eq(h.areaSqft, "4000", "area recorded");
  eq(h.manpower, "12", "manpower recorded");
  eq(h.vehicles, ["7MT_20FT"], "vehicle selection recorded");
  body = txt(doc);
  check(body.indexOf("Area of the hub") >= 0 && body.indexOf("4,000 sq ft") >= 0,
        "summary shows the area, formatted");
  check(body.indexOf("Estimated manpower") >= 0, "summary shows manpower");
  check(body.indexOf("Max vehicle size") >= 0 && body.indexOf("7MT_20FT") >= 0,
        "summary shows the derived max vehicle size");
  check(body.indexOf("Vehicle types accommodated") >= 0,
        "summary lists the accommodated vehicle types");

  /* values survive a reopen after an AM rejection */
  click(doc, "hub-continue");
  api.actions.amReject("Loading bay too narrow.");
  click(doc, "am-fix-hub");
  eq($(doc, "hub-area").value, "4000", "area is prefilled on reopen");
  eq($(doc, "hub-manpower").value, "12", "manpower is prefilled on reopen");
  eq(api.helpers.R().hub.vehicles, ["7MT_20FT"], "vehicle selection is preserved on reopen");
  check(txt(doc).indexOf("7MT_20FT") >= 0, "the reopened control still shows the selection");

  /* FM captures the same three fields */
  api.actions.switchRole();
  pickRole(doc, "FM");
  doPersonalDetails(doc, { pin: "560076" });
  doKyc(doc, "FM");
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chSetCategory("standalone");
  api.actions.chApprove("combined");
  click(doc, "ch-continue");
  eq(api.helpers.phaseId(), "hub", "FM reached hub details");
  check(exists(doc, "#hub-area") && exists(doc, "#hub-manpower") && exists(doc, "#veh-toggle"),
        "FM hub details captures area, manpower and vehicle types too");
  doHubDetails(doc, { address: "Plot 7, Bommasandra", area: "6500",
                      manpower: "18", vehicles: ["2.2MT_4W_Bolero", "10MT_32FT"] });
  const fh = api.helpers.R().hub;
  eq([fh.areaSqft, fh.manpower, fh.vehicles], ["6500","18",["2.2MT_4W_Bolero","10MT_32FT"]],
     "FM records its own facility spec with multiple vehicle types");
  eq(api.helpers.largestVehicle(fh.vehicles), "10MT_32FT",
     "FM max vehicle size is derived from the selection");
  check(!fh.hubCode, "FM still gets no hub code at submit");
  check(txt(doc).indexOf("10MT_32FT") >= 0, "FM summary shows the max vehicle size");

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
  check(devText(doc).indexOf("New captain") >= 0, "'new captain' option offered");
  check(devText(doc).indexOf("Existing captain") >= 0, "'existing captain' option offered");

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
  check(sel(doc, '[data-choice="none"]').disabled,
        "Non-GST is not offered for an FM hub");
  check(txt(doc).indexOf("mandatory for First Mile") >= 0, "and says why");
  api.actions.addHubChoice("none");
  check(api.state.panel.addHub.choice !== "none", "choosing Non-GST for FM is refused");

  api.actions.addHubChoice("new");
  api.actions.addHubContinue();
  check(txt(doc).indexOf(E.gstin) >= 0, "a new GSTIN must be valid before continuing");
  eq(api.state.screen, "panel", "and the captain stays on the add-hub screen");

  /* --- the bridge back into the ORIGINAL onboarding flow --- */
  api.actions.addHubRole("LM");
  api.actions.addHubChoice("existing");
  const hubsBefore = api.state.hubs.length;
  click(doc, "addhub-go");
  eq(api.state.screen, "flow", "Add new hub hands off to the onboarding flow");
  eq(api.state.activeRole, "LM", "into the role chosen for the new hub");
  eq(api.helpers.phaseId(), "ch", "starting at Cluster Head review, the first hub-specific phase");

  const nr = api.helpers.R();
  check(nr.pd.name === "Karan Verma" && nr.pd.emailVerified,
        "personal details carry over from the captain record");
  check(nr.kyc.aadhaar.done && nr.kyc.pan.done && nr.kyc.bank.done,
        "KYC carries over and is not asked again");
  eq(nr.bgv.status, "passed", "background verification carries over");
  eq(nr.kyc.gst.gstin, "29ABCDE1234F1Z5", "the chosen GSTIN is applied to the new hub");
  check(txt(doc).indexOf("Cluster Head review") >= 0, "the onboarding rail is back on screen");

  /* finish it and confirm the hub joins My Hubs */
  api.actions.chApprove();
  click(doc, "ch-continue");
  click(doc, "sd-pay");
  click(doc, "sd-continue");
  api.helpers.R().pd.selected = "560076";
  doHubDetails(doc, { address: "12, 1st Main, Jayanagar, Bengaluru" });
  click(doc, "hub-continue");
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
  api.actions.bgvSet("passed");
  click(doc, "bgv-continue");
  api.actions.chSetCategory("standalone");
  api.actions.chApprove("combined");
  click(doc, "ch-continue");
  doHubDetails(doc, { address: "Plot 7, Bommasandra" });
  click(doc, "hub-continue");
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

/* ------------------------------------------------------------------ run --- */

(async function run() {
  const t0 = Date.now();
  try {
    await testLM();
    await testFMCombined();
    await testFMEscalation();
    await testRoleIndependence();
    await testValidation();
    await testOtpFocusSurvivesCountdown();
    await testAmTwoStrike();
    await testCeilings();
    await testDevPanel();
    await testBulkPincodes();
    await testHubFacilityInputs();
    await testCaptainHub();
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
