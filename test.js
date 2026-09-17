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

function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  const win = dom.window;
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
  const { win, doc, api } = boot();

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

  type(doc, "hub-address", "No. 42, 4th Cross, Koramangala, Bengaluru");
  type(doc, "hub-map", "https://maps.google.com/?q=12.9352,77.6245");
  click(doc, "hub-submit");
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
  const { win, doc, api } = boot();

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

  type(doc, "hub-address", "Plot 7, Bommasandra Industrial Area, Bengaluru");
  type(doc, "hub-map", "https://maps.google.com/?q=12.8156,77.6982");
  click(doc, "hub-submit");
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
  const { win, doc, api } = boot();

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
  const { win, doc, api } = boot();

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
  const { win, doc, api } = boot();
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
   6. LM two-strike Area Manager rule
   ====================================================================== */

async function testAmTwoStrike() {
  section("6. LM Area Manager two-strike rule");
  const { win, doc, api } = boot();

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
  type(doc, "hub-address", "No. 42, 4th Cross, Koramangala, Bengaluru");
  type(doc, "hub-map", "https://maps.google.com/?q=12.9352,77.6245");
  click(doc, "hub-submit");
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

  type(doc, "hub-address", "No. 42, 4th Cross, Koramangala, Bengaluru (rear gate)");
  type(doc, "hub-map", "https://maps.google.com/?q=12.9352,77.6245");
  click(doc, "hub-submit");
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
  const { win, api } = boot();
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
  const { win, doc, api } = boot();

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
  type(doc, "hub-address", "No. 42, Koramangala");
  type(doc, "hub-map", "https://maps.google.com/?q=1,1");
  click(doc, "hub-submit");
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

/* ------------------------------------------------------------------ run --- */

(async function run() {
  const t0 = Date.now();
  try {
    await testLM();
    await testFMCombined();
    await testFMEscalation();
    await testRoleIndependence();
    await testValidation();
    await testAmTwoStrike();
    await testCeilings();
    await testDevPanel();
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
