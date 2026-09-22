/* Drives the prototype in headless Chrome and writes one JSON per screen.
   Real Chrome because the capture needs layout: jsdom has none, so every
   getBoundingClientRect would come back zero. */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE = "file://" + path.resolve("/Users/kapilesh1/Projects/FM-Onboarding-Prototype/index.html");
const EXTRACT = fs.readFileSync(path.join(__dirname, "extract.js"), "utf8");
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

/* the helpers the page-side driver gets, mirroring test.js */
const HELPERS = `
  const doc = document, win = window, api = window.__APP__;
  const $ = (id) => doc.getElementById(id);
  const sel = (q) => doc.querySelector(q);
  const click = (id) => { const e=$(id); if(!e) throw new Error("click #"+id); e.dispatchEvent(new MouseEvent("click",{bubbles:true})); };
  const clickSel = (q) => { const e=sel(q); if(!e) throw new Error("click "+q); e.dispatchEvent(new MouseEvent("click",{bubbles:true})); };
  const type = (id,v) => { const e=$(id); if(!e) throw new Error("type #"+id); e.value=v; e.dispatchEvent(new Event("input",{bubbles:true})); };
  const setCheck = (id,v) => { const e=$(id); e.checked=v; e.dispatchEvent(new Event("change",{bubbles:true})); };
  const dev = (a) => clickSel('[data-dev="'+a+'"]');
  const login = (phone) => {
    type("phone", phone || "7004301290"); click("go-otp");
    for (let i=0;i<6;i++){ const c=sel('.otp-cell[data-i="'+i+'"]'); c.value="0"; c.dispatchEvent(new Event("input",{bubbles:true})); }
    click("verify-otp");
  };
  const personal = (pin) => {
    pin = pin || "560076";
    type("pd-name","Karan Verma"); type("pd-alt","9876543210");
    type("pd-email","karan.verma@gmail.com"); click("pd-verify-email");
    type("pd-email-otp","000000"); click("pd-email-otp-go");
    type("pd-pin",pin); click("pd-addpin"); click("pd-check");
    clickSel('[data-selpin="'+pin+'"]'); click("pd-continue");
  };
  const kyc = (role) => {
    type("kyc-aadhaar","123412341234"); click("kyc-aadhaar-go");
    type("kyc-aadhaar-otp","000000"); click("kyc-aadhaar-confirm"); click("kyc-ack-aadhaar");
    type("kyc-pan","ABCDE1234F"); type("kyc-pan-father","Suresh Verma");
    click("kyc-pan-go"); click("kyc-ack-pan");
    type("kyc-acc","123456789012"); type("kyc-ifsc","HDFC0001234");
    click("kyc-bank-go"); click("kyc-ack-bank");
    if (role === "FM") { clickSel('[data-gstchoice="registered"]'); type("kyc-gstin","29ABCDE1234F1Z5"); click("kyc-gst-go"); }
    else { clickSel('[data-gstchoice="none"]'); click("kyc-gst-go"); }
    click("kyc-continue");
  };
  const vehicle = (t) => {
    if (!api.helpers.vehUI().open) click("veh-toggle");
    clickSel('#veh-list [data-veh="'+t+'"]');
  };
  const hub = (o) => {
    o = o || {};
    type("hub-address", o.address || "No. 42, 4th Cross, Koramangala, Bengaluru");
    type("hub-map","https://maps.google.com/?q=12.9352,77.6245");
    type("hub-area","4000"); type("hub-manpower","12");
    vehicle("7MT_20FT");
  };
  const agreements = () => {
    setCheck("ag-rate", true); api.actions.markAgreementRead(); setCheck("ag-service", true);
  };
`;

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  const manifest = [];

  async function boot() {
    await page.goto(FILE, { waitUntil: "load" });
    await page.evaluate("localStorage.clear()");
    await page.reload({ waitUntil: "load" });
    await page.evaluate(EXTRACT);
    await page.waitForFunction("!!window.__APP__ && !!document.getElementById('app').firstChild");
  }

  /* runs a page-side step, then captures whatever is on screen */
  async function step(name, body) {
    const err = await page.evaluate(new Function(`${HELPERS}\ntry{ ${body} }catch(e){ return e.message } return null`));
    if (err) throw new Error(`${name}: ${err}`);
    await new Promise((r) => setTimeout(r, 60));
    /* Shells are min-height:100vh, so measuring the app box and resizing to it
       is circular — scrollHeight only exceeds the viewport when content really
       overflows, so grow from that and settle once. */
    for (let i = 0; i < 3; i++) {
      const sh = await page.evaluate("document.documentElement.scrollHeight");
      const vh = await page.evaluate("window.innerHeight");
      if (sh <= vh + 2) break;
      await page.setViewport({ width: 1440, height: Math.min(sh + 8, 7000) });
      await new Promise((r) => setTimeout(r, 70));
    }
    const shot = await page.evaluate(`window.__CAP__({name: ${JSON.stringify(name)}})`);
    const file = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".json";
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(shot));
    manifest.push({ name, file, w: shot.w, h: shot.h,
                    bytes: fs.statSync(path.join(OUT, file)).size });
    await page.setViewport({ width: 1440, height: 1000 });
    process.stdout.write(`  ✓ ${name} (${shot.w}×${shot.h})\n`);
  }

  const FLOWS = require("./flows.js");
  for (const flow of FLOWS) {
    console.log(`\n${flow.page}`);
    await boot();
    for (const s of flow.steps) await step(s[0], s[1]);
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} screens · ${(manifest.reduce((a, m) => a + m.bytes, 0) / 1024 / 1024).toFixed(1)} MB`);
  await browser.close();
}

run().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
