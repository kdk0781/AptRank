/* ════════════════════════════════════════════
   서비스워커 — apt-price-v11  (2026-04-15)
   ────────────────────────────────────────────
   변경:
   - 캐시 ID v10 → v11 (강제 갱신)
   - 중복 push / notificationclick 핸들러 제거 (단일 진입점)
   - Periodic Background Sync 'csv-check' 추가 — PWA 백그라운드 갱신 감지
   - 포그라운드 클라이언트 존재 시 알림 SKIP (인앱 배너로 충분)
   - HEAD 실패 환경 대비 fetch 오류 응답 정상 반환 (앱 멈춤 방지)
   ────────────────────────────────────────────
   전략:
   ① HTML/CSS/JS → Cache-First
   ② map.csv     → Network-Only (no-store) + 변경 감지
   ③ 외부 도메인 → 무시
   ④ CSV 변경 감지 → 앱에 postMessage + (백그라운드일 때) 푸시 알림
   ⑤ Periodic Sync 'csv-check' → 12시간마다 백그라운드 비교
════════════════════════════════════════════ */
const CACHE = 'apt-price-v11';
const STATIC = [
    './',
    './index.html',
    './css/common.css',
    './js/app.js',
    './manifest.json',
];
const CSV_URL          = './excel/map.csv';
const KV_LASTMOD       = 'csv_last_mod';
const NOTIF_TAG_UPDATE = 'csv-update';

/* ── install ──
   addAll은 하나라도 실패하면 전체 실패 — 개별 add로 보호적 캐싱 */
self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        await Promise.all(STATIC.map(u => c.add(u).catch(() => null)));
    })());
    self.skipWaiting();
});

/* ── activate: 구버전 캐시 삭제 ── */
self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

/* ── fetch ── */
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    /* 외부 도메인 무시 (Firebase, is.gd 등) */
    if (url.origin !== self.location.origin) return;

    /* CSV: Network-Only (no-store) + 변경 감지 */
    if (url.pathname.endsWith('map.csv')) {
        e.respondWith(handleCsvFetch(e.request));
        return;
    }

    /* 정적 자산: Cache-First, 네트워크 실패 시 캐시 또는 에러 */
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res && res.ok && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            }).catch(() => cached || Response.error());
        })
    );
});

/* ── Periodic Background Sync (PWA 설치자, 12시간 간격) ──
   브라우저가 적절한 시점(보통 와이파이 + 충전중)에 호출.
   여기서 CSV를 GET → handleCsvFetch가 변경 감지를 수행. */
self.addEventListener('periodicsync', e => {
    if (e.tag === 'csv-check') {
        e.waitUntil(handleCsvFetch(new Request(CSV_URL, { cache: 'no-store' })));
    }
});

/* ── 사용자가 수동 새로고침 트리거 시 (앱 → SW postMessage) ── */
self.addEventListener('message', e => {
    if (e.data?.type === 'CHECK_CSV') {
        e.waitUntil(handleCsvFetch(new Request(CSV_URL, { cache: 'no-store' })));
    }
});

/* CSV fetch + 변경 감지 */
async function handleCsvFetch(request) {
    let res;
    try {
        res = await fetch(request, { cache: 'no-store' });
    } catch (_) {
        /* 오프라인 등 — 504 응답 반환 (앱이 실패 처리) */
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }

    try {
        /* Last-Modified > ETag > content-length 우선순위 */
        const sig =
            res.headers.get('last-modified') ||
            res.headers.get('etag')          ||
            res.headers.get('content-length')|| '';
        const stored = await getStore(KV_LASTMOD);

        if (sig && stored && sig !== stored) {
            await setStore(KV_LASTMOD, sig);
            notifyClients('CSV_UPDATED', sig);
            sendPushNotification();          /* 백그라운드일 때만 실제 표시 */
        } else if (sig && !stored) {
            /* 최초 1회 — 알림 발송하지 않음 (오탐 방지) */
            await setStore(KV_LASTMOD, sig);
        }
    } catch (_) {}

    return res;
}

/* ── 앱 탭들에 메시지 전송 ── */
function notifyClients(type, data) {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(c => c.postMessage({ type, data }));
    });
}

/* ── 푸시 알림 표시 ──
   포그라운드 클라이언트가 있으면 알림 SKIP (인앱 배너로 충분 → 중복 방지)
   백그라운드일 때만 실제 알림 발송. tag 동일 → 중복 알림 자동 대체 */
async function sendPushNotification() {
    try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const visible = clients.some(c => c.visibilityState === 'visible');
        if (visible) return;
    } catch (_) {}

    try {
        await self.registration.showNotification('📊 아파트 시세 업데이트', {
            body:  '최신 KB 아파트 시세가 업데이트되었습니다.',
            icon:  './icons/icon-192.png',
            badge: './icons/icon-96.png',
            tag:   NOTIF_TAG_UPDATE,
            renotify: true,
            requireInteraction: false,
            data:  { url: self.registration.scope },
        });
    } catch (_) {}
}

/* ════════════════════════════════════════════
   Web Push (외부 푸시 수신) — 통합 핸들러
   ────────────────────────────────────────────
   ※ 이전 버전은 push 리스너가 두 번 등록되어 동일 알림이 두 번 떴습니다.
     이번 버전은 단일 진입점으로 통합 (notificationclick 동일).
════════════════════════════════════════════ */
self.addEventListener('push', e => {
    let payload = {};
    try { payload = e.data ? e.data.json() : {}; } catch (_) {}

    const title = payload.title
                  || payload.notification?.title
                  || '📊 아파트 시세 업데이트';
    const body  = payload.body
                  || payload.message
                  || payload.notification?.body
                  || '최신 시세를 확인하세요.';

    e.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon:  './icons/icon-192.png',
            badge: './icons/icon-96.png',
            tag:   NOTIF_TAG_UPDATE,
            renotify: true,
            requireInteraction: false,
            data:  { url: self.registration.scope },
        })
    );
});

/* ── 알림 클릭 → 앱 포커스 또는 새창 ── */
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const target = e.notification.data?.url || self.registration.scope;
    e.waitUntil((async () => {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const found = list.find(c => c.url.startsWith(self.registration.scope));
        if (found) {
            try { await found.focus(); } catch (_) {}
            try { found.postMessage({ type: 'CSV_UPDATED', source: 'notification-click' }); } catch (_) {}
            return;
        }
        await self.clients.openWindow(target);
    })());
});

/* ════════════════════════════════════════════
   IndexedDB 간단 KV 저장 (SW에선 localStorage 사용 불가)
════════════════════════════════════════════ */
function _openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('sw-store', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = () => reject(req.error);
    });
}

function getStore(key) {
    return _openDb().then(db => new Promise(resolve => {
        try {
            const tx = db.transaction('kv', 'readonly');
            const r  = tx.objectStore('kv').get(key);
            r.onsuccess = () => resolve(r.result ?? null);
            r.onerror   = () => resolve(null);
        } catch (_) { resolve(null); }
    })).catch(() => null);
}

function setStore(key, val) {
    return _openDb().then(db => new Promise((resolve, reject) => {
        try {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror    = () => reject(tx.error);
        } catch (e) { reject(e); }
    })).catch(() => false);
}
