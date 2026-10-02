
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const categories = ["Hotel","Taxi/Uber","Restaurant","Train","Flight","Parking","Fuel","Entertainment","Other"];
const catRules = [
  ["Taxi/Uber",/(uber|taxi|grab|bolt|lyft|cab|タクシー|แท็กซี่)/i],
  ["Hotel",/(hotel|hilton|marriott|hyatt|sheraton|westin|inn|resort|ホテル)/i],
  ["Train",/(rail|train|jr |metro|subway|shinkansen|station|鉄道|新幹線|地下鉄)/i],
  ["Flight",/(airline|airways|airport|flight|航空|空港)/i],
  ["Parking",/(parking|park fee|駐車)/i],
  ["Fuel",/(shell|esso|bp |gasoline|petrol|fuel|ガソリン)/i],
  ["Restaurant",/(restaurant|cafe|coffee|dining|bar |bistro|izakaya|sushi|ramen|steak|food|レストラン|居酒屋|อาหาร|ร้าน)/i],
  ["Entertainment",/(museum|ticket|show|theatre|theater|club|spa|massage|entertainment)/i]
];
let settings = Object.assign({
  trip:"Current Trip",
  cards:["Corporate Card","Personal Card","Cash"],
  defaultCard:"Corporate Card",
  reverseGeo:true
}, JSON.parse(localStorage.getItem("tep_settings") || "{}"));

let current = freshCurrent();
let scanning = false;
function freshCurrent(){ return {imageBlob:null,imageHash:null,thumbUrl:"",category:null,card:null,ocrText:"",fields:{},location:null,place:"",geoCountry:"",geoCode:"",startedAt:null}; }

const DBNAME="trip_expense_pro", STORE="expenses";
function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DBNAME,1);
    r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE,{keyPath:"id"}); };
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function dbPut(v){ const db=await openDB(); return new Promise((res,rej)=>{const t=db.transaction(STORE,"readwrite");t.objectStore(STORE).put(v);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)}); }
async function dbAll(){ const db=await openDB(); return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}); }
async function dbDelete(id){ const db=await openDB(); return new Promise((res,rej)=>{const t=db.transaction(STORE,"readwrite");t.objectStore(STORE).delete(id);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)}); }

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function money(a,c){ return a ? `${c||""} ${Number(a).toLocaleString(undefined,{maximumFractionDigits:2})}`.trim() : "—"; }
function slug(s){return String(s||"item").normalize("NFKD").replace(/[^\w\-]+/g,"_").replace(/_+/g,"_").slice(0,55)}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}
function setProgress(p,msg){$("#progressBar").style.width=`${Math.max(4,Math.min(100,p))}%`; if(msg)$("#progressText").textContent=msg;}

function showView(id){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".bottomNav button").forEach(b=>b.classList.toggle("active",b.dataset.nav===id));
  if(id==="expensesView") renderAllExpenses();
  if(id==="reviewView") renderReview();
}
$$("[data-nav]").forEach(b=>b.onclick=()=>showView(b.dataset.nav));
$$("[data-back]").forEach(b=>b.onclick=()=>showView("homeView"));
$("#seeAllBtn").onclick=()=>showView("expensesView");
$("#openReviewBtn").onclick=()=>showView("reviewView");

function renderCategoryChips(){
  $("#categoryChips").innerHTML=categories.map(c=>`<button class="chip" data-cat="${c}">${c}</button>`).join("");
  $$("[data-cat]").forEach(b=>b.onclick=()=>chooseCategory(b.dataset.cat));
}
function renderCardChips(){
  $("#cardChips").innerHTML=settings.cards.map(c=>`<button class="chip" data-card="${esc(c)}">${esc(c)}</button>`).join("");
  $$("[data-card]").forEach(b=>b.onclick=()=>chooseCard(b.dataset.card));
  if(settings.defaultCard && settings.cards.includes(settings.defaultCard)) chooseCard(settings.defaultCard,true);
}
function chooseCategory(cat,silent=false){
  current.category=cat;
  $$("[data-cat]").forEach(b=>b.classList.toggle("selected",b.dataset.cat===cat));
  if(!silent) maybeAutoSave();
}
function chooseCard(card,silent=false){
  current.card=card;
  $$("[data-card]").forEach(b=>b.classList.toggle("selected",b.dataset.card===card));
  if(!silent) maybeAutoSave();
}

$("#cameraBtn").onclick=()=>$("#cameraInput").click();
$("#libraryBtn").onclick=()=>$("#libraryInput").click();
$("#cameraInput").onchange=e=>handleFile(e.target.files?.[0],"camera");
$("#libraryInput").onchange=e=>handleFile(e.target.files?.[0],"library");
$("#cancelScanBtn").onclick=resetScan;

async function handleFile(file,source="camera"){
  if(!file || scanning) return;
  scanning=true; current=freshCurrent(); current.startedAt=new Date().toISOString(); current.source=source;
  $("#scanPanel").classList.remove("hidden"); $("#receiptPreview").src=URL.createObjectURL(file);
  renderCategoryChips(); renderCardChips(); $("#liveFacts").innerHTML="";
  $("#categorySuggestion").classList.add("hidden");
  setProgress(6,"מכין תמונה…");
  try{
    const [compressed, loc] = await Promise.all([compressImage(file), source==="camera" ? getLocation() : Promise.resolve(null)]);
    current.imageBlob=compressed;
    current.thumbUrl=URL.createObjectURL(compressed);
    current.imageHash=await sha256(compressed);
    current.location=loc;
    const region=inferRegion(loc);
    current.geoCountry=region.country; current.geoCode=region.code;
    setProgress(18,`מיקום זוהה${region.country?": "+region.country:""}`);
    if(settings.reverseGeo && loc) reverseGeocode(loc).then(place=>{ if(place){current.place=place;renderLiveFacts()} }).catch(()=>{});
    const lang=ocrLanguage(region.code);
    setProgress(24,`OCR ${langLabel(lang)}…`);
    const worker=await Tesseract.createWorker(lang,1,{
      logger:m=>{
        if(m.status==="recognizing text"){
          setProgress(25 + Math.round((m.progress||0)*62),`קורא את הקבלה… ${Math.round((m.progress||0)*100)}%`);
        }
      }
    });
    const ret=await worker.recognize(URL.createObjectURL(compressed));
    await worker.terminate();
    current.ocrText=ret.data.text||"";
    current.fields=parseReceipt(current.ocrText, region, ret.data.confidence||0, current.source);
    current.fields.note=buildAutoNote(current.fields);
    suggestCategory();
    renderLiveFacts();
    setProgress(100,"הקבלה מוכנה — בחר סוג הוצאה וכרטיס");
    maybeAutoSave();
  }catch(err){
    console.error(err);
    current.fields={merchant:"",amount:"",currency:inferRegion(current.location).currency||"",date:new Date().toISOString().slice(0,10),overallConfidence:0,fieldConfidence:{}};
    renderLiveFacts();
    setProgress(100,"OCR לא הושלם. אפשר לשמור ולבדוק אחר כך.");
  }finally{ scanning=false; }
}

function resetScan(){
  current=freshCurrent(); scanning=false;
  $("#scanPanel").classList.add("hidden");
  $("#cameraInput").value=""; $("#libraryInput").value="";
  $("#progressBar").style.width="4%";
}

async function maybeAutoSave(){
  if(scanning) return;
  if(!current.imageBlob || !current.category || !current.card || current._saved) return;
  current._saved=true;
  const all=await dbAll();
  const dup=detectDuplicate(all,current);
  const f=current.fields||{};
  const rec={
    id:crypto.randomUUID(), createdAt:new Date().toISOString(), trip:settings.trip,
    category:current.category, card:current.card, merchant:f.merchant||"",
    amount:f.amount||"", currency:f.currency||"", date:f.date||"",
    tax:f.tax||"", tip:f.tip||"", place:current.place||current.geoCountry||"",
    location:current.location, ocrText:current.ocrText, imageHash:current.imageHash, imageBlob:current.imageBlob,
    note:f.note||buildAutoNote(f), fieldConfidence:f.fieldConfidence||{},
    overallConfidence:f.overallConfidence||0, duplicateOf:dup?.id||null,
    needsReview:needsReview(f,dup)
  };
  await dbPut(rec);
  settings.defaultCard=current.card;
  localStorage.setItem("tep_settings",JSON.stringify(settings));
  toast(rec.needsReview ? "נשמר — מסומן לבדיקה" : "נשמר אוטומטית ✓");
  resetScan(); await refreshHome();
}

function needsReview(f,dup){
  return !!dup || !f.amount || !f.currency || !f.merchant || (f.overallConfidence||0)<68 ||
    (f.fieldConfidence?.amount??0)<65 || (f.fieldConfidence?.currency??0)<65;
}
function detectDuplicate(all,c){
  const f=c.fields||{};
  return all.find(x=>{
    if(x.imageHash && x.imageHash===c.imageHash) return true;
    const sameAmt=f.amount && x.amount && Math.abs(Number(f.amount)-Number(x.amount))<0.01;
    const sameDate=f.date && x.date===f.date;
    const m1=(f.merchant||"").toLowerCase(),m2=(x.merchant||"").toLowerCase();
    const sameMerchant=m1 && m2 && (m1.includes(m2)||m2.includes(m1));
    return sameAmt && sameDate && sameMerchant;
  });
}

async function compressImage(file){
  const bmp=await createImageBitmap(file);
  const maxSide=1900, scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const c=$("#workCanvas"); c.width=Math.round(bmp.width*scale); c.height=Math.round(bmp.height*scale);
  const ctx=c.getContext("2d",{willReadFrequently:true}); ctx.drawImage(bmp,0,0,c.width,c.height);
  const d=ctx.getImageData(0,0,c.width,c.height), a=d.data;
  for(let i=0;i<a.length;i+=4){
    let y=.299*a[i]+.587*a[i+1]+.114*a[i+2];
    const contrast=1.18; y=Math.max(0,Math.min(255,(y-128)*contrast+128));
    a[i]=a[i+1]=a[i+2]=y;
  }
  ctx.putImageData(d,0,0);
  return await new Promise(res=>c.toBlob(res,"image/jpeg",.86));
}
async function sha256(blob){
  const h=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function getLocation(){
  return new Promise(resolve=>{
    if(!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}),
      ()=>resolve(null),{enableHighAccuracy:true,timeout:7000,maximumAge:120000}
    );
  });
}
function inferRegion(loc){
  if(!loc) return {code:"",country:"",currency:""};
  const {lat,lon}=loc;
  const boxes=[
    ["JP","Japan","JPY",24,46,122,146],
    ["TH","Thailand","THB",5,21,97,106],
    ["IL","Israel","ILS",29,34,34,36],
    ["GB","United Kingdom","GBP",49,61,-9,3],
    ["US","United States","USD",24,50,-126,-66],
    ["CA","Canada","CAD",41,84,-141,-52],
    ["AU","Australia","AUD",-44,-10,112,154],
    ["SG","Singapore","SGD",1,2,103,104],
    ["KR","South Korea","KRW",33,39,124,132],
    ["DE","Germany","EUR",47,55,5,16],
    ["FR","France","EUR",41,52,-6,10],
    ["IT","Italy","EUR",35,48,6,19],
    ["ES","Spain","EUR",35,44,-10,4],
    ["NL","Netherlands","EUR",50,54,3,8],
    ["BE","Belgium","EUR",49,52,2,7]
  ];
  for(const [code,country,currency,minLat,maxLat,minLon,maxLon] of boxes)
    if(lat>=minLat&&lat<=maxLat&&lon>=minLon&&lon<=maxLon) return {code,country,currency};
  return {code:"",country:"",currency:""};
}
function ocrLanguage(code){
  if(code==="JP") return "eng+jpn";
  if(code==="TH") return "eng+tha";
  if(code==="IL") return "eng+heb";
  if(code==="KR") return "eng+kor";
  return "eng";
}
function langLabel(l){return l.replace("eng","English").replace("jpn","Japanese").replace("tha","Thai").replace("heb","Hebrew").replace("kor","Korean")}
async function reverseGeocode(loc){
  const key=`geo_${loc.lat.toFixed(3)}_${loc.lon.toFixed(3)}`;
  const cached=localStorage.getItem(key); if(cached)return cached;
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),4500);
  const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${loc.lat}&lon=${loc.lon}&zoom=10&accept-language=en`;
  const r=await fetch(u,{headers:{"Accept":"application/json"},signal:ctl.signal}); clearTimeout(timer);
  if(!r.ok) return "";
  const j=await r.json(), a=j.address||{};
  const city=a.city||a.town||a.village||a.county||"", country=a.country||"";
  const place=[city,country].filter(Boolean).join(", ");
  if(place) localStorage.setItem(key,place);
  return place;
}

function parseReceipt(text, region, rawConf, source="camera"){
  const lines=text.split(/\r?\n/).map(s=>s.replace(/\s+/g," ").trim()).filter(Boolean);
  const joined=lines.join(" ");
  const merchant=findMerchant(lines);
  const amountObj=findTotal(lines);
  const currencyObj=detectCurrency(joined,region,source);
  const dateObj=findDate(joined,region.code);
  const taxObj=findNamedAmount(lines,/(tax|vat|gst|consumption tax|消費税|税額|ภาษี|מע.?מ)/i);
  const tipObj=findNamedAmount(lines,/(tip|gratuity|service charge|service|チップ|サービス料|טיפ)/i);
  const overall=Math.round(clamp((rawConf*.38)+(amountObj.conf*.22)+(merchant.conf*.14)+(dateObj.conf*.12)+(currencyObj.conf*.14),0,100));
  return {
    merchant:merchant.value, amount:amountObj.value, currency:currencyObj.value,
    date:dateObj.value, tax:taxObj.value, tip:tipObj.value,
    overallConfidence:overall,
    fieldConfidence:{merchant:merchant.conf,amount:amountObj.conf,currency:currencyObj.conf,date:dateObj.conf,tax:taxObj.conf,tip:tipObj.conf}
  };
}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function detectCurrency(t,region,source="camera"){
  // Currency is deliberately inferred from several independent signals.
  // A single OCR'd glyph such as "$" -> "¥" is NOT allowed to decide the result.
  const score={USD:0,JPY:0,EUR:0,GBP:0,THB:0,ILS:0,KRW:0,AUD:0,CAD:0,SGD:0,CNY:0};
  const add=(c,n)=>{ if(score[c]!==undefined) score[c]+=n; };
  const has=r=>r.test(t);

  // Explicit ISO / textual currency codes are the strongest evidence.
  const explicit=[
    ["USD",/\bUSD\b|US\s*DOLLARS?|U\.?S\.?\s*DOLLARS?/i],
    ["JPY",/\bJPY\b|JAPANESE\s+YEN/i],
    ["EUR",/\bEUR\b|EUROS?/i],
    ["GBP",/\bGBP\b|POUNDS?\s+STERLING/i],
    ["THB",/\bTHB\b|BAHT/i],
    ["ILS",/\bILS\b|NIS\b/i],
    ["KRW",/\bKRW\b/i],
    ["AUD",/\bAUD\b/i],
    ["CAD",/\bCAD\b/i],
    ["SGD",/\bSGD\b/i],
    ["CNY",/\bCNY\b|RMB\b/i]
  ];
  for(const [c,r] of explicit) if(has(r)) add(c,140);

  // Unambiguous or qualified symbols.
  if(has(/US\s*\$/i)) add("USD",125);
  if(has(/CA\s*\$|C\$/i)) add("CAD",125);
  if(has(/AU\s*\$|A\$/i)) add("AUD",125);
  if(has(/SG\s*\$|S\$/i)) add("SGD",125);
  if(has(/€/)) add("EUR",110);
  if(has(/£/)) add("GBP",110);
  if(has(/฿/)) add("THB",110);
  if(has(/₪|ש.?ח/)) add("ILS",110);
  if(has(/₩|원/)) add("KRW",110);
  if(has(/円/)) add("JPY",125);      // Japanese ideograph is strong evidence.
  if(has(/¥|￥/)) add("JPY",45);     // Weak: OCR often confuses $ and ¥.
  if(has(/\$/)) add("USD",55);       // Plain $ is common in US receipts but not unique.

  // Receipt-address / language context.
  if(has(/\b(UNITED STATES|U\.?S\.?A\.?|USA)\b/i)) add("USD",100);
  if(has(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(?:-\d{4})?\b/)) add("USD",80);
  if(has(/\b(PARKING|PARKING GARAGE|PARKING LOT|SALES TAX)\b/i) && has(/\d+\.\d{2}\b/)) add("USD",30);

  if(has(/\b(JAPAN|TOKYO|OSAKA|NAGOYA|YOKOHAMA|KYOTO)\b/i)) add("JPY",90);
  if(has(/[ぁ-んァ-ン一-龯]/) || has(/〒/)) add("JPY",65);
  if(has(/\bTHAILAND\b/i) || has(/[ก-๙]/)) add("THB",80);
  if(has(/\bISRAEL\b/i) || has(/[א-ת]/)) add("ILS",70);
  if(has(/\bUNITED KINGDOM|ENGLAND|SCOTLAND|WALES\b/i)) add("GBP",75);
  if(has(/\bCANADA\b/i)) add("CAD",75);
  if(has(/\bAUSTRALIA\b/i)) add("AUD",75);
  if(has(/\bSINGAPORE\b/i)) add("SGD",75);
  if(has(/\bKOREA\b/i) || has(/[가-힣]/)) add("KRW",75);
  if(has(/\bCHINA\b/i) || has(/人民币|人民幣/)) add("CNY",75);

  // Decimal cents are common on USD receipts and uncommon on ordinary JPY totals.
  // If OCR saw a yen glyph next to e.g. 50.00 in an English receipt, discount the yen guess.
  if(has(/[¥￥]\s*\d+[.,]\d{2}\b/) && !has(/円|JPY|JAPAN|TOKYO|OSAKA|NAGOYA/i)){
    add("JPY",-35);
    add("USD",35);
  }

  // Current GPS is trusted only when the user took the photo now.
  // It is intentionally ignored for images imported from the photo library.
  if(source==="camera" && region && region.currency) add(region.currency,65);

  const ranked=Object.entries(score).sort((a,b)=>b[1]-a[1]);
  const [best,bestScore]=ranked[0], secondScore=ranked[1]?.[1]||0;
  if(bestScore<=0) return {value:"",conf:0};

  // Confidence depends on both absolute evidence and the gap to the runner-up.
  const gap=bestScore-secondScore;
  const conf=clamp(Math.round(48 + Math.min(34,bestScore/4) + Math.min(18,gap/4)),50,99);
  return {value:best,conf};
}
function candidates(line){
  const res=[];
  const re=/(?:USD|EUR|GBP|JPY|THB|ILS|AUD|CAD|SGD|KRW|[$€£¥￥฿₪₩])?\s*(-?\d{1,3}(?:[,\s]\d{3})*(?:[.]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)/gi;
  for(const m of line.matchAll(re)){
    const v=normalizeNumber(m[1]); if(Number.isFinite(v) && Math.abs(v)<1e8) res.push(v);
  }
  return res;
}
function normalizeNumber(s){
  s=String(s).trim().replace(/\s/g,"");
  if(s.includes(",")&&s.includes(".")) s=s.replace(/,/g,"");
  else if((s.match(/,/g)||[]).length===1 && /,\d{2}$/.test(s)) s=s.replace(",",".");
  else s=s.replace(/,/g,"");
  return parseFloat(s);
}
function findTotal(lines){
  const positive=[
    [/(grand total|amount due|total due|balance due|total amount|合計金額|総合計|お支払金額|ご請求額|ยอดสุทธิ|รวมทั้งสิ้น|סה.?כ|לתשלום)/i,140],
    [/(total|合計|ยอดรวม)/i,105],
    [/(charge|amount|請求|お会計)/i,60]
  ];
  const negative=/(subtotal|sub total|tax|vat|change|cash|tender|discount|points|balance forward|小計|消費税|お預り|お釣り)/i;
  let scored=[];
  lines.forEach((line,i)=>{
    const nums=candidates(line); if(!nums.length)return;
    let base=0; for(const [r,s] of positive) if(r.test(line))base=Math.max(base,s);
    if(negative.test(line)) base-=90;
    nums.forEach(v=>scored.push({v,score:base + i/Math.max(1,lines.length)*15 + (/[¥￥$€£฿₪₩]/.test(line)?8:0)}));
  });
  scored=scored.filter(x=>x.v>=0.01);
  if(scored.length){
    const best=scored.sort((a,b)=>b.score-a.score || b.v-a.v)[0];
    if(best.score>=45) return {value:String(Math.round(best.v*100)/100),conf:clamp(Math.round(best.score/1.45),55,98)};
  }
  const tail=lines.slice(-10).flatMap(l=>candidates(l)).filter(v=>v>0);
  if(!tail.length)return {value:"",conf:0};
  return {value:String(Math.max(...tail)),conf:48};
}
function findNamedAmount(lines,re){
  for(const line of lines){ if(re.test(line)){ const n=candidates(line); if(n.length)return {value:String(n[n.length-1]),conf:78}; } }
  return {value:"",conf:0};
}
function findDate(t,code){
  const pats=[
    [/\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/,"ymd"],
    [/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/,"dmy"],
    [/\b(20\d{2})年(\d{1,2})月(\d{1,2})日\b/,"ymd"]
  ];
  for(const [r,kind] of pats){
    const m=t.match(r); if(!m)continue;
    let y,mo,d;
    if(kind==="ymd"){y=+m[1];mo=+m[2];d=+m[3];}
    else{
      if(code==="US"){mo=+m[1];d=+m[2];y=+m[3];}
      else{d=+m[1];mo=+m[2];y=+m[3];}
    }
    if(validDate(y,mo,d))return {value:`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`,conf:92};
  }
  return {value:new Date().toISOString().slice(0,10),conf:45};
}
function validDate(y,m,d){return y>=2020&&y<=2035&&m>=1&&m<=12&&d>=1&&d<=31}
function findMerchant(lines){
  const bad=/(receipt|invoice|tax invoice|tel|phone|fax|www\.|https?:|date|time|cashier|register|transaction|レシート|領収|消費税|合計|ใบเสร็จ|קבלה|חשבונית)/i;
  let best={value:"",conf:0,score:-99};
  lines.slice(0,10).forEach((l,i)=>{
    let s=35-i*2;
    if(l.length>=4&&l.length<=55)s+=15;
    if(/[A-Za-z\u0590-\u05FF\u0E00-\u0E7F\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7af]/.test(l))s+=18;
    if(bad.test(l))s-=70;
    if(/\d{5,}/.test(l))s-=25;
    if(/^[\d\s\-:/.]+$/.test(l))s-=45;
    if(s>best.score)best={value:l.replace(/[|]+/g," ").trim(),conf:clamp(s,0,94),score:s};
  });
  return {value:best.value,conf:best.conf};
}
function buildAutoNote(f){
  const parts=[];
  if(f.merchant)parts.push(f.merchant);
  if(f.amount)parts.push(`${f.currency||""} ${f.amount}`.trim());
  return parts.join(" · ");
}
function suggestCategory(){
  const t=`${current.fields.merchant||""}\n${current.ocrText||""}`;
  let suggestion="";
  for(const [cat,re] of catRules){ if(re.test(t)){suggestion=cat;break;} }
  if(suggestion){
    $$("[data-cat]").forEach(b=>b.classList.toggle("suggested",b.dataset.cat===suggestion));
    $("#categorySuggestion").textContent=`הצעה אוטומטית: ${suggestion}`;
    $("#categorySuggestion").classList.remove("hidden");
    chooseCategory(suggestion,true);
  }
}
function renderLiveFacts(){
  const f=current.fields||{}, conf=f.fieldConfidence||{};
  const rows=[
    ["בית עסק",f.merchant||"ממתין…",conf.merchant],
    ["תאריך",f.date||"ממתין…",conf.date],
    ["סכום",f.amount?money(f.amount,f.currency):"ממתין…",conf.amount],
    ["מס",f.tax?money(f.tax,f.currency):"—",conf.tax],
    ["טיפ/שירות",f.tip?money(f.tip,f.currency):"—",conf.tip],
    ["מיקום",current.place||current.geoCountry||(current.location?"GPS נשמר":"לא זמין"),current.location?90:0]
  ];
  $("#liveFacts").innerHTML=rows.map(([k,v,c])=>`<div class="fact"><b>${k}</b><span class="${c!==undefined&&c<60?'low':''}">${esc(v)}${c!==undefined&&c>0?` <small>(${Math.round(c)}%)</small>`:""}</span></div>`).join("");
}

async function refreshHome(){
  $("#activeTripLabel").textContent=`נסיעה פעילה: ${settings.trip} · v1.1`;
  const arr=(await dbAll()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const trip=arr.filter(x=>x.trip===settings.trip);
  const review=trip.filter(x=>x.needsReview).length, dup=trip.filter(x=>x.duplicateOf).length;
  $("#reviewBadge").textContent=review;
  const currencies={}; trip.forEach(x=>{if(x.amount&&x.currency)currencies[x.currency]=(currencies[x.currency]||0)+Number(x.amount)});
  const totalText=Object.entries(currencies).slice(0,2).map(([c,v])=>`${c} ${v.toLocaleString(undefined,{maximumFractionDigits:0})}`).join(" · ")||"—";
  $("#dashboard").innerHTML=[
    ["קבלות",trip.length],["Ready",trip.length-review],["לבדיקה",review],["סה״כ",totalText]
  ].map(([k,v])=>`<div class="metric"><div class="v">${esc(v)}</div><div class="k">${k}</div></div>`).join("");
  $("#recentList").innerHTML=trip.length? (await Promise.all(trip.slice(0,6).map(expenseHtml))).join("") : `<div class="muted">עדיין אין הוצאות בנסיעה הזו.</div>`;
  bindExpenseClicks();
}
async function expenseHtml(x){
  let src="";
  if(x.imageBlob)src=URL.createObjectURL(x.imageBlob);
  const status=x.duplicateOf?`<span class="badge dup">Possible duplicate</span>`:x.needsReview?`<span class="badge review">Needs review</span>`:`<span class="badge ready">Ready</span>`;
  return `<div class="expense" data-id="${x.id}">
    <img class="thumb" src="${src}" alt="">
    <div><div class="expenseTitle">${esc(x.merchant||"Receipt")}</div><div class="expenseMeta">${esc(x.date||"")} · ${esc(x.category||"")} · ${esc(x.place||"")}<br>${status}</div></div>
    <div class="expenseAmount">${esc(money(x.amount,x.currency))}</div>
  </div>`;
}
function bindExpenseClicks(){ $$("[data-id]").forEach(el=>el.onclick=()=>openEdit(el.dataset.id)); }

async function renderAllExpenses(){
  const arr=(await dbAll()).filter(x=>x.trip===settings.trip).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $("#expenseCountLabel").textContent=`${arr.length} הוצאות · ${settings.trip}`;
  const q=$("#searchInput").value.trim().toLowerCase(), st=$("#statusFilter").value;
  const filtered=arr.filter(x=>{
    const text=`${x.merchant} ${x.category} ${x.amount} ${x.currency} ${x.place}`.toLowerCase();
    const sOk=st==="all"||(st==="ready"&&!x.needsReview)||(st==="review"&&x.needsReview)||(st==="duplicate"&&x.duplicateOf);
    return (!q||text.includes(q))&&sOk;
  });
  $("#allExpenseList").innerHTML=filtered.length?(await Promise.all(filtered.map(expenseHtml))).join(""):`<div class="muted">אין תוצאות.</div>`;
  bindExpenseClicks();
}
$("#searchInput").oninput=renderAllExpenses; $("#statusFilter").onchange=renderAllExpenses;

async function renderReview(){
  const arr=(await dbAll()).filter(x=>x.trip===settings.trip&&x.needsReview).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $("#reviewList").innerHTML=arr.length?(await Promise.all(arr.map(expenseHtml))).join(""):`<div class="panel"><b>הכול נקי ✓</b><div class="muted small">אין קבלות שמחכות לבדיקה.</div></div>`;
  bindExpenseClicks();
}
async function openEdit(id){
  const x=(await dbAll()).find(e=>e.id===id); if(!x)return;
  $("#editId").value=x.id;
  $("#editImage").src=x.imageBlob?URL.createObjectURL(x.imageBlob):"";
  $("#editMerchant").value=x.merchant||""; $("#editAmount").value=x.amount||""; $("#editCurrency").value=x.currency||"";
  $("#editDate").value=x.date||""; $("#editPlace").value=x.place||""; $("#editNote").value=x.note||"";
  $("#editCategory").innerHTML=categories.map(c=>`<option ${c===x.category?"selected":""}>${c}</option>`).join("");
  $("#editCard").innerHTML=settings.cards.map(c=>`<option ${c===x.card?"selected":""}>${esc(c)}</option>`).join("");
  $("#editDialog").showModal();
}
$("#saveEditBtn").onclick=async e=>{
  e.preventDefault(); const id=$("#editId").value, x=(await dbAll()).find(e=>e.id===id); if(!x)return;
  Object.assign(x,{merchant:$("#editMerchant").value.trim(),amount:$("#editAmount").value.trim(),currency:$("#editCurrency").value.trim().toUpperCase(),
    date:$("#editDate").value.trim(),place:$("#editPlace").value.trim(),note:$("#editNote").value.trim(),
    category:$("#editCategory").value,card:$("#editCard").value,needsReview:false,duplicateOf:null,reviewedAt:new Date().toISOString()});
  await dbPut(x); $("#editDialog").close(); toast("התיקון נשמר ✓"); await refreshHome(); renderAllExpenses(); renderReview();
};
$("#deleteBtn").onclick=async e=>{
  e.preventDefault(); const id=$("#editId").value;
  if(confirm("למחוק את ההוצאה?")){await dbDelete(id);$("#editDialog").close();toast("נמחק");await refreshHome();renderAllExpenses();renderReview();}
};

$("#settingsBtn").onclick=()=>{
  $("#tripNameInput").value=settings.trip;
  $("#cardsInput").value=settings.cards.join("\n");
  $("#reverseGeoToggle").checked=!!settings.reverseGeo;
  populateDefaultCards(); $("#settingsDialog").showModal();
};
function populateDefaultCards(){
  $("#defaultCardSelect").innerHTML=settings.cards.map(c=>`<option ${c===settings.defaultCard?"selected":""}>${esc(c)}</option>`).join("");
}
$("#cardsInput").oninput=()=>{
  const arr=$("#cardsInput").value.split("\n").map(x=>x.trim()).filter(Boolean);
  $("#defaultCardSelect").innerHTML=arr.map(c=>`<option>${esc(c)}</option>`).join("");
};
$("#saveSettingsBtn").onclick=e=>{
  e.preventDefault();
  settings.trip=$("#tripNameInput").value.trim()||"Current Trip";
  settings.cards=$("#cardsInput").value.split("\n").map(x=>x.trim()).filter(Boolean);
  if(!settings.cards.length)settings.cards=["Corporate Card","Cash"];
  settings.defaultCard=$("#defaultCardSelect").value||settings.cards[0];
  settings.reverseGeo=$("#reverseGeoToggle").checked;
  localStorage.setItem("tep_settings",JSON.stringify(settings));
  $("#settingsDialog").close(); renderCardChips(); refreshHome(); toast("ההגדרות נשמרו");
};

$("#exportCsvBtn").onclick=async()=>exportCsv(false);
async function exportCsv(returnBlob=true){
  const arr=(await dbAll()).filter(x=>x.trip===settings.trip);
  const cols=["trip","date","merchant","category","card","amount","currency","tax","tip","place","note","needsReview","duplicateOf","createdAt"];
  const q=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const csv="\uFEFF"+[cols.join(","),...arr.map(x=>cols.map(c=>q(x[c])).join(","))].join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  if(returnBlob)return blob;
  download(blob,`${slug(settings.trip)}_expenses.csv`);
}
$("#exportZipBtn").onclick=async()=>{
  if(typeof JSZip==="undefined"){toast("ZIP library unavailable");return}
  const arr=(await dbAll()).filter(x=>x.trip===settings.trip);
  const zip=new JSZip(); zip.file("expenses.csv",await exportCsv(true));
  const folder=zip.folder("receipts");
  arr.forEach((x,i)=>{
    if(x.imageBlob){
      const date=x.date||x.createdAt.slice(0,10), name=`${String(i+1).padStart(3,"0")}_${date}_${slug(x.category)}_${slug(x.merchant)}_${slug(x.amount)}${slug(x.currency)}.jpg`;
      folder.file(name,x.imageBlob);
    }
  });
  const meta={trip:settings.trip,exportedAt:new Date().toISOString(),count:arr.length};
  zip.file("README.json",JSON.stringify(meta,null,2));
  toast("מכין ZIP…");
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
  download(blob,`${slug(settings.trip)}_expense_package.zip`);
};
$("#backupBtn").onclick=async()=>{
  const arr=await dbAll();
  const data=[];
  for(const x of arr){
    const y={...x}; if(y.imageBlob)y.imageData=await blobToDataURL(y.imageBlob); delete y.imageBlob; data.push(y);
  }
  const blob=new Blob([JSON.stringify({version:1,settings,expenses:data},null,2)],{type:"application/json"});
  download(blob,`trip_expense_backup_${new Date().toISOString().slice(0,10)}.json`);
};
$("#restoreInput").onchange=async e=>{
  const f=e.target.files?.[0]; if(!f)return;
  try{
    const j=JSON.parse(await f.text()); if(!Array.isArray(j.expenses))throw new Error("bad");
    if(j.settings){settings=Object.assign(settings,j.settings);localStorage.setItem("tep_settings",JSON.stringify(settings))}
    for(const x of j.expenses){ if(x.imageData){x.imageBlob=dataURLtoBlob(x.imageData);delete x.imageData} await dbPut(x); }
    toast("הגיבוי שוחזר"); await refreshHome();
  }catch{toast("קובץ גיבוי לא תקין")}
};
function blobToDataURL(blob){return new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(blob)})}
function dataURLtoBlob(dataURL){const [h,b]=dataURL.split(","), mime=h.match(/:(.*?);/)[1], bin=atob(b), a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:mime})}
function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}

renderCategoryChips(); renderCardChips(); refreshHome();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
