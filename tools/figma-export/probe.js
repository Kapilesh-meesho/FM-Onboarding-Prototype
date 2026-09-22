const puppeteer=require("puppeteer-core"),fs=require("fs"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE="file:///Users/kapilesh1/Projects/FM-Onboarding-Prototype/index.html";
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox"]});
 const p=await b.newPage(); await p.setViewport({width:1440,height:1000});
 await p.goto(FILE,{waitUntil:"load"}); await p.evaluate("localStorage.clear()");
 await p.reload({waitUntil:"load"});
 const body = process.argv[2];
 const out = await p.evaluate(new Function(`
  const doc=document,api=window.__APP__;
  const $=(i)=>doc.getElementById(i), sel=(q)=>doc.querySelector(q);
  const click=(i)=>{const e=$(i); if(!e) throw new Error("click #"+i); e.dispatchEvent(new MouseEvent("click",{bubbles:true}));};
  const clickSel=(q)=>{const e=sel(q); if(!e) throw new Error("click "+q); e.dispatchEvent(new MouseEvent("click",{bubbles:true}));};
  const type=(i,v)=>{const e=$(i); e.value=v; e.dispatchEvent(new Event("input",{bubbles:true}));};
  const setCheck=(i,v)=>{const e=$(i); e.checked=v; e.dispatchEvent(new Event("change",{bubbles:true}));};
  const dev=(a)=>clickSel('[data-dev="'+a+'"]');
  const login=(ph)=>{type("phone",ph||"7004301290");click("go-otp");for(let i=0;i<6;i++){const c=sel('.otp-cell[data-i="'+i+'"]');c.value="0";c.dispatchEvent(new Event("input",{bubbles:true}));}click("verify-otp");};
  const vehicle=(t)=>{if(!api.helpers.vehUI().open)click("veh-toggle");clickSel('#veh-list [data-veh="'+t+'"]');};
  ${body}
  let ph=null; try{ ph=api.helpers.phaseId(); }catch(e){}
  return { phase: ph,
           ids: [...doc.querySelectorAll("#app [id]")].map(e=>e.id),
           testids: [...doc.querySelectorAll("#app [data-testid]")].map(e=>e.getAttribute("data-testid")),
           apopen: [...doc.querySelectorAll("[data-apopen]")].map(e=>e.getAttribute("data-apopen")),
           tabs: [...doc.querySelectorAll("[data-aptab]")].map(e=>e.getAttribute("data-aptab")),
           text: doc.getElementById("app").textContent.replace(/\\s+/g," ").slice(0,400) };
 `));
 console.log(JSON.stringify(out,null,1));
 await b.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
