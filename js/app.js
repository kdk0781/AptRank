const _V = 'v9.0';
const _SEM = {
icon: '🔒',
title: '링크가 만료되었습니다',
desc: '접속량이 많아 유효한 페이지가 아닙니다.',
sub: '담당자분께 링크를 다시 요청하세요.',
};
const _SS = 'kdk_apt_2026_!@#'; // ← 원하는 값으로 변경
const _SP = 'k';
const _FBU = 'https://counting-526f5-default-rtdb.asia-southeast1.firebasedatabase.app'; // Firebase Realtime Database URL
const _CNS = 'apt-map'; // Firebase 경로 prefix
const PUSH_WORKER_URL = ''; // ← Cloudflare Worker URL (예: https://push.yourname.workers.dev)
const PUSH_ADMIN_KEY = ''; // ← ADMIN_KEY (Worker 환경변수와 동일한 값)
const _SCT = (url) =>
`[KB 아파트 시세표]
아래 링크를 클릭하면 주간 시세를 확인하실 수 있습니다.
유효 기간이 있는 임시 링크이며, 기간 만료 시 접속이 제한됩니다.
${url}`;
function _sE(payload) {
const key = _SS;
const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload)));
const enc = bytes.map((b, i)=>b ^ key.charCodeAt(i % key.length));
return btoa(String.fromCharCode(...enc))
.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _sD(token) {
const key = _SS;
const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
const bytes = Array.from(atob(b64), c=>c.charCodeAt(0));
const dec = bytes.map((b, i)=>b ^ key.charCodeAt(i % key.length));
return JSON.parse(new TextDecoder().decode(new Uint8Array(dec)));
}
function _cSL() {
const SS_TOKEN = '_shr_t';
const SS_URL = '_shr_u';
const SS_BLOCKED = '_shr_blocked';
const LS_BACKUP = '_shr_ls'; // localStorage 이중 백업 키
const LS_EXP_FLAG = '_shr_exp'; // 만료 확정 플래그 (localStorage)
try {
if (localStorage.getItem(LS_EXP_FLAG)) {
const freshToken = new URLSearchParams(location.search).get(_SP);
const isSharSess = !!sessionStorage.getItem('_shr_sess_alive')
|| !!sessionStorage.getItem(SS_BLOCKED)
|| !!sessionStorage.getItem(SS_TOKEN);
if (!freshToken&&isSharSess) {
_sEAB();
return false;
}
}
} catch (_) {}
try {
if (sessionStorage.getItem(SS_BLOCKED)) {
_sEAB();
return false;
}
} catch (_) {}
let token = null;
let origUrl = null;
let fromUrl = false;
const urlToken = new URLSearchParams(location.search).get(_SP);
if (urlToken) {
token = urlToken;
origUrl = location.href;
fromUrl = true;
} else {
try {
token = sessionStorage.getItem(SS_TOKEN);
origUrl = sessionStorage.getItem(SS_URL);
} catch (_) {}
if (!token) {
try {
const isSameSess = !!sessionStorage.getItem('_shr_sess_alive');
if (isSameSess) {
const ls = JSON.parse(localStorage.getItem(LS_BACKUP)||'null');
if (ls&&ls.t) { token = ls.t; origUrl = ls.u; }
}
} catch (_) {}
}
}
if (!token) return true; // 공유 링크 아님 → 정상 실행
let isValid = false;
let decoded = null;
try {
decoded = _sD(token);
isValid = Date.now() < decoded.exp;
} catch (_) {}
if (isValid) {
if (fromUrl) {
try { history.replaceState(null, '', location.pathname); } catch (_) {}
}
try {
sessionStorage.setItem(SS_TOKEN, token);
sessionStorage.setItem(SS_URL, origUrl);
sessionStorage.setItem('_shr_sess_alive', '1');
} catch (_) {}
try {
localStorage.setItem(LS_BACKUP, JSON.stringify({ t: token, u: origUrl }));
} catch (_) {}
window.addEventListener('beforeinstallprompt', e=>{
e.preventDefault();
e.stopImmediatePropagation();
}, { capture: true });
window._blockPWA = true;
window._shareOrigUrl = origUrl;
window._isShareRecipient = true;
window._shareIncludeFavs = !!decoded.includeFavs;
return true;
}
try {
const _dir = location.pathname.replace(/\/[^/]*$/, '/'); // /test/index.html → /test/
const _rnd = Math.random().toString(36).slice(2, 10)
+ Math.random().toString(36).slice(2, 10);
history.replaceState(null, '', _dir + '#' + _rnd);
} catch (_) {}
try {
sessionStorage.removeItem(SS_TOKEN);
sessionStorage.removeItem(SS_URL);
sessionStorage.setItem(SS_BLOCKED, '1');
localStorage.removeItem(LS_BACKUP);
localStorage.setItem(LS_EXP_FLAG, '1');
} catch (_) {}
_sEAB();
return false;
}
function _sEAB() {
const render = ()=>{
const splash = document.getElementById('splashOverlay');
if (!splash) return;
splash.style.cssText = 'opacity:1;visibility:visible;display:flex;pointer-events:auto';
splash.innerHTML = `
<div class="share-expired-page">
<div class="sep-icon">${_SEM.icon}</div>
<h2 class="sep-title">${_SEM.title}</h2>
<p class="sep-desc">${_SEM.desc}</p>
<p class="sep-sub">${_SEM.sub}</p>
</div>`;
};
if (document.readyState==='loading') {
document.addEventListener('DOMContentLoaded', render, { once: true });
} else {
render();
}
}
const _sV = _cSL();
let _aG = [];
let _fG = [];
let _aR = '전체';
let _aS = 'default';
let _aU = 'sqm';
let _lC = 0;
const _lS = 20;
let _sDT = null;
let _sO = null;
const _FK = 'apt_map_favs';
let _fS = new Set(); // Set<string> key = 지역|아파트
let _aFO = false; // 즐겨찾기만 보기 토글
let _aFH = false; // 생애최초 LTV 모드
const _RK = 'apt_map_recent';
const _RM = 5;
let _rS = []; // string[]
const _sM = {
'T':'테라스','P':'펜트','C':'코너',
'A':'타입A','B':'타입B','D':'타입D','E':'타입E',
};
const _zD = {
투기지역: {
'서울특별시': ['강남구','서초구','송파구','용산구'],
},
투기과열지구: {
'서울특별시': [
'강동구','강북구','강서구','관악구','광진구',
'구로구','금천구','노원구','도봉구','동대문구',
'동작구','마포구','서대문구','성동구','성북구',
'양천구','영등포구','은평구','종로구','중구','중랑구',
],
'경기도': [
'과천시','광명시','의왕시','하남시',
'분당구','수정구','중원구',
'영통구','장안구','팔달구',
'동안구','수지구',
],
},
};
function _gRZ(sido, sgg) {
sido = sido.trim(); sgg = sgg.trim();
const a = _zD.투기지역[sido]||[];
if (a.some(g=>sgg.includes(g))) return { zone:'A', label:'투기지역' };
const b = _zD.투기과열지구[sido]||[];
if (b.some(g=>sgg.includes(g))) return { zone:'B', label:'투기과열지구' };
return { zone: null, label: '' };
}
function _gLL(priceRaw, regZone, midRaw) {
if (!priceRaw||priceRaw<=0) return null;
const isReg = regZone==='A'||regZone==='B';
let ltvRate, ltvPct;
if (_aFH&&isReg) {
ltvRate = 0.70;
ltvPct = 70;
} else {
ltvRate = isReg ? 0.40 : 0.70;
ltvPct = isReg ? 40 : 70;
}
const ltvAmt = Math.floor(priceRaw * ltvRate / 100) * 100;
const ref = midRaw||priceRaw;
let policyLimit;
if (ref<=150000) policyLimit = 60000;
else if (ref<=250000) policyLimit = 40000;
else policyLimit = 20000;
const finalAmt = Math.min(ltvAmt, policyLimit);
const isLtvLimit = finalAmt===ltvAmt&&ltvAmt < policyLimit;
function fmtAmt(man) {
const eok = Math.floor(man / 10000);
const rest = man % 10000;
if (eok > 0&&rest > 0)
return `${eok}억 ${rest.toLocaleString('ko-KR')}만`;
if (eok > 0)
return `${eok}억`;
return `${rest.toLocaleString('ko-KR')}만`;
}
const amtStr = fmtAmt(finalAmt);
let cls;
if (_aFH&&isReg) {
cls = 'loan-first-home'; // 생애최초 규제지역 전용 색상
} else if (isLtvLimit) {
cls = isReg ? 'loan-ltv-reg' : 'loan-ltv-gen';
} else {
if (policyLimit===60000) cls = 'loan-pol-a';
else if (policyLimit===40000) cls = 'loan-pol-b';
else cls = 'loan-pol-c';
}
return { amtStr, ltvPct, isLtvLimit, cls };
}
document.addEventListener('DOMContentLoaded', ()=>{
if (!_sV) return; // 만료 링크면 앱 초기화 중단
const vEl = document.getElementById('splashVersion');
if (vEl) vEl.textContent = _V;
if (window._blockPWA) {
document.querySelectorAll(
'link[rel="manifest"], link[rel="apple-touch-icon"], ' +
'meta[name="apple-mobile-web-app-capable"], ' +
'meta[name="mobile-web-app-capable"]'
).forEach(el=>el.remove());
if ('serviceWorker' in navigator) {
navigator.serviceWorker.getRegistrations()
.then(regs=>regs.forEach(r=>r.unregister()))
.catch(()=>{});
}
}
const _isShared = !!window._isShareRecipient;
if ('serviceWorker' in navigator&&!_isShared) {
navigator.serviceWorker.register('sw.js').then(reg=>{
setTimeout(()=>_rNP(), 3000);
navigator.serviceWorker.addEventListener('message', (e)=>{
if (e.data?.type==='CSV_UPDATED') {
_sCUB();
}
});
}).catch(()=>{});
}
document.getElementById('hardRefreshBtn').addEventListener('click', async ()=>{
document.querySelector('#hardRefreshBtn span').textContent = '업데이트 중...';
try {
if ('serviceWorker' in navigator) {
const regs = await navigator.serviceWorker.getRegistrations();
await Promise.all(regs.map(r=>r.unregister()));
}
if ('caches' in window) {
const names = await caches.keys();
await Promise.all(names.map(n=>caches.delete(n)));
}
const savedCurr = localStorage.getItem(_cC);
const savedPrev = localStorage.getItem(_cP);
const savedFavs = localStorage.getItem(_FK);
const savedRecent = localStorage.getItem(_RK);
const isShareSess = !!sessionStorage.getItem('_shr_t');
const savedShrLs = isShareSess ? localStorage.getItem('_shr_ls') : null;
const savedShrExp = localStorage.getItem('_shr_exp');
localStorage.clear();
if (savedCurr) localStorage.setItem(_cC, savedCurr);
if (savedPrev) localStorage.setItem(_cP, savedPrev);
if (savedFavs) localStorage.setItem(_FK, savedFavs);
if (savedRecent) localStorage.setItem(_RK, savedRecent);
if (savedShrLs) localStorage.setItem('_shr_ls', savedShrLs);
if (savedShrExp) localStorage.setItem('_shr_exp', savedShrExp);
const ssToken = sessionStorage.getItem('_shr_t');
const ssUrl = sessionStorage.getItem('_shr_u');
const ssBlocked = sessionStorage.getItem('_shr_blocked');
const ssAlive = sessionStorage.getItem('_shr_sess_alive');
const ssRecent = sessionStorage.getItem('_shr_recent'); // 수신자 최근검색
const ssRcClr = sessionStorage.getItem('_shr_rc_cleared'); // 첫접속 판단 플래그
sessionStorage.clear();
if (ssToken) sessionStorage.setItem('_shr_t', ssToken);
if (ssUrl) sessionStorage.setItem('_shr_u', ssUrl);
if (ssBlocked)sessionStorage.setItem('_shr_blocked', ssBlocked);
if (ssAlive) sessionStorage.setItem('_shr_sess_alive', ssAlive);
if (ssRecent) sessionStorage.setItem('_shr_recent', ssRecent);
if (ssRcClr) sessionStorage.setItem('_shr_rc_cleared', ssRcClr);
} finally { window.location.reload(true); }
});
document.getElementById('listBody').addEventListener('click', (e)=>{
const starBtn = e.target.closest('.fav-star-btn');
if (starBtn) {
const key = starBtn.getAttribute('data-fav-key'); // dataset 미사용 (난독화 충돌 방지)
if (!key) return;
const wasFav = _fS.has(key);
wasFav ? _fS.delete(key) : _fS.add(key);
_sFav();
const isNowFav = _fS.has(key);
starBtn.classList.toggle('active', isNowFav);
starBtn.textContent = isNowFav ? '⭐' : '☆';
starBtn.title = isNowFav ? '즐겨찾기 해제' : '즐겨찾기 추가';
if (_aFO&&!isNowFav) _aF();
return;
}
const btn = e.target.closest('.accordion-btn');
if (!btn) return;
const item = btn.closest('.group-item');
if (!item) return;
const wasActive = item.classList.contains('active');
document.querySelectorAll('.group-item.active').forEach(el=>{
if (el!==item) el.classList.remove('active');
});
item.classList.toggle('active', !wasActive);
if (!wasActive) {
setTimeout(()=>{
const hdr = document.querySelector('.sticky-header');
const hBottom = hdr ? hdr.getBoundingClientRect().bottom : 120;
const rect = item.getBoundingClientRect();
if (rect.top < hBottom + 10) {
window.scrollTo({ top: window.scrollY + rect.top - hBottom - 10, behavior: 'smooth' });
}
}, 320);
}
});
const _si = document.getElementById('searchInput');
_si.addEventListener('input', ()=>{
clearTimeout(_sDT);
_sDT = setTimeout(()=>{
_aF();
_rRSU();
}, 250);
});
const _saveSearchTerm = ()=>{
const v = _si.value.trim();
if (v.length>=2) _sRS(v);
};
_si.addEventListener('keydown', (e)=>{
if (e.key==='Enter') {
const v = _si.value.trim();
if (v==='투데이') {
e.preventDefault();
_si.value = '';
_si.blur(); // 키보드 닫기
_rRSU();
_sTVP();
return;
}
if (v==='알림전송') {
e.preventDefault();
_si.value = '';
_si.blur();
_rRSU();
showPushAdminPanel();
return;
}
if (v==='알림구독') {
e.preventDefault();
_si.value = '';
_si.blur();
_rRSU();
requestPushPermission();
return;
}
_saveSearchTerm();
_si.blur();
_rRSU();
}
});
_si.addEventListener('blur', ()=>{
_saveSearchTerm();
setTimeout(_rRSU, 150);
});
document.getElementById('sortSelect').addEventListener('change', (e)=>{
_aS = e.target.value;
_aF();
});
document.getElementById('unitToggleBtn').addEventListener('click', ()=>{
_aU = _aU==='sqm' ? 'pyeong' : 'sqm';
document.body.classList.toggle('pyeong-mode', _aU==='pyeong');
const btn = document.getElementById('unitToggleBtn');
btn.querySelector('.u-label-sqm').classList.toggle('active', _aU==='sqm');
btn.querySelector('.u-label-pyeong').classList.toggle('active', _aU==='pyeong');
});
document.getElementById('firstHomeBtn')?.addEventListener('click', ()=>{
_aFH = !_aFH;
const btn = document.getElementById('firstHomeBtn');
btn.classList.toggle('active', _aFH);
btn.title = _aFH ? '생애최초 LTV 해제' : '생애최초 LTV 적용';
_rI(true);
});
_sSO();
_sSTB();
_sSB();
_lFav();
const _isShareRecv = !!window._isShareRecipient;
if (_isShareRecv) {
const _rcCleared = sessionStorage.getItem('_shr_rc_cleared');
if (!_rcCleared) {
_rS = [];
sessionStorage.setItem('_shr_recent', '[]');
sessionStorage.setItem('_shr_rc_cleared', '1');
} else {
try {
const raw = sessionStorage.getItem('_shr_recent');
_rS = raw ? JSON.parse(raw) : [];
} catch { _rS = []; }
}
if (!window._shareIncludeFavs) {
_fS = new Set();
}
_rRSU();
} else {
_lRS();
}
if (window._showSharePreview) {
showSharePreview();
return; // _lD는 startApp()에서 호출
}
_tTV(!!window._isShareRecipient);
_lD();
if (isPWAInstalled()) {
setupPushNotification();
}
});
function _sSP() {
const el = document.querySelector('.sticky-header');
if (!el) return;
document.documentElement.style.setProperty('scroll-padding-top', (el.offsetHeight + 10) + 'px');
}
window.addEventListener('resize', _sSP, { passive: true });
function _hS() {
const el = document.getElementById('splashOverlay');
if (el) el.classList.add('hide');
}
function _sSE(msg) {
const el = document.getElementById('splashOverlay');
if (!el) return;
el.innerHTML = `
<div class="splash-error">
<span style="font-size:2rem">⚠️</span>
<p>${msg||'데이터를 불러올 수 없습니다.'}</p>
<small>새로고침 버튼을 눌러 다시 시도하세요.</small>
<button onclick="window.location.reload(true)" class="refresh-btn" style="margin-top:16px">
<span>다시 시도</span>
</button>
<small style="margin-top:8px;opacity:0.5">${_V}</small>
</div>`;
}
function _lD() {
console.log('[_lD] 시작', _V);
const safetyTimer = setTimeout(()=>{
console.warn('[_lD] 5초 안전망 발동');
_hS();
}, 5000);
const done = (ok)=>{
clearTimeout(safetyTimer);
if (ok) _hS();
};
fetch('excel/map.csv', {
cache: 'no-store',
headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache, no-store' }
})
.then(res=>{
if (!res.ok) throw new Error('HTTP ' + res.status);
return res.arrayBuffer();
})
.then(buf=>{
console.log('[_lD] CSV 수신 완료', buf.byteLength, 'bytes');
let csv;
try {
csv = new TextDecoder('euc-kr').decode(buf);
} catch (e) {
console.warn('[_lD] euc-kr 디코딩 실패, utf-8 재시도');
csv = new TextDecoder('utf-8').decode(buf);
}
_pAR(csv);
done(true);
})
.catch(err=>{
console.error('[_lD] 오류:', err);
done(false);
_sSE('CSV 파일을 불러올 수 없습니다. (' + err.message + ')');
});
}
function _pCL(line) {
const fields = [];
let field = '';
let inQ = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (ch==='"') {
if (inQ&&line[i + 1]==='"') { field += '"'; i++; }
else inQ = !inQ;
} else if (ch===','&&!inQ) {
fields.push(field.trim()); field = '';
} else {
field += ch;
}
}
fields.push(field.trim());
return fields;
}
const _cC = 'apt_map_curr';
const _cP = 'apt_map_prev';
function _bPK(row) {
return `${row.시도}|${row.시군구}|${row.동}|${row.아파트}|${row.공급면적}|${row.전용면적}|${row.suffix}`;
}
function _rC(key) {
try {
const raw = localStorage.getItem(key);
return raw ? JSON.parse(raw) : null;
} catch { return null; }
}
function _wC(key, data) {
try {
localStorage.setItem(key, JSON.stringify(data));
} catch (e) {
console.warn('[priceCache] 저장 실패:', e.message);
}
}
function _bCP(dateText, _fD) {
const p = {};
for (const row of _fD) {
p[_bPK(row)] = [row.하한가Raw, row.일반가Raw, row.상한가Raw];
}
return { dateText, p };
}
function _sPC(_bDT, _fD) {
const curr = _rC(_cC);
if (curr&&curr.dateText===_bDT) {
const prev = _rC(_cP);
console.log('[priceCache] 같은 주 재로드 → diff 유지', prev ? prev.dateText : '(없음)');
return prev; // prev가 비교 기준
}
if (curr) {
_wC(_cP, curr);
console.log('[priceCache] curr→prev 승격:', curr.dateText);
}
_wC(_cC, _bCP(_bDT, _fD));
console.log('[priceCache] 새 curr 저장:', _bDT);
return curr; // 비교 기준 = 방금 승격된 구 curr (없으면 null)
}
function _pAR(csv) {
console.log('[_pAR] 시작');
const t0 = Date.now();
const lines = csv.split(/\r\n|\n/);
let _bDT = '';
for (let i = 0; i < Math.min(15, lines.length); i++) {
const regex = /(20\d{2})[-.년\s]+([0-1]?\d)[-.월\s]+([0-3]?\d)일?/g;
const dates = [];
let m;
while ((m = regex.exec(lines[i]))!==null) {
dates.push(`${m[1]}.${m[2].padStart(2,'0')}.${m[3].padStart(2,'0')}`);
}
if (dates.length>=2) { _bDT = `${dates[0]} ~ ${dates[1]}`; break; }
if (dates.length===1) { _bDT = dates[0]; break; }
}
const dateLabel = document.getElementById('baseDateLabel');
if (dateLabel) {
if (_bDT) dateLabel.textContent = '기준일 ' + _bDT;
else dateLabel.style.display = 'none';
}
const SKIP = [
'전국은행연합회','조견표','절대 수정 금지','대출상담사',
'시도,시군구','시/도','공급면적','하한가',
];
const toNum = v=>parseFloat(String(v).replace(/,/g, ''));
const toPrice = v=>{ const n = toNum(v); return (isNaN(n)||n===0) ? '-' : n.toLocaleString('ko-KR'); };
const toRaw = v=>{ const n = toNum(v); return isNaN(n) ? 0 : n; };
const toArea = v=>{ const n = toNum(v); if(isNaN(n)) return String(v); return n%1===0 ? String(n) : n.toFixed(2).replace(/\.?0+$/,''); };
const toPyeong = (sqm, p)=>{
if (p) { const n=toNum(p); if(!isNaN(n)&&n>0) return n+'평'; }
const n = toNum(sqm);
return isNaN(n) ? '-' : (n/3.3058).toFixed(1)+'평';
};
const getSuffix = v=>{
const raw = String(v).trim().replace(/^[\d.,]+/,'');
if (!raw) return '';
if (/[가-힣]/.test(raw)) return raw.slice(0,6);
const u = raw.toUpperCase();
return _sM[u]||raw.slice(0,6);
};
const _fD = [];
for (let i = 0; i < lines.length; i++) {
const line = lines[i].trim();
if (!line) continue;
if (SKIP.some(k=>line.includes(k))) continue;
const col = _pCL(line);
if (col.length < 11||!col[0]) continue;
if (col[3]==='아파트'||col[3]==='단지명') continue;
const sido = col[0].trim(), sgg = col[1].trim(), dong = col[2].trim(), apt = col[3].trim();
if (!apt||!sido) continue;
_fD.push({
시도: sido, 시군구: sgg, 동: dong,
지역: `${sido} ${sgg} ${dong}`.replace(/\s+/g,' '),
아파트: apt,
공급면적: toArea(col[6]||col[4]), 전용면적: toArea(col[5]),
공급평형: toPyeong(col[6]||col[4], col[7]), 전용평형: toPyeong(col[5],''),
suffix: getSuffix(col[4]),
하한가: toPrice(col[8]||''), 일반가: toPrice(col[9]||''), 상한가: toPrice(col[10]||''),
하한가Raw: toRaw(col[8]||''),
일반가Raw: toRaw(col[9]||''),
상한가Raw: toRaw(col[10]||''),
diffLow: null, diffMid: null, diffHigh: null,
});
}
const compCache = _sPC(_bDT, _fD);
if (compCache) {
const pm = compCache.p;
for (const row of _fD) {
const prev = pm[_bPK(row)];
if (prev) {
row.diffLow = row.하한가Raw - prev[0];
row.diffMid = row.일반가Raw - prev[1];
row.diffHigh = row.상한가Raw - prev[2];
}
}
}
const map = new Map();
for (const row of _fD) {
const key = `${row.시도}|${row.시군구}|${row.동}|${row.아파트}`;
if (!map.has(key)) {
const reg = _gRZ(row.시도, row.시군구);
map.set(key, {
시도: row.시도, 시군구: row.시군구, 동: row.동,
지역: row.지역, 아파트: row.아파트,
rows: [], minPrice: Infinity, maxPrice: 0,
regZone: reg.zone, regLabel: reg.label,
});
}
const g = map.get(key);
g.rows.push(row);
if (row.일반가Raw > 0) {
g.minPrice = Math.min(g.minPrice, row.일반가Raw);
g.maxPrice = Math.max(g.maxPrice, row.일반가Raw);
}
}
_aG = Array.from(map.values()).map(g=>{
if (g.minPrice===Infinity) g.minPrice = 0;
g.searchKey = `${g.지역} ${g.아파트}`.toLowerCase();
return g;
});
const regions = ['전체', ...new Set(_aG.map(g=>g.시도).sort())];
_bRC(regions);
requestAnimationFrame(_sSP);
_fG = _aG;
const t1 = Date.now();
console.log(`[_pAR] 완료: ${_aG.length}단지, ${t1-t0}ms`);
_rI();
}
function _bRC(regions) {
const wrap = document.getElementById('regionFilter');
if (!wrap) return;
const MOBILE_MAIN = new Set(['전체','서울특별시','경기도','인천광역시']);
const _showFavChip = !window._isShareRecipient||window._shareIncludeFavs;
wrap.innerHTML = [
_showFavChip ? `<button class="region-chip fav-chip${_aFO?' active':''}" data-fav="1" title="즐겨찾기한 단지만 보기">
<span class="fav-chip-star">⭐</span><span class="fav-chip-text"> 즐겨찾기</span>
</button>` : '',
...regions.map(r=>{
const hideCls = MOBILE_MAIN.has(r) ? '' : ' mobile-hidden';
return `<button class="region-chip${r==='전체'&&!_aFO?' active':''}${hideCls}" data-region="${r}">${r}</button>`;
})
].join('');
wrap.addEventListener('click', (e)=>{
const chip = e.target.closest('.region-chip');
if (!chip) return;
if (chip.dataset.fav) {
_aFO = !_aFO;
chip.classList.toggle('active', _aFO);
wrap.querySelectorAll('.region-chip:not([data-fav])').forEach(c =>
c.classList.remove('active')
);
if (!_aFO) {
wrap.querySelector('[data-region="전체"]')?.classList.add('active');
_aR = '전체';
}
} else {
_aFO = false;
wrap.querySelector('[data-fav]')?.classList.remove('active');
_aR = chip.dataset.region;
wrap.querySelectorAll('.region-chip:not([data-fav])').forEach(c =>
c.classList.toggle('active', c===chip)
);
}
_aF();
});
}
function _aF() {
const raw = document.getElementById('searchInput').value.trim().toLowerCase();
const terms = raw ? raw.split(/\s+/) : [];
let result = _aG;
if (_aFO) {
result = result.filter(g=>_fS.has(_fK(g)));
} else if (_aR!=='전체') {
result = result.filter(g=>g.시도===_aR);
}
if (terms.length > 0) result = result.filter(g=>terms.every(t=>g.searchKey.includes(t)));
switch (_aS) {
case 'name': result = [...result].sort((a,b)=>a.아파트.localeCompare(b.아파트,'ko')); break;
case 'price_asc': result = [...result].sort((a,b)=>(a.minPrice||Infinity)-(b.minPrice||Infinity)); break;
case 'price_desc':result = [...result].sort((a,b)=>b.maxPrice-a.maxPrice); break;
}
_fG = result;
_rI();
}
function _gPR(g) {
if (!g.minPrice&&!g.maxPrice) return '';
if (g.minPrice===g.maxPrice) return g.minPrice.toLocaleString('ko-KR')+'만';
return `${g.minPrice.toLocaleString('ko-KR')} ~ ${g.maxPrice.toLocaleString('ko-KR')}만`;
}
function _dB(diff) {
if (diff===null||diff===undefined||diff===0)
return `<span class="price-diff none">-</span>`;
const abs = Math.abs(diff).toLocaleString('ko-KR');
return diff > 0
? `<span class="price-diff up">🔺${abs}</span>`
: `<span class="price-diff down">🔽${abs}</span>`;
}
function _cGH(g) {
const priceRange = _gPR(g);
const isRegCard = g.regZone==='A'||g.regZone==='B';
const ltvPct = (isRegCard&&!_aFH) ? 40 : 70;
const ltvChipCls = (isRegCard&&_aFH) ? 'ltv-chip ltv-70 ltv-first' : `ltv-chip ltv-${ltvPct}`;
const ltvChip = `<span class="${ltvChipCls}">LTV ${ltvPct}%${_aFH&&isRegCard ? ' <em class="ltv-fh-mark">생애최초</em>' : ''}</span>`;
const regBadge = g.regLabel
? `<div class="reg-badges">
<span class="reg-badge reg-${g.regZone}">${g.regLabel}</span>
${ltvChip}
</div>`
: `<div class="reg-badges">${ltvChip}</div>`;
const midDiffs = g.rows.map(r=>r.diffMid).filter(d=>d!==null&&d!==0);
let groupDiffBadge = '';
if (midDiffs.length > 0) {
const maxUp = Math.max(...midDiffs.filter(d=>d > 0), 0);
const maxDown = Math.min(...midDiffs.filter(d=>d < 0), 0);
if (maxUp > 0&&maxDown < 0) {
groupDiffBadge = `<span class="group-diff-badge mixed">🔺🔽 등락</span>`;
} else if (maxUp > 0) {
groupDiffBadge = `<span class="group-diff-badge up">🔺${maxUp.toLocaleString('ko-KR')}</span>`;
} else if (maxDown < 0) {
groupDiffBadge = `<span class="group-diff-badge down">🔽${Math.abs(maxDown).toLocaleString('ko-KR')}</span>`;
}
}
let rowsHTML = '';
for (const row of g.rows) {
const sb = row.suffix ? `<span class="area-suffix">${row.suffix}</span>` : '';
const loanLow = _gLL(row.하한가Raw, g.regZone, row.일반가Raw);
const loanLowBadge = loanLow
? `<span class="loan-badge ${loanLow.cls}">대출 ${loanLow.amtStr}</span>`
: '';
const loanMid = _gLL(row.일반가Raw, g.regZone, row.일반가Raw);
const loanMidBadge = loanMid
? `<span class="loan-badge ${loanMid.cls}">대출 ${loanMid.amtStr}</span>`
: '';
const loanRowHTML = (loanLow||loanMid) ? `
<div class="loan-info-row">
<span class="loan-info-label">대출 가능액 :</span>
<div class="loan-tags">
${loanLow ? `<span class="loan-tag ${loanLow.cls}"><em class="loan-tag-label">1층</em>${loanLow.amtStr}</span>` : ''}
${loanMid ? `<span class="loan-tag ${loanMid.cls}"><em class="loan-tag-label">일반</em>${loanMid.amtStr}</span>` : ''}
</div>
</div>` : '';
rowsHTML += `
<div class="inner-row">
<div class="inner-main">
<div class="inner-area">
<span class="area-val u-sqm">${row.공급면적}㎡</span>
<span class="area-divider u-sqm">/</span>
<span class="area-val exclusive u-sqm">${row.전용면적}㎡</span>
<span class="area-val u-pyeong">${row.공급평형}</span>
<span class="area-divider u-pyeong">/</span>
<span class="area-val exclusive u-pyeong">${row.전용평형}</span>
${sb}
</div>
<div class="inner-prices">
<div class="price-box low">
<span class="price-label">하한가</span>
<span class="price-val">${row.하한가}</span>
${_dB(row.diffLow)}
</div>
<div class="price-box mid">
<span class="price-label">일반가</span>
<span class="price-val">${row.일반가}</span>
${_dB(row.diffMid)}
</div>
<div class="price-box high">
<span class="price-label">상한가</span>
<span class="price-val">${row.상한가}</span>
${_dB(row.diffHigh)}
</div>
</div>
</div>
${loanRowHTML}
</div>`;
}
const isFav = _fS.has(_fK(g));
const fKey = _fK(g);
const _showStar = !window._isShareRecipient||window._shareIncludeFavs;
const _starHTML = _showStar
? `<button class="fav-star-btn${isFav?' active':''}"
data-fav-key="${fKey}"
title="${isFav?'즐겨찾기 해제':'즐겨찾기 추가'}"
type="button">${isFav?'⭐':'☆'}</button>`
: '';
return `
<div class="group-item${g.regZone?' has-reg zone-'+g.regZone:''}">
<div class="group-item-header">
${_starHTML}
<div class="accordion-btn">
<div class="group-title-wrap">
<span class="group-apt">${g.아파트}</span>
<span class="group-region">${g.지역}</span>
${regBadge}
</div>
<div class="accordion-right">
${groupDiffBadge}
${priceRange?`<span class="price-range-badge">${priceRange}</span>`:''}
<span class="row-count-badge">${g.rows.length}개</span>
<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
</div>
</div>
</div>
<div class="accordion-content">
<div class="content-header">
<span class="header-area">면적 (공급 / 전용)
<span class="header-unit-badge u-sqm">㎡</span>
<span class="header-unit-badge u-pyeong">평</span>
</span>
<span class="header-unit">(단위: 만원)</span>
</div>
${rowsHTML}
</div>
</div>`;
}
function _rI(keepScroll) {
const listBody = document.getElementById('listBody');
const sentinel = document.getElementById('scrollSentinel');
const countEl = document.getElementById('resultCount');
listBody.innerHTML = '';
_lC = 0;
const total = _fG.length;
const isFiltered = _aR!=='전체'||_aFO||document.getElementById('searchInput').value.trim()!=='';
if (countEl) {
countEl.textContent = isFiltered
? `${total.toLocaleString()}개 단지`
: `전체 ${_aG.length.toLocaleString()}개 단지`;
}
if (total===0) {
listBody.innerHTML = `<div class="empty-state"><span class="empty-icon">🔍</span><p>조건에 맞는 시세 정보가 없습니다.</p><small>검색어 또는 지역 필터를 변경해보세요.</small></div>`;
sentinel.style.display = 'none';
return;
}
_lM();
if (!keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function _lM() {
const listBody = document.getElementById('listBody');
const sentinel = document.getElementById('scrollSentinel');
const next = Math.min(_lC + _lS, _fG.length);
const slice = _fG.slice(_lC, next);
if (slice.length > 0) listBody.insertAdjacentHTML('beforeend', slice.map(_cGH).join(''));
_lC = next;
sentinel.style.display = _lC>=_fG.length ? 'none' : 'block';
}
function _sSO() {
const sentinel = document.getElementById('scrollSentinel');
_sO = new IntersectionObserver(
entries=>{ if (entries[0].isIntersecting) _lM(); },
{ rootMargin: '300px' }
);
if (sentinel) _sO.observe(sentinel);
}
const _sTT = 300;
function _sSTB() {
const btn = document.getElementById('scrollTopBtn');
if (!btn) return;
window.addEventListener('scroll', ()=>{
if (window.scrollY > _sTT) {
btn.classList.add('visible');
} else {
btn.classList.remove('visible');
}
}, { passive: true });
btn.addEventListener('click', ()=>{
window.scrollTo({ top: 0, behavior: 'smooth' });
});
}
function _sSB() {
const openBtn = document.getElementById('shareBtnOpen');
const modal = document.getElementById('shareModal');
const closeBtn = document.getElementById('shareCloseBtn');
const genBtn = document.getElementById('shareGenBtn');
const copyBtn = document.getElementById('shareCopyBtn');
const linkInput = document.getElementById('shareLinkInput');
const resultBox = document.getElementById('shareResultBox');
const copyMsg = document.getElementById('shareCopyMsg');
if (!openBtn) return;
const _eT = !!window._isShareRecipient;
if (_eT) {
openBtn.addEventListener('click', async ()=>{
const originalUrl = window._shareOrigUrl||location.href;
try { await navigator.clipboard.writeText(originalUrl); }
catch (_) {
const tmp = document.createElement('textarea');
tmp.value = originalUrl;
document.body.appendChild(tmp);
tmp.select(); document.execCommand('copy');
document.body.removeChild(tmp);
}
const span = openBtn.querySelector('span');
const orig = span ? span.textContent : '';
if (span) span.textContent = '복사됨!';
openBtn.style.background = 'var(--primary-color)';
openBtn.style.color = '#1a1f24';
setTimeout(()=>{
if (span) span.textContent = orig;
openBtn.style.background = '';
openBtn.style.color = '';
}, 2000);
});
return;
}
openBtn.addEventListener('click', ()=>{
modal.classList.add('open');
resultBox.style.display = 'none';
copyMsg.style.display = 'none';
});
closeBtn.addEventListener('click', ()=>modal.classList.remove('open'));
modal.addEventListener('click', e=>{
if (e.target===modal) modal.classList.remove('open');
});
genBtn.addEventListener('click', async ()=>{
const dur = Math.max(1, parseInt(document.getElementById('shareDuration').value)||1);
const unit = parseInt(document.getElementById('shareUnit').value);
const exp = Date.now() + dur * unit;
const _inclFav = document.getElementById('shareFavToggle')?.checked||false;
const token = _sE({ exp, includeFavs: _inclFav });
const baseUrl = new URL(location.href);
baseUrl.pathname = baseUrl.pathname.replace(/\/index\.html$/, '/');
baseUrl.search = '?' + _SP + '=' + token;
baseUrl.hash = '';
const longUrl = baseUrl.toString();
resultBox.style.display = 'flex';
copyMsg.style.display = 'none';
linkInput.value = '링크 생성 중...';
copyBtn.disabled = true;
const d = new Date(exp);
document.getElementById('shareExpLabel').textContent =
'만료: ' + d.toLocaleDateString('ko-KR') + ' ' +
d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
let finalUrl = longUrl;
try {
const res = await fetch(
'https://is.gd/create.php?format=simple&url=' + encodeURIComponent(longUrl)
);
const short = (await res.text()).trim();
if (short.startsWith('http')) finalUrl = short;
} catch (_) { }
const msgText = _SCT(finalUrl);
linkInput.value = msgText; // 메시지 미리보기
copyBtn.disabled = false;
const urlOnlyBtn = document.getElementById('shareUrlOnlyBtn');
if (urlOnlyBtn) urlOnlyBtn.dataset.url = finalUrl;
window._shareOrigUrl = finalUrl; // 수신자 재공유용
});
copyBtn.addEventListener('click', async ()=>{
const text = linkInput.value;
try { await navigator.clipboard.writeText(text); }
catch (_) { linkInput.select(); document.execCommand('copy'); }
copyMsg.style.display = 'block';
setTimeout(()=>{ copyMsg.style.display = 'none'; }, 2500);
});
document.getElementById('shareUrlOnlyBtn')?.addEventListener('click', async ()=>{
const urlBtn = document.getElementById('shareUrlOnlyBtn');
const url = urlBtn?.dataset.url||window._shareOrigUrl||'';
if (!url) return;
try { await navigator.clipboard.writeText(url); }
catch (_) {
const t = document.createElement('textarea');
t.value = url; document.body.appendChild(t);
t.select(); document.execCommand('copy'); t.remove();
}
const orig = urlBtn.textContent;
urlBtn.textContent = '✅ 복사됨!';
setTimeout(()=>{ urlBtn.textContent = orig; }, 2000);
});
}
const PREVIEW_SEC = 10;
function showSharePreview() {
const splash = document.getElementById('splashOverlay');
if (!splash) { startApp(); return; }
splash.classList.remove('hide');
splash.style.opacity = '1';
splash.style.visibility = 'visible';
splash.innerHTML = `
<div class="share-preview-page">
<p class="spp-badge">임시 공유 링크</p>
<div class="spp-icon">📊</div>
<h2 class="spp-title">아파트 시세표</h2>
<p class="spp-desc">
Preview를 클릭하거나<br>
<span id="shareCountdown">${PREVIEW_SEC}</span>초 뒤 페이지가<br>
자동으로 이동됩니다.
</p>
<button id="sharePreviewBtn" class="spp-btn">Preview →</button>
<p class="spp-notice">⏱ 유효 기간이 있는 임시 링크입니다</p>
</div>`;
let started = false;
const go = ()=>{
if (started) return;
started = true;
clearInterval(timer);
startApp();
};
let count = PREVIEW_SEC;
const timer = setInterval(()=>{
count--;
const el = document.getElementById('shareCountdown');
if (el) el.textContent = count;
if (count<=0) go();
}, 1000);
document.getElementById('sharePreviewBtn')
.addEventListener('click', go, { once: true });
}
function startApp() {
_hS();
_lD();
}
function _fK(g) { return `${g.지역}|${g.아파트}`; }
function _lFav() {
try {
const raw = localStorage.getItem(_FK);
_fS = new Set(raw ? JSON.parse(raw) : []);
} catch { _fS = new Set(); }
}
function _sFav() {
try { localStorage.setItem(_FK, JSON.stringify([..._fS])); } catch {}
}
function _lRS() {
try {
const raw = localStorage.getItem(_RK);
_rS = raw ? JSON.parse(raw) : [];
} catch { _rS = []; }
_rRSU();
}
function _sRS(term) {
if (!term||term.length < 1) return;
_rS = _rS.filter(t=>t!==term);
_rS.unshift(term);
if (_rS.length > _RM) _rS = _rS.slice(0, _RM);
if (window._isShareRecipient) {
try { sessionStorage.setItem('_shr_recent', JSON.stringify(_rS)); } catch {}
} else {
try { localStorage.setItem(_RK, JSON.stringify(_rS)); } catch {}
}
_rRSU();
}
function _rRS(term) {
_rS = _rS.filter(t=>t!==term);
if (window._isShareRecipient) {
try { sessionStorage.setItem('_shr_recent', JSON.stringify(_rS)); } catch {}
} else {
try { localStorage.setItem(_RK, JSON.stringify(_rS)); } catch {}
}
_rRSU();
}
function _rRSU() {
const container = document.getElementById('recentSearchWrap');
if (!container) return;
const searchInput = document.getElementById('searchInput');
const currentVal = searchInput ? searchInput.value.trim() : '';
if (currentVal||_rS.length===0) {
container.style.display = 'none';
return;
}
container.style.display = 'flex';
container.innerHTML = `
<span class="recent-label">최근 검색</span>
<div class="recent-chips">
${_rS.map(t=>`
<span class="recent-chip">
<button class="recent-chip-text" data-term="${t}">${t}</button>
<button class="recent-chip-del" data-del="${t}" aria-label="삭제">✕</button>
</span>`).join('')}
</div>`;
container.querySelectorAll('.recent-chip-text').forEach(btn=>{
btn.addEventListener('click', ()=>{
const inp = document.getElementById('searchInput');
if (inp) { inp.value = btn.dataset.term; }
_aF();
_rRSU();
});
});
container.querySelectorAll('.recent-chip-del').forEach(btn=>{
btn.addEventListener('click', (e)=>{
e.stopPropagation();
_rRS(btn.dataset.del);
});
});
}
function _gTK() {
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, '0');
const day = String(d.getDate()).padStart(2, '0');
return 'd-' + y + m + day; // 예: d-20260408
}
async function _tTV(isRecipient) {
if (!_FBU) return; // Firebase URL 미설정 시 스킵
const dateKey = _gTK();
const apiKey = isRecipient ? 's-' + dateKey.slice(2) : dateKey;
const dupKey = '_today_hit_' + apiKey;
const storage = isRecipient ? sessionStorage : localStorage;
if (storage.getItem(dupKey)) return;
try {
const path = `${_FBU}/${_CNS}/${apiKey}.json`;
const cur = await fetch(path).then(r=>r.json()).catch(()=>0);
const next = (typeof cur==='number' ? cur : 0) + 1;
const res = await fetch(path, {
method: 'PUT',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(next),
});
if (res.ok) {
storage.setItem(dupKey, '1');
if (!isRecipient) _cOHK();
}
} catch (_) {}
}
function _cOHK() {
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 30);
const cutStr = cutoff.getFullYear()
+ String(cutoff.getMonth()+1).padStart(2,'0')
+ String(cutoff.getDate()).padStart(2,'0');
Object.keys(localStorage).forEach(k=>{
if (k.startsWith('_today_hit_d-')) {
const dateStr = k.replace('_today_hit_d-', '');
if (dateStr < cutStr) localStorage.removeItem(k);
}
});
}
async function _sTVP() {
document.getElementById('todayPopup')?.remove();
const popup = document.createElement('div');
popup.id = 'todayPopup';
popup.className = 'today-popup';
popup.innerHTML = `
<div class="tp-header">
<span class="tp-title">📊 오늘 방문자</span>
<button class="tp-close" onclick="document.getElementById('todayPopup')?.remove()">✕</button>
</div>
<div class="tp-body">
<div class="tp-rows">
<div class="tp-row">
<span class="tp-label">🏠 직접 접속</span>
<span class="tp-val" id="tpDirect"><span class="tp-spinner-sm"></span></span>
</div>
<div class="tp-divider"></div>
<div class="tp-row">
<span class="tp-label">🔗 공유 링크</span>
<span class="tp-val" id="tpShare"><span class="tp-spinner-sm"></span></span>
</div>
<div class="tp-divider"></div>
<div class="tp-row tp-row-total">
<span class="tp-label">합계</span>
<span class="tp-val tp-total" id="tpTotal">-</span>
</div>
</div>
<p class="tp-date">${new Date().toLocaleDateString('ko-KR')} 기준</p>
<p class="tp-hint">같은 브라우저 당일 중복 집계 제외</p>
</div>`;
document.body.appendChild(popup);
setTimeout(()=>{
document.addEventListener('click', function _close(e) {
if (!popup.contains(e.target)) {
popup.remove();
document.removeEventListener('click', _close);
}
});
}, 200);
const dateKey = _gTK();
const directKey = dateKey; // d-YYYYMMDD
const shareKey = 's-' + dateKey.slice(2); // s-YYYYMMDD
if (!_FBU) {
const elD = document.getElementById('tpDirect');
const elS = document.getElementById('tpShare');
const elT = document.getElementById('tpTotal');
if (elD) elD.innerHTML = '<span class="tp-err">설정 필요</span>';
if (elS) elS.innerHTML = '<span class="tp-err">설정 필요</span>';
if (elT) elT.innerHTML = '<span class="tp-err" style="font-size:0.7rem">_FBU을 설정하세요</span>';
return;
}
const fetchCount = async (key)=>{
try {
const res = await fetch(`${_FBU}/${_CNS}/${key}.json`);
const val = await res.json();
return typeof val==='number' ? val : 0;
} catch (_) { return null; }
};
const fmt = (n)=>n===null
? '<span class="tp-err">-</span>'
: `<span class="tp-num-sm">${Number(n).toLocaleString('ko-KR')}</span><span class="tp-unit-sm">명</span>`;
const [direct, share] = await Promise.all([
fetchCount(directKey),
fetchCount(shareKey),
]);
const elD = document.getElementById('tpDirect');
const elS = document.getElementById('tpShare');
const elT = document.getElementById('tpTotal');
if (elD) elD.innerHTML = fmt(direct);
if (elS) elS.innerHTML = fmt(share);
if (elT) {
const total = (direct ?? 0) + (share ?? 0);
elT.innerHTML = `<span class="tp-num-sm tp-total-num">${total.toLocaleString('ko-KR')}</span><span class="tp-unit-sm">명</span>`;
}
}
async function _rNP() {
if (!('Notification' in window)) return; // 미지원 브라우저
if (Notification.permission==='granted') return; // 이미 허용
if (Notification.permission==='denied') return; // 이미 거부
try {
const result = await Notification.requestPermission();
console.log('[알림]', result);
} catch (_) {}
}
function _sCUB() {
if (document.getElementById('csvUpdateBanner')) return;
const banner = document.createElement('div');
banner.id = 'csvUpdateBanner';
banner.className = 'csv-update-banner';
banner.innerHTML = `
<span class="cub-icon">📊</span>
<span class="cub-msg">새로운 시세 데이터가 업로드되었습니다.</span>
<button class="cub-btn" id="cubRefreshBtn">새로고침</button>
<button class="cub-close" id="cubCloseBtn" aria-label="닫기">✕</button>`;
document.body.prepend(banner);
requestAnimationFrame(()=>banner.classList.add('visible'));
document.getElementById('cubRefreshBtn').addEventListener('click', ()=>{
banner.remove();
window.location.reload(true);
});
document.getElementById('cubCloseBtn').addEventListener('click', ()=>{
banner.classList.remove('visible');
setTimeout(()=>banner.remove(), 300);
});
setTimeout(()=>{
if (document.getElementById('csvUpdateBanner')) {
banner.classList.remove('visible');
setTimeout(()=>banner.remove(), 300);
}
}, 15000);
}
function isPWAInstalled() {
return window.matchMedia('(display-mode: standalone)').matches
|| window.navigator.standalone===true;
}
async function setupPushNotification() {
if (!PUSH_WORKER_URL) return; // Worker URL 미설정 시 스킵
if (!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window)) return;
if (Notification.permission==='granted') {
try {
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.getSubscription();
if (sub) {
await refreshSubscription(sub); // 서버에 재등록
return;
}
} catch (_) {}
}
if (Notification.permission==='default') {
showPushBanner();
}
}
function showPushBanner() {
if (document.getElementById('pushBanner')) return;
const banner = document.createElement('div');
banner.id = 'pushBanner';
banner.className = 'push-banner';
banner.innerHTML = `
<div class="pb-content">
<span class="pb-icon">🔔</span>
<div class="pb-text">
<strong>시세 업데이트 알림</strong>
<span>새 데이터 등록 시 알림을 받아보세요</span>
</div>
</div>
<div class="pb-actions">
<button class="pb-allow" id="pbAllow">허용</button>
<button class="pb-deny" id="pbDeny">닫기</button>
</div>`;
document.body.appendChild(banner);
setTimeout(()=>banner.classList.add('visible'), 100);
document.getElementById('pbAllow').addEventListener('click', async ()=>{
banner.remove();
await requestPushPermission();
});
document.getElementById('pbDeny').addEventListener('click', ()=>{
banner.classList.remove('visible');
setTimeout(()=>banner.remove(), 300);
localStorage.setItem('_push_denied', Date.now()); // 7일간 재표시 안 함
});
}
async function requestPushPermission() {
if (!PUSH_WORKER_URL) {
alert('Push Worker URL이 설정되지 않았습니다.\napp_src.js의 PUSH_WORKER_URL을 설정해 주세요.');
return;
}
const perm = await Notification.requestPermission();
if (perm!=='granted') {
alert('알림 권한이 거부되었습니다.\n브라우저 설정에서 알림을 허용해 주세요.');
return;
}
const ok = await subscribeWebPush();
if (ok) {
showToast('🔔 알림이 등록되었습니다!');
} else {
showToast('❌ 알림 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}
}
async function subscribeWebPush() {
try {
const keyRes = await fetch(`${PUSH_WORKER_URL}/vapid-key`);
const { publicKey } = await keyRes.json();
const vapidKey = base64urlToUint8(publicKey);
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.subscribe({
userVisibleOnly: true,
applicationServerKey: vapidKey
});
return await refreshSubscription(sub);
} catch (e) {
console.error('[Push] 구독 실패', e);
return false;
}
}
async function refreshSubscription(sub) {
try {
const res = await fetch(`${PUSH_WORKER_URL}/subscribe`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(sub.toJSON())
});
const data = await res.json();
return !!data.ok;
} catch (_) { return false; }
}
async function showPushAdminPanel() {
if (!PUSH_ADMIN_KEY||!PUSH_WORKER_URL) {
alert('PUSH_WORKER_URL 또는 PUSH_ADMIN_KEY가 설정되지 않았습니다.');
return;
}
let subCount = '...';
try {
const r = await fetch(`${PUSH_WORKER_URL}/count`);
const d = await r.json();
subCount = d.count ?? '?';
} catch (_) {}
document.getElementById('pushAdminPanel')?.remove();
const panel = document.createElement('div');
panel.id = 'pushAdminPanel';
panel.className = 'push-admin-panel';
panel.innerHTML = `
<div class="pap-header">
<span class="pap-title">📢 알림 발송</span>
<button class="pap-close" id="papClose">✕</button>
</div>
<div class="pap-body">
<div class="pap-stat">
<span>구독자</span>
<strong id="papCount">${subCount}명</strong>
</div>
<input type="text" id="papTitle" class="pap-input" placeholder="제목 (기본: KB 아파트 시세표)" maxlength="50">
<textarea id="papMsg" class="pap-textarea" rows="3"
placeholder="알림 내용 (기본: 새로운 아파트 시세가 업데이트되었습니다!)"
maxlength="200"></textarea>
<button class="pap-send-btn" id="papSend">🔔 전체 발송</button>
<div class="pap-result" id="papResult"></div>
</div>`;
document.body.appendChild(panel);
const close = ()=>panel.remove();
document.getElementById('papClose').addEventListener('click', close);
setTimeout(()=>{
document.addEventListener('click', function _c(e) {
if (!panel.contains(e.target)) { close(); document.removeEventListener('click', _c); }
});
}, 200);
document.getElementById('papSend').addEventListener('click', async ()=>{
const title = document.getElementById('papTitle').value.trim()
|| 'KB 아파트 시세표';
const message = document.getElementById('papMsg').value.trim()
|| '새로운 아파트 시세가 업데이트되었습니다!';
const btn = document.getElementById('papSend');
const res = document.getElementById('papResult');
btn.disabled = true;
btn.textContent = '발송 중...';
try {
const r = await fetch(`${PUSH_WORKER_URL}/notify`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'Authorization': `Bearer ${PUSH_ADMIN_KEY}`
},
body: JSON.stringify({ title, message })
});
const d = await r.json();
res.textContent = `✅ 발송 완료: ${d.sent}/${d.total}명 성공`;
} catch (e) {
res.textContent = '❌ 발송 실패. 네트워크를 확인해 주세요.';
}
btn.disabled = false;
btn.textContent = '🔔 전체 발송';
});
}
function showToast(msg) {
const t = document.createElement('div');
t.className = 'apt-toast';
t.textContent = msg;
document.body.appendChild(t);
setTimeout(()=>t.classList.add('visible'), 50);
setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(), 350); }, 3000);
}
function base64urlToUint8(b64u) {
const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
const raw = atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '='));
return Uint8Array.from(raw, c=>c.charCodeAt(0));
}