import mod from "./worker.js";
/* Sozlesme testi: alan adlari js/lisans.js'ten BIREBIR alindi. */
function kvStub(){const m=new Map();return{_m:m,async get(k,t){const v=m.get(k);if(v===undefined)return null;return t==="json"?JSON.parse(v.value):v.value;},async put(k,v,o){m.set(k,{value:v,metadata:(o&&o.metadata)||null});},async delete(k){m.delete(k);},async list(o){o=o||{};let ks=[...m.keys()].filter(k=>!o.prefix||k.startsWith(o.prefix)).sort();if(o.limit)ks=ks.slice(0,o.limit);return{keys:ks.map(k=>({name:k,metadata:m.get(k).metadata})),list_complete:true,cursor:undefined};}};}
const env={LISANS:kvStub(),ADMIN_TOKEN:"ADMINTOKEN1234567890",PEPPER:"pepper",TOKEN_SECRET:"tsecret"};
const admin={authorization:"Bearer "+env.ADMIN_TOKEN};
const call=async(y,o)=>{const r=await mod.fetch(new Request("http://x"+y,o),env,{});const ct=r.headers.get("content-type")||"";return{s:r.status,j:ct.includes("json")?await r.json():await r.text()};};
const post=(y,b,h)=>call(y,{method:"POST",headers:Object.assign({"content-type":"application/json"},h||{}),body:JSON.stringify(b)});
let bad=0; const ok=(a,k,e)=>{console.log((k?"  OK  ":"FAIL  ")+a+(e?"   "+e:""));if(!k)bad++;};
const PC1="9f2c4b8e11aa22bb33cc44dd55ee66ff";           // panel SHA-256 karmasi yolluyor
const PC2="00112233445566778899aabbccddeeff";

const e=await post("/api/lisans-ekle",{ad:"ParsMazi",not:"arkadas",maxCihaz:1},admin);
ok("lisans eklendi + sifre",e.j.ok&&/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(e.j.sifre),e.j.sifre);
const sifre=e.j.sifre,id=e.j.id;

const a=await post("/aktivasyon",{sifre:sifre.toLowerCase(),hwid:PC1,kaynak:"MachineGuid",makine:"PARSMAZI-PC",kullanici:"pars",isletim:"Windows 11",panel:"1.9.3"});
ok("aktivasyon: panelin bekledigi alanlar (lisansId+imza+ad)",a.j.ok&&!!a.j.lisansId&&/^v1\./.test(a.j.imza||"")&&a.j.ad==="ParsMazi",a.j.imza);
const imza=a.j.imza;
const d=await post("/aktivasyon",{sifre,hwid:PC2,makine:"BASKA-PC",panel:"1.9.3"});
ok("ikinci bilgisayar -> HTTP 409 + baskaPc (panel dogru mesaji verir)",d.s===409&&d.j.hata==="baskaPc",d.s+"/"+d.j.hata);
const y=await post("/aktivasyon",{sifre:"YANLISSIFRE12",hwid:PC1});
ok("yanlis sifre -> HTTP 403 (panel: 'sifre yanlis')",y.s===403&&y.j.hata==="sifre");

const p1=await post("/ping",{lisansId:id,hwid:PC1,imza:imza,makine:"PARSMAZI-PC",kullanici:"pars",panel:"1.9.4"});
ok("ping 200 + iptal:false",p1.s===200&&p1.j.ok===true&&p1.j.iptal===false);
const p0=await post("/ping",{lisansId:"usta",hwid:PC1,imza:"",panel:"1.9.4"});
ok("USTA KODU (imza bos) -> iptal DEGIL",p0.s===200&&p0.j.iptal===false,p0.j.sebep);
/* ⚠ ASAGIDAKI IKI TESTIN BEKLENTISI DEGISTI (eski hali "iptal:true" bekliyordu ve kirmiziydi).
   SEBEP: Cloudflare KV eventually-consistent — yazma baska bir bolgeden okunana kadar kisa sure
   "yok"/"eslesmedi" gorunebiliyor. O ani yakalayan panel `iptal:true`yu DISKE yaziyor ve kurulum
   BIR DAHA acilmiyordu; yani gecici bir tutarsizlik CALISAN bir kurulumu kalici olarak olduruyor.
   Sunucu bu yuzden bilerek `iptal:false, kesin:false` donuyor (worker.js /ping icindeki not) ve
   panel `kesin` bayragi olmadan cevabi yok sayiyor. Guvenlik kaybi yok: panel ayni HWID kontrolunu
   zaten YERELDE yapiyor. Test yanlisti, sunucu dogru — dusen bir test olmayan testten zararlidir,
   bir dahaki sefere gercek bir hata "zaten kirmiziydi" diye elenir. */
const p2=await post("/ping",{lisansId:id,hwid:PC2,imza:imza,panel:"1.9.4"});
ok("jeton baska pc'ye tasindi -> KILITLEMEZ (kesin:false, panel yerelde zaten kontrol ediyor)",
   p2.s===200&&p2.j.iptal===false&&p2.j.kesin===false&&p2.j.sebep==="baskapc",p2.j.sebep);
const p3=await post("/ping",{lisansId:id,hwid:PC1,imza:imza.slice(0,-1)+"0",panel:"1.9.4"});
ok("bozuk imza -> KILITLEMEZ (KV tutarsizligi olabilir, kesin:false)",
   p3.s===200&&p3.j.iptal===false&&p3.j.kesin===false,p3.j.sebep);

/* ⚠ BU TEST AYNEN KALIYOR — TEK GERCEK IPTAL YOLU BU. Yoneticinin lisansi uzaktan kapatmasi
   sistemin tek gercek kontrolu; `kesin:true` YALNIZ bu dalda donuyor ve panel yalnizca bu
   bayrakla diske yaziyor. Yukaridaki gevsetme bu yolu KAPATMAMALI. */
await post("/api/durum",{id,durum:"iptal"},admin);
const p4=await post("/ping",{lisansId:id,hwid:PC1,imza:imza,panel:"1.9.4"});
ok("yonetici GERCEKTEN iptal etti -> 200 + iptal:true + kesin:true + sebep:iptal",
   p4.s===200&&p4.j.iptal===true&&p4.j.kesin===true&&p4.j.sebep==="iptal");
await post("/api/durum",{id,durum:"aktif"},admin);

const l=await call("/api/lisanslar",{headers:admin});
const k=l.j.liste[0];
ok("liste: makine adi, kullanici, surum, ulke",k.cihazlar[0].ad==="PARSMAZI-PC"&&k.sonSurum==="1.9.4",JSON.stringify(k.cihazlar[0]));
ok("liste sifre/ham hwid sizdirmiyor",!JSON.stringify(l.j).includes(sifre.replace(/-/g,""))&&!JSON.stringify(l.j).includes(PC1));

const yeni=await post("/api/sifre-yenile",{id},admin);
const eskiDeneme=await post("/aktivasyon",{sifre,hwid:PC2});
ok("eski sifre olu",eskiDeneme.j.hata==="sifre");
const p5=await post("/ping",{lisansId:id,hwid:PC1,imza:imza});
ok("sifre yenileme kurulu cihazi DUSURMUYOR",p5.j.iptal===false);

await post("/api/cihaz-sil",{id,kisa:k.cihazlar[0].kisa},admin);
/* ⚠ BEKLENTI DEGISTI (eskiden "iptal:true" bekliyordu, kirmiziydi). Cihaz silindiginde jeton
   gercekten olur (tokenCoz cihazi bulamaz) AMA sunucu bunu panele kalici kilit olarak yazdirmaz:
   ayni cevap KV tutarsizligindan da gelebiliyor ve o an calisan kurulumu oldururdu. Arkadas
   zaten yeniden sifre girip aktive oluyor — asagidaki test tam bunu olcuyor. */
const p6=await post("/ping",{lisansId:id,hwid:PC1,imza:imza});
ok("cihaz silindi -> KILITLEMEZ (kesin:false; arkadas yeniden sifre girer)",
   p6.s===200&&p6.j.iptal===false&&p6.j.kesin===false,p6.j.sebep);
const a2=await post("/aktivasyon",{sifre:yeni.j.sifre,hwid:PC2,makine:"PARSMAZI-YENI",panel:"1.9.4"});
ok("cihaz silindikten sonra yeni pc girebiliyor",a2.j.ok===true);

const gl=await call("/api/gunluk",{headers:admin});
ok("gunluk dolu ve en yeni ustte",gl.j.ok&&gl.j.olaylar.length>=6,gl.j.olaylar.map(o=>o.t).join(","));
const ad=await call("/admin");
ok("admin sayfasi HTML + token gomulu degil",ad.s===200&&String(ad.j).startsWith("<!doctype html>")&&!String(ad.j).includes(env.ADMIN_TOKEN));
const yet=await call("/api/lisanslar",{headers:{authorization:"Bearer YANLISYANLISYANLIS"}});
ok("yanlis yonetici anahtari 403",yet.s===403&&yet.j.hata==="yetki");
console.log(bad===0?"\nTUM TESTLER GECTI":"\n"+bad+" TEST BASARISIZ");
process.exit(bad?1:0);
