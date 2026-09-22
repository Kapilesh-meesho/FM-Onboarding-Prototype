const H=s=>({r:parseInt(s.slice(0,2),16)/255,g:parseInt(s.slice(2,4),16)/255,b:parseInt(s.slice(4,6),16)/255,o:s.length>6?parseInt(s.slice(6,8),16)/255:1});
const WS={100:"Thin",200:"Extra Light",300:"Light",400:"Regular",500:"Medium",600:"Semi Bold",700:"Bold",800:"Extra Bold",900:"Black"};
const FS=w=>WS[Math.min(900,Math.max(100,Math.round(w/100)*100))]||"Regular";
async function build(D,ox,oy,imgHash){
  const P=D.P.map(H);
  const ST=D.S.map(s=>{const p=s.split("|");return{sz:+p[0],wt:+p[1],ci:+p[2],lh:p[3]===""?null:+p[3],ls:+p[4]||0,al:p[5],de:p[6],tr:p[7]};});
  const styles=new Set(ST.map(s=>FS(s.wt))); styles.add("Regular"); styles.add("Bold");
  for(const st of styles) await figma.loadFontAsync({family:"Inter",style:st});
  const pf=i=>i<0?[]:[{type:"SOLID",color:{r:P[i].r,g:P[i].g,b:P[i].b},opacity:P[i].o}];
  const root=figma.createFrame();
  root.name=D.n; root.x=ox; root.y=oy; root.resize(D.w,D.h);
  root.fills=[{type:"SOLID",color:{r:1,g:1,b:1}}]; root.clipsContent=true;
  let count=0;
  const mk=(n,parent)=>{
    count++;
    if(n[0]===1){
      const s=ST[n[4]]||{sz:12,wt:400,ci:-1};
      const t=figma.createText();
      parent.appendChild(t);
      t.fontName={family:"Inter",style:FS(s.wt)};
      t.fontSize=Math.max(1,s.sz||12);
      if(s.lh) t.lineHeight={unit:"PIXELS",value:s.lh};
      if(s.ls) t.letterSpacing={unit:"PIXELS",value:s.ls};
      if(s.tr==="uppercase") t.textCase="UPPER";
      if(s.de&&s.de!=="none") t.textDecoration=/line-through/.test(s.de)?"STRIKETHROUGH":"UNDERLINE";
      t.characters=n[1];
      if(s.ci>=0) t.fills=pf(s.ci);
      if(n.length>5){ t.textAutoResize=n[6]?"HEIGHT":"NONE"; t.resize(Math.max(1,n[5]),n[6]?t.height:Math.max(1,(s.lh||s.sz*1.35))); if(n[6])t.textAutoResize="HEIGHT"; }
      else t.textAutoResize="WIDTH_AND_HEIGHT";
      if(/center/.test(s.al))t.textAlignHorizontal="CENTER"; else if(/right|end/.test(s.al))t.textAlignHorizontal="RIGHT";
      t.x=n[2]; t.y=n[3]; t.name=n[1].slice(0,28)||"text";
      /* Figma's Inter measures a shade wider than Chrome's, so a box sized to
         the browser's ink width can wrap a line that fitted before. Give every
         fixed-width run some slack, keeping its alignment anchor in place. */
      if(t.textAutoResize==="NONE"){ var pad=10;
        if(t.textAlignHorizontal==="CENTER") t.x-=pad/2; else if(t.textAlignHorizontal==="RIGHT") t.x-=pad;
        t.resize(t.width+pad,t.height); }
      return;
    }
    if(n[0]===2){
      const r=figma.createRectangle(); parent.appendChild(r);
      r.resize(Math.max(1,n[3]),Math.max(1,n[4])); r.x=n[1]; r.y=n[2]; r.name="Valmo logo";
      r.fills=imgHash?[{type:"IMAGE",imageHash:imgHash,scaleMode:"FIT"}]:[{type:"SOLID",color:{r:.9,g:.9,b:.92}}];
      return;
    }
    const f=figma.createFrame(); parent.appendChild(f);
    f.resize(Math.max(.01,n[4]),Math.max(.01,n[5])); f.x=n[2]; f.y=n[3];
    f.name=n[1]||"frame";
    const gr=n[12];
    if(gr&&gr.length){
      const a=(gr[0]-90)*Math.PI/180, c=Math.cos(a), s2=Math.sin(a);
      f.fills=[{type:"GRADIENT_LINEAR",gradientTransform:[[c,s2,.5-(c+s2)/2],[-s2,c,.5-(c-s2)/2]],
        gradientStops:gr[1].map((ci,k)=>({position:k/(gr[1].length-1),color:{r:P[ci].r,g:P[ci].g,b:P[ci].b,a:P[ci].o}}))}];
    } else f.fills=pf(n[6]);
    const rad=n[7];
    if(rad){ if(Array.isArray(rad)){f.topLeftRadius=Math.min(rad[0],999);f.topRightRadius=Math.min(rad[1],999);f.bottomRightRadius=Math.min(rad[2],999);f.bottomLeftRadius=Math.min(rad[3],999);} else f.cornerRadius=Math.min(rad,Math.max(n[4],n[5])/2); }
    const bd=n[8];
    if(bd){
      if(typeof bd[0]==="number"){ f.strokes=pf(bd[1]); f.strokeWeight=Math.max(.5,bd[0]); f.strokeAlign="INSIDE"; }
      else { const first=bd.find(x=>x); f.strokes=pf(first[1]); f.strokeAlign="INSIDE";
        f.strokeTopWeight=bd[0]?bd[0][0]:0; f.strokeRightWeight=bd[1]?bd[1][0]:0;
        f.strokeBottomWeight=bd[2]?bd[2][0]:0; f.strokeLeftWeight=bd[3]?bd[3][0]:0; }
    } else f.strokes=[];
    const sh=n[9];
    if(sh&&sh.length) f.effects=sh.map(e=>({type:"DROP_SHADOW",offset:{x:e[0],y:e[1]},radius:e[2],spread:e[3],color:{r:P[e[4]].r,g:P[e[4]].g,b:P[e[4]].b,a:P[e[4]].o},visible:true,blendMode:"NORMAL"}));
    f.clipsContent=!!n[10];
    if(n[11]) f.opacity=n[11];
    (n[13]||[]).forEach(k=>mk(k,f));
    raise(f);
  };

  /* The prototype's floating field labels are position:absolute, so CSS paints
     them over the input box they straddle. Document order puts the box on top,
     so re-append anything a later opaque sibling covers. */
  const opaque=(x)=>Array.isArray(x.fills)&&x.fills.some(p=>p.visible!==false&&p.type==="SOLID"&&(p.opacity===undefined||p.opacity>0.9));
  const olap=(a,b)=>{const w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),
    h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    return w>0&&h>0?(w*h)/Math.max(1,a.width*a.height):0;};
  const raise=(parent)=>{
    const kids=[...parent.children];
    for(let i=0;i<kids.length;i++){
      const c=kids[i];
      if(!(c.type==="TEXT"||c.name==="label"||c.name==="sl")||c.width<1||c.height<1) continue;
      if(kids.slice(i+1).some(x=>(x.type==="FRAME"||x.type==="RECTANGLE")&&opaque(x)&&olap(c,x)>0.25))
        parent.appendChild(c);
    }
  };
  (D.c||[]).forEach(n=>mk(n,root));
  raise(root);
  return {id:root.id,name:D.n,nodes:count};
}
