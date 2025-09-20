// DB + Seed simplificado
const byId=id=>document.getElementById(id);
function base64ToBlob(b64,mime){const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:mime});}

const DB_NAME="CifrasWebDB";let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,3);r.onupgradeneeded=e=>{db=e.target.result;if(!db.objectStoreNames.contains("songs"))db.createObjectStore("songs",{keyPath:"id"});if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"});};r.onsuccess=()=>{db=r.result;res();};r.onerror=()=>rej(r.error);});}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store);}
const DBAPI={listSongs:()=>new Promise((res,rej)=>{const out=[];const r=tx("songs").openCursor();r.onsuccess=e=>{const c=e.target.result;if(c){out.push(c.value);c.continue();}else res(out);};r.onerror=e=>rej(e.target.error);}),
saveSong:s=>new Promise((res,rej)=>{const r=tx("songs","readwrite").put(s);r.onsuccess=()=>res(s);r.onerror=()=>rej(r.error);}),
getMeta:k=>new Promise((res,rej)=>{const r=tx("meta").get(k);r.onsuccess=()=>res(r.result?r.result.value:null);r.onerror=()=>rej(r.error);}),
setMeta:(k,v)=>new Promise((res,rej)=>{const r=tx("meta","readwrite").put({key:k,value:v});r.onsuccess=()=>res();r.onerror=()=>rej(r.error);})};

async function maybeSeedFromDefault(){const already=await DBAPI.getMeta("seedApplied");if(already)return;const existing=await DBAPI.listSongs();if(existing.length>0){await DBAPI.setMeta("seedApplied",true);return;}try{const resp=await fetch("default_songs.json",{cache:"no-store"});if(!resp.ok)return;const data=await resp.json();if(!data||!Array.isArray(data.songs))return;for(const s of data.songs){await DBAPI.saveSong({id:s.id||"s_"+Date.now(),title:s.title||"",artist:s.artist||"",category:s.category||"",tags:s.tags||[],pdfBlob:s.pdfB64?base64ToBlob(s.pdfB64,s.pdfMime||"application/pdf"):null,audioBlob:s.audioB64?base64ToBlob(s.audioB64,s.audioMime||"audio/mp3"):null});}await DBAPI.setMeta("seedApplied",true);}catch(e){console.warn("Seed não aplicado",e);}}

document.addEventListener("DOMContentLoaded",async()=>{await openDB();await maybeSeedFromDefault();console.log("App pronto com seed inicial");});