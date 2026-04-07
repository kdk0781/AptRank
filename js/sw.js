const CACHE_NAME='apt-price-v9';
const STATIC=['./index.html','./css/common.css','./js/app.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
if(e.request.method!=='GET')return;
const u=new URL(e.request.url);
if(u.origin!==self.location.origin)return;
if(u.pathname.endsWith('.csv')){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>new Response('오프라인',{status:503})));return;}
e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE_NAME).then(cc=>cc.put(e.request,r.clone()));return r;}).catch(()=>new Response('오프라인',{status:503}))));
});
