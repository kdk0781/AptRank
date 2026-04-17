/* ════════════════════════════════════════════
   아파트 시세표 | app_src.js  v11.0  (2026-04-16)
   ────────────────────────────────────────────
   ✅ 상태기계 CSV 파서 (O(n), 재앙적 정규식 제거)
   ✅ 동기 파싱 38ms — async 청크 구조 완전 제거
   ✅ 스플래시 3중 보장 (정상/오류/5초 타이머)
   ✅ 버전 번호 화면 표시 (배포 확인용)
   ✅ 맨위로 버튼 (300px 이상 스크롤 시 표시)
   ✅ 지난주 대비 가격 변동 표시 (curr/prev 두 슬롯)
   ✅ 일반가 기준 대출 가능 한도 표시
   ✅ CSV fetch cache: no-store (캐시 우회)
   ✅ 관리자 모드 게이트 — 검색창 "관리자" 입력으로 활성화
   ✅ PWA 설치 권한 토글 — 공유 토큰에 allowPwa 포함
   ✅ 공유 수신자 CSV 업데이트 폴링 — SW 없는 수신자도 갱신 인지
   ✅ 관리자 배지 sticky-header 최상단 인라인 바
   ──────────────────────────────────
   🆕 v11 변경사항 (2026-04-16)
   🆕 부관리자(Deputy) 모드 — 관리자 모달에 토글 추가
      ON 시 수신자에게 풀 모달 권한 부여 (기간 최대 90일)
      부관리자 재공유 링크의 수신자 → 기존 수신자 동작 (복사만)
      부관리자 본인은 사용 기간 무제한 (영구 접속)
   🆕 PWA 설치 즉시 파기 — 부관리자 링크에서 홈 화면 설치 완료 시
      해당 공유 세션 즉시 만료 (appinstalled 이벤트 감지)
   🆕 URL 단축 제거 — 직접 암호화 링크 사용 (외부 서비스 의존성 제거)
   🆕 부관리자 모달 UX — 분/시간 단위 제거(일만), 90일 초과 생성 차단
════════════════════════════════════════════ */

const APP_VERSION = 'v11.0';

/* ════════════════════════════════════════════
   관리자 모드 설정
   ────────────────────────────────────────────
   ADMIN_PASSPHRASE        : 검색창에 입력하면 관리자 활성화
   ADMIN_PASSPHRASE_OFF    : 검색창에 입력하면 관리자 해제
   ADMIN_LS_KEY            : localStorage 저장 키
   ADMIN_SECRET            : 무결성 서명용 (단순 변조 방지)

   동작:
   - 관리자 모드 ON  → 공유 버튼 클릭 시 풀 모달 (기간/즐겨찾기/PWA/부관리자 토글)
   - 관리자 모드 OFF → 공유 버튼 클릭 시 현재 URL만 클립보드 복사
   - 공유 수신자(?k=토큰)는 위 둘과 무관하게 다음 두 동작 중 하나:
       ▸ 부관리자 권한 토큰 → 풀 모달 (기간 최대 90일, 원본 만료 이내)
       ▸ 일반 수신자 토큰   → 받은 링크 그대로 복사
════════════════════════════════════════════ */
const ADMIN_PASSPHRASE     = '관리자';
const ADMIN_PASSPHRASE_OFF = '관리자해제';
const ADMIN_LS_KEY         = '_apt_admin_v1';
const ADMIN_SECRET         = 'kdk_apt_admin_2026';

/* 부관리자가 재공유 시 적용할 기간 상한 (밀리초) */
const DEPUTY_MAX_MS = 90 * 24 * 60 * 60 * 1000; /* 90일 */

/* 단순 무결성 서명 — 사용자가 localStorage 값을 임의로 추측해 위조하기 어렵게 함
   진짜 보안 목적은 아니며, 우발적 켜짐 방지용 */
function _adminSig(payload) {
    let h = 0x811c9dc5;
    const s = payload + '|' + ADMIN_SECRET;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

function isAdmin() {
    try {
        const raw = localStorage.getItem(ADMIN_LS_KEY);
        if (!raw) return false;
        const obj = JSON.parse(raw);
        if (!obj || obj.v !== 1 || !obj.t) return false;
        return _adminSig(String(obj.t)) === obj.s;
    } catch { return false; }
}

function setAdmin(on) {
    try {
        if (on) {
            const t = Date.now();
            localStorage.setItem(ADMIN_LS_KEY,
                JSON.stringify({ v: 1, t, s: _adminSig(String(t)) }));
        } else {
            localStorage.removeItem(ADMIN_LS_KEY);
        }
    } catch {}
}

/* ════════════════════════════════════════════
   임시 공유 링크 만료 메시지 설정
   ────────────────────────────────────────────
   아래 텍스트를 수정하면 만료 페이지 문구가 바뀝니다.
════════════════════════════════════════════ */
const SHARE_EXPIRED_MSG = {
    icon:  '🔒',
    title: '링크가 만료되었습니다',
    desc:  '접속량이 많아 유효한 페이지가 아닙니다.',
    sub:   '담당자분께 링크를 다시 요청하세요.',
};

/* ════════════════════════════════════════════
   공유 토큰 암호화 설정
   ────────────────────────────────────────────
   SHARE_SECRET : 암복호화 비밀키 (자유롭게 변경 가능)
   SHARE_PARAM  : URL 파라미터명 (기본 'k' — 짧고 의미 없음)

   암호화 방식: XOR cipher + URL-safe Base64
   → base64 디코딩해도 XOR 없이 해독 불가
   → 토큰에서 만료 시각 추측 불가
════════════════════════════════════════════ */
const SHARE_SECRET = 'kdk_apt_2026_!@#'; // ← 원하는 값으로 변경
const SHARE_PARAM  = 'k';

/* ════════════════════════════════════════════
   투데이 방문자 카운터 설정
   ────────────────────────────────────────────
   FIREBASE_URL : Firebase Realtime Database URL
     예) 'https://my-project-default-rtdb.firebaseio.com'
     설정 방법: console.firebase.google.com → 프로젝트 생성
               → Realtime Database → 테스트 모드로 시작
               → 데이터베이스 URL 복사 후 아래 붙여넣기
   검색창에 "투데이" 입력 + Enter → 오늘 방문자 수 팝업
════════════════════════════════════════════ */
const FIREBASE_URL = 'https://counting-526f5-default-rtdb.asia-southeast1.firebasedatabase.app'; // Firebase Realtime Database URL
const COUNT_NS     = 'apt-map'; // Firebase 경로 prefix

/* ════════════════════════════════════════════
   Web Push 설정
   ────────────────────────────────────────────
   1. push-worker.js 를 Cloudflare Workers 에 배포
   2. KV Namespace 'SUBS' 생성 후 Worker에 바인딩
   3. 환경변수 설정 후 아래 PUSH_WORKER_URL 입력
════════════════════════════════════════════ */
const PUSH_WORKER_URL = ''; // ← Cloudflare Worker URL (예: https://push.yourname.workers.dev)
const PUSH_ADMIN_KEY  = ''; // ← ADMIN_KEY (Worker 환경변수와 동일한 값)

/* ════════════════════════════════════════════
   카카오톡/문자 공유용 메시지 템플릿
   ────────────────────────────────────────────
   복사 버튼 클릭 시 이 형식으로 클립보드에 저장됩니다.
   ${url} 자리에 단축 링크가 자동 삽입됩니다.
   ▶ 문구를 원하는 대로 수정하세요.
════════════════════════════════════════════ */
const SHARE_COPY_TEMPLATE = (url) =>
`[KB 아파트 시세표]
아래 링크를 클릭하면 주간 시세를 확인하실 수 있습니다.
유효 기간이 있는 임시 링크이며, 기간 만료 시 접속이 제한됩니다.
${url}`;



/* XOR 암호화 → URL-safe base64 */
function shareEncrypt(payload) {
    const key   = SHARE_SECRET;
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload)));
    const enc   = bytes.map((b, i) => b ^ key.charCodeAt(i % key.length));
    return btoa(String.fromCharCode(...enc))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/* URL-safe base64 → XOR 복호화 */
function shareDecrypt(token) {
    const key     = SHARE_SECRET;
    const b64     = token.replace(/-/g, '+').replace(/_/g, '/');
    const bytes   = Array.from(atob(b64), c => c.charCodeAt(0));
    const dec     = bytes.map((b, i) => b ^ key.charCodeAt(i % key.length));
    return JSON.parse(new TextDecoder().decode(new Uint8Array(dec)));
}

/* ════════════════════════════════════════════
   임시 공유 링크 검증 (DOMContentLoaded 이전 실행)
   ────────────────────────────────────────────
   URL ?share=TOKEN 파라미터를 확인하고
   만료된 경우 만료 페이지를 즉시 표시합니다.
   유효한 경우 앱을 정상 실행합니다.
   TOKEN = btoa(JSON.stringify({ exp: 만료_ms }))
════════════════════════════════════════════ */
/* ════════════════════════════════════════════
   임시 공유 링크 검증 (DOMContentLoaded 이전 실행)
   ────────────────────────────────────────────
   sessionStorage 키
     _shr_t       : 암호화 토큰
     _shr_u       : 원본 URL (공유 버튼 패스스루용)
     _shr_blocked : 만료 차단 플래그
                    (탭이 열려있는 동안 새로고침해도 만료 페이지 유지)

   ① 차단 플래그 있음   → 즉시 만료 페이지
   ② URL에 유효 토큰   → URL 정리 + sessionStorage 저장 → 앱 실행
   ③ URL에 만료 토큰   → URL 정리 하지 않음 (새로고침해도 동일 URL)
                          + 차단 플래그 설정 → 만료 페이지
   ④ sessionStorage 토큰 만료 → 차단 플래그 설정 → 만료 페이지
   ⑤ 토큰 없음         → 정상 앱 실행
════════════════════════════════════════════ */
function checkShareLink() {
    const SS_TOKEN   = '_shr_t';
    const SS_URL     = '_shr_u';
    const SS_BLOCKED = '_shr_blocked';
    const LS_BACKUP  = '_shr_ls';      // localStorage 이중 백업 키
    const LS_EXP_FLAG = '_shr_exp';    // 만료 확정 플래그 (localStorage)

    /* ── ① 만료 확정 플래그 확인 (localStorage 기반) ──
       단, 현재 탭이 공유 세션(_shr_sess_alive)일 때만 적용.
       오너가 같은 브라우저에서 일반 접속 시 영향받지 않음 */
    try {
        if (localStorage.getItem(LS_EXP_FLAG)) {
            const freshToken  = new URLSearchParams(location.search).get(SHARE_PARAM);
            const isSharSess  = !!sessionStorage.getItem('_shr_sess_alive')
                             || !!sessionStorage.getItem(SS_BLOCKED)
                             || !!sessionStorage.getItem(SS_TOKEN);
            if (!freshToken && isSharSess) {
                showExpiredAndBlock();
                return false;
            }
            /* 공유 세션 아니면 만료 플래그 무시 (오너 일반 접속) */
        }
    } catch (_) {}

    /* ── ② sessionStorage 차단 플래그 ── */
    try {
        if (sessionStorage.getItem(SS_BLOCKED)) {
            showExpiredAndBlock();
            return false;
        }
    } catch (_) {}

    let token   = null;
    let origUrl = null;
    let fromUrl = false;

    /* ── ③ URL 파라미터 확인 ── */
    const urlToken = new URLSearchParams(location.search).get(SHARE_PARAM);
    if (urlToken) {
        token   = urlToken;
        origUrl = location.href;
        fromUrl = true;
    } else {
        /* ── ④ sessionStorage 복원 → 없으면 localStorage 백업 ── */
        try {
            token   = sessionStorage.getItem(SS_TOKEN);
            origUrl = sessionStorage.getItem(SS_URL);
        } catch (_) {}

        /* sessionStorage 소실 시에만 localStorage 백업 복원
           (단, 같은 탭의 hard-refresh인 경우만 신뢰
            탭 닫고 재접속 시 sessionStorage 없음 → LS 백업도 무시 → 오너 모드) */
        if (!token) {
            try {
                /* 탭이 새로 열린 경우인지 판단: sessionStorage에 플래그 없으면 새 세션 */
                const isSameSess = !!sessionStorage.getItem('_shr_sess_alive');
                if (isSameSess) {
                    const ls = JSON.parse(localStorage.getItem(LS_BACKUP) || 'null');
                    if (ls && ls.t) { token = ls.t; origUrl = ls.u; }
                }
            } catch (_) {}
        }
    }

    if (!token) return true; // 공유 링크 아님 → 정상 실행

    /* ── ⑤ XOR 복호화 + 만료 검증 ── */
    let isValid = false;
    let decoded = null;
    try {
        decoded = shareDecrypt(token);
        /* 부관리자(deputy=true) 토큰은 만료 무시 — 본인은 영구 사용 가능
           부관리자가 재발급한 하위 링크만 기간 제한 적용 */
        isValid = !!decoded.deputy || Date.now() < decoded.exp;
    } catch (_) {}

    if (isValid) {
        /* URL 정리 (최초 접속 시) */
        if (fromUrl) {
            try { history.replaceState(null, '', location.pathname); } catch (_) {}
        }
        /* sessionStorage + localStorage 이중 저장 */
        try {
            sessionStorage.setItem(SS_TOKEN, token);
            sessionStorage.setItem(SS_URL,   origUrl);
            sessionStorage.setItem('_shr_sess_alive', '1'); /* 탭 생존 확인 플래그 */
        } catch (_) {}
        try {
            localStorage.setItem(LS_BACKUP, JSON.stringify({ t: token, u: origUrl }));
        } catch (_) {}

        /* PWA 설치 권한: 토큰의 allowPwa 플래그 (관리자가 생성 시 결정)
           true  → 수신자가 홈화면 설치 가능 + 최초 접속 시 안내 카드 표시
           false → 기존 동작 (manifest/apple 메타 제거 + 설치 프롬프트 차단) */
        const allowPwa         = !!decoded.allowPwa;
        const isDeputy         = !!decoded.deputy;           /* 부관리자 권한 부여된 링크 */
        const destroyOnInstall = !!decoded.destroyOnInstall; /* PWA 설치 시 즉시 파기 */

        if (!allowPwa) {
            window.addEventListener('beforeinstallprompt', e => {
                e.preventDefault();
                e.stopImmediatePropagation();
            }, { capture: true });
            window._blockPWA = true; /* DOMContentLoaded에서 manifest 제거 */
        } else {
            /* PWA 허용: 설치 프롬프트 캡처 → 우리 안내 카드와 연동 */
            window.addEventListener('beforeinstallprompt', e => {
                e.preventDefault();
                window._deferredInstallPrompt = e;
            });
        }

        /* PWA 설치 완료 시 즉시 파기 (부관리자 링크에서 destroyOnInstall=true인 경우)
           appinstalled 이벤트는 사용자가 "홈 화면에 추가"를 최종 수락했을 때 발생.
           이 순간 해당 공유 세션을 즉시 만료 처리.
           standalone 창과 탭이 별도로 뜨므로, 탭의 만료 확정 플래그만 세우면
           다음 접속부터 자동 차단됨 (PWA에서 새로 열 때도 동일 만료 페이지) */
        if (destroyOnInstall) {
            window.addEventListener('appinstalled', () => {
                try {
                    sessionStorage.removeItem('_shr_t');
                    sessionStorage.removeItem('_shr_u');
                    sessionStorage.setItem('_shr_blocked', '1');
                    localStorage.removeItem('_shr_ls');
                    localStorage.setItem('_shr_exp', '1'); /* 만료 확정 플래그 */
                } catch (_) {}
                /* SW 해제: 설치된 PWA가 향후 CSV를 계속 받는 것을 차단
                   (부관리자 링크의 목적은 임시 열람이므로 영구 설치 방지) */
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations()
                        .then(regs => regs.forEach(r => r.unregister()))
                        .catch(() => {});
                }
                /* 현재 탭도 만료 페이지로 전환 */
                showExpiredAndBlock();
            });
        }

        window._shareOrigUrl      = origUrl;
        window._isShareRecipient  = true;
        window._shareIncludeFavs  = !!decoded.includeFavs;
        window._shareAllowPwa     = allowPwa;
        window._shareExp          = decoded.exp;
        window._isDeputy          = isDeputy;
        window._destroyOnInstall  = destroyOnInstall;
        return true;
    }

    /* ── ⑥ 만료/위조: URL 난독화 + 이중 차단 플래그 + 만료 페이지 ──
       index.html 숨김 + 난독화 해시 → kdk0781.github.io/test/#3f7a9b2e */
    try {
        const _dir  = location.pathname.replace(/\/[^/]*$/, '/'); // /test/index.html → /test/
        const _rnd  = Math.random().toString(36).slice(2, 10)
                    + Math.random().toString(36).slice(2, 10);
        history.replaceState(null, '', _dir + '#' + _rnd);
    } catch (_) {}
    try {
        /* sessionStorage 차단 */
        sessionStorage.removeItem(SS_TOKEN);
        sessionStorage.removeItem(SS_URL);
        sessionStorage.setItem(SS_BLOCKED, '1');
        /* localStorage 백업 삭제 + 만료 확정 플래그 */
        localStorage.removeItem(LS_BACKUP);
        localStorage.setItem(LS_EXP_FLAG, '1');
    } catch (_) {}

    showExpiredAndBlock();
    return false;
}

/* 만료 페이지 표시 (DOM 준비 여부 자동 감지) */
function showExpiredAndBlock() {
    const render = () => {
        const splash = document.getElementById('splashOverlay');
        if (!splash) return;
        splash.style.cssText = 'opacity:1;visibility:visible;display:flex;pointer-events:auto';
        splash.innerHTML = `
            <div class="share-expired-page">
                <div class="sep-icon">${SHARE_EXPIRED_MSG.icon}</div>
                <h2 class="sep-title">${SHARE_EXPIRED_MSG.title}</h2>
                <p class="sep-desc">${SHARE_EXPIRED_MSG.desc}</p>
                <p class="sep-sub">${SHARE_EXPIRED_MSG.sub}</p>
            </div>`;
    };
    /* DOM이 이미 로드됐으면 즉시 실행, 아니면 이벤트 대기 */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render, { once: true });
    } else {
        render();
    }
}

// 공유 링크 만료 시 앱 실행 중단
const _shareValid = checkShareLink();



/* ── 전역 상태 ── */
let allGroups      = [];
let filteredGroups = [];
let activeRegion   = '전체';
let activeSort     = 'default';
let areaUnit       = 'sqm';
let loadedCount    = 0;
const LOAD_STEP    = 20;
let searchDebounceTimer = null;
let scrollObserver = null;

/* ── 즐겨찾기 상태 ── */
const FAV_KEY         = 'apt_map_favs';
let   favSet          = new Set();     // Set<string>  key = 지역|아파트
let   activeFavOnly   = false;         // 즐겨찾기만 보기 토글
let   activeFirstHome = false;         // 생애최초 LTV 모드

/* ── 최근 검색어 ── */
const RECENT_KEY      = 'apt_map_recent';
const RECENT_MAX      = 5;
let   recentSearches  = [];            // string[]



/* ── 면적 타입 suffix 매핑 ── */
const SUFFIX_MAP = {
    'T':'테라스','P':'펜트','C':'코너',
    'A':'타입A','B':'타입B','D':'타입D','E':'타입E',
};

/* ── 규제지역 (2025.10.16 기준) ── */
const ZONE_DATA = {
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

function getRegulationZone(sido, sgg) {
    sido = sido.trim(); sgg = sgg.trim();
    const a = ZONE_DATA.투기지역[sido] || [];
    if (a.some(g => sgg.includes(g))) return { zone:'A', label:'투기지역' };
    const b = ZONE_DATA.투기과열지구[sido] || [];
    if (b.some(g => sgg.includes(g))) return { zone:'B', label:'투기과열지구' };
    return { zone: null, label: '' };
}

/* ════════════════════════════════════════════
   대출 가능 한도 계산
   ────────────────────────────────────────────
   LTV 비율 (지역 규제 기준)
     투기지역 / 투기과열지구 (zone A·B) → 40%
     기타 지역                           → 70%

   정부 정책 한도 (일반가 기준)
     ≤ 15억                → 최대 6억
     15억 초과 ~ 25억 이하 → 최대 4억
     25억 초과             → 최대 2억

   최종 = min(LTV 계산액, 정책 한도)

   @param priceRaw  기준 가격 (만원)
   @param regZone   'A' | 'B' | null
   @param midRaw    정책 한도 판정용 일반가 (만원)
════════════════════════════════════════════ */
function getLoanLimit(priceRaw, regZone, midRaw) {
    if (!priceRaw || priceRaw <= 0) return null;

    const isReg = regZone === 'A' || regZone === 'B';

    /* ── LTV 비율 결정 ──
       생애최초 모드 ON + 규제지역 → LTV 70% (일반은 40%)
       정책 한도(6억/4억/2억)는 생애최초도 동일하게 적용 */
    let ltvRate, ltvPct;
    if (activeFirstHome && isReg) {
        ltvRate = 0.70;
        ltvPct  = 70;
    } else {
        ltvRate = isReg ? 0.40 : 0.70;
        ltvPct  = isReg ? 40   : 70;
    }

    /* LTV 계산 — 100만원 단위 절사 */
    const ltvAmt = Math.floor(priceRaw * ltvRate / 100) * 100;

    /* 정책 한도: 일반가(midRaw) 기준 — 생애최초도 동일 */
    const ref = midRaw || priceRaw;
    let policyLimit;
    if (ref <= 150000)      policyLimit = 60000;
    else if (ref <= 250000) policyLimit = 40000;
    else                    policyLimit = 20000;

    /* 두 기준 중 낮은 값 */
    const finalAmt   = Math.min(ltvAmt, policyLimit);
    const isLtvLimit = finalAmt === ltvAmt && ltvAmt < policyLimit;

    function fmtAmt(man) {
        const eok  = Math.floor(man / 10000);
        const rest = man % 10000;
        if (eok > 0 && rest > 0)
            return `${eok}억 ${rest.toLocaleString('ko-KR')}만`;
        if (eok > 0)
            return `${eok}억`;
        return `${rest.toLocaleString('ko-KR')}만`;
    }

    const amtStr = fmtAmt(finalAmt);

    /* CSS 클래스 */
    let cls;
    if (activeFirstHome && isReg) {
        cls = 'loan-first-home'; // 생애최초 규제지역 전용 색상
    } else if (isLtvLimit) {
        cls = isReg ? 'loan-ltv-reg' : 'loan-ltv-gen';
    } else {
        if (policyLimit === 60000)      cls = 'loan-pol-a';
        else if (policyLimit === 40000) cls = 'loan-pol-b';
        else                            cls = 'loan-pol-c';
    }

    return { amtStr, ltvPct, isLtvLimit, cls };
}
document.addEventListener('DOMContentLoaded', () => {
    if (!_shareValid) return; // 만료 링크면 앱 초기화 중단

    /* 버전 표시 (배포 확인용) */
    const vEl = document.getElementById('splashVersion');
    if (vEl) vEl.textContent = APP_VERSION;

    /* 관리자 모드 배지 — 페이지 진입 시 활성 상태면 즉시 표시 */
    if (!window._isShareRecipient && isAdmin()) {
        /* DOM 준비 직후 한 번 표시 */
        requestAnimationFrame(showAdminBadge);
    }

    /* ── 공유 수신자: PWA 관련 태그 전부 제거 ──
       토큰의 allowPwa=false 인 경우에만 적용.
       allowPwa=true 면 manifest를 그대로 두고 SW도 등록해 설치 가능하게 둠. */
    if (window._blockPWA) {
        document.querySelectorAll(
            'link[rel="manifest"], link[rel="apple-touch-icon"], ' +
            'meta[name="apple-mobile-web-app-capable"], ' +
            'meta[name="mobile-web-app-capable"]'
        ).forEach(el => el.remove());
        /* 이미 등록된 SW도 해제 */
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations()
                .then(regs => regs.forEach(r => r.unregister()))
                .catch(() => {});
        }
    }

    /* ── SW 등록 정책 ──
       오너                     → 등록 (CSV 업데이트 푸시/배너)
       공유 수신자 + PWA 허용  → 등록 (설치 가능 + CSV 업데이트 배너)
       공유 수신자 + PWA 차단  → 등록 하지 않음 (위에서 이미 unregister) */
    const _isShared    = !!window._isShareRecipient;
    const _allowPwaRcv = !!window._shareAllowPwa;
    const _shouldRegSW = !_isShared || _allowPwaRcv;

    if ('serviceWorker' in navigator && _shouldRegSW) {
        navigator.serviceWorker.register('sw.js').then(async (reg) => {
            /* 알림 권한 요청 — 오너만 (수신자에겐 PWA 설치 카드에서 처리) */
            if (!_isShared) {
                setTimeout(() => {
                    /* PWA 설치 상태면 setupLocalNotification()이 배너로 처리하므로
                       여기서는 비-PWA 오너만 직접 요청 (브라우저 탭 사용자) */
                    if (!isPWAInstalled()) {
                        requestNotificationPermission();
                    }
                }, 3000);
            }

            /* SW로부터 CSV 업데이트 메시지 수신 (오너 + PWA 허용 수신자 모두) */
            navigator.serviceWorker.addEventListener('message', (e) => {
                if (e.data?.type === 'CSV_UPDATED') {
                    showCsvUpdateBanner();
                }
            });

            /* Periodic Background Sync — 지원 브라우저에서 6시간마다 CSV 변경 확인
               PWA 설치자에게 백그라운드 알림 효과 제공 */
            try {
                if ('periodicSync' in reg) {
                    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                    if (status.state === 'granted') {
                        await reg.periodicSync.register('csv-check', {
                            minInterval: 6 * 60 * 60 * 1000, /* 6시간 */
                        });
                        console.log('[PeriodicSync] csv-check 등록');
                    }
                }
            } catch (_) {}
        }).catch(() => {});
    }

    /* 공유 수신자(SW 미등록 케이스 포함) — 인-앱 폴링으로 CSV 갱신 감지
       ① PWA 차단 수신자 : SW 없음 → 폴링 필수
       ② PWA 허용 수신자 : SW 메시지로도 받지만 폴링은 추가 안전망
       오너는 SW가 처리하므로 폴링하지 않음 */
    if (_isShared) {
        setupCsvPollingForRecipient();
    }

    /* PWA 허용 받은 공유 수신자 — 최초 1회 설치 안내 카드
       sessionStorage 키로 ‘이번 탭에서 이미 표시했나’ 체크
       닫기/설치 모두 동일 세션 내 재노출 안 함 */
    if (_isShared && _allowPwaRcv) {
        try {
            if (!sessionStorage.getItem('_shr_pwa_prompt_shown')) {
                /* 페이지 컨텐츠 표시 후 자연스러운 타이밍 */
                setTimeout(showPwaInstallPromptForRecipient, 1500);
                sessionStorage.setItem('_shr_pwa_prompt_shown', '1');
            }
        } catch (_) {}
    }

    /* 강제 새로고침
       ─────────────────────────────────────────
       가격 비교 캐시(apt_map_curr / apt_map_prev)는 지우지 않음.
       새 CSV가 올라올 때까지 지난주 대비 변동이 계속 표시되어야 하기 때문.
       서비스워커·브라우저 캐시·그 외 localStorage 항목만 초기화.
       ───────────────────────────────────────── */
    document.getElementById('hardRefreshBtn').addEventListener('click', async () => {
        document.querySelector('#hardRefreshBtn span').textContent = '업데이트 중...';
        try {
            /* 서비스워커 해제 */
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
            /* 브라우저 캐시 삭제 */
            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.map(n => caches.delete(n)));
            }
            /* localStorage: 반드시 보존할 키들을 먼저 저장 후 clear */
            const savedCurr        = localStorage.getItem(CACHE_CURR);
            const savedPrev        = localStorage.getItem(CACHE_PREV);
            const savedFavs        = localStorage.getItem(FAV_KEY);
            const savedRecent      = localStorage.getItem(RECENT_KEY);
            const savedAdmin       = localStorage.getItem(ADMIN_LS_KEY);   /* 관리자 모드 상태 보존 */

            const isShareSess  = !!sessionStorage.getItem('_shr_t');
            const savedShrLs   = isShareSess ? localStorage.getItem('_shr_ls') : null;
            const savedShrExp  = localStorage.getItem('_shr_exp');
            localStorage.clear();
            if (savedCurr)        localStorage.setItem(CACHE_CURR, savedCurr);
            if (savedPrev)        localStorage.setItem(CACHE_PREV, savedPrev);
            if (savedFavs)        localStorage.setItem(FAV_KEY, savedFavs);
            if (savedRecent)      localStorage.setItem(RECENT_KEY, savedRecent);
            if (savedAdmin)       localStorage.setItem(ADMIN_LS_KEY, savedAdmin);

            if (savedShrLs)       localStorage.setItem('_shr_ls', savedShrLs);
            if (savedShrExp)      localStorage.setItem('_shr_exp', savedShrExp);

            /* sessionStorage: 공유 관련 키만 보존, 나머지 삭제 */
            const ssToken    = sessionStorage.getItem('_shr_t');
            const ssUrl      = sessionStorage.getItem('_shr_u');
            const ssBlocked  = sessionStorage.getItem('_shr_blocked');
            const ssAlive    = sessionStorage.getItem('_shr_sess_alive');
            const ssRecent   = sessionStorage.getItem('_shr_recent');      // 수신자 최근검색
            const ssRcClr    = sessionStorage.getItem('_shr_rc_cleared');  // 첫접속 판단 플래그
            sessionStorage.clear();
            if (ssToken)  sessionStorage.setItem('_shr_t', ssToken);
            if (ssUrl)    sessionStorage.setItem('_shr_u', ssUrl);
            if (ssBlocked)sessionStorage.setItem('_shr_blocked', ssBlocked);
            if (ssAlive)  sessionStorage.setItem('_shr_sess_alive', ssAlive);
            if (ssRecent) sessionStorage.setItem('_shr_recent', ssRecent);
            if (ssRcClr)  sessionStorage.setItem('_shr_rc_cleared', ssRcClr);
        } finally { window.location.reload(true); }
    });

    /* ─────────────────────────────────────────
       listBody 클릭 위임
       ★ 핵심: fav-star-btn 과 accordion-btn 이
         group-item-header 안의 형제 요소로 완전 분리.
         star 클릭 시 accordion-btn 클릭 이벤트 없음.
         accordion 클릭 시 fav-star-btn 클릭 이벤트 없음.
       ───────────────────────────────────────── */
    document.getElementById('listBody').addEventListener('click', (e) => {

        /* ── ① 즐겨찾기 별표 (accordion-btn 밖, 형제 요소) ── */
        const starBtn = e.target.closest('.fav-star-btn');
        if (starBtn) {
            const key = starBtn.getAttribute('data-fav-key'); // dataset 미사용 (난독화 충돌 방지)
            if (!key) return;
            const wasFav = favSet.has(key);
            wasFav ? favSet.delete(key) : favSet.add(key);
            saveFavorites();
            const isNowFav = favSet.has(key);
            starBtn.classList.toggle('active', isNowFav);
            starBtn.textContent = isNowFav ? '⭐' : '☆';
            starBtn.title = isNowFav ? '즐겨찾기 해제' : '즐겨찾기 추가';
            /* 즐겨찾기 뷰에서 해제 시만 재렌더링 */
            if (activeFavOnly && !isNowFav) applyFilters();
            return; /* accordion 코드 절대 실행 안됨 */
        }

        /* ── ② 아코디언 (star와 완전히 분리된 영역) ── */
        const btn = e.target.closest('.accordion-btn');
        if (!btn) return;
        /* accordion-btn > group-item-header > group-item 순으로 올라감 */
        const item = btn.closest('.group-item');
        if (!item) return;
        const wasActive = item.classList.contains('active');
        document.querySelectorAll('.group-item.active').forEach(el => {
            if (el !== item) el.classList.remove('active');
        });
        item.classList.toggle('active', !wasActive);
        if (!wasActive) {
            setTimeout(() => {
                const hdr = document.querySelector('.sticky-header');
                const hBottom = hdr ? hdr.getBoundingClientRect().bottom : 120;
                const rect = item.getBoundingClientRect();
                if (rect.top < hBottom + 10) {
                    window.scrollTo({ top: window.scrollY + rect.top - hBottom - 10, behavior: 'smooth' });
                }
            }, 320);
        }
    });

    /* 검색 */
    const _si = document.getElementById('searchInput');
    _si.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            applyFilters();
            renderRecentSearchUI();
        }, 250);
    });

    /* 최근 검색어 저장 시점: Enter 확정 또는 포커스 아웃 */
    const _saveSearchTerm = () => {
        const v = _si.value.trim();
        if (v.length >= 2) saveRecentSearch(v); /* 2글자 이상일 때만 저장 */
    };
    _si.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const v = _si.value.trim();

            /* ── 관리자 모드 활성화 ── */
            if (v === ADMIN_PASSPHRASE) {
                e.preventDefault();
                _si.value = '';
                _si.blur();
                renderRecentSearchUI();
                if (window._isShareRecipient) {
                    /* 공유 수신자 환경에선 활성화 거부 (다른 기기로 유출 방지) */
                    showToast('⛔ 공유 링크 환경에서는 활성화할 수 없습니다');
                    return;
                }
                setAdmin(true);
                showAdminBadge();
                rebindShareBtn(); /* 공유 버튼을 관리자 모드 핸들러로 재바인딩 */
                reclassifyToDirectVisit(); /* 공유 → 직접 접속으로 재분류 */
                showToast('👑 관리자 모드 활성화 — 공유 버튼에 옵션이 표시됩니다');
                return;
            }
            /* ── 관리자 모드 해제 ── */
            if (v === ADMIN_PASSPHRASE_OFF) {
                e.preventDefault();
                _si.value = '';
                _si.blur();
                renderRecentSearchUI();
                setAdmin(false);
                hideAdminBadge();
                rebindShareBtn(); /* 공유 버튼을 일반 복사 핸들러로 재바인딩 */
                showToast('관리자 모드를 해제했습니다');
                return;
            }

            if (v === '투데이') {
                e.preventDefault();
                _si.value = '';
                _si.blur(); // 키보드 닫기
                renderRecentSearchUI();
                showTodayVisitorPopup();
                return;
            }
            if (v === '알림전송') {
                e.preventDefault();
                _si.value = '';
                _si.blur();
                renderRecentSearchUI();
                showPushAdminPanel();
                return;
            }
            if (v === '알림구독') {
                e.preventDefault();
                _si.value = '';
                _si.blur();
                renderRecentSearchUI();
                requestPushPermission();
                return;
            }
            _saveSearchTerm();
            _si.blur(); /* 모바일 키보드 닫기 → 결과 즉시 확인 가능 */
            renderRecentSearchUI();
        }
    });
    _si.addEventListener('blur', () => {
        _saveSearchTerm();
        /* 포커스 아웃 시 최근검색 힌트 표시 딜레이 (클릭 이벤트와 충돌 방지) */
        setTimeout(renderRecentSearchUI, 150);
    });

    /* 정렬 */
    document.getElementById('sortSelect').addEventListener('change', (e) => {
        activeSort = e.target.value;
        applyFilters();
    });

    /* ㎡ ↔ 평 토글 */
    document.getElementById('unitToggleBtn').addEventListener('click', () => {
        areaUnit = areaUnit === 'sqm' ? 'pyeong' : 'sqm';
        document.body.classList.toggle('pyeong-mode', areaUnit === 'pyeong');
        const btn = document.getElementById('unitToggleBtn');
        btn.querySelector('.u-label-sqm').classList.toggle('active', areaUnit === 'sqm');
        btn.querySelector('.u-label-pyeong').classList.toggle('active', areaUnit === 'pyeong');
    });

    /* 생애최초 LTV 토글 */
    document.getElementById('firstHomeBtn')?.addEventListener('click', () => {
        /* ── 기준점 결정 ──
           1순위: 열려있는 아코디언 탭 (.group-item.active)
           2순위: 헤더 아래 첫 번째로 보이는 카드 */
        const _hdrBottom = (document.querySelector('.sticky-header')?.getBoundingClientRect().bottom ?? 0);
        const _allItems  = [...document.querySelectorAll('#listBody .group-item')];

        /* 열린 탭 우선 */
        const _openItem = document.querySelector('#listBody .group-item.active');

        let _anchorIdx = -1;
        if (_openItem) {
            _anchorIdx = _allItems.indexOf(_openItem);
        } else {
            /* 열린 탭 없으면 헤더 아래 첫 번째 카드 */
            for (let i = 0; i < _allItems.length; i++) {
                if (_allItems[i].getBoundingClientRect().bottom > _hdrBottom + 2) {
                    _anchorIdx = i; break;
                }
            }
        }

        activeFirstHome = !activeFirstHome;
        const btn = document.getElementById('firstHomeBtn');
        btn.classList.toggle('active', activeFirstHome);
        btn.title = activeFirstHome ? '생애최초 LTV 해제' : '생애최초 LTV 적용';

        renderInitial(true);

        /* ── 재렌더 후 기준 카드를 스티키 헤더 바로 아래로 스크롤 ── */
        if (_anchorIdx >= 0) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const _target = document.querySelectorAll('#listBody .group-item')[_anchorIdx];
                    if (_target) {
                        const _hdr    = document.querySelector('.sticky-header');
                        const _hBottom = _hdr ? _hdr.getBoundingClientRect().bottom : 0;
                        const _rect   = _target.getBoundingClientRect();
                        window.scrollTo({
                            top: window.scrollY + _rect.top - _hBottom - 4,
                            behavior: 'instant'
                        });
                    }
                });
            });
        }
    });

    setupScrollObserver();
    setupScrollTopBtn(); /* 맨위로 버튼 초기화 */
    setupShareBtn();     /* 공유 버튼 초기화 */

    /* ── 즐겨찾기 초기화 ── */
    loadFavorites();



    const _isShareRecv = !!window._isShareRecipient;

    if (_isShareRecv) {
        /* ── 공유 링크 수신자 초기화 ──
           최근검색: sessionStorage 전용 (탭 격리 → 다른 수신자에게 절대 유출 안 됨)
           새로고침: sessionStorage 유지 → 검색어 보존
           탭 닫기: sessionStorage 소멸 → 다음 링크 접속 시 빈 상태 (의도된 동작)

           즐겨찾기: 포함 허용 시 → 수신자 자신의 localStorage[apt_map_favs] 사용
                    미포함 시   → 빈 Set (UI 숨김) */
        const _rcCleared = sessionStorage.getItem('_shr_rc_cleared');
        if (!_rcCleared) {
            /* 새 탭 첫 접속: 최근검색 빈 배열로 시작 */
            recentSearches = [];
            sessionStorage.setItem('_shr_recent', '[]');
            sessionStorage.setItem('_shr_rc_cleared', '1');
        } else {
            /* 새로고침: sessionStorage에서 복원 */
            try {
                const raw = sessionStorage.getItem('_shr_recent');
                recentSearches = raw ? JSON.parse(raw) : [];
            } catch { recentSearches = []; }
        }

        /* 즐겨찾기 설정 */
        if (!window._shareIncludeFavs) {
            favSet = new Set(); /* 즐겨찾기 미포함: UI 숨김 */
        }
        /* includeFavs=true면 loadFavorites()에서 이미 로드된 값 그대로 사용 */

        renderRecentSearchUI();
    } else {
        /* 오너: localStorage에서 정상 로드 */
        loadRecentSearches();
    }

    /* 공유 링크 → 프리뷰 먼저 표시 */
    if (window._showSharePreview) {
        showSharePreview();
        return; // loadData는 startApp()에서 호출
    }

    /* 오늘 방문자 카운트
       ─────────────────────────────────────────
       직접 접속 : 관리자 + 부관리자 (약 7명)
       공유 접속 : 일반 수신자 + 비관리자 일반 방문자 (나머지 전부)
       → 관리자가 아닌 일반 방문자도 "공유 접속"으로 분류됨 */
    const _isDirect = isAdmin() || !!window._isDeputy;
    trackTodayVisit(_isDirect);

    loadData();

    /* PWA 설치자 알림 초기화
       ─────────────────────────────────────────
       ① 로컬 알림: SW의 showNotification()만 사용 (서버 불필요)
          → PUSH_WORKER_URL 없어도 CSV 변경 감지 시 앱 알림 표시
          → Notification.permission === 'granted' 만 확보하면 됨
       ② 외부 푸시: PUSH_WORKER_URL 설정 시 추가 기능 (선택)
       
       오너 + PWA 허용 수신자 모두 동일하게 적용 */
    if (isPWAInstalled()) {
        setupLocalNotification();   /* 로컬 알림 (서버 불필요) */
        setupPushNotification();    /* 외부 푸시 (PUSH_WORKER_URL 설정 시) */
    }
});

/* 스티키 헤더 높이 동기화 */
function syncScrollPadding() {
    const el = document.querySelector('.sticky-header');
    if (!el) return;
    document.documentElement.style.setProperty('scroll-padding-top', (el.offsetHeight + 10) + 'px');
}
window.addEventListener('resize', syncScrollPadding, { passive: true });

/* ════════════════════════════════════════════
   스플래시 제어
════════════════════════════════════════════ */
function hideSplash() {
    const el = document.getElementById('splashOverlay');
    if (el) el.classList.add('hide');
}

function showSplashError(msg) {
    const el = document.getElementById('splashOverlay');
    if (!el) return;
    el.innerHTML = `
        <div class="splash-error">
            <span style="font-size:2rem">⚠️</span>
            <p>${msg || '데이터를 불러올 수 없습니다.'}</p>
            <small>새로고침 버튼을 눌러 다시 시도하세요.</small>
            <button onclick="window.location.reload(true)" class="refresh-btn" style="margin-top:16px">
                <span>다시 시도</span>
            </button>
            <small style="margin-top:8px;opacity:0.5">${APP_VERSION}</small>
        </div>`;
}

/* ════════════════════════════════════════════
   데이터 로딩
   - 5초 안전망 타이머 (무한 로딩 절대 방지)
   - fetch 실패 → showSplashError (영원히 안 닫히는 스플래시 없음)
   - 파싱 예외 → showSplashError
   - 정상 완료 → hideSplash
   세 경우 모두 반드시 스플래시가 처리됨
════════════════════════════════════════════ */
function loadData() {
    console.log('[loadData] 시작', APP_VERSION);

    /* 5초 안전망: 어떤 경우에도 스플래시 닫힘 */
    const safetyTimer = setTimeout(() => {
        console.warn('[loadData] 5초 안전망 발동');
        hideSplash();
    }, 5000);

    const done = (ok) => {
        clearTimeout(safetyTimer);
        if (ok) hideSplash();
    };

    fetch('excel/map.csv', {
            cache: 'no-store',
            headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache, no-store' }
        })
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.arrayBuffer();
        })
        .then(buf => {
            console.log('[loadData] CSV 수신 완료', buf.byteLength, 'bytes');
            let csv;
            try {
                csv = new TextDecoder('euc-kr').decode(buf);
            } catch (e) {
                console.warn('[loadData] euc-kr 디코딩 실패, utf-8 재시도');
                csv = new TextDecoder('utf-8').decode(buf);
            }
            parseAndRender(csv);
            done(true);
        })
        .catch(err => {
            console.error('[loadData] 오류:', err);
            done(false);
            showSplashError('CSV 파일을 불러올 수 없습니다. (' + err.message + ')');
        });
}

/* ════════════════════════════════════════════
   안전한 CSV 한 줄 파서 (상태기계, O(n))
   기존 정규식은 홀수 따옴표에서 무한 루프 발생
════════════════════════════════════════════ */
function parseCSVLine(line) {
    const fields = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { field += '"'; i++; }
            else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
            fields.push(field.trim()); field = '';
        } else {
            field += ch;
        }
    }
    fields.push(field.trim());
    return fields;
}

/* ════════════════════════════════════════════
   가격 캐시 (localStorage)  ─ 두 슬롯 구조
   ┌──────────────────────────────────────┐
   │ apt_map_curr : 현재 주 데이터        │
   │ apt_map_prev : 비교 기준(이전 주)    │
   └──────────────────────────────────────┘
   동작:
   ① 새 날짜 CSV 업로드 시
      기존 curr → prev 승격
      새 데이터 → curr 저장
      diff = 새 데이터 vs (승격된) prev

   ② 같은 날짜 재로드 / 새로고침 / 강제 새로고침
      curr · prev 변동 없음
      diff = curr vs prev  ← 다음 업로드 전까지 영구 유지

   ※ 강제 새로고침(hardRefreshBtn)은 서비스워커·브라우저캐시만 초기화.
      가격 캐시 두 슬롯은 건드리지 않으므로 diff가 사라지지 않음.
════════════════════════════════════════════ */
const CACHE_CURR = 'apt_map_curr';
const CACHE_PREV = 'apt_map_prev';

function buildPriceKey(row) {
    return `${row.시도}|${row.시군구}|${row.동}|${row.아파트}|${row.공급면적}|${row.전용면적}|${row.suffix}`;
}

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('[priceCache] 저장 실패:', e.message);
    }
}

function buildCachePayload(dateText, flatData) {
    const p = {};
    for (const row of flatData) {
        p[buildPriceKey(row)] = [row.하한가Raw, row.일반가Raw, row.상한가Raw];
    }
    return { dateText, p };
}

/**
 * 캐시 비교 + 갱신
 * @returns {Object|null}  비교 기준 캐시 (없으면 null → diff 미표시)
 */
function syncPriceCache(baseDateText, flatData) {
    const curr = readCache(CACHE_CURR);

    if (curr && curr.dateText === baseDateText) {
        // ② 같은 주 재로드 → prev 그대로 유지, diff 계속 표시
        const prev = readCache(CACHE_PREV);
        console.log('[priceCache] 같은 주 재로드 → diff 유지', prev ? prev.dateText : '(없음)');
        return prev;          // prev가 비교 기준
    }

    // ① 새 날짜 CSV
    // 기존 curr → prev 승격
    if (curr) {
        writeCache(CACHE_PREV, curr);
        console.log('[priceCache] curr→prev 승격:', curr.dateText);
    }
    // 새 데이터 → curr 저장
    writeCache(CACHE_CURR, buildCachePayload(baseDateText, flatData));
    console.log('[priceCache] 새 curr 저장:', baseDateText);

    return curr;    // 비교 기준 = 방금 승격된 구 curr (없으면 null)
}

/* ════════════════════════════════════════════
   CSV 파싱 + 렌더링 (완전 동기, 38ms)
════════════════════════════════════════════ */
function parseAndRender(csv) {
    console.log('[parseAndRender] 시작');
    const t0 = Date.now();

    const lines = csv.split(/\r\n|\n/);

    /* 기준일 추출 */
    let baseDateText = '';
    for (let i = 0; i < Math.min(15, lines.length); i++) {
        const regex = /(20\d{2})[-.년\s]+([0-1]?\d)[-.월\s]+([0-3]?\d)일?/g;
        const dates = [];
        let m;
        while ((m = regex.exec(lines[i])) !== null) {
            dates.push(`${m[1]}.${m[2].padStart(2,'0')}.${m[3].padStart(2,'0')}`);
        }
        if (dates.length >= 2) { baseDateText = `${dates[0]} ~ ${dates[1]}`; break; }
        if (dates.length === 1) { baseDateText = dates[0]; break; }
    }
    const dateLabel = document.getElementById('baseDateLabel');
    if (dateLabel) {
        if (baseDateText) dateLabel.textContent = '기준일 ' + baseDateText;
        else dateLabel.style.display = 'none';
    }

    /* 스킵 키워드 */
    const SKIP = [
        '전국은행연합회','조견표','절대 수정 금지','대출상담사',
        '시도,시군구','시/도','공급면적','하한가',
    ];

    /* 헬퍼 */
    const toNum  = v => parseFloat(String(v).replace(/,/g, ''));
    const toPrice = v => { const n = toNum(v); return (isNaN(n)||n===0) ? '-' : n.toLocaleString('ko-KR'); };
    const toRaw  = v => { const n = toNum(v); return isNaN(n) ? 0 : n; };
    const toArea = v => { const n = toNum(v); if(isNaN(n)) return String(v); return n%1===0 ? String(n) : n.toFixed(2).replace(/\.?0+$/,''); };
    const toPyeong = (sqm, p) => {
        if (p) { const n=toNum(p); if(!isNaN(n)&&n>0) return n+'평'; }
        const n = toNum(sqm);
        return isNaN(n) ? '-' : (n/3.3058).toFixed(1)+'평';
    };
    const getSuffix = v => {
        const raw = String(v).trim().replace(/^[\d.,]+/,'');
        if (!raw) return '';
        if (/[가-힣]/.test(raw)) return raw.slice(0,6);
        const u = raw.toUpperCase();
        return SUFFIX_MAP[u] || raw.slice(0,6);
    };

    /* 파싱 */
    const flatData = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (SKIP.some(k => line.includes(k))) continue;

        const col = parseCSVLine(line);
        if (col.length < 11 || !col[0]) continue;
        if (col[3] === '아파트' || col[3] === '단지명') continue;

        const sido = col[0].trim(), sgg = col[1].trim(), dong = col[2].trim(), apt = col[3].trim();
        if (!apt || !sido) continue;

        flatData.push({
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
            // 가격 변동 (loadPriceCache 비교 후 주입)
            diffLow: null, diffMid: null, diffHigh: null,
        });
    }

    /* ── 지난주 가격 비교 ── */
    const compCache = syncPriceCache(baseDateText, flatData);
    if (compCache) {
        const pm = compCache.p;
        for (const row of flatData) {
            const prev = pm[buildPriceKey(row)];
            if (prev) {
                row.diffLow  = row.하한가Raw - prev[0];
                row.diffMid  = row.일반가Raw - prev[1];
                row.diffHigh = row.상한가Raw - prev[2];
            }
        }
    }

    /* 그룹화 */
    const map = new Map();
    for (const row of flatData) {
        const key = `${row.시도}|${row.시군구}|${row.동}|${row.아파트}`;
        if (!map.has(key)) {
            const reg = getRegulationZone(row.시도, row.시군구);
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

    allGroups = Array.from(map.values()).map(g => {
        if (g.minPrice === Infinity) g.minPrice = 0;
        g.searchKey = `${g.지역} ${g.아파트}`.toLowerCase();
        return g;
    });

    /* 지역 칩 */
    const regions = ['전체', ...new Set(allGroups.map(g => g.시도).sort())];
    buildRegionChips(regions);
    requestAnimationFrame(syncScrollPadding);

    filteredGroups = allGroups;

    const t1 = Date.now();
    console.log(`[parseAndRender] 완료: ${allGroups.length}단지, ${t1-t0}ms`);

    renderInitial();
}

/* ════════════════════════════════════════════
   지역 칩 (즐겨찾기 칩 포함)
════════════════════════════════════════════ */
function buildRegionChips(regions) {
    const wrap = document.getElementById('regionFilter');
    if (!wrap) return;

    /* 모바일 주요 지역 목록 (이 외는 mobile-hidden 클래스로 숨김) */
    const MOBILE_MAIN = new Set(['전체','서울특별시','경기도','인천광역시']);

    /* 공유 수신자 + 즐겨찾기 미포함이면 칩 숨김 */
    const _showFavChip = !window._isShareRecipient || window._shareIncludeFavs;

    wrap.innerHTML = [
        /* 즐겨찾기 칩 (항상 첫 번째) */
        _showFavChip ? `<button class="region-chip fav-chip${activeFavOnly?' active':''}" data-fav="1" title="즐겨찾기한 단지만 보기">
            <span class="fav-chip-star">⭐</span><span class="fav-chip-text"> 즐겨찾기</span>
         </button>` : '',
        /* 지역 칩 */
        ...regions.map(r => {
            const hideCls = MOBILE_MAIN.has(r) ? '' : ' mobile-hidden';
            return `<button class="region-chip${r==='전체'&&!activeFavOnly?' active':''}${hideCls}" data-region="${r}">${r}</button>`;
        })
    ].join('');

    wrap.addEventListener('click', (e) => {
        const chip = e.target.closest('.region-chip');
        if (!chip) return;

        if (chip.dataset.fav) {
            /* 즐겨찾기 토글 */
            activeFavOnly = !activeFavOnly;
            chip.classList.toggle('active', activeFavOnly);
            /* 즐겨찾기 활성 시 지역 칩 비활성화 */
            wrap.querySelectorAll('.region-chip:not([data-fav])').forEach(c =>
                c.classList.remove('active')
            );
            if (!activeFavOnly) {
                /* 즐겨찾기 해제 시 전체 칩 다시 활성 */
                wrap.querySelector('[data-region="전체"]')?.classList.add('active');
                activeRegion = '전체';
            }
        } else {
            /* 지역 칩 */
            activeFavOnly = false;
            wrap.querySelector('[data-fav]')?.classList.remove('active');
            activeRegion = chip.dataset.region;
            wrap.querySelectorAll('.region-chip:not([data-fav])').forEach(c =>
                c.classList.toggle('active', c === chip)
            );
        }
        applyFilters();
    });
}

/* ════════════════════════════════════════════
   필터 + 정렬
════════════════════════════════════════════ */
function applyFilters() {
    const raw   = document.getElementById('searchInput').value.trim().toLowerCase();
    const terms = raw ? raw.split(/\s+/) : [];

    let result = allGroups;

    /* 즐겨찾기 필터 */
    if (activeFavOnly) {
        result = result.filter(g => favSet.has(favKey(g)));
    } else if (activeRegion !== '전체') {
        result = result.filter(g => g.시도 === activeRegion);
    }

    if (terms.length > 0) result = result.filter(g => terms.every(t => g.searchKey.includes(t)));

    switch (activeSort) {
        case 'name':      result = [...result].sort((a,b) => a.아파트.localeCompare(b.아파트,'ko')); break;
        case 'price_asc': result = [...result].sort((a,b) => (a.minPrice||Infinity)-(b.minPrice||Infinity)); break;
        case 'price_desc':result = [...result].sort((a,b) => b.maxPrice-a.maxPrice); break;
        case 'diff_up':
            /* 지난주 대비 상승순: 변동없음 제외 + 최대 상승폭 내림차순 */
            result = result
                .map(g => {
                    const diffs = g.rows.map(r => r.diffMid).filter(d => d !== null && d !== undefined);
                    const maxUp = diffs.length ? Math.max(...diffs) : 0;
                    return { g, maxUp };
                })
                .filter(({ maxUp }) => maxUp > 0)   /* 상승 있는 단지만 */
                .sort((a, b) => b.maxUp - a.maxUp)
                .map(({ g }) => g);
            break;
        case 'diff_down':
            /* 지난주 대비 하락순: 변동없음 제외 + 최대 하락폭 내림차순 */
            result = result
                .map(g => {
                    const diffs = g.rows.map(r => r.diffMid).filter(d => d !== null && d !== undefined);
                    const maxDown = diffs.length ? Math.min(...diffs) : 0;
                    return { g, maxDown };
                })
                .filter(({ maxDown }) => maxDown < 0)  /* 하락 있는 단지만 */
                .sort((a, b) => a.maxDown - b.maxDown) /* 하락 많은 순 */
                .map(({ g }) => g);
            break;
    }

    filteredGroups = result;
    renderInitial();
}

/* ════════════════════════════════════════════
   HTML 생성
════════════════════════════════════════════ */
function getPriceRange(g) {
    if (!g.minPrice && !g.maxPrice) return '';
    if (g.minPrice === g.maxPrice) return g.minPrice.toLocaleString('ko-KR')+'만';
    return `${g.minPrice.toLocaleString('ko-KR')} ~ ${g.maxPrice.toLocaleString('ko-KR')}만`;
}

/* 가격 변동 뱃지 생성 헬퍼 */
function diffBadge(diff) {
    if (diff === null || diff === undefined || diff === 0)
        return `<span class="price-diff none">-</span>`;
    const abs = Math.abs(diff).toLocaleString('ko-KR');
    return diff > 0
        ? `<span class="price-diff up">🔺${abs}</span>`
        : `<span class="price-diff down">🔽${abs}</span>`;
}

function createGroupHTML(g) {
    const priceRange = getPriceRange(g);

    /* 규제지역 배지 + LTV 칩 (카드 헤더)
       생애최초 모드: 규제지역도 LTV 70% 표시 */
    const isRegCard = g.regZone === 'A' || g.regZone === 'B';
    const ltvPct = (isRegCard && !activeFirstHome) ? 40 : 70;
    const ltvChipCls = (isRegCard && activeFirstHome) ? 'ltv-chip ltv-70 ltv-first' : `ltv-chip ltv-${ltvPct}`;
    const ltvChip = `<span class="${ltvChipCls}">LTV ${ltvPct}%${activeFirstHome && isRegCard ? ' <em class="ltv-fh-mark">생애최초</em>' : ''}</span>`;
    const regBadge = g.regLabel
        ? `<div class="reg-badges">
               <span class="reg-badge reg-${g.regZone}">${g.regLabel}</span>
               ${ltvChip}
           </div>`
        : `<div class="reg-badges">${ltvChip}</div>`;

    // 그룹 내 변동 요약 (일반가 기준, 헤더에 표시)
    const midDiffs = g.rows.map(r => r.diffMid).filter(d => d !== null && d !== 0);
    let groupDiffBadge = '';
    if (midDiffs.length > 0) {
        const maxUp   = Math.max(...midDiffs.filter(d => d > 0), 0);
        const maxDown = Math.min(...midDiffs.filter(d => d < 0), 0);
        if (maxUp > 0 && maxDown < 0) {
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

        /* 하한가 기준 대출 (1층 기준) */
        const loanLow = getLoanLimit(row.하한가Raw, g.regZone, row.일반가Raw);
        const loanLowBadge = loanLow
            ? `<span class="loan-badge ${loanLow.cls}">대출 ${loanLow.amtStr}</span>`
            : '';

        /* 일반가 기준 대출 (일반층 기준) */
        const loanMid = getLoanLimit(row.일반가Raw, g.regZone, row.일반가Raw);
        const loanMidBadge = loanMid
            ? `<span class="loan-badge ${loanMid.cls}">대출 ${loanMid.amtStr}</span>`
            : '';

        /* 대출 행 (풀폭, 3컬럼 아래 별도 배치) */
        const loanRowHTML = (loanLow || loanMid) ? `
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
                        ${diffBadge(row.diffLow)}
                    </div>
                    <div class="price-box mid">
                        <span class="price-label">일반가</span>
                        <span class="price-val">${row.일반가}</span>
                        ${diffBadge(row.diffMid)}
                    </div>
                    <div class="price-box high">
                        <span class="price-label">상한가</span>
                        <span class="price-val">${row.상한가}</span>
                        ${diffBadge(row.diffHigh)}
                    </div>
                </div>
            </div>
            ${loanRowHTML}
        </div>`;
    }

    const isFav = favSet.has(favKey(g));
    const fKey  = favKey(g);
    /* 공유 수신자 + 즐겨찾기 미포함이면 별표 숨김 */
    const _showStar = !window._isShareRecipient || window._shareIncludeFavs;
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

/* ════════════════════════════════════════════
   렌더링
════════════════════════════════════════════ */
function renderInitial(keepScroll) {
    const listBody = document.getElementById('listBody');
    const sentinel = document.getElementById('scrollSentinel');
    const countEl  = document.getElementById('resultCount');

    listBody.innerHTML = '';
    loadedCount = 0;

    const total = filteredGroups.length;
    const isFiltered = activeRegion !== '전체' || activeFavOnly || document.getElementById('searchInput').value.trim() !== '';
    if (countEl) {
        countEl.textContent = isFiltered
            ? `${total.toLocaleString()}개 단지`
            : `전체 ${allGroups.length.toLocaleString()}개 단지`;
    }

    if (total === 0) {
        listBody.innerHTML = `<div class="empty-state"><span class="empty-icon">🔍</span><p>조건에 맞는 시세 정보가 없습니다.</p><small>검색어 또는 지역 필터를 변경해보세요.</small></div>`;
        sentinel.style.display = 'none';
        return;
    }

    if (keepScroll) {
        /* 스크롤 위치 유지 모드: 현재 scrollY를 커버할 만큼 충분히 로드
           카드 평균 높이 ~120px 기준, 여유 있게 계산 */
        const _estCount = Math.ceil((window.scrollY + window.innerHeight * 2) / 100) + LOAD_STEP;
        const _need = Math.min(_estCount, filteredGroups.length);
        while (loadedCount < _need) loadMore();
    } else {
        loadMore();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function loadMore() {
    const listBody = document.getElementById('listBody');
    const sentinel = document.getElementById('scrollSentinel');
    const next  = Math.min(loadedCount + LOAD_STEP, filteredGroups.length);
    const slice = filteredGroups.slice(loadedCount, next);
    if (slice.length > 0) listBody.insertAdjacentHTML('beforeend', slice.map(createGroupHTML).join(''));
    loadedCount = next;
    sentinel.style.display = loadedCount >= filteredGroups.length ? 'none' : 'block';
}

function setupScrollObserver() {
    const sentinel = document.getElementById('scrollSentinel');
    scrollObserver = new IntersectionObserver(
        entries => { if (entries[0].isIntersecting) loadMore(); },
        { rootMargin: '300px' }
    );
    if (sentinel) scrollObserver.observe(sentinel);
}

/* ════════════════════════════════════════════
   맨위로 버튼
   ─────────────────────────────────────────────
   - 페이지를 300px 이상 내리면 버튼이 나타남
   - 버튼 클릭 시 페이지 상단으로 부드럽게 이동
   - CSS .visible 클래스로 opacity/transform 전환
════════════════════════════════════════════ */

/** 스크롤 위치 기준값 (px): 이 값 이상 내려가면 버튼 표시 */
const SCROLL_TOP_THRESHOLD = 300;

/**
 * setupScrollTopBtn
 * DOMContentLoaded 이후 한 번 호출.
 * scroll 이벤트에서 버튼 표시/숨김을 제어하고
 * 클릭 시 window.scrollTo smooth 로 상단 이동.
 */
function setupScrollTopBtn() {
    const btn = document.getElementById('scrollTopBtn');
    if (!btn) return;

    /* 스크롤 이벤트: 임계값 초과 시 버튼 노출 */
    window.addEventListener('scroll', () => {
        if (window.scrollY > SCROLL_TOP_THRESHOLD) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    }, { passive: true }); /* passive: true → 스크롤 성능 최적화 */

    /* 클릭 이벤트: 부드러운 상단 이동 */
    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

/* ════════════════════════════════════════════
   임시 공유 링크 생성 & 모달
   ────────────────────────────────────────────
   네 가지 상태를 명시적으로 구분해서 모달 노출을 엄격히 제어.

   ① 부관리자 수신자  (토큰에 deputy=true)
      공유 버튼 → 풀 모달, 단 기간 최대 90일 + 원본 만료 초과 불가
      부관리자가 생성한 링크의 수신자는 → 기존 "일반 수신자" 동작
      (부관리자 체인이 끊김: 재-재공유는 복사만)

   ② 일반 수신자       (토큰 있음 + deputy=false)
      공유 버튼 → 받은 링크 그대로 복사

   ③ 관리자            (검색창 "관리자" 입력 + 토큰 없음)
      공유 버튼 → 풀 모달 (기간/즐겨찾기/PWA/부관리자 토글)

   ④ 비관리자 방문자   (토큰 없음 + 관리자 아님)
      공유 버튼 → 현재 페이지 URL만 복사, 모달 노출 안 됨
      → 삼성 인터넷 등 일반 방문자에게 모달 노출되던 문제 원천 차단

   ▶ 만료 문구: app_src.js 상단 SHARE_EXPIRED_MSG 수정
════════════════════════════════════════════ */
function setupShareBtn() {
    const openBtn   = document.getElementById('shareBtnOpen');
    const modal     = document.getElementById('shareModal');
    const closeBtn  = document.getElementById('shareCloseBtn');
    const genBtn    = document.getElementById('shareGenBtn');
    const copyBtn   = document.getElementById('shareCopyBtn');
    const linkInput = document.getElementById('shareLinkInput');
    const resultBox = document.getElementById('shareResultBox');
    const copyMsg   = document.getElementById('shareCopyMsg');
    if (!openBtn) return;

    /* ── 헬퍼: 안전한 클립보드 복사 (HTTPS / fallback 모두 지원) ── */
    const safeCopy = async (text) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        try {
            const tmp = document.createElement('textarea');
            tmp.value = text;
            tmp.style.cssText = 'position:fixed;top:-9999px;opacity:0';
            document.body.appendChild(tmp);
            tmp.select();
            document.execCommand('copy');
            tmp.remove();
            return true;
        } catch (_) { return false; }
    };

    /* ── 헬퍼: 버튼 피드백 (텍스트/색상 일시 변경) ── */
    const flashBtnFeedback = (label) => {
        const span = openBtn.querySelector('span');
        const orig = span ? span.textContent : '';
        if (span) span.textContent = label;
        openBtn.classList.add('flash-ok');
        setTimeout(() => {
            if (span) span.textContent = orig;
            openBtn.classList.remove('flash-ok');
        }, 1800);
    };

    /* ════ ① 부관리자 수신자 ════
       풀 모달을 쓰되, 기간 최대 90일(일 단위만), 부관리자 토글 숨김 */
    if (window._isShareRecipient && window._isDeputy) {
        bindDeputyModal({
            openBtn, modal, closeBtn, genBtn, copyBtn, linkInput, resultBox, copyMsg,
            safeCopy,
        });
        return;
    }

    /* ════ ② 일반 수신자 ════
       받은 링크 그대로 복사 */
    if (window._isShareRecipient) {
        openBtn.addEventListener('click', async () => {
            const url = window._shareOrigUrl || location.href;
            const ok = await safeCopy(url);
            flashBtnFeedback(ok ? '복사됨!' : '복사 실패');
        });
        return;
    }

    /* ════ ④ 비관리자 방문자 ════
       모달 노출 금지, 현재 페이지 URL 복사 */
    if (!isAdmin()) {
        openBtn.addEventListener('click', async () => {
            const u = new URL(location.href);
            u.search = ''; u.hash = '';
            u.pathname = u.pathname.replace(/\/index\.html$/, '/');
            const ok = await safeCopy(u.toString());
            flashBtnFeedback(ok ? '복사됨!' : '복사 실패');
        });
        return;
    }

    /* ════ ③ 관리자 모드 ════ */

    /* 관리자 모달: 부관리자 토글 표시, Deputy 전용 힌트 숨김 */
    document.getElementById('shareDeputyWrap')?.style.setProperty('display', 'flex');
    document.getElementById('shareDeputyHint')?.style.setProperty('display', 'none');

    openBtn.addEventListener('click', () => {
        modal.classList.add('open');
        resultBox.style.display = 'none';
        copyMsg.style.display   = 'none';
    });

    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('open');
    });

    /* 링크 생성 (관리자)
       ─────────────────────────────────────────
       부관리자 토글 ON  → 1~3번 유효성 검사 스킵, exp 100년(영구 사용)
       부관리자 토글 OFF → 1~3번 유효성 검사 실행, 설정 기간대로 exp 적용
       URL 단축 없음 → 직접 암호화 링크 사용 (안정성 최우선)
       ───────────────────────────────────────── */
    genBtn.addEventListener('click', () => {
        const _deputy   = document.getElementById('shareDeputyToggle')?.checked || false;
        const _inclFav  = document.getElementById('shareFavToggle')?.checked    || false;
        const _allowPwa = document.getElementById('sharePwaToggle')?.checked    || false;

        let exp;

        if (_deputy) {
            /* 부관리자 ON → 1~3번 유효성 검사 불필요
               부관리자 본인은 영구 사용 (100년) */
            exp = Date.now() + 365 * 100 * 24 * 60 * 60 * 1000;
        } else {
            /* 일반 공유 → 기간 유효성 검사 */
            const dur  = Math.max(1, parseInt(document.getElementById('shareDuration').value) || 1);
            const unit = parseInt(document.getElementById('shareUnit').value);
            exp = Date.now() + dur * unit;
        }

        const tokenPayload = {
            exp,
            includeFavs:      _deputy ? true : _inclFav,   /* 부관리자는 모든 기능 기본 활성 */
            allowPwa:          _deputy ? true : _allowPwa,
            deputy:            _deputy,
            destroyOnInstall:  _deputy,                     /* 부관리자 링크: PWA 설치 시 즉시 파기 */
        };
        const token = shareEncrypt(tokenPayload);

        const baseUrl = new URL(location.href);
        baseUrl.pathname = baseUrl.pathname.replace(/\/index\.html$/, '/');
        baseUrl.search = '?' + SHARE_PARAM + '=' + token;
        baseUrl.hash   = '';
        const finalUrl = baseUrl.toString();

        /* UI 표시 */
        resultBox.style.display = 'flex';
        copyMsg.style.display   = 'none';

        if (_deputy) {
            document.getElementById('shareExpLabel').textContent =
                '👤 부관리자 링크  ·  사용 기간 제한 없음  ·  📲 PWA/⭐ 즐겨찾기 기본 허용';
        } else {
            const d = new Date(exp);
            const expStr = '만료: ' + d.toLocaleDateString('ko-KR') + ' ' +
                d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
            const flags = [
                _allowPwa ? '📲 PWA 설치 허용'  : null,
                _inclFav  ? '⭐ 즐겨찾기 허용'   : null,
            ].filter(Boolean).join('  ·  ');
            document.getElementById('shareExpLabel').textContent =
                flags ? expStr + '  ·  ' + flags : expStr;
        }

        linkInput.value  = SHARE_COPY_TEMPLATE(finalUrl);
        copyBtn.disabled = false;
        const urlOnlyBtn = document.getElementById('shareUrlOnlyBtn');
        if (urlOnlyBtn) urlOnlyBtn.dataset.url = finalUrl;
        window._shareOrigUrl = finalUrl;
    });

    /* 메시지 전체 복사 */
    copyBtn.addEventListener('click', async () => {
        const ok = await safeCopy(linkInput.value);
        copyMsg.textContent = ok
            ? '✅ 클립보드에 복사됐습니다. 카카오톡 · 문자에 붙여넣기 하세요!'
            : '❌ 복사 실패. 텍스트를 길게 눌러 직접 복사해 주세요.';
        copyMsg.style.display = 'block';
        setTimeout(() => { copyMsg.style.display = 'none'; }, 2500);
    });

    /* URL만 복사 */
    document.getElementById('shareUrlOnlyBtn')?.addEventListener('click', async () => {
        const urlBtn = document.getElementById('shareUrlOnlyBtn');
        const url = urlBtn?.dataset.url || window._shareOrigUrl || '';
        if (!url) return;
        const ok = await safeCopy(url);
        const orig = urlBtn.textContent;
        urlBtn.textContent = ok ? '✅ 복사됨!' : '❌ 복사 실패';
        setTimeout(() => { urlBtn.textContent = orig; }, 2000);
    });
}

/* ════════════════════════════════════════════
   부관리자(Deputy) 모달 바인딩
   ────────────────────────────────────────────
   관리자가 발급한 deputy=true 토큰을 가진 수신자 전용.
   풀 모달을 쓰되 다음 제약 적용:

     ① 부관리자 토글: display:none (부관리자는 다른 부관리자를 만들 수 없음)
     ② Deputy 힌트 박스: display:none (불필요한 안내 숨김)
     ③ 단위: '일(기본)' 만 사용 (분/시간 제거)
     ④ 기간: 최대 90일 — 초과 시 전문적 안내 문구 + 생성 차단
     ⑤ 즐겨찾기·PWA 토글: 자유 설정 가능 (유효성 검사 없음)
     ⑥ URL 단축 없음: 직접 암호화 링크 사용

   발행되는 새 토큰: deputy=false → 수신자는 '일반 수신자' 동작 (복사만)
════════════════════════════════════════════ */
function bindDeputyModal(ctx) {
    const { openBtn, modal, closeBtn, genBtn, copyBtn, linkInput, resultBox, copyMsg,
            safeCopy } = ctx;

    /* ── UI 초기화: 부관리자 토글/힌트 숨김 ── */
    const deputyWrap = document.getElementById('shareDeputyWrap');
    const deputyHint = document.getElementById('shareDeputyHint');
    if (deputyWrap) deputyWrap.style.display = 'none';
    if (deputyHint) deputyHint.style.display = 'none';

    /* ── 단위 선택: 일(day)만 남기고 분/시간 제거 ── */
    const unitSel  = document.getElementById('shareUnit');
    const durInput = document.getElementById('shareDuration');
    if (unitSel) {
        /* 기존 옵션 중 '일' 이외 제거 */
        const opts = unitSel.querySelectorAll('option');
        opts.forEach(o => {
            if (o.value !== '86400000') o.remove();
        });
        unitSel.value = '86400000';
    }
    /* 기간 입력 max 90일 */
    if (durInput) {
        durInput.max = '90';
        if (parseInt(durInput.value) > 90) durInput.value = '90';
    }

    /* 모달 제목 변경 (부관리자용) */
    const titleEl = modal?.querySelector('.share-modal-title');
    if (titleEl) {
        titleEl.innerHTML = titleEl.innerHTML.replace('임시 공유 링크 생성', '공유 링크 생성');
    }

    /* 모달 열기 */
    openBtn.addEventListener('click', () => {
        modal.classList.add('open');
        resultBox.style.display = 'none';
        copyMsg.style.display   = 'none';
    });

    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('open');
    });

    /* 링크 생성 (부관리자 — 90일 상한 제한) */
    genBtn.addEventListener('click', () => {
        const dur = Math.max(1, parseInt(durInput?.value) || 1);

        /* ── 90일 초과 차단 (전문 안내 문구) ── */
        if (dur > 90) {
            durInput.value = '90';
            showToast('⚠️ 데이터 보관 정책에 따라 공유 기간은 최대 90일까지 설정할 수 있습니다.');
            return; /* 링크 생성하지 않음 */
        }

        const exp = Date.now() + dur * 86400000; /* 일 단위 고정 */

        const _inclFav  = document.getElementById('shareFavToggle')?.checked || false;
        const _allowPwa = document.getElementById('sharePwaToggle')?.checked || false;

        /* 부관리자가 발급: deputy=false, destroyOnInstall=false
           → 수신자는 '일반 수신자' 동작 (복사만, 체인 차단) */
        const token = shareEncrypt({
            exp,
            includeFavs:      _inclFav,
            allowPwa:         _allowPwa,
            deputy:           false,
            destroyOnInstall: false,
        });

        const baseUrl = new URL(location.href);
        baseUrl.pathname = baseUrl.pathname.replace(/\/index\.html$/, '/');
        baseUrl.search = '?' + SHARE_PARAM + '=' + token;
        baseUrl.hash   = '';
        const finalUrl = baseUrl.toString();

        resultBox.style.display = 'flex';
        copyMsg.style.display   = 'none';

        const d = new Date(exp);
        const expStr = '만료: ' + d.toLocaleDateString('ko-KR') + ' ' +
            d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
        const flags = [
            _allowPwa ? '📲 PWA 설치 허용' : null,
            _inclFav  ? '⭐ 즐겨찾기 허용'  : null,
        ].filter(Boolean).join('  ·  ');
        document.getElementById('shareExpLabel').textContent =
            (flags ? expStr + '  ·  ' + flags : expStr) + '  ·  👤 부관리자 발행';

        linkInput.value  = SHARE_COPY_TEMPLATE(finalUrl);
        copyBtn.disabled = false;
        const urlOnlyBtn = document.getElementById('shareUrlOnlyBtn');
        if (urlOnlyBtn) urlOnlyBtn.dataset.url = finalUrl;
    });

    /* 메시지 전체 복사 */
    copyBtn.addEventListener('click', async () => {
        const ok = await safeCopy(linkInput.value);
        copyMsg.textContent = ok
            ? '✅ 클립보드에 복사됐습니다. 카카오톡 · 문자에 붙여넣기 하세요!'
            : '❌ 복사 실패. 텍스트를 길게 눌러 직접 복사해 주세요.';
        copyMsg.style.display = 'block';
        setTimeout(() => { copyMsg.style.display = 'none'; }, 2500);
    });

    /* URL만 복사 */
    document.getElementById('shareUrlOnlyBtn')?.addEventListener('click', async () => {
        const urlBtn = document.getElementById('shareUrlOnlyBtn');
        const url = urlBtn?.dataset.url || '';
        if (!url) return;
        const ok = await safeCopy(url);
        const orig = urlBtn.textContent;
        urlBtn.textContent = ok ? '✅ 복사됨!' : '❌ 복사 실패';
        setTimeout(() => { urlBtn.textContent = orig; }, 2000);
    });
}

/* ════════════════════════════════════════════
   공유 링크 프리뷰 페이지
   ────────────────────────────────────────────
   ▶ PREVIEW_SEC : 자동 이동 대기 시간(초)
   ▶ 문구 수정   : spp-title / spp-desc 내 텍스트
════════════════════════════════════════════ */
const PREVIEW_SEC = 10;

function showSharePreview() {
    const splash = document.getElementById('splashOverlay');
    if (!splash) { startApp(); return; }

    splash.classList.remove('hide');
    splash.style.opacity    = '1';
    splash.style.visibility = 'visible';

    splash.innerHTML = `
        <div class="share-preview-page">
            <p class="spp-badge">임시 공유 링크</p>
            <div class="spp-icon">📊</div>
            <h2 class="spp-title">아파트  시세표</h2>
            <p class="spp-desc">
                Preview를 클릭하거나<br>
                <span id="shareCountdown">${PREVIEW_SEC}</span>초 뒤 페이지가<br>
                자동으로 이동됩니다.
            </p>
            <button id="sharePreviewBtn" class="spp-btn">Preview →</button>
            <p class="spp-notice">⏱ 유효 기간이 있는 임시 링크입니다</p>
        </div>`;

    /* ── 이중 실행 방지 guard ── */
    let started = false;
    const go = () => {
        if (started) return;
        started = true;
        clearInterval(timer);
        startApp();
    };

    /* 카운트다운 */
    let count = PREVIEW_SEC;
    const timer = setInterval(() => {
        count--;
        const el = document.getElementById('shareCountdown');
        if (el) el.textContent = count;
        if (count <= 0) go();
    }, 1000);

    /* 버튼 once 옵션으로 중복 등록 방지 */
    document.getElementById('sharePreviewBtn')
        .addEventListener('click', go, { once: true });
}

/* 프리뷰 완료 후 실제 앱 시작 */
function startApp() {
    hideSplash();
    loadData();
}

/* ════════════════════════════════════════════
   즐겨찾기 유틸
════════════════════════════════════════════ */
function favKey(g) { return `${g.지역}|${g.아파트}`; }

function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAV_KEY);
        favSet = new Set(raw ? JSON.parse(raw) : []);
    } catch { favSet = new Set(); }
}

function saveFavorites() {
    /* 수신자도 자신의 기기 localStorage에 저장 (탭이 살아있는 한 유지) */
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favSet])); } catch {}
}

/* ════════════════════════════════════════════
   최근 검색어 유틸
════════════════════════════════════════════ */
function loadRecentSearches() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        recentSearches = raw ? JSON.parse(raw) : [];
    } catch { recentSearches = []; }
    renderRecentSearchUI();
}

function saveRecentSearch(term) {
    if (!term || term.length < 1) return;
    recentSearches = recentSearches.filter(t => t !== term);
    recentSearches.unshift(term);
    if (recentSearches.length > RECENT_MAX) recentSearches = recentSearches.slice(0, RECENT_MAX);
    if (window._isShareRecipient) {
        /* 수신자: sessionStorage만 (탭 격리 → 다른 사용자에게 절대 유출 안 됨) */
        try { sessionStorage.setItem('_shr_recent', JSON.stringify(recentSearches)); } catch {}
    } else {
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches)); } catch {}
    }
    renderRecentSearchUI();
}

function removeRecentSearch(term) {
    recentSearches = recentSearches.filter(t => t !== term);
    if (window._isShareRecipient) {
        try { sessionStorage.setItem('_shr_recent', JSON.stringify(recentSearches)); } catch {}
    } else {
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches)); } catch {}
    }
    renderRecentSearchUI();
}

function renderRecentSearchUI() {
    const container = document.getElementById('recentSearchWrap');
    if (!container) return;

    const searchInput = document.getElementById('searchInput');
    const currentVal  = searchInput ? searchInput.value.trim() : '';

    /* 입력 중이거나 최근 검색어 없으면 숨김 */
    if (currentVal || recentSearches.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = `
        <span class="recent-label">최근 검색</span>
        <div class="recent-chips">
            ${recentSearches.map(t => `
                <span class="recent-chip">
                    <button class="recent-chip-text" data-term="${t}">${t}</button>
                    <button class="recent-chip-del" data-del="${t}" aria-label="삭제">✕</button>
                </span>`).join('')}
        </div>`;

    /* 클릭 이벤트 */
    container.querySelectorAll('.recent-chip-text').forEach(btn => {
        btn.addEventListener('click', () => {
            const inp = document.getElementById('searchInput');
            if (inp) { inp.value = btn.dataset.term; }
            applyFilters();
            renderRecentSearchUI();
        });
    });
    container.querySelectorAll('.recent-chip-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeRecentSearch(btn.dataset.del);
        });
    });
}

/* ════════════════════════════════════════════
   투데이 방문자 카운터
   ────────────────────────────────────────────
   분류 기준:
     직접 접속 (d-YYYYMMDD) : 관리자 + 부관리자만 (~7명)
     공유 접속 (s-YYYYMMDD) : 일반 수신자 + 비관리자 일반 방문자

   중복 방지:
     관리자/부관리자 → localStorage (같은 기기에서 당일 1회)
     공유/일반       → sessionStorage (탭 격리)

   재분류:
     일반 접속 후 검색창에 "관리자" 입력 → 공유 1 감소, 직접 1 증가
     이후 그 기기에서는 항상 직접 접속으로 카운팅
════════════════════════════════════════════ */

function getTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return 'd-' + y + m + day; // 예: d-20260408
}

/**
 * 페이지 로드 시 1회 호출
 * @param {boolean} isDirect - true: 관리자/부관리자(직접), false: 그 외(공유)
 */
async function trackTodayVisit(isDirect) {
    if (!FIREBASE_URL) return;

    const dateKey = getTodayKey();
    const apiKey  = isDirect ? dateKey : 's-' + dateKey.slice(2);

    /* 중복 방지 키 */
    const dupKey  = '_today_hit_' + apiKey;
    /* 관리자/부관리자 → localStorage (기기 단위, 같은 기기에서 관리자는 당일 1회)
       공유/일반      → sessionStorage (탭 단위, 여러 공유 수신자가 같은 기기라도 탭별 분리) */
    const storage = isDirect ? localStorage : sessionStorage;
    if (storage.getItem(dupKey)) return;

    try {
        const path = `${FIREBASE_URL}/${COUNT_NS}/${apiKey}.json`;
        const cur  = await fetch(path).then(r => r.json()).catch(() => 0);
        const next = (typeof cur === 'number' ? cur : 0) + 1;
        const res  = await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        if (res.ok) {
            storage.setItem(dupKey, '1');
            if (isDirect) cleanOldHitKeys();
        }
    } catch (_) {}
}

/**
 * 관리자 모드 활성화 시 재분류
 * ─────────────────────────────────────────
 * 시나리오: 일반 링크로 접속 (→ 공유로 카운팅) → 검색창에 "관리자" 입력
 * 결과: 공유 카운트 -1, 직접 카운트 +1, localStorage에 직접 접속 플래그 설정
 *       → 이후 같은 기기에서는 항상 직접 접속으로 분류됨
 */
async function reclassifyToDirectVisit() {
    if (!FIREBASE_URL) return;

    const dateKey   = getTodayKey();
    const directKey = dateKey;                   // d-YYYYMMDD
    const shareKey  = 's-' + dateKey.slice(2);   // s-YYYYMMDD
    const directDup = '_today_hit_' + directKey;
    const shareDup  = '_today_hit_' + shareKey;

    /* 이미 직접 접속으로 카운팅 됐으면 중복 방지 */
    if (localStorage.getItem(directDup)) return;

    try {
        /* ① 공유 카운트에서 자기 기여분 감소 (이번 탭에서 카운팅했을 때만) */
        if (sessionStorage.getItem(shareDup)) {
            const sharePath = `${FIREBASE_URL}/${COUNT_NS}/${shareKey}.json`;
            const shareCur  = await fetch(sharePath).then(r => r.json()).catch(() => 0);
            if (typeof shareCur === 'number' && shareCur > 0) {
                await fetch(sharePath, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(shareCur - 1),
                });
            }
            sessionStorage.removeItem(shareDup);
        }

        /* ② 직접 카운트 +1 */
        const directPath = `${FIREBASE_URL}/${COUNT_NS}/${directKey}.json`;
        const directCur  = await fetch(directPath).then(r => r.json()).catch(() => 0);
        const directNext = (typeof directCur === 'number' ? directCur : 0) + 1;
        const res = await fetch(directPath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(directNext),
        });
        if (res.ok) {
            localStorage.setItem(directDup, '1');
        }
    } catch (_) {}
}

/* localStorage에서 오래된 _today_hit_ 키 정리 */
function cleanOldHitKeys() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutStr = cutoff.getFullYear()
        + String(cutoff.getMonth()+1).padStart(2,'0')
        + String(cutoff.getDate()).padStart(2,'0');
    Object.keys(localStorage).forEach(k => {
        if (k.startsWith('_today_hit_d-')) {
            const dateStr = k.replace('_today_hit_d-', '');
            if (dateStr < cutStr) localStorage.removeItem(k);
        }
    });
}

/* 투데이 팝업 — 관리자(직접) / 일반(공유) 분리 표시 */
async function showTodayVisitorPopup() {
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
                    <span class="tp-label">👑 관리자 접속</span>
                    <span class="tp-val" id="tpDirect"><span class="tp-spinner-sm"></span></span>
                </div>
                <div class="tp-divider"></div>
                <div class="tp-row">
                    <span class="tp-label">🔗 공유 접속</span>
                    <span class="tp-val" id="tpShare"><span class="tp-spinner-sm"></span></span>
                </div>
                <div class="tp-divider"></div>
                <div class="tp-row tp-row-total">
                    <span class="tp-label">합계</span>
                    <span class="tp-val tp-total" id="tpTotal">-</span>
                </div>
            </div>
            <p class="tp-date">${new Date().toLocaleDateString('ko-KR')} 기준</p>
            <p class="tp-hint">관리자 = 관리자 + 부관리자 · 공유 = 그 외 전체<br>같은 기기/탭 당일 중복 집계 제외</p>
        </div>`;
    document.body.appendChild(popup);

    /* 외부 클릭 닫기 */
    setTimeout(() => {
        document.addEventListener('click', function _close(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', _close);
            }
        });
    }, 200);

    /* 직접/공유 API 병렬 조회 */
    const dateKey   = getTodayKey();
    const directKey = dateKey;                  // d-YYYYMMDD
    const shareKey  = 's-' + dateKey.slice(2); // s-YYYYMMDD

    if (!FIREBASE_URL) {
        /* Firebase 미설정 시 안내 표시 */
        const elD = document.getElementById('tpDirect');
        const elS = document.getElementById('tpShare');
        const elT = document.getElementById('tpTotal');
        if (elD) elD.innerHTML = '<span class="tp-err">설정 필요</span>';
        if (elS) elS.innerHTML = '<span class="tp-err">설정 필요</span>';
        if (elT) elT.innerHTML = '<span class="tp-err" style="font-size:0.7rem">FIREBASE_URL을 설정하세요</span>';
        return;
    }

    const fetchCount = async (key) => {
        try {
            const res = await fetch(`${FIREBASE_URL}/${COUNT_NS}/${key}.json`);
            const val = await res.json();
            return typeof val === 'number' ? val : 0;
        } catch (_) { return null; }
    };

    const fmt = (n) => n === null
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

/* ════════════════════════════════════════════
   푸시 알림 권한 요청
   ────────────────────────────────────────────
   - 최초 1회만 요청 (denied 시 재요청 안 함)
   - PWA 설치자(오너)만 호출됨
════════════════════════════════════════════ */
async function requestNotificationPermission() {
    if (!('Notification' in window)) return;          // 미지원 브라우저
    if (Notification.permission === 'granted') return; // 이미 허용
    if (Notification.permission === 'denied')  return; // 이미 거부

    /* 허용 요청 */
    try {
        const result = await Notification.requestPermission();
        console.log('[알림]', result);
    } catch (_) {}
}

/* ════════════════════════════════════════════
   CSV 업데이트 인앱 배너
   ────────────────────────────────────────────
   SW가 CSV 변경을 감지하면 앱 상단에 배너 표시.
   클릭 시 페이지 새로고침 (새 CSV 로드).
════════════════════════════════════════════ */
function showCsvUpdateBanner() {
    /* 이미 표시 중이면 무시 */
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

    /* 애니메이션 후 표시 */
    requestAnimationFrame(() => banner.classList.add('visible'));

    document.getElementById('cubRefreshBtn').addEventListener('click', () => {
        banner.remove();
        window.location.reload(true);
    });
    document.getElementById('cubCloseBtn').addEventListener('click', () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 300);
    });

    /* 15초 후 자동 닫기 */
    setTimeout(() => {
        if (document.getElementById('csvUpdateBanner')) {
            banner.classList.remove('visible');
            setTimeout(() => banner.remove(), 300);
        }
    }, 15000);
}

/* ════════════════════════════════════════════
   Web Push 알림 시스템
   ────────────────────────────────────────────
   PWA 설치자 전용. 검색창에 아래 키워드 입력 가능:
     '알림구독' → 알림 권한 요청 + 구독
     '알림전송' → 전체 구독자에게 알림 발송 (오너용)
════════════════════════════════════════════ */

/* PWA 설치 여부 확인 */
function isPWAInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

/* ════════════════════════════════════════════
   로컬 알림 초기화 (PUSH_WORKER_URL 불필요)
   ────────────────────────────────────────────
   SW의 sendPushNotification()은 self.registration.showNotification()을
   사용하므로 외부 서버 없이 Notification.permission === 'granted' 만
   확보하면 CSV 변경 시 자동으로 알림이 표시됩니다.

   이 함수는 PWA 설치자(오너 + 수신자 모두)에서 호출됩니다.
   ① 이미 허용됨 → 아무것도 안 함 (SW가 알아서 처리)
   ② 이미 거부됨 → 아무것도 안 함 (재요청 불가)
   ③ 미결정(default) → 알림 배너 표시 (7일 간격)
════════════════════════════════════════════ */
function setupLocalNotification() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'granted') return;  /* 이미 허용 */
    if (Notification.permission === 'denied')  return;  /* 이미 거부 */

    /* 7일 내 거부한 적 있으면 재표시 안 함 */
    try {
        const denied = localStorage.getItem('_notif_denied');
        if (denied && Date.now() - parseInt(denied) < 7 * 86400000) return;
    } catch (_) {}

    /* 약간의 딜레이 후 배너 표시 (페이지 안정화 대기) */
    setTimeout(showNotifBanner, 2000);
}

/* 알림 허용 배너 (로컬 알림 전용) */
function showNotifBanner() {
    if (document.getElementById('notifBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'notifBanner';
    banner.className = 'push-banner';
    banner.innerHTML = `
        <div class="pb-content">
            <span class="pb-icon">🔔</span>
            <div class="pb-text">
                <strong>시세 업데이트 알림</strong>
                <span>새 CSV 데이터 등록 시 앱 알림을 받아보세요</span>
            </div>
        </div>
        <div class="pb-actions">
            <button class="pb-allow" id="notifAllow">허용</button>
            <button class="pb-deny"  id="notifDeny">닫기</button>
        </div>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add('visible'), 100);

    document.getElementById('notifAllow').addEventListener('click', async () => {
        banner.remove();
        await requestLocalNotifPermission();
    });
    document.getElementById('notifDeny').addEventListener('click', () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 300);
        try { localStorage.setItem('_notif_denied', String(Date.now())); } catch (_) {}
    });
}

/* 로컬 알림 권한 요청 (서버 불필요 — SW가 showNotification으로 처리) */
async function requestLocalNotifPermission() {
    try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
            showToast('🔔 알림이 설정되었습니다! CSV 업데이트 시 앱 알림이 전송됩니다.');
        } else {
            showToast('알림 권한이 거부되었습니다. 브라우저 설정에서 변경할 수 있습니다.');
        }
    } catch (_) {}
}

/* ════════════════════════════════════════════
   기존 Web Push 시스템 (PUSH_WORKER_URL 필요)
   ────────────────────────────────────────────
   PUSH_WORKER_URL이 설정된 경우에만 작동.
   미설정 시 위의 로컬 알림(setupLocalNotification)으로 대체됨.
════════════════════════════════════════════ */

/* 초기화: 이미 구독 완료면 스킵, 미구독이면 배너 표시 */
async function setupPushNotification() {
    if (!PUSH_WORKER_URL) return; // Worker URL 미설정 시 스킵
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    /* 이미 권한 허용 + 구독됨 → 구독 갱신 (만료 방지) */
    if (Notification.permission === 'granted') {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await refreshSubscription(sub); // 서버에 재등록
                return;
            }
        } catch (_) {}
    }

    /* 권한 미결정이면 배너 표시 */
    if (Notification.permission === 'default') {
        showPushBanner();
    }
}

/* 알림 허용 배너 (Web Push 전용) */
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
            <button class="pb-deny"  id="pbDeny">닫기</button>
        </div>`;
    document.body.appendChild(banner);

    setTimeout(() => banner.classList.add('visible'), 100);

    document.getElementById('pbAllow').addEventListener('click', async () => {
        banner.remove();
        await requestPushPermission();
    });
    document.getElementById('pbDeny').addEventListener('click', () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 300);
        localStorage.setItem('_push_denied', Date.now()); // 7일간 재표시 안 함
    });
}

/* 알림 권한 요청 + 구독 */
async function requestPushPermission() {
    if (!PUSH_WORKER_URL) {
        alert('Push Worker URL이 설정되지 않았습니다.\napp_src.js의 PUSH_WORKER_URL을 설정해 주세요.');
        return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
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

/* Web Push 구독 실행 */
async function subscribeWebPush() {
    try {
        /* Worker에서 VAPID 공개키 조회 */
        const keyRes  = await fetch(`${PUSH_WORKER_URL}/vapid-key`);
        const { publicKey } = await keyRes.json();

        /* applicationServerKey 변환 (base64url → Uint8Array) */
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

/* 구독 정보를 Worker에 등록/갱신 */
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

/* 관리자: 알림 발송 패널 */
async function showPushAdminPanel() {
    if (!PUSH_ADMIN_KEY || !PUSH_WORKER_URL) {
        alert('PUSH_WORKER_URL 또는 PUSH_ADMIN_KEY가 설정되지 않았습니다.');
        return;
    }

    /* 구독자 수 조회 */
    let subCount = '...';
    try {
        const r = await fetch(`${PUSH_WORKER_URL}/count`);
        const d = await r.json();
        subCount = d.count ?? '?';
    } catch (_) {}

    /* 기존 패널 제거 */
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

    /* 닫기 */
    const close = () => panel.remove();
    document.getElementById('papClose').addEventListener('click', close);
    setTimeout(() => {
        document.addEventListener('click', function _c(e) {
            if (!panel.contains(e.target)) { close(); document.removeEventListener('click', _c); }
        });
    }, 200);

    /* 발송 */
    document.getElementById('papSend').addEventListener('click', async () => {
        const title   = document.getElementById('papTitle').value.trim()
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

/* 토스트 메시지 */
function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'apt-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('visible'), 50);
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 350); }, 3000);
}

/* base64url → Uint8Array */
function base64urlToUint8(b64u) {
    const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '='));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/* ════════════════════════════════════════════
   관리자 모드 인라인 바 (오너 + 관리자 ON 시 표시)
   ────────────────────────────────────────────
   - sticky-header 최상단에 전체 너비 바 형태로 삽입
   - 오른쪽 "해제" 버튼으로 즉시 해제 (새로고침 불필요)
   - 바 삽입/제거 시 syncScrollPadding으로 스티키 헤더 높이 재계산
════════════════════════════════════════════ */
function showAdminBadge() {
    if (document.getElementById('adminBadge')) return;

    const stickyHeader = document.querySelector('.sticky-header');
    if (!stickyHeader) return;

    const bar = document.createElement('div');
    bar.id = 'adminBadge';
    bar.className = 'admin-bar';
    bar.innerHTML = `
        <span class="ab-crown">👑</span>
        <span class="ab-text">관리자 모드</span>
        <button type="button" class="ab-off" aria-label="관리자 모드 해제">해제</button>
    `;
    stickyHeader.prepend(bar);

    /* 해제 버튼: 즉시 해제 + 공유 버튼 재바인딩 (새로고침 불필요) */
    bar.querySelector('.ab-off').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('관리자 모드를 해제하시겠습니까?')) return;
        setAdmin(false);
        hideAdminBadge();
        rebindShareBtn();
        showToast('관리자 모드를 해제했습니다');
    });

    /* 페이드인 + 스티키 헤더 높이 재계산 */
    requestAnimationFrame(() => {
        bar.classList.add('visible');
        syncScrollPadding();
    });
}

function hideAdminBadge() {
    const b = document.getElementById('adminBadge');
    if (!b) return;
    b.classList.remove('visible');
    /* CSS transition 종료 후 DOM 제거 + 스크롤 패딩 재조정 */
    setTimeout(() => {
        b.remove();
        syncScrollPadding();
    }, 260);
}

/* ════════════════════════════════════════════
   공유 버튼 핸들러 재바인딩
   ────────────────────────────────────────────
   setupShareBtn()은 DOMContentLoaded 때 단 한 번 호출되므로,
   이후 관리자 모드를 켜거나 끌 때 기존 이벤트 리스너가 그대로 남음.
   → 버튼을 cloneNode로 교체해 모든 리스너를 날린 뒤 재바인딩.
════════════════════════════════════════════ */
function rebindShareBtn() {
    const btn = document.getElementById('shareBtnOpen');
    if (!btn || !btn.parentNode) return;
    const clone = btn.cloneNode(true);
    /* 현재 커스텀 속성/클래스 초기화 */
    clone.classList.remove('flash-ok');
    clone.style.cssText = '';
    btn.parentNode.replaceChild(clone, btn);
    /* 새 버튼에 현재 상태(isAdmin/수신자)에 맞는 핸들러 바인딩 */
    setupShareBtn();
}

/* ════════════════════════════════════════════
   PWA 설치 안내 카드 (공유 수신자 + 토큰 allowPwa=true)
   ────────────────────────────────────────────
   - 최초 1회만 표시 (sessionStorage 가드는 호출 측에서 처리)
   - iOS: beforeinstallprompt 미지원 → "공유 → 홈 화면에 추가" 텍스트 안내
   - Android Chrome: deferredPrompt.prompt() 호출
   - 이미 설치된 경우(standalone) 표시 안 함
════════════════════════════════════════════ */
function showPwaInstallPromptForRecipient() {
    /* 이미 설치돼 standalone으로 열린 상태면 안내 불필요 */
    if (window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true) return;

    if (document.getElementById('pwaInstallCard')) return;

    /* 플랫폼 감지 */
    const ua = navigator.userAgent;
    const isIOS    = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const canPrompt = !!window._deferredInstallPrompt;
    const canNotif  = 'Notification' in window && Notification.permission !== 'denied';

    const card = document.createElement('div');
    card.id = 'pwaInstallCard';
    card.className = 'pwa-install-card';

    /* 알림 체크박스 (Notification API 지원 + 아직 거부 안 한 경우만) */
    const notifCheckHTML = canNotif ? `
        <label class="pic-notif-check">
            <input type="checkbox" id="picNotifCheck" checked>
            <span class="pic-notif-text">🔔 시세 업데이트 알림 받기</span>
        </label>` : '';

    let actionHTML = '';
    if (canPrompt) {
        actionHTML = `
            ${notifCheckHTML}
            <div class="pic-btn-row">
                <button class="pic-btn pic-btn-install" id="picInstall">📲 홈 화면에 설치</button>
                <button class="pic-btn pic-btn-later"   id="picLater">나중에</button>
            </div>`;
    } else if (isIOS && isSafari) {
        actionHTML = `
            <p class="pic-ios-guide">
                Safari 하단 <b>공유 버튼 <span class="pic-ios-icon">⬆︎</span></b> →
                <b>"홈 화면에 추가"</b> 를 눌러주세요
            </p>
            ${notifCheckHTML}
            <button class="pic-btn pic-btn-later" id="picLater">닫기</button>`;
    } else {
        actionHTML = `
            <p class="pic-ios-guide">
                브라우저 메뉴 → <b>"홈 화면에 추가"</b> 또는 <b>"앱 설치"</b> 를 선택해주세요
            </p>
            ${notifCheckHTML}
            <button class="pic-btn pic-btn-later" id="picLater">닫기</button>`;
    }

    card.innerHTML = `
        <div class="pic-header">
            <span class="pic-icon">📊</span>
            <div class="pic-titles">
                <strong class="pic-title">앱처럼 빠르게 사용하세요</strong>
                <span class="pic-desc">홈 화면에 추가하면 앱처럼 한 번에 열립니다</span>
            </div>
            <button class="pic-close" id="picClose" aria-label="닫기">✕</button>
        </div>
        <div class="pic-actions">${actionHTML}</div>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('visible'));

    const close = () => {
        card.classList.remove('visible');
        setTimeout(() => card.remove(), 250);
    };

    /* 설치 후 알림 권한 요청 (체크 시에만) */
    const afterInstall = async () => {
        const wantNotif = document.getElementById('picNotifCheck')?.checked;
        if (wantNotif && canNotif && Notification.permission === 'default') {
            /* 약간의 딜레이: 설치 애니메이션이 끝난 뒤 자연스럽게 요청 */
            setTimeout(async () => {
                try {
                    const perm = await Notification.requestPermission();
                    if (perm === 'granted') {
                        showToast('🔔 알림이 설정되었습니다! CSV 업데이트 시 알림이 전송됩니다.');
                    }
                } catch (_) {}
            }, 800);
        }
    };

    document.getElementById('picClose')?.addEventListener('click', close);
    document.getElementById('picLater')?.addEventListener('click', close);
    document.getElementById('picInstall')?.addEventListener('click', async () => {
        const dp = window._deferredInstallPrompt;
        if (!dp) { close(); return; }
        try {
            dp.prompt();
            const { outcome } = await dp.userChoice;
            if (outcome === 'accepted') {
                showToast('✅ 설치되었습니다. 홈 화면에서 실행해 주세요!');
                await afterInstall();
            }
        } catch (_) {}
        window._deferredInstallPrompt = null;
        close();
    });

    /* iOS/기타: "닫기"를 누르되 체크박스가 체크되어 있으면 알림 권한만 요청 */
    document.getElementById('picLater')?.addEventListener('click', async () => {
        const wantNotif = document.getElementById('picNotifCheck')?.checked;
        if (wantNotif && canNotif && Notification.permission === 'default') {
            setTimeout(async () => {
                try { await Notification.requestPermission(); } catch (_) {}
            }, 500);
        }
    });

    /* 30초 후 자동 닫기 */
    setTimeout(() => {
        if (document.getElementById('pwaInstallCard')) close();
    }, 30000);
}

/* ════════════════════════════════════════════
   공유 수신자 CSV 업데이트 폴링
   ────────────────────────────────────────────
   - SW가 등록되지 않은 수신자도 CSV 갱신을 인지할 수 있게 함
   - 5분마다 HEAD 요청으로 Last-Modified / ETag 비교
   - 변경 감지 시 showCsvUpdateBanner() 호출 → 사용자가 새로고침 여부 결정
   - 페이지가 background / hidden 일 때는 폴링 일시 중단 (배터리 절약)
   - 같은 만료 토큰을 가진 모든 수신자가 동일하게 갱신 인지
════════════════════════════════════════════ */
function setupCsvPollingForRecipient() {
    const POLL_INTERVAL = 5 * 60 * 1000; /* 5분 */
    let lastSig = null;
    let timer   = null;
    let aborted = false;

    /* CSV의 변경 감지 시그니처 — Last-Modified 우선, 없으면 ETag, 없으면 size */
    const fetchSig = async () => {
        try {
            /* HEAD가 막힌 호스팅이면 GET 폴백 (헤더만 읽고 body는 무시) */
            let res;
            try {
                res = await fetch('excel/map.csv', {
                    method: 'HEAD',
                    cache:  'no-store',
                    headers:{ 'Pragma':'no-cache','Cache-Control':'no-cache, no-store' },
                });
                if (!res.ok) throw new Error('HEAD failed');
            } catch (_) {
                res = await fetch('excel/map.csv', {
                    method: 'GET',
                    cache:  'no-store',
                    headers:{ 'Pragma':'no-cache','Cache-Control':'no-cache, no-store','Range':'bytes=0-0' },
                });
            }
            const lm = res.headers.get('last-modified') || '';
            const et = res.headers.get('etag')          || '';
            const cl = res.headers.get('content-length')|| '';
            return lm || et || cl || null;
        } catch (_) { return null; }
    };

    const tick = async () => {
        if (aborted) return;
        if (document.hidden) return; /* 백그라운드 시 SKIP — 배터리 절약 */
        const sig = await fetchSig();
        if (!sig) return;
        if (lastSig === null) {
            lastSig = sig; /* 최초 측정값 기록 */
            return;
        }
        if (sig !== lastSig) {
            lastSig = sig;
            /* 사용자가 직접 새로고침할 수 있는 배너 표시 (공유 수신자도 동일 UI) */
            showCsvUpdateBanner();
        }
    };

    /* 첫 호출은 1초 뒤 (페이지 안정화 대기) — 첫 측정은 시그니처 기준점 설정 */
    setTimeout(tick, 1000);
    timer = setInterval(tick, POLL_INTERVAL);

    /* 가시성 복귀 시 즉시 한 번 체크 → 사용자가 탭으로 돌아올 때 빠른 인지 */
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
    });

    /* 페이지 unload 시 타이머 정리 */
    window.addEventListener('beforeunload', () => {
        aborted = true;
        if (timer) clearInterval(timer);
    });
}
