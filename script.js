// === Origin gate — allow SCORM/LMS, block random mirrors ===
const GH_USERS = ["xavethewhales-edu"];   // your GH Pages host: xavethewhales-edu.github.io
const CUSTOM_DOMAINS = [];                // add custom domains here if you get one

(function originGate(){
  const h = (location.host || "").toLowerCase();
  const okLocal  = /^localhost(:\d+)?$/.test(h) || /^127\.0\.0\.1(:\d+)?$/.test(h);
  const okGh     = GH_USERS.some(u => h === (u.toLowerCase() + ".github.io"));
  const okCustom = CUSTOM_DOMAINS.includes(h);

  // --- SCORM/LMS detection — if launched from an LMS, do not block
  const hasScormFlag = /[?&]scorm=1\b/i.test(location.search);
  const hasApiHere   = !!(window.API || window.API_1484_11);
  const hasApiParent = (() => {
    try { return !!(window.parent && (parent.API || parent.API_1484_11)); }
    catch { return false; }
  })();
  const isLMS = hasScormFlag || hasApiHere || hasApiParent;
  if (isLMS) return;

  if (!(okLocal || okGh || okCustom)) {
    document.documentElement.innerHTML =
      "<style>body{font-family:system-ui;background:#000;color:#0ff;padding:2rem}</style>" +
      "<h1>Unauthorized mirror</h1><p>This build is locked to the author’s domains.</p>";
    throw new Error("Unauthorized origin: " + h);
  }
})();
// --- Harden the awards set: always merge, never clobber ---
function hardenAwardSet() {
  if (window.__awardHardenerInstalled) return;
  window.__awardHardenerInstalled = true;

  let S = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));

  window.mergeAwards = function mergeAwards(list) {
    const arr = Array.isArray(list) ? list
              : (list instanceof Set) ? Array.from(list)
              : Array.from(list || []);
    arr.forEach(x => S.add(x));
    return S;
  };

  window.getAwardArray = () => Array.from(S);

  Object.defineProperty(window, "__awarded", {
    configurable: true,
    get() { return S; },
    set(v) {
      try {
        const incoming = (v instanceof Set) ? Array.from(v)
                      : Array.isArray(v)    ? v
                      : [];
        incoming.forEach(x => S.add(x));
        console.log("[__awarded harden] Merge instead of overwrite; size:", S.size);
      } catch (_) {}
    }
  });
}

// Install immediately (BEFORE any loads that might assign to __awarded)
hardenAwardSet();

// Course mastery (fallback if LMS doesn't provide one)
window.__MASTERY = 75;

// --- Awards storage (unify key + migrate) ---
const AWARD_KEY = 'awarded_scenes_v2';

// Merge (never overwrite) awards into the in-memory set
function mergeAwards(list) {
  const s = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));
  (Array.isArray(list) ? list : []).forEach(x => s.add(x));
  window.__awarded = s;     // keep the same Set instance if possible
}




(function migrateAwardKeys(){
  try {
    const v2 = localStorage.getItem(AWARD_KEY);
    const v1a = localStorage.getItem('awarded_scenes_v1');
    const v1b = localStorage.getItem('awarded_v1');
    if (!v2) {
      const use = v1a || v1b;
      if (use) localStorage.setItem(AWARD_KEY, use);
    }
  } catch(_) {}
})();

// === Detect LMS context (pure detection; no SCORM.init) ===
function inLMS() {
  // 1) Explicit query hint
  try { if (/[?&]scorm=1\b/i.test(location.search)) return true; } catch (_) {}

  // 2) Walk up parent frames (SCORM API is usually in a parent)
  try {
    let w = window, hops = 0;
    while (w && hops++ < 20) {
      if (w.API || w.API_1484_11) return true;
      if (!w.parent || w.parent === w) break;
      w = w.parent;
    }
  } catch (_) {}

  // 3) Check opener chain (SCORM Cloud often opens a child window)
  try {
    let o = window.opener, hops = 0;
    while (o && hops++ < 5) {
      if (o.API || o.API_1484_11) return true;
      if (!o.parent || o.parent === o) break;
      o = o.parent;
    }
  } catch (_) {}

  // 4) Known hostnames as a last hint
  try { if (/\bscormcloud\.com$|\bscorm\.com$/i.test(location.hostname)) return true; } catch(_) {}

  // 5) Adapter flag if already set
  if (typeof window.__IS_SCORM__ === "boolean") return window.__IS_SCORM__;

  return false;
}
// (optional) expose for other modules that expect a global
window.inLMS = window.inLMS || inLMS;


// === Awards persistence (merge-only, LMS-safe) ===
// Place after inLMS()/hardener, before scoring bootstrap

// Single source-of-truth local key
window.AWARD_KEY = window.AWARD_KEY || 'awarded_scenes_v2';

// Helper: array view of the awards Set
if (typeof window.getAwardArray !== 'function') {
  window.getAwardArray = function getAwardArray() {
    if (window.__awarded instanceof Set) return Array.from(window.__awarded);
    return Array.from(new Set(window.__awarded || []));
  };
}

// Helper: merge (never overwrite) into the awards Set
if (typeof window.mergeAwards !== 'function') {
  window.mergeAwards = function mergeAwards(list) {
    const s = (window.__awarded instanceof Set)
      ? window.__awarded
      : new Set(Array.from(window.__awarded || []));
    (Array.isArray(list) ? list : []).forEach(x => s.add(x));
    window.__awarded = s; // keep a Set
  };
}

// Loader: prefer LMS; ignore local in LMS launches; merge legacy once
window.awardPersistLoad = function awardPersistLoad() {
  try {
    if (window.__HYDRATED_FROM_LMS__) return; // already hydrated from LMS
  } catch (_) {}

  // If launched inside an LMS, do NOT bring in browser carryover
  try {
    if (typeof inLMS === 'function' && inLMS()) {
      console.log('[SCORM] Ignored local awards bootstrap in LMS.');
      return;
    }
  } catch (_) {}

  // Merge current (v2) key
  try {
    const v2 = JSON.parse(localStorage.getItem(window.AWARD_KEY) || '[]');
    if (Array.isArray(v2)) window.mergeAwards(v2);
  } catch (_) {}

  // Optional one-time migration from legacy key
  try {
    const v1 = JSON.parse(localStorage.getItem('awarded_scenes_v1') || '[]');
    if (Array.isArray(v1) && v1.length) {
      window.mergeAwards(v1);
      // Uncomment if you want to clean up after migrating:
      // localStorage.removeItem('awarded_scenes_v1');
    }
  } catch (_) {}
};

function awardPersistSave() {
  try {
    localStorage.setItem(AWARD_KEY, JSON.stringify(getAwardArray()));
  } catch (_) {}
}


// Run the loader once on startup (outside LMS this merges local awards)
window.awardPersistLoad();



// --- Healing shim for __awarded: merge on any attempted overwrite ---
(function () {
  // Start from whatever we have (Set or array or null)
  let _awarded = (window.__awarded instanceof Set)
    ? window.__awarded
    : new Set(Array.from(window.__awarded || []));

  function toArray(x) {
    if (!x) return [];
    if (x instanceof Set) return Array.from(x);
    if (Array.isArray(x)) return x;
    return []; // unknown shape
  }

  Object.defineProperty(window, '__awarded', {
    configurable: true,
    get() { return _awarded; },
    set(v) {
      // Heals overwrites by merging instead of replacing
      const incoming = toArray(v);
      incoming.forEach(item => _awarded.add(item));
      console.warn('[__awarded heal] Overwrite attempt merged.', { size: _awarded.size, incomingCount: incoming.length });

      // Optional: one-time stack to find the caller
      try {
        if (!window.__awardedHealTracedOnce) {
          window.__awardedHealTracedOnce = true;
          console.trace('[__awarded heal] First overwrite stack trace');
        }
      } catch {}
    }
  });

  // Ensure the getter returns a Set
  if (!(_awarded instanceof Set)) _awarded = new Set(toArray(_awarded));
})();

// === FUNDAE / SCORM thresholds ===
window.__MASTERY = 75;                  // default pass threshold (overridden by LMS masteryscore if present)
window.__AUTO_PASS_ON_THRESHOLD = true; // pass immediately at/over threshold (mid-course)





// === Minimal score model (fixed denominator) ===
window.score = window.score || { cur: 0, max: 0 };

function publishScoreToLMS() {
  try {
    if (!SCORM.init()) return;
    const cur = Number(window.score?.cur || 0);
    const max = Number(window.score?.max || 0);
    const raw = (max > 0) ? Math.round((cur / max) * 100) : 0;  // <-- no fallback to 1
    SCORM.set("cmi.core.score.raw", String(raw));
    SCORM.commit();
    console.log("[SCORM] score updated →", raw, "% (", cur, "/", max, ")");
  } catch (e) {
    console.warn("[SCORM] score push failed:", e);
  }
}

window.scoreAdd = function (delta = 0) {
  const add = Math.max(0, Number(delta) || 0);
  window.score.cur = (window.score.cur || 0) + add;
  publishScoreToLMS();
};

window.scoreReset = function (max = null) {
  window.score.cur = 0;
  if (max != null) window.score.max = Number(max) || 0;
  publishScoreToLMS();
};

window.scoreCurrent = () => Number(window.score.cur || 0);
window.scoreMax     = () => Number(window.score.max || 0);


// Set/lock the denominator and push 0% to LMS
function scoreBootstrap(total) {
  const t = Number(total || 0);
  window.__TOTAL_AWARD_MAX = t;
  window.score.max = t;
  if (!SCORM.init()) return;
  const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
  if (!status || status === "not attempted" || status === "unknown") {
    SCORM.set("cmi.core.lesson_status", "incomplete");
  }
  SCORM.set("cmi.core.score.raw", "0");
  SCORM.commit();
  console.log("[SCORM] bootstrap: max =", t, "status=incomplete");
}

// Add points. If max isn’t set yet but the global total exists, latch it.
window.scoreAdd = function (delta = 0) {
  const add = Math.max(0, Number(delta) || 0);
  window.score.cur = (window.score.cur || 0) + add;
  if (!(window.score.max > 0) && (window.__TOTAL_AWARD_MAX > 0)) {
    window.score.max = window.__TOTAL_AWARD_MAX;
  }
  publishScoreToLMS();
};

// Reset score (rarely needed)
window.scoreReset = function (max = null) {
  window.score.cur = 0;
  if (max != null) window.score.max = Number(max) || 0;
  publishScoreToLMS();
};

// Helpers (used by logs)
window.scoreCurrent = () => Number(window.score.cur || 0);
window.scoreMax     = () => Number(window.score.max || 0);





// === Runtime signature (brand/evidence) ===
const __XAVETHEWHALES_SIGNATURE__ = Object.freeze({
  brand: "xavethewhales-games",
  build: "2025-09-05",
  site: "https://xavethewhales-edu.github.io"
});
(function showSigOnce(){
  if (!window.__XTW_SIG_SHOWN__) {
    window.__XTW_SIG_SHOWN__ = true;
    try {
      console.info(
        "%c" + __XAVETHEWHALES_SIGNATURE__.brand + " — " + __XAVETHEWHALES_SIGNATURE__.build,
        "color:#0ff;font-weight:700"
      );
    } catch {}
  }
})();


/* =========================
   SCORM 1.2 adapter (safe no-op outside LMS)
   ========================= */
(function () {
  const SC = {
    api: null,
    inited: false,
    finished: false,
    start: null
  };

  function findAPI(win) {
    let w = win, hops = 0;
    while (w && !w.API && w.parent && w.parent !== w && hops < 20) {
      hops++; w = w.parent;
    }
    return w && w.API ? w.API : null;
  }

  SC.findAPI = (w) => findAPI(w) || (w.opener ? findAPI(w.opener) : null);

  SC.init = function () {
    if (SC.inited) return true;
    SC.api = SC.findAPI(window);
    if (!SC.api) return false;
    try {
      const ok = SC.api.LMSInitialize("") === "true" || SC.api.LMSInitialize("") === true;
      if (ok) {
        SC.inited = true;
        SC.start = Date.now();
        const st = SC.get("cmi.core.lesson_status");
        if (!st || st === "not attempted") SC.set("cmi.core.lesson_status", "incomplete");
      }
      return ok;
    } catch (_) { return false; }
  };

  SC.set = function (k, v) {
    try { if (!SC.init()) return false; return SC.api.LMSSetValue(k, String(v)) === "true"; }
    catch (_) { return false; }
  };
  SC.get = function (k) {
    try { if (!SC.init()) return null; return SC.api.LMSGetValue(k); }
    catch (_) { return null; }
  };
  SC.commit = function () {
    try { if (!SC.init()) return false; return SC.api.LMSCommit("") === "true"; }
    catch (_) { return false; }
  };

  function hhmmss(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(t / 3600)).padStart(2, "0");
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
    const s = String(t % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  SC.finish = function (opts = {}) {
    try {
      if (!SC.init() || SC.finished) return;
      const dur = SC.start ? Date.now() - SC.start : 0;
      SC.set("cmi.core.session_time", hhmmss(dur));
      if (opts.status) SC.set("cmi.core.lesson_status", opts.status);
      if (typeof opts.score === "number") SC.set("cmi.core.score.raw", Math.max(0, Math.min(100, Math.round(opts.score))));
      SC.commit();
      SC.api.LMSFinish("");
      SC.finished = true;
    } catch (_) {}
  };

  SC.setStatus      = s => SC.set("cmi.core.lesson_status", s);
  SC.setScoreRaw    = n => SC.set("cmi.core.score.raw", n);
  SC.setLocation    = loc => SC.set("cmi.core.lesson_location", loc);
  SC.setSuspendData = data => SC.set("cmi.suspend_data", typeof data === "string" ? data : JSON.stringify(data).slice(0, 4000));
  SC.getSuspendData = () => {
    const v = SC.get("cmi.suspend_data");
    try { return v ? JSON.parse(v) : null; } catch { return v || null; }
  };

  window.__scorm = SC;
  window.__IS_SCORM__ = !!SC.findAPI(window);

  // --- Adapter bridge: make SCORM and __scorm the same API (whichever exists) ---
(function bridgeScormAPIs(){
  try {
    // If __scorm exists but SCORM doesn't, map SCORM to __scorm
    if (window.__scorm && !window.SCORM) {
      window.SCORM = {
        init:        () => window.__scorm.init(),
        get:         (k) => window.__scorm.get(k),
        set:         (k,v) => window.__scorm.set(k,v),
        commit:      () => window.__scorm.commit(),
        finish:      (arg1, arg2) => {
          // allow legacy finish("completed", 85) as well as finish({status, score})
          if (typeof arg1 === "string") {
            window.__scorm.finish({ status: arg1, score: arg2 });
          } else {
            window.__scorm.finish(arg1 || {});
          }
        }
      };
    }
    // If SCORM exists but __scorm doesn't, mirror the other way (optional)
    if (window.SCORM && !window.__scorm) {
      window.__scorm = {
        init:   () => window.SCORM.init(),
        get:    (k) => window.SCORM.get(k),
        set:    (k,v) => window.SCORM.set(k,v),
        commit: () => window.SCORM.commit(),
        finish: (opts={}) => {
          const s = opts && opts.status;
          const n = (typeof opts.score === "number") ? opts.score : undefined;
          if (s) window.SCORM.set("cmi.core.lesson_status", s);
          if (typeof n === "number") window.SCORM.set("cmi.core.score.raw", String(n));
          window.SCORM.commit();
        }
      };
    }
  } catch(_) {}
})();


  if (window.__IS_SCORM__) {
    SC.init();
    window.addEventListener("beforeunload", () => SC.finish({}));
  }
})();
// Alias so existing code using SCORM.* keeps working
window.SCORM = window.SCORM || window.__scorm;

// --- Global home toggles (single source of truth) ---
window.showHome = function showHome() {
  const overlay = document.getElementById('overlay-content');
  const game    = document.getElementById('game-container');
  if (game)    game.style.display = 'none';
  if (overlay) overlay.style.display = ''; // let CSS handle layout
};

window.hideHome = function hideHome() {
  const overlay = document.getElementById('overlay-content');
  const game    = document.getElementById('game-container');
  if (overlay) overlay.style.display = 'none';
  if (game)    game.style.display = 'block';
};








const scenes = {
/* =========================
   ACT I — “Product & Guardrails”
   ========================= */
   scene1: {
  type: "text",
  text: "Tap Continue to begin.", // minimal stub to satisfy validator
  forceSpeechUI: true,
  image: "images/1.png",
  awardOnEnter: 2,
  render: function (container) {
    const t = document.getElementById("scene-text");
    if (t) {
      t.style.display = "none";
      t.innerHTML = "";
    }

    container.style.display = "block";
    container.innerHTML = `
      <div style="
        max-width:900px;margin:12px auto 0;padding:14px 16px;
        border-radius:12px;background:#07131a;border:1px solid #00bcd455;
        box-shadow:0 6px 18px #0008;color:#9fe8ff;
        font:600 1.02rem/1.55 system-ui;">
        
        <div style="
          font-weight:900;
          letter-spacing:.12em;
          text-transform:uppercase;
          text-align:center;
          color:#00e6ff;
          margin-bottom:10px;
          font-size:1.1rem;">
          WE HAVE A DEAL!
        </div>

        <p style="margin:0 0 8px 0;text-align:center;color:#b4f3ff;">
          A negotiation skills game for intermediate and advanced English learners.
        </p>

        <p style="margin:0 0 10px 0;font-weight:500;color:#9fe8ff;">
          Choose how you want to play: follow the recommended sequence to build your skills step by step,
          or jump straight into any challenge from the directory.
        </p>

        <p style="margin:0;font-weight:500;color:#7fd9f5;">
          Your goal is to use polite, persuasive English to reach smoother agreements — in business,
          daily life, and everything in between.
        </p>

        <hr style="border:none;border-top:1px solid rgba(0,230,255,.25);margin:12px 0 10px;">

        <div style="font-weight:700;color:#8be9fd;margin-bottom:4px;">
          How would you like to start?
        </div>
        <p style="margin:0 0 4px 0;font-weight:500;color:#7fd9f5;">
          • <strong>Story Mode</strong> — guided path with warm-ups, bootcamps, grammar run, audio and video scenes.<br>
          • <strong>Challenge Mode</strong> — jump directly into any activity from the directory.
        </p>
      </div>

      <div style="
        text-align:center;
        margin-top:14px;
        display:flex;
        justify-content:center;
        gap:12px;
        flex-wrap:wrap;">
        
        <button id="btn-story-mode" style="
          padding:10px 16px;
          border:none;
          border-radius:10px;
          background:linear-gradient(135deg,#00ffff,#00bcd4);
          color:#001517;
          font-weight:800;
          cursor:pointer;
          text-transform:uppercase;
          letter-spacing:.04em;
          box-shadow:0 4px 12px rgba(0,255,255,.35);">
          ▶ Story Mode
        </button>

        <button id="btn-challenge-mode" style="
          padding:10px 16px;
          border:none;
          border-radius:10px;
          background:linear-gradient(135deg,#ff6ec7,#ffb347);
          color:#050812;
          font-weight:800;
          cursor:pointer;
          text-transform:uppercase;
          letter-spacing:.04em;
          box-shadow:0 4px 12px rgba(255,110,199,.35);">
          🎯 Challenge Mode
        </button>
      </div>
    `;

    const storyBtn = container.querySelector('#btn-story-mode');
    if (storyBtn) {
      storyBtn.onclick = () => loadScene("scene2_hangman_intro_deal"); // first scene in Story Mode sequence
    }

    const challengeBtn = container.querySelector('#btn-challenge-mode');
    if (challengeBtn) {
      challengeBtn.onclick = () => loadScene("scene_challenge_hub"); // hub/directory scene
    }
  }
},

// --- ACT 1: HANGMAN – "Language of the Deal" ---

scene2_hangman_intro_deal: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 2, // SCORM: entering this section gives a small progress tick
  text:
    "Before you negotiate, you need the language of the deal.\n\n" +
    "In this mini-challenge, you’ll guess key negotiation words letter by letter.\n" +
    "Don’t worry if you miss a few — after each word, you’ll see a clear definition and an example sentence.\n\n" +
    "Ready? Let’s start with some core deal vocabulary.",
  choices: [
    { text: "Start Hangman: Language of the Deal", next: "scene2a_hangman_bargain" }
  ]
},

// 1) BARGAIN
scene2a_hangman_bargain: {
  type: "hangman",
  noSpeechUI: true,
  image: "images/2.png",
  hint: "A deal where both sides feel the price is fair — or something bought cheaply.",
  target: "bargain",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene2a_remedial_bargain",      // on win
  onLoseNext: "scene2a_remedial_bargain" // on fail
},

scene2a_remedial_bargain: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 3, // SCORM: credit for completing this word
  text:
    "BARGAIN: A deal where both sides agree on a fair price — or something bought cheaply.\n\n" +
    "In use:\n" +
    "• \"We got a real bargain on that contract — the features we needed at a lower rate.\"\n",
  choices: [
    { text: "Next word", next: "scene2b_hangman_counteroffer" }
  ]
},

// 2) COUNTEROFFER
scene2b_hangman_counteroffer: {
  type: "hangman",
  noSpeechUI: true,
  image: "images/2.png",
  hint: "A new proposal made after rejecting the first one.",
  target: "counteroffer",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene2b_remedial_counteroffer",
  onLoseNext: "scene2b_remedial_counteroffer"
},

scene2b_remedial_counteroffer: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 3,
  text:
    "COUNTEROFFER: A new proposal you make after rejecting or questioning the first offer.\n\n" +
    "In use:\n" +
    "• \"They didn’t accept our first proposal, but their counteroffer was still workable.\"\n",
  choices: [
    { text: "Next word", next: "scene2c_hangman_compromise" }
  ]
},

// 3) COMPROMISE
scene2c_hangman_compromise: {
  type: "hangman",
  noSpeechUI: true,
  image: "images/2.png",
  hint: "An agreement where both sides give up something.",
  target: "compromise",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene2c_remedial_compromise",
  onLoseNext: "scene2c_remedial_compromise"
},

scene2c_remedial_compromise: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 3,
  text:
    "COMPROMISE: An agreement where both sides give up something to reach a deal.\n\n" +
    "In use:\n" +
    "• \"We didn’t get everything we wanted, but the compromise keeps the partnership strong.\"\n",
  choices: [
    { text: "Next word", next: "scene2d_hangman_leverage" }
  ]
},

// 4) LEVERAGE
scene2d_hangman_leverage: {
  type: "hangman",
  noSpeechUI: true,
  image: "images/2.png",
  hint: "The power or advantage one side has in a negotiation.",
  target: "leverage",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene2d_remedial_leverage",
  onLoseNext: "scene2d_remedial_leverage"
},

scene2d_remedial_leverage: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 3,
  text:
    "LEVERAGE: The power or advantage one side has in a negotiation.\n\n" +
    "In use:\n" +
    "• \"Their long history with us gives them leverage to ask for better terms.\"\n",
  choices: [
    { text: "Next word", next: "scene2e_hangman_concession" }
  ]
},

// 5) CONCESSION
scene2e_hangman_concession: {
  type: "hangman",
  noSpeechUI: true,
  image: "images/2.png",
  hint: "Something you agree to give up to reach an agreement.",
  target: "concession",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene2e_remedial_concession",
  onLoseNext: "scene2e_remedial_concession"
},

scene2e_remedial_concession: {
  type: "text",
  image: "images/2.png",
  awardOnEnter: 3,
  text:
    "CONCESSION: Something you give up or adjust in order to reach agreement.\n\n" +
    "In use:\n" +
    "• \"Offering extended support was a concession that helped close the deal.\"\n",
  choices: [
    { text: "Continue to Car Bootcamp", next: "scene_car_intro" } // next module
  ]
},
// ==== CAR BOOTCAMP – TIE-IN + 8 SCRAMBLES ====

// Tie-in scene after Hangman "Deal"
scene_car_intro: {
  type: "text",
  image: "images/3.png",
  awardOnEnter: 0,
  text:
    "You’re selling your car online.\n\n" +
    "A potential buyer has shown interest and wants to negotiate the price.\n" +
    "Your goal: reach a deal that feels fair without giving up too much value.\n\n" +
    "In this bootcamp, you’ll see what the buyer says and then unscramble your reply. " +
    "Each correct sentence uses polite, persuasive English that keeps the negotiation smooth.",
  choices: [
    { text: "Start the car negotiation bootcamp", next: "scene_car_1" }
  ]
},

// Scene 1 — Starting with Cooperation
scene_car_1: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Twelve thousand? That’s above my budget. Could we talk closer to ten?”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "at eleven thousand?",
    "sound fair to you",
    "Would that",
    "if we met halfway"
  ],
  correct: [
    "Would that",
    "sound fair to you",
    "if we met halfway",
    "at eleven thousand?"
  ],
  next: "scene_car_1_explained"
},

scene_car_1_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "Would that sound fair to you if we met halfway at eleven thousand?\n\n" +
    "Why it works:\n" +
    "• It turns a fixed price into a joint decision.\n" +
    "• Using “would” softens the offer.\n" +
    "• “Sound fair to you” shows empathy and invites agreement.",
  choices: [
    { text: "Continue", next: "scene_car_2" }
  ]
},

// Scene 2 — Saying No Politely
scene_car_2: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Ten thousand is really my limit.”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "would be",
    "I’m afraid",
    "ten thousand",
    "quite below",
    "its real value."
  ],
  correct: [
    "I’m afraid",
    "ten thousand",
    "would be",
    "quite below",
    "its real value."
  ],
  next: "scene_car_2_explained"
},

scene_car_2_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "I’m afraid ten thousand would be quite below its real value.\n\n" +
    "Why it works:\n" +
    "• “I’m afraid…” cushions the disagreement.\n" +
    "• It signals respect before delivering the refusal.\n" +
    "• Mentioning “real value” keeps the focus on facts, not feelings.",
  choices: [
    { text: "Continue", next: "scene_car_3" }
  ]
},

// Scene 3 — Showing Conditional Openness
scene_car_3: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “If I pay cash today, can you lower the price?”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "I might be open to it.",
    "If we were to",
    "discuss a small discount,"
  ],
  correct: [
    "If we were to",
    "discuss a small discount,",
    "I might be open to it."
  ],
  next: "scene_car_3_explained"
},

scene_car_3_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "If we were to discuss a small discount, I might be open to it.\n\n" +
    "Why it works:\n" +
    "• “If we were to…” makes it hypothetical, not a promise.\n" +
    "• “Might be open” sounds flexible but still controlled.\n" +
    "• It keeps the discussion alive without giving away the final number.",
  choices: [
    { text: "Continue", next: "scene_car_4" }
  ]
},

// Scene 4 — Reframing Value
scene_car_4: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Ten-five sounds reasonable. Can we agree on that?”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "and I include the inspection report",
    "and full detailing.",
    "Say we keep it at eleven",
    "Would that seem fair?"
  ],
  correct: [
    "Say we keep it at eleven",
    "and I include the inspection report",
    "and full detailing.",
    "Would that seem fair?"
  ],
  next: "scene_car_4_explained"
},

scene_car_4_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "Say we keep it at eleven and I include the inspection report and full detailing — would that seem fair?\n\n" +
    "Why it works:\n" +
    "• “Say we…” introduces the idea in a relaxed way.\n" +
    "• You add value instead of just cutting the price.\n" +
    "• Ending with “would that seem fair?” invites collaboration, not pressure.",
  choices: [
    { text: "Continue", next: "scene_car_5" }
  ]
},

// Scene 5 — Holding Firm with Empathy
scene_car_5: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “If you don’t lower it, I’ll check another car.”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "I completely understand,",
    "to miss a good one",
    "but I’d hate for you",
    "over a few hundred euros."
  ],
  correct: [
    "I completely understand,",
    "but I’d hate for you",
    "to miss a good one",
    "over a few hundred euros."
  ],
  next: "scene_car_5_explained"
},

scene_car_5_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "I completely understand, but I’d hate for you to miss a good one over a few hundred euros.\n\n" +
    "Why it works:\n" +
    "• You acknowledge their position first (“I completely understand”).\n" +
    "• “I’d hate for you to miss a good one…” adds gentle persuasion.\n" +
    "• It protects the relationship while reminding them of the car’s value.",
  choices: [
    { text: "Continue", next: "scene_car_6" }
  ]
},

// Scene 6 — Persuading with a Rhetorical Question
scene_car_6: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “You’re really fixed on that price, aren’t you?”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "You wouldn’t expect",
    "at that price,",
    "a full warranty",
    "would you?"
  ],
  correct: [
    "You wouldn’t expect",
    "a full warranty",
    "at that price,",
    "would you?"
  ],
  next: "scene_car_6_explained"
},

scene_car_6_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "You wouldn’t expect a full warranty at that price, would you?\n\n" +
    "Why it works:\n" +
    "• A rhetorical negative question challenges gently.\n" +
    "• It invites the buyer to agree with your logic.\n" +
    "• The tag “would you?” keeps the tone conversational, not aggressive.",
  choices: [
    { text: "Continue", next: "scene_car_7" }
  ]
},

// Scene 7 — Offering a Win–Win Compromise
scene_car_7: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Alright, can we split the difference somehow?”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "How about if",
    "at ten-seven-fifty?",
    "I include the winter tyres",
    "and we settle"
  ],
  correct: [
    "How about if",
    "I include the winter tyres",
    "and we settle",
    "at ten-seven-fifty?"
  ],
  next: "scene_car_7_explained"
},

scene_car_7_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "How about if I include the winter tyres and we settle at ten-seven-fifty?\n\n" +
    "Why it works:\n" +
    "• “How about if…” suggests teamwork.\n" +
    "• You add something concrete (winter tyres) instead of just dropping the price.\n" +
    "• It feels generous yet smart — classic win–win language.",
  choices: [
    { text: "Continue", next: "scene_car_8" }
  ]
},

// Scene 8 — Closing with Calm Assurance
scene_car_8: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Okay, I’ll think about it and let you know.”\n\n" +
    "Arrange your reply in the best order.",
  scramble: [
    "It doesn’t make sense",
    "does it?",
    "to rush a good decision,"
  ],
  correct: [
    "It doesn’t make sense",
    "to rush a good decision,",
    "does it?"
  ],
  next: "scene_car_8_explained"
},

scene_car_8_explained: {
  type: "text",
  awardOnEnter: 0,
  text:
    "It doesn’t make sense to rush a good decision, does it?\n\n" +
    "Why it works:\n" +
    "• “Does it?” is a soft tag question that keeps rapport.\n" +
    "• It reassures the buyer that taking time is fine.\n" +
    "• Calm, patient language shows confidence in the value of your offer.",
  choices: [
    // TODO: point this to the next piece in the Story Mode sequence
    { text: "Continue", next: "scene_hang2_intro" }
  ]
},
// ==== END CAR BOOTCAMP ====


/* -----------------------------------------------------------
   HANGMAN 2 — SOFT SKILLS VOCABULARY
   Image: images/4.png
----------------------------------------------------------- */

scene_hang2_intro: {
  type: "text",
  image: "images/4.png",
  awardOnEnter: 2,
  text:
    "Before the next negotiation bootcamp, warm up with a few key soft-skills terms.\n\n" +
    "These words appear constantly in workplace negotiations. Solve each Hangman to unlock its explanation.",
  choices: [
    { text: "Start", next: "scene_hang2_word_discount" }
  ]
},

/* ---------- 1. discount ---------- */

scene_hang2_word_discount: {
  type: "hangman",
  noSpeechUI: true,
  awardOnEnter: 2,
  hint: "A reduction in price — often used to close a deal.",
  target: "discount",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hang2_remedial_discount",
  onLoseNext: "scene_hang2_remedial_discount"
},

scene_hang2_remedial_discount: {
  type: "text",
  text:
    "DISCOUNT: A reduction in price, often used strategically to finalise an agreement.\n" +
    "Example: “We could consider a small discount if the order is confirmed today.”",
  choices: [
    { text: "Continue", next: "scene_hang2_word_proposal" }
  ]
},

/* ---------- 2. proposal ---------- */

scene_hang2_word_proposal: {
  type: "hangman",
  noSpeechUI: true,
  awardOnEnter: 2,
  hint: "A formal or informal plan presented for discussion.",
  target: "proposal",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hang2_remedial_proposal",
  onLoseNext: "scene_hang2_remedial_proposal"
},

scene_hang2_remedial_proposal: {
  type: "text",
  text:
    "PROPOSAL: A plan or suggestion offered for consideration.\n" +
    "Example: “We sent a proposal outlining the project timelines and costs.”",
  choices: [
    { text: "Continue", next: "scene_hang2_word_deadline" }
  ]
},

/* ---------- 3. deadline ---------- */

scene_hang2_word_deadline: {
  type: "hangman",
  noSpeechUI: true,
  awardOnEnter: 2,
  hint: "The final time by which a task must be completed.",
  target: "deadline",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hang2_remedial_deadline",
  onLoseNext: "scene_hang2_remedial_deadline"
},

scene_hang2_remedial_deadline: {
  type: "text",
  text:
    "DEADLINE: The final time or date something must be completed.\n" +
    "Example: “We need confirmation by Friday to meet the deadline.”",
  choices: [
    { text: "Continue", next: "scene_hang2_word_persuasion" }
  ]
},

/* ---------- 4. persuasion ---------- */

scene_hang2_word_persuasion: {
  type: "hangman",
  noSpeechUI: true,
  awardOnEnter: 2,
  hint: "The ability to influence others and make them see your point of view.",
  target: "persuasion",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hang2_remedial_persuasion",
  onLoseNext: "scene_hang2_remedial_persuasion"
},

scene_hang2_remedial_persuasion: {
  type: "text",
  text:
    "PERSUASION: The skill of influencing someone’s thinking or decisions.\n" +
    "Example: “Effective persuasion relies on tone, timing, and clear reasoning.”",
  choices: [
    { text: "Continue", next: "scene_hang2_word_rapport" }
  ]
},

/* ---------- 5. rapport ---------- */

scene_hang2_word_rapport: {
  type: "hangman",
  noSpeechUI: true,
  awardOnEnter: 2,
  hint: "A positive relationship built through trust and good communication.",
  target: "rapport",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hang2_remedial_rapport",
  onLoseNext: "scene_hang2_remedial_rapport"
},

scene_hang2_remedial_rapport: {
  type: "text",
  text:
    "RAPPORT: A strong, trusting connection between people.\n" +
    "Example: “She built rapport quickly by listening actively and asking thoughtful questions.”",
  choices: [
    // YOU WILL ROUTE THIS TO THE NEXT MODULE (Grammar Run)
    { text: "Continue", next: "scene_bootcamp2_intro" }
  ]
},
// Tie-in for Bootcamp 2 – Say It Better
scene_bootcamp2_intro: {
  type: "text",
  image: "images/5.png",
  text:
    "💼 Negotiation Bootcamp 2 — “Say It Better”\n\n" +
    "You’re negotiating small but important details at work — deadlines, budgets, workloads.\n" +
    "You already know what you want to say, but the way you say it in English can decide whether\n" +
    "the conversation feels collaborative or confrontational.\n\n" +
    "In this bootcamp, you’ll see a direct, blunt thought and rebuild it into a more persuasive,\n" +
    "professional version.\n\n" +
    "Unscramble each response into a polite, clear sentence that keeps the relationship strong\n" +
    "while protecting your interests.",
  choices: [
    { text: "Start Bootcamp 2", next: "scene_bootcamp2_1" }
  ]
},

// Scene 1 — Asking for More Time
scene_bootcamp2_1: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Manager: “We need the final report by Friday. Can you deliver?”\n\n" +
    "Plain version: “I can’t finish that fast.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "to Monday morning?",
    "Friday might be a little tight.",
    "Could we move it"
  ],
  correct: [
    "Friday might be a little tight.",
    "Could we move it",
    "to Monday morning?"
  ],
  next: "scene_bootcamp2_1_explain"
},

scene_bootcamp2_1_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "This sounds cooperative, not negative.\n" +
    "Using “might” and “could” softens the message, and offering a specific new deadline\n" +
    "(Monday morning) shows initiative rather than resistance.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_2" }
  ]
},

// Scene 2 — Requesting a Better Budget
scene_bootcamp2_2: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Client: “We were thinking of offering two thousand for the project.”\n\n" +
    "Plain version: “That’s not enough.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "for the scope",
    "of the project.",
    "That could be a bit low"
  ],
  correct: [
    "That could be a bit low",
    "for the scope",
    "of the project."
  ],
  next: "scene_bootcamp2_2_explain"
},

scene_bootcamp2_2_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "It avoids a direct “That’s not…” contradiction and shifts the focus to the work itself\n" +
    "with “for the scope of the project.”\n\n" +
    "“Could be” keeps the tone polite and objective instead of emotional.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_3" }
  ]
},

// Scene 3 — Declining an Unfair Task
scene_bootcamp2_3: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Colleague: “Can you take over the client presentation for me?”\n\n" +
    "Plain version: “That’s not my job.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "so we keep everything",
    "I'd prefer to stay focused",
    "on schedule.",
    "on my current tasks"
  ],
  correct: [
    "I'd prefer to stay focused",
    "on my current tasks",
    "so we keep everything",
    "on schedule."
  ],
  next: "scene_bootcamp2_3_explain"
},

scene_bootcamp2_3_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "It gives a reason instead of a flat refusal. “I’d prefer to stay focused…” sounds\n" +
    "constructive and respectful.\n\n" +
    "You protect your priorities while showing concern for the overall schedule.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_4" }
  ]
},

// Scene 4 — Asking for Remote Work
scene_bootcamp2_4: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Manager: “We need more people in the office next month.”\n\n" +
    "Plain version: “I want to work from home.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "two days a week",
    "next month?",
    "Would it be possible",
    "to work remotely"
  ],
  correct: [
    "Would it be possible",
    "to work remotely",
    "two days a week",
    "next month?"
  ],
  next: "scene_bootcamp2_4_explain"
},

scene_bootcamp2_4_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "Framing it as a question (“Would it be possible…”) invites discussion instead of\n" +
    "demanding a change.\n\n" +
    "Limiting it to “two days a week” makes the request moderate and easier to accept.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_5" }
  ]
},

// Scene 5 — Countering a Quick Decision
scene_bootcamp2_5: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Client: “Let’s close the deal right now.”\n\n" +
    "Plain version: “I need more time.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "It might be better",
    "before making a final decision.",
    "to take a short pause"
  ],
  correct: [
    "It might be better",
    "to take a short pause",
    "before making a final decision."
  ],
  next: "scene_bootcamp2_5_explain"
},

scene_bootcamp2_5_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "The phrase “might be better” feels cautious yet professional.\n" +
    "You encourage reflection without rejecting the offer or sounding nervous.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_6" }
  ]
},

// Scene 6 — Asking for a Raise
scene_bootcamp2_6: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Manager: “We’ll review salaries next year.”\n\n" +
    "Plain version: “I want a raise now.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "Would you be open",
    "a little earlier",
    "to reviewing my salary",
    "this quarter?"
  ],
  correct: [
    "Would you be open",
    "to reviewing my salary",
    "a little earlier",
    "this quarter?"
  ],
  next: "scene_bootcamp2_6_explain"
},

scene_bootcamp2_6_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "“Would you be open to…” is diplomatic but assertive — it invites collaboration\n" +
    "rather than confrontation.\n\n" +
    "“A little earlier this quarter” keeps the tone light and specific.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_7" }
  ]
},

// Scene 7 — Proposing a Compromise
scene_bootcamp2_7: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Client: “We can’t add another designer to your team.”\n\n" +
    "Plain version: “Then I can’t finish on time.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    "for this phase",
    "to keep the timeline realistic?",
    "How about if we bring in",
    "one intern"
  ],
  correct: [
    "How about if we bring in",
    "one intern",
    "for this phase",
    "to keep the timeline realistic?"
  ],
  next: "scene_bootcamp2_7_explain"
},

scene_bootcamp2_7_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "It changes a complaint into a constructive suggestion.\n" +
    "“How about if we…” signals flexibility and shared problem-solving,\n" +
    "rather than an ultimatum.",
  choices: [
    { text: "Continue", next: "scene_bootcamp2_8" }
  ]
},

// Scene 8 — Responding to a Discount Request
scene_bootcamp2_8: {
  type: "scramble",
  disableSpeech: true,
  awardOnEnter: 5,
  text:
    "Buyer: “Could you lower the price by 20%?”\n\n" +
    "Plain version: “No, that’s too much.”\n\n" +
    "Rebuild it into a more persuasive response:",
  scramble: [
    " perhaps we could review the options",
    "I understand the need to stay within budget",
    "to find",
    "a smaller adjustment."
  ],
  correct: [
    "I understand the need to stay within budget",
    "perhaps we could review the options",
    "to find",
    "a smaller adjustment."
  ],
  next: "scene_bootcamp2_8_explain"
},

scene_bootcamp2_8_explain: {
  type: "text",
  text:
    "Why it works:\n\n" +
    "It shows empathy first (“I understand the need to stay within budget”) before redirecting.\n" +
    "“Perhaps we could review the options…” softens the refusal and opens space\n" +
    "for a smaller, more realistic adjustment.",
  choices: [
    { text: "Continue", next: "scene_hangman3_intro" } // or your next scene ID
  ]
},

// Tie-in scene before Hangman 3 – "Settlement"
scene_hangman3_intro: {
  type: "text",
  image: "images/6.png",
  awardOnEnter: 3, // adjust later to balance SCORM total if needed
  text:
    "Before you dive into the next negotiation round, here’s one last key word.\n\n" +
    "In many disputes or long negotiations, both sides eventually reach a final agreement that closes everything.\n" +
    "You’ll see this word a lot in legal, business, and HR contexts.\n\n" +
    "Guess it correctly to unlock the definition and example.",
  choices: [
    { text: "Start Hangman", next: "scene_hangman3_settlement" }
  ]
},

// Hangman 3 – SETTLEMENT
scene_hangman3_settlement: {
  type: "hangman",
  noSpeechUI: true,
  hint: "A final agreement that ends a negotiation or dispute — both sides accept the terms.",
  target: "settlement",
  maxWrong: 6,
  allowRetry: false,
  suppressHub: true,
  next: "scene_hangman3_remedial_settlement",      // on win
  onLoseNext: "scene_hangman3_remedial_settlement" // on fail
},

// Remedial / explanation for SETTLEMENT
scene_hangman3_remedial_settlement: {
  type: "text",
  text:
    "SETTLEMENT: A final agreement that ends a negotiation or dispute — both sides accept the terms.\n\n" +
    "Example: “Both parties reached a settlement after reviewing the terms.”",
  choices: [
    // You can repoint this "next" to your Grammar Run tie-in scene ID
    { text: "Continue", next: "scene14_grammar_intro" }
  ]
},

scene14_grammar_intro: {
  type: "text",
  image: "images/7.png",
  awardOnEnter: 0,
  text: "Grammar Run — Two Sides of the Deal\n\nYou’ll play both buyer and seller.\nEach line is missing one key word that controls tone — polite, assertive, or persuasive.\n\nChoose quickly before time runs out.\nCorrect choices keep the discussion friendly; weak or strong choices make it tense.\n\nPress Continue when ready.",
  choices: [{ text: "Continue", next: "scene14_grammar_run" }]
},

// GRAMMAR RUN — negotiation version (16 prompts)
scene14_grammar_run: {
  type: "conjugation-race",
  image: "images/7.png",
  awardOnEnter: 8,                // nominal SCORM value — adjust later as needed
  text: "Timed recap: type the exact word that best fits each negotiation line.\nHints show the three options.",
  timerPer: 10,                   // you can push to 8 later if you want it harder
  shuffle: true,
  showAnswerOnWrong: true,
  caseInsensitive: true,
  acceptPunctuationVariants: true,
  suppressHub: true,
  // Scoring gates: adjust thresholds for 16 questions
  // >= high → endings.high ; >= medium → endings.medium ; else → endings.low
  scoring: { high: 14, medium: 11 },  // pass threshold = 11, “excellent” = 14+
  endings: {
    high:   "scene23_laptop_intro",
    medium: "scene23_laptop_intro",
    low:    "scene14_grammar_retry"   // FAIL → Retry
  },
  questions: [
    {
      prompt: "Buyer: “The price ________ be a bit high for this model.”",
      answers: ["might"],
      hint: "(might / must / can)"
    },
    {
      prompt: "Seller: “It ________ be above average, but it’s in excellent condition.”",
      answers: ["could"],
      hint: "(could / should / would)"
    },
    {
      prompt: "Buyer: “If I pay cash, ________ you consider lowering it?”",
      answers: ["would"],
      hint: "(will / would / can)"
    },
    {
      prompt: "Seller: “If we ________ to discuss a discount, I might be open to it.”",
      answers: ["were"],
      hint: "(were / are / be)"
    },
    {
      prompt: "Buyer: “That ________ sound reasonable if inspection is included.”",
      answers: ["would"],
      hint: "(would / could / should)"
    },
    {
      prompt: "Seller: “Say we keep it at eleven and I include detailing — ________ that seem fair?”",
      answers: ["would"],
      hint: "(should / will / would)"
    },
    {
      prompt: "Buyer: “That ________ help, especially if warranty’s confirmed.”",
      answers: ["might"],
      hint: "(might / will / does)"
    },
    {
      prompt: "Seller: “You ________ expect a full warranty at that price, would you?”",
      answers: ["wouldn’t"],
      hint: "(wouldn’t / shouldn’t / couldn’t)"
    },
    {
      prompt: "Buyer: “I ________ see your point — value matters.”",
      answers: ["do"],
      hint: "(do / can / might)"
    },
    {
      prompt: "Seller: “I appreciate that; we both ________ to feel the price is fair.”",
      answers: ["need"],
      hint: "(need / must / ought)"
    },
    {
      prompt: "Buyer: “How about we meet in the middle? Ten-seven-fifty ________ fair.”",
      answers: ["sounds"],
      hint: "(sounds / sound / sounding)"
    },
    {
      prompt: "Seller: “That ________ actually work if we sign today.”",
      answers: ["could"],
      hint: "(could / should / might)"
    },
    {
      prompt: "Buyer: “Great. I’ll need the papers by Monday — that ________ doable?”",
      answers: ["be"],
      hint: "(is / be / was)"
    },
    {
      prompt: "Seller: “It ________ tight, but I’ll make it happen.”",
      answers: ["might"],
      hint: "(might / is / can be)"
    },
    {
      prompt: "Buyer: “Thanks — it ________ sense to close when both sides are happy.”",
      answers: ["makes"],
      hint: "(makes / does / gives)"
    },
    {
      prompt: "Seller: “Exactly — that’s how good deals ________ done.”",
      answers: ["are"],
      hint: "(are / is / get)"
    }
  ]
},

scene14_grammar_retry: {
  type: "text",
  image: "images/7.png",
  awardOnEnter: 0,
  text: "Quick tip:\n\n• Use softer modals (might / could / would) to keep options open.\n• Use conditionals (If we were to…, Say we…) when you don’t want to commit too fast.\n• Choose forms that sound cooperative, not aggressive.\n\nTry the Grammar Run again when you’re ready.",
  choices: [{ text: "Retry Grammar Run", next: "scene14_grammar_run" }]
},

scene23_laptop_intro: {
  type: "text",
  awardOnEnter: 2, // nominal SCORM points – adjust in global tally if needed
  image: "images/8.png",
  text:
    "Laptop Call — First Contact\n\n" +
    "You’ve found a used laptop that looks perfect for your work. The seller has just " +
    "confirmed it’s still available, and now you’re moving into price.\n\n" +
    "In this call, you’ll hear the seller and then build your reply by putting the parts " +
    "of a sentence in the best order.\n\n" +
    "Listen carefully and aim for polite but persuasive language.",
  choices: [
    { text: "Start Call 1", next: "scene24_call1a_scramble" }
  ]
},

// CALL 1 – “The First Offer”  (audio + scrambles, then audio-only outro)

/*  S1.mp3 — “Hi—yeah, the laptop’s still available. Happy to answer questions.”
    → Scramble: What was your asking price? */
scene24_call1a_scramble: {
  type: "audio-scramble",
  disableSpeech: true,
  awardOnEnter: 2,
  audioSrc: "audio/S1.mp3",
  text: "Listen, then arrange your reply.",
  scramble: [
    "asking",
    "What was",
    "price?",
    "your"
  ],
  correct: [
    "What was",
    "your",
    "asking",
    "price?"
  ],
  next: "scene24_call1b_scramble",
  endings: {
    wrong: "scene24_call1_restart",
    timeout: "scene24_call1_restart"
  },
  timer: 20,
  suppressHub: true
},

/*  S2.mp3 — “It’s listed at twelve hundred.”
    → Scramble: That might be a bit high for my range, though I see the value. */
scene24_call1b_scramble: {
  type: "audio-scramble",
  disableSpeech: true,
  awardOnEnter: 2,
  audioSrc: "audio/S2.mp3",
  text: "Listen, then arrange your reply.",
  scramble: [
    "for my range,",
    "That might be",
    "though I see the value.",
    "a bit high"
  ],
  correct: [
    "That might be",
    "a bit high",
    "for my range,",
    "though I see the value."
  ],
  next: "scene24_call1c_scramble",
  endings: {
    wrong: "scene24_call1_restart",
    timeout: "scene24_call1_restart"
  },
  timer: 20,
  suppressHub: true
},

/*  S3.mp3 — “It’s barely used and still under warranty.”
    → Target: That would justify the price. */
scene24_call1c_scramble: {
  type: "audio-scramble",
  disableSpeech: true,
  awardOnEnter: 2,
  audioSrc: "audio/S3.mp3",
  text: "Listen, then arrange your reply.",
  scramble: [
    "justify the price.",
    "That would"
  ],
  correct: [
    "That would",
    "justify the price."
  ],
  next: "scene24_call1d_scramble",
  endings: {
    wrong: "scene24_call1_restart",
    timeout: "scene24_call1_restart"
  },
  timer: 20,
  suppressHub: true
},

/*  S4.mp3 — “It comes with the original charger and case.”
    → Target: Then it might sound fairer than I thought. */
scene24_call1d_scramble: {
  type: "audio-scramble",
  disableSpeech: true,
  awardOnEnter: 2,
  audioSrc: "audio/S4.mp3",
  text: "Listen, then arrange your reply.",
  scramble: [
    "fairer than I thought.",
    "Then it",
    "might sound"
  ],
  correct: [
    "Then it",
    "might sound",
    "fairer than I thought."
  ],
  next: "scene24_call1e_scramble",
  endings: {
    wrong: "scene24_call1_restart",
    timeout: "scene24_call1_restart"
  },
  timer: 20,
  suppressHub: true
},

/*  S5.mp3 — “If you’re serious, I can hold it for you until tomorrow.”
    → Target: If we were to meet halfway, I’d confirm right now. */
scene24_call1e_scramble: {
  type: "audio-scramble",
  disableSpeech: true,
  awardOnEnter: 2,
  audioSrc: "audio/S5.mp3",
  text: "Listen, then arrange your reply.",
  scramble: [
    "I’d confirm right now.",
    "If we were to meet halfway,"
  ],
  correct: [
    "If we were to meet halfway,",
    "I’d confirm right now."
  ],
  next: "scene24_call1f_outro",
  endings: {
    wrong: "scene24_call1_restart",
    timeout: "scene24_call1_restart"
  },
  timer: 20,
  suppressHub: true
},

/*  S6.mp3 — “Okay—think it over and ping me tomorrow.”
    Audio only, no challenge; just a Continue button. */
scene24_call1f_outro: {
  type: "audio-scramble",      // reuse the same loader
  disableSpeech: true,
  awardOnEnter: 1,
  audioSrc: "audio/S6.mp3",
  text: "Listen to the seller’s closing line, then continue.",
  // no scramble/ correct → loader should just show audio and a Continue
  noScramble: true,            // <— use this flag in your loader
  next: "scene24_call2_intro",
  endings: {
    wrong: "scene24_call2_intro",   // not really used
    timeout: "scene24_call2_intro"
  },
  timer: 0,
  suppressHub: true
},



/* ------- CALL 2: “The Counteroffer” ------- */

scene24_call2_intro: {
  type: "text",
  awardOnEnter: 2,
  suppressHub: true,
  text: "A day later, you call again with a number in mind.\nListen to each seller line and choose the buyer response that actually moves the negotiation forward.",
  choices: [{ text: "Continue", next: "scene24_call2_s7" }]
},

/* ---------- S7 ---------- */
scene24_call2_s7: {
  type: "interaction-audio-mc",
  suppressHub: true,
  awardOnEnter: 2,
  audio: "audio/S7.mp3",        // OPTIONAL – if you want the seller’s audio to play
  text: "Seller (S7): “Hey, welcome back. Where are you landing on price?”",
  options: [
    "I checked and it´s really not worth more than a thousand.",
    "Thanks for waiting. One thousand seems a fair price to me.",
    "Thanks for the wait. I was thinking along the lines of a thousand."
  ],
  correct: 2,
  shuffleOptions: true,
  timer: 20,
  next: "scene24_call2_s8",
  endings: { wrong: "scene24_call2_restart", timeout: "scene24_call2_restart" }
},

/* ---------- S8 ---------- */
scene24_call2_s8: {
  type: "interaction-audio-mc",
  suppressHub: true,
  awardOnEnter: 2,
  audio: "audio/S8.mp3",
  text: "Seller (S8): “A thousand is lower than I hoped.”",
  options: [
    "If you’d prefer, we can leave it open and I’ll check back next week — no pressure either way.",
    "Since you’re firm on price, maybe you could include the warranty transfer to balance it out?",
    "I realize that’s less than you expected, but if I collect today, would that help bridge the gap?"
  ],
  correct: 2,
  shuffleOptions: true,
  timer: 20,
  next: "scene24_call2_s9",
  endings: { wrong: "scene24_call2_restart", timeout: "scene24_call2_restart" }
},

/* ---------- S9 ---------- */
scene24_call2_s9: {
  type: "interaction-audio-mc",
  suppressHub: true,
  awardOnEnter: 2,
  audio: "audio/S9.mp3",
  text: "Seller (S9): “Possibly. What exactly are you proposing?”",
  options: [
    "How about eleven hundred even — transfer on pickup?",
    "Would you mind revising your offer closer to a thousand then?",
    "Let’s keep your price; I’ll decide later."
  ],
  correct: 0,
  shuffleOptions: true,
  timer: 20,
  next: "scene24_call2_s10",
  endings: { wrong: "scene24_call2_restart", timeout: "scene24_call2_restart" }
},

/* ---------- S10 ---------- */
scene24_call2_s10: {
  type: "interaction-audio-mc",
  suppressHub: true,
  awardOnEnter: 2,
  audio: "audio/S10.mp3",
  text: "Seller (S10): “You’re really pushing it.”",
  options: [
    "Say we met around your number, and I bring cash today — would that feel fair?",
    "I’m aiming for a midpoint that reflects the laptop’s condition and warranty coverage.",
    "I just want to be sure the offer reflects market value and your expectations equally."
  ],
  correct: 1,
  shuffleOptions: true,
  timer: 20,
  next: "scene24_call2_s11",
  endings: { wrong: "scene24_call2_restart", timeout: "scene24_call2_restart" }
},

/* ---------- S11 (NO CHALLENGE) ---------- */
scene24_call2_s11: {
  type: "interaction-audio-mc",
  suppressHub: true,
  awardOnEnter: 2,
  audio: "audio/S11.mp3",
  text: "Seller (S11): “Hmm. Alright, I’ll think about that.”\n\nChoose the most natural closing response.",
  options: [
    "That is the fair thing to do.",
    "Thank you so much, that sounds like what you should do.",
    "Thanks. That is much appreciated."
  ],
  correct: 2,               // ✔ “Thanks. That is much appreciated.”
  shuffleOptions: true,
  timer: 20,
  next: "scene24_call2_s12",
  endings: { wrong: "scene24_call2_restart", timeout: "scene24_call2_restart" }
},

/* ---------- S12 — audio + trivial MC to continue ---------- */
scene24_call2_s12: {
  type: "audio-scramble",     // reuse audio-scramble loader
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 3,
  audioSrc: "audio/S12.mp3",
  text: "Seller (S12): “Appreciated — let’s stay in touch.”\n\nCall 2 complete — you made a strong midpoint case.",
  noScramble: true,           // loader should just play audio + show Continue
  next: "scene24_call3_intro",
  endings: {
    wrong: "scene24_call3_intro",
    timeout: "scene24_call3_intro"
  },
  timer: 0
},

/* ---------- Restart (wrong or timeout) ---------- */
scene24_call2_restart: {
  type: "text",
  suppressHub: true,
  text: "That answer didn’t move the negotiation forward.\nTry Call 2 again.",
  choices: [{ text: "Restart Call 2", next: "scene24_call2_intro" }]
},

/* ---------- TRANSITION 3 — Tie-in before Call 3 ---------- */

scene24_call3_intro: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 1,
  text:
    "The seller messages back — they’re almost convinced.\n\n" +
    "This time, the conversation happens in real time: both voices are audio.\n\n" +
    "Task: Listen and tap the spoken reply that keeps the negotiation balanced.\n" +
    "Your choice will decide how the deal ends.",
  choices: [{ text: "Begin Call 3", next: "scene24_call3_s13" }]
},

/* ---------- CALL 3 — Stage 1 (S13 + B1/B2/B3) ---------- */
/* Correct → positive path (Stage 2A); wrong/timeout → recovery path (Stage 2B). */

/* ---------- CALL 3 — Stage 1 (S13 + B1/B2/B3) ---------- */
/* Balanced reply → Stage 2A ; other replies → Stage 2B. */

scene24_call3_s13: {
  type: "interaction-audio-mc",
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 2,
  text: "Call 3 – Stage 1. Listen and choose the reply that keeps things flexible but safe.",
  audio: "audio/S13.mp3", // "Eleven hundred works, but I’d like payment upfront."
  options: [
    "audio/B3.mp3", // index 0 – too trusting (buy now, not ideal)
    "audio/B2.mp3", // index 1 – too rigid
    "audio/B1.mp3"  // index 2 – balanced ✅
  ],
  correct: 2,          // B1 is still the "best" answer (Stage 2A path)
  shuffleOptions: true,
  timer: 18,

  // ✅ NEW: special branch for B3 (original index 0)
  branchOnOption: {
    0: "scene24_call3_good_s16"   // "medium" outcome path
  },

  // Default branching:
  // Correct (B1) → Stage 2A ; wrong/timeout → Stage 2B
  next: "scene24_call3_s14A",
  endings: {
    wrong:   "scene24_call3_s15B",
    timeout: "scene24_call3_s15B"
  }
},


/* ---------- CALL 3 — Stage 2A (positive path: S14 + B4/B5/B6) ---------- */
/* Correct → closing (good path); wrong/timeout → lost path. */

scene24_call3_s14A: {
  type: "interaction-audio-mc",
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 2,
  text: "Call 3 – Stage 2A. Confirm the pickup in a way that supports the agreement.",
  audio: "audio/S14.mp3", // "That’s reasonable. Can you pick it up this afternoon?"
  options: [
    "audio/B5.mp3", // Flexible / vague
    "audio/B4.mp3", // Clear 4 o’clock plan ✅
    "audio/B6.mp3"  // Move to evening
  ],
  correct: 1,
  shuffleOptions: true,
  timer: 18,
  next: "scene24_call3_good_s16",
  endings: {
    wrong:   "scene24_call3_lost_s17",
    timeout: "scene24_call3_lost_s17"
  }
},

/* ---------- CALL 3 — Stage 2B (recovery path: S15 + B7/B8/B9) ---------- */
/* Correct → closing (salvaged); wrong/timeout → lost path. */

scene24_call3_s15B: {
  type: "interaction-audio-mc",
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 2,
  text: "Call 3 – Stage 2B. Rescue the deal with a constructive alternative.",
  audio: "audio/S15.mp3", // "Hmm… maybe this isn’t going to work."
  options: [
    "audio/B8.mp3", // Delay to next week
    "audio/B7.mp3", // Keep price, add delivery to close today ✅
    "audio/B9.mp3"  // Step back / stay open
  ],
  correct: 1,
  shuffleOptions: true,
  timer: 18,
  next: "scene24_call3_good_s16",
  endings: {
    wrong:   "scene24_call3_lost_s17",
    timeout: "scene24_call3_lost_s17"
  }
},

/* ---------- GOOD PATH — Closing sequence (S16 + B10 + SYS1) ---------- */
/* Audio-only, no challenge; ends in a reflective outcome screen. */

scene24_call3_good_s16: {
  type: "audio-scramble",   // audio-only via your existing loader
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 2,
  audioSrc: "audio/S16.mp3", // "Deal. I’ll send the invoice tonight."
  text: "Listen to the seller’s final acceptance.",
  noScramble: true,
  timer: 0,
  next: "scene24_call3_good_b10",
  endings: {
    wrong:   "scene24_call3_good_b10",
    timeout: "scene24_call3_good_b10"
  }
},

scene24_call3_good_b10: {
  type: "audio-scramble",
  disableSpeech: true,
  suppressHub: true,
  awardOnEnter: 1,
  audioSrc: "audio/B10.mp3", // Buyer’s closing line
  text: "Listen to your closing reply.",
  noScramble: true,
  timer: 0,
  next: "scene24_call3_good_outcome",
  endings: {
    wrong:   "scene24_call3_good_outcome",
    timeout: "scene24_call3_good_outcome"
  }
},



scene24_call3_good_outcome: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 3,
  text:
    "Call 3 complete — you closed the deal.\n\n" +
    "How do you feel about the outcome?",
  choices: [
    {
      text: "I’m not completely satisfied — I want to negotiate it better.",
      next: "scene24_call3_intro"   // treat as a 'soft fail' → replay Call 3
    },
    {
      text: "I got a good deal — I’m happy to move on.",
      next: "scene_salary_intro"  // hook this to your next major scene
    }
  ]
},

/* ---------- LOST PATH — Deal lost (S17 + SYS2) ---------- */
/* Always leads back to a restart, no loops. */

scene24_call3_lost_s17: {
  type: "audio-scramble",      // audio-only: seller ends the deal
  disableSpeech: true,
  awardOnEnter: 1,
  suppressHub: true,
  audioSrc: "audio/S17.mp3",   // "Let’s drop it — it seems we can’t align."
  text: "Listen to the seller’s decision to walk away.",
  noScramble: true,
  timer: 0,
  next: "scene24_call3_restart",
  endings: {
    wrong:   "scene24_call3_restart",
    timeout: "scene24_call3_restart"
  }
},



scene24_call3_restart: {
  type: "text",
  suppressHub: true,
  text:
    "The deal fell through this time.\n\n" +
    "Try Call 3 again and choose replies that keep the seller engaged and moving toward agreement.",
  choices: [
    { text: "Restart Call 3", next: "scene24_call3_intro" }
  ]
},

scene_salary_intro: {
  type: "text",
  image: "images/9.png",
  awardOnEnter: 3,
  suppressHub: true,
  text:
    "Video Challenge — Salary Negotiation\n\n" +
    "You’re meeting with HR to discuss your salary after taking on extra responsibilities.\n" +
    "Your language needs to be clear, calm and persuasive — not desperate, and not vague.\n\n" +
    "Watch the HR technician’s video clips and choose the reply that:\n" +
    "• Links your request to concrete performance.\n" +
    "• Uses softeners (would / might / could) without sounding weak.\n" +
    "• Avoids demanding big, unconditional jumps.\n\n" +
    "A balanced path leads to an eight-percent raise with clear conditions.\n" +
    "Overly soft or overly pushy choices slide you into partial or failed outcomes.",
  choices: [
    { text: "Start Salary Negotiation", next: "scene_salary_v1" }
    
  ]
},
/* ========== SALARY NEGOTIATION – VIDEO CHALLENGE ========== */
/* Entry: hook your salary intro scene → next: "scene_salary_v1" */

/* ---- V1: Opening – how to raise the topic (1A.mp4) ---- */

/* ============ SALARY NEGOTIATION – VIDEO CHALLENGE ============ */
/* Tie-in scene should lead into scene_salary_v1 */

/* ---- Step 1: Opening (1A.mp4) ---- */
scene_salary_v1: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/1A.mp4",   // HR: opening question
  timer: 0,                    // no timer, or set e.g. 18 if you want
  shuffleOptions: true,
  // learner chooses HOW to bring up salary → branches to 2G / 2M / 2P
  choices: [
    {
      // 🟢 persuasive
      text: "Would it be possible to review my salary bracket this quarter? Given the additional accounts I’ve taken on, it might make sense to align compensation with the role.",
      next: "scene_salary_2G"
    },
    {
      // 🟡 vague / softer
      text: "Perhaps we could revisit my salary soon, since the workload has grown quite a bit and I’d like to make sure everything stays fair.",
      next: "scene_salary_2M"
    },
    {
      // 🔴 self-focused / heavy
      text: "I feel I should have an immediate adjustment, as the current figure doesn’t really correspond to my expanded duties.",
      next: "scene_salary_2P"
    }
  ]
},

/* ---- Step 2: HR reaction to opening (2G / 2M / 2P) + second choice set ---- */

scene_salary_2G: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/2G.mp4",   // “That’s a well-framed request…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      // 🟡 ten percent soon
      text: "I was hoping for something in the ten-percent range, perhaps as early as next month if budgets allow.",
      next: "scene_salary_3M"
    },
    {
      // 🟢 conditional next-quarter raise
      text: "Say I were to propose a seven-to-ten-percent adjustment next quarter, provided I take on the two new clients — would that sound workable?",
      next: "scene_salary_3G"
    },
    {
      // 🔴 fifteen percent now
      text: "I feel an increase of about fifteen percent now would better reflect market levels for this role.",
      next: "scene_salary_3P"
    }
  ]
},

scene_salary_2M: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/2M.mp4",   // “I see what you mean…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "I was hoping for something in the ten-percent range, perhaps as early as next month if budgets allow.",
      next: "scene_salary_3M"
    },
    {
      text: "Say I were to propose a seven-to-ten-percent adjustment next quarter, provided I take on the two new clients — would that sound workable?",
      next: "scene_salary_3G"
    },
    {
      text: "I feel an increase of about fifteen percent now would better reflect market levels for this role.",
      next: "scene_salary_3P"
    }
  ]
},

scene_salary_2P: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/2P.mp4",   // “I understand your point…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "I was hoping for something in the ten-percent range, perhaps as early as next month if budgets allow.",
      next: "scene_salary_3M"
    },
    {
      text: "Say I were to propose a seven-to-ten-percent adjustment next quarter, provided I take on the two new clients — would that sound workable?",
      next: "scene_salary_3G"
    },
    {
      text: "I feel an increase of about fifteen percent now would better reflect market levels for this role.",
      next: "scene_salary_3P"
    }
  ]
},

/* ---- Step 3: HR reaction to proposal (3G / 3M / 3P) + third choice set ---- */

scene_salary_3G: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/3G.mp4",   // “That sounds constructive…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      // 🟢 strong conditional offer
      text: "How about I take on the onboarding of two additional clients if we can agree on an eight-percent increase next quarter?",
      next: "scene_salary_4G"
    },
    {
      // 🟡 softer / later review
      text: "Perhaps I could handle one or two more accounts, and then we could review the figures together later in the year.",
      next: "scene_salary_4M"
    },
    {
      // 🔴 expectation-heavy
      text: "I’d certainly continue working at this pace, but I would expect the company to recognise that with an appropriate raise soon.",
      next: "scene_salary_4P"
    }
  ]
},

scene_salary_3M: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/3M.mp4",   // “That’s one possibility…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "How about I take on the onboarding of two additional clients if we can agree on an eight-percent increase next quarter?",
      next: "scene_salary_4G"
    },
    {
      text: "Perhaps I could handle one or two more accounts, and then we could review the figures together later in the year.",
      next: "scene_salary_4M"
    },
    {
      text: "I’d certainly continue working at this pace, but I would expect the company to recognise that with an appropriate raise soon.",
      next: "scene_salary_4P"
    }
  ]
},

scene_salary_3P: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/3P.mp4",   // “I appreciate the effort, but…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "How about I take on the onboarding of two additional clients if we can agree on an eight-percent increase next quarter?",
      next: "scene_salary_4G"
    },
    {
      text: "Perhaps I could handle one or two more accounts, and then we could review the figures together later in the year.",
      next: "scene_salary_4M"
    },
    {
      text: "I’d certainly continue working at this pace, but I would expect the company to recognise that with an appropriate raise soon.",
      next: "scene_salary_4P"
    }
  ]
},

/* ---- Step 4: HR close (4G / 4M / 4P) + FINAL choice set ---- */

scene_salary_4G: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/4G.mp4",   // “Excellent. I can prepare the paperwork…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      // 🟡 push for 10%
      text: "Could we make it around ten percent next quarter and link it to the onboarding results?",
      next: "scene_salary_5R"
    },
    {
      // 🔴 no conditions
      text: "I feel ten percent without formal conditions would keep things straightforward for both sides.",
      next: "scene_salary_5F"
    },
    {
      // 🟢 accepts 8% with clear condition
      text: "If we confirm an eight-percent increase next quarter provided I onboard both clients by mid-term, I can sign off today.",
      next: "scene_salary_5S"
    }
  ]
},

scene_salary_4M: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/4M.mp4",   // “That approach could work in principle…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "Could we make it around ten percent next quarter and link it to the onboarding results?",
      next: "scene_salary_5R"
    },
    {
      text: "I feel ten percent without formal conditions would keep things straightforward for both sides.",
      next: "scene_salary_5F"
    },
    {
      text: "If we confirm an eight-percent increase next quarter provided I onboard both clients by mid-term, I can sign off today.",
      next: "scene_salary_5S"
    }
  ]
},

scene_salary_4P: {
  type: "video-choice",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/4P.mp4",   // “Let’s revisit this next quarter…”
  timer: 0,
  shuffleOptions: true,
  choices: [
    {
      text: "Could we make it around ten percent next quarter and link it to the onboarding results?",
      next: "scene_salary_5R"
    },
    {
      text: "I feel ten percent without formal conditions would keep things straightforward for both sides.",
      next: "scene_salary_5F"
    },
    {
      text: "If we confirm an eight-percent increase next quarter provided I onboard both clients by mid-term, I can sign off today.",
      next: "scene_salary_5S"
    }
  ]
},

/* ---- Step 5: Outcomes (5S / 5R / 5F) ---- */

scene_salary_5S: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 4,
  videoSrc: "videos/5S.mp4",   // SUCCESS outro line
  next: "scene_salary_5S_text"
},
scene_salary_5S_text: {
  type: "text",
  suppressHub: true,
  text:
    "🎉 Negotiation Successful — Your tact and clarity secured an agreement.\n\n" +
    "You linked performance to conditions and closed on an 8% raise.",
  choices: [
    { text: "Next Challenge", next: "scene_supplier_intro" }
  ]
},

scene_salary_5R: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 3,
  videoSrc: "videos/5R.mp4",   // RAW-DEAL outro
  next: "scene_salary_5R_text"
},
scene_salary_5R_text: {
  type: "text",
  suppressHub: true,
  text:
    "⚖️ Partial Agreement — You reached a workable compromise.\n\n" +
    "Try again if you’d like to aim for a stronger outcome.",
  choices: [
    { text: "Back to Salary Start", next: "scene_salary_v1" }
    
  ]
},

scene_salary_5F: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 1,
  videoSrc: "videos/5F.mp4",   // FAIL outro
  next: "scene_salary_5F_text"
},
scene_salary_5F_text: {
  type: "text",
  suppressHub: true,
  text:
    "❌ Negotiation Failed — The discussion was paused.\n\n" +
    "Review your phrasing and try again from the start.",
  choices: [
    { text: "Retry Salary Negotiation", next: "scene_salary_v1" }
    
  ]
},
/* ========= SUPPLIER CONTRACT RENEWAL – TIE-IN ========= */

scene_supplier_intro: {
  type: "text",
  image: "images/10.png",
  suppressHub: true,
  awardOnEnter: 0,
  text:
    "Supplier Contract Renewal — Video Challenge\n\n" +
    "You’ve just finished a successful salary negotiation.\n" +
    "Now you’re on the client side of a SaaS renewal call with your account manager.\n\n" +
    "Goal: reach a renewal that feels fair, sustainable, and value-balanced.\n" +
    "Watch each short clip and choose the reply that keeps the negotiation cooperative and constructive.\n\n" +
    "Tap Continue to join the call.",
  choices: [
    { text: "Continue", next: "scene_supplier_v1_C1A" }
  ]
},

/* ========= STAGE 1 — C1A (opening) ========= */

scene_supplier_v1_C1A: {
  type: "video-choice",
  videoSrc: "videos/C1A.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 1 — Opening. Watch Elena, then choose how you’d open the renewal discussion.",

  // C1A.mp4 — “How would you like to approach the renewal this time?”
  choices: [
    {
      // 🟡 tentative
      text: "Perhaps we could look at the renewal soon, since we’ve been steady users and would like to keep things fair for the next term.",
      next: "scene_supplier_v2_C2M"  // tentative start
    },
    {
      // 🔴 cautious / budget-focused
      text: "I feel the increase is a bit higher than expected, and it may not align perfectly with our current budget plans.",
      next: "scene_supplier_v2_C2P"  // budget concern
    },
    {
      // 🟢 persuasive / value-based
      text: "Would it be possible to review the renewal rate this quarter? Given our consistent usage and growth, maintaining the same pricing might make good business sense for both sides.",
      next: "scene_supplier_v2_C2G"  // best start
    }
  ]
},

/* ========= STAGE 2 — C2G / C2M / C2P + second choice set ========= */

scene_supplier_v2_C2G: {
  type: "video-choice",
  videoSrc: "videos/C2G.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 2 — Elena responds positively. Choose how you frame the rate discussion.",

  // After C2G, use second choice set → 3G / 3M / 3P
  choices: [
    {
      // 🔴 self-protective / static
      text: "I’d prefer to stay at the same rate for now, given everything we’ve invested, unless there’s a compelling reason to change it.",
      next: "scene_supplier_v3_3P"
    },
    {
      // 🟡 phased increase
      text: "Maybe there’s a way to smooth the increase — say, a smaller adjustment phased in over time?",
      next: "scene_supplier_v3_3M"
    },
    {
      // 🟢 conditional value offer
      text: "If you could extend the current rate for a two-year commitment, we’d be ready to confirm renewal right away.",
      next: "scene_supplier_v3_3G"
    }
  ]
},

scene_supplier_v2_C2M: {
  type: "video-choice",
  videoSrc: "videos/C2M.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 2 — Elena asks what you’d like to review. Choose your next move.",

  // Same second choice set → 3G / 3M / 3P
  choices: [
    {
      text: "I’d prefer to stay at the same rate for now, given everything we’ve invested, unless there’s a compelling reason to change it.",
      next: "scene_supplier_v3_3P"
    },
    {
      text: "Maybe there’s a way to smooth the increase — say, a smaller adjustment phased in over time?",
      next: "scene_supplier_v3_3M"
    },
    {
      text: "If you could extend the current rate for a two-year commitment, we’d be ready to confirm renewal right away.",
      next: "scene_supplier_v3_3G"
    }
  ]
},

scene_supplier_v2_C2P: {
  type: "video-choice",
  videoSrc: "videos/C2P.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 2 — Elena acknowledges your budget concern. Choose how you position the next step.",

  choices: [
    {
      text: "I’d prefer to stay at the same rate for now, given everything we’ve invested, unless there’s a compelling reason to change it.",
      next: "scene_supplier_v3_3P"
    },
    {
      text: "Maybe there’s a way to smooth the increase — say, a smaller adjustment phased in over time?",
      next: "scene_supplier_v3_3M"
    },
    {
      text: "If you could extend the current rate for a two-year commitment, we’d be ready to confirm renewal right away.",
      next: "scene_supplier_v3_3G"
    }
  ]
},

/* ========= STAGE 3 — 3G / 3M / 3P + third choice set ========= */

scene_supplier_v3_3G: {
  type: "video-choice",
  videoSrc: "videos/C3G.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 3 — Elena reacts to your conditional offer. Choose how you refine the proposal.",

  // Third choice set → C4G / C4M / C4P
  choices: [
    {
      // 🟡 feature cut
      text: "Maybe we could adjust the plan slightly — for example, keep core features and skip some advanced modules to maintain the price point.",
      next: "scene_supplier_v4_C4M"
    },
    {
      // 🔴 pressure
      text: "We’d need a stronger reason to renew at the higher rate; otherwise, it will be difficult to justify continuing.",
      next: "scene_supplier_v4_C4P"
    },
    {
      // 🟢 value-balanced
      text: "Perhaps we could add two additional seats under the same plan if the rate remains steady — that would balance value on both sides.",
      next: "scene_supplier_v4_C4G"
    }
  ]
},

scene_supplier_v3_3M: {
  type: "video-choice",
  videoSrc: "videos/C3M.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 3 — Elena explores a phased option. Choose how you shape the proposal.",

  choices: [
    {
      text: "Maybe we could adjust the plan slightly — for example, keep core features and skip some advanced modules to maintain the price point.",
      next: "scene_supplier_v4_C4M"
    },
    {
      text: "We’d need a stronger reason to renew at the higher rate; otherwise, it will be difficult to justify continuing.",
      next: "scene_supplier_v4_C4P"
    },
    {
      text: "Perhaps we could add two additional seats under the same plan if the rate remains steady — that would balance value on both sides.",
      next: "scene_supplier_v4_C4G"
    }
  ]
},

scene_supplier_v3_3P: {
  type: "video-choice",
  videoSrc: "videos/C3P.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Stage 3 — Elena pushes back on a static rate. Choose how you respond.",

  choices: [
    {
      text: "Maybe we could adjust the plan slightly — for example, keep core features and skip some advanced modules to maintain the price point.",
      next: "scene_supplier_v4_C4M"
    },
    {
      text: "We’d need a stronger reason to renew at the higher rate; otherwise, it will be difficult to justify continuing.",
      next: "scene_supplier_v4_C4P"
    },
    {
      text: "Perhaps we could add two additional seats under the same plan if the rate remains steady — that would balance value on both sides.",
      next: "scene_supplier_v4_C4G"
    }
  ]
},

/* ========= STAGE 4 — C4G / C4M / C4P + FINAL CHOICE SET ========= */

scene_supplier_v4_C4G: {
  type: "video-choice",
  videoSrc: "videos/C4G.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Final stage — Elena likes your value-balanced idea. Choose how you close.",

  // Final choice set → C5R / C5S / C5F
  choices: [
    {
      // 🟡 partial / cautious
      text: "Could you send a revised offer reflecting those options? I’ll review it internally and follow up.",
      next: "scene_supplier_5R_video"
    },
    {
      // 🟢 best close
      text: "If we can lock in the current rate for a two-year term with the two additional seats included, I can confirm renewal today.",
      next: "scene_supplier_5S_video"
    },
    {
      // 🔴 pause / potential loss
      text: "It might be better to pause for now while we evaluate other solutions on the market.",
      next: "scene_supplier_5F_video"
    }
  ]
},

scene_supplier_v4_C4M: {
  type: "video-choice",
  videoSrc: "videos/C4M.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Final stage — Elena is open but cautious. Choose your next step.",

  choices: [
    {
      text: "Could you send a revised offer reflecting those options? I’ll review it internally and follow up.",
      next: "scene_supplier_5R_video"
    },
    {
      text: "If we can lock in the current rate for a two-year term with the two additional seats included, I can confirm renewal today.",
      next: "scene_supplier_5S_video"
    },
    {
      text: "It might be better to pause for now while we evaluate other solutions on the market.",
      next: "scene_supplier_5F_video"
    }
  ]
},

scene_supplier_v4_C4P: {
  type: "video-choice",
  videoSrc: "videos/C4P.mp4",
  suppressHub: true,
  awardOnEnter: 2,
  timer: 20,
  shuffleOptions: true,
  timeoutNext: "scene_supplier_timeout",
  text: "Final stage — Elena responds to your soft ultimatum. Choose the outcome.",

  choices: [
    {
      text: "Could you send a revised offer reflecting those options? I’ll review it internally and follow up.",
      next: "scene_supplier_5R_video"
    },
    {
      text: "If we can lock in the current rate for a two-year term with the two additional seats included, I can confirm renewal today.",
      next: "scene_supplier_5S_video"
    },
    {
      text: "It might be better to pause for now while we evaluate other solutions on the market.",
      next: "scene_supplier_5F_video"
    }
  ]
},

/* ========= OUTCOMES – C5S / C5R / C5F ========= */

scene_supplier_5S_video: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 4,
  videoSrc: "videos/C5S.mp4",   // “Perfect — I’ll update the paperwork today…”
  next: "scene_supplier_5S_text"
},

scene_supplier_5S_text: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 4,
  text:
    "🎉 Negotiation Successful\n\n" +
    "You secured a renewal that balances price, value, and commitment.\n" +
    "Your framing stayed cooperative and business-focused.\n\n" +
    "From here you can head back to the hub or move on to the next challenge.",
  choices: [
    { text: "Go to next challenge", next: "scene_gf_intro" }
  ]
},

scene_supplier_5R_video: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 2,
  videoSrc: "videos/C5R.mp4",   // “I’ll send the adjusted proposal shortly…”
  next: "scene_supplier_5R_text"
},

scene_supplier_5R_text: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 1,
  text:
    "⚖️ Partial Agreement\n\n" +
    "You reached a workable middle ground, but left value on the table.\n" +
    "Try the scenario again if you’d like to aim for a stronger outcome.",
  choices: [
    { text: "Try again", next: "scene_supplier_v1_C1A" }
  ]
},

scene_supplier_5F_video: {
  type: "video",
  suppressHub: true,
  awardOnEnter: 0,
  videoSrc: "videos/C5F.mp4",   // “I understand. I hope we can reconnect…”
  next: "scene_supplier_5F_text"
},

scene_supplier_5F_text: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 0,
  text:
    "❌ Negotiation Failed\n\n" +
    "The renewal stalled. Review how you framed risk, value, and commitment, then try again from a different starting tone.",
  choices: [
    { text: "Try again", next: "scene_supplier_v1_C1A" }
  ]
},

/* ========= GENERIC TIMEOUT HANDLER ========= */

scene_supplier_timeout: {
  type: "text",
  suppressHub: true,
  text:
    "Time’s up.\n\n" +
    "In live negotiations, it helps to respond clearly and concisely.\n" +
    "Restart the Supplier Renewal video challenge when you’re ready.",
  choices: [
    { text: "Restart Supplier Renewal", next: "scene_supplier_v1_C1A" }
  ]
},

/* ============ MOVIE NIGHT – GIRLFRIEND BRANCH ============ */

/* Tie-in scene (image 11.png) */
scene_gf_intro: {
  type: "text",
  image: "images/11.png",
  text:
    "Movie Night – Negotiating the Genre\n\n" +
    "It’s movie night and your partner is gently questioning your endless spy-movie streak.\n" +
    "Your goal: keep the tone playful but persuasive, and end up watching something you can both enjoy.\n\n" +
    "Watch each short video and choose the reply that keeps the negotiation warm, cooperative, " +
    "and a little bit clever.",
  choices: [
    { text: "Start movie-night negotiation", next: "scene_gf_v1" }
  ]
},

/* Helper timeout scene – any time limit breach returns here */
scene_gf_timeout: {
  type: "text",
  suppressHub: true,
  text:
    "Time’s up.\n\n" +
    "Movie night moves fast — try again and choose the replies that keep things light and cooperative.",
  choices: [
    { text: "Restart from first question", next: "scene_gf_v1" }
  ]
},

/* ---------- STEP 1: GF_1A.mp4 ---------- */

scene_gf_v1: {
  type: "video-choice",
  videoSrc: "videos/GF_1A.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "You’re right, maybe something story-driven for once — say we go for a drama instead of a car chase?",
  choices: [
    {
      // 🟢 → GF_2G
      text: "You’re right, maybe something story-driven for once — say we go for a drama instead of a car chase?",
      next: "scene_gf_2G"
    },
    {
      // 🔴 → GF_2P
      text: "I like what I like; why fix what isn’t broken?",
      next: "scene_gf_2P"
    },
    {
      // 🟡 → GF_2M
      text: "I don’t mind changing, but only if we can pick something funny afterward.",
      next: "scene_gf_2M"
    }
  ]
},

/* ---------- STEP 2: GF_2G / 2M / 2P (same choice set from each) ---------- */

scene_gf_2G: {
  type: "video-choice",
  videoSrc: "videos/GF_2G.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "How about if we compromise — one of those clever comedies that still has a plot?",
  choices: [
    {
      // 🟡 → GF_3M
      text: "If I were to choose, maybe something half-serious, half-silly — balance, right?",
      next: "scene_gf_3M"
    },
    {
      // 🔴 → GF_3P
      text: "Fine, pick whatever makes you happy; I’ll just check emails.",
      next: "scene_gf_3P"
    },
    {
      // 🟢 → GF_3G
      text: "How about if we compromise — one of those clever comedies that still has a plot?",
      next: "scene_gf_3G"
    }
  ]
},

scene_gf_2M: {
  type: "video-choice",
  videoSrc: "videos/GF_2M.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "How about if we compromise — one of those clever comedies that still has a plot?",
  choices: [
    {
      text: "If I were to choose, maybe something half-serious, half-silly — balance, right?",
      next: "scene_gf_3M"
    },
    {
      text: "Fine, pick whatever makes you happy; I’ll just check emails.",
      next: "scene_gf_3P"
    },
    {
      text: "How about if we compromise — one of those clever comedies that still has a plot?",
      next: "scene_gf_3G"
    }
  ]
},

scene_gf_2P: {
  type: "video-choice",
  videoSrc: "videos/GF_2P.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "How about if we compromise — one of those clever comedies that still has a plot?",
  choices: [
    {
      text: "If I were to choose, maybe something half-serious, half-silly — balance, right?",
      next: "scene_gf_3M"
    },
    {
      text: "Fine, pick whatever makes you happy; I’ll just check emails.",
      next: "scene_gf_3P"
    },
    {
      text: "How about if we compromise — one of those clever comedies that still has a plot?",
      next: "scene_gf_3G"
    }
  ]
},

/* ---------- STEP 3: GF_3G / 3M / 3P ---------- */

scene_gf_3G: {
  type: "video-choice",
  videoSrc: "videos/GF_3G.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "If we were to try something new, how about a random top pick — no arguing, pure chance?",
  choices: [
    {
      // 🟢 → GF_4G
      text: "If we were to try something new, how about a random top pick — no arguing, pure chance?",
      next: "scene_gf_4G"
    },
    {
      // 🔴 → GF_4P
      text: "You know what, forget it. Watch what you want.",
      next: "scene_gf_4P"
    },
    {
      // 🟡 → GF_4M
      text: "Maybe something based on a book — at least then we can claim it’s cultural.",
      next: "scene_gf_4M"
    }
  ]
},

scene_gf_3M: {
  type: "video-choice",
  videoSrc: "videos/GF_3M.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "If we were to try something new, how about a random top pick — no arguing, pure chance?",
  choices: [
    {
      text: "If we were to try something new, how about a random top pick — no arguing, pure chance?",
      next: "scene_gf_4G"
    },
    {
      text: "You know what, forget it. Watch what you want.",
      next: "scene_gf_4P"
    },
    {
      text: "Maybe something based on a book — at least then we can claim it’s cultural.",
      next: "scene_gf_4M"
    }
  ]
},

scene_gf_3P: {
  type: "video-choice",
  videoSrc: "videos/GF_3P.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "If we were to try something new, how about a random top pick — no arguing, pure chance?",
  choices: [
    {
      text: "If we were to try something new, how about a random top pick — no arguing, pure chance?",
      next: "scene_gf_4G"
    },
    {
      text: "You know what, forget it. Watch what you want.",
      next: "scene_gf_4P"
    },
    {
      text: "Maybe something based on a book — at least then we can claim it’s cultural.",
      next: "scene_gf_4M"
    }
  ]
},

/* ---------- STEP 4: GF_4G / 4M / 4P ---------- */

scene_gf_4G: {
  type: "video-choice",
  videoSrc: "videos/GF_4G.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "Isn’t that proof that we’re both just passionate negotiators with taste?",
  choices: [
    {
      // 🟡 → Raw deal
      text: "Maybe I’m sulking, but only because I care about quality cinema.",
      next: "scene_gf_5R"
    },
    {
      // 🔴 → Fail
      text: "Call it self-defence — I know how this ends.",
      next: "scene_gf_5F"
    },
    {
      // 🟢 → Success
      text: "Isn’t that proof that we’re both just passionate negotiators with taste?",
      next: "scene_gf_5S"
    }
  ]
},

scene_gf_4M: {
  type: "video-choice",
  videoSrc: "videos/GF_4M.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "Isn’t that proof that we’re both just passionate negotiators with taste?",
  choices: [
    {
      text: "Maybe I’m sulking, but only because I care about quality cinema.",
      next: "scene_gf_5R"
    },
    {
      text: "Call it self-defence — I know how this ends.",
      next: "scene_gf_5F"
    },
    {
      text: "Isn’t that proof that we’re both just passionate negotiators with taste?",
      next: "scene_gf_5S"
    }
  ]
},

scene_gf_4P: {
  type: "video-choice",
  videoSrc: "videos/GF_4P.mp4",
  timer: 18,
  shuffleOptions: true,
  timeoutNext: "scene_gf_timeout",
  speechRightText:
    "Isn’t that proof that we’re both just passionate negotiators with taste?",
  choices: [
    {
      text: "Maybe I’m sulking, but only because I care about quality cinema.",
      next: "scene_gf_5R"
    },
    {
      text: "Call it self-defence — I know how this ends.",
      next: "scene_gf_5F"
    },
    {
      text: "Isn’t that proof that we’re both just passionate negotiators with taste?",
      next: "scene_gf_5S"
    }
  ]
},

/* ---------- STEP 5: Outcomes (GF_5S / 5R / 5F) ---------- */

scene_gf_5S: {
  type: "video",
  videoSrc: "videos/GF_5S.mp4",
  awardOnEnter: 6,
  next: "scene_gf_5S_text"
},

scene_gf_5S_text: {
  type: "text",
  suppressHub: true,
  text:
    "Movie Night Result: ✅ Smooth Negotiation\n\n" +
    "You kept things playful, flexible, and respectful — and you’re still on the same couch with a movie you can both enjoy.",
  choices: [
    { text: "Play next challenge", next: "scene_bf_intro" }
  ]
},

scene_gf_5R: {
  type: "video",
  videoSrc: "videos/GF_5R.mp4",
  awardOnEnter: 3,
  next: "scene_gf_5R_text"
},

scene_gf_5R_text: {
  type: "text",
  suppressHub: true,
  text:
    "Movie Night Result: ⚖️ Partial Win\n\n" +
    "You stayed on decent terms, but the negotiation could have been smoother.\n" +
    "Try again from the first question to aim for a more balanced outcome.",
  choices: [
    { text: "Replay movie-night negotiation", next: "scene_gf_v1" }
  ]
},

scene_gf_5F: {
  type: "video",
  videoSrc: "videos/GF_5F.mp4",
  awardOnEnter: 1,
  next: "scene_gf_5F_text"
},

scene_gf_5F_text: {
  type: "text",
  suppressHub: true,
  text:
    "Movie Night Result: ❌ Deal Lost\n\n" +
    "Separate screens, same Wi-Fi. Your tone drifted away from cooperative problem-solving.\n" +
    "Replay from the start and try the more curious, collaborative options.",
  choices: [
    { text: "Try again from first question", next: "scene_gf_v1" }
  ]
},
/* ----------------------------- TIE-IN SCENE ----------------------------- */
scene_bf_intro: {
  type: "text",
  suppressHub: true,
  image: "images/11.png",
  awardOnEnter: 1,
  text:
    "Movie night — round two.\n\n" +
    "After negotiating genres with your girlfriend last time, it's your boyfriend’s turn.\n" +
    "He has strong opinions… and so do you.\n\n" +
    "Listen, choose, and find the balance.",
  choices: [{ text: "Start", next: "scene_bf_1A" }]
},

/* ----------------------------- BF_1A ----------------------------- */
scene_bf_1A: {
  type: "video-choice",
  videoSrc: "videos/BF_1A.mp4",
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene_bf_timeout",
  speechRightText:
    "It depends — if we balance it with something light afterward, I’m game.",
  choices: [
    // CORRECT → BF_2G
    {
      text: "It depends — if we balance it with something light afterward, I’m game.",
      next: "scene_bf_2G"
    },
    // WRONG 1 → BF_2P
    {
      text: "Not a chance; I promised myself fewer time loops this month.",
      next: "scene_bf_2P"
    },
    // WRONG 2 → BF_2M
    {
      text: "I could be convinced — what did you have in mind beyond explosions?",
      next: "scene_bf_2M"
    }
  ]
},

scene_bf_timeout: {
  type: "text",
  suppressHub: true,
  text: "Time’s up — try leading with balance, not resistance.",
  choices: [{ text: "Try again", next: "scene_bf_1A" }]
},

/* ----------------------------- BF_2G / BF_2M / BF_2P ----------------------------- */

scene_bf_2G: { type: "video", videoSrc: "videos/BF_2G.mp4", next: "scene_bf_2_choices" },
scene_bf_2M: { type: "video", videoSrc: "videos/BF_2M.mp4", next: "scene_bf_2_choices" },
scene_bf_2P: { type: "video", videoSrc: "videos/BF_2P.mp4", next: "scene_bf_2_choices" },

scene_bf_2_choices: {
  type: "video-choice",
  videoSrc: null, // choices-only scene
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene_bf_timeout2",
  speechRightText:
    "Isn’t the real test whether we can both enjoy it without multitasking?",
  choices: [
    // WRONG
    {
      text: "Look, pick what you want. I’ll survive the confusion.",
      next: "scene_bf_3P"
    },
    // MODERATE
    {
      text: "If we watch this one, maybe I pick next week — fair trade?",
      next: "scene_bf_3M"
    },
    // CORRECT
    {
      text: "Isn’t the real test whether we can both enjoy it without multitasking?",
      next: "scene_bf_3G"
    }
  ]
},

scene_bf_timeout2: {
  type: "text",
  suppressHub: true,
  text: "Time’s up — look for the choice that signals shared focus.",
  choices: [{ text: "Restart", next: "scene_bf_1A" }]
},

/* ----------------------------- BF_3G / BF_3M / BF_3P ----------------------------- */

scene_bf_3G: { type: "video", videoSrc: "videos/BF_3G.mp4", next: "scene_bf_3_choices" },
scene_bf_3M: { type: "video", videoSrc: "videos/BF_3M.mp4", next: "scene_bf_3_choices" },
scene_bf_3P: { type: "video", videoSrc: "videos/BF_3P.mp4", next: "scene_bf_3_choices" },

scene_bf_3_choices: {
  type: "video-choice",
  videoSrc: null,
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene_bf_timeout3",
  speechRightText:
    "Say we treat this like research — analysing storytelling instead of surviving it.",
  choices: [
    // MODERATE → BF_4M
    {
      text: "Maybe we could start early so the plot holes bother me less.",
      next: "scene_bf_4M"
    },
    // WRONG → BF_4F
    {
      text: "I’ll thrive when the credits roll.",
      next: "scene_bf_4F"
    },
    // CORRECT → BF_4G
    {
      text: "Say we treat this like research — analysing storytelling instead of surviving it.",
      next: "scene_bf_4G"
    }
  ]
},

scene_bf_timeout3: {
  type: "text",
  suppressHub: true,
  text: "Time’s up — look for the choice showing curiosity, not resistance.",
  choices: [{ text: "Try again", next: "scene_bf_1A" }]
},

/* ----------------------------- BF_4G / BF_4M / BF_4F ----------------------------- */

scene_bf_4G: { type: "video", videoSrc: "videos/BF_4G.mp4", next: "scene_bf_4_choices" },
scene_bf_4M: { type: "video", videoSrc: "videos/BF_4M.mp4", next: "scene_bf_4_choices" },
scene_bf_4F: { type: "video", videoSrc: "videos/BF_4P.mp4", next: "scene_bf_4_choices" },

scene_bf_4_choices: {
  type: "video-choice",
  videoSrc: null,
  timer: 14,
  shuffleOptions: true,
  timeoutNext: "scene_bf_timeout4",
  speechRightText:
    "Isn’t that proof that negotiation works — we both got a bit of what we wanted?",
  choices: [
    // WRONG → BF_5F
    {
      text: "You talk more than the movie does.",
      next: "scene_bf_5F"
    },
    // CORRECT → BF_5S
    {
      text: "Isn’t that proof that negotiation works — we both got a bit of what we wanted?",
      next: "scene_bf_5S"
    },
    // RAW DEAL → BF_5R
    {
      text: "Maybe we’ll both end up asleep halfway, and that’s peace in its purest form.",
      next: "scene_bf_5R"
    }
  ]
},

scene_bf_timeout4: {
  type: "text",
  suppressHub: true,
  text: "Time’s up — look for the cooperative framing.",
  choices: [{ text: "Try again", next: "scene_bf_1A" }]
},

/* ----------------------------- OUTCOMES ----------------------------- */

scene_bf_5S: {
  type: "video",
  videoSrc: "videos/BF_5S.mp4",
  next: "scene_bf_5S_text"
},
scene_bf_5S_text: {
  type: "text",
  suppressHub: true,
  awardOnEnter: 5,
  text:
    "Negotiation Successful — you balanced enthusiasm and compromise.\n\n" +
    "Popcorn diplomacy wins again.",
  choices: [{ text: "Wrap up activity", next: "scene41_email" }]
},

scene_bf_5R: {
  type: "video",
  videoSrc: "videos/BF_5R.mp4",
  next: "scene_bf_5R_text"
},
scene_bf_5R_text: {
  type: "text",
  suppressHub: true,
  text:
    "Partial Result — the night is peaceful, even if the movie choice was a soft compromise.\n\nTry again for the optimal outcome.",
  choices: [{ text: "Retry", next: "scene_bf_1A" }]
},

scene_bf_5F: {
  type: "video",
  videoSrc: "videos/BF_5F.mp4",
  next: "scene_bf_5F_text"
},
scene_bf_5F_text: {
  type: "text",
  suppressHub: true,
  text:
    "Negotiation Failed — the movie night diverged into parallel universes.\n\nGive it another shot.",
  choices: [{ text: "Retry", next: "scene_bf_1A" }]
},

/* ===== WRAP-UP — Email to Instructor (engine-native) ===== */
/* Make sure your final video path points its `next` → "scene41_email" */

scene41_email: {
  type: "email",
  awardOnEnter: 2,
  text: "Final task — send a short reflection to your instructor. Explain:\n\n• Which negotiation scenes stood out to you (car, workplace, laptop, or video series).\n• What language or strategies helped you move the deal forward.\n• What you would try differently next time.\n\nAim for around 180–250 words.",
  teacherEmail: "xavier.benitz@gmail.com",
  emailSubject: "We Have A Deal! — Negotiation Reflection",
  emailBody: "",
  next: "email_sent_confirm"
},

email_sent_confirm: {
  type: "text",
  text: "✅ Email sent! Thanks for your reflection.",
  image: "images/12.png",
  choices: [{ text: "Continue", next: "thank_you_scene" }]
},

thank_you_scene: {
  type: "text",
  image: "images/10.png",
  text: "Thank you for playing *We Have A Deal!*.\n\nYou can replay any scene to improve timing, accuracy, or just to review the negotiation language.",
  endOfCourse: true,
  finishOnEnter: false,
  scoreRaw: 100,
  choices: [{ text: "Play again", next: "scene1" }]
},
/* ===================== CHALLENGE MODE HUB ===================== */

scene_challenge_hub: {
  type: "text",
  image: "images/1.png", // or any image you prefer for Challenge Mode
  text:
    "⚡ Challenge Mode\n\n" +
    "Jump straight into any negotiation challenge from this lesson.\n" +
    "Each option loads the full mini-scenario on its own. When you finish\n" +
    "or fail, you’ll return here via that challenge’s own restart flow.\n\n" +
    "Choose where you want to start:",
  choices: [
    /* --- HANGMAN SET --- */
    { text: "Hangman 1 – DEAL vocabulary",          next: "scene2_hangman_intro_deal" },
    { text: "Hangman 2 – DEAL vocabulary (set 2)",  next: "scene_hang2_intro" },
    { text: "Hangman 3 – DEAL vocabulary (set 3)",  next: "scene_hangman3_intro" },

    /* --- BOOTCAMP 1 – CAR NEGOTIATION --- */
    // Tie-in scene for the car bootcamp (adjust ID if needed)
    { text: "Bootcamp 1 – Selling your car",        next: "scene_car_intro" },

    /* --- BOOTCAMP 2 – WORKPLACE NEGOTIATION --- */
    { text: "Bootcamp 2 – Say it better at work",   next: "scene_bootcamp2_intro" },

    /* --- GRAMMAR RUN --- */
    { text: "Grammar Run – Two sides of the deal",  next: "scene14_grammar_intro" },

    /* --- AUDIO CALLS – LAPTOP BUYER --- */
    { text: "Audio Call 1 – First offer",           next: "scene23_laptop_intro" },
    { text: "Audio Call 2 – Counteroffer",          next: "scene24_call2_intro" },
    { text: "Audio Call 3 – Settlement (branching)",next: "scene24_call3_intro" },

    /* --- VIDEO SET 1 – SALARY REVIEW --- */
    { text: "Video 1 – Salary negotiation (HR)",    next: "scene_salary_intro" },

    /* --- VIDEO SET 2 – SUPPLIER RENEWAL --- */
    { text: "Video 2 – Supplier contract renewal",  next: "scene_supplier_intro" },

    /* --- VIDEO SET 3 – MOVIE NIGHT (GF) --- */
    { text: "Video 3 – Movie night with girlfriend",next: "scene_gf_intro" },

    /* --- VIDEO SET 4 – MOVIE NIGHT (BF) --- */
    { text: "Video 4 – Movie night with boyfriend", next: "scene_bf_intro" },

    /* --- EXIT BACK TO STORY MODE --- */
    { text: "Back to Story Mode",                   next: "scene1" }
  ]
}










};









// Try to attach "fresh start" to whatever your start/play control is
function attachPlayHandlers(firstSceneId = "scene1") {
  const selectors = [
    '#play-btn',       // common id
    '#start-btn',
    '#start',
    '[data-action="play"]',
    '[data-role="play"]',
    '.js-play',
    '.js-start',
    'button[href="#play"]',    // sometimes used
  ];

  let hooked = false;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.addEventListener('click', (e) => {
      try { e.preventDefault(); } catch(_) {}
      window.startFreshAttempt(firstSceneId);
    }, { once:false });
    hooked = true;
  }

  // Intercept common inline/global starters if your HTML uses them
  window.playNow   = () => window.startFreshAttempt(firstSceneId);
  window.startGame = () => window.startFreshAttempt(firstSceneId);
  window.start     = () => window.startFreshAttempt(firstSceneId);

  // Return whether we actually found something to hook
  return hooked;
}

// === Start a brand-new LMS attempt (wipe score, status, awards, bookmark) ===
window.startFreshAttempt = function(firstSceneId = "scene1") {
  try {
    // Tell hydrator not to pull existing awards this time
    window.__FRESH_START__ = true;

    // Local state
    try { localStorage.removeItem("awarded_scenes_v2"); } catch {}
    try { localStorage.removeItem("awarded_scenes_v1"); } catch {}
    try { localStorage.removeItem("game_progress_v1"); } catch {}
    window.__awarded = new Set();
    // Ensure denominator
    let total = 0;
    for (const sc of Object.values(window.scenes || {})) {
      const pts = Number(sc?.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    }
    window.__TOTAL_AWARD_MAX = total;
    window.score = { cur: 0, max: total };

    // LMS reset
    if (window.SCORM && SCORM.init && SCORM.init()) {
      SCORM.set("cmi.suspend_data", "");                // drop saved awards
      SCORM.set("cmi.core.score.raw", "0");             // reset % to 0
      // “incomplete” is a safe initial status for SCORM 1.2 fresh runs
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.set("cmi.core.lesson_location", String(firstSceneId));
      SCORM.commit();
    }

    // Do NOT reconcile/publish here—wait until gameplay
// Do NOT reconcile/publish here—wait until gameplay
window.hideHome();
if (typeof window.loadScene === "function") {
  window.loadScene(firstSceneId);
}
 else {
  console.warn("[FreshAttempt] loadScene not ready yet.");
}

  } catch (e) {
    console.warn("[FreshAttempt] reset failed:", e);
    // As a fallback, still try to launch
// Do NOT reconcile/publish here—wait until gameplay
window.hideHome();         
try { updateSpeechUIForScene(id); } catch(_) {}
                    // always hide overlay
if (typeof window.loadScene === "function") {
  window.loadScene(firstSceneId);
} else {
  console.warn("[FreshAttempt] loadScene not ready yet.");
}

  }
};


// --- Single source of truth: merge + write LMS state ---
window.writeLMSState = function ({ sceneId, awarded }) {
  try {
    if (!(window.SCORM && SCORM.init && SCORM.init())) return;

    // 1) read existing
    let existing = [];
    try {
      const prev = SCORM.get("cmi.suspend_data");
      if (prev && prev.trim()) {
        const j = JSON.parse(prev);
        if (j && Array.isArray(j.awarded)) existing = j.awarded;
      }
    } catch (_) {}

    // 2) merge LMS + in-memory + explicit
    const merged = new Set(existing);
    if (window.__awarded instanceof Set) window.__awarded.forEach(x => merged.add(x));
    if (awarded instanceof Set) awarded.forEach(x => merged.add(x));
    else if (Array.isArray(awarded)) awarded.forEach(x => merged.add(x));

    // 3) bookmark + write back + commit
    if (sceneId) SCORM.set("cmi.core.lesson_location", String(sceneId));
    const sd = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
    SCORM.set("cmi.suspend_data", sd);
    SCORM.commit();

    console.log("[SCORM] suspend_data merged; awards count:", merged.size);
  } catch (e) {
    console.warn("[SCORM] writeLMSState failed:", e);
  }
};



/* ===== Scoring bootstrap (runs once, right after scenes) ===== */

// 1) Minimal score model
window.score = window.score || { cur: 0, max: 0 };

// 2) Sum TOTAL points from all scenes that have awardOnEnter
window.__computeAwardTotalOnce = function () {
  try {
    const all = window.scenes || {};
    let total = 0;
    Object.entries(all).forEach(([id, sc]) => {
      const pts = Number(sc && sc.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    });
    window.__TOTAL_AWARD_MAX = total;
    window.score.max = total;           // lock denominator
    console.log("[Score bootstrap] TOTAL_AWARD_MAX =", total);
  } catch (e) { console.warn("computeAwardTotalOnce failed", e); }
};

// === Self-healing reconciler (FUNDAE: pass at/over 75%; anti-demotion; force 100% when max hit) ===
window.__reconcileAwardsToScore = function () {
  try {
    // --- Ensure denominator from scenes ---
    let total = Number(window.__TOTAL_AWARD_MAX || 0);
    if (!(Number.isFinite(total) && total > 0)) {
      total = 0;
      const allScenes = window.scenes || {};
      for (const sc of Object.values(allScenes)) {
        const pts = Number(sc && sc.awardOnEnter);
        if (Number.isFinite(pts) && pts > 0) total += pts;
      }
      window.__TOTAL_AWARD_MAX = total;
    }

    if (!window.score) window.score = { cur: 0, max: 0 };
    if (!(Number.isFinite(window.score.max) && window.score.max > 0)) {
      window.score.max = total;
    }

    // --- Rebuild current from awarded set ---
    let cur = 0;
    const awardedSet = new Set(Array.from(window.__awarded || []));
    const all = window.scenes || {};
    for (const sid of awardedSet) {
      const pts = Number(all[sid]?.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) cur += pts;
    }
    window.score.cur = cur;

    // --- Compute % ---
    const max = Math.max(0, Number(window.score.max || 0));
    let raw = (max > 0) ? Math.round(100 * cur / max) : 0;

    if (window.SCORM && SCORM.init && SCORM.init()) {
      // (A) Anti-demotion: never publish lower than what LMS already has
      try {
        const r = SCORM.get && SCORM.get("cmi.core.score.raw");
        if (r && !isNaN(+r)) {
          const lmsRaw = +r;
          if (lmsRaw > raw) raw = lmsRaw;
        }
      } catch(_) {}

      // (B) Force 100 + passed when cur>=max
      if (max > 0 && cur >= max) {
        raw = 100;
      }

      // score
      SCORM.set("cmi.core.score.raw", String(raw));

      // mastery: LMS masteryscore wins; else default 75 (FUNDAE baseline)
      let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;
      try {
        const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
        if (m && !isNaN(+m)) mastery = +m;
      } catch (_) {}

      // status: pass automatically when raw ≥ mastery; never demote if already passed
      const st = (SCORM.get && SCORM.get("cmi.core.lesson_status")) || "not attempted";
      if (raw >= mastery) {
        if (st !== "passed") SCORM.set("cmi.core.lesson_status", "passed");
      } else {
        if (st === "not attempted" || st === "unknown") {
          SCORM.set("cmi.core.lesson_status", "incomplete");
        }
        // do not demote if already passed
      }

      // bookmark
      if (window.currentSceneId) {
        SCORM.set("cmi.core.lesson_location", String(window.currentSceneId));
      }

      // merge awards into suspend_data (never drop older awards)
      try {
        let existing = [];
        const prev = SCORM.get && SCORM.get("cmi.suspend_data");
        if (prev) {
          try {
            const pj = JSON.parse(prev);
            if (pj && Array.isArray(pj.awarded)) existing = pj.awarded;
          } catch(_) {}
        }
        const merged = new Set(existing);
        for (const x of awardedSet) merged.add(x);
        const sd = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
        SCORM.set("cmi.suspend_data", sd);
      } catch(_) {}

      SCORM.commit();
    }

    console.log(`[SCORM][reconcile] cur/max: ${cur} / ${max} raw: ${raw}% ; TOTAL_AWARD_MAX: ${window.__TOTAL_AWARD_MAX}`);
  } catch (e) {
    console.warn("[SCORM][reconcile] failed:", e);
  }
};






// 4) Run both immediately (no waiting on anything else)
if (!Number.isFinite(window.score?.max) || window.score.max === 0) {
  window.__computeAwardTotalOnce();
}
/* --- SCORM fresh-attempt guard: ignore stale web awards in LMS --- */
try {
  if (window.SCORM && SCORM.init && SCORM.init()) {
    const st = SCORM.get && SCORM.get("cmi.core.lesson_status");
    const sd = SCORM.get && SCORM.get("cmi.suspend_data");
    const fresh = (!sd || sd === "") && (!st || st === "not attempted" || st === "unknown" || st === "");
    if (fresh) {
      window.__awarded = new Set();                   // drop local carryover
      if (typeof awardPersistSave === 'function') awardPersistSave();
      const max = Number(window.__TOTAL_AWARD_MAX || window.score?.max || 0);
      window.score = { cur: 0, max: max > 0 ? max : 0 };
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.set("cmi.core.score.raw", "0");
      SCORM.commit();
      console.log("[SCORM] Fresh LMS attempt: cleared awards; score reset to 0%");
    }
  }
} catch (_) {}
window.__reconcileAwardsToScore();

// after: const scenes = { ... all your scenes ... };
window.scenes = window.scenes || scenes;   // <-- make scenes visible to bootstraps/debuggers


// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
// === Bootstrap scoring from persisted awards (MUST run after scenes are defined) ===
(function bootstrapScoringFromAwards(all) {
  // ⛳ Skip localStorage bootstrap when running in an LMS
  try { if (window.SCORM && SCORM.init && SCORM.init()) {
    console.log("[SCORM] Skipping localStorage awards bootstrap (LMS is source of truth).");
    return;
  }} catch {}

  // …keep the rest exactly as-is…

  // If we're in an LMS, do NOT overwrite __awarded from localStorage.
  let usingLMS = false;
  try { usingLMS = !!(window.SCORM && SCORM.init && SCORM.init()); } catch {}

  if (!usingLMS) {
    // Web play: keep using localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('awarded_scenes_v1') || '[]');
      window.__awarded = new Set(saved);
    } catch (_) {
      window.__awarded = new Set();
    }
  }

  let total = 0, cur = 0;
  Object.entries(all || {}).forEach(([id, sc]) => {
    const pts = Number(sc && sc.awardOnEnter);
    if (Number.isFinite(pts) && pts > 0) {
      total += pts;
      if (window.__awarded && window.__awarded.has && window.__awarded.has(id)) cur += pts;
    }
  });

  window.__TOTAL_AWARD_MAX = total;
  window.score = window.score || { cur: 0, max: 0 };
  window.score.cur = cur;
  window.score.max = total;

  try {
    if (usingLMS) {
      const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
      if (!status || status === "not attempted" || status === "unknown") {
        SCORM.set("cmi.core.lesson_status", "incomplete");
      }
      const raw = (total > 0) ? Math.round(100 * cur / total) : 0;
      SCORM.set("cmi.core.score.raw", String(raw));
      SCORM.commit();
      console.log("[SCORM][bootstrap] cur/max:", cur, "/", total, "→", raw, "%");
    }
  } catch (_) {}

  console.log("[Score bootstrap] cur/max:", cur, "/", total, "awarded:", Array.from(window.__awarded || []));
})(window.scenes);





(function __computeAwardTotalOnce(){
  if (window.__TOTAL_AWARD_MAX_COMPUTED) return;

  let total = 0;
  Object.entries(window.scenes || {}).forEach(([id, sc]) => {
    const pts = Number(sc && sc.awardOnEnter);
    if (Number.isFinite(pts) && pts > 0) total += pts;
  });

  window.scoreReset(total); // sets score.max = total, cur = 0, pushes 0% to LMS
  window.__TOTAL_AWARD_MAX_COMPUTED = true;

  console.log("[Score bootstrap] TOTAL_AWARD_MAX =", total);
})();






















// ✅ Step A: make scenes available globally
window.scenes = scenes;



// Make sure text+video scenes have a truthy `text` so the validator passes
(function ensureVideoText(sc){
  Object.values(sc || {}).forEach(s => {
    if (s && s.type === "text" && s.source && (s.text == null || s.text === "")) {
      s.text = " "; // visually empty, satisfies validator
    }
  });
})(window.scenes);


// === GitHub Pages asset fixer ===
// Put AFTER: window.scenes = scenes;
(function fixAssetPathsForPages(){
  const isPages = /github\.io$/.test(location.hostname);
  // If you host at https://user.github.io/repo/, PREFIX becomes "/repo/"
  const prefix = isPages
    ? (location.pathname.replace(/\/index\.html?$/,'').replace(/\/$/,'') + '/')
    : '';

  function add(p){
    if (!p) return p;
    // leave external/relative/data URIs alone
    if (/^(https?:|data:|\.{1,2}\/)/i.test(p)) return p;
    // strip leading slash so "/images/x.png" becomes "images/x.png"
    const clean = p.replace(/^\//,'');
    return prefix + clean;
  }

  const A = (arr, fn) => Array.isArray(arr) ? arr.map(fn) : arr;

  (Object.values(window.scenes || {})).forEach(sc => {
    if (!sc || typeof sc !== 'object') return;
    if (sc.image) sc.image = add(sc.image);
    if (Array.isArray(sc.images)) sc.images = sc.images.map(add);
    if (sc.audio) sc.audio = add(sc.audio);
    if (sc.videoSrc) sc.videoSrc = add(sc.videoSrc);
    if (sc.poster) sc.poster = add(sc.poster);


    if (Array.isArray(sc.options)) {
      sc.options = sc.options.map(o => (typeof o === 'string' && /\.(mp3|wav|ogg|m4a|mp4)$/i.test(o)) ? add(o) : o);
    }
    if (Array.isArray(sc.interactions)) {
      sc.interactions.forEach(it => {
        if (it.audio) it.audio = add(it.audio);
        if (Array.isArray(it.options)) {
          it.options = it.options.map(o => (typeof o === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(o)) ? add(o) : o);
        }
      });
    }
  });
})();

// Resolve relative assets against <base> reliably
function resolveSrc(p){
  try { return new URL(p, document.baseURI).href; }
  catch { return p || ''; }
}



















// === UNIVERSAL SCENE NORMALIZER (v1) ===
(function normalizeForEngine(){
  function tokensFromText(t){ return String(t||'').trim().split(/\s+/).filter(Boolean); }
  function sentenceFromTextWithBlanks(text){
    const out=[]; const blanks=[];
    const parts = String(text||'').split('___');
    parts.forEach((seg,i)=>{
      if (seg) out.push(...tokensFromText(seg));
      if (i < parts.length-1){ blanks.push(out.length); out.push('___'); }
    });
    return { sentence: out, blanks };
  }

  Object.values(scenes).forEach(sc=>{
    if (!sc || typeof sc !== 'object') return;

    if (sc.type === "dashboard" && Array.isArray(sc.widgets)) {
  sc.widgets = sc.widgets.map((w, i) => {
    const ww = { ...w };
    if (!ww.type && ww.kind) ww.type = ww.kind;   // accept `kind` alias
    if (!ww.id) ww.id = `w_${ww.type || 'widget'}_${i}`;
    return ww;
  });
}

    // SCRAMBLE: accept words/sentence/correct(string)
    if (sc.type === 'scramble'){
      if (!Array.isArray(sc.scramble)) {
        sc.scramble =
          Array.isArray(sc.words)    ? sc.words.slice() :
          Array.isArray(sc.sentence) ? sc.sentence.slice() :
          tokensFromText(sc.text);
      }
      if (typeof sc.correct === 'string') sc.correct = tokensFromText(sc.correct);
      if (!Array.isArray(sc.correct) && Array.isArray(sc.sentence)) sc.correct = sc.sentence.slice();
    }

    // FIB: build sentence/blanks from "___" if missing; normalize correct to array
    if (sc.type === 'fill-in-the-blank'){
      if (!Array.isArray(sc.sentence) || !Array.isArray(sc.blanks)) {
        const { sentence, blanks } = sentenceFromTextWithBlanks(sc.text || '');
        sc.sentence = sentence;
        sc.blanks = blanks.length ? blanks : [Math.max(0, sentence.indexOf('___'))];
      }
      if (typeof sc.correct === 'string') sc.correct = [sc.correct];
      if (!Array.isArray(sc.correct)) sc.correct = [];
      if (!Array.isArray(sc.options)) sc.options = [];
    }

    // AUDIO MC: allow audioSrc + text options + correct as string
    if (sc.type === 'interaction-audio-mc'){
      if (!sc.audio && sc.audioSrc) sc.audio = sc.audioSrc;
      if (typeof sc.correct === 'string' && Array.isArray(sc.options)) {
        const idx = sc.options.findIndex(o =>
          (typeof o === 'string' ? o : o.text).trim().toLowerCase() === sc.correct.trim().toLowerCase()
        );
        if (idx >= 0) sc.__correctIndex = idx;
      } else if (Number.isInteger(sc.correct)) {
        sc.__correctIndex = sc.correct;
      }
    }
    
  });
})();

// --- Scene Normalizer & Validator (global) ---

function normalizeScenes(rawScenes) {
  // Accept either array or object-map; always return array
  const arr = Array.isArray(rawScenes)
    ? rawScenes
    : Object.values(rawScenes || {});

  return arr.map(sc => {
    const s = { ...sc };

    // Normalize casing/aliases
    if ('ken_burns' in s && !('kenBurns' in s)) s.kenBurns = !!s.ken_burns;

    // FIB: normalize correct for single blank
    if (s.type === 'fill-in-the-blank') {
      // never allow empty-token options like "—"
      if (Array.isArray(s.options)) {
        s.options = s.options.map(o =>
          (o === '—' || o === '–' || o === '— (none)') ? 'no preposition' : o
        );
      }
      // if correct provided as array with one entry, flatten to string
      if (Array.isArray(s.correct) && s.correct.length === 1) {
        s.correct = s.correct[0];
      }
    }

    // Scramble: if correct provided as single string, split to tokens
    if (s.type === 'scramble') {
      if (typeof s.correct === 'string') {
        s.correct = s.correct.trim().split(/\s+/);
      }
      if (typeof s.sentence === 'string') {
        s.sentence = s.sentence.trim().split(/\s+/);
      }
    }

    // Hard rule: no custom "timed" type; normalize legacy data
    if (s.type === 'timed') {
      throw new Error(
        `Legacy type "timed" found in ${s.id}. Use a supported type (e.g., fill-in-the-blank) and add "timer".`
      );
    }

    return s;
  });
}

function validateScenesContract(scenesArr) {
  const ids = new Set(scenesArr.map(x => x.id));
  const problems = [];

  const must = (cond, msg) => { if (!cond) problems.push(msg); };

  for (const sc of scenesArr) {
    must(!!sc.id, `Scene missing id.`);
    must(!!sc.type, `${sc.id}: missing type.`);

    // forward links
    if (sc.next) must(ids.has(sc.next), `${sc.id}: next -> "${sc.next}" not found.`);
    if (Array.isArray(sc.choices)) {
      sc.choices.forEach((c, i) => must(ids.has(c.next), `${sc.id}: choices[${i}].next -> "${c.next}" not found.`));
    }

    switch (sc.type) {
      case 'text':
        must((Array.isArray(sc.choices) && sc.choices.length) || !!sc.next,
            `${sc.id}: text scene needs choices[] or next.`);
        break;

      case 'scramble':
        must(Array.isArray(sc.sentence) && sc.sentence.length > 0,
            `${sc.id}: scramble needs sentence[].`);
        must(Array.isArray(sc.correct) && sc.correct.length > 0,
            `${sc.id}: scramble needs correct[].`);
        must(sc.sentence.length === sc.correct.length,
            `${sc.id}: sentence[] and correct[] length mismatch.`);
        break;

      case 'fill-in-the-blank':
        must(typeof sc.text === 'string' && sc.text.includes('___'),
            `${sc.id}: FIB text must include ___ placeholder.`);
        must(Array.isArray(sc.options) && sc.options.length > 0,
            `${sc.id}: FIB requires non-empty options[].`);
        must(sc.correct !== undefined && sc.correct !== null && sc.correct !== '',
            `${sc.id}: FIB missing correct answer.`);
        // if multiple blanks, enforce array
        const blanks = (sc.text.match(/___/g) || []).length;
        if (blanks > 1) {
          must(Array.isArray(sc.correct) && sc.correct.length === blanks,
              `${sc.id}: FIB has ${blanks} blanks; correct must be array of ${blanks}.`);
        } else {
          must(typeof sc.correct === 'string',
              `${sc.id}: FIB (single blank) correct must be a string.`);
        }
        break;

      case 'interaction-audio-mc':
        must(!!sc.audioSrc, `${sc.id}: audioSrc missing.`);
        must(Array.isArray(sc.options) && sc.options.length >= 2,
            `${sc.id}: audio MC needs options[].`);
        must(typeof sc.correct === 'string',
            `${sc.id}: audio MC correct must be a string.`);
        break;

      case 'video-multiple-choice':
        must(!!sc.videoSrc, `${sc.id}: videoSrc missing.`);
        must(Array.isArray(sc.options) && sc.options.length >= 2,
            `${sc.id}: video MC needs options[].`);
        sc.options.forEach((o, i) => {
          must(typeof o.text === 'string', `${sc.id}: options[${i}].text missing.`);
          must(typeof o.correct === 'boolean', `${sc.id}: options[${i}].correct missing.`);
          must(ids.has(o.next), `${sc.id}: options[${i}].next -> "${o.next}" not found.`);
        });
        break;

      case 'email':
        must(!!sc.teacherEmail, `${sc.id}: email needs teacherEmail.`);
        must(!!sc.next, `${sc.id}: email needs next (usually thank_you_scene).`);
        break;

      default:
        problems.push(`${sc.id}: Unsupported type "${sc.type}".`);
    }
  }
  return problems;
}

// ===== Engine Hardening v2 =====
window.ENGINE_VERSION = '2.0.0';

// 0) Make transient registry visible to helpers (prevents ReferenceError)
window.__transients = window.__transients || { nodes:new Set(), timers:new Set(), cleaners:new Set(), listeners:new Set() };
const __transients = window.__transients; // <-- critical alias used by helpers

// 1) Global error overlay so crashes never look like a black screen
(function installErrorOverlay(){
  if (window.__errorOverlayInstalled) return; window.__errorOverlayInstalled=true;
  function showOverlay(title, detail){
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:#000b;color:#0ff;z-index:999999;display:grid;place-items:center;padding:20px;';
    const card = document.createElement('pre');
    card.style.cssText = 'background:#0a0a0f;border:1px solid #00ffff55;border-radius:12px;max-width:90vw;max-height:80vh;overflow:auto;padding:16px;font:12px/1.5 monospace;white-space:pre-wrap;';
    card.textContent = `[A-State Engine]\n${title}\n\n${detail}`;
    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }
  window.addEventListener('error', e => showOverlay('Runtime Error', (e.error && e.error.stack) || e.message));
  window.addEventListener('unhandledrejection', e => showOverlay('Unhandled Promise Rejection', (e.reason && e.reason.stack) || String(e.reason)));
})();

// 2) Strict validator (lightweight, no external libs)
function validateScenesStrict(all){
  const ids = new Set(Object.keys(all||{}));
  const errors = [];
  const warns  = [];
  function req(cond, id, msg){ if(!cond) errors.push(`[${id}] ${msg}`); }
  function w(cond, id, msg){ if(!cond) warns.push(`[${id}] ${msg}`); }

  for (const [id, sc] of Object.entries(all||{})) {
    req(sc && typeof sc === 'object', id, 'scene must be an object');
    const t = sc.type || 'text';

    // Common forward-refs
    if (sc.next) w(ids.has(sc.next), id, `next → "${sc.next}" not found`);
    if (sc.endings) {
      ['high','medium','low'].forEach(key => { if (sc.endings[key]) w(ids.has(sc.endings[key]), id, `endings.${key} → "${sc.endings[key]}" not found`); });
    }
    if (Array.isArray(sc.choices)) sc.choices.forEach(c => w(ids.has(c.next), id, `choice "${c.text}" → "${c.next}" not found`));

    // Per-type checks (subset; extend as needed)
    switch (t) {
      case 'text':
        req(!!sc.text, id, 'text scene needs "text"');
        break;

      case 'scramble': {
  const src =
    (Array.isArray(sc.scramble) && sc.scramble) ||
    (Array.isArray(sc.words) && sc.words) ||
    (Array.isArray(sc.sentence) && sc.sentence) ||
    null;

  req(Array.isArray(src) && src.length, id, 'scramble needs tokens in scramble[]/words[]/sentence[]');

  const corr = Array.isArray(sc.correct)
    ? sc.correct
    : (typeof sc.correct === 'string' ? sc.correct.trim().split(/\s+/) : null);

  req(Array.isArray(corr) && corr.length, id, 'scramble needs correct[] (or string)');
  req(!!sc.next, id, 'scramble needs next');
  break;
}


      case 'fill-in-the-blank':
      case 'interaction-fill-in-the-blank':
        req(Array.isArray(sc.sentence), id, 'needs sentence[]');
        req(Array.isArray(sc.blanks), id, 'needs blanks[]');
        req(Array.isArray(sc.options), id, 'needs options[]');
        req(Array.isArray(sc.correct), id, 'needs correct[]');
        req(sc.correct.length === sc.blanks.length, id, 'correct length must equal blanks length');
        req(!!sc.next, id, 'needs next');
        break;

      case 'interaction':
        req(Array.isArray(sc.interactions) && sc.interactions.length, id, 'needs interactions[]');
        sc.interactions.forEach((it, i)=>{
          req(typeof it.audio === 'string' && it.audio.length, id, `interactions[${i}] needs audio`);
          req(Array.isArray(it.options) && it.options.length, id, `interactions[${i}] needs options[]`);
          req(typeof it.correct !== 'undefined', id, `interactions[${i}] needs correct (index or scoring)`);
        });
        req(sc.scoring && typeof sc.scoring === 'object', id, 'needs scoring{high,medium}');
        req(sc.endings && typeof sc.endings === 'object', id, 'needs endings{high,medium,low}');
        break;

      case 'interaction-scramble':
        req(Array.isArray(sc.scramble) && sc.scramble.length, id, 'needs scramble[]');
        req(Array.isArray(sc.correct) && sc.correct.length, id, 'needs correct[]');
        req(typeof sc.audio === 'string' && sc.audio.length, id, 'needs audio');
        req(sc.next, id, 'needs next');
        break;

      case 'interaction-audio-mc':
  req( (typeof sc.audio === 'string' && sc.audio.length) ||
       (typeof sc.audioSrc === 'string' && sc.audioSrc.length),
       id, 'needs prompt audio (audio or audioSrc)');
  req(Array.isArray(sc.options) && sc.options.length >= 2,
      id, 'needs options[]');
  // allow either numeric index or string match
  req(Number.isInteger(sc.correct) || typeof sc.correct === 'string' || Number.isInteger(sc.__correctIndex),
      id, 'needs correct (index or matching string)');
  req(sc.next, id, 'needs next');
  break;


      case 'video':
      case 'video-scramble':
      case 'video-fill-in-the-blank':
      case 'video-multi-question':
      case 'video-multi-audio-choice':
        req(typeof sc.videoSrc === 'string' && sc.videoSrc.length, id, `${t} needs videoSrc`);
        // question/fields validated inside loader, but we warn:
        if (t==='video-multi-question') w(Array.isArray(sc.questions) && sc.questions.length, id, 'video-multi-question expects questions[]');
        break;

      case 'email':
        req(typeof sc.teacherEmail === 'string' && sc.teacherEmail.includes('@'), id, 'needs teacherEmail');
        req(typeof sc.emailSubject === 'string', id, 'needs emailSubject');
        break;

      // Mini-games
      case 'hangman':
        req(typeof sc.target === 'string' && sc.target.length, id, 'hangman needs target');
        break;

      case 'survivor-quiz':
      case 'conjugation-race':
      case 'image-hotspots':
      case 'buckets':
      case 'particle-swapper':
      case 'comic-bubbles':
      case 'dashboard':
        // Keep loose; these scenes vary. Rely on loader internals.
        break;

      default:
        w(false, id, `unknown type "${t}" — engine will treat as text`);
    }
  }
  return { errors, warns };
}

// 3) Asset preloader (quietly warms images/audio/video for next scene)
function listAssetsForScene(sc){
  const imgs = new Set(), auds = new Set(), vids = new Set();
  if (!sc || typeof sc !== 'object') return {imgs,auds,vids};
  if (sc.image) imgs.add(sc.image);
  if (sc.poster) imgs.add(sc.poster); // ✅ preload video poster too
  if (Array.isArray(sc.images)) sc.images.forEach(x=>imgs.add(x));
  if (sc.audio) auds.add(sc.audio);
  if (Array.isArray(sc.interactions)) sc.interactions.forEach(it=>{
    if (it.audio) auds.add(it.audio);
    if (Array.isArray(it.options)) it.options.forEach(opt=>{
      if (typeof opt === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(opt)) auds.add(opt);
    });
  });
  if (typeof sc.videoSrc === 'string') vids.add(sc.videoSrc);
  return {imgs,auds,vids};
}
const __preloaded = new Set();
function preloadAssetsFor(id){
  const sc = (window.scenes||{})[id];
  if (!sc) return;

  const {imgs,auds,vids} = listAssetsForScene(sc);

  imgs.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const i = new Image();
    // small wins for faster decode
    i.decoding = 'async';
    i.loading  = 'eager';
    i.src = url;
    __preloaded.add(url);
  });

  auds.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.src = url;
    try { a.load(); } catch(_) {}
    __preloaded.add(url);
  });

  vids.forEach(src => {
    if (!src) return;
    const url = resolveSrc(src);
    if (__preloaded.has(url)) return;
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.setAttribute('playsinline','');
    v.setAttribute('webkit-playsinline','');
    v.playsInline = true;
    v.src = url;
    try { v.load(); } catch(_) {}
    __preloaded.add(url);
  });
}


// 4) Safe start: clean data → validate → preload → start or show errors
(function safeBootstrap(){
  try {
 // sanitize unicode quirks
if (typeof cleanScenesData === 'function') cleanScenesData(window.scenes);

// 🔧 normalize scene shapes BEFORE validating/using
if (typeof window.normalizeScenesForEngine === 'function') {
  // (not needed because we used an IIFE above)
} // kept for clarity

const {errors, warns} = validateScenesStrict(window.scenes);

    warns.forEach(w => console.warn('[Scene Warning]', w));
    if (errors.length){
      console.error('[Scene Errors]', errors);
      const detail = errors.join('\n');
      const evt = new Error('Scene validation failed:\n' + detail);
      throw evt; // triggers overlay
    }

    // Preload first scene + immediate next(s)
    if (window.scenes && window.scenes.scene1) {
      preloadAssetsFor('scene1');
      if (window.scenes.scene1.next) preloadAssetsFor(window.scenes.scene1.next);
      if (Array.isArray(window.scenes.scene1.choices)) window.scenes.scene1.choices.forEach(c=>preloadAssetsFor(c.next));
    }

    // expose a safeStart you already call from the Play button
    window.safeStartGame = function(){
      try { startGame(); } catch(err) { console.error(err); throw err; }
    };

    // optional: make the homepage button call safeStartGame instead
    const btn = document.querySelector('#overlay-content .button-group button');
    if (btn && !btn.__wired) { btn.onclick = () => window.safeStartGame(); btn.__wired = true; }

  } catch(e) {
    // overlay installs in (1); rethrow for visibility
    console.error('[Bootstrap]', e);
    throw e;
  }
})();



























































// --- Usage (do this once where you load scenes) ---
// const raw = scenes; // your imported scenes (object or array)
// const normalized = normalizeScenes(raw);
// const errs = validateScenesContract(Array.isArray(normalized) ? normalized : Object.values(normalized));
// if (errs.length) { console.error(errs); alert("Scene errors:\n\n" + errs.join("\n")); throw new Error("Invalid scenes."); }
// window.scenes = Array.isArray(normalized) ? normalized : Object.values(normalized);



const ENABLE_TEST_HUB = false; // flip to true only while testing




// --- Transient registry (one-time, keep above loadScene) ---
// --- Transient registry (one-time, keep above loadScene) ---
window.__transients = window.__transients || { nodes:new Set(), timers:new Set(), cleaners:new Set(), listeners:new Set() };


function registerNode(node){
  node.dataset.transient = "1";
  __transients.nodes.add(node);
  return node;
}
function registerTimer(id){
  __transients.timers.add(id);
  return id;
}
function registerCleanup(fn){
  __transients.cleaners.add(fn);
  return fn;
}
function registerListener(target, evt, handler, opts){
  target.addEventListener(evt, handler, opts);
  __transients.listeners.add(() => target.removeEventListener(evt, handler, opts));
  return handler;
}
function cleanupTransients(){
  __transients.timers.forEach(t => { try { clearInterval(t); clearTimeout(t); } catch(_){} });
  __transients.timers.clear();

  __transients.cleaners.forEach(fn => { try { fn(); } catch(_){} });
  __transients.cleaners.clear();

  __transients.listeners.forEach(off => { try { off(); } catch(_){} });
  __transients.listeners.clear();

  document.querySelectorAll('[data-transient="1"]').forEach(n => n.remove());
  __transients.nodes.clear();
}

// --- Scene hero (image-on-top) helper ---
function renderSceneHeader(sc, root) {
  // image (if provided)
  if (sc.image) {
    const wrap = document.createElement('div');
    wrap.className = 'scene-hero';
    const img = document.createElement('img');
    img.src = sc.image;
    img.alt = sc.alt || '';
    img.loading = 'eager';
    wrap.appendChild(img);
    root.appendChild(wrap);
  }
  // title/lead text (optional if your loader already shows sc.text)
  if (sc.text) {
    const p = document.createElement('div');
    p.className = 'scene-lead';
    p.innerHTML = sc.text; // if you already render sc.text elsewhere, remove this
    root.appendChild(p);
  }
}


// ===== Persistence V2 (resume last scene + tallies) =====
// === Robust Resume Game (safe + validated) ===
(function () {
  const SAVE_KEY = 'game_progress_v1';

  const qs  = sel => document.querySelector(sel);
  const $id = id  => document.getElementById(id);

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch { return null; }
  }
  function writeSave(obj) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch {}
  }

  function showHome() {
    const overlay = $id('overlay') || qs('#overlay-content')?.parentElement;
    const game    = $id('game-container');
    if (game)    game.style.display = 'none';
    if (overlay) overlay.style.display = ''; // let CSS decide (block/grid)
  }
  function hideHome() {
    const overlay = $id('overlay') || qs('#overlay-content')?.parentElement;
    const game    = $id('game-container');
    if (overlay) overlay.style.display = 'none';
    if (game)    game.style.display = 'block';
  }

  function sceneExists(id) {
    const s = (window.scenes || {});
    // support both object map and array-of-scenes (rare)
    if (Array.isArray(s)) return s.some(x => x && x.id === id);
    return !!s[id];
  }

  function whenLoadSceneReady(run) {
    if (typeof window.loadScene === 'function') { run(); return; }
    let tries = 0;
    (function tick() {
      if (typeof window.loadScene === 'function') { run(); return; }
      if (tries++ > 200) { // ~6s safety
        console.warn('[Resume] loadScene never became available; showing home.');
        showHome();
        return;
      }
      setTimeout(tick, 30);
    })();
  }

  function tryResume() {
    const saved = readSave();
    const last  = saved?.lastScene;

    // Validate saved target
    if (!last || !sceneExists(last)) {
      console.warn('[Resume] No valid lastScene. Showing home.');
      showHome();
      return;
    }

    hideHome();

    // Call loadScene defensively
    whenLoadSceneReady(() => {
      try {
        window.loadScene(last);

        // Post-check: if the scene didn’t mount anything, bail back home
        setTimeout(() => {
          const game = $id('game-container');
          const hasContent =
            game && (
              game.children.length > 0 ||
              ($id('scene-text') && $id('scene-text').textContent.trim().length) ||
              $id('scene-video') || $id('scene-image')
            );
          if (!hasContent) {
            console.warn('[Resume] Scene did not render; falling back to home.');
            showHome();
          }
        }, 100);
      } catch (err) {
        console.error('[Resume] loadScene threw:', err);
        showHome();
      }
    });
  }
window.addEventListener('DOMContentLoaded', () => {
  try { if (SCORM && SCORM.init) SCORM.init(); } catch(_){}
  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}
  showHome();
  updateResumeButton(); // leave your existing one in place (no rename)
});

  // NEW: bind fresh-run to any existing start/play control
  const hooked = attachPlayHandlers("scene1");

function updateResumeButton() {
  const btn = $id('resume-btn');
  if (!btn) return;

  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}



  let sceneId = null;
  let awarded = null;

  // 1) Prefer LMS resume (location + awards in suspend_data)
  try {
    if (inLMS() && SCORM && SCORM.init && SCORM.init()) {
      const loc = SCORM.get && SCORM.get("cmi.core.lesson_location");
      const sd  = SCORM.get && SCORM.get("cmi.suspend_data");
      if (sd) {
        try {
          const j = JSON.parse(sd);
          if (j && Array.isArray(j.awarded)) awarded = j.awarded;
        } catch(_) {}
      }
      if (loc && sceneExists(loc)) sceneId = loc;
    }
  } catch(_) {}

  // 2) Fallback: local save
  if (!sceneId) {
    const saved = readSave && readSave();
    if (saved?.lastScene && sceneExists(saved.lastScene)) {
      sceneId = saved.lastScene;
      if (Array.isArray(saved.awarded)) awarded = saved.awarded;
    }
  }

  const ok = !!sceneId;
  btn.disabled = !ok;
  btn.textContent = 'Resume game';

  if (!ok) { btn.onclick = null; return; }

  // 3) Click → apply awards (so % is correct), then resume
btn.onclick = () => {
  try {
    // keep local mirror in sync for non-LMS use
    const saved = (readSave && readSave()) || {};
    saved.lastScene = sceneId;
    if (Array.isArray(awarded)) saved.awarded = awarded;
    else if (window.__awarded instanceof Set) saved.awarded = Array.from(window.__awarded);
    if (typeof writeSave === 'function') writeSave(saved);
  } catch(_) {}
  // then call your existing resume path (you already had this)
  if (typeof window.tryResume === 'function') return window.tryResume(sceneId, awarded);
  if (typeof hideHome === 'function') hideHome();
  if (typeof window.loadScene === 'function') window.loadScene(sceneId);
};

}



  // Hook loadScene to keep lastScene fresh
  (function installLoadSceneHook() {
    const original = window.loadScene;
    if (typeof original !== 'function') {
      // If this runs before loadScene is defined, try again later.
      let tries = 0;
      (function wait() {
        if (typeof window.loadScene === 'function') {
          install(); return;
        }
        if (tries++ > 200) return; // give up silently
        setTimeout(wait, 30);
      })();
      return;
    }
    install();

    function install() {
      const orig = window.loadScene;
      window.loadScene = function (id) {
        const r = orig.apply(this, arguments);
        try { updateSpeechUIForScene(id); } catch(_) {}
        const saved = readSave() || {};
        saved.lastScene = id;
        if (window.progress) {
          saved.flags    = window.progress.flags || saved.flags || {};
          saved.unlocked = Array.from(window.progress.unlocked || saved.unlocked || []);
        }
        writeSave(saved);
        try { updateResumeButton(); } catch {}
        return r;
      };
    }
  })();

  // Expose a quick dev reset (optional)
  window.resetProgressToHome = function() {
    localStorage.removeItem(SAVE_KEY);
    showHome();
  };
})();



// === Add-ons: persistence + QA overlay + scene validator ===
(function () {
  const STORAGE_KEY = 'game_progress_v1';

  // 1) Ensure a progress object exists (and normalize types)
  if (!window.progress) {
    window.progress = { flags: {}, unlocked: new Set(['scene1']) };
  } else if (!(progress.unlocked instanceof Set)) {
    progress.unlocked = new Set(progress.unlocked || ['scene1']);
  }

  // 2) Load saved progress
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      progress.flags = saved.flags || {};
      progress.unlocked = new Set(saved.unlocked || ['scene1']);
    }
  } catch (e) { console.warn('Progress load failed:', e); }

  function saveProgress() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ flags: progress.flags, unlocked: Array.from(progress.unlocked) })
      );
    } catch (e) { console.warn('Progress save failed:', e); }
  }

  // 3) Ensure/augment helpers (wrap existing to add auto-save)
  if (typeof window.setFlag !== 'function') {
    window.setFlag = function setFlag(name, val = true) {
      progress.flags[name] = !!val;
      saveProgress();
    };
  } else {
    const _setFlag = window.setFlag;
    window.setFlag = function (name, val = true) { _setFlag(name, val); saveProgress(); };
  }

  if (typeof window.unlockScene !== 'function') {
    window.unlockScene = function unlockScene(id) {
      if (id) progress.unlocked.add(id);
      saveProgress();
    };
  } else {
    const _unlockScene = window.unlockScene;
    window.unlockScene = function (id) { _unlockScene(id); saveProgress(); };
  }

  window.hasFlag = window.hasFlag || function hasFlag(name) { return !!progress.flags[name]; };
  window.isUnlocked = window.isUnlocked || function isUnlocked(id) { return progress.unlocked.has(id); };



// 4) QA overlay (Shift+Q to toggle)
(function () {
  let visible = false;
  window.toggleQA = function toggleQA() {
    visible = !visible;
    let el = document.getElementById('qa-overlay');
    if (visible) {
      if (!el) {
        el = document.createElement('pre');
        el.id = 'qa-overlay';
        el.style.cssText =
          'position:fixed;right:8px;bottom:8px;max-width:40vw;max-height:40vh;overflow:auto;' +
          'background:#000a;color:#0ff;padding:8px;border:1px solid #0ff;font:12px/1.4 monospace;z-index:99999;';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify({
        currentSceneId: window.currentSceneId,
        flags: progress.flags,
        unlocked: Array.from(progress.unlocked)
      }, null, 2);
    } else if (el) {
      el.remove();
    }
  };
})();

// === Resume Game (drop-in) ===
(function () {
  const SAVE_KEY = 'game_progress_v1';

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
    catch { return null; }
  }
  function writeSave(obj) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); }
    catch {}
  }

  function hideHome() {
    const overlay = document.getElementById('overlay') || document.querySelector('#overlay-content')?.parentElement;
    const game = document.getElementById('game-container');
    if (overlay) overlay.style.display = 'none';
    if (game) game.style.display = 'block';
  }
  function showHome() {
    const overlay = document.getElementById('overlay') || document.querySelector('#overlay-content')?.parentElement;
    const game = document.getElementById('game-container');
    if (game) game.style.display = 'none';
    if (overlay) overlay.style.display = 'grid'; // or 'block' depending on your CSS
  }
  window.showHome = window.showHome || showHome; // expose for convenience

  function updateResumeButton() {
    const btn = document.getElementById('resume-btn');
    if (!btn) return;
    const saved = readSave();
    const last = saved?.lastScene;
    if (last) {
      btn.disabled = false;
      btn.textContent = 'Resume game';
      btn.onclick = () => { hideHome(); loadScene(last); };
    } else {
      btn.disabled = true;
      btn.textContent = 'Resume game';
      btn.onclick = null;
    }
  }

// --- Hydrate awards from LMS once per session ---
(function hydrateAwardsOnce(){
  if (window.__awardsHydrated) return;
  window.__awardsHydrated = true;

  try {
    if (window.SCORM && SCORM.init && SCORM.init()) {
      const sd = SCORM.get && SCORM.get("cmi.suspend_data");
      if (sd) {
        try {
          const j = JSON.parse(sd);
          if (j && Array.isArray(j.awarded) && j.awarded.length) {
            window.__awarded = new Set(j.awarded);
            // make sure current % reflects hydrated awards
            if (typeof window.__reconcileAwardsToScore === "function") {
              window.__reconcileAwardsToScore();
            }
            console.log("[Resume] Hydrated awards from LMS:", j.awarded.length);
          }
        } catch(_) {}
      }
    }
  } catch(_) {}
})();
 
  // Always land on homepage on fresh load (no auto-start)
 window.addEventListener('DOMContentLoaded', () => {
  try { SCORM.init(); } catch(_) {}
  try { if (typeof hydrateResumeFromLMSOnce === 'function') hydrateResumeFromLMSOnce(); } catch(_){}

  showHome();
  updateResumeButton();
});


  // Hook loadScene so every scene change updates the save (incl. lastScene)
  (function installLoadSceneHook() {
    const original = window.loadScene;
    if (typeof original !== 'function') return; // will still work once loadScene exists if you move this below its def.

    window.loadScene = function (id) {
      const result = original.apply(this, arguments);
      try { updateSpeechUIForScene(id); } catch(_) {}

      // Persist lastScene + flags/unlocked if available
      const saved = readSave() || {};
      saved.lastScene = id;
      if (window.progress) {
        saved.flags = window.progress.flags || saved.flags || {};
        saved.unlocked = Array.from(window.progress.unlocked || saved.unlocked || []);
      }
      writeSave(saved);

      // Keep the homepage Resume button fresh if user returns there later
      try { updateResumeButton(); } catch {}
      return result;
    };
  })();

  // Optional: if your Play button isn’t already wired, you can do:
  // document.querySelector('#overlay-content .button-group button.play')
  //   ?.addEventListener('click', () => { hideHome(); window.safeStartGame ? safeStartGame() : startGame(); });

})();

(function addQAShortcut() {
  if (window.__qaShortcutAdded) return;
  window.__qaShortcutAdded = true;
  document.addEventListener('keydown', function (e) {
    if (e.shiftKey && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      window.toggleQA();
    }
  });
})();

// === CRM mini-store (state + persistence + pub/sub) ===
(function initCRM() {
  const KEY = 'crm_state_v1';

  const defaultState = {
    kpis: { revenue: 0, churn: 0, satisfaction: 50 },
    bars: { satisfaction: [ { label: 'Eng', value: 68 }, { label: 'Sales', value: 74 }, { label: 'Ops', value: 62 } ] },
    pies: { satisfactionSplit: [ { label: 'Satisfied', value: 60 }, { label: 'Neutral', value: 25 }, { label: 'Dissatisfied', value: 15 } ] },
    tables: { tickets: [['#812','Resolved','5m'], ['#905','Escalated','24h']] }
  };

  const listeners = new Set();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return raw ? deepMerge(structuredClone(defaultState), raw) : structuredClone(defaultState);
    } catch { return structuredClone(defaultState); }
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(window.crm.state)); } catch {} }
  function notify() { listeners.forEach(fn => { try { fn(window.crm.state); } catch {} }); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function setByPath(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function apply(delta) {
    if (!delta) return;
    const st = window.crm.state;

    if (delta.kpis && typeof delta.kpis === 'object') {
      for (const [k, v] of Object.entries(delta.kpis)) {
        st.kpis[k] = (Number(st.kpis[k]) || 0) + Number(v || 0);
      }
    }
    if (delta.set && typeof delta.set === 'object') {
      for (const [path, val] of Object.entries(delta.set)) setByPath(st, path, val);
    }
    if (delta.appendRows && typeof delta.appendRows === 'object') {
      for (const [tableId, rows] of Object.entries(delta.appendRows)) {
        if (!Array.isArray(st.tables[tableId])) st.tables[tableId] = [];
        st.tables[tableId].push(...rows);
      }
    }
    save();
    notify();
  }

  function deepMerge(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return b.slice();
    if (a && typeof a === 'object' && b && typeof b === 'object') {
      for (const k of Object.keys(b)) a[k] = deepMerge(a[k], b[k]);
      return a;
    }
    return b === undefined ? a : b;
  }

  window.crm = {
    state: load(),
    apply,
    subscribe,
    reset() { window.crm.state = structuredClone(defaultState); save(); notify(); },
    save
  };
})();


  (function addQAShortcut() {
    if (window.__qaShortcutAdded) return;
    window.__qaShortcutAdded = true;
    document.addEventListener('keydown', function (e) {
      if (e.shiftKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        window.toggleQA();
      }
    });
  })();

  // 5) Scene graph validator (warns only)
  window.validateScenes = window.validateScenes || function validateScenes() {
    if (!window.scenes) return;
    const ids = new Set(Object.keys(window.scenes));
    for (const [id, sc] of Object.entries(window.scenes)) {
      (sc.choices || []).forEach(c => {
        if (c.next && !ids.has(c.next)) console.warn(`[validateScenes] Missing choice target: ${id} → ${c.next}`);
      });
      if (sc.next && !ids.has(sc.next)) console.warn(`[validateScenes] Missing next: ${id} → ${sc.next}`);
      if (sc.endings) {
        ['high', 'medium', 'low'].forEach(k => {
          const dest = sc.endings[k];
          if (dest && !ids.has(dest)) console.warn(`[validateScenes] Missing ending target: ${id}.${k} → ${dest}`);
        });
      }
    }
  };

  // Run once after scenes load
  window.validateScenes();
})();

;(()=>{ // === Choice Target Stamper — Safe v2 ===
  if (window.__ctsInstalled) return; 
  window.__ctsInstalled = true;

  // Helpers
  const norm = s => String(s||'').toLowerCase()
    .replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g,' ').trim();

  function getScene(id){
    const scs = window.scenes || {};
    return Array.isArray(scs) ? scs.find(x=>x && x.id===id) : scs[id];
  }

  function stampTargets(){
    try{
      const host = document.querySelector('#choices-container');
      if (!host) return;
      const style = window.getComputedStyle(host);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const btns = host.querySelectorAll('.choice');
      if (!btns.length) return;

      const id = window.currentSceneId;
      const sc = getScene(id);
      if (!sc) return;

      // Build a text → next model from the scene’s choices
      const list = Array.isArray(sc.choices) ? sc.choices : [];
      const model = list.map((c, i)=>({
        idx:i,
        head:norm(String(c.text||'').slice(0,120)),
        next:String(c.next||'')
      }));

      // Ensure weak map
      if (!(window.__choiceNextMap instanceof WeakMap)) {
        window.__choiceNextMap = new WeakMap();
      }

      btns.forEach((b, uiIdx) => {
        let target = b.getAttribute('data-next') || '';
        if (target) { window.__choiceNextMap.set(b, target); return; }

        // 1) originIndex → scene.choices[originIndex].next
        const oiAttr = b.getAttribute('data-originIndex') || b.getAttribute('data-originindex');
        const oi = Number(oiAttr);
        if (Number.isFinite(oi) && model[oi] && model[oi].next) {
          target = model[oi].next;
        }

        // 2) fallback: text-head match
        if (!target) {
          const head = norm(String(b.textContent||'').slice(0,120));
          const hit = model.find(m => m.head && (head.startsWith(m.head) || m.head.startsWith(head) || head.includes(m.head) || m.head.includes(head)));
          if (hit && hit.next) target = hit.next;
        }

        // 3) last ditch: match by UI index if shuffle OFF (won’t fire if shuffled)
        if (!target && list[uiIdx] && list[uiIdx].next) {
          target = list[uiIdx].next;
        }

        if (target) {
          b.setAttribute('data-next', target);
          window.__choiceNextMap.set(b, target);
        }
      });
    } catch(e){
      console.warn('[CTS] stamp error:', e);
    }
  }

  // Respond to loaders that announce readiness
  document.addEventListener('choices-ready', () => {
    // small delay lets buttons finish painting
    setTimeout(stampTargets, 30);
  }, { passive:true });

  // Also watch DOM changes inside game container (covers loaders that don’t emit)
  const gc = document.getElementById('game-container');
  if (gc) {
    const mo = new MutationObserver((muts)=>{
      // Only care when choice buttons appear
      const relevant = muts.some(m =>
        [...m.addedNodes||[]].some(n =>
          (n.nodeType===1) && (n.matches?.('#choices-container,.choice') || n.querySelector?.('.choice'))
        )
      );
      if (relevant) setTimeout(stampTargets, 30);
    });
    mo.observe(gc, { childList:true, subtree:true });
    window.__ctsCleanup = ()=> mo.disconnect();
  }
})();


// === Game start setup ===
let currentSceneId = "scene1";

function startGame() {
  const overlay = document.getElementById("overlay-content");
  const gameContainer = document.getElementById("game-container");

  if (overlay) overlay.style.display = "none";
  if (gameContainer) gameContainer.style.display = "block";

  if (window.BGM) window.BGM.pauseForGameStart();

  // loadScene will decide if speech UI is shown
  loadScene(currentSceneId);
}


// === Utilities ===
function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}

function prepAudioElement(audioEl) {
  if (!audioEl || audioEl.__preppedAudio) return;
  audioEl.__preppedAudio = true;
  try {
    if (!audioEl.preload || audioEl.preload === 'none') {
      audioEl.preload = 'auto';
    }
  } catch (_) {}
  try { audioEl.load(); } catch (_) {}
  let unlocked = false;
  const markUnlocked = () => { unlocked = true; };
  audioEl.addEventListener('play', markUnlocked, { passive: true });
  audioEl.addEventListener('ended', markUnlocked, { passive: true });
  audioEl.addEventListener('seeking', () => {
    if (!unlocked) {
      try { audioEl.currentTime = 0; } catch (_) {}
    }
  }, { passive: true });
}
// Helper to clean words of problematic Unicode characters
function cleanWord(word) {
  // Replace non-breaking spaces and remove non-ASCII chars
  return word.replace(/\u00A0/g, ' ').replace(/[^\x00-\x7F]/g, '');
}
// Helper to clean words of problematic Unicode characters
function cleanWord(word) {
  return word.replace(/\u00A0/g, ' ').replace(/[^\x00-\x7F]/g, '');
}

// Clean all relevant arrays in all scenes
function cleanScenesData(scenesObj) {
  for (const key in scenesObj) {
    if (!scenesObj.hasOwnProperty(key)) continue;
    const scene = scenesObj[key];
    if (!scene) continue;

    if (scene.sentence && Array.isArray(scene.sentence)) {
      scene.sentence = scene.sentence.map(word => cleanWord(word));
    }
    if (scene.options && Array.isArray(scene.options)) {
      scene.options = scene.options.map(word => cleanWord(word));
    }
    if (scene.correct && Array.isArray(scene.correct)) {
      scene.correct = scene.correct.map(word => cleanWord(word));
    }
    if (scene.scramble && Array.isArray(scene.scramble)) {
      scene.scramble = scene.scramble.map(word => cleanWord(word));
    }
  }
}
// --- SCORM compatibility shim (bridges to __scorm if SCORM not present) ---
(function(){
  if (!window.SCORM && window.__scorm) {
    window.SCORM = {
      init:   () => __scorm.init(),
      set:    (k,v) => __scorm.set(k,v),
      get:    (k) => __scorm.get(k),
      commit: () => __scorm.commit(),
      finish: (status, raw) => __scorm.finish({ status, score: raw })
    };
    console.log("[SCORM shim] window.SCORM bridged to __scorm");
  }
})();







// === One-time hydrate from LMS (DON'T reconcile/publish here) ===
(function(){
  let done = false;
  window.hydrateResumeFromLMSOnce = function(){
    if (done) return;
    if (window.__FRESH_START__) { return; } 
    try {
      if (typeof inLMS === "function" && inLMS() && SCORM && SCORM.init && SCORM.init()) {
        const loc = SCORM.get && SCORM.get("cmi.core.lesson_location");
        const sd  = SCORM.get && SCORM.get("cmi.suspend_data");

        // read awards from LMS
        let fromLMS = null;
        if (sd && sd.trim()) {
          try {
            const j = JSON.parse(sd);
            if (j && Array.isArray(j.awarded)) fromLMS = new Set(j.awarded);
          } catch(_) {}
        }

        // merge LMS awards with any local awards WITHOUT publishing
        if (fromLMS) {
          let merged = new Set();
          try {
            const raw = localStorage.getItem(typeof AWARD_KEY === "string" ? AWARD_KEY : "awarded_scenes_v2");
            if (raw) {
              const arr = JSON.parse(raw);
              if (Array.isArray(arr)) arr.forEach(x => merged.add(x));
            }
          } catch(_) {}
          fromLMS.forEach(x => merged.add(x));

          // set in-memory only — no SCORM.set(), no reconcile here
          window.__awarded = merged;

          // cache locally for your non-LMS resume button
          try {
            if (typeof awardPersistSave === 'function') awardPersistSave();
            if (typeof writeLocalProgress === 'function') {
              writeLocalProgress({
                awarded: Array.from(merged),
                lastScene: (typeof sceneExists === 'function' && sceneExists(loc)) ? loc : (window.currentSceneId || 'scene1')
              });
            }
          } catch(_) {}

          console.log("[Resume] Hydrated (quiet) from LMS:", merged.size, "bookmark:", loc || "(none)");
          window.__HYDRATED_FROM_LMS__ = true;
        } else {
          console.log("[Resume] No LMS awards to hydrate (quiet).");
        }
      }
    } catch(_){}
    done = true;
  };
})();


// --- SAFETY SHIM: tolerate accidental Element passed to querySelector ---
(function(){
  if (window.__qsShimInstalled) return; window.__qsShimInstalled = true;
  const _qs = Document.prototype.querySelector;
  Document.prototype.querySelector = function(sel){
    // If someone passed an Element instead of a selector, just return it.
    if (sel && typeof sel === 'object' && sel.nodeType === 1) return sel;
    if (typeof sel !== 'string') return null;
    try { return _qs.call(this, sel); } catch(e) { console.warn('[qs-shim]', e?.message||e); return null; }
  };
})();
// --- CHOICE TARGET STAMPER (scene.choices → button.dataset.next) ---
function stampChoiceNextTargetsFromScene(scene, host){
  try {
    if (!scene || !host) return;
    const btns = host.querySelectorAll && host.querySelectorAll('.choice');
    if (!btns || !btns.length) return;
    const model = Array.isArray(scene.choices) ? scene.choices.map(c=>({
      head: String(c.text||'').trim().slice(0,160).toLowerCase(),
      next: c.next || ''
    })) : [];

    btns.forEach((b) => {
      if (!b) return;
      // If already stamped, keep it.
      if (b.getAttribute('data-next')) return;

      const txt  = (b.textContent||'').trim();
      const head = txt.slice(0,160).toLowerCase();

      // 1) text-head match (robust, works with shuffle)
      const hit = model.find(m =>
        m.head === head || head.startsWith(m.head) || m.head.startsWith(head) || head.includes(m.head) || m.head.includes(head)
      );

      const target = (hit && hit.next) ? hit.next : '';
      if (target) {
        b.setAttribute('data-next', target);
        try {
          // keep weak map compatibility if your speech hook uses it
          window.__choiceNextMap = window.__choiceNextMap || new WeakMap();
          window.__choiceNextMap.set(b, target);
        } catch(_) {}
      }
    });
  } catch(_) {}
}

function playSceneTransition() {
  const container = document.getElementById('game-container');
  if (!container) return;

  // remove class to restart animation if it's already there
  container.classList.remove('scene-enter');
  // force reflow so the browser sees it as "re-added"
  void container.offsetWidth;
  container.classList.add('scene-enter');
}


// === Main scene loader ===
function loadScene(id) {
  console.log(`\n>>> loadScene called with ID: "${id}"`);
  const scene = scenes[id];
  // Mark as 'incomplete' on first playable scene of the course
    playSceneTransition(); // <- add this line
try {
  if (SCORM.init()) {
    const status = SCORM.get && SCORM.get("cmi.core.lesson_status");
    if (!status || status === "not attempted" || status === "unknown") {
      SCORM.set("cmi.core.lesson_status", "incomplete");
      SCORM.commit();
    }
  }
} catch (_) {}


  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }
  currentSceneId = id;
    // === Per-scene speech gating ===
      currentSceneId = id;

  // === Per-scene speech gate ===
  if (scene.disableSpeech === true && scene.enableSpeech !== true) {
    hardDisableSpeechForScene();
  } else {
    // Only re-enable if not explicitly disabled
    softEnableSpeechForScene();
  }

  try {
    if (typeof ensureSpeechUI === 'function') {
      // Only these types get speech by default
      const allowTypes = new Set([
        'hangman',
        'interaction',
        'interaction-scramble',
        'interaction-fill-in-the-blank',
        'interaction-audio-mc',      // text-based MC; audio-only ones should set disableSpeech:true
        'video-choice',
        'video-multi-question',
        'video-multi-audio-choice',
        'video-scramble',
        'video-fill-in-the-blank',
        'text'
      ]);

      // Decide if this scene is allowed to show speech UI
      const allow =
        scene.enableSpeech === true ||                 // explicit opt-in
        (allowTypes.has(scene.type) && scene.disableSpeech !== true);

      const hud     = document.getElementById('speech-hud');
      const panel   = document.getElementById('speech-settings');
      const testBtn = document.getElementById('speech-test');

      if (allow) {
        // Make sure UI exists and is visible
        ensureSpeechUI();
        if (hud)     hud.style.display = '';
        if (panel)   panel.style.display = '';
        if (testBtn) testBtn.style.display = '';
      } else {
        // Hard-hide on scenes that shouldn't expose speech
        if (hud)     hud.style.display = 'none';
        if (panel)   panel.style.display = 'none';
        if (testBtn) testBtn.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('[speech-gate] error:', e);
  }

  try {
  updateSpeechUIForScene(scene);
} catch (e) {
  console.warn('[SpeechUI] updateSpeechUIForScene failed:', e);
}


try { updateSpeechUIForScene(scene); } catch (e) {
  console.warn('[SpeechUI] updateSpeechUIForScene failed:', e);
}




// --- DENOMINATOR FIRST, THEN PUBLISH CURRENT % ONCE ---
try {
  // Ensure denominator exists
  if (!(window.score && Number.isFinite(window.score.max) && window.score.max > 0)) {
    let total = 0;
    const all = window.scenes || {};
    for (const sc of Object.values(all)) {
      const pts = Number(sc && sc.awardOnEnter);
      if (Number.isFinite(pts) && pts > 0) total += pts;
    }
    window.__TOTAL_AWARD_MAX = total;
    window.score = window.score || { cur: 0, max: 0 };
    window.score.max = total;
    console.log("[Score] denominator set in loadScene →", total);
  }

  // Publish whatever the current % is (even if 0%)
  if (typeof window.__reconcileAwardsToScore === "function") {
    window.__reconcileAwardsToScore();
  }
} catch (_) {}




/* SCORM resume point */
try {
  if (SCORM.init()) {
    // Always save resume point
    SCORM.set("cmi.core.lesson_location", id);
    // Mirror awards to LMS (merge, don’t clobber)
    try {
      if (typeof writeLMSState === 'function') {
        // Helper will merge existing LMS awards + in-memory awards, then commit
        writeLMSState({ sceneId: id, awarded: window.__awarded });
      } else {
        // Inline fallback merge (safe if helper isn’t present)
        let existing = [];
        try {
          const sd = SCORM.get("cmi.suspend_data");
          if (sd) {
            const j = JSON.parse(sd);
            if (j && Array.isArray(j.awarded)) existing = j.awarded;
          }
        } catch (_) {}

        const merged = new Set(existing);
        for (const x of Array.from(window.__awarded || [])) merged.add(x);

        const payload = JSON.stringify({ awarded: Array.from(merged) }).slice(0, 4000);
        SCORM.set("cmi.suspend_data", payload);
        // Keep the bookmark aligned too
        SCORM.set("cmi.core.lesson_location", String(id));
        SCORM.commit();
        console.log("[SCORM] suspend_data merged; awards:", merged.size);
      }
    } catch (_) {}

// If this scene is marked as the end, post completion + score
// HARD GATE: only allow finish on the true final scene id
// --- FINALIZATION GATE (replaces your old block completely) ---
const isFinalScene  = (id === "thank_you_scene");
const isEndish      = !!(scene && (scene.endOfCourse === true || scene.completeOnEnter === true));
const finishOnEnter = (scene && scene.finishOnEnter !== false); // default true; set false in scene to defer finish

function computeRawPercent() {
  try {
    const cur = Number(window.score?.cur ?? (window.scoreCurrent ? window.scoreCurrent() : 0));
    const max = Number(window.score?.max ?? (window.scoreMax ? window.scoreMax() : 0));
    if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) return Math.round((cur / max) * 100);
    if (Number.isFinite(scene?.scoreRaw)) return Number(scene.scoreRaw);
  } catch(_) {}
  return Number.isFinite(scene?.scoreRaw) ? Number(scene.scoreRaw) : 100;
}

// Mastery (threshold) reader: prefer LMS, else course default, else 75
function readMastery() {
  // Course-level default you set elsewhere: window.__MASTERY = 75;
  let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;

  try {
    const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
    if (m !== undefined && m !== null && m !== "" && !isNaN(+m)) {
      return +m; // LMS wins if it provides a number
    }
  } catch (_) {}

  return mastery; // fallback (75 by default)
}


function finalizeAttempt() {
  // Recompute % fresh
  let raw = 0;
  try {
    const cur = Number(window.score?.cur ?? (window.scoreCurrent ? window.scoreCurrent() : 0));
    const max = Number(window.score?.max ?? (window.scoreMax ? window.scoreMax() : 0));
    raw = (Number.isFinite(cur) && Number.isFinite(max) && max > 0) ? Math.round((cur / max) * 100) : 0;
  } catch(_) {}

  // mastery: LMS > default(75)
  let mastery = (typeof window.__MASTERY === "number") ? window.__MASTERY : 75;
  try {
    const m = SCORM.get && SCORM.get("cmi.student_data.mastery_score");
    if (m && !isNaN(+m)) mastery = +m;
  } catch(_) {}

  const already = (SCORM.get && SCORM.get("cmi.core.lesson_status")) || "unknown";
  const passNow = (raw >= mastery);

  // Score first
  SCORM.set("cmi.core.score.raw", String(raw));

  // Never demote a previously-passed attempt
  if (already === "passed") {
    // leave as passed
  } else if (passNow) {
    SCORM.set("cmi.core.lesson_status", "passed");
  } else {
    SCORM.set("cmi.core.lesson_status", "failed");
  }

  // final bookmark
  if (window.currentSceneId) {
    SCORM.set("cmi.core.lesson_location", String(window.currentSceneId));
  }

  // finish
  if (typeof SCORM.finish === "function") {
    SCORM.finish({ status: SCORM.get("cmi.core.lesson_status"), score: raw });
  } else {
    SCORM.commit();
  }
}

// call finalize when we enter the true end scene
if (isEndish && isFinalScene) {
  if (finishOnEnter) {
    finalizeAttempt();
  } else {
    // if you ever set finishOnEnter:false on the scene, just bookmark/commit here
    SCORM.commit();
  }
}




  } else {
    console.warn("[SCORM] init() returned false (API not found in this launch)");
  }
} catch (e) {
  console.warn("[SCORM] error in loadScene hook:", e);
}


// --- Milestone award-on-enter (fires once per scene id) ---
try {
  const pts = Number(scene && scene.awardOnEnter);  // e.g., 2
  const wasAwarded = !!(window.__awarded && window.__awarded.has && window.__awarded.has(id));
  console.log("[AWARD?] enter", id, "awardOnEnter:", pts, "alreadyAwarded:", wasAwarded);

  if (pts > 0 && !wasAwarded) {
    // 1) update in-memory points
    if (window.__awarded && window.__awarded.add) window.__awarded.add(id);
    scoreAdd(pts);

    // 2) persist local overlay resume (optional)
    if (typeof awardPersistSave === 'function') awardPersistSave();
    try {
      if (typeof writeLocalProgress === 'function') {
        writeLocalProgress({
          awarded: Array.from(window.__awarded || []),
          lastScene: id
        });
      }
    } catch (_) {}

    // 3) ✅ single helper merges awards + bookmarks to LMS (no manual SCORM.set/commit here)
    writeLMSState({ sceneId: id, awarded: window.__awarded });

    // 4) publish % to LMS/UI
    if (typeof window.__reconcileAwardsToScore === "function") {
      window.__reconcileAwardsToScore();
    }

    console.log("[AWARD✅]", id, "→ now cur/max:", window.scoreCurrent(), "/", window.scoreMax());
  } else {
    console.log("[AWARD…skip]", id, "cur/max:", window.scoreCurrent(), "/", window.scoreMax());
  }
} catch (e) {
  console.warn("[AWARD ERR]", e);
}




// (leave everything below as you already have it)
try { progress.lastSceneId = id; if (typeof saveProgressNow === 'function') saveProgressNow(); } catch(_){}

if (Array.isArray(scene.onEnterUnlockScenes)) scene.onEnterUnlockScenes.forEach(unlockScene);
if (Array.isArray(scene.onEnterSetFlags)) scene.onEnterSetFlags.forEach(setFlag);

// Apply CRM deltas on enter (optional per scene)
try {
  if (scene.applyCrm) window.crm && window.crm.apply(scene.applyCrm);
} catch (e) { console.warn('CRM apply (onEnter) failed', e); }


  // === UNIVERSAL CLEANUP AT START ===
  console.log('[onEnter]', {
    sceneId: id,
    setFlags: scene.onEnterSetFlags || [],
    unlockScenes: scene.onEnterUnlockScenes || [],
    flagsNow: { ...progress.flags },
    unlockedNow: Array.from(progress.unlocked || [])
  });

  // Remove and clean audio player if present
  const audioElem = document.getElementById("scene-audio");
  if (audioElem) {
    audioElem.pause();
    audioElem.src = "";
    audioElem.load();
    audioElem.remove();
  }

  // Grab all containers safely
  const sceneImage = document.getElementById("scene-image");
  const sceneText = document.getElementById("scene-text");
  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const infoDiv = document.getElementById("challenge-info");
  const choicesDiv = document.getElementById("choices-container");
  const scene6UI = document.getElementById("scene6-ui");
  const gameContainer = document.getElementById("game-container");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");

  // Clear and hide all relevant containers to prevent UI seepage
  [
    container,
    sceneImage,
    sceneText,
    infoDiv,
    choicesDiv,
    scrambleDiv,
    feedbackDiv,
    fillBlankContainer,
    scene6UI
  ].forEach(el => {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  });

  // Clear video multi-question UI if present
  const questionUI = document.getElementById("video-question-ui");
  if (questionUI) {
    questionUI.style.display = "none";
    questionUI.innerHTML = "";
  }

  // Remove or hide video player if present
  const videoElem = document.getElementById("scene-video");
  if (videoElem) {
    videoElem.pause();
    videoElem.src = "";
    videoElem.load();
    videoElem.remove(); // completely remove from DOM
  }

  // --- Hangman teardown (prevents elements seeping across scenes) ---
  const hm = document.getElementById('hangman');
  if (hm) hm.remove();
  if (window.__hmKeyHandler) {
    document.removeEventListener('keydown', window.__hmKeyHandler);
    window.__hmKeyHandler = null;
  }

  // --- Survivor teardown (prevents seepage) ---
  if (window.__svCleanup) { window.__svCleanup(); window.__svCleanup = null; }
  const svWrap = document.getElementById('survivor-quiz');
  if (svWrap) svWrap.remove();

  // --- Conjugation Race teardown (prevents seepage) ---
  if (window.__crCleanup) { window.__crCleanup(); window.__crCleanup = null; }
  const crWrap = document.getElementById('conj-race');
  if (crWrap) crWrap.remove();

  // --- Hotspots teardown (prevents seepage) ---
  if (window.__hsCleanup) { window.__hsCleanup(); window.__hsCleanup = null; }
  const hsWrap = document.getElementById('hotspots');
  if (hsWrap) hsWrap.remove();

  // --- Buckets teardown (prevents seepage) ---
  if (window.__bkCleanup) { window.__bkCleanup(); window.__bkCleanup = null; }
  const bkWrap = document.getElementById('buckets');
  if (bkWrap) bkWrap.remove();

  // --- Particle Swapper teardown (prevents seepage) ---
  if (window.__psCleanup) { window.__psCleanup(); window.__psCleanup = null; }
  const psWrap = document.getElementById('particle-swapper');
  if (psWrap) psWrap.remove();

  // --- Comic Bubbles teardown (prevents seepage) ---
  if (window.__cbCleanup) { window.__cbCleanup(); window.__cbCleanup = null; }
  const cbWrap = document.getElementById('comic-bubbles');
  if (cbWrap) cbWrap.remove();

  // --- Dashboard teardown (prevents seepage) ---
  if (window.__dashCleanup) { window.__dashCleanup(); window.__dashCleanup = null; }
  const dashWrap = document.getElementById('dashboard-wrap');
  if (dashWrap) dashWrap.remove();

    // === TRANSIENTS: nuke anything registered by loaders (Step 2) ===
  if (window.cleanupTransients) cleanupTransients();

  // Extra: destroy any global Sortable handle we might have left around
  try {
    if (window.scrambleSortable && typeof window.scrambleSortable.destroy === 'function') {
      window.scrambleSortable.destroy();
    }
  } catch(_) {}
  window.scrambleSortable = null;

  // Extra: kill common stray UI blocks some loaders create
  [
    'video-question',
    'video-multi-audio-question-ui',
    'video-multi-question-options',
    'video-multi-question-timer',
    'video-multi-question-feedback'
  ].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });

  // HARD SWEEPER: keep only the canonical containers under #game-container
  (function sweepGameContainer(){
    const gc = document.getElementById('game-container');
    if (!gc) return;
    const keep = new Set([
      'scene-image',
      'scene-text',
      'challenge-info',
      'choices-container',
      'scene6-ui',
      'sentence-scramble',
      'scramble-feedback',
      'sceneFillInTheBlank',
      'scene-container',
      'email-challenge-container'
    ]);
    Array.from(gc.children).forEach(child => {
      // remove anything not in the canonical set
      if (!keep.has(child.id)) child.remove();
    });
  })();


  // === TRANSIENTS: nuke anything registered by loaders (Step 2) ===
  if (window.cleanupTransients) cleanupTransients();

  // Special handling for emailContainer:
  // Clear and hide only if scene.type !== 'email'
  if (emailContainer) {
    if (scene.type !== "email") {
      emailContainer.style.display = "none";
      emailContainer.innerHTML = "";
    } else {
      // For email scenes, keep it visible and intact
      emailContainer.style.display = "block";
    }
  }

  if (gameContainer) gameContainer.style.display = "block";

 // === Unified hero image (works for ALL scene types) ===
{
  const imgHost = sceneImage || document.getElementById("scene-image");
  if (imgHost) {
    if (scene.image) {
      imgHost.style.display = "block";
      const cls = scene.imageClass ? ` class="${scene.imageClass}"` : "";
      imgHost.innerHTML = `<img src="${scene.image}" alt="Scene Image"${cls}>`;
    } else {
      imgHost.style.display = "none";
      imgHost.innerHTML = "";
    }
  }
}


  // Dispatch by scene type
  switch (scene.type) {
    case "interaction":
      loadInteractionScene(id);
      return;

    case "interaction-scramble":
      loadInteractionScrambleScene(id);
      return;

    case "interaction-fill-in-the-blank":
      if (fillBlankContainer) {
        fillBlankContainer.style.display = "block";
        loadInteractionFillBlankScene(id);
      }
      return;

    case "interaction-audio-mc":
      loadInteractionAudioMCScene(id);
      return;

    case "fill-in-the-blank":
      if (fillBlankContainer) {
        fillBlankContainer.style.display = "block";
        loadFillInTheBlankScene(id, fillBlankContainer);
      }
      return;

    case "video":
      loadVideoScene(id);
      return;

    case "video-multi-question":
      loadVideoMultiQuestionScene(id);
      return;

    case "video-multi-audio-choice":
      loadVideoMultiAudioChoiceScene(id);
      return;

    case "video-scramble":
      loadVideoScrambleScene(id);
      return;

    case "video-fill-in-the-blank":
      loadVideoFillBlankScene(id);
      return;
    
    case "audio-scramble":
      loadAudioScrambleScene(id);
      return;


    case "hangman":
      loadHangmanScene(id);
      return;

    case "survivor-quiz":
      loadSurvivorQuizScene(id);
      return;

    case "conjugation-race":
      loadConjugationRaceScene(id);
      return;

    case "image-hotspots":
      loadHotspotsScene(id);
      return;

    case "buckets":
      loadBucketsScene(id);
      return;

    case "particle-swapper":
      loadParticleSwapperScene(id);
      return;

    case "comic-bubbles":
      loadComicBubblesScene(id);
      return;

    case "dashboard":
      loadDashboardScene(id);
      return;

    case "classify-buckets":
      loadBucketsScene(id);
      return;

    case "email":
      loadEmailChallengeScene(id);
      return;

    default:
      break;

      case "video-choice":
  loadVideoChoiceScene(id);
  return;

  }

  // Show text or hide
  if (sceneText) {
    if (scene.text) {
      sceneText.style.display = "block";
      sceneText.textContent = scene.text;
    } else if (scene.render) {
      sceneText.style.display = "none";
    } else {
      sceneText.innerHTML = "";
    }
  }

  // Show image or hide
  if (sceneImage) {
    if (scene.image) {
      sceneImage.style.display = "block";
      const cls = scene.imageClass ? ` class="${scene.imageClass}"` : '';
      sceneImage.innerHTML = `<img src="${scene.image}" alt="Scene Image"${cls}>`;
    } else {
      sceneImage.style.display = "none";
      sceneImage.innerHTML = "";
    }
  }

  // Scramble challenge (existing scramble logic)
 // Scramble challenge (universal scramble logic)
// Scramble challenge (robust + back-compat)
if (
  (scene.type === "scramble" ||
    ((scene.scramble || scene.words || scene.sentence) && scene.correct && scene.next)) &&
  scene.type !== "fill-in-the-blank" &&
  scene.type !== "interaction-scramble"
) {
  if (scrambleDiv && feedbackDiv) {
    scrambleDiv.style.display = "block";
    feedbackDiv.style.display = "block";
    scrambleDiv.innerHTML = "";
    feedbackDiv.innerText = "";

    const instruction = document.createElement("p");
    instruction.className = "scramble-instructions";
    instruction.textContent = "🧩 Drag the words into the correct order:";
    scrambleDiv.appendChild(instruction);

    // Accept any of: scramble[] | words[] | sentence[]
    const source =
      (Array.isArray(scene.scramble) && scene.scramble) ||
      (Array.isArray(scene.words) && scene.words) ||
      (Array.isArray(scene.sentence) && scene.sentence) ||
      [];

    // Normalize correct → array of tokens
    const correctArr = Array.isArray(scene.correct)
      ? scene.correct
      : (typeof scene.correct === "string" ? scene.correct.trim().split(/\s+/) : []);

    if (!source.length || !correctArr.length) {
      console.warn("[Scramble] Missing tokens/correct for:", scene.id);
      feedbackDiv.textContent = "⚠️ This scramble is missing data.";
      feedbackDiv.style.color = "orange";
      return;
    }

    const scrambleContainer = document.createElement("div");
    scrambleContainer.id = "scramble-words";

    const shuffled = shuffleArray(source.slice());
    shuffled.forEach((token) => {
      const span = document.createElement("span");
      span.className = "scramble-word";
      span.textContent = token;
      scrambleContainer.appendChild(span);
    });
    scrambleDiv.appendChild(scrambleContainer);

    try { Sortable.create(scrambleContainer, { animation: 150 }); }
    catch (e) { console.warn("Sortable unavailable; drag disabled.", e); }

    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.onclick = () => checkScrambleAnswer(correctArr, scene.next);
    scrambleDiv.appendChild(checkBtn);
  }
  return;
}



// Choices buttons (with optional gating + CRM apply) + hide "Play again" on final scene in LMS
if (scene.choices && scene.choices.length > 0 && choicesDiv) {
  // If we're on the final scene in an LMS, filter out the "Play again" option
  const hideInFinal = (currentSceneId === "thank_you_scene" && inLMS());
  const list = hideInFinal
    ? scene.choices.filter(c => {
        const label = String(c.text || "").toLowerCase().trim();
        // Hide by label OR by known target scene if you prefer
        return !(label.includes("play again") || c.next === "sceneU");
      })
    : scene.choices;

  if (!list.length) {
    // Nothing to show (e.g., only "Play again" was present) → hide the container
    choicesDiv.style.display = "none";
    choicesDiv.innerHTML = "";
    return;
  }

  choicesDiv.style.display = "block";
  choicesDiv.innerHTML = "";

  list.forEach((choice) => {
    const reqFlags = choice.requiresFlags || [];
    const reqScenes = choice.requiresScenes || [];
    const okFlags = reqFlags.every(hasFlag);
    const okScenes = reqScenes.every(isUnlocked);
    const available = okFlags && okScenes;

    const btn = document.createElement("button");
    btn.textContent = available ? choice.text : `🔒 ${choice.text}`;
    btn.disabled = !available;
    btn.onclick = () => {
      if (!available) return;
      try { if (choice.applyCrm) window.crm && window.crm.apply(choice.applyCrm); }
      catch (e) { console.warn('CRM apply (choice) failed', e); }
      loadScene(choice.next);
    };
    choicesDiv.appendChild(btn);
    try {
  // Stamp navigation targets + arm mic reliably
  stampChoiceNextTargetsFromScene(scene, choicesDiv);
  if (typeof window.__armSpeechForChoices === 'function') {
    window.__armSpeechForChoices(choicesDiv);
  }
} catch(_) {}


    
  });
  return;
}


  // Render function fallback
  if (scene.render && sceneText) {
    sceneText.innerHTML = "";
    scene.render(sceneText);
    return;
  }

  // Text only fallback
  if (scene.text && sceneText) {
    sceneText.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = scene.text;
    sceneText.appendChild(p);
  }




  // Add Play Again button only on final thank you scene (outside switch, after all rendering)
  if (id === "thank_you_scene" && container) {
    container.style.display = "block"; // ensure container visible
    if (!document.getElementById("play-again")) {
      console.log(">>> Adding Play Again button now!");
      const message = document.createElement('p');
      message.textContent = "Thank you for playing! Please click below to play again.";
      container.appendChild(message);

      const playAgainBtn = document.createElement('button');
      playAgainBtn.id = "play-again";
      playAgainBtn.textContent = "Play Again";
      playAgainBtn.style.cssText = `
        margin-top: 20px;
        font-size: 1.2rem;
        padding: 10px 20px;
        background-color: #0ff;
        color: #000;
        border: none;
        cursor: pointer;
      `;
      playAgainBtn.onclick = () => {
        currentSceneId = "scene1"; // Reset to first scene
        loadScene(currentSceneId);
      };
      container.appendChild(playAgainBtn);
    } else {
      console.log(">>> Play Again button already exists.");
    }
  } else {
    console.log(`>>> No Play Again button added on scene "${id}".`);
  }
}

// === UNIVERSAL CHOICE TARGET STAMPER (engine-level, loader-agnostic) ===
(function installChoiceTargetStamper(){
  if (window.__choiceStamperInstalled) return;
  window.__choiceStamperInstalled = true;

  // Normalizer for text matching
  const norm = s => String(s||'')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g,' ')
    .trim();

  function stampIn(container){
    if (!container) return;

    // Current scene model
    const sc = (window.scenes||{})[window.currentSceneId];
    if (!sc || !Array.isArray(sc.choices) || !sc.choices.length) return;

    // Prepare a light model for matching
    const model = sc.choices.map((c, i) => ({
      i,
      head: norm(String(c.text||'').slice(0, 160)),
      next: c && c.next
    }));

    // WeakMap from global, if present
    const wmap = (window.__choiceNextMap instanceof WeakMap) ? window.__choiceNextMap : null;

    // Walk all visible .choice buttons under the container
    const btns = container.querySelectorAll('.choice');
    btns.forEach((b, idx) => {
      // Skip if already stamped
      if (b.getAttribute('data-next')) return;

      let target = '';

      // 1) origin index (handles shuffle that preserves data-originIndex)
      const oiRaw = b.getAttribute('data-originIndex') || b.getAttribute('data-originindex');
      const oi = Number(oiRaw);
      if (!target && Number.isFinite(oi) && model[oi] && model[oi].next) {
        target = model[oi].next;
      }

      // 2) text head match (robust; works when originIndex is missing)
      if (!target) {
        const head = norm((b.textContent||'').slice(0, 160));
        const hit = model.find(m =>
          m.head && (
            head === m.head ||
            head.startsWith(m.head) || m.head.startsWith(head) ||
            head.includes(m.head) || m.head.includes(head)
          )
        );
        if (hit && hit.next) target = hit.next;
      }

      if (target) {
        b.setAttribute('data-next', target);
        b.setAttribute('aria-next', target);
        if (wmap) wmap.set(b, target);
      }
    });
  }

  // Observe additions to the canonical choices host(s)
  const hostSelector = '#choices-container, #vc-choices';
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') {
        // Try stamping whenever children change
        document.querySelectorAll(hostSelector).forEach(stampIn);
      }
    }
  });

  function armObserver(){
    // (Re)attach observer to the game container (covers all scenes)
    const gc = document.getElementById('game-container') || document.body;
    try { mo.disconnect(); } catch(_){}
    mo.observe(gc, { childList:true, subtree:true });
    // Also run a pass now in case choices already exist
    document.querySelectorAll(hostSelector).forEach(stampIn);
  }

  // Run on boot and after every loadScene
  armObserver();

  // Wrap loadScene to stamp after render (without changing its behavior)
  const orig = window.loadScene;
  if (typeof orig === 'function' && !orig.__choiceStampWrapped) {
    const wrapped = function(id){
      const r = orig.apply(this, arguments);
      // After next paint, stamp whatever is on screen
      try {
        requestAnimationFrame(() => {
          document.querySelectorAll(hostSelector).forEach(stampIn);
        });
      } catch(_){}
      return r;
    };
    wrapped.__choiceStampWrapped = true;
    window.loadScene = wrapped;
  }

  // If your loaders fire a "choices-ready" event, respond to it too.
  document.addEventListener('choices-ready', () => {
    document.querySelectorAll(hostSelector).forEach(stampIn);
  });

})();





/* ---------- VIDEO-CHOICE NEXT-TARGET SAFETY NET (global, once) ---------- */
(function installVideoChoiceNextSafetyNet(){
  if (window.__videoChoiceSafetyNetInstalled) return;
  window.__videoChoiceSafetyNetInstalled = true;

  function norm(s){
    return String(s||'').toLowerCase()
      .replace(/[\u2018\u2019]/g,"'")
      .replace(/[\u201C\u201D]/g,'"')
      .replace(/\s+/g,' ')
      .trim();
  }
  function head(s, n=140){ return String(s||'').slice(0,n); }

  function bindNextForCurrentScene(){
    try{
      const id = window.currentSceneId;
      const sc = (window.scenes||{})[id];
      if (!sc || sc.type !== 'video-choice' || !Array.isArray(sc.choices)) return;

      const model = sc.choices.map(c => ({
        text: String(c.text||''),
        head: norm(head(c.text, 160)),
        next: c.next || ''
      }));

      // look in both common containers
      const btns = document.querySelectorAll('#choices-container .choice, #vc-choices .choice');
      btns.forEach(btn=>{
        // already has a target?
        if (btn.getAttribute('data-next')) return;

        // 1) originIndex -> scene.choices[originIndex].next (shuffle-safe if you stamped originIndex)
        const oi = Number(btn.getAttribute('data-originIndex') || btn.getAttribute('data-originindex'));
        if (Number.isFinite(oi) && model[oi] && model[oi].next) {
          const nx = model[oi].next;
          btn.setAttribute('data-next', nx);
          if (window.__choiceNextMap instanceof WeakMap) window.__choiceNextMap.set(btn, nx);
          return;
        }

        // 2) text-head match (robust when shuffle is ON)
        const bHead = norm(head(btn.textContent||'', 160));
        const hit = model.find(m =>
          (bHead && m.head && (bHead.startsWith(m.head) || m.head.startsWith(bHead) || bHead.includes(m.head) || m.head.includes(bHead)))
        );
        if (hit && hit.next){
          btn.setAttribute('data-next', hit.next);
          if (window.__choiceNextMap instanceof WeakMap) window.__choiceNextMap.set(btn, hit.next);
        }
      });
    } catch(e){ console.warn('[video-choice][net] bind error', e); }
  }

  // A) Bind when your loaders announce choices; your code already fires this for video-choice / vmq
  document.addEventListener('choices-ready', bindNextForCurrentScene);

  // B) Also bind on microtask when scene changes (covers loaders that don’t emit choices-ready)
  const origLoad = window.loadScene;
  if (typeof origLoad === 'function'){
    window.loadScene = function(id){
      const r = origLoad.apply(this, arguments);
      // try shortly after render
      setTimeout(bindNextForCurrentScene, 0);
      setTimeout(bindNextForCurrentScene, 50);
      setTimeout(bindNextForCurrentScene, 120);
      return r;
    };
  }

  // C) Last-chance click interceptor (capture) — only for video-choice scenes
  document.addEventListener('click', function(ev){
    const el = ev.target && ev.target.closest && ev.target.closest('.choice');
    if (!el) return;
    const id = window.currentSceneId;
    const sc = (window.scenes||{})[id];
    if (!sc || sc.type !== 'video-choice') return;

    // If button already has a target, let the normal handler proceed
    const already = el.getAttribute('data-next') ||
                    (window.__choiceNextMap instanceof WeakMap && window.__choiceNextMap.get(el)) ||
                    el.getAttribute('aria-next');
    if (already) return;

    // Resolve now by matching text to scene.choices and navigate
    try{
      const model = (sc.choices||[]).map(c => ({
        text: String(c.text||''),
        head: norm(head(c.text, 160)),
        next: c.next || ''
      }));
      const bHead = norm(head(el.textContent||'', 160));
      const hit = model.find(m =>
        (bHead && m.head && (bHead.startsWith(m.head) || m.head.startsWith(bHead) || bHead.includes(m.head) || m.head.includes(bHead)))
      );
      if (hit && hit.next){
        // stamp for future and navigate
        el.setAttribute('data-next', hit.next);
        if (window.__choiceNextMap instanceof WeakMap) window.__choiceNextMap.set(el, hit.next);
        ev.preventDefault(); ev.stopPropagation();
        try { window.loadScene(hit.next); } catch(e){ console.warn('[video-choice][net] force nav failed', e); }
      }
    } catch(e){ console.warn('[video-choice][net] click resolve error', e); }
  }, true);

  console.log('[video-choice] safety-net installed');
})();

























// === Scramble answer check ===
function checkScrambleAnswer(correctOrder, nextSceneId) {
  const words = Array.from(document.querySelectorAll("#scramble-words .scramble-word"));
  const userOrder = words.map((w) => w.textContent.trim());
  const feedback = document.getElementById("scramble-feedback");
  const container = document.getElementById('scene-container');
  const scene = scenes[currentSceneId];  // get current scene

  if (!feedback) return;

  if (arraysEqual(userOrder, correctOrder)) {
    feedback.textContent = "✅ Correct! Moving on...";
    feedback.style.color = "lightgreen";

       // ✅ award unlocks/flags defined on the current scene
    if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
    if (Array.isArray(scene.setFlags)) scene.setFlags.forEach(setFlag);

    setTimeout(() => {
      const nextScene = scenes[nextSceneId];
      if (nextScene && nextScene.type === "interaction") {
        loadInteractionScene(nextSceneId);
      } else {
        loadScene(nextSceneId);
      }
    }, 1000);
  } else {
    feedback.textContent = "❌ Not quite. Try again.";
    feedback.style.color = "salmon";
  }

  if (scene.playAgain && container && !document.getElementById("play-again")) {
    const playAgainBtn = document.createElement('button');
    playAgainBtn.textContent = "Play Again";
    playAgainBtn.id = "play-again";
    playAgainBtn.style.cssText = `
      margin-top: 20px;
      font-size: 1.2rem;
      padding: 10px 20px;
      background-color: #0ff;
      color: #000;
      border: none;
      cursor: pointer;
    `;
    playAgainBtn.addEventListener('click', () => {
      // Reset game variables/state here if needed
      loadScene('scene1');
    });
    container.appendChild(playAgainBtn);
  }
}


// === Drag-and-drop Fill-in-the-Blank ===
function loadFillInTheBlankScene(sceneId, container) {
  const infoDiv = document.getElementById("challenge-info");
  if (infoDiv) {
    infoDiv.style.display = "none";
    infoDiv.innerHTML = "";
  }

  const scene = scenes[sceneId];
  // --- Defensive: build sentence/blanks from "___" if not provided ---
if (!Array.isArray(scene.sentence) || !Array.isArray(scene.blanks)) {
  const parts = String(scene.text || '').split('___');
  const toks = []; const blanks = [];
  const toWords = s => String(s).trim().split(/\s+/).filter(Boolean);
  parts.forEach((seg, i) => {
    if (seg) toks.push(...toWords(seg));
    if (i < parts.length - 1) { blanks.push(toks.length); toks.push('___'); }
  });
  scene.sentence = Array.isArray(scene.sentence) ? scene.sentence : toks;
  scene.blanks   = Array.isArray(scene.blanks)   ? scene.blanks   : blanks;
}
// normalize correct to array
if (typeof scene.correct === 'string') scene.correct = [scene.correct];

  if (!scene) {
    console.error(`Scene ${sceneId} not found.`);
    return;
  }

  // Inject HTML structure into container
  container.innerHTML = `
    <h2>Fill in the Blanks Challenge</h2>
    <p>${scene.text || "Fill in the blanks by dragging the correct options below."}</p>
    <p id="fill-blank-sentence" style="font-size: 1.2rem; line-height: 1.5; margin-bottom: 20px;"></p>
    <div id="fill-blank-options" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
    <button id="check-fill-blank-answer">Check Answer</button>
    <div id="fill-blank-feedback" style="margin-top: 10px; font-weight: bold;"></div>
  `;

  const sentenceEl = container.querySelector("#fill-blank-sentence");
  const optionsEl = container.querySelector("#fill-blank-options");
  const feedbackEl = container.querySelector("#fill-blank-feedback");

  // Destroy any existing Sortable instances before creating new ones
  if (container._sortableBlanks) {
    container._sortableBlanks.forEach(s => s.destroy());
    container._sortableBlanks = null;
  }
  if (container._sortableOptions) {
    container._sortableOptions.destroy();
    container._sortableOptions = null;
  }

  // Render the sentence with blanks as droppable zones
  let html = "";
  for (let i = 0; i < scene.sentence.length; i++) {
    if (scene.blanks.includes(i)) {
      html += `<span class="fill-blank-dropzone" data-index="${i}" style="
        display: inline-block;
        min-width: 80px;
        border-bottom: 2px solid #00ffff;
        margin: 0 4px;
        vertical-align: bottom;
        padding: 4px 6px;
        cursor: pointer;
        background-color: #111;
      "></span> `;
    } else {
      html += `<span style="margin: 0 4px;">${scene.sentence[i]}</span> `;
    }
  }
  sentenceEl.innerHTML = html;

  // Render draggable options
  optionsEl.innerHTML = "";
  scene.options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.className = "fill-blank-option";
    btn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: 2px solid #00ffff;
      background: #000;
      color: #0ff;
      font-weight: bold;
      cursor: grab;
      user-select: none;
    `;
    optionsEl.appendChild(btn);
  });

  // Setup SortableJS for blanks (droppable zones)
  const dropzones = sentenceEl.querySelectorAll(".fill-blank-dropzone");
  container._sortableBlanks = Array.from(dropzones).map(zone => {
    return Sortable.create(zone, {
      group: "fillInTheBlank",
      animation: 150,
      sort: false,
      onAdd: evt => {
        const dragged = evt.item;
        // Remove dragged from options pool when dropped into blank
        if (dragged.parentNode === optionsEl) {
          dragged.parentNode.removeChild(dragged);
        }
        // Ensure only one child in each dropzone
        if (evt.to.children.length > 1) {
          Array.from(evt.to.children).forEach(child => {
            if (child !== dragged) {
              evt.to.removeChild(child);
              optionsEl.appendChild(child);
            }
          });
        }
      },
      onRemove: evt => {
        // Append dragged item back to options pool when removed from blank
        optionsEl.appendChild(evt.item);
      }
    });
  });

  // Setup SortableJS for options container
  container._sortableOptions = Sortable.create(optionsEl, {
    group: "fillInTheBlank",
    animation: 150,
  });

  // Check answer button logic
  container.querySelector("#check-fill-blank-answer").onclick = () => {
    const userAnswers = [];
    let allFilled = true;
    dropzones.forEach(zone => {
      if (zone.children.length === 1) {
        userAnswers.push(zone.children[0].textContent.trim());
      } else {
        allFilled = false;
      }
    });

    if (!allFilled) {
      feedbackEl.textContent = "⚠️ Please fill all blanks.";
      feedbackEl.style.color = "orange";
      return;
    }

    // Compare user answers to correct answers case-insensitively
    const allCorrect = userAnswers.every(
      (ans, i) => ans.toLowerCase() === scene.correct[i].toLowerCase()
    );

    if (allCorrect) {
      feedbackEl.textContent = "✅ Correct! Well done.";
      feedbackEl.style.color = "lightgreen";
            // ✅ award unlocks/flags for this scene
      if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
      if (Array.isArray(scene.setFlags)) scene.setFlags.forEach(setFlag);
      if (scene.next) {
        setTimeout(() => loadScene(scene.next), 1500);
      }
    } else {
      feedbackEl.textContent = "❌ Not quite. Try again.";
      feedbackEl.style.color = "red";
    }
  };
}



// --- Video helpers ---
function normalizeMediaPath(src) {
  // Avoid leading "/" (breaks on GitHub Pages); return relative path
  return String(src || "").replace(/^\//, "");
}

function attachTapToPlay(videoEl, label = "▶ Tap to play") {
  const btn = document.createElement("button");
  btn.id = "video-tap-overlay";
  btn.textContent = label;
  btn.style.cssText =
    "display:none;margin:6px auto 0;padding:6px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer;";
  videoEl.after(btn);

  const tryPlay = () => {
    // try muted autoplay; if blocked, show overlay
    videoEl.muted = true;
    videoEl.play().catch(() => { btn.style.display = "inline-block"; });
  };

  btn.onclick = () => {
    btn.style.display = "none";
    // user gesture now in place; allow audio
    videoEl.muted = false;
    videoEl.play().catch(()=>{ /* best effort */ });
  };

  return { btn, tryPlay };
}







// === Video challenge loader ===
function loadVideoScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Safe helpers
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  // Base containers
  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");

  // Clean any stale UI for video scenes
  ["scene-video","video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
    const n = document.getElementById(id); if (n) n.remove();
  });

  if (game) game.style.display = "block";

  // Hide text overlay for video (keeps it clean)
  if (sceneText) { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  if (sceneImage) { sceneImage.style.display = "none"; sceneImage.innerHTML = ""; }

  // Build video element
  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.src = scene.videoSrc || scene.source || ""; // support both keys
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.style.maxWidth = "100%";
  video.style.maxHeight = "420px";
  video.style.display = "block";
  video.style.margin = "0 auto 16px";
  video.style.borderRadius = "12px";
  video.style.backgroundColor = "black";
  if (scene.poster) video.poster = scene.poster;

  regNode(video);
  game.appendChild(video);

  // Choice/timer panel (created lazily after video ends)
  let timerId = null;
  function clearTimer(){ if (timerId) { clearInterval(timerId); timerId = null; } }

  function buildChoicesPanel(fromScene) {
    // Disarm the video so it can't replay or steal focus
    try { video.pause(); } catch(_) {}
    try { video.currentTime = 0; } catch(_) {}
    video.removeAttribute("controls");
    video.style.pointerEvents = "none";
    video.style.opacity = "0.25";
    video.setAttribute("aria-hidden", "true");

    // 🔔 notify hooks that choices are ready (id + type)
try {
  document.dispatchEvent(new CustomEvent('choices-ready', { detail: { sceneId: window.currentSceneId, type: 'video-choice' } }));
} catch(_) {}

// 🎤 arm speech for these choices (id="choices-container")
try {
  if (typeof window.__armSpeechForChoices === 'function') {
    window.__armSpeechForChoices(document.getElementById('choices-container'));
  }
} catch(_) {}


    // Remove old panel if any
    ["video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
      const n = document.getElementById(id); if (n) n.remove();
    });

    const choicesSrc = Array.isArray(fromScene.choices) ? fromScene : null;
    if (!choicesSrc) {
      // No inline choices -> behave like classic video: go to next
      if (scene.next) return loadScene(scene.next);
      return; // nothing else to do
    }

    // Timer (optional): prefer fromScene.timer, fallback to scene.timer
    const rawSec = (typeof choicesSrc.timer === "number" || choicesSrc.timer === true)
      ? choicesSrc.timer
      : scene.timer;

    const seconds = (rawSec === true) ? 15
                   : (Number.isFinite(rawSec) && rawSec > 0 ? Math.floor(rawSec) : null);

    // ---------- Timer with pause/resume + SceneTimer API ----------
    let timerDiv = null, timeLeft = seconds || 0, paused = false;

    if (seconds) {
      timerDiv = document.createElement("div");
      timerDiv.id = "video-choices-timer";
      timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:8px 0;";
      game.appendChild(timerDiv);

      const render = () => {
        if (timerDiv) timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s${paused?' (paused)':''}`;
      };
      render();

      clearTimer();
      timerId = setInterval(() => {
        if (paused) return;
        timeLeft -= 1;
        render();
        if (timeLeft <= 0) {
          clearTimer();
          const timeoutDest =
            choicesSrc.timeoutNext ||
            (choicesSrc.endings && choicesSrc.endings.timeout) ||
            (scene.endings && scene.endings.timeout) ||
            scene.next;
          if (timeoutDest) return loadScene(timeoutDest);
        }
      }, 1000);
    }

    // Expose scene timer API for the speech hook
    const prevSceneTimer = window.SceneTimer; // to restore on cleanup
    window.SceneTimer = {
      pause:  () => { paused = true;  if (timerDiv) timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s (paused)`; },
      resume: () => { paused = false; if (timerDiv) timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`; },
      isPaused: () => paused,
      getTimeLeft: () => timeLeft
    };

    // Pause/resume timer when speech starts/finishes/cancels
    const onSpeechStart  = () => { try { window.SceneTimer?.pause?.(); } catch(_) {} };
    const onSpeechFinish = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
    const onSpeechCancel = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
    document.addEventListener('speech-start',  onSpeechStart);
    document.addEventListener('speech-finish', onSpeechFinish);
    document.addEventListener('speech-cancel', onSpeechCancel);

    // ---------- Choices wrap + MC host expected by speech hook ----------
    const wrap = document.createElement("div");
    wrap.id = "video-choices";
    wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;margin:10px 0;";
    game.appendChild(wrap);

    // STANDARD MC container for the speech hook
    const mcHost = document.createElement("div");
    mcHost.id = "choices-container";
    mcHost.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    wrap.appendChild(mcHost);

    try {
  stampChoiceNextTargetsFromScene(choicesSrc, mcHost);
  if (typeof window.__armSpeechForChoices === 'function') {
    window.__armSpeechForChoices(mcHost);
  }
} catch(_) {}


    try {
  document.dispatchEvent(new CustomEvent('choices-ready', { detail:{ sceneId: window.currentSceneId } }));
} catch(_){}


    // Feedback (optional)
    const fb = document.createElement("div");
    fb.id = "video-choices-feedback";
    fb.style.cssText = "margin-top:6px;font-weight:700;";
    game.appendChild(fb);

    // Gate helper (matches your main choices gating)
    const hasFlag    = (f) => window.progress && window.progress.flags && !!window.progress.flags[f];
    const isUnlocked = (s) => window.progress && window.progress.unlocked && window.progress.unlocked.has && window.progress.unlocked.has(s);

    // Shared WeakMap for navigation fallbacks
    window.__choiceNextMap = window.__choiceNextMap || new WeakMap();

    (choicesSrc.choices || []).forEach(choice => {
      const reqFlags = choice.requiresFlags || [];
      const reqScenes = choice.requiresScenes || [];
      const okFlags = reqFlags.every(hasFlag);
      const okScenes = reqScenes.every(isUnlocked);
      const available = okFlags && okScenes;

      const nextTarget = String(choice.next || "");

      const btn = document.createElement("button");
      btn.className = "choice";                                 // ← required by speech
      btn.textContent = available ? choice.text : `🔒 ${choice.text}`;
      btn.disabled = !available;

      // ← expose NEXT via multiple channels the speech layer expects
      btn.dataset.next = nextTarget;
      btn.setAttribute('aria-next', nextTarget);
      window.__choiceNextMap.set(btn, nextTarget);

      btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      btn.onmouseenter = () => (btn.style.background = "#00cccc");
      btn.onmouseleave = () => (btn.style.background = "#00ffff");

      regListener(btn, "click", () => {
        clearTimer();
        if (!available) return;
        try { document.dispatchEvent(new Event('speech-commit')); } catch(_){}
        if (choice.applyCrm) {
          try { window.crm && window.crm.apply(choice.applyCrm); } catch(_) {}
        }

        const before = window.currentSceneId || '';
        if (nextTarget) loadScene(nextTarget);

        // If something swallowed it, force on next tick (local safeguard)
        requestAnimationFrame(() => {
          const after = window.currentSceneId || '';
          if (after === before && nextTarget) {
            console.warn('[video] choice click swallowed → forcing loadScene:', nextTarget, { before });
            try { window.loadScene(nextTarget); } catch(e){ console.warn('[video] force navigate failed', e); }
          }
        });
      });

      mcHost.appendChild(btn);
    });

    // Notify the speech layer that visible choices exist
    try { document.dispatchEvent(new CustomEvent('choices-ready', { detail: { sceneId: id } })); } catch {}

    // Cleanup on leave
    regCleanup(() => {
      clearTimer();
      document.removeEventListener('speech-start',  onSpeechStart);
      document.removeEventListener('speech-finish', onSpeechFinish);
      document.removeEventListener('speech-cancel', onSpeechCancel);
      // best-effort restore previous SceneTimer
      try { window.SceneTimer = prevSceneTimer || null; } catch(_) {}
      const n = document.getElementById("video-choices"); if (n) n.remove();
      const t = document.getElementById("video-choices-timer"); if (t) t.remove();
      const f = document.getElementById("video-choices-feedback"); if (f) f.remove();
    });
  }

  function onEnded() {
    // After video ends: show inline choices from self or from a referenced scene
    const refId = scene.inlineChoicesFrom;
    const src = (refId && scenes[refId]) ? scenes[refId] : scene;
    buildChoicesPanel(src);
  }

  regListener(video, "ended", onEnded);

  // Cleanup when leaving this scene
  regCleanup(() => {
    clearTimer();
    try { video.pause(); } catch(_) {}
    const v = document.getElementById("scene-video"); if (v) v.remove();
    ["video-choices","video-choices-timer","video-choices-feedback"].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });
  });
}










// === Audio negotiation interaction loader ===
function loadInteractionScene(id) {
  const infoDiv = document.getElementById("challenge-info");
if (infoDiv) {
  infoDiv.style.display = "none";
  infoDiv.innerHTML = "";
}

  console.log(`Loading interaction scene: ${id}`);
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scramble = document.getElementById("sentence-scramble");
  const feedback = document.getElementById("scramble-feedback");
  const interactionUI = document.getElementById("scene6-ui");

  if (gameContainer) gameContainer.style.display = "block";
  if (interactionUI) interactionUI.style.display = "block";

  // Show text if present
  if (sceneText) {
    if (scene.text) {
      sceneText.style.display = "block";
      sceneText.textContent = scene.text;
    } else {
      sceneText.style.display = "none";
    }
  }

  // Show image if present
  if (sceneImage) {
    if (scene.image) {
      sceneImage.style.display = "block";
  const imgClass = scene.imageClass ? ` class="${scene.imageClass}"` : '';
sceneImage.innerHTML = `<img src="${scene.image}" alt="Scene Image"${imgClass}>`;

    } else {
      sceneImage.style.display = "none";
      sceneImage.innerHTML = "";
    }
  }

  // Hide scramble and feedback
  if (scramble) scramble.style.display = "none";
  if (feedback) feedback.style.display = "none";

  if (interactionUI) {
    interactionUI.innerHTML = `
      <h2>Negotiation</h2>
      <p>🎙️ Listen carefully. Press play when ready. Once the audio ends, you’ll have <strong>30 seconds</strong> to choose your reply.</p>
      <div id="interaction"></div>
    `;
  }

  let score = 0;
  let index = 0;

  function showInteraction() {
    
    console.log(`showInteraction called, index = ${index}`);

    if (index >= scene.interactions.length) {
      const ending =
        score >= scene.scoring.high ? scene.endings.high :
        score >= scene.scoring.medium ? scene.endings.medium :
        scene.endings.low;

      console.log("All interactions done, loading ending:", ending);

      // Show back regular UI containers
      if (sceneText) sceneText.style.display = "block";
      if (sceneImage) sceneImage.style.display = "block";
      if (scramble) scramble.style.display = "block";
      if (feedback) feedback.style.display = "block";

      if (interactionUI) {
        interactionUI.style.display = "none";
        interactionUI.innerHTML = "";
      }

      loadScene(ending);
      return;
    }

    const interaction = scene.interactions[index];
    const interactionDiv = document.getElementById("interaction");
    if (!interactionDiv) return;

    interactionDiv.innerHTML = `
      <audio id="interaction-audio" controls preload="auto">
        <source src="${interaction.audio}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
      <div id="timer">⏳ Waiting for audio to finish...</div>
      <div id="options" style="margin-top: 10px;"></div>
      <div id="feedback" style="margin-top: 10px;"></div>
    `;

    const audio = document.getElementById("interaction-audio");
    prepAudioElement(audio);

    audio.onplay = () => {
      console.log("Audio started playing");
    };

    audio.onerror = (e) => {
      console.error("Audio error:", e);
    };

    audio.onended = () => {
      console.log("Audio ended");

      let timeLeft = 30;
      const timerEl = document.getElementById("timer");
      if (timerEl) timerEl.textContent = `⏳ ${timeLeft} seconds remaining...`;

      const countdown = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = `⏳ ${timeLeft} seconds remaining...`;
        if (timeLeft <= 0) {
          clearInterval(countdown);
          const feedbackDiv = document.getElementById("feedback");
          if (feedbackDiv) feedbackDiv.textContent = "⌛ Time expired. No reply sent.";
          index++;
          setTimeout(showInteraction, 2000);
        }
      }, 1000);

      const optionsDiv = document.getElementById("options");
      if (!optionsDiv) return;
      optionsDiv.innerHTML = "";

      interaction.options.forEach((opt, i) => {
        const btn = document.createElement("button");
        btn.textContent = typeof opt === "string" ? opt : opt.text;
        btn.onclick = () => {
          clearInterval(countdown);
          console.log(`Option clicked: ${btn.textContent}`);
          const isCorrect = (typeof opt === "string") ? (i === interaction.correct) : (opt.score === 1);
          const feedbackDiv = document.getElementById("feedback");
          if (feedbackDiv) {
            if (isCorrect) {
              score++;
              feedbackDiv.textContent = "✅ Response recorded.";
              feedbackDiv.style.color = "lightgreen";
            } else {
              feedbackDiv.textContent = "⚠️ Response recorded.";
              feedbackDiv.style.color = "orange";
            }
          }
          index++;
          setTimeout(showInteraction, 1500);
        };
        optionsDiv.appendChild(btn);
      });
    };
  }

  showInteraction();
}

// === Email writing challenge loader ===
function loadEmailChallengeScene(sceneId) {
  const scene = scenes[sceneId];
  if (!scene) {
    console.error(`Scene ${sceneId} not found.`);
    return;
  }

  // Clear and hide the scene image container to prevent lingering images from previous scenes
  const sceneImage = document.getElementById("scene-image");
  if (sceneImage) {
    sceneImage.style.display = "none";
    sceneImage.innerHTML = "";
  }

  const emailContainer = document.getElementById("email-challenge-container");
  if (!emailContainer) {
    console.error("Email challenge container not found");
    return;
  }

  // Use scene.text explicitly, with a console warning if missing
  if (!scene.text || scene.text.trim() === "") {
    console.warn(`Scene ${sceneId} missing 'text' property or it is empty.`);
  }

  emailContainer.innerHTML = `
    <h2>Final Assignment</h2>
    <p style="white-space: pre-wrap; font-weight: 600;">${scene.text || "Please write an email to your teacher below."}</p>
    <form id="email-form" style="margin-top: 20px;">
      <label for="email-to">To:</label><br/>
      <input type="email" id="email-to" name="email-to" value="${scene.teacherEmail || ''}" style="width: 100%;" readonly /><br/><br/>
      
      <label for="email-subject">Subject:</label><br/>
      <input type="text" id="email-subject" name="email-subject" value="${scene.emailSubject || 'Assignment Submission'}" style="width: 100%;" /><br/><br/>
      
      <label for="email-body">Message:</label><br/>
      <textarea id="email-body" name="email-body" rows="8" style="width: 100%;">${scene.emailBody || ''}</textarea><br/><br/>
      
      <button type="button" id="send-email-btn">Send Email</button>
    </form>
    <div id="email-feedback" style="margin-top: 15px; font-weight: bold;"></div>
  `;

  const form = emailContainer.querySelector("#email-form");
  const toInput = emailContainer.querySelector("#email-to");
  const subjectInput = emailContainer.querySelector("#email-subject");
  const bodyInput = emailContainer.querySelector("#email-body");
  const feedback = emailContainer.querySelector("#email-feedback");
  const sendBtn = emailContainer.querySelector("#send-email-btn");

// Inside loadEmailChallengeScene(sceneId) — replace ONLY the click handler
sendBtn.onclick = () => {
  // Resolve the current scene safely (works even if the param name differs)
  const sid = typeof sceneId !== "undefined" ? sceneId : window.currentSceneId;
  const sc  = (window.scenes && window.scenes[sid]) || null;
  if (!sc) { console.error("Email scene not found for", sid); return; }

  const to  = (sc.teacherEmail || "").trim();
  const sub = encodeURIComponent(sc.emailSubject || "");

  // Try to read the body from UI; fall back to scene.emailBody
  const bodyEl =
    document.getElementById("email-body") ||
    document.getElementById("emailBody") ||
    document.querySelector("#email-challenge-container textarea");

  const uiBodyRaw = (bodyEl && bodyEl.value) || sc.emailBody || "";
  const body = encodeURIComponent(uiBodyRaw.replace(/\r?\n/g, "\r\n"));

  const href = `mailto:${to}?subject=${sub}&body=${body}`;

  // Try opening the mail client, but ALWAYS advance to next scene
  try { window.open(href, "_blank"); } catch (_) { location.href = href; }

  const nextId = sc.next;
  if (nextId) {
    try { window.unlockScene && window.unlockScene(nextId); } catch {}
    setTimeout(() => window.loadScene(nextId), 150);
  }
};


}
function loadInteractionScrambleScene(id) {
  console.log(`Loading interaction-scramble scene: ${id}`);
  const scene = scenes[id];
  if (!scene) { console.error(`Scene data not found for ID: ${id}`); return; }

  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const infoDiv = document.getElementById("challenge-info");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const choicesDiv = document.getElementById("choices-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scene6UI = document.getElementById("scene6-ui");

  // Clear unrelated UI containers
  [container, emailContainer, fillBlankContainer, choicesDiv, sceneText, sceneImage, scene6UI].forEach(el => {
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
  });

  // Setup scramble UI
  scrambleDiv.style.display = "block";
  scrambleDiv.innerHTML = "";
  feedbackDiv.style.display = "none";
  feedbackDiv.innerHTML = "";

  // Show info text if present
  if (infoDiv) {
    if (scene.emailFromClient) {
      infoDiv.style.display = "block"; infoDiv.innerHTML = scene.emailFromClient;
    } else if (scene.contextText) {
      infoDiv.style.display = "block"; infoDiv.textContent = scene.contextText;
    } else {
      infoDiv.style.display = "none"; infoDiv.innerHTML = "";
    }
  }

  // Instruction
  const instruction = document.createElement("p");
  instruction.className = "scramble-instructions";
  instruction.textContent = "🧩 Drag the words into the correct order after listening to the audio:";
  scrambleDiv.appendChild(instruction);

  // Scramble words container
  const scrambleContainer = document.createElement("div");
  scrambleContainer.id = "scramble-words";
  const shuffled = shuffleArray(scene.scramble);
  shuffled.forEach(word => {
    const span = document.createElement("span");
    span.className = "scramble-word";
    span.textContent = word;
    scrambleContainer.appendChild(span);
  });
  scrambleDiv.appendChild(scrambleContainer);

  // Destroy old Sortable instance
  if (window.scrambleSortable) { window.scrambleSortable.destroy(); }
  window.scrambleSortable = Sortable.create(scrambleContainer, { animation: 150 });

  // Audio player
  let audioElem = document.getElementById("scene-audio");
  if (audioElem) { audioElem.pause(); audioElem.src = ""; audioElem.load(); audioElem.remove(); }
  audioElem = document.createElement("audio");
  audioElem.id = "scene-audio";
  audioElem.controls = true;
  audioElem.preload = "auto";
  audioElem.src = scene.audio;
  document.getElementById("game-container").appendChild(audioElem);
  prepAudioElement(audioElem);

  // Submit button
  let submitBtn = document.getElementById("scramble-submit-btn");
  if (submitBtn) {
    submitBtn.removeEventListener('click', submitBtn._listener);
    submitBtn.remove();
  }
  submitBtn = document.createElement("button");
  submitBtn.id = "scramble-submit-btn";
  submitBtn.textContent = "Submit Answer";
  submitBtn.style.marginTop = "15px";
  scrambleDiv.appendChild(document.createElement("br"));
  scrambleDiv.appendChild(submitBtn);

  const onSubmit = () => {
    const arrangedWords = Array.from(scrambleContainer.querySelectorAll('.scramble-word')).map(el => el.textContent);
    if (arraysEqual(arrangedWords, scene.correct)) {
      alert("Correct! Moving to next scene.");
      currentSceneId = scene.next;
      loadScene(currentSceneId);
    } else {
      alert("Not quite right. Try again.");
    }
  };
  submitBtn.addEventListener('click', onSubmit);
  submitBtn._listener = onSubmit;

  /* =======================
     🎙️ Speak Answer (adds button + auto-reorder on pass)
     ======================= */

  // Remove any previous Speak button to avoid duplicates
  const oldSpeak = document.getElementById("scramble-speak-btn");
  if (oldSpeak) oldSpeak.remove();

  // Create Speak-to-answer button
  const speakBtn = document.createElement("button");
  speakBtn.id = "scramble-speak-btn";
  speakBtn.textContent = "🎙️ Speak Answer";
  speakBtn.style.marginLeft = "8px";
  scrambleDiv.appendChild(speakBtn);

  const expected = Array.isArray(scene.correct) ? scene.correct.join(' ') : String(scene.correct || '');

  // Helper: reorder DOM to match an array of tokens
  function reorderScrambleTo(order) {
    // Create a map of token -> array of nodes (handles duplicates)
    const pool = {};
    [...scrambleContainer.children].forEach(node => {
      const t = node.textContent.trim();
      (pool[t] = pool[t] || []).push(node);
    });
    // Append in the new order
    order.forEach(tok => {
      const bucket = pool[tok] && pool[tok].length ? pool[tok].shift() : null;
      if (bucket) scrambleContainer.appendChild(bucket);
    });
  }

if (typeof attachSpeechCheck === 'function') {
  console.log('[speech] using attachSpeechCheck path (loader)');

  const tol = (window.SpeechFeature?.settings?.tolerance) ?? 0.80;
  const so  = scene.speechOptions || {}; // optional per-scene knobs

  attachSpeechCheck(speakBtn, expected, {
    minCoverage: tol,

    // 🔒 strict order for scrambles
    requireMonotonic: true,
    allowOrderFlex: false,
    orderMin: (typeof so.orderMin === 'number') ? so.orderMin : 0.95,

    // optional tuning (if you set these on the scene)
    maxEditDistance: so.maxEditDistance,
    stopWords: so.stopWords,
    synonyms: so.synonyms,             // e.g., { comparability: ['compatibility','comparibility'] }
    weight: so.weights ? {
      token:   (typeof so.weights.coverage === 'number' ? so.weights.coverage : 0.55),
      phoneme: (typeof so.weights.phoneme  === 'number' ? so.weights.phoneme  : 0.35)
    } : { token: 0.7, phoneme: 0.3 }
  });

  // PASS → snap to exact order + submit
  speakBtn.addEventListener('speech-pass', (ev) => {
    try { reorderScrambleTo(scene.correct || []); } catch(_) {}
    try { onSubmit(); } catch(_) { document.getElementById('scramble-submit-btn')?.click(); }

    const d = ev?.detail || {};
    console.log(
      '[attachSpeechCheck→loader] PASS · token=%s%% phoneme=%s%% blended=%s%% order=%s%%',
      Math.round((d.token?.coverage   || 0)*100),
      Math.round((d.phoneme?.coverage || 0)*100),
      Math.round((d.blended           || 0)*100),
      Math.round((d.orderScore        || 0)*100)
    );
  });

  // FAIL → gentle hint; assist if very close but order slightly off
  speakBtn.addEventListener('speech-fail', (ev) => {
    const d = ev?.detail || {};
    const blended = d.blended ?? 0;
    const order   = d.orderScore ?? 0;

    // show a small nudge
    const fb = document.getElementById('scramble-feedback');
    if (fb) {
      fb.style.display = 'block';
      fb.style.color   = '#ffd166';
      fb.textContent   = `Heard ~${Math.round(blended*100)}%. Try again.`;
    }

    // strong attempt assist
    if (blended >= tol * 0.98 && order >= 0.85) {
      try { reorderScrambleTo(scene.correct || []); } catch(_) {}
      if (fb) {
        fb.style.color = '#a0e7e5';
        fb.textContent = 'Nice! We arranged the blocks from your speech — review & submit.';
      }
      // auto-submit if you want:
      // try { onSubmit(); } catch(_) { document.getElementById('scramble-submit-btn')?.click(); }
    }
  });
} else {
  console.log('[speech] attachSpeechCheck missing → disabled (loader)');
  speakBtn.disabled = true;
  speakBtn.title = 'Speech not available (attachSpeechCheck missing)';
}

}



function loadInteractionFillBlankScene(id) {
  console.log(`Loading interaction-fill-in-the-blank scene: ${id}`);
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene data not found for ID: ${id}`);
    return;
  }

  // Containers
  const scrambleDiv = document.getElementById("sentence-scramble");
  const feedbackDiv = document.getElementById("scramble-feedback");
  const infoDiv = document.getElementById("challenge-info");
  const container = document.getElementById('scene-container');
  const emailContainer = document.getElementById("email-challenge-container");
  const fillBlankContainer = document.getElementById("sceneFillInTheBlank");
  const choicesDiv = document.getElementById("choices-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const scene6UI = document.getElementById("scene6-ui");

  // Clear unrelated UI containers
  [container, emailContainer, scrambleDiv, feedbackDiv, choicesDiv, sceneText, sceneImage, scene6UI].forEach(el => {
    if (el) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  });

  if (fillBlankContainer) {
    fillBlankContainer.style.display = "block";
    fillBlankContainer.innerHTML = "";
  }

  // Show info text if present
  if (infoDiv) {
    if (scene.emailFromClient) {
      infoDiv.style.display = "block";
      infoDiv.innerHTML = scene.emailFromClient;
    } else if (scene.contextText) {
      infoDiv.style.display = "block";
      infoDiv.textContent = scene.contextText;
    } else {
      infoDiv.style.display = "none";
      infoDiv.innerHTML = "";
    }
  }

  // Audio player
  let audioElem = document.getElementById("scene-audio");
  if (audioElem) {
    audioElem.pause();
    audioElem.src = "";
    audioElem.load();
    audioElem.remove();
  }
  audioElem = document.createElement("audio");
  audioElem.id = "scene-audio";
  audioElem.controls = true;
  audioElem.preload = "auto";
  audioElem.src = scene.audio;
  document.getElementById("game-container").appendChild(audioElem);
  prepAudioElement(audioElem);

  // Build fill-in-the-blank UI
  fillBlankContainer.innerHTML = `
    <h2>Fill in the Blanks Challenge</h2>
    <p>${scene.text || "Fill in the blanks by dragging the correct options below."}</p>
    <p id="fill-blank-sentence" style="font-size: 1.2rem; line-height: 1.5; margin-bottom: 20px;"></p>
    <div id="fill-blank-options" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
    <button id="check-fill-blank-answer">Check Answer</button>
    <div id="fill-blank-feedback" style="margin-top: 10px; font-weight: bold;"></div>
  `;

  const sentenceEl = fillBlankContainer.querySelector("#fill-blank-sentence");
  const optionsEl = fillBlankContainer.querySelector("#fill-blank-options");
  const feedbackEl = fillBlankContainer.querySelector("#fill-blank-feedback");

  // Render sentence with blanks
  let html = "";
  for (let i = 0; i < scene.sentence.length; i++) {
    if (scene.blanks.includes(i)) {
      html += `<span class="fill-blank-dropzone" data-index="${i}" style="
        display: inline-block;
        min-width: 80px;
        border-bottom: 2px solid #00ffff;
        margin: 0 4px;
        vertical-align: bottom;
        padding: 4px 6px;
        cursor: pointer;
        background-color: #111;
      "></span> `;
    } else {
      html += `<span style="margin: 0 4px;">${scene.sentence[i]}</span> `;
    }
  }
  sentenceEl.innerHTML = html;

  // Render draggable options
  optionsEl.innerHTML = "";
  scene.options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.className = "fill-blank-option";
    btn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: 2px solid #00ffff;
      background: #000;
      color: #0ff;
      font-weight: bold;
      cursor: grab;
      user-select: none;
    `;
    optionsEl.appendChild(btn);
  });

  // Cleanup Sortable instances if any
  if (fillBlankContainer._sortableBlanks) {
    fillBlankContainer._sortableBlanks.forEach(s => s.destroy());
    fillBlankContainer._sortableBlanks = null;
  }
  if (fillBlankContainer._sortableOptions) {
    fillBlankContainer._sortableOptions.destroy();
    fillBlankContainer._sortableOptions = null;
  }

  // Setup SortableJS droppable blanks
  const dropzones = sentenceEl.querySelectorAll(".fill-blank-dropzone");
  fillBlankContainer._sortableBlanks = Array.from(dropzones).map(zone => {
    return Sortable.create(zone, {
      group: "fillInTheBlank",
      animation: 150,
      sort: false,
      onAdd: evt => {
        const dragged = evt.item;
        if (dragged.parentNode === optionsEl) {
          dragged.parentNode.removeChild(dragged);
        }
        if (evt.to.children.length > 1) {
          Array.from(evt.to.children).forEach(child => {
            if (child !== dragged) {
              evt.to.removeChild(child);
              optionsEl.appendChild(child);
            }
          });
        }
      },
      onRemove: evt => {
        optionsEl.appendChild(evt.item);
      }
    });
  });

  // Setup SortableJS options container
  fillBlankContainer._sortableOptions = Sortable.create(optionsEl, {
    group: "fillInTheBlank",
    animation: 150,
  });

  // Check answer logic
  const checkBtn = fillBlankContainer.querySelector("#check-fill-blank-answer");
  checkBtn.removeEventListener('click', checkBtn._listener);
  const onCheck = () => {
    const userAnswers = [];
    let allFilled = true;
    dropzones.forEach(zone => {
      if (zone.children.length === 1) {
        userAnswers.push(zone.children[0].textContent.trim());
      } else {
        allFilled = false;
      }
    });

    if (!allFilled) {
      feedbackEl.textContent = "⚠️ Please fill all blanks.";
      feedbackEl.style.color = "orange";
      return;
    }

    const allCorrect = userAnswers.every(
      (ans, i) => ans.toLowerCase() === scene.correct[i].toLowerCase()
    );

    if (allCorrect) {
      feedbackEl.textContent = "✅ Correct! Well done.";
      feedbackEl.style.color = "lightgreen";
      if (scene.next) {
        setTimeout(() => loadScene(scene.next), 1500);
      }
    } else {
      feedbackEl.textContent = "❌ Not quite. Try again.";
      feedbackEl.style.color = "red";
    }
  };
  checkBtn.addEventListener('click', onCheck);
  checkBtn._listener = onCheck;
}

function loadInteractionAudioMCScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // ===== Minimal safety: stop any other audio on the page (from prior scenes)
  try {
    document.querySelectorAll('audio').forEach(a => {
      // Do not touch the ones we are about to create (they don't exist yet)
      try { a.pause(); } catch {}
      a.removeAttribute('loop');
      a.src = ''; // detach source so it truly stops
      try { a.load(); } catch {}
    });
  } catch {}

  // Optional: reset a cross-scene tally at the START of a block
  try {
    if (scene.tallyKey && scene.tallyReset && typeof tallyReset === 'function') {
      const max = (scene.tallyMax != null) ? scene.tallyMax : null;
      tallyReset(scene.tallyKey, max);
    }
  } catch(_) {}

  // Shorthands
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(fn){ try{ window.__sceneCleanups = (window.__sceneCleanups||[]); window.__sceneCleanups.push(fn);}catch{} };

  // Base containers
  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  // Clear any prior UI for this loader
  const old = document.getElementById("iamc-ui");
  if (old) old.remove();

  // Build UI shell
  const ui = document.createElement("div");
  ui.id = "iamc-ui";
  ui.style.cssText = "margin-top:10px;";
  regNode(ui);
  game.appendChild(ui);

  // --- tiny helper: attempt autoplay; on block, show a tap-to-play button ---
  function safePlay(audioEl, label = '▶️ Tap to play audio') {
    if (!audioEl) return;
    audioEl.setAttribute('playsinline', ''); // iOS/Safari friendliness
    try {
      const p = audioEl.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => {
          // Autoplay blocked → show helper button once
          if (audioEl.__tapHelperShown) return;
          audioEl.__tapHelperShown = true;
          const btn = document.createElement('button');
          btn.textContent = label;
          btn.style.cssText = 'margin:10px 0;padding:8px 12px;border-radius:8px;border:1px solid #2b3038;background:#1e2127;color:#eaeaea;cursor:pointer;display:block;';
          audioEl.insertAdjacentElement('afterend', btn);
          btn.addEventListener('click', () => {
            btn.disabled = true;
            audioEl.play().then(() => btn.remove()).catch(() => { btn.disabled = false; });
          });
        });
      }
    } catch {}
  }

  // Prompt audio (the clip you listen to before answering)
  let prompt = null;
  if (scene.audio) {
    prompt = document.createElement("audio");
    prompt.id = "iamc-prompt";
    prompt.controls = true;
    prompt.src = scene.audio;
    prompt.preload = "auto";
    prompt.setAttribute('playsinline','');
    prompt.style.cssText = "width:100%;max-width:640px;display:block;margin:0 auto 12px;";
    regNode(prompt);
    ui.appendChild(prompt);
    // If you have prepAudioElement, keep it; it's fine as long as it doesn't remove nodes
    try { prepAudioElement(prompt); } catch {}

    // Try to start immediately (counts as user gesture in many flows). If blocked, we’ll show a tap helper.
    safePlay(prompt, '▶️ Tap to play prompt');
  }

  // Timer UI (starts only when the prompt audio ENDS)
  let timerId = null, timeLeft = 0;
  const DEFAULT_SECONDS = 15;
  const timerDiv = document.createElement("div");
  timerDiv.id = "iamc-timer";
  timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:6px 0;display:none;";
  ui.appendChild(timerDiv);

  function computeSeconds() {
    return (scene.timer === true) ? DEFAULT_SECONDS
         : (Number.isFinite(scene.timer) ? Number(scene.timer) : null);
  }

  function clearTimer(){ if (timerId) { clearInterval(timerId); timerId = null; } }

  function startTimer(onTimeout) {
    const sec = computeSeconds();
    if (!sec || sec <= 0) return; // no timer configured
    timeLeft = sec;
    timerDiv.style.display = "block";
    timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
    timerId = setInterval(() => {
      timeLeft--;
      timerDiv.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s`;
      if (timeLeft <= 0) {
        clearInterval(timerId); timerId = null;
        // route as TIMEOUT
        finish(false, 'timeout');
      }
    }, 1000);
  }

  // Helpers
  const looksLikeAudio = s => typeof s === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(s);
  const optToLabel = (opt, idx) => looksLikeAudio(opt) ? `▶ Option ${idx+1}` : String(opt);
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

  // Normalize options (preserve original index for correctness)
  const rawOptions = Array.isArray(scene.options) ? scene.options.slice() : [];
  let items = rawOptions.map((opt, i) => ({ opt, i }));
  if (scene.shuffleOptions) shuffle(items);

  // Correctness (index or string)
  const correctIndex = Number.isInteger(scene.correct) ? Number(scene.correct) : null;
  const correctString = (typeof scene.correct === 'string') ? scene.correct.trim().toLowerCase() : null;
  function isCorrectIndex(chosenOriginalIndex){
    if (correctIndex != null) return chosenOriginalIndex === correctIndex;
    if (correctString != null) {
      const raw = rawOptions[chosenOriginalIndex];
      const asLabel = optToLabel(raw, chosenOriginalIndex).trim().toLowerCase();
      const asRaw   = String(raw || '').trim().toLowerCase();
      return (asLabel === correctString) || (asRaw === correctString);
    }
    return false;
  }

  // Feedback area
  const feedback = document.createElement("div");
  feedback.id = "iamc-feedback";
  feedback.style.cssText = "margin-top:10px;font-weight:700;";
  ui.appendChild(feedback);

  // End routing
  function branchByScoreOrNext() {
    if (scene.scoring && scene.endings) {
      let total = 0;
      try { if (scene.tallyKey && typeof tallyGet === 'function') total = Number(tallyGet(scene.tallyKey)) || 0; } catch(_) {}
      const hi = (scene.scoring.high ?? Infinity);
      const md = (scene.scoring.medium ?? -Infinity);
      let dest = scene.endings.low;
      if (total >= hi) dest = scene.endings.high;
      else if (total >= md) dest = scene.endings.medium;
      if (dest) return loadScene(dest);
      console.warn('interaction-audio-mc: endings present but missing a destination.');
    }
    if (scene.next) return loadScene(scene.next);
    console.warn('interaction-audio-mc: no next/endings; staying here.');
  }

  let locked = false;
  function finish(isCorrect, reason) {
    if (locked) return; locked = true;
    clearTimer();
    try { console.log('[iamc finish]', id, { isCorrect, reason }); } catch(_) {}

    // tally
    try {
      if (scene.tallyKey && typeof tallyAdd === 'function') {
        tallyAdd(scene.tallyKey, isCorrect ? (scene.tallyWeight || 1) : 0);
      }
    } catch(_) {}

    // route with precedence: timeout → wrong → (score/next)
    let dest = null;
    if (reason === 'timeout' && scene.endings && scene.endings.timeout) {
      dest = scene.endings.timeout;
    } else if (!isCorrect && scene.endings && scene.endings.wrong) {
      dest = scene.endings.wrong;
    }

    feedback.textContent = isCorrect ? "✅ Correct! Moving on..." :
                          (reason === 'timeout' ? "⌛ Time's up. Restarting..." : "❌ Not quite. Restarting...");
    feedback.style.color = isCorrect ? "lightgreen" : (reason === 'timeout' ? "orange" : "salmon");

    setTimeout(() => {
      if (dest) return loadScene(dest);
      return branchByScoreOrNext();
    }, 800);
  }

  // Build options
  const optionsWrap = document.createElement("div");
  optionsWrap.id = "iamc-options";
  optionsWrap.style.cssText = "display:flex;flex-direction:column;gap:10px;margin:10px 0;";
  ui.appendChild(optionsWrap);

  // Track audio nodes we create here to stop on cleanup
  const createdAudios = [];

items.forEach(({opt, i: originalIndex}, idxShown) => {
  // For audio options
  if (looksLikeAudio(opt)) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";

    const au = document.createElement("audio");
    au.controls = true;
    au.src = opt;
    au.preload = "auto";
    au.setAttribute('playsinline','');
    au.style.cssText = "flex:1 1 280px;min-width:220px;";
    createdAudios.push(au);
    try { prepAudioElement(au); } catch {}

    const btn = document.createElement("button");
    btn.textContent = `Choose ${idxShown+1}`;
    btn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    btn.onmouseenter = () => (btn.style.background = "#00cccc");
    btn.onmouseleave = () => (btn.style.background = "#00ffff");

    const handler = () => {
      // 🔀 optional per-option branch support
      if (scene.branchOnOption && scene.branchOnOption.hasOwnProperty(originalIndex)) {
        clearTimer();
        return loadScene(scene.branchOnOption[originalIndex]);
      }
      // default behaviour: normal correctness routing
      finish(isCorrectIndex(originalIndex));
    };

    regListener(btn, "click", handler);
    try { btn.__speechProxyClick = handler; } catch(_) {}
    row.appendChild(au);
    row.appendChild(btn);
    optionsWrap.appendChild(row);

  // For text options
  } else {
    const btn = document.createElement("button");
    btn.textContent = optToLabel(opt, idxShown);
    btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    btn.onmouseenter = () => (btn.style.background = "#00cccc");
    btn.onmouseleave = () => (btn.style.background = "#00ffff");

    const handler = () => {
      // 🔀 optional per-option branch support
      if (scene.branchOnOption && scene.branchOnOption.hasOwnProperty(originalIndex)) {
        clearTimer();
        return loadScene(scene.branchOnOption[originalIndex]);
      }
      // default behaviour: normal correctness routing
      finish(isCorrectIndex(originalIndex));
    };

    regListener(btn, "click", handler);
    try { btn.__speechProxyClick = handler; } catch(_) {}
    optionsWrap.appendChild(btn);
  }
});


  // Start timer ONLY after the prompt audio ends; if no prompt clip, start now.
  if (prompt) {
    regListener(prompt, 'ended', () => startTimer(() => finish(false, 'timeout')));
  } else {
    startTimer(() => finish(false, 'timeout'));
  }

  // Cleanup on leave (stop audios we created so the next scene is fresh)
  regCleanup(() => {
    try { clearTimer(); } catch {}
    try {
      createdAudios.forEach(a => { try{ a.pause(); }catch{} a.src=''; try{ a.load(); }catch{} });
      const p = document.getElementById('iamc-prompt');
      if (p){ try{ p.pause(); }catch{} p.src=''; try{ p.load(); }catch{} }
    } catch {}
    const node = document.getElementById("iamc-ui");
    if (node) node.remove();
  });
}







 
function loadVideoMultiQuestionScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  try {
    if (scene.tallyKey && scene.tallyReset && typeof tallyReset === 'function') {
      tallyReset(scene.tallyKey, scene.tallyMax ?? (scene.questions?.length || null));
    }
  } catch(_) {}

  const VMQ_DEFAULT_SECONDS = 15;

  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};
  const rs = (typeof resolveSrc === 'function') ? resolveSrc : (s => s || '');

  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  ["vmq-wrap","scene-video","video-multi-question-timer","choices-container","video-multi-question-options","video-multi-question-feedback"]
    .forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });

  const wrap = document.createElement("div");
  wrap.id = "vmq-wrap";
  wrap.style.cssText = "position:relative;max-width:100%;margin:0 auto 16px;";
  game.appendChild(wrap);

  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.preload = "metadata";
  video.src = rs(scene.videoSrc);
  if (scene.poster) video.poster = rs(scene.poster);
  video.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.playsInline = true;
  regNode(video);

  const overlay = document.createElement("button");
  overlay.textContent = "▶ Tap to Play";
  overlay.style.cssText = "position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:180px;height:48px;background:#00ffff;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer";
  overlay.onclick = async () => { try { await video.play(); overlay.remove(); } catch(_){} };
  video.addEventListener("play", () => { if (overlay.parentNode) overlay.remove(); });

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip video";
  skipBtn.style.cssText = "margin-top:8px;padding:8px 12px;border:none;border-radius:8px;background:#222;color:#eee;cursor:pointer;font-weight:700";
  skipBtn.onclick = () => startQuestions();

  const errorMsg = () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = rs(scene.videoSrc);
    a.target = "_blank";
    a.textContent = "Open video in a new tab";
    a.style.cssText = "display:inline-block;margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    wrap.appendChild(msg);
  };
  video.addEventListener("error", errorMsg);

  wrap.appendChild(video);
  wrap.appendChild(overlay);
  wrap.appendChild(skipBtn);

  const questions = Array.isArray(scene.questions) ? scene.questions : [];
  let qIndex = 0, score = 0, timerInterval = null, timeLeft = 0, paused = false;

  function resolveTimerSeconds(scene, q) {
    const pick = (v) => {
      if (v === false || v == null) return null;
      if (v === true) return VMQ_DEFAULT_SECONDS;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    const perQ = pick(q && q.timer);
    const perScene = pick(scene && scene.timer);
    return (perQ != null) ? perQ : (perScene != null ? perScene : VMQ_DEFAULT_SECONDS);
  }
  function clearTimer(){ if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function renderTimer(div){ if (div) div.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s${paused?' (paused)':''}`; }

  // SceneTimer for speech hook
  const prevSceneTimer = window.SceneTimer;
  const sceneTimerAPI = {
    pause: () => { paused = true; },
    resume: () => { paused = false; },
    isPaused: () => paused,
    getTimeLeft: () => timeLeft,
    _clear: () => clearTimer()
  };
  window.SceneTimer = sceneTimerAPI;

  // stop timer/video when a speech-driven choice actually commits
  const onSpeechCommit = () => {
    try { clearTimer(); } catch(_) {}
    try { video.pause(); } catch(_) {}
  };
  document.addEventListener('speech-commit', onSpeechCommit, { passive:true });
  regCleanup(() => document.removeEventListener('speech-commit', onSpeechCommit));

  const onSpeechStart  = () => { try { window.SceneTimer?.pause?.(); } catch(_) {} };
  const onSpeechFinish = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
  const onSpeechCancel = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
  document.addEventListener('speech-start',  onSpeechStart);
  document.addEventListener('speech-finish', onSpeechFinish);
  document.addEventListener('speech-cancel', onSpeechCancel);

  function finish() {
    ["video-multi-question-timer","choices-container","video-multi-question-options","video-multi-question-feedback"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });
    clearTimer();
    try { video.pause(); } catch(_){}
    if (wrap && wrap.parentNode) wrap.remove();

    document.removeEventListener('speech-start',  onSpeechStart);
    document.removeEventListener('speech-finish', onSpeechFinish);
    document.removeEventListener('speech-cancel', onSpeechCancel);

    try {
      if (window.SceneTimer === sceneTimerAPI) {
        if (prevSceneTimer) window.SceneTimer = prevSceneTimer;
        else { delete window.SceneTimer; }
      }
    } catch(_) { window.SceneTimer = prevSceneTimer || null; }

    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      const dest = (score >= high) ? scene.endings.high
                 : (score >= medium) ? scene.endings.medium
                 : scene.endings.low;
      if (dest) return loadScene(dest);
    }
    if (scene.next) return loadScene(scene.next);
    console.warn("video-multi-question: No endings or next specified.");
  }

  function startQuestions() {
    // reset state for question 1 and timers
    window.__speechListening = false;
    window.__speechChoiceCommitted = false;
    paused = false;

    wrap.style.display = "none";
    try { video.pause(); } catch(_){}
    try { video.currentTime = 0; } catch(_){}
    video.removeAttribute("controls");
    video.style.pointerEvents = "none";
    video.style.opacity = "0.25";

    qIndex = 0; score = 0;
    renderQuestion();
  }

  const normTxt = (s) => String(s||'').toLowerCase()
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g,' ')
    .trim();

  function renderQuestion() {
    if (qIndex >= questions.length) return finish();

    ["video-multi-question-timer","choices-container","video-multi-question-options","video-multi-question-feedback"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });
    clearTimer();
    paused = false;

    const q = questions[qIndex];
    if (!q) { console.error(`Question ${qIndex} missing`); return finish(); }
    if (sceneText) sceneText.textContent = q.text || "";

    const seconds = resolveTimerSeconds(scene, q);
    let timerDiv = null;
    if (seconds && seconds > 0) {
      timeLeft = seconds;
      timerDiv = document.createElement("div");
      timerDiv.id = "video-multi-question-timer";
      timerDiv.style.cssText = "font-weight:700;font-size:1.1rem;color:#00ffff;margin-top:10px;";
      timerDiv.textContent = `⏳ Time left: ${timeLeft}s`;
      game.appendChild(timerDiv);

      timerInterval = setInterval(() => {
        if (!paused) {
          timeLeft -= 1;
          renderTimer(timerDiv);
          if (timeLeft <= 0) {
            clearTimer();
            try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, 0); } catch(_){}
            feedback("⏲️ Time's up. Moving on...", "orange", false, true);
          }
        } else {
          renderTimer(timerDiv);
        }
      }, 1000);
    }

    const optionsWrap = document.createElement("div");
    optionsWrap.style.cssText = "margin-top:15px";
    game.appendChild(optionsWrap);

    const optionsDiv = document.createElement("div");
    optionsDiv.id = "choices-container";              // speech hook target
    optionsDiv.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    optionsWrap.appendChild(optionsDiv);

    // let the hook know options are visible
    try { document.dispatchEvent(new CustomEvent('choices-ready', { detail: { sceneId: id, qIndex } })); } catch {}

    optionsDiv.setAttribute("data-legacy-id", "video-multi-question-options");

    const feedbackDiv = document.createElement("div");
    feedbackDiv.id = "video-multi-question-feedback";
    feedbackDiv.style.cssText = "margin-top:15px;font-weight:700;";
    game.appendChild(feedbackDiv);

    function disable(){ [...optionsDiv.children].forEach(b => b.disabled = true); }
    function feedback(msg, color, isCorrect, timedOut=false) {
      clearTimer(); disable();
      feedbackDiv.textContent = msg;
      feedbackDiv.style.color = color;
      if (isCorrect) score++;
      setTimeout(() => { qIndex++; renderQuestion(); }, timedOut ? 900 : 700);
    }

    let opts = Array.isArray(q.options)
      ? q.options.map((opt, idx) => ({ text: (typeof opt === "string") ? opt : String(opt), __originIndex: idx }))
      : [];

    const rightTextFromQ = q.speechRightText ? String(q.speechRightText) : null;
    const rightTextFromSceneArr = Array.isArray(scene.speechRightTexts) ? scene.speechRightTexts[qIndex] : null;
    const speechRightText = rightTextFromQ || rightTextFromSceneArr || null;
    const speechRightNorm = speechRightText ? normTxt(speechRightText) : null;

    if (scene.shuffleOptions) {
      for (let i=opts.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [opts[i],opts[j]]=[opts[j],opts[i]]; }
    }

    let correctIndex = Number.isFinite(q.correct) ? Number(q.correct) : null;
    if (speechRightNorm) {
      for (const o of opts) {
        if (normTxt(o.text) === speechRightNorm) { correctIndex = o.__originIndex; break; }
      }
    }

    window.__choiceNextMap = window.__choiceNextMap || new WeakMap();

    opts.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.textContent = opt.text;
      btn.className = "choice";
      btn.dataset.index = String(i);
      btn.dataset.originIndex = String(opt.__originIndex);

      const isTextMatch = speechRightNorm && (normTxt(opt.text) === speechRightNorm);
      const isIndexMatch = Number.isFinite(correctIndex) && (opt.__originIndex === correctIndex);
      if (isTextMatch || isIndexMatch) btn.setAttribute("data-right", "1");

      // 🔔 notify hooks that choices are ready (include Q index)
try {
  document.dispatchEvent(new CustomEvent('choices-ready', { detail: { sceneId: window.currentSceneId, type: 'video-multi-question', qIndex } }));
} catch(_) {}

// 🎤 arm speech for these choices (id="choices-container")
try {
  if (typeof window.__armSpeechForChoices === 'function') {
    window.__armSpeechForChoices(document.getElementById('choices-container'));
  }
} catch(_) {}

      // No per-option next for VMQ — keep WeakMap empty mapping
      window.__choiceNextMap.set(btn, "");

      btn.style.cssText = "text-align:left;margin:5px;padding:10px 12px;font-weight:700;background:#00ffff;border:none;border-radius:10px;cursor:pointer;color:#000";
      btn.onmouseenter = () => (btn.style.backgroundColor = "#00cccc");
      btn.onmouseleave = () => (btn.style.backgroundColor = "#00ffff");
      regListener(btn, "click", () => {
        const ok = (opt.__originIndex === correctIndex);
        try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, ok ? (scene.tallyWeight || 1) : 0); } catch(_){}
        feedback(ok ? "✅ Correct! Moving on..." : "❌ Not quite. Moving on...", ok ? "lightgreen" : "salmon", ok);
      });

      optionsDiv.appendChild(btn);
    });

    // Pause timer when mic activates
    const micClickHandler = (ev) => {
      const t = ev.target;
      if (t && (t.id === "mc-speak-btn" || t.classList?.contains("speech-btn"))) {
        try { window.SceneTimer?.pause?.(); } catch(_) {}
      }
    };
    document.addEventListener("click", micClickHandler, { capture:true });

    regCleanup(() => {
      document.removeEventListener("click", micClickHandler, { capture:true });
    });
  }

  regListener(video, "ended", startQuestions);
}

function loadAudioScrambleScene(id) {
  const scene = scenes[id];
  if (!scene) {
    console.error(`Scene ${id} not found.`);
    return;
  }

  const gameContainer = document.getElementById("game-container");
  const sceneText     = document.getElementById("scene-text");
  const sceneImage    = document.getElementById("scene-image");
  const infoDiv       = document.getElementById("challenge-info");
  const scrambleDiv   = document.getElementById("sentence-scramble");
  const feedbackDiv   = document.getElementById("scramble-feedback");

  // --- Base UI reset ---
  if (gameContainer) gameContainer.style.display = "block";

  if (sceneImage) {
    sceneImage.style.display = "none";
    sceneImage.src = sceneImage.src; // noop; just keep it hidden for this scene type
  }

  if (infoDiv) {
    infoDiv.style.display = "none";
    infoDiv.innerHTML = "";
  }

  if (sceneText) {
    if (scene.text) {
      sceneText.style.display = "block";
      sceneText.textContent = scene.text;
    } else {
      sceneText.style.display = "none";
      sceneText.textContent = "";
    }
  }

  // --- Clear previous audio, scramble, feedback ---
  const oldAudio = document.getElementById("scene-audio");
  if (oldAudio) {
    try { oldAudio.pause(); } catch (_) {}
    oldAudio.src = "";
    oldAudio.load();
    oldAudio.remove();
  }

  if (scrambleDiv) {
    scrambleDiv.style.display = "none";
    scrambleDiv.innerHTML = "";
  }
  if (feedbackDiv) {
    feedbackDiv.style.display = "none";
    feedbackDiv.textContent = "";
  }

  // --- Build new audio element ---
  const audioElem = document.createElement("audio");
  audioElem.id = "scene-audio";
  audioElem.controls = true;
  audioElem.preload  = "metadata";
  audioElem.setAttribute("playsinline", "");
  audioElem.setAttribute("webkit-playsinline", "");
  audioElem.playsInline = true;
  audioElem.src = resolveSrc(scene.audioSrc);
  audioElem.style.cssText = "display:block;margin:0 auto 16px;width:100%;max-width:480px;";

  // IMPORTANT: we do NOT attach the generic "error" fallback message here.
  // If you really want a fallback, you can add a softer one that you remove per scene.

  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(audioElem, sceneText.nextSibling);
  } else if (gameContainer) {
    gameContainer.appendChild(audioElem);
  }

  // --- When the audio finishes, reveal the scramble UI ---
  audioElem.onended = () => {
    if (scene.noScramble) {
    // Just show a Continue button, no scramble UI
    if (scrambleDiv) {
      scrambleDiv.style.display = "block";
      scrambleDiv.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = "Continue";
      btn.onclick = () => { if (scene.next) loadScene(scene.next); };
      scrambleDiv.appendChild(btn);
    }
    if (feedbackDiv) feedbackDiv.style.display = "none";
    return;
  }
    if (!scrambleDiv || !feedbackDiv) return;

    scrambleDiv.style.display = "block";
    feedbackDiv.style.display = "block";
    scrambleDiv.innerHTML = "";
    feedbackDiv.textContent = "";

    // Instruction
    const instruction = document.createElement("p");
    instruction.className = "scramble-instructions";
    instruction.textContent = "🧩 Drag the parts into the correct order.";
    scrambleDiv.appendChild(instruction);

    // Container for tokens
    const scrambleContainer = document.createElement("div");
    scrambleContainer.id = "scramble-words";
    scrambleDiv.appendChild(scrambleContainer);

    // Source tokens from scene.scramble; we shuffle here
    const source = Array.isArray(scene.scramble) ? scene.scramble.slice() : [];
    const shuffled = typeof shuffleArray === "function"
      ? shuffleArray(source)
      : source.sort(() => Math.random() - 0.5);

    shuffled.forEach(token => {
      const span = document.createElement("span");
      span.className = "scramble-word";
      span.textContent = token;
      scrambleContainer.appendChild(span);
    });

    // Enable drag & drop with SortableJS if available
    try {
      if (window.scrambleSortable && typeof window.scrambleSortable.destroy === "function") {
        window.scrambleSortable.destroy();
      }
      window.scrambleSortable = Sortable.create(scrambleContainer, { animation: 150 });
    } catch (e) {
      console.warn("Sortable unavailable; drag disabled.", e);
    }

    // Check button
    const checkBtn = document.createElement("button");
    checkBtn.id = "scramble-submit-btn";
    checkBtn.textContent = "Check Answer";
    checkBtn.style.marginTop = "15px";
    scrambleDiv.appendChild(checkBtn);

    checkBtn.onclick = () => {
      const wordEls = Array.from(
        scrambleContainer.querySelectorAll(".scramble-word")
      );
      const userOrder = wordEls.map(w => w.textContent.trim());

      // Normalise correct structure: can be array of tokens or full string
      let correctArr;
      if (Array.isArray(scene.correct)) {
        correctArr = scene.correct.slice();
      } else if (typeof scene.correct === "string") {
        correctArr = scene.correct.trim().split(/\s+/);
      } else {
        correctArr = [];
      }

      const isCorrect = typeof arraysEqual === "function"
        ? arraysEqual(userOrder, correctArr)
        : JSON.stringify(userOrder) === JSON.stringify(correctArr);

      if (isCorrect) {
        feedbackDiv.textContent = "✅ Correct! Moving on…";
        feedbackDiv.style.color = "lightgreen";

        if (Array.isArray(scene.unlockScenes)) {
          scene.unlockScenes.forEach(unlockScene);
        }
        if (Array.isArray(scene.setFlags)) {
          scene.setFlags.forEach(setFlag);
        }

        setTimeout(() => {
          if (scene.next) loadScene(scene.next);
        }, 900);
      } else {
        feedbackDiv.textContent = "❌ Not quite. Try again.";
        feedbackDiv.style.color = "salmon";

        // If you want to send them to restart on wrong, you can use endings.wrong instead:
        if (scene.endings && scene.endings.wrong) {
          setTimeout(() => loadScene(scene.endings.wrong), 900);
        }
      }
    };
  };
}






// ─────────────────────────────────────────────────────────────────────────────
// Video → Scramble scene (inline-safe + GitHub Pages-safe URLs)
// ─────────────────────────────────────────────────────────────────────────────
function loadVideoScrambleScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  const gameContainer = document.getElementById("game-container");
  const sceneText     = document.getElementById("scene-text");
  const sceneImage    = document.getElementById("scene-image");
  const infoDiv       = document.getElementById("challenge-info");
  const scrambleDiv   = document.getElementById("sentence-scramble");
  const feedbackDiv   = document.getElementById("scramble-feedback");

  // Hide unrelated UI; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (gameContainer) gameContainer.style.display = "block";
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }

  // Clear any previous video
  let old = document.getElementById("scene-video");
  if (old) { try { old.pause(); } catch(_){} old.src = ""; old.load(); old.remove(); }

  // Build video (resolved URL + inline-safe)
  const videoElem = document.createElement("video");
  videoElem.id = "scene-video";
  videoElem.controls = true;
  videoElem.preload  = "metadata";
  videoElem.setAttribute("playsinline", "");
  videoElem.setAttribute("webkit-playsinline", "");
  videoElem.playsInline = true;
  videoElem.src = resolveSrc(scene.videoSrc);
  if (scene.poster) videoElem.poster = resolveSrc(scene.poster);
  videoElem.style.cssText = "max-width:100%;max-height:360px;display:block;margin:0 auto 20px;border-radius:12px;background:#000;";

  // Graceful fallback if inline playback fails
  videoElem.addEventListener("error", () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700;text-align:center";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.target = "_blank";
    a.textContent = "Open video in a new tab";
    a.style.cssText = "margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    gameContainer.appendChild(msg);
  }, { once:true });

  // Insert video into DOM
  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(videoElem, sceneText.nextSibling);
  } else {
    gameContainer.appendChild(videoElem);
  }

  // After video ends, show scramble UI
  videoElem.onended = () => {
    if (!scrambleDiv || !feedbackDiv) return;

    scrambleDiv.style.display = "block";
    feedbackDiv.style.display = "block";
    scrambleDiv.innerHTML = "";
    feedbackDiv.textContent = "";

    // Instruction
    const instruction = document.createElement("p");
    instruction.className = "scramble-instructions";
    instruction.textContent = "🧩 Drag the words into the correct order:";
    scrambleDiv.appendChild(instruction);

    // Scramble container
    const scrambleContainer = document.createElement("div");
    scrambleContainer.id = "scramble-words";
    const source = Array.isArray(scene.scramble) ? scene.scramble.slice() : [];
    const shuffled = shuffleArray(source);
    shuffled.forEach(token => {
      const span = document.createElement("span");
      span.className = "scramble-word";
      span.textContent = token;
      scrambleContainer.appendChild(span);
    });
    scrambleDiv.appendChild(scrambleContainer);

    // Enable drag/drop
    try {
      if (window.scrambleSortable && typeof window.scrambleSortable.destroy === "function") {
        window.scrambleSortable.destroy();
      }
      window.scrambleSortable = Sortable.create(scrambleContainer, { animation: 150 });
    } catch (e) { console.warn("Sortable unavailable; drag disabled.", e); }

    // Check button
    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.style.marginTop = "15px";
    scrambleDiv.appendChild(checkBtn);

    checkBtn.onclick = () => {
      const words = Array.from(document.querySelectorAll("#scramble-words .scramble-word"));
      const userOrder = words.map(w => w.textContent.trim());
      const correctArr = Array.isArray(scene.correct)
        ? scene.correct
        : (typeof scene.correct === "string" ? scene.correct.trim().split(/\s+/) : []);

      if (arraysEqual(userOrder, correctArr)) {
        feedbackDiv.textContent = "✅ Correct! Moving on...";
        feedbackDiv.style.color = "lightgreen";
        if (Array.isArray(scene.unlockScenes)) scene.unlockScenes.forEach(unlockScene);
        if (Array.isArray(scene.setFlags))     scene.setFlags.forEach(setFlag);
        setTimeout(() => { if (scene.next) loadScene(scene.next); }, 1200);
      } else {
        feedbackDiv.textContent = "❌ Not quite. Try again.";
        feedbackDiv.style.color = "salmon";
      }
    };
  };
}
 





// --- Video → Fill-in-the-Blank loader ---
function loadVideoFillBlankScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Safe shorthands
  const regNode     = window.registerNode     || function(){};
  const regListener = window.registerListener || function(t,e,h){ t.addEventListener(e,h); };
  const regCleanup  = window.registerCleanup  || function(){};

  const game = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "block"; sceneText.textContent = scene.text || ""; }

  // Clear stale UI
  ["vfb-wrap","vfb-ui","scene-video"].forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });

  // ---- Inline-safe video wrapper
  const wrap = document.createElement("div");
  wrap.id = "vfb-wrap";
  wrap.style.cssText = "position:relative;max-width:100%;margin:0 auto 16px;";
  game.appendChild(wrap);

  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.preload = "metadata";
  if (scene.poster) video.poster = resolveSrc(scene.poster);
  video.src = resolveSrc(scene.videoSrc);
  video.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.playsInline = true;
  regNode(video);

  const overlay = document.createElement("button");
  overlay.textContent = "▶ Tap to Play";
  overlay.style.cssText = "position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:180px;height:48px;background:#00ffff;color:#000;border:none;border-radius:10px;font-weight:700;cursor:pointer";
  overlay.onclick = async () => { try { await video.play(); overlay.remove(); } catch(_){} };
  video.addEventListener("play", () => { if (overlay.parentNode) overlay.remove(); });

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip video";
  skipBtn.style.cssText = "margin-top:8px;padding:8px 12px;border:none;border-radius:8px;background:#222;color:#eee;cursor:pointer;font-weight:700";
  skipBtn.onclick = () => startFIB();

  const errorMsg = () => {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:8px;color:orange;font-weight:700";
    msg.textContent = "⚠️ This device can’t play the video inline.";
    const a = document.createElement("a");
    a.href = resolveSrc(scene.videoSrc);
    a.textContent = "Open video in a new tab";
    a.style.cssText = "display:inline-block;margin-left:8px;color:#0ff;text-decoration:underline";
    msg.appendChild(a);
    wrap.appendChild(msg);
  };
  video.addEventListener("error", errorMsg);

  wrap.appendChild(video);
  wrap.appendChild(overlay);
  wrap.appendChild(skipBtn);

  // ---- FIB UI
  function startFIB() {
    wrap.style.display = "none";
    try { video.pause(); } catch(_) {}

    const ui = document.createElement("div");
    ui.id = "vfb-ui";
    ui.style.cssText = "max-width:900px;margin:0 auto;color:#eee";
    game.appendChild(ui);

    const sentEl = document.createElement("p");
    sentEl.id = "vfb-sentence";
    sentEl.style.cssText = "font-size:1.2rem;line-height:1.5;margin-bottom:14px;";
    ui.appendChild(sentEl);

    const optsEl = document.createElement("div");
    optsEl.id = "vfb-options";
    optsEl.style.cssText = "margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;";
    ui.appendChild(optsEl);

    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    ui.appendChild(ctrl);

    const checkBtn = document.createElement("button");
    checkBtn.textContent = "Check Answer";
    checkBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
    checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
    ctrl.appendChild(checkBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.style.cssText = "padding:8px 12px;border:none;border-radius:8px;background:#333;color:#eee;font-weight:700;cursor:pointer";
    ctrl.appendChild(resetBtn);

    const fb = document.createElement("div");
    fb.id = "vfb-feedback";
    fb.style.cssText = "margin-top:10px;font-weight:700;";
    ui.appendChild(fb);

    // Data prep — build sentence/blanks if not provided
    const toWords = s => String(s||"").trim().split(/\s+/).filter(Boolean);
    if (!Array.isArray(scene.sentence) || !Array.isArray(scene.blanks)) {
      const parts = String(scene.text || "").split("___");
      const toks = []; const blanks = [];
      parts.forEach((seg, i) => {
        if (seg) toks.push(...toWords(seg));
        if (i < parts.length - 1) { blanks.push(toks.length); toks.push("___"); }
      });
      scene.sentence = scene.sentence || toks;
      scene.blanks   = scene.blanks   || blanks;
    }

    const sentence = Array.isArray(scene.sentence) ? scene.sentence.slice() : [];
    const blanks   = Array.isArray(scene.blanks) ? scene.blanks.slice() : [];
    const options  = Array.isArray(scene.options) ? scene.options.slice() : [];
    const correct  = Array.isArray(scene.correct) ? scene.correct.slice()
                    : (typeof scene.correct === "string" ? [scene.correct] : []);

    // Render sentence with dropzones
    function paintSentence() {
      let html = "";
      for (let i = 0; i < sentence.length; i++) {
        if (blanks.includes(i)) {
          html += `<span class="vfb-zone" data-idx="${i}" style="display:inline-block;min-width:86px;border-bottom:2px solid #00ffff;margin:0 4px;vertical-align:bottom;padding:4px 6px;background:#111"></span> `;
        } else {
          html += `<span style="margin:0 4px;">${sentence[i]}</span> `;
        }
      }
      sentEl.innerHTML = html;
    }
    paintSentence();

    // Render options
    function paintOptions() {
      optsEl.innerHTML = "";
      options.forEach(opt => {
        const b = document.createElement("button");
        b.textContent = opt;
        b.className = "vfb-opt";
        b.style.cssText = "padding:6px 12px;border-radius:6px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:grab;user-select:none";
        optsEl.appendChild(b);
      });
    }
    paintOptions();

    // Enable drag/drop with Sortable
    const zones = Array.from(sentEl.querySelectorAll(".vfb-zone"));
    const sortZones = [];
    zones.forEach(zone => {
      try {
        const srt = Sortable.create(zone, { group:"vfb", animation:150, sort:false,
          onAdd: (evt) => {
            const dragged = evt.item;
            // ensure one token per zone
            if (zone.children.length > 1) {
              Array.from(zone.children).forEach((c,idx) => { if (idx>0) { optsEl.appendChild(c); } });
            }
          },
          onRemove: (evt) => { optsEl.appendChild(evt.item); }
        });
        sortZones.push(srt);
      } catch(e) { console.warn("Sortable missing?", e); }
    });
    let sortOpts;
    try { sortOpts = Sortable.create(optsEl, { group:"vfb", animation:150 }); } catch(e){}

    function sameToken(a,b){
      const norm = s => String(s||"")
        .replace(/[’']/g,"")        // ignore apostrophes
        .replace(/\s+/g," ")
        .toLowerCase().trim();
      return norm(a) === norm(b);
    }

    checkBtn.onclick = () => {
      const user = [];
      let filled = true;
      zones.forEach((zone, zi) => {
        if (zone.children.length === 1) user.push(zone.children[0].textContent.trim());
        else filled = false;
      });
      if (!filled) { fb.textContent = "⚠️ Please fill all blanks."; fb.style.color = "orange"; return; }

      const ok = (user.length === correct.length) && user.every((t,i) => sameToken(t, correct[i]));
      if (ok) {
        fb.textContent = "✅ Correct! Moving on...";
        fb.style.color = "lightgreen";
        try { if (scene.tallyKey && typeof tallyAdd === 'function') tallyAdd(scene.tallyKey, scene.tallyWeight || 1); } catch(_){}
        setTimeout(() => scene.next ? loadScene(scene.next) : console.warn("video-fill-in-the-blank: no next"), 900);
      } else {
        fb.textContent = "❌ Not quite. Try again.";
        fb.style.color = "salmon";
      }
    };

    resetBtn.onclick = () => {
      zones.forEach(z => { Array.from(z.children).forEach(ch => optsEl.appendChild(ch)); });
      paintOptions();
      fb.textContent = "";
    };

    regCleanup(() => { const n = document.getElementById("vfb-ui"); if (n) n.remove(); });
  }

  regListener(video, "ended", startFIB);
}

// replace your current loadVideoChoiceScene with this updated version
function loadVideoChoiceScene(id) {
  const scene = (window.scenes || {})[id];
  if (!scene) { console.error(`video-choice: scene "${id}" not found`); return; }

  const game       = document.getElementById("game-container");
  const sceneText  = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  if (game) game.style.display = "block";
  if (sceneText) { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  if (sceneImage) { sceneImage.style.display = "none"; sceneImage.innerHTML = ""; }

  // Clear stale UI
  ["scene-video","video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
    const n = document.getElementById(id); if (n) n.remove();
  });

  // Build video
  const video = document.createElement("video");
  video.id = "scene-video";
  video.controls = true;
  video.preload = "metadata";
  video.src = (typeof resolveSrc === "function") ? resolveSrc(scene.videoSrc) : (scene.videoSrc || "");
  if (scene.poster) video.poster = (typeof resolveSrc === "function") ? resolveSrc(scene.poster) : scene.poster;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.style.cssText = "width:100%;height:auto;max-height:45vh;display:block;border-radius:12px;background:#000;margin:0 auto 12px;";
  game.appendChild(video);

  // State
  let timerId = null, timeLeft = 0, paused = false;

  function clearTimer(){ if (timerId) { clearInterval(timerId); timerId = null; } }
  function renderTimer(div){ if (div) div.textContent = `⏳ Time left: ${Math.max(0,timeLeft)}s${paused?' (paused)':''}`; }

  function startChoices() {
    // Disarm video so it won’t steal focus
    try { video.pause(); } catch(_) {}
    try { video.currentTime = 0; } catch(_) {}
    video.removeAttribute("controls");
    video.style.pointerEvents = "none";
    video.style.opacity = "0.25";

    // Remove old panel if any
    ["video-choices","video-choices-timer","video-choices-feedback"].forEach(id => {
      const n = document.getElementById(id); if (n) n.remove();
    });

    // Timer (scene.timer may be true | number | undefined)
    const VMQ_DEFAULT_SECONDS = 15;
    const seconds = (scene.timer === true) ? VMQ_DEFAULT_SECONDS
                  : (Number.isFinite(scene.timer) && scene.timer > 0) ? Math.floor(scene.timer)
                  : null;

    let timerDiv = null;
    if (seconds) {
      timeLeft = seconds;
      timerDiv = document.createElement("div");
      timerDiv.id = "video-choices-timer";
      timerDiv.style.cssText = "font-weight:700;font-size:1.05rem;color:#00ffff;margin:8px 0;";
      game.appendChild(timerDiv);
      renderTimer(timerDiv);

      clearTimer();
      timerId = setInterval(() => {
        if (!paused) {
          timeLeft -= 1;
          renderTimer(timerDiv);
          if (timeLeft <= 0) {
            clearTimer();
            const timeoutDest = scene.timeoutNext || scene.next;
            if (timeoutDest) return loadScene(timeoutDest);
          }
        } else {
          renderTimer(timerDiv);
        }
      }, 1000);
    }

    // SceneTimer API for speech hook
    const prevSceneTimer = window.SceneTimer;
    const sceneTimerAPI = {
      pause:  () => { paused = true;  renderTimer(timerDiv); },
      resume: () => { paused = false; renderTimer(timerDiv); },
      isPaused: () => paused,
      getTimeLeft: () => timeLeft,
      _clear: () => clearTimer()
    };
    window.SceneTimer = sceneTimerAPI;

    // Pause/resume timer on speech lifecycle
    const onSpeechStart  = () => { try { window.SceneTimer?.pause?.(); } catch(_) {} };
    const onSpeechFinish = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
    const onSpeechCancel = () => { try { window.SceneTimer?.resume?.(); } catch(_) {} };
    document.addEventListener('speech-start',  onSpeechStart);
    document.addEventListener('speech-finish', onSpeechFinish);
    document.addEventListener('speech-cancel', onSpeechCancel);

    // Choices wrap
    const wrap = document.createElement("div");
    wrap.id = "video-choices";
    wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;margin:10px 0;";
    game.appendChild(wrap);

    const mcHost = document.createElement("div");
    mcHost.id = "choices-container"; // <- speech hook looks here
    mcHost.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    wrap.appendChild(mcHost);

    const fb = document.createElement("div");
    fb.id = "video-choices-feedback";
    fb.style.cssText = "margin-top:6px;font-weight:700;";
    game.appendChild(fb);

    // Build buttons (shuffle-safe tagging)
    const norm = (s) => String(s||'')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g,"'")
      .replace(/[\u201C\u201D]/g,'"')
      .replace(/\s+/g,' ')
      .trim();

    let choices = Array.isArray(scene.choices) ? scene.choices.slice() : [];
    const speechRightNorm = scene.speechRightText ? norm(scene.speechRightText) : null;

    // Preserve origin index for mapping
    choices = choices.map((c, i) => ({ ...c, __originIndex: i }));
    if (scene.shuffleOptions) {
      for (let i=choices.length-1; i>0; i--) {
        const j = Math.floor(Math.random() * (i+1));
        [choices[i], choices[j]] = [choices[j], choices[i]];
      }
    }

    window.__choiceNextMap = window.__choiceNextMap || new WeakMap();

    choices.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = opt.text;
      btn.dataset.originIndex = String(opt.__originIndex);
      if (opt.next) btn.dataset.next = opt.next;                  // <-- critical
      // WeakMap target for speech fallback
      try { window.__choiceNextMap.set(btn, opt.next || ""); } catch{ }

      // Tag right by text match (for speech “right” cue), *navigation* still uses next
      if (speechRightNorm && norm(opt.text) === speechRightNorm) {
        btn.setAttribute("data-right", "1");
      }

      btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      btn.onmouseenter = () => (btn.style.background = "#00cccc");
      btn.onmouseleave = () => (btn.style.background = "#00ffff");
      btn.onclick = () => {
        clearTimer();
        if (opt.applyCrm) { try { window.crm && window.crm.apply(opt.applyCrm); } catch(_){} }
        if (opt.next) return loadScene(opt.next);
      };
      mcHost.appendChild(btn);
    });

    try {
  document.dispatchEvent(new CustomEvent('choices-ready', { detail:{ sceneId: window.currentSceneId } }));
} catch(_){}

    // Let the speech hook know choices are ready
    try { document.dispatchEvent(new CustomEvent('choices-ready', { detail: { sceneId: id } })); } catch {}

    // Last-ditch reconciliation: ensure every button ends up with a resolvable next
    (function reconcileChoiceNexts() {
      const btns = mcHost.querySelectorAll('.choice');
      const model = (Array.isArray(scene.choices) ? scene.choices : []).map(c => ({
        head: norm(String(c.text || '').slice(0,120)),
        next: c.next || ''
      }));
      btns.forEach((b) => {
        let target = b.getAttribute('data-next') || (window.__choiceNextMap && window.__choiceNextMap.get(b)) || '';
        if (!target) {
          const oi = Number(b.getAttribute('data-originIndex'));
          if (Number.isFinite(oi) && scene.choices && scene.choices[oi] && scene.choices[oi].next) {
            target = scene.choices[oi].next;
          }
        }
        if (!target) {
          const head = norm((b.textContent || '').slice(0,120));
          const hit = model.find(m => m.head && (head.startsWith(m.head) || m.head.startsWith(head) || head.includes(m.head) || m.head.includes(head)));
          if (hit && hit.next) target = hit.next;
        }
        if (target) {
          b.setAttribute('data-next', target);
          try { window.__choiceNextMap.set(b, target); } catch {}
        }
      });
    })();

    // Cleanup when leaving scene
    registerCleanup(() => {
      clearTimer();
      document.removeEventListener('speech-start',  onSpeechStart);
      document.removeEventListener('speech-finish', onSpeechFinish);
      document.removeEventListener('speech-cancel', onSpeechCancel);
      try {
        if (window.SceneTimer === sceneTimerAPI) {
          if (prevSceneTimer) window.SceneTimer = prevSceneTimer; else delete window.SceneTimer;
        }
      } catch {}
      const ids = ["video-choices","video-choices-timer","video-choices-feedback"];
      ids.forEach(x => { const n = document.getElementById(x); if (n) n.remove(); });
    });
  }

  // Start choices when video ends (or immediately if no videoSrc)
  video.addEventListener("ended", startChoices);
  if (!scene.videoSrc) startChoices(); // safety
}
















// === Hangman loader (updated: no seepage, defensive keyboard cleanup) ===
function loadHangmanScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Clean prior instance
  document.getElementById('hangman')?.remove();
  if (window.__hmKeyHandler) {
    document.removeEventListener('keydown', window.__hmKeyHandler);
    window.__hmKeyHandler = null;
  }

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Kill any media from prior scenes
  document.getElementById("scene-video")?.remove();
  document.getElementById("scene-audio")?.remove();

  // Config
  const rawTarget = scene.target || "";
  const target = rawTarget.toUpperCase();
  const alphabet = (scene.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZ").split("");
  const maxWrong = Number.isFinite(scene.maxWrong) ? scene.maxWrong : 6;

  // State
  const guessed = new Set();
  let wrong = 0;
  let solved = false;

  // Build UI
  const wrap = document.createElement("div");
  wrap.id = "hangman";
  wrap.style.maxWidth = "720px";
  wrap.style.margin = "0 auto";
  wrap.style.padding = "12px 8px";
  wrap.style.textAlign = "center";
  wrap.style.color = "#eee";

  wrap.innerHTML = `
    <div id="hm-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="hm-lives" style="font-weight:bold;">❤️ Lives: <span id="hm-lives-num">${maxWrong - wrong}</span></div>
      ${scene.hint ? `<div id="hm-hint" style="opacity:.85;">💡 ${scene.hint}</div>` : `<div></div>`}
    </div>

    <div id="hm-word"
      style="margin:18px 0;font:700 28px/1.4 system-ui,Segoe UI,Arial,Helvetica,Apple Color Emoji,Segoe UI Emoji;letter-spacing:.08em;"></div>

    <div id="hm-letters" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;"></div>

    <div id="hm-feedback" style="margin-top:14px;font-weight:700;"></div>
    <div id="hm-ctrl" style="margin-top:12px;"></div>
  `;

  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  } else if (gameContainer) {
    gameContainer.appendChild(wrap);
  }

  const livesNum = wrap.querySelector("#hm-lives-num");
  const wordEl = wrap.querySelector("#hm-word");
  const lettersEl = wrap.querySelector("#hm-letters");
  const feedbackEl = wrap.querySelector("#hm-feedback");
  const ctrlEl = wrap.querySelector("#hm-ctrl");

  // Helpers
  function isLetter(ch) { return /^[A-Z]$/.test(ch); }
  function displayWord() {
    const out = [];
    for (const ch of target) out.push(isLetter(ch) ? (guessed.has(ch) ? ch : "_") : ch);
    wordEl.textContent = out.join(" ");
  }
  function allRevealed() {
    for (const ch of target) if (isLetter(ch) && !guessed.has(ch)) return false;
    return true;
  }
  function disableAll() { lettersEl.querySelectorAll("button").forEach(b => b.disabled = true); }

  function finishWin() {
    solved = true;
    feedbackEl.textContent = "✅ Correct! You solved it.";
    feedbackEl.style.color = "lightgreen";
    disableAll();

    if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

    if (scene.next) {
      setTimeout(() => loadScene(scene.next), 900);
    } else {
      ctrlEl.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = "Continue";
      btn.onclick = () => loadScene("scene1");
      ctrlEl.appendChild(btn);
    }
  }

  function finishLose() {
    feedbackEl.textContent = `❌ Out of lives. The answer was: "${rawTarget}"`;
    feedbackEl.style.color = "salmon";
    disableAll();
    ctrlEl.innerHTML = "";

    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.style.marginRight = "8px";
    retry.onclick = () => loadScene(id);
    ctrlEl.appendChild(retry);

    if (!scene.suppressHub) {
      const back = document.createElement("button");
      back.textContent = "Back to Hub";
      back.onclick = () => loadScene("scene1");
      ctrlEl.appendChild(back);
    }

    if (scene.onLoseNext) {
      const nextBtn = document.createElement("button");
      nextBtn.textContent = "Continue";
      nextBtn.style.marginLeft = "8px";
      nextBtn.onclick = () => loadScene(scene.onLoseNext);
      ctrlEl.appendChild(nextBtn);
    }
  }

  function guessLetter(letter) {
    const L = String(letter || "").toUpperCase();
    if (!alphabet.includes(L) || guessed.has(L) || solved) return;
    guessed.add(L);
    lettersEl.querySelector(`button[data-letter="${L}"]`)?.setAttribute('disabled','');

    if (target.includes(L)) {
      displayWord();
      if (allRevealed()) finishWin();
    } else {
      wrong++;
      livesNum.textContent = String(maxWrong - wrong);
      if (wrong >= maxWrong) finishLose();
    }
  }

  // Render alphabet
  alphabet.forEach(ch => {
    const b = document.createElement("button");
    b.textContent = ch;
    b.dataset.letter = ch;
    b.style.cssText = "min-width:34px;padding:8px;border-radius:8px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
    b.onmouseenter = () => (b.style.background = "#00cccc");
    b.onmouseleave = () => (b.style.background = "#00ffff");
    b.onclick = () => guessLetter(ch);
    lettersEl.appendChild(b);
  });

  // ====== Speech helpers (EN-focused) ======
  const SF = window.SpeechFeature || {};
  const LetterNames = new Map((()=>{
    const add = (m,L,arr)=>arr.forEach(a=>m.set(a,L));
    const m = new Map();
    // English letter names + common variants
    add(m,'A',['a','ay','eh']); add(m,'B',['b','bee','be']); add(m,'C',['c','cee','see']);
    add(m,'D',['d','dee','di']); add(m,'E',['e','ee','ih']); add(m,'F',['f','ef','eff']);
    add(m,'G',['g','gee','ji']); add(m,'H',['h','aitch']); add(m,'I',['i','eye','ai','aye']);
    add(m,'J',['j','jay','jei']); add(m,'K',['k','kay','kei']); add(m,'L',['l','el','ell']);
    add(m,'M',['m','em','emm']); add(m,'N',['n','en','enn']); add(m,'O',['o','oh','ou']);
    add(m,'P',['p','pee','pea']); add(m,'Q',['q','cue','queue']); add(m,'R',['r','ar','are']);
    add(m,'S',['s','ess','es']); add(m,'T',['t','tee','ti']); add(m,'U',['u','you','yu']);
    add(m,'V',['v','vee','vi']); add(m,'W',['w','double u','double-you','doubleu']);
    add(m,'X',['x','ex','eks']); add(m,'Y',['y','why']); add(m,'Z',['z','zed','zee']);
    // NATO (English)
    const NATO = {
      A:['alpha'],B:['bravo'],C:['charlie'],D:['delta'],E:['echo'],F:['foxtrot'],G:['golf'],
      H:['hotel'],I:['india'],J:['juliett','juliet'],K:['kilo'],L:['lima'],M:['mike'],
      N:['november'],O:['oscar'],P:['papa'],Q:['quebec'],R:['romeo'],S:['sierra'],
      T:['tango'],U:['uniform'],V:['victor'],W:['whiskey','whisky'],X:['xray','x-ray'],
      Y:['yankee'],Z:['zulu']
    };
    Object.entries(NATO).forEach(([L,arr])=>arr.forEach(a=>m.set(a,L)));
    return m;
  })());

  function norm(s){
    return String(s||'').toLowerCase()
      .replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
      .replace(/[^a-z0-9\s'-]/gi,' ').replace(/\s+/g,' ').trim();
  }

  function buildLetterGrammar() {
    const JSGF_HEADER = '#JSGF V1.0;';
    const letters = 'a | b | c | d | e | f | g | h | i | j | k | l | m | n | o | p | q | r | s | t | u | v | w | x | y | z';
    const names = Array.from(new Set([...LetterNames.keys()])).join(' | ');
    const phrase =
      '(letter ( ' + letters + ' | ' + names + ' )) | ' +
      '(( ' + letters + ' ) for ( ' + names + ' )) | ' +
      '(' + letters + ') | (' + names + ') | ' +
      '(' + letters.split(' | ').map(ch => `'${ch}`).join(' | ') + ')';
    return `${JSGF_HEADER}
grammar hangman;
public <choice> = ${phrase} ;`;
  }

  function listenLetterFirst(onDone) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { onDone({heard:'', alts:[], empty:true}); return; }

    const rec = new Rec();
    const SGL = window.SpeechGrammarList || window.webkitSpeechGrammarList;
    if (SGL) {
      const list = new SGL();
      list.addFromString(buildLetterGrammar(), 1.0);
      rec.grammars = list;
    }
    rec.lang = (SF.settings?.lang) || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 20;

    let best = '', list = [];
    rec.onresult = (e) => {
      const arr = Array.from(e.results?.[0] || []);
      list = arr;
      best = (arr.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0]?.transcript || '').trim();
    };
    rec.onerror = () => onDone({heard:best, alts:list, error:true});
    rec.onend   = () => onDone({heard:best, alts:list});

    try { rec.start(); } catch { onDone({heard:'', alts:[], error:true}); }
  }

  function listenFree(onDone){
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { onDone({heard:'', alts:[], empty:true}); return; }
    const rec = new Rec();
    rec.lang = (SF.settings?.lang) || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 30;

    let best = '', list = [];
    rec.onresult = (e) => {
      const arr = Array.from(e.results?.[0] || []);
      list = arr;
      best = (arr.sort((a,b)=>(b.confidence||0)-(a.confidence||0))[0]?.transcript || '').trim();
    };
    rec.onerror = () => onDone({heard:best, alts:list, error:true});
    rec.onend   = () => onDone({heard:best, alts:list});

    try { rec.start(); } catch { onDone({heard:'', alts:[], error:true}); }
  }

  function editDistance(a, b) {
    a = String(a||''); b = String(b||'');
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = new Array(n+1);
    for (let j=0;j<=n;j++) dp[j]=j;
    for (let i=1;i<=m;i++){
      let prev=dp[0]; dp[0]=i;
      for (let j=1;j<=n;j++){
        const t=dp[j];
        dp[j]=Math.min(dp[j]+1, dp[j-1]+1, prev + (a[i-1]===b[j-1]?0:1));
        prev=t;
      }
    }
    return dp[n];
  }

  function pickLetterFromTranscript(heard, alts){
    const seq = [heard, ...(Array.isArray(alts)?alts.map(a=>a?.transcript||''):[])].map(norm).filter(Boolean);
    const letterRE = /^[a-z]$/i;
    const targetClean = target.replace(/[^A-Z]/g,'');
    const targetSet = new Set(targetClean.split(''));

    // explicit "letter X"
    for (const h of seq){
      const m = h.match(/\bletter\s+([a-z])\b/);
      if (m) return { letter: m[1].toUpperCase(), word:false };
    }
    // letter names anywhere in phrase
    for (const h of seq){
      const toks = h.split(' ').filter(Boolean);
      for (const tok of toks){
        if (letterRE.test(tok)) return { letter: tok.toUpperCase(), word:false };
        const L = LetterNames.get(tok);
        if (L) return { letter: L, word:false };
      }
    }
    // single token = letter name
    for (const h of seq){
      const toks = h.split(' ');
      if (toks.length===1){
        const tok = toks[0];
        if (letterRE.test(tok)) return { letter: tok.toUpperCase(), word:false };
        const L = LetterNames.get(tok);
        if (L) return { letter: L, word:false };
      }
    }
    // “X for X-ray”
    for (const h of seq){
      const m = h.match(/\b([a-z])\b\s+(?:for)\s+([a-z-]+)/i);
      if (m){
        const raw = m[1].toUpperCase();
        const cue = LetterNames.get(norm(m[2]));
        if (cue && cue === raw) return { letter: raw, word:false };
      }
    }
    // spelled sequences → first unseen
    for (const h of seq){
      const toks = h.split(' ');
      let seqLetters = [];
      for (const t of toks){
        if (letterRE.test(t)) seqLetters.push(t.toUpperCase());
        else {
          const L = LetterNames.get(t);
          if (L) seqLetters.push(L);
          else { seqLetters = []; break; }
        }
      }
      if (seqLetters.length){
        for (const L of seqLetters){
          if (alphabet.includes(L) && !guessed.has(L)) return { letter:L, word:false };
        }
      }
    }
    // single squeezed char
    for (const h of seq){
      const squeezed = h.replace(/[^a-z]/g,'').toUpperCase();
      if (squeezed.length===1 && alphabet.includes(squeezed) && !guessed.has(squeezed)){
        return { letter:squeezed, word:false };
      }
    }
    // strong single-token word guess
    for (const h of seq){
      const toks = h.split(' ').filter(Boolean);
      if (toks.length===1 && toks[0].length>1){
        const cand = toks[0].toUpperCase().replace(/[^A-Z]/g,'');
        if (!cand) continue;
        const dist = editDistance(cand, targetClean);
        if (cand===targetClean || dist <= (targetClean.length>=6?2:1)) return { word:true };
      }
    }
    return null;
  }

  // ===== Hangman mic (single button) =====
  document.getElementById('hm-mic')?.remove();
  document.getElementById('hangman-speak-btn')?.remove();

  const micRow = document.createElement('div');
  micRow.style.cssText = "margin:10px 0; display:flex; gap:8px; justify-content:center; align-items:center; flex-wrap:wrap;";
  const hint = document.createElement('div');
  hint.textContent = 'Say “C”, “Charlie”, or the full word.';
  hint.style.cssText = "opacity:.8; font-size:.9em;";
  const micBtn = document.createElement('button');
  micBtn.id = 'hm-mic';
  micBtn.className = 'speech-btn';
  micBtn.textContent = '🎙️ Say a letter / word';
  micBtn.style.cssText = "padding:8px 12px; font-weight:700;";
  micRow.appendChild(micBtn);
  micRow.appendChild(hint);
  ctrlEl.appendChild(micRow);

  function disambiguate(cands){
    const uiOld = ctrlEl.querySelector('#hm-ask'); uiOld?.remove();
    const ui = document.createElement('div');
    ui.id = 'hm-ask';
    ui.style.cssText = 'margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
    const msg = document.createElement('div'); msg.textContent = 'Did you mean:'; msg.style.opacity='.85';
    ui.appendChild(msg);
    cands.slice(0,4).forEach(L=>{
      const b = document.createElement('button');
      b.textContent = L;
      b.style.cssText = 'min-width:34px;padding:8px;border-radius:8px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer';
      b.onclick = ()=>{ ui.remove(); guessLetter(L); finish(); };
      ui.appendChild(b);
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #2b3038;background:#1e2127;color:#eaeaea;cursor:pointer';
    cancel.onclick = ()=>{ ui.remove(); finish(); };
    ui.appendChild(cancel);
    ctrlEl.appendChild(ui);
  }

  function finish(){
    micBtn.disabled = false;
    micBtn.textContent = '🎙️ Say a letter / word';
    try { window.SceneTimer?.resume(); } catch{}
  }

  function preferTargets(cands){
    const targetSet = new Set(target.replace(/[^A-Z]/g,'').split(''));
    const V = new Set(['A','E','I','O','U']);
    return [...new Set(cands)]
      .map(L => {
        let s = 0;
        if (targetSet.has(L)) s += 2;
        if (!guessed.has(L)) s += 1.2;
        if (V.has(L)) s += 0.1;
        return {L,s};
      })
      .sort((a,b)=>b.s-a.s)
      .map(x=>x.L);
  }

  let busy = false;
  micBtn.addEventListener('click', () => {
    if (busy) return; busy = true;
    micBtn.disabled = true; micBtn.textContent = '🎙️ Listening…';
    try { window.SceneTimer?.pause(); } catch{}

    const handlePick = (pick) => {
      if (pick?.letter && !guessed.has(pick.letter)) { guessLetter(pick.letter); busy=false; finish(); return true; }
      if (pick?.word === true) {
        for (const ch of target) if (/[A-Z]/.test(ch)) guessed.add(ch);
        displayWord(); if (allRevealed()) finishWin();
        busy=false; finish(); return true;
      }
      return false;
    };

    const propose = (tokens) => {
      const rawLetters = [];
      tokens.forEach(h => {
        h.split(' ').forEach(t => {
          const mapped = LetterNames.get(t);
          if (mapped) rawLetters.push(mapped);
          else if (/^[a-z]$/.test(t)) rawLetters.push(t.toUpperCase());
        });
        h.replace(/[^a-z]/g,'').toUpperCase().split('').forEach(ch=>{
          if (/^[A-Z]$/.test(ch)) rawLetters.push(ch);
        });
      });
      const ranked = preferTargets(rawLetters).filter(L=>alphabet.includes(L) && !guessed.has(L));
      if (ranked.length){
        feedbackEl.style.color = '#ffd166';
        feedbackEl.textContent = 'Not sure — tap your letter:';
        disambiguate(ranked);
        busy=false; return true;
      }
      return false;
    };

    const finalFallback = () => {
      busy=false;
      feedbackEl.style.color = '#ffd166';
      feedbackEl.textContent = 'Try saying “C”, “Charlie”, or the full word.';
      finish();
    };

    listenFree(({heard, alts})=>{
      if (handlePick(pickLetterFromTranscript(heard, alts))) return;

      listenLetterFirst(({heard:h2, alts:a2})=>{
        if (handlePick(pickLetterFromTranscript(h2, a2))) return;
        const toks = [h2, ...(Array.isArray(a2)?a2.map(a=>a?.transcript||''):[])].map(norm).filter(Boolean);
        if (propose(toks)) return;
        finalFallback();
      });
    });
  });

  // Keyboard support
  const keyHandler = (e) => {
    const k = (e.key || "").toUpperCase();
    if (/^[A-Z]$/.test(k)) { e.preventDefault(); guessLetter(k); }
  };
  document.addEventListener("keydown", keyHandler);
  window.__hmKeyHandler = keyHandler;

  // Clean key handler if scene unmounts
  const observer = new MutationObserver(() => {
    const alive = document.getElementById('hangman');
    if (!alive && window.__hmKeyHandler) {
      document.removeEventListener('keydown', window.__hmKeyHandler);
      window.__hmKeyHandler = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  displayWord();

  // Belt & braces: remove any global speech buttons
  document.getElementById('mc-speak-btn')?.remove();
  document.getElementById('floating-mc-mic')?.remove();
}





// === Grammar Survivor (seepage-proof) ===
function loadSurvivorQuizScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Pre-clean any previous instance + timers
  if (window.__svCleanup) { try { window.__svCleanup(); } catch(_){} window.__svCleanup = null; }
  const stale = document.getElementById('survivor-quiz');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated UI; show prompt/instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config
  const qs = Array.isArray(scene.questions) ? scene.questions.slice() : [];
  const livesStart = Number.isFinite(scene.lives) ? scene.lives : 3;
  const defaultTimer = Number.isFinite(scene.timer) && scene.timer > 0 ? scene.timer : 0;

  // State
  let qIndex = 0;
  let lives = livesStart;
  let score = 0;
  let timer = 0;
  let interval = null;

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'survivor-quiz';
  wrap.style.maxWidth = '760px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '12px 8px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="sv-top" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="sv-progress" style="font-weight:700;">Q 1/${qs.length}</div>
      <div id="sv-lives" style="font-weight:700;">❤️ ${'❤'.repeat(lives)}<span style="opacity:.4">${'♡'.repeat(Math.max(0, livesStart - lives))}</span></div>
      <div id="sv-timer" style="min-width:120px;text-align:right;font-weight:700;"></div>
    </div>
    <div id="sv-question" style="margin:14px 0 8px;font:600 20px/1.35 system-ui,Segoe UI,Arial,Helvetica;"></div>
    <div id="sv-options" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div id="sv-feedback" style="margin-top:12px;font-weight:700;"></div>
    <div id="sv-ctrl" style="margin-top:14px;"></div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else if (gameContainer) gameContainer.appendChild(wrap);

  const elProgress = wrap.querySelector('#sv-progress');
  const elLives    = wrap.querySelector('#sv-lives');
  const elTimer    = wrap.querySelector('#sv-timer');
  const elQ        = wrap.querySelector('#sv-question');
  const elOpts     = wrap.querySelector('#sv-options');
  const elFB       = wrap.querySelector('#sv-feedback');
  const elCtrl     = wrap.querySelector('#sv-ctrl');

  function paintLives() {
    elLives.innerHTML = `❤️ ${'❤'.repeat(lives)}<span style="opacity:.4">${'♡'.repeat(Math.max(0, livesStart - lives))}</span>`;
  }
  function stopTimer() { if (interval) { clearInterval(interval); interval = null; } elTimer.textContent = ''; }
  function startTimer(seconds) {
    stopTimer();
    if (!seconds || seconds <= 0) return;
    timer = seconds;
    elTimer.textContent = `⏳ ${timer}s`;
    interval = setInterval(() => {
      timer--;
      if (timer >= 0) elTimer.textContent = `⏳ ${timer}s`;
      if (timer <= 0) { stopTimer(); handleAnswer(-1, true); }
    }, 1000);
  }
  function disableButtons() { [...elOpts.querySelectorAll('button')].forEach(b => b.disabled = true); }

  // local cleanup used before navigating away
  function cleanup() {
    try { stopTimer(); } catch(_) {}
    const node = document.getElementById('survivor-quiz');
    if (node) node.remove();
  }
  // safe navigation: cleanup first, then go
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  function nextQuestion() { qIndex++; (qIndex >= qs.length) ? finish() : renderQuestion(); }

  function finishLose() {
    stopTimer();
    elFB.textContent = "❌ You ran out of lives.";
    elFB.style.color = "salmon";
    elCtrl.innerHTML = "";

    if (Array.isArray(scene.setFlagsOnLose)) scene.setFlagsOnLose.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnLose)) scene.unlockScenesOnLose.forEach(unlockScene);

    // Retry
    const retry = document.createElement('button');
    retry.textContent = scene.retryLabel || "Retry";
    retry.style.marginRight = "8px";
    retry.onclick = () => goNext(id);
    elCtrl.appendChild(retry);

    // Hub only if NOT suppressed
    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }

    // Optional remedial/continue
    if (scene.onLoseNext) {
      const cont = document.createElement('button');
      cont.textContent = "Continue";
      cont.style.marginLeft = "8px";
      cont.onclick = () => goNext(scene.onLoseNext);
      elCtrl.appendChild(cont);
    }
  }

  function finish() {
    stopTimer();

    // Endings map (score-based) first
    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      let dest;
      if (score >= high) dest = scene.endings.high;
      else if (score >= medium) dest = scene.endings.medium;
      else dest = scene.endings.low;
      if (dest) return goNext(dest);
    }

    if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
    if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

    if (scene.next) return goNext(scene.next);

    // Neutral summary; only show Hub if not suppressed
    elFB.textContent = `🏁 Done! Score: ${score}/${qs.length}`;
    elFB.style.color = "#7fffd4";
    elCtrl.innerHTML = "";

    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }
  }

  function handleAnswer(choiceIndex, timedOut = false) {
    stopTimer();
    disableButtons();
    const q = qs[qIndex];
    const correct = (choiceIndex === q.correct);

    if (correct) {
      score++;
      elFB.textContent = "✅ Correct!";
      elFB.style.color = "lightgreen";
    } else {
      lives--;
      paintLives();
      elFB.textContent = timedOut ? "⌛ Time’s up!" : "❌ Not quite.";
      elFB.style.color = "salmon";
      if (q.explain) {
        const exp = document.createElement('div');
        exp.style.marginTop = "6px";
        exp.style.opacity = ".85";
        exp.textContent = `Hint: ${q.explain}`;
        elFB.appendChild(exp);
      }
    }

    if (lives <= 0) setTimeout(finishLose, 700);
    else setTimeout(nextQuestion, 800);
  }

  function renderQuestion() {
    elCtrl.innerHTML = "";
    elFB.textContent = "";
    const q = qs[qIndex];

    elProgress.textContent = `Q ${qIndex + 1}/${qs.length}`;
    elQ.textContent = q.text || "";

    elOpts.innerHTML = "";
    (q.options || []).forEach((opt, i) => {
      const b = document.createElement('button');
      b.textContent = opt;
      b.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
      b.onmouseenter = () => (b.style.background = "#00cccc");
      b.onmouseleave = () => (b.style.background = "#00ffff");
      b.onclick = () => handleAnswer(i, false);
      elOpts.appendChild(b);
    });

    const perQ = Number.isFinite(q.timer) && q.timer > 0 ? q.timer : defaultTimer;
    startTimer(perQ);
  }

  // Global cleanup hook
  window.__svCleanup = function () { cleanup(); };

  // Auto-clean timers if wrapper disappears
  const mo = new MutationObserver(() => {
    const alive = document.getElementById('survivor-quiz');
    if (!alive) { stopTimer(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Kick off
  paintLives();
  renderQuestion();
  function finish() {
  stopTimer();

  // Endings map (score-based) first
  if (scene.scoring && scene.endings) {
    const { high = Infinity, medium = -Infinity } = scene.scoring;
    let dest;
    if (score >= high) dest = scene.endings.high;
    else if (score >= medium) dest = scene.endings.medium;
    else dest = scene.endings.low;
    if (dest) return goNext(dest);
  }

  if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
  if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

  // If a next is defined, go there
  if (scene.next) return goNext(scene.next);

  // Otherwise show a summary + buttons that make sense for gating
  elFB.textContent = `🏁 Done! Score: ${score}/${qs.length}`;
  elFB.style.color = "#7fffd4";
  elCtrl.innerHTML = "";

  // Always offer Retry in the no-route case
  const retry = document.createElement('button');
  retry.textContent = scene.retryLabel || "Retry";
  retry.style.marginRight = "8px";
  retry.onclick = () => goNext(id);
  elCtrl.appendChild(retry);

  // Only show Hub if NOT suppressed
  if (!scene.suppressHub) {
    const back = document.createElement('button');
    back.textContent = "Back to Hub";
    back.onclick = () => goNext("scene1");
    elCtrl.appendChild(back);
  }
}

}


// === Conjugation Race (timed typing drill; seepage-proof) ===
function loadConjugationRaceScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // Pre-clean any previous instance
  if (window.__crCleanup) { try { window.__crCleanup(); } catch(_){} window.__crCleanup = null; }
  const stale = document.getElementById('conj-race');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config
  const items = Array.isArray(scene.questions) ? scene.questions.slice() : [];
  const shuffle = !!scene.shuffle;
  const timerOverall = Number.isFinite(scene.timerOverall) ? scene.timerOverall : null;
  const timerPer = Number.isFinite(scene.timerPer) ? scene.timerPer : null;
  const showAnswerOnWrong = scene.showAnswerOnWrong !== false;
  const acceptPunctuationVariants = scene.acceptPunctuationVariants !== false;
  const caseInsensitive = scene.caseInsensitive !== false;

  if (shuffle) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  // State
  let qIndex = 0;
  let score = 0;
  let tRemaining = timerOverall || 0;
  let tItem = timerPer || 0;
  let intervalOverall = null;
  let intervalPer = null;

  // Build UI
  const wrap = document.createElement('div');
  wrap.id = 'conj-race';
  wrap.style.maxWidth = '760px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '12px 8px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="cr-top" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div id="cr-progress" style="font-weight:700;">Q 1/${items.length}</div>
      <div id="cr-score" style="font-weight:700;">Score: 0</div>
      <div id="cr-timer" style="min-width:140px;text-align:right;font-weight:700;"></div>
    </div>

    <div id="cr-prompt" style="margin:16px 0 8px;font:600 20px/1.35 system-ui,Segoe UI,Arial,Helvetica;"></div>

    <div id="cr-inputrow" style="display:flex;gap:8px;align-items:center;">
      <input id="cr-input" type="text" autocomplete="off"
             style="flex:1;min-width:140px;padding:10px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700"/>
      <button id="cr-submit" style="padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer">Submit</button>
    </div>

    <div id="cr-feedback" style="margin-top:10px;font-weight:700;"></div>
    <div id="cr-ctrl" style="margin-top:14px;"></div>
  `;

  if (sceneText && sceneText.parentNode) {
    sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  } else if (gameContainer) {
    gameContainer.appendChild(wrap);
  }

  const elProgress = wrap.querySelector('#cr-progress');
  const elScore    = wrap.querySelector('#cr-score');
  const elTimer    = wrap.querySelector('#cr-timer');
  const elPrompt   = wrap.querySelector('#cr-prompt');
  const elInput    = wrap.querySelector('#cr-input');
  const elSubmit   = wrap.querySelector('#cr-submit');
  const elFB       = wrap.querySelector('#cr-feedback');
  const elCtrl     = wrap.querySelector('#cr-ctrl');

  // Helpers
  const norm = (s) => {
    if (s == null) return '';
    let x = String(s).trim();
    if (caseInsensitive) x = x.toLowerCase();
    if (acceptPunctuationVariants) {
      x = x
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/\u00A0/g, ' ');
    }
    return x;
  };

  function stopOverallTimer() { if (intervalOverall) { clearInterval(intervalOverall); intervalOverall = null; } }
  function stopPerTimer() { if (intervalPer) { clearInterval(intervalPer); intervalPer = null; } }

  function startOverallTimer(seconds) {
    stopOverallTimer();
    if (!seconds || seconds <= 0) return;
    tRemaining = seconds;
    elTimer.textContent = `⏳ ${tRemaining}s total`;
    intervalOverall = setInterval(() => {
      tRemaining--;
      if (tRemaining >= 0) elTimer.textContent = `⏳ ${tRemaining}s total`;
      if (tRemaining <= 0) { stopPerTimer(); stopOverallTimer(); finish(); }
    }, 1000);
  }

  function startPerTimer(seconds) {
    stopPerTimer();
    if (!seconds || seconds <= 0) { elTimer.textContent = ''; return; }
    tItem = seconds;
    elTimer.textContent = `⏳ ${tItem}s`;
    intervalPer = setInterval(() => {
      tItem--;
      if (tItem >= 0) elTimer.textContent = `⏳ ${tItem}s`;
      if (tItem <= 0) { stopPerTimer(); checkAnswer('', true); }
    }, 1000);
  }

  function paintScore() { elScore.textContent = `Score: ${score}`; }
  function paintProgress() { elProgress.textContent = `Q ${Math.min(qIndex+1, items.length)}/${items.length}`; }

  function setPrompt(q) {
    elPrompt.textContent = q.prompt || '';
    elFB.textContent = q.hint ? `💡 ${q.hint}` : '';
    elFB.style.color = q.hint ? "#9fe8ff" : "";
  }

  function disableInput() { elInput.disabled = true; elSubmit.disabled = true; }
  function enableInput() { elInput.disabled = false; elSubmit.disabled = false; }

  function finish() {
    stopPerTimer(); stopOverallTimer();
    disableInput();

    const summary = `🏁 Done! Score: ${score}/${items.length}`;
    elFB.textContent = summary;
    elFB.style.color = "#7fffd4";
    elCtrl.innerHTML = "";

    // Branching endings support
    if (scene.scoring && scene.endings) {
      const { high = Infinity, medium = -Infinity } = scene.scoring;
      let dest;
      if (score >= high) dest = scene.endings.high;
      else if (score >= medium) dest = scene.endings.medium;
      else dest = scene.endings.low;
      if (dest) {
        const btn = document.createElement('button');
        btn.textContent = "Continue";
        btn.onclick = () => goNext(dest);
        elCtrl.appendChild(btn);
        return;
      }
    }

    // Respect scene.next if provided
    if (scene.next) {
      const btn = document.createElement('button');
      btn.textContent = "Continue";
      btn.onclick = () => goNext(scene.next);
      elCtrl.appendChild(btn);
      return;
    }

    // Final fallback — only show Hub if not suppressed
    if (!scene.suppressHub) {
      const back = document.createElement('button');
      back.textContent = "Back to Hub";
      back.onclick = () => goNext("scene1");
      elCtrl.appendChild(back);
    }
  }

  function checkAnswer(userRaw, timedOut=false) {
    stopPerTimer();
    const q = items[qIndex] || {};
    const answers = Array.isArray(q.answers) ? q.answers : (q.answer ? [q.answer] : []);
    const user = norm(userRaw);
    const ok = answers.some(a => norm(a) === user);

    if (ok && !timedOut) {
      score++; paintScore();
      elFB.textContent = "✅ Correct!"; elFB.style.color = "lightgreen";
      setTimeout(() => { qIndex++; (qIndex >= items.length) ? finish() : renderQuestion(); }, 600);
    } else {
      elFB.textContent = timedOut ? "⌛ Time’s up." : "❌ Not quite.";
      elFB.style.color = "salmon";
      if (showAnswerOnWrong && answers.length) {
        const ans = document.createElement('div');
        ans.style.marginTop = "6px"; ans.style.opacity = ".9";
        ans.textContent = `Answer: ${answers[0]}`;
        elFB.appendChild(ans);
      }
      setTimeout(() => { qIndex++; (qIndex >= items.length) ? finish() : renderQuestion(); }, 900);
    }
  }

  function renderQuestion() {
    paintProgress();
    enableInput();
    elInput.value = ""; elInput.focus();
    const q = items[qIndex];
    setPrompt(q);
    if (timerPer) startPerTimer(timerPer);
    else if (timerOverall) elTimer.textContent = `⏳ ${tRemaining}s total`;
    else elTimer.textContent = "";
  }

  elSubmit.onclick = () => checkAnswer(elInput.value, false);
  elInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); checkAnswer(elInput.value, false); }
  });

  function cleanup() {
    try { stopPerTimer(); } catch(_) {}
    try { stopOverallTimer(); } catch(_) {}
    const node = document.getElementById('conj-race');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  window.__crCleanup = function () { cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('conj-race');
    if (!alive) { stopPerTimer(); stopOverallTimer(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  if (timerOverall) startOverallTimer(timerOverall);
  renderQuestion();
  function finish() {
  stopPerTimer(); 
  stopOverallTimer();
  disableInput();

  const summary = `🏁 Done! Score: ${score}/${items.length}`;
  elFB.textContent = summary;
  elFB.style.color = "#7fffd4";
  elCtrl.innerHTML = "";

  // If using scoring + endings
  if (scene.scoring && scene.endings) {
    const { high = Infinity, medium = -Infinity } = scene.scoring;
    let dest;
    if (score >= high) {
      dest = scene.endings.high;
    } else if (score >= medium) {
      dest = scene.endings.medium;
    } else {
      // FAILED branch → offer Retry
      const retry = document.createElement('button');
      retry.textContent = "Retry";
      retry.style.marginRight = "8px";
      retry.onclick = () => goNext(id);
      elCtrl.appendChild(retry);

      if (!scene.suppressHub) {
        const hub = document.createElement('button');
        hub.textContent = "Back to Hub";
        hub.onclick = () => goNext("scene1");
        elCtrl.appendChild(hub);
      }
      return; // stop here
    }
    if (dest) return goNext(dest);
  }

  // Respect scene.next if provided
  if (scene.next) {
    const btn = document.createElement('button');
    btn.textContent = "Continue";
    btn.onclick = () => goNext(scene.next);
    elCtrl.appendChild(btn);
    return;
  }

  // Neutral fallback
  if (!scene.suppressHub) {
    const back = document.createElement('button');
    back.textContent = "Back to Hub";
    back.onclick = () => goNext("scene1");
    elCtrl.appendChild(back);
  }
}

}


// === Image Hotspots → drag tokens onto pins (seepage-proof) ===
function loadHotspotsScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__hsCleanup) { try { window.__hsCleanup(); } catch(_){} window.__hsCleanup = null; }
  const stale = document.getElementById('hotspots');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Config shape:
  // image: 'images/…'
  // pins: [{ id:'p1', x:25, y:60, answers:['look up'] }, ...]  // x/y = % (relative to image box)
  // tokens: ['look up','pick up','put down','get over']
  // next: 'scene1' (optional)
  const pins = Array.isArray(scene.pins) ? scene.pins : [];
  const tokens = Array.isArray(scene.tokens) ? scene.tokens.slice() : [];
  const bankTitle = scene.bankTitle || 'Choices';

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'hotspots';
  wrap.style.maxWidth = '980px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="hs-grid" style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start;">
      <div id="hs-stage" style="position:relative;border-radius:12px;overflow:hidden;background:#000;">
        <img id="hs-img" src="${scene.image}" alt="scene" style="display:block;width:100%;height:auto;"/>
        <div id="hs-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
      </div>
      <div id="hs-side">
        <div style="font-weight:700;margin-bottom:8px;">${bankTitle}</div>
        <div id="hs-bank" style="display:flex;flex-wrap:wrap;gap:8px;min-height:48px;"></div>
        <div id="hs-feedback" style="margin-top:12px;font-weight:700;"></div>
        <div id="hs-ctrl" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;"></div>
      </div>
    </div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const layer = wrap.querySelector('#hs-layer');
  const bank  = wrap.querySelector('#hs-bank');
  const fb    = wrap.querySelector('#hs-feedback');
  const ctrl  = wrap.querySelector('#hs-ctrl');

  // Build token chips in bank
  tokens.forEach(val => {
    const chip = document.createElement('div');
    chip.className = 'hs-chip';
    chip.textContent = val;
    chip.dataset.value = val;
    chip.style.cssText = "pointer-events:auto;user-select:none;padding:8px 10px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:grab";
    bank.appendChild(chip);
  });

  // Make bank sortable (source list)
  const bankSortable = Sortable.create(bank, {
    group: { name: 'hs', pull: 'clone', put: true },
    animation: 150,
    sort: false
  });

  // Build pins (droppable 1-item targets)
  const dropSortables = {};
  pins.forEach(pin => {
    const pinWrap = document.createElement('div');
    pinWrap.className = 'hs-pin';
    pinWrap.style.cssText = `
      position:absolute;left:${pin.x}%;top:${pin.y}%;
      transform:translate(-50%,-50%);
      width:48px;height:48px;border-radius:50%;
      background:radial-gradient(circle at 30% 30%, #5ff, #09a);
      box-shadow:0 0 0 3px rgba(0,255,255,.3), 0 0 12px rgba(0,255,255,.6);
      display:flex;align-items:center;justify-content:center;
      pointer-events:auto;`;
    pinWrap.title = pin.label || '';

    const slot = document.createElement('div');
    slot.id = `hs-slot-${pin.id}`;
    slot.dataset.pin = pin.id;
    slot.style.cssText = `
      width:36px;min-height:24px;max-width:80px;
      pointer-events:auto;background:#000d;border:2px dashed #bdf;
      border-radius:8px;padding:2px;display:flex;align-items:center;justify-content:center;`;
    pinWrap.appendChild(slot);

    // label below (optional)
    if (pin.caption) {
      const cap = document.createElement('div');
      cap.textContent = pin.caption;
      cap.style.cssText = "position:absolute;top:54px;left:50%;transform:translateX(-50%);font:600 12px/1.2 system-ui;white-space:nowrap;background:#000a;padding:2px 6px;border-radius:6px;border:1px solid #00bcd4";
      pinWrap.appendChild(cap);
    }

    layer.appendChild(pinWrap);

    dropSortables[pin.id] = Sortable.create(slot, {
      group: { name: 'hs', pull: true, put: true },
      animation: 150,
      sort: false,
      onAdd: (evt) => {
        const to = evt.to;
        // keep only one chip in the slot
        while (to.children.length > 1) {
          bank.appendChild(to.children[0]);
        }
      },
      onRemove: () => {}
    });
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#333;color:#eee;cursor:pointer;font-weight:700";
  resetBtn.onclick = () => {
    // move all chips back to bank
    const chips = layer.querySelectorAll('.hs-chip');
    chips.forEach(ch => bank.appendChild(ch));
    fb.textContent = "";
  };
  ctrl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Check";
  checkBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;cursor:pointer;font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    let ok = true;
    let filled = true;
    pins.forEach(pin => {
      const slot = document.getElementById(`hs-slot-${pin.id}`);
      const chip = slot && slot.firstElementChild;
      if (!chip) { filled = false; ok = false; return; }
      const val = (chip.dataset.value || "").trim();
      const answers = Array.isArray(pin.answers) ? pin.answers : [pin.answer].filter(Boolean);
      const match = answers.some(a => (a || "").trim().toLowerCase() === val.toLowerCase());
      if (!match) ok = false;
    });

    if (!filled) {
      fb.textContent = "⚠️ Place a token on every pin.";
      fb.style.color = "orange";
      return;
    }
    if (ok) {
      fb.textContent = "✅ Correct! Moving on...";
      fb.style.color = "lightgreen";

      // optional rewards
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);

      setTimeout(() => {
        if (scene.next) goNext(scene.next);
      }, 900);
    } else {
      fb.textContent = "❌ Not quite. Try again.";
      fb.style.color = "salmon";
    }
  };
  ctrl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#222;color:#eee;cursor:pointer;font-weight:700";
  backBtn.onclick = () => goNext("scene1");
  ctrl.appendChild(backBtn);

  // Cleanup helpers
  function cleanup() {
    const node = document.getElementById('hotspots');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  // Expose global cleanup for Universal Cleanup
  window.__hsCleanup = function(){ cleanup(); };

  // Auto-stop if wrapper disappears
  const mo = new MutationObserver(() => {
    const alive = document.getElementById('hotspots');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Buckets / Kanban Sort (seepage-proof) ===
function loadBucketsScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill previous instance if any
  if (window.__bkCleanup) { try { window.__bkCleanup(); } catch(_){} window.__bkCleanup = null; }
  const stale = document.getElementById('buckets');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // Scene shape:
  // buckets: [{ id:'separable', label:'Separable' }, { id:'inseparable', label:'Inseparable' }, ...]
  // tokens:  ['take off','turn on','look after','get over', ...]
  // answers: { separable:['take off','turn on'], inseparable:['look after','get over'] }
  // allowExtraInBank: true (optional), showAnswerOnWrong: true (default), next:'scene1'
  const buckets = Array.isArray(scene.buckets) ? scene.buckets : [];
  const tokens  = Array.isArray(scene.tokens) ? scene.tokens.slice() : [];
  const answers = scene.answers || {};
  const allowExtraInBank = scene.allowExtraInBank !== false; // default true: distractors can stay in bank
  const showAnswerOnWrong = scene.showAnswerOnWrong !== false; // default true

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'buckets';
  wrap.style.maxWidth = '1100px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = '#eee';

  // grid: bank on top, buckets below
  wrap.innerHTML = `
    <div id="bk-bank-wrap" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:8px;">Tokens</div>
      <div id="bk-bank" style="display:flex;flex-wrap:wrap;gap:8px;min-height:54px;border:1px dashed #00ffff33;border-radius:12px;padding:10px;"></div>
    </div>
    <div id="bk-buckets" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:start;"></div>
    <div id="bk-feedback" style="margin-top:14px;font-weight:700;"></div>
    <div id="bk-ctrl" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;"></div>
  `;

  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const bank = wrap.querySelector('#bk-bank');
  const panel = wrap.querySelector('#bk-buckets');
  const fb = wrap.querySelector('#bk-feedback');
  const ctrl = wrap.querySelector('#bk-ctrl');

  // Build chips
  tokens.forEach(txt => {
    const chip = document.createElement('div');
    chip.className = 'bk-chip';
    chip.dataset.value = txt;
    chip.textContent = txt;
    chip.style.cssText = "pointer-events:auto;user-select:none;padding:8px 10px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:grab";
    bank.appendChild(chip);
  });

  // Bank Sortable
  const bankSortable = Sortable.create(bank, {
    group: { name: 'classify', pull: true, put: true },
    animation: 150,
    sort: false
  });

  // Buckets UIs + Sortables
  const bucketSortables = {};
  buckets.forEach(b => {
    const col = document.createElement('div');
    col.className = 'bk-col';
    col.style.cssText = "background:#000a;border:1px solid #00bcd455;border-radius:12px;padding:10px;min-height:140px;";

    col.innerHTML = `
      <div class="bk-title" style="font-weight:800;margin-bottom:8px;color:#9fe8ff">${b.label || b.id}</div>
      <div class="bk-drop" id="bk-drop-${b.id}" data-bucket="${b.id}"
           style="display:flex;flex-wrap:wrap;gap:8px;min-height:54px;"></div>
      <div class="bk-hint" style="opacity:.85;margin-top:6px;font-size:.9rem;"></div>
    `;
    if (b.hint) col.querySelector('.bk-hint').textContent = b.hint;
    panel.appendChild(col);

    const drop = col.querySelector(`#bk-drop-${b.id}`);
    bucketSortables[b.id] = Sortable.create(drop, {
      group: { name: 'classify', pull: true, put: true },
      animation: 150,
      sort: false
    });
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#333;color:#eee;cursor:pointer;font-weight:700";
  resetBtn.onclick = () => {
    // send all chips back to bank
    wrap.querySelectorAll('.bk-drop .bk-chip').forEach(ch => bank.appendChild(ch));
    fb.textContent = "";
    // clear highlights
    wrap.querySelectorAll('.bk-chip').forEach(ch => ch.style.borderColor = '#00ffff');
  };
  ctrl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Check";
  checkBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;cursor:pointer;font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    // Clear previous highlights
    wrap.querySelectorAll('.bk-chip').forEach(ch => ch.style.borderColor = '#00ffff');

    // build placed map
    const placed = {};
    buckets.forEach(b => {
      const drop = document.getElementById(`bk-drop-${b.id}`);
      placed[b.id] = Array.from(drop.querySelectorAll('.bk-chip')).map(c => c.dataset.value);
    });

    // If not allowing extra in bank, require that every token left the bank
    if (!allowExtraInBank) {
      const leftovers = Array.from(bank.querySelectorAll('.bk-chip')).length;
      if (leftovers > 0) {
        fb.textContent = "⚠️ Sort all tokens into a bucket.";
        fb.style.color = "orange";
        return;
      }
    }

    // Validate: each bucket should contain exactly the expected items (order irrelevant)
    let allOk = true;
    buckets.forEach(b => {
      const want = new Set((answers[b.id] || []).map(s => s.toLowerCase()));
      const got  = placed[b.id].map(s => s.toLowerCase());

      // Wrong if: any missing target OR any extra not in want
      let ok = true;

      // missing
      want.forEach(w => { if (!got.includes(w)) ok = false; });
      // extras
      got.forEach(g => { if (!want.has(g)) ok = false; });

      if (!ok) {
        allOk = false;
        // highlight wrong chips in this bucket
        const drop = document.getElementById(`bk-drop-${b.id}`);
        Array.from(drop.querySelectorAll('.bk-chip')).forEach(ch => {
          const val = (ch.dataset.value || "").toLowerCase();
          if (!want.has(val)) ch.style.borderColor = 'salmon';
        });
        if (showAnswerOnWrong && want.size) {
          const hintEl = drop.parentElement.querySelector('.bk-hint');
          hintEl.textContent = `Expected: ${Array.from(want).join(', ')}`;
          hintEl.style.color = '#ffd27f';
        }
      }
    });

    if (allOk) {
      fb.textContent = "✅ Correct! Moving on...";
      fb.style.color = "lightgreen";
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fb.textContent = "❌ Some items are misplaced. Adjust and try again.";
      fb.style.color = "salmon";
    }
  };
  ctrl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#222;color:#eee;cursor:pointer;font-weight:700";
  backBtn.onclick = () => goNext("scene1");
  ctrl.appendChild(backBtn);

  // cleanup + navigation
  function cleanup() {
    const node = document.getElementById('buckets');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }

  window.__bkCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('buckets');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Particle Swapper (live preview, seepage-proof) ===
// Supports two modes:
//
//  A) Full-phrase mode (default):
//     template: 'Please {{CHOICE}} the music.'
//     options: ['turn up','turn down','turn off']
//     correct: 1
//
//  B) Particle-only mode:
//     template: 'Please {{PARTICLE}} the heater.'   (or 'Please turn {{PARTICLE}} the heater.')
//     verb: 'turn'   // optional, used only for preview notes mapping
//     options: ['up','down','off']
//     correct: 2
//
// Optional:
//     previews: { '<option or full>': 'emoji or note', ... }
//     next, setFlagsOnWin[], unlockScenesOnWin[]
function loadParticleSwapperScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__psCleanup) { try { window.__psCleanup(); } catch(_){} window.__psCleanup = null; }
  const stale = document.getElementById('particle-swapper');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  // shape
  const mode = (scene.mode === 'particle') ? 'particle' : 'full';
  const template = scene.template || 'Please {{CHOICE}} the object.';
  const options = Array.isArray(scene.options) ? scene.options : [];
  const correctIndex = Number.isInteger(scene.correct) ? scene.correct : 0;
  const previews = scene.previews || {};
  const verb = scene.verb || ''; // only for particle mode helper text

  // Build UI
  const wrap = document.createElement('div');
  wrap.id = 'particle-swapper';
  wrap.style.maxWidth = '840px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '10px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="ps-sentence" style="font:700 26px/1.5 system-ui,Segoe UI,Arial;letter-spacing:.02em;margin-bottom:12px;"></div>
    <div id="ps-note" style="opacity:.9;margin-bottom:12px;"></div>
    <div id="ps-options" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;"></div>
    <div id="ps-feedback" style="font-weight:700;margin-top:4px;"></div>
    <div id="ps-ctrl" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;"></div>
  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const sentenceEl = wrap.querySelector('#ps-sentence');
  const noteEl = wrap.querySelector('#ps-note');
  const optsEl = wrap.querySelector('#ps-options');
  const fbEl = wrap.querySelector('#ps-feedback');
  const ctrlEl = wrap.querySelector('#ps-ctrl');

  let selectedIndex = null;

  function renderSentence() {
    let s = template;
    if (mode === 'particle') {
      const particle = (selectedIndex != null) ? options[selectedIndex] : '___';
      s = s.replace('{{PARTICLE}}', particle);
      // If the template did not include PARTICLE, fall back to a reasonable preview
      if (s === template) {
        s = `Please ${verb ? (verb + ' ') : ''}${particle} the object.`;
      }
    } else {
      const choice = (selectedIndex != null) ? options[selectedIndex] : '_____';
      s = s.replace('{{CHOICE}}', choice);
      if (s === template) {
        s = `Please ${choice} the object.`;
      }
    }
    sentenceEl.textContent = s;
  }

  function renderNote() {
    if (selectedIndex == null) { noteEl.textContent = ''; return; }
    const val = options[selectedIndex];
    // Build key for previews
    let key = val;
    if (mode === 'particle' && verb) key = `${verb} ${val}`;
    const note = previews[key] || previews[val] || '';
    noteEl.textContent = note;
  }

  // Build option buttons
  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'ps-opt';
    btn.textContent = opt;
    btn.dataset.index = i;
    btn.style.cssText = "padding:8px 12px;border-radius:10px;border:2px solid #00ffff;background:#000;color:#0ff;font-weight:700;cursor:pointer";
    btn.onmouseenter = () => (btn.style.background = "#001a1a");
    btn.onmouseleave = () => (btn.style.background = "#000");
    btn.onclick = () => {
      // clear selection
      optsEl.querySelectorAll('.ps-opt').forEach(b => { b.style.borderColor = '#00ffff'; b.style.opacity = '1'; });
      selectedIndex = i;
      btn.style.borderColor = '#9effa0';
      renderSentence();
      renderNote();
      fbEl.textContent = '';
    };
    optsEl.appendChild(btn);
  });

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#333;color:#eee;cursor:pointer;font-weight:700";
  resetBtn.onclick = () => {
    selectedIndex = null;
    optsEl.querySelectorAll('.ps-opt').forEach(b => { b.style.borderColor = '#00ffff'; b.style.opacity = '1'; });
    fbEl.textContent = '';
    noteEl.textContent = '';
    renderSentence();
  };
  ctrlEl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Submit";
  checkBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;cursor:pointer;font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    if (selectedIndex == null) {
      fbEl.textContent = '⚠️ Select an option first.';
      fbEl.style.color = 'orange';
      return;
    }
    const correct = (selectedIndex === correctIndex);
    if (correct) {
      fbEl.textContent = '✅ Correct! Moving on...';
      fbEl.style.color = 'lightgreen';
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fbEl.textContent = '❌ Not quite. Try another particle.';
      fbEl.style.color = 'salmon';
      // nudge UI
      optsEl.querySelectorAll('.ps-opt').forEach((b, idx) => {
        if (idx === selectedIndex) b.style.borderColor = 'salmon';
      });
    }
  };
  ctrlEl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px;border-radius:10px;border:none;background:#222;color:#eee;cursor:pointer;font-weight:700";
  backBtn.onclick = () => goNext('scene1');
  ctrlEl.appendChild(backBtn);

  function cleanup() {
    const node = document.getElementById('particle-swapper');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }
  window.__psCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('particle-swapper');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Initial paint
  renderSentence();
  renderNote();
}

// === Comic Bubbles (speech/thought over image) — seepage-proof ===
// Scene shape:
//   type: 'comic-bubbles',
//   image: 'images/whatever.png',
//   text: 'instructions...',
//   bubbles: [
//     { x: 22, y: 28, kind: 'speech', prompt: 'Can you ___ the word?', options: ['look up','pick up','put down'], correct: 0 },
//     { x: 72, y: 62, kind: 'thought', prompt: 'We should ___ the TV.', options: ['turn up','turn down','turn off'], correct: 2 }
//   ],
//   next: 'scene1', setFlagsOnWin:[], unlockScenesOnWin:[]
function loadComicBubblesScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  // kill any previous instance
  if (window.__cbCleanup) { try { window.__cbCleanup(); } catch(_){} window.__cbCleanup = null; }
  const stale = document.getElementById('comic-bubbles');
  if (stale) stale.remove();

  const gameContainer = document.getElementById("game-container");
  const sceneText = document.getElementById("scene-text");
  const sceneImage = document.getElementById("scene-image");
  const infoDiv = document.getElementById("challenge-info");

  // Hide unrelated bits; show instructions if provided
  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = "block"; sceneText.textContent = scene.text; }
    else { sceneText.style.display = "none"; sceneText.innerHTML = ""; }
  }
  if (gameContainer) gameContainer.style.display = "block";

  const bubbles = Array.isArray(scene.bubbles) ? scene.bubbles : [];

  // Wrapper with the image and overlay layer
  const wrap = document.createElement('div');
  wrap.id = 'comic-bubbles';
  wrap.style.maxWidth = '980px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '8px 6px';
  wrap.style.color = '#eee';

  wrap.innerHTML = `
    <div id="cb-figure" style="position:relative; width:100%; border-radius:12px; overflow:hidden; background:#000;">
      <img id="cb-img" src="${scene.image || ''}" alt="scene" style="width:100%; height:auto; display:block;"/>
      <div id="cb-overlay" style="position:absolute; inset:0;"></div>
    </div>
    <div id="cb-feedback" style="margin-top:12px; font-weight:700;"></div>
    <div id="cb-ctrl" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;"></div>
  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else gameContainer.appendChild(wrap);

  const overlay = wrap.querySelector('#cb-overlay');
  const fbEl = wrap.querySelector('#cb-feedback');
  const ctrlEl = wrap.querySelector('#cb-ctrl');

  // Create bubbles
  const state = { chosen: Array(bubbles.length).fill(null) };

  function bubbleShellStyles(kind) {
    const base = "position:absolute; transform:translate(-50%,-50%); max-width:46%;";
    const pad = "padding:10px 12px; border-radius:16px;";
    const common = "background:#111; color:#0ff; border:2px solid #00ffff; box-shadow:0 2px 10px #0008;";
    const tail =
      kind === 'thought'
        ? ``
        : ``;
    return `${base} ${pad} ${common} ${tail}`;
  }

  function renderBubble(i, b) {
    const el = document.createElement('div');
    el.className = 'cb-bubble';
    el.style.cssText = bubbleShellStyles(b.kind || 'speech');
    el.style.left = (b.x || 50) + '%';
    el.style.top = (b.y || 50) + '%';
    el.style.cursor = 'default';

    const prompt = document.createElement('div');
    prompt.textContent = b.prompt || '';
    prompt.style.fontWeight = '700';
    prompt.style.marginBottom = '8px';
    el.appendChild(prompt);

    const optWrap = document.createElement('div');
    optWrap.className = 'cb-options';
    optWrap.style.display = 'flex';
    optWrap.style.flexWrap = 'wrap';
    optWrap.style.gap = '6px';
    el.appendChild(optWrap);

    (b.options || []).forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.textContent = optText;
      btn.dataset.index = idx;
      btn.style.cssText = "padding:6px 10px; border-radius:10px; border:2px solid #00ffff; background:#000; color:#0ff; font-weight:700; cursor:pointer;";
      btn.onmouseenter = () => (btn.style.background = "#001a1a");
      btn.onmouseleave = () => (btn.style.background = "#000");
      btn.onclick = () => {
        state.chosen[i] = idx;
        // reset all buttons border in this bubble
        optWrap.querySelectorAll('button').forEach(bn => bn.style.borderColor = '#00ffff');
        btn.style.borderColor = '#9effa0';
        fbEl.textContent = '';
      };
      optWrap.appendChild(btn);
    });

    // inline result area for this bubble
    const note = document.createElement('div');
    note.className = 'cb-note';
    note.style.marginTop = '6px';
    note.style.opacity = '.95';
    el.appendChild(note);

    overlay.appendChild(el);
  }

  bubbles.forEach((b, i) => renderBubble(i, b));

  // Controls
  const resetBtn = document.createElement('button');
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#333; color:#eee; cursor:pointer; font-weight:700";
  resetBtn.onclick = () => {
    state.chosen = Array(bubbles.length).fill(null);
    overlay.querySelectorAll('.cb-bubble .cb-options button').forEach(b => b.style.borderColor = '#00ffff');
    overlay.querySelectorAll('.cb-bubble .cb-note').forEach(n => { n.textContent = ''; n.style.color = '#eee'; });
    fbEl.textContent = '';
  };
  ctrlEl.appendChild(resetBtn);

  const checkBtn = document.createElement('button');
  checkBtn.textContent = "Submit";
  checkBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#00ffff; color:#000; cursor:pointer; font-weight:700";
  checkBtn.onmouseenter = () => (checkBtn.style.backgroundColor = "#00cccc");
  checkBtn.onmouseleave = () => (checkBtn.style.backgroundColor = "#00ffff");
  checkBtn.onclick = () => {
    let allAnswered = true;
    let allCorrect = true;

    bubbles.forEach((b, i) => {
      const note = overlay.querySelectorAll('.cb-bubble .cb-note')[i];
      const chosen = state.chosen[i];
      if (chosen == null) { allAnswered = false; note.textContent = '⚠️ Choose an option.'; note.style.color = 'orange'; return; }
      if (chosen !== b.correct) { allCorrect = false; note.textContent = '❌ Try another option.'; note.style.color = 'salmon'; }
      else { note.textContent = '✅'; note.style.color = 'lightgreen'; }
    });

    if (!allAnswered) {
      fbEl.textContent = "⚠️ Answer all bubbles before submitting.";
      fbEl.style.color = "orange";
      return;
    }

    if (allCorrect) {
      fbEl.textContent = "✅ Perfect! Moving on…";
      fbEl.style.color = "lightgreen";
      if (Array.isArray(scene.setFlagsOnWin)) scene.setFlagsOnWin.forEach(setFlag);
      if (Array.isArray(scene.unlockScenesOnWin)) scene.unlockScenesOnWin.forEach(unlockScene);
      setTimeout(() => { if (scene.next) goNext(scene.next); }, 900);
    } else {
      fbEl.textContent = "❌ Some bubbles are incorrect. Adjust and submit again.";
      fbEl.style.color = "salmon";
    }
  };
  ctrlEl.appendChild(checkBtn);

  const backBtn = document.createElement('button');
  backBtn.textContent = "Back to Hub";
  backBtn.style.cssText = "padding:8px 12px; border-radius:10px; border:none; background:#222; color:#eee; cursor:pointer; font-weight:700";
  backBtn.onclick = () => goNext('scene1');
  ctrlEl.appendChild(backBtn);

  // cleanup + navigation
  function cleanup() {
    const node = document.getElementById('comic-bubbles');
    if (node) node.remove();
  }
  function goNext(dest) { cleanup(); if (dest) loadScene(dest); }
  window.__cbCleanup = function(){ cleanup(); };

  const mo = new MutationObserver(() => {
    const alive = document.getElementById('comic-bubbles');
    if (!alive) { mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Dashboard (universal CRM-style widgets + data MCQs) ===
// Scene shape:
//   type: 'dashboard',
//   text: 'instructions...',
//   widgets: [
//     { type:'kpi', id:'rev', label:'Revenue', value:'$1.2M', delta:+8 },
//     { type:'bar', id:'perf', label:'Quarterly Performance', data:[{label:'Q1',value:20},...], max:100 },
//     { type:'pie', id:'mix', label:'Product Mix', data:[{label:'A',value:50},...], colors:['#0ff','#9f0','#f90'] },
//     { type:'table', id:'top', label:'Top Accounts', columns:['Client','MRR','Status'], rows:[['Acme','$50k','Active'], ...] }
//   ],
//   questions: [
//     { text:'Which product leads the mix?', options:['A','B','C'], correct:0 },
//     { text:'Which quarter was best?', options:['Q1','Q2','Q3','Q4'], correct:3 }
//   ],
//   next:'scene1' OR {scoring:{high:2,medium:1}, endings:{high:'id',medium:'id',low:'id'}}
// === Dashboard loader (binds to crm.state + live updates) ===
// === Dashboard (narrative CRM) loader ===
function loadDashboardScene(id) {
  const scene = scenes[id];
  if (!scene) { console.error(`Scene ${id} not found.`); return; }

  const regNode     = window.registerNode     || function(){};
  const regCleanup  = window.registerCleanup  || function(){};

  // Kill any previous instance
  const stale = document.getElementById('dashboard-wrap');
  if (stale) stale.remove();

  const game       = document.getElementById('game-container');
  const sceneText  = document.getElementById('scene-text');
  const sceneImage = document.getElementById('scene-image');
  const infoDiv    = document.getElementById('challenge-info');

  [sceneImage, infoDiv].forEach(el => { if (el) { el.style.display = "none"; el.innerHTML = ""; } });
  if (sceneText) {
    if (scene.text) { sceneText.style.display = 'block'; sceneText.textContent = scene.text; }
    else { sceneText.style.display = 'none'; sceneText.innerHTML = ''; }
  }
  if (game) game.style.display = 'block';

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'dashboard-wrap';
  wrap.style.maxWidth = '1100px';
  wrap.style.margin = '0 auto';
  wrap.style.padding = '8px 6px';
  wrap.style.color = '#eee';
  regNode(wrap);

  const questions = Array.isArray(scene.questions) ? scene.questions : [];

  wrap.innerHTML = `
    <div id="dash-grid" style="
      display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
      gap:12px;align-items:start;">
    </div>
    ${questions.length ? `<div id="dash-qa" style="margin-top:16px;border-top:1px solid #00ffff55;padding-top:12px;"></div>` : ``}
  `;
  if (sceneText && sceneText.parentNode) sceneText.parentNode.insertBefore(wrap, sceneText.nextSibling);
  else game.appendChild(wrap);

  regCleanup(() => { const n = document.getElementById('dashboard-wrap'); if (n) n.remove(); });

  const grid = wrap.querySelector('#dash-grid');
  const qa   = wrap.querySelector('#dash-qa');

  // --- Card helpers
  function card(title) {
    const c = document.createElement('div');
    c.className = 'dash-card';
    c.style.cssText = 'background:#0a0a0a;border:1px solid #00ffff33;border-radius:12px;padding:12px;box-shadow:0 4px 16px #0006;';
    if (title) {
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = 'font-weight:800;margin-bottom:8px;color:#0ff;';
      c.appendChild(h);
    }
    regNode(c);
    return c;
  }
  function renderKPI(w) {
    const c = card(w.label);
    const val = document.createElement('div');
    val.textContent = w.value ?? '';
    val.style.cssText = 'font-size:28px;font-weight:900;letter-spacing:.02em;margin-bottom:6px;';
    const d = document.createElement('div');
    const delta = Number(w.delta || 0);
    const sign = delta > 0 ? '+' : '';
    d.textContent = `${sign}${delta}% vs prev`;
    d.style.cssText = `font-weight:700;${delta>=0?'color:#9effa0;':'color:salmon;'}`;
    c.appendChild(val); c.appendChild(d);
    return c;
  }
  function renderBar(w) {
    const c = card(w.label);
    const max = Number.isFinite(w.max) ? w.max : Math.max(...(w.data||[]).map(d=>d.value||0), 1);
    (w.data||[]).forEach(row=>{
      const line = document.createElement('div');
      line.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0;';
      const label = document.createElement('div');
      label.textContent = row.label ?? '';
      label.style.cssText='min-width:64px;opacity:.9;';
      const barBox = document.createElement('div');
      barBox.style.cssText='flex:1;background:#111;border-radius:8px;overflow:hidden;border:1px solid #00ffff33;';
      const bar = document.createElement('div');
      const pct = Math.max(0, Math.min(100, (row.value||0)/max*100));
      bar.style.cssText=`height:14px;width:${pct}%;background:linear-gradient(90deg,#00ffff,#00cccc);`;
      barBox.appendChild(bar);
      const val = document.createElement('div');
      val.textContent = row.value ?? '';
      val.style.cssText='min-width:44px;text-align:right;opacity:.85;';
      line.appendChild(label); line.appendChild(barBox); line.appendChild(val);
      c.appendChild(line);
    });
    return c;
  }
  function renderPie(w) {
    const total = (w.data||[]).reduce((a,b)=>a+(b.value||0),0) || 1;
    let acc = 0;
    const colors = ['#00ffff','#9effa0','#f9f871','#f99','#0bf','#f0f','#ffa500'];
    const stops = (w.data||[]).map((seg,i)=>{
      const start = acc/total*360; acc += (seg.value||0);
      const end = acc/total*360;
      const col = (w.colors && w.colors[i]) || colors[i%colors.length];
      return `${col} ${start}deg ${end}deg`;
    }).join(', ');
    const c = card(w.label);
    const ring = document.createElement('div');
    ring.style.cssText=`width:140px;height:140px;border-radius:50%;margin:6px auto;background:conic-gradient(${stops});`;
    const hole = document.createElement('div');
    hole.style.cssText='width:80px;height:80px;border-radius:50%;background:#0a0a0a;margin:-110px auto 8px;border:1px solid #00ffff33;';
    c.appendChild(ring); c.appendChild(hole);
    (w.data||[]).forEach((seg,i)=>{
      const row=document.createElement('div');
      const col=(w.colors && w.colors[i]) || colors[i%colors.length];
      row.innerHTML=`<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col};margin-right:6px;"></span>${seg.label ?? ''} — ${seg.value ?? 0}`;
      row.style.margin='4px 0'; row.style.opacity='.9';
      c.appendChild(row);
    });
    return c;
  }
  function renderTable(w) {
    const c = card(w.label);
    const tbl = document.createElement('table');
    tbl.style.cssText='width:100%;border-collapse:collapse;font-size:14px;';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    (w.columns||[]).forEach(h=>{
      const th=document.createElement('th');
      th.textContent=h; th.style.cssText='text-align:left;border-bottom:1px solid #00ffff33;padding:6px;';
      trh.appendChild(th);
    });
    thead.appendChild(trh); tbl.appendChild(thead);
    const tbody=document.createElement('tbody');
    (w.rows||[]).forEach(r=>{
      const tr=document.createElement('tr');
      (r||[]).forEach(cell=>{
        const td=document.createElement('td');
        td.textContent=cell; td.style.cssText='padding:6px;border-bottom:1px dashed #00ffff1f;';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    c.appendChild(tbl);
    return c;
  }

  // Render widgets
  (scene.widgets||[]).forEach(w=>{
    let node=null;
    if (w.type==='kpi') node=renderKPI(w);
    else if (w.type==='bar') node=renderBar(w);
    else if (w.type==='pie') node=renderPie(w);
    else if (w.type==='table') node=renderTable(w);
    if (node) { node.dataset.id = w.id || ''; grid.appendChild(node); }
  });

  // --- Questions (auto-advance on correct) OR auto-skip if none
  if (questions.length && qa) {
    let qIndex = 0;

    function renderDashQuestion(i) {
      const q = questions[i];
      qa.innerHTML = '';
      const cardQ = card(`Question ${i+1} of ${questions.length}`);
      const p = document.createElement('div');
      p.textContent = q.text || '';
      p.style.marginBottom = '10px';
      cardQ.appendChild(p);

      const opts = document.createElement('div');
      opts.style.display = 'flex';
      opts.style.flexDirection = 'column';
      opts.style.gap = '8px';

      (q.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.style.cssText = "text-align:left;padding:10px 12px;border-radius:10px;border:none;background:#00ffff;color:#000;font-weight:700;cursor:pointer";
        btn.onmouseenter = () => (btn.style.background = "#00cccc");
        btn.onmouseleave = () => (btn.style.background = "#00ffff");
        btn.onclick = () => {
          const correct = (idx === q.correct);
          // disable all to avoid double clicks
          Array.from(opts.children).forEach(b => b.disabled = true);
          if (correct) {
            // brief feedback flash
            const fb = document.createElement('div');
            fb.textContent = "✅ Correct!";
            fb.style.cssText = "margin-top:8px;font-weight:800;color:lightgreen;";
            cardQ.appendChild(fb);

            setTimeout(() => {
              // next question or navigate
              if (i + 1 < questions.length) {
                renderDashQuestion(i + 1);
              } else if (scene.endings && scene.scoring) {
                // optional scoring path (count corrects)
                // minimal: treat all answered correctly path
                const dest = scene.endings.high || scene.next;
                if (dest) loadScene(dest);
              } else if (scene.next) {
                loadScene(scene.next);
              }
            }, 700);
          } else {
            // allow retry on wrong
            btn.style.background = '#ff9e9e';
            btn.style.color = '#000';
            // re-enable others so they can try again
            Array.from(opts.children).forEach(b => { if (b !== btn) b.disabled = false; });
          }
        };
        opts.appendChild(btn);
      });

      cardQ.appendChild(opts);
      qa.appendChild(cardQ);
    }

    renderDashQuestion(qIndex);
  } else if (scene.next) {
    // No questions: jump straight to the next scene
    setTimeout(() => loadScene(scene.next), 0);
  }
}

/* SCORM: ensure time/commit on unload */
window.addEventListener("beforeunload", () => {
  try {
    if (SCORM.init() && typeof SCORM.finish === 'function') {
      // Finishes without changing status/score
      SCORM.finish({});
    } else if (SCORM.init()) {
      SCORM.commit();
    }
  } catch (_) {}
});


(function makeDebug(){
  const box = document.createElement('div');
  box.id = 'scorm-debug';
  box.style.cssText = 'position:fixed;bottom:10px;right:10px;background:#000a;color:#0ff;padding:8px 10px;border:1px solid #0ff;border-radius:8px;font:12px/1.3 monospace;z-index:99999;display:none;';
  document.body.appendChild(box);
  function refresh(){
    let status = 'n/a', score='n/a', loc='n/a';
    try { if (SCORM && SCORM.init()) {
      status = SCORM.get("cmi.core.lesson_status") || 'n/a';
      score  = SCORM.get("cmi.core.score.raw") || 'n/a';
      loc    = SCORM.get("cmi.core.lesson_location") || 'n/a';
    }} catch(_){}
    box.innerHTML =
      `scene: ${window.currentSceneId || 'n/a'}<br>`+
      `cur/max: ${window.scoreCurrent?.()||0}/${window.scoreMax?.()||0}<br>`+
      `raw: ${Math.round((window.scoreCurrent?.()||0)/(window.scoreMax?.()||1)*100)}%<br>`+
      `SCORM status: ${status}<br>`+
      `SCORM score: ${score}<br>`+
      `location: ${loc}<br>`;
  }
  setInterval(() => { if (box.style.display !== 'none') refresh(); }, 700);
  window.addEventListener('keydown', e => {
    if (e.key === 'F9') {
      box.style.display = (box.style.display === 'none') ? 'block' : 'none';
      refresh();
    }
  });
})();

window._dbgScore = () => {
  const cur = (window.scoreCurrent && window.scoreCurrent()) || 0;
  const max = (window.scoreMax && window.scoreMax()) || 0;
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0;
  let scInit=false, scStatus="n/a", scRaw="n/a";
  try { scInit = !!(SCORM && SCORM.init && SCORM.init()); } catch {}
  try { scStatus = SCORM && SCORM.get ? SCORM.get("cmi.core.lesson_status") : "n/a"; } catch {}
  try { scRaw    = SCORM && SCORM.get ? SCORM.get("cmi.core.score.raw")    : "n/a"; } catch {}
  return { cur, max, pct, scInit, scStatus, scRaw, TOTAL_AWARD_MAX: window.__TOTAL_AWARD_MAX };
};

/* =========================================================
   Phoneme helpers + attachSpeechCheck (MIT-style, drop-in)
   Place ABOVE ensureSpeechUI() and the speech hook IIFE
   so the hook can call window.attachSpeechCheck.
========================================================= */

/* ---------- Minimal phoneme helpers ---------- */
const __PH_EN = {
  'ee':'IY','ea':'IY','ai':'EY','ay':'EY','oo':'UW','ou':'AW','ow':'AW','oa':'OW',
  'th':'TH','sh':'SH','ch':'CH','ph':'F','gh':'G',
  'a':'AH','e':'EH','i':'IH','o':'AO','u':'UH',
  'r':'R','l':'L','v':'V','b':'B','t':'T','d':'D','k':'K','g':'G','s':'S','z':'Z','f':'F','h':'H','m':'M','n':'N'
};
const __PH_ES = { // crude, just to drive feedback
  'c(a|o|u)':'K','c(e|i)':'S','qu':'K','gu(e|i)':'G','ll':'ʝ','ñ':'NY','ch':'CH','rr':'Rr',
  'r':'R','b':'B','v':'B','z':'S','j':'H','x':'KS','a':'a','e':'e','i':'i','o':'o','u':'u'
};

function __g2p(word, lang = 'en') {
  const w = String(word || '').toLowerCase();
  const map = lang.startsWith('es') ? __PH_ES : __PH_EN;
  let out = [], i = 0;
  while (i < w.length) {
    let picked = null, used = 1;
    if (lang.startsWith('es')) {
      for (const [k, v] of Object.entries(map)) {
        const re = new RegExp('^' + k);
        const m = w.slice(i).match(re);
        if (m) { picked = v; used = m[0].length; break; }
      }
    } else {
      const tri = w.slice(i, i + 3), bi = w.slice(i, i + 2), si = w[i];
      if (map[tri]) { picked = map[tri]; used = 3; }
      else if (map[bi]) { picked = map[bi]; used = 2; }
      else if (map[si]) { picked = map[si]; used = 1; }
    }
    out.push(picked || w[i]?.toUpperCase());
    i += used;
  }
  return out;
}

function __lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = (a[i - 1] === b[j - 1]) ? 0 : (
        (a[i-1]==='TH' && b[j-1]==='T') || (a[i-1]==='T' && b[j-1]==='TH') ||
        (a[i-1]==='V'  && b[j-1]==='B') || (a[i-1]==='B' && b[j-1]==='V')  ||
        (a[i-1]==='IH' && b[j-1]==='IY') || (a[i-1]==='IY' && b[j-1]==='IH')
      ) ? 0.5 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,         // deletion
        dp[i][j-1] + 1,         // insertion
        dp[i-1][j-1] + sub      // substitution
      );
    }
  }
  return dp[m][n];
}

function phonemeScore(recognizedText, targetText, lang = 'en-US') {
  const norm = s => String(s || '')
    .toLowerCase()
    .replace(/[^a-záéíóúüñç' -]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rTok = norm(recognizedText).split(' ').filter(Boolean);
  const tTok = norm(targetText).split(' ').filter(Boolean);

  let hits = 0, total = Math.max(1, tTok.length), issues = [];
  for (const t of tTok) {
    const tp = __g2p(t, lang);
    let best = Infinity, bestWord = null;
    for (const r of rTok) {
      const rp = __g2p(r, lang);
      const d = __lev(rp, tp) / Math.max(1, Math.max(rp.length, tp.length));
      if (d < best) { best = d; bestWord = r; }
    }
    if (best <= 0.34) hits++; else issues.push({ word: t, heard: bestWord, d: best });
  }
  return { coverage: hits / total, hits, total, issues };
}

/* ---------- attachSpeechCheck (blended scoring) ---------- */
/**
 * attachSpeechCheck(buttonEl, expectedText, sceneOverrides?)
 * Uses your global SpeechFeature to capture ASR, then blends:
 *  - token coverage (SpeechFeature.match)
 *  - phoneme coverage (phonemeScore)
 * Emits:
 *  - 'speech-pass' CustomEvent(detail: {heard, token, phoneme, blended})
 *  - 'speech-fail' (same detail) — not shown to user unless you listen for it.
 */
function attachSpeechCheck(buttonEl, expectedText, sceneOverrides = {}) {
  const cfg = {
    minCoverage: sceneOverrides.minCoverage ?? (window.SpeechFeature?.settings?.tolerance ?? 0.80),
    allowOrderFlex: sceneOverrides.allowOrderFlex ?? true,
    maxEditDistance: sceneOverrides.maxEditDistance,
    stopWords: sceneOverrides.stopWords,
    synonyms: sceneOverrides.synonyms,
    weight: sceneOverrides.weight ?? { token: 0.7, phoneme: 0.3 },
    requireMonotonic: sceneOverrides.requireMonotonic ?? false,
    orderMin: (typeof sceneOverrides.orderMin === 'number') ? sceneOverrides.orderMin : 0.95,

    // NEW: global-ish floor so they can't just say a tiny prefix
    minRequiredCoverage: (typeof sceneOverrides.minRequiredCoverage === 'number')
      ? sceneOverrides.minRequiredCoverage
      : 0.90   // 90% of key tokens by default
  };

  if (!buttonEl) return;
  buttonEl.disabled = false;

  buttonEl.addEventListener('click', () => {
    const SF = window.SpeechFeature || {};
    const hasAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!hasAPI) { alert('Speech API not available in this browser.'); return; }

    if (SF.enabled !== true) {
      const chk = document.getElementById('speech-enabled-checkbox');
      if (chk) SF.enabled = chk.checked === true;
    }
    if (!SF.enabled) { alert('Enable speech first (⚙️).'); return; }

    if (typeof SF.start !== 'function' || typeof SF.match !== 'function') {
      console.warn('[attachSpeechCheck] SpeechFeature.start/match missing');
      return;
    }

    SF.start((heard /*, alts */) => {
      const lang = SF.settings?.lang || 'en-US';

      // 1) Token / word coverage
      const r1 = SF.match(heard, expectedText, {
        minCoverage: cfg.minCoverage,
        allowOrderFlex: cfg.allowOrderFlex,
        maxEditDistance: cfg.maxEditDistance,
        stopWords: cfg.stopWords,
        synonyms: cfg.synonyms
      });

      // 2) Phoneme coverage
      const r2 = phonemeScore(heard, expectedText, lang);

      // 3) Blend token + phoneme
      const blended = (cfg.weight.token * (r1.coverage ?? 0)) +
                      (cfg.weight.phoneme * (r2.coverage ?? 0));

      // 3.5) NEW: require "enough" of the sentence, regardless of tolerance
      const totalTokens   = r1.total || String(expectedText||'').trim().split(/\s+/).filter(Boolean).length || 1;
      const matchedTokens = r1.matched || 0;

      // how strict we are about finishing the sentence:
      const requiredTokens = Math.max(
        2,
        Math.round(totalTokens * cfg.minRequiredCoverage)
      );

      const fullEnough = matchedTokens >= requiredTokens;

      // 4) Order strictness (optional)
      const orderScore = (typeof r1.orderScore === 'number') ? r1.orderScore : 1;
      let orderOK = true;
      if (cfg.requireMonotonic === true) {
        orderOK = orderScore >= cfg.orderMin;
      }

      // 5) Final pass condition
      const pass = fullEnough && (blended >= cfg.minCoverage) && orderOK;

      try {
        console.log(
          '[attachSpeechCheck] token=%d%%(%d/%d) phoneme=%d%% blended=%d%% ' +
          'order=%d%% fullEnough=%s pass=%s',
          Math.round((r1.coverage ?? 0) * 100),
          matchedTokens,
          totalTokens,
          Math.round((r2.coverage ?? 0) * 100),
          Math.round(blended * 100),
          Math.round((orderScore ?? 1) * 100),
          fullEnough,
          pass
        );
      } catch(_) {}

      const detail = {
        heard,
        token: r1,
        phoneme: r2,
        blended,
        orderOK,
        orderScore,
        fullEnough,
        requiredTokens
      };

      if (pass) {
        buttonEl.dispatchEvent(new CustomEvent('speech-pass', { detail }));
      } else {
        buttonEl.dispatchEvent(new CustomEvent('speech-fail', { detail }));
      }
    }, () => {
      console.warn('[attachSpeechCheck] no speech detected');
    });
  });
}

window.attachSpeechCheck = window.attachSpeechCheck || attachSpeechCheck;


function ensureSpeechUI() {
  // ===== 1) Bootstrap SpeechFeature ONCE (idempotent) =====
  if (!window.__speechBootstrapped_min) {
    window.__speechBootstrapped_min = true;

    // Core object + defaults
    window.SpeechFeature = window.SpeechFeature || {};
    const SF = window.SpeechFeature;

    // Availability + baseline settings (don’t override if already set)
    SF.hasAPI   = SF.hasAPI ?? !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    SF.enabled  = SF.enabled ?? false;  // HUD checkbox controls this
    SF.settings = SF.settings || { lang: 'en-US', tolerance: 0.80 };

    // Minimal start(): one-shot Web Speech capture (define only if missing)
    if (typeof SF.start !== 'function') {
      SF.start = function start(onFinal, onNoInput) {
        const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Rec) { console.warn('[SpeechFeature] Web Speech unavailable'); onNoInput?.(); return; }

        const rec = new Rec();
        rec.lang = SF.settings?.lang || 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 5;

        let gotFinal = false;
        rec.onresult = (e) => {
          try {
            const alts = Array.from(e.results?.[0] || []);
            const best = alts.sort((a,b) => (b.confidence||0) - (a.confidence||0))[0];
            const heard = (best?.transcript || '').trim();
            if (heard) { gotFinal = true; onFinal?.(heard, alts); }
          } catch (err) {
            console.warn('[SpeechFeature.start] result parse error:', err);
          }
        };
        rec.onend   = () => { if (!gotFinal) onNoInput?.(); };
        rec.onerror = (e) => { console.warn('[SpeechFeature.start] error:', e.error||e); onNoInput?.(); };

        try {
          rec.start();
        } catch (err) {
          console.warn('[SpeechFeature.start] start() failed:', err);
          onNoInput?.();
        }
      };
    }

    // Minimal match(): token coverage + order score (define only if missing)
    if (typeof SF.match !== 'function') {
      SF.match = function match(heard, expected, opts = {}) {
        const normalize = (s) => String(s||'')
          .toLowerCase()
          .replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
          .replace(/[^a-z0-9áéíóúüñçàèìòùâêîôûäëïöüœæß\s'-]/gi,' ')
          .replace(/\s+/g,' ').trim();

        const applySynonyms = (text, syn) => {
          if (!syn) return text;
          let out = ' ' + text + ' ';
          for (const [canon, list] of Object.entries(syn)) {
            for (const v of [].concat(list)) {
              const re = new RegExp(`(^|\\s)${v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=\\s|$)`, 'gi');
              out = out.replace(re, `$1${canon}`);
            }
          }
          return out.trim();
        };

        const stopSet = new Set((opts.stopWords || []).map(x => x.toLowerCase()));
        const allowOrderFlex = opts.allowOrderFlex !== false; // default true

        let heardNorm = normalize(heard);
        heardNorm = applySynonyms(heardNorm, opts.synonyms);
        const expectedNorm = normalize(expected);

        let hT = heardNorm.split(' ').filter(Boolean);
        let eT = expectedNorm.split(' ').filter(Boolean);

        if (stopSet.size) {
          eT = eT.filter(t => !stopSet.has(t));
          hT = hT.filter(t => !stopSet.has(t));
        }
        if (!eT.length) return { coverage: 0, matched: 0, total: 1, orderScore: 1 };

        // Bag-of-words coverage with multiplicity
        const freq = new Map();
        for (const t of hT) freq.set(t, (freq.get(t)||0)+1);

        let matched = 0;
        for (const t of eT) {
          const n = freq.get(t) || 0;
          if (n > 0) { matched++; freq.set(t, n-1); }
        }
        const coverage = matched / eT.length;

        // Order score via LCS when strict order required
        let orderScore = 1;
        if (!allowOrderFlex) {
          const m = eT.length, n = hT.length;
          const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
          for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) {
            if (eT[i-1] === hT[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
            else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
          }
          const lcs = dp[m][n];
          orderScore = lcs / m;
        }

        return { coverage, matched, total: eT.length, orderScore };
      };
    }

    // Keep a live capability flag
    SF.hasAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  } // END bootstrap

  // ===== 2) Ensure HUD / Panel exist (inject if missing) =====
  const game = document.getElementById('game-container');
  if (!game) return;

  if (!document.getElementById('speech-hud')) {
    game.insertAdjacentHTML('beforeend', `
      <div id="speech-hud" class="speech-hud" aria-live="polite">
        <button id="speech-toggle" class="speech-btn" title="Toggle Speech">🎤 Off</button>
        <button id="speech-settings-btn" class="speech-btn" title="Speech Settings">⚙️</button>
        <span id="speech-status" class="speech-chip" hidden>Listening…</span>
        <span id="speech-transcript" class="speech-chip" hidden></span>
      </div>
    `);
  }
  if (!document.getElementById('speech-settings')) {
    game.insertAdjacentHTML('beforeend', `
      <div id="speech-settings" class="speech-panel" hidden>
        <div class="speech-panel-inner">
          <h3>Speech Settings</h3>
          <div class="row">
            <label>Enable Speech</label>
            <label class="switch">
              <input id="speech-enabled-checkbox" type="checkbox">
              <span class="slider"></span>
            </label>
          </div>
          <div class="row">
            <label for="speech-lang">Language</label>
            <select id="speech-lang">
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Español (ES)</option>
            </select>
          </div>
          <div class="row">
            <label for="speech-tolerance">Tolerance: <span id="speech-tolerance-value">0.80</span></label>
            <input id="speech-tolerance" type="range" min="0.50" max="0.98" step="0.01" value="0.80">
          </div>
          <div class="row presets">
            <button data-preset="strict" class="preset">Strict (0.92)</button>
            <button data-preset="normal" class="preset">Normal (0.80)</button>
            <button data-preset="lenient" class="preset">Lenient (0.65)</button>
          </div>
          <div class="row">
            <button id="speech-close" class="speech-btn">Close</button>
          </div>
        </div>
      </div>
    `);
  }
  if (!document.getElementById('speech-test')) {
    game.insertAdjacentHTML('beforeend',
      '<button id="speech-test" class="speech-btn">🎙️ Test mic</button>' +
      '<div id="speech-test-out" class="speech-chip" style="display:block;margin-top:8px;"></div>'
    );
  }

  // ===== 3) HUD ↔ SpeechFeature sync (restore + wire) =====
  const chk   = document.getElementById('speech-enabled-checkbox');
  const lang  = document.getElementById('speech-lang');
  const tol   = document.getElementById('speech-tolerance');
  const tolVal = document.getElementById('speech-tolerance-value');
  const prefsKey = 'speech_prefs';

  const SF = window.SpeechFeature;

  // Restore saved prefs
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey) || '{}');
    if (typeof saved.enabled === 'boolean') SF.enabled = saved.enabled;
    if (typeof saved.lang === 'string')     SF.settings = {...(SF.settings||{}), lang: saved.lang};
    if (typeof saved.tolerance === 'number') SF.settings = {...(SF.settings||{}), tolerance: saved.tolerance};
  } catch {}

  // Reflect to HUD
  if (chk) chk.checked = !!SF.enabled;
  if (lang && SF.settings?.lang) lang.value = SF.settings.lang;
  if (tol  && SF.settings?.tolerance) {
    tol.value = SF.settings.tolerance;
    if (tolVal) tolVal.textContent = SF.settings.tolerance.toFixed(2);
  }

  // Wire changes
  chk?.addEventListener('change', () => {
    SF.enabled = !!chk.checked;
    const s = JSON.parse(localStorage.getItem(prefsKey) || '{}'); s.enabled = SF.enabled;
    localStorage.setItem(prefsKey, JSON.stringify(s));
  });
  lang?.addEventListener('change', () => {
    SF.settings = {...(SF.settings||{}), lang: lang.value};
    const s = JSON.parse(localStorage.getItem(prefsKey) || '{}'); s.lang = lang.value;
    localStorage.setItem(prefsKey, JSON.stringify(s));
  });
  tol?.addEventListener('input', () => {
    const t = Number(tol.value)||0.8;
    SF.settings = {...(SF.settings||{}), tolerance: t};
    if (tolVal) tolVal.textContent = t.toFixed(2);
    const s = JSON.parse(localStorage.getItem(prefsKey) || '{}'); s.tolerance = t;
    localStorage.setItem(prefsKey, JSON.stringify(s));
  });

  // ===== 4) Wire panel open/close/toggle (idempotent) =====
  const open   = document.getElementById('speech-settings-btn');
  const panel  = document.getElementById('speech-settings');
  const close  = document.getElementById('speech-close');
  const toggle = document.getElementById('speech-toggle');

  if (open && !open.dataset.bound) {
    open.addEventListener('click', () => { panel.hidden = false; });
    open.dataset.bound = '1';
  }
  if (close && !close.dataset.bound) {
    close.addEventListener('click', () => { panel.hidden = true; });
    close.dataset.bound = '1';
  }
  if (panel && !panel.dataset.bound) {
    panel.addEventListener('click', (e) => { if (e.target === panel) panel.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) panel.hidden = true; });
    panel.dataset.bound = '1';
  }
  if (toggle && !toggle.dataset.bound) {
    toggle.addEventListener('click', () => {
      const on = toggle.textContent.includes('On');
      toggle.textContent = on ? '🎤 Off' : '🎤 On';
    });
    toggle.dataset.bound = '1';
  }

  // ===== 5) Wire mic smoke test (idempotent) =====
  (function wireMicSmokeTest(){
    const btn = document.getElementById('speech-test');
    const out = document.getElementById('speech-test-out');
    if (!btn || !out || btn.dataset.bound) return;

    btn.addEventListener('click', () => {
      if (window.SpeechFeature && SpeechFeature.hasAPI) {
        if (!SpeechFeature.enabled) { out.textContent = 'Enable speech first (⚙️ → toggle).'; return; }
        out.textContent = 'Listening…';
        SpeechFeature.start(
          (heard) => { out.textContent = `Heard: "${heard}"`; },
          () => { if (out.textContent === 'Listening…') out.textContent = 'No input.'; }
        );
        return;
      }
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) { out.textContent = 'Web Speech API not available in this browser.'; return; }
      const rec = new Rec();
      rec.lang = (window.SpeechFeature?.settings?.lang) || 'en-US';
      rec.interimResults = false; rec.maxAlternatives = 1;
      out.textContent = 'Listening…';
      rec.onresult = (e)=>{ out.textContent = `Heard: "${e.results[0][0].transcript.trim()}"`; };
      rec.onerror  = (e)=>{ out.textContent = `Error: ${e.error || 'unknown'}`; };
      rec.onend    = ()=>{ if (out.textContent === 'Listening…') out.textContent = 'No input.'; };
      try { rec.start(); } catch (err) { out.textContent = `Start failed: ${err.message}`; }
    });

    btn.dataset.bound = '1';
  })();
    // ===== 6) Per-scene visibility gate (central authority) =====
  // ===== 6) Per-scene visibility gate (central authority) =====
  try {
    const scId = window.currentSceneId;
    const sc   = (window.scenes || {})[scId] || null;

    const hud       = document.getElementById('speech-hud');
    const panel     = document.getElementById('speech-settings');
    const testBtn   = document.getElementById('speech-test');

    // Classic per-question speak button (MC, video-choice, etc.)
    const nativeBtn = document.getElementById('mc-speak-btn');
    // Any floating mic we may have created earlier
    const floatMic  = document.getElementById('floating-mc-mic');

    const allowTypes = new Set([
      'hangman',
      'interaction',
      'interaction-scramble',
      'interaction-fill-in-the-blank',
      'interaction-audio-mc',      // text-based MC; audio-only ones opt-out via disableSpeech:true
      'video-choice',
      'video-multi-question',
      'video-multi-audio-choice',
      'video-scramble',
      'video-fill-in-the-blank',
      'text'
    ]);

    let allow = false;
    if (sc) {
      if (sc.enableSpeech === true) {
        // explicit opt-in wins
        allow = true;
      } else if (sc.disableSpeech === true) {
        // explicit opt-out wins
        allow = false;
      } else if (allowTypes.has(sc.type)) {
        // allowed by type if not explicitly disabled
        allow = true;
      }
    }

    const hide = (el) => { if (el) el.style.display = 'none'; };
    const show = (el) => { if (el) el.style.display = ''; };

    if (!allow) {
      // Hide EVERYTHING speech-related on disallowed scenes
      hide(hud);
      hide(panel);
      hide(testBtn);
      hide(nativeBtn);
      hide(floatMic);
    } else {
      // Show on allowed scenes (you can tweak which bits you expose)
      show(hud);
      show(panel);
      show(testBtn);
      show(nativeBtn);
      show(floatMic);
    }
  } catch (e) {
    console.warn('[speech-gate] failed in ensureSpeechUI:', e);
  }


}

function wantsSpeechForScene(scene) {
  if (!scene || typeof scene !== 'object') return false;

  // Per-scene hard override
  if (scene.disableSpeech === true) return false;
  if (scene.forceSpeech === true) return true;

  const t = scene.type;

  // ✅ Only these scene types show speech UI
  switch (t) {
    case "hangman":
    case "interaction":
    case "interaction-scramble":
    case "interaction-fill-in-the-blank":
    case "interaction-audio-mc":          // text choices / prompt audio
    case "video-choice":
    case "video-multi-question":
    case "video-multi-audio-choice":
    case "video-scramble":
    case "video-fill-in-the-blank":
    case "text":                          // text scenes with choices/navigation
      return true;

    default:
      return false;
  }
}

function updateSpeechUIForScene(sceneOrId) {
  // Make sure HUD exists (idempotent, safe to call a lot)
  try { ensureSpeechUI(); } catch (_) {}

  const scene = (typeof sceneOrId === 'string')
    ? (window.scenes && window.scenes[sceneOrId])
    : sceneOrId;

  const shouldShow = wantsSpeechForScene(scene);

  const hud      = document.getElementById('speech-hud');
  const panel    = document.getElementById('speech-settings');
  const testBtn  = document.getElementById('speech-test');
  const testOut  = document.getElementById('speech-test-out');

  [hud, panel, testBtn, testOut].forEach(el => {
    if (!el) return;
    if (shouldShow) {
      el.style.display = '';
      if (el.id === 'speech-settings') el.hidden = true; // panel closed by default
    } else {
      el.style.display = 'none';
      if (el.id === 'speech-settings') el.hidden = true;
    }
  });
}

// --- Speech per-scene hard gate (uses scene.disableSpeech / scene.enableSpeech) ---

function hardDisableSpeechForScene() {
  try {
    // Global flag other code can check
    window.__SPEECH_ALLOWED__ = false;

    // Hide HUD/panel/test if they exist
    [
      'speech-hud',
      'speech-settings',
      'speech-test',
      'speech-test-out'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Remove any per-question mic / speak buttons
    [
      'mc-speak-btn',
      'floating-mc-mic'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  } catch (e) {
    console.warn('[Speech] hardDisableSpeechForScene failed', e);
  }
}

function softEnableSpeechForScene() {
  try {
    window.__SPEECH_ALLOWED__ = true;
    // Recreate HUD etc. if needed; no-op if already there
    if (typeof ensureSpeechUI === 'function') {
      ensureSpeechUI();
    }
  } catch (e) {
    console.warn('[Speech] softEnableSpeechForScene failed', e);
  }
}



// === Speak button injector hooked to loadScene (permanent) ===
// === Speak button injector hooked to loadScene (with fallback if SpeechFeature/attachSpeechCheck missing) ===
// === Speak button injector hooked to loadScene (single clean fallback, id-safe) ===
// === Speak button injector hooked to loadScene (fuzzy ordered subsequence matcher) ===
// === Speak button injector hooked to loadScene (aligns tiles to your speech) ===
// === Speak button injector hooked to loadScene (aligns tiles to your speech; hardened) ===
// === Speak button injector hooked to loadScene (robust align & debug) ===
// === Speak button injector hooked to loadScene (chip→speech alignment) ===
// === Speak button injector — phrase-aware alignment for scramble chips ===
// === Speak button injector — phrase-aware + contraction-normalized + expected-order fallback ===
// === Speak button injector — conservative auto-arrange with coverage gate ===
// === Speak button injector — v5: strong gentle reordering + verbose logs ===
// === Speak button injector — v6 (token-overlap matching + reliable reordering + clear logs) ===
// === Speak button injector — v6.1 (exact-order on full match, simpler aggressive sort) ===
// === Speak button injector — v6.2 (strict phrase match, move-only-what-you-said) ===
// === Speak button injector — v6.3 (adaptive matching, fewer retries) ===
/* =======================================================================
   Speech v6.3 — MC-only hook (scramble code removed)
   - Maps: interaction, multiple-choice, decision, interaction-audio-mc
   - Injects #mc-speak-btn into #choices-container once buttons are visible
   - Label picks (A/B/C, 1/2/3, number words incl. ES) + semantic scoring
   - Busy state, duplicate guard, optional "M" keyboard shortcut
   ======================================================================= */
/* =======================================================================
   Speech v6.3 — MC-only hook (robust)
   - Detects MC scenes by exact keys OR regex (/mc|multiple|choice/i)
   - Finds buttons beyond #choices-container (fallback scan)
   - Waits with MutationObserver + visibility polling before injecting mic
   ======================================================================= */
/* =======================================================================
   Speech v6.3 — MC-only hook (filtered for real choices)
   ======================================================================= */
/* =======================================================================
   Speech v6.3 — MC-only hook (filtered + robust)  — CLEAN VERSION
   ======================================================================= */
/* =======================================================================
   Speech v6.3 — MC-only hook (filtered + robust) — SYNC SCENE ID
   ======================================================================= */
(function hookSpeakBtnIntoLoadScene(){
  if (window.__speakHookInstalled_v63) return;
  window.__speakHookInstalled_v63 = true;

  /* ---------------- global state (timeout guard) ---------------- */
  let __commitTs = 0;
  let __pendingTimeoutTimer = null;
  const COMMIT_GRACE_MS = 1500;
  window.__speechListening = false;
  window.__speechChoiceCommitted = false;

  function isTimeoutSceneId(targetId){
    try {
      const cur = window.currentSceneId && (window.scenes||{})[window.currentSceneId];
      if (cur?.endings?.timeout && targetId === cur.endings.timeout) return true;
    } catch {}
    return /timeout/i.test(String(targetId||''));
  }

  /* ---------------- install wrapper (with timeout-guard) ---------------- */
  function install(orig){
    window.loadScene = function(id){
      if (isTimeoutSceneId(id)) {
        const now = Date.now();
        const withinListening = !!window.__speechListening;
        const sinceCommit = now - __commitTs;
        const withinGrace = sinceCommit >= 0 && sinceCommit < COMMIT_GRACE_MS;

        if (withinListening || withinGrace){
          const delay = withinListening ? 300 : (COMMIT_GRACE_MS - sinceCommit);
          clearTimeout(__pendingTimeoutTimer);
          __pendingTimeoutTimer = setTimeout(()=>{
            try { orig.call(window, id); } catch {}
          }, Math.max(0, delay));
          console.warn('[Speech][Guard] deferred timeout', {withinListening, withinGrace, delay});
          return;
        }
      }

      if (id) window.currentSceneId = id;
      const r = orig.apply(this, arguments);
      try { if (typeof ensureSpeechUI === 'function') ensureSpeechUI(); } catch(_) {}
      setTimeout(() => { try { addSpeechForScene(id || window.currentSceneId); } catch(e){ console.warn('[Speech v6.3]', e); } }, 0);
      return r;
    };

    console.log('[Speech v6.3] loadScene hook installed (global MC + free-text + timeout-guard)');
    setTimeout(() => { try { if (window.currentSceneId) addSpeechForScene(window.currentSceneId); } catch {} }, 0);
  }

  if (typeof window.loadScene === 'function') install(window.loadScene);
  else {
    let tries = 0;
    (function wait(){
      if (typeof window.loadScene === 'function') return install(window.loadScene);
      if (tries++ > 200) return;
      setTimeout(wait, 30);
    })();
  }

  /* ---------------- utils (GLOBAL) ---------------- */
  const norm = s => String(s||'')
    .toLowerCase()
    .replace(/[\u201C\u201D]/g,'"').replace(/[\u2018\u2019]/g,"'")
    .replace(/[^a-z0-9áéíóúüñçœæß\s'-]/gi,' ')
    .replace(/\s+/g,' ').trim();

  function isVisible(el){
    return !!(el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
  }

  function getVisibleChoiceButtonsStrict(){
    const cc = document.getElementById('choices-container');
    const exclude = b =>
      b.id === 'mc-speak-btn' ||
      b.classList.contains('speech-btn') ||
      /^speech-/.test(b.id || '') ||
      !isVisible(b) ||
      !(b.textContent?.trim() || b.getAttribute('aria-label'));
    if (cc){
      const btns = [...cc.querySelectorAll('button,[role="button"],a[role="button"],.choice,.option')].filter(b => !exclude(b));
      if (btns.length) return { btns, container: cc };
    }
    const roots = [document.getElementById('interaction-area'), document.getElementById('scene'), document.getElementById('game'), document.body].filter(Boolean);
    for (const root of roots){
      const cands = [...root.querySelectorAll('button,[role="button"],a[role="button"],.choice,.option')].filter(b => !exclude(b));
      if (cands.length) {
        const parent = cands[0].closest('#choices-container, .choices, .options, .mc, [data-choices], [data-options]') || cands[0].parentElement || root;
        return { btns: cands, container: parent };
      }
    }
    return { btns: [], container: cc || document.body };
  }

  function whenButtonsVisible(cb, timeoutMs=8000){
    const start = performance.now();
    let done = false;
    const tryFinish = () => {
      const found = getVisibleChoiceButtonsStrict();
      if (found.btns.length) { done = true; try { obs.disconnect(); } catch{} cb(found); }
    };
    const init = getVisibleChoiceButtonsStrict();
    if (init.btns.length) return cb(init);
    const obs = new MutationObserver(() => { if (!done) tryFinish(); });
    obs.observe(document.body, { childList: true, subtree: true });
    (function poll(){
      if (done) return;
      tryFinish();
      if (done) return;
      if (performance.now() - start > timeoutMs) { try { obs.disconnect(); } catch{} return; }
      requestAnimationFrame(poll);
    })();
  }

  /* ---------- UI lock helpers ---------- */
  function ensureFreezeStyles(){
    if (document.getElementById('speech-freeze-style')) return;
    const css = `
    #speech-lock-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.02);pointer-events:all}
    #speech-lock-badge{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;padding:8px 12px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:500 13px/1.2 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)}
    .speech-locked [data-clickable],.speech-locked button,.speech-locked [role="button"],.speech-locked .choice,.speech-locked .option{cursor:not-allowed!important}`;
    const tag = document.createElement('style');
    tag.id = 'speech-freeze-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  let __speechLockedLocal = false;
  let __lockKbHandler = null;

  function lockInteractions(){
    if (__speechLockedLocal) return;
    ensureFreezeStyles();
    __speechLockedLocal = true;
    document.documentElement.classList.add('speech-locked');

  let ov = document.getElementById('speech-lock-overlay');
if (!ov){
  ov = document.createElement('div');
  ov.id = 'speech-lock-overlay';
  // ⚠️ Do NOT set aria-hidden on a node that can hold focus; use inert instead.
  ov.setAttribute('inert', '');  // prevents focus & pointer events for children
  ov.tabIndex = -1;              // ensure it won't be focusable itself

  ['click','mousedown','mouseup','pointerdown','pointerup','keydown'].forEach(ev=>{
    ov.addEventListener(ev, e => { e.stopPropagation(); e.preventDefault(); }, true);
  });

  // full-screen cover
  ov.style.position = 'fixed';
  ov.style.inset = '0';
  ov.style.zIndex = '2147483646';
  ov.style.background = 'rgba(0,0,0,.02)';
  ov.style.pointerEvents = 'all';

  document.body.appendChild(ov);
}


    let badge = document.getElementById('speech-lock-badge');
    if (!badge){
      badge = document.createElement('div');
      badge.id = 'speech-lock-badge';
      badge.textContent = 'Listening… choices disabled';
      document.body.appendChild(badge);
    } else {
      badge.style.display = 'block';
    }

    const btns = [...document.querySelectorAll('button,[role="button"],.choice,.option')];
    btns.forEach(b=>{
      if (b.id === 'mc-speak-btn' || b.classList.contains('speech-btn') || /^speech-/.test(b.id||'')) return;
      if (!b.dataset.__speechWasDisabled) b.dataset.__speechWasDisabled = b.disabled ? '1' : '0';
      b.disabled = true;
      b.setAttribute('aria-disabled','true');
    });

    __lockKbHandler = (e)=>{
      const k = (e.key||'').toLowerCase();
      const block = new Set(['enter',' ']);
      const digit = /^\d$/.test(k);
      const letter = /^[a-j]$/.test(k);
      if (block.has(k) || digit || letter){ e.stopPropagation(); e.preventDefault(); }
    };
    document.addEventListener('keydown', __lockKbHandler, true);
  }

  function unlockInteractions(){
    try {
      const ov = document.getElementById('speech-lock-overlay');
      if (ov) ov.remove();
    } catch(_) {}
    if (!__speechLockedLocal) return;
    __speechLockedLocal = false;
    document.documentElement.classList.remove('speech-locked');
   
    const badge = document.getElementById('speech-lock-badge');
    if (badge) badge.style.display = 'none';

    const btns = [...document.querySelectorAll('button,[role="button"],.choice,.option')];
    btns.forEach(b=>{
      if (b.id === 'mc-speak-btn' || b.classList.contains('speech-btn') || /^speech-/.test(b.id||'')) return;
      const was = b.dataset.__speechWasDisabled; delete b.dataset.__speechWasDisabled;
      if (was === '0') { b.disabled = false; b.removeAttribute('aria-disabled'); }
    });

    if (__lockKbHandler){ document.removeEventListener('keydown', __lockKbHandler, true); __lockKbHandler = null; }
  }

  // --- Scene timer helpers (safe if SceneTimer is absent) ---
  function pauseSceneTimer(){ try { window.SceneTimer?.pause(); } catch(_){} }
  function resumeSceneTimer(){ try { if (!window.__speechChoiceCommitted) window.SceneTimer?.resume(); } catch(_){} }

  // guard hooks the mic will call
  function __speechGuard_onStart(){
    window.__speechListening = true;
    window.__speechChoiceCommitted = false;
    pauseSceneTimer();
    try { document.dispatchEvent(new Event('speech-start')); } catch(_){}
  }
  function __speechGuard_onFinish(committed){
    window.__speechListening = false;
    if (committed) {
      window.__speechChoiceCommitted = true;
      __commitTs = Date.now();
    }
    if (!committed) resumeSceneTimer();
    try { document.dispatchEvent(new Event('speech-finish')); } catch(_){}
  }
  function __speechGuard_onCancel(){
    window.__speechListening = false;
    resumeSceneTimer();
    try { document.dispatchEvent(new Event('speech-cancel')); } catch(_){}
  }

  // 🔔 NEW: emit when a speech-driven choice is actually committed
  function __speechEmitCommit(){
    try { document.dispatchEvent(new Event('speech-commit')); } catch(_) {}
  }

  // --- Student Mode detection ---
  function isStudentMode(){
    const chk = document.getElementById('speech-student-mode');
    if (chk && chk.checked) return true;
    return !!(window.SpeechFeature?.settings?.studentMode);
  }

  // --- Aliases & contractions ---
  function applySpeechAliases(s){
    const map = (window.SpeechFeature?.settings?.aliasMap) || {};
    let out = String(s||'');
    try {
      for (const [from,to] of Object.entries(map)){
        const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'gi');
        out = out.replace(re, to);
      }
    } catch {}
    return out;
  }

  function toks(s){ return String(s||'').toLowerCase().match(/[a-z0-9áéíóúüñçœæ'-]+/gi) || []; }

  const STOP = new Set(['a','an','the','and','or','but','if','to','of','in','on','for','by','with','as','is','are','was','were','be','been','this','that','these','those','it','we','you','they','i','he','she','them','our','your','their','at','from','into','about','over','after','before','within','without','up','down','out','will','would','can','could','should','may','might','must','do','does','did','have','has','had','one','two','three','four','five','six','seven','eight','nine','ten']);

  function autoKeywordHints(text, max=6){
    const freq = new Map();
    const words = toks(text);
    for (const w0 of words){
      if (STOP.has(w0)) continue;
      if (w0.length < 3) continue;
      const w = w0;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return [...freq.entries()].sort((a,b)=> b[1]-a[1] || a[0].length-b[0].length).slice(0, max).map(([w])=>w);
  }
  function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
  function lerp(a,b,t){ return a + (b-a)*t; }

  function computePickPolicy(opts){
    const tol = typeof opts.tol === 'number' ? opts.tol : 0.80;
    const t = clamp((tol - 0.65) / (0.92 - 0.65), 0, 1);
    const timed   = !!opts.timed;
    const student = !!opts.student;
    const pron    = !!opts.pronunciationFocus;

    let tokenW = pron ? lerp(0.55, 0.40, t) : lerp(0.70, 0.55, t);
    let phonW  = 1 - tokenW;

    let minScore = lerp(0.38, 0.58, t);
    if (student) minScore -= 0.05;
    if (timed)   minScore -= 0.03;
    minScore = clamp(minScore, 0.30, 0.70);

    let margin = lerp(0.04, 0.10, t);
    if (timed) margin -= 0.02;
    margin = clamp(margin, 0.02, 0.12);

    let minPhoneme = pron ? lerp(0.30, 0.55, t) : lerp(0.22, 0.45, t);
    if (student) minPhoneme -= 0.03;
    minPhoneme = clamp(minPhoneme, 0.18, 0.60);

    return { weights:{token:tokenW, phoneme:phonW}, minScore, margin, minPhoneme };
  }

  function estimateSpeechWindowFromChoices(choiceList){
    if (!Array.isArray(choiceList) || !choiceList.length) return 9000;
    const longestWords = choiceList.reduce((max, choice) => {
      const raw = (choice && typeof choice.raw === 'string') ? choice.raw
                : (choice && typeof choice.text === 'string') ? choice.text
                : '';
      if (!raw) return max;
      const words = raw.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(max, words);
    }, 0);
    const baseWords = Math.max(12, longestWords);
    const ms = Math.round(baseWords * 520 + 1800); // ≈115 wpm + buffer
    return Math.max(9000, Math.min(22000, ms));
  }

  /* -------- Contraction support -------- */
  function normalizeContractions(s){
    let out = String(s||'')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .toLowerCase();
    const map = [
      [/i'm\b/g,'i am'], [/you're\b/g,'you are'], [/we're\b/g,'we are'], [/they're\b/g,'they are'],
      [/he's\b/g,'he is'], [/she's\b/g,'she is'], [/it's\b/g,'it is'], [/that's\b/g,'that is'],
      [/there's\b/g,'there is'], [/can't\b/g,'can not'], [/won't\b/g,'will not'], [/don't\b/g,'do not'],
      [/doesn't\b/g,'does not'], [/didn't\b/g,'did not'], [/isn't\b/g,'is not'], [/aren't\b/g,'are not'],
      [/wasn't\b/g,'was not'], [/weren't\b/g,'were not'], [/shouldn't\b/g,'should not'],
      [/couldn't\b/g,'could not'], [/wouldn't\b/g,'would not'],
      [/we'll\b/g,'we will'], [/you'll\b/g,'you will'], [/they'll\b/g,'they will'], [/i'll\b/g,'i will'],
      [/we’ve\b/g,'we have'], [/weve\b/g,'we have'], [/we'd\b/g,'we would'], [/you'd\b/g,'you would']
    ];
    for (const [re, rep] of map) out = out.replace(re, rep);
    return out;
  }
  const prepHeard  = s => normalizeContractions(applySpeechAliases(s));
  const prepChoice = s => normalizeContractions(String(s||''));

  /* ---------------- dispatcher ---------------- */
    /* ---------------- dispatcher ---------------- */
  function addSpeechForScene(sceneId){
    const sc = (window.scenes || {})[sceneId];

    // 🔒 Global gate: respect per-scene + helper
    try {
      if (!sc) return;

      // Hard scene flags win first
      if (sc.disableSpeech === true || sc.noSpeechUI === true) {
        return;
      }

      // If central helper exists, trust it
      if (typeof window.shouldSceneHaveSpeech === 'function') {
        if (!window.shouldSceneHaveSpeech(sc)) {
          return;
        }
      }
    } catch (e) {
      console.warn('[Speech v6.3] addSpeechForScene gate failed:', e);
    }

    const type = sc.type || '';
    const mcTypes = new Set([
      'interaction',
      'multiple-choice',
      'decision',
      'interaction-audio-mc',
      'video-choice',
      'video-multi-question'
    ]);

    // Normal MC routes
    if (mcTypes.has(type) || /mc|multiple|choice/i.test(type)) {
      addSpeechForMultipleChoice(sceneId, sc);
      return;
    }

    // Fallback: only if there are real choice buttons AND scene passed the gate
    const probe = getVisibleChoiceButtonsStrict();
    if (probe.btns.length) {
      addSpeechForMultipleChoice(sceneId, sc);
    }
  }


  // Robust prefix check
  function strongPrefixPass(heard, targetRaw, isTimed){
    const H = toks(prepHeard(heard));
    const T = toks(prepChoice(targetRaw));
    if (!H.length || !T.length) return false;

    const PREF_MAX = 14;
    const baseLen  = Math.max(8, Math.min(PREF_MAX, Math.ceil(T.length * 0.60)));

    const stripSuffix = w => {
      let x = w.replace(/['’]/g,''); x = x.replace(/(ing|ings)$/,'');
      x = x.replace(/(ed|er|ers)$/,''); x = x.replace(/(es)$/,''); x = x.replace(/(s)$/,'');
      return x;
    };
    function editDistance(a,b){
      const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
      const dp=new Array(n+1); for(let j=0;j<=n;j++) dp[j]=j;
      for(let i=1;i<=m;i++){
        let prev=dp[0]; dp[0]=i;
        for(let j=1;j<=n;j++){
          const t=dp[j];
          dp[j]=Math.min(dp[j]+1, dp[j-1]+1, prev+(a[i-1]===b[j-1]?0:1));
          prev=t;
        }
      }
      return dp[n];
    }
    function equalish(a,b){
      if (a===b) return true;
      const sa=stripSuffix(a), sb=stripSuffix(b);
      if (sa===sb) return true;
      const L=Math.max(sa.length,sb.length), k=(L>=6)?2:1;
      if (editDistance(sa,sb)<=k) return true;
      if (sa.length>=4 && sb.length>=4 && sa.slice(0,4)===sb.slice(0,4)) return true;
      return false;
    }

    const FILLERS = new Set(['uh','um','erm','please','ok','okay','vale','eh']);
    const Hf = H.filter(t => !FILLERS.has(t));
    if (!Hf.length) return false;

    const START_SKIP_MAX = 3;
    let bestCoverage = 0, bestMatches = 0, bestN = 0;

    for (let skip=0; skip<=START_SKIP_MAX; skip++){
      const n = Math.min(PREF_MAX, Math.max(1, T.length - skip));
      const P = T.slice(skip, skip + n);
      if (!P.length) continue;

      const m = Hf.length;
      const dp = Array.from({length:m+1}, ()=> new Array(n+1).fill(0));
      for (let i=1;i<=m;i++){
        for (let j=1;j<=n;j++){
          const match = equalish(Hf[i-1], P[j-1]) ? 1 : 0;
          dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1], dp[i-1][j-1] + match);
        }
      }
      const lcs = dp[m][n];
      const cov = lcs / n;

      if (cov > bestCoverage || (cov === bestCoverage && lcs > bestMatches)){
        bestCoverage = cov; bestMatches = lcs; bestN = n;
      }
    }

    const earlyEnough = Hf.length <= (bestN * 3);
    const needMatches = isTimed ? 6 : 8;
    const needCov     = isTimed ? 0.45 : 0.55;
    return (bestMatches >= needMatches) && (bestCoverage >= needCov) && earlyEnough;
  }

  /* ---------------- MC injector (GLOBAL) ---------------- */
  function addSpeechForMultipleChoice(sceneId, sc){
    document.getElementById('mc-speak-btn')?.remove();

    whenButtonsVisible(({ btns, container }) => {
      if (!btns.length) return;
      if (document.getElementById('mc-speak-btn')) return;

      const mic = document.createElement('button');
      mic.id = 'mc-speak-btn';
      mic.textContent = '🎙️ Speak Choice';
      mic.className = 'speech-btn';
      mic.style.margin = '8px 0 0 0';
      try { container.appendChild(mic); } catch { document.body.appendChild(mic); }

      const labels = ['a','b','c','d','e','f','g','h','i','j'];

      const choiceData = [...btns].map((b, i) => {
        const raw = (b.textContent || b.getAttribute('aria-label') || '').trim();
        const alts = (b.getAttribute('data-alt') || '').split(',').map(s => s.trim()).filter(Boolean);
        let kw    = (b.getAttribute('data-kw') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        let kwNeg = (b.getAttribute('data-kw-neg') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (!kw.length) kw = autoKeywordHints(raw);
        return {
          el: b,
          raw, rawPrep: prepChoice(raw), norm: norm(raw),
          alts, normAlts: alts.map(norm),
          kws: kw, kwsNeg: kwNeg,
          index: i,
          indexOriginal: Number.isFinite(Number(b.dataset?.originIndex))
                          ? Number(b.dataset.originIndex)
                          : i,
          letter: labels[i] || String.fromCharCode(97 + i),
          number: i + 1,
          isRight: b.hasAttribute('data-right') || b.getAttribute('data-right') === '1'
        };
      });

      try {
        const inc = sc?.speechHints?.include || {};
        const exc = sc?.speechHints?.exclude || {};
        choiceData.forEach(cd => {
          if (Array.isArray(inc[cd.index])) cd.kws.push(...inc[cd.index].map(s => String(s).toLowerCase()));
          if (Array.isArray(exc[cd.index])) cd.kwsNeg.push(...exc[cd.index].map(s => String(s).toLowerCase()));
        });
      } catch(_) {}

      // 🔧 UPDATED: emit speech-commit, unlock first, and force navigate if needed
// --- replace your existing clickChoice with this version ---
// --- helper: derive a fallback target from the current scene config ---
function __fallbackNextForButton(el) {
  try {
    const curId = window.currentSceneId;
    const sc = (window.scenes||{})[curId];
    if (!sc) return "";

    // 1) Index of this button (prefer stable originIndex)
    const originIdx = Number.isFinite(+el.dataset?.originIndex)
      ? +el.dataset.originIndex
      : (function inferByText(){
          if (!Array.isArray(sc.choices)) return NaN;
          const txt = (el.textContent||"").trim().toLowerCase();
          for (let i=0;i<sc.choices.length;i++){
            const t = String(sc.choices[i]?.text||"").trim().toLowerCase();
            if (t && t === txt) return i;
          }
          return NaN;
        })();

    // 2) Direct per-option target on the scene structure
    //    (covers a bunch of schemas you might be using)
    const direct = (Array.isArray(sc.choices) && sc.choices[originIdx] && typeof sc.choices[originIdx].next === 'string')
      ? sc.choices[originIdx].next.trim()
      : "";

    if (direct) return direct;

    // Arrays keyed by index
    const arrKeys = ['choiceNext','nexts','routesArray'];
    for (const k of arrKeys) {
      const arr = Array.isArray(sc[k]) ? sc[k] : null;
      const v = arr && arr[originIdx];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }

    // Map objects keyed by index
    const mapKeys = ['routes','nextMap','answerRoutes','answersNext'];
    for (const k of mapKeys) {
      const m = sc[k];
      if (m && typeof m === 'object') {
        const v = m[originIdx] ?? m[String(originIdx)];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }

    // Correct/wrong logic from scene fields
    const ends = sc.endings || {};
    const rightNext = ends.right || ends.correct || sc.nextCorrect || sc.correctNext || "";
    const wrongNext = ends.wrong || ends.incorrect || sc.nextWrong || sc.wrongNext || "";

    let isRight = false;

    // (a) By numeric scene.correct
    if (Number.isFinite(sc.correct)) isRight = (originIdx === Number(sc.correct));

    // (b) By button tag
    if (!isRight) {
      isRight = el.hasAttribute('data-right') || el.getAttribute('data-right') === '1';
    }

    if (isRight && rightNext) return String(rightNext).trim();
    if (!isRight && wrongNext) return String(wrongNext).trim();

    // Last resort: global default next
    if (typeof sc.next === 'string' && sc.next.trim()) return sc.next.trim();

    return "";
  } catch(e){
    console.warn('[Speech][fallbackNextForButton] error', e);
    return "";
  }
}

function clickChoice(ch){
  try {
    window.__speechChoiceCommitted = true;

    const el = ch.el;
    const before = window.currentSceneId || '';
    const wasDisabled = el.disabled;

    // --- Robust NEXT resolver (multi-source + scene-aware fallback) ---
    const scId = window.currentSceneId;
    const sc   = (window.scenes || {})[scId] || {};
    const sceneChoices = Array.isArray(sc.choices) ? sc.choices : [];

    let target =
      el.getAttribute('data-next') ||
      (window.__choiceNextMap && window.__choiceNextMap.get(el)) ||
      el.getAttribute('aria-next') ||
      '';

    // Fallback A: use originIndex → scene.choices[originIndex].next
    if (!target) {
      const oi = Number(el.dataset?.originIndex);
      if (Number.isFinite(oi) && sceneChoices[oi] && sceneChoices[oi].next) {
        target = sceneChoices[oi].next;
      }
    }

    // Fallback B: text head match (prefix compare to be shuffle-proof)
    if (!target && sceneChoices.length) {
      const btnHead = (el.textContent || '').trim().slice(0, 120);
      const norm = s => String(s||'')
        .toLowerCase()
        .replace(/[\u201C\u201D]/g,'"').replace(/[\u2018\u2019]/g,"'")
        .replace(/\s+/g,' ')
        .trim();
      const BTN = norm(btnHead);
      let hit = null;
      for (const c of sceneChoices) {
        const C = norm(String(c.text||'').slice(0, 120));
        if (C && BTN && (BTN.startsWith(C) || C.startsWith(BTN) || BTN.includes(C) || C.includes(BTN))) {
          hit = c; break;
        }
      }
      if (hit && hit.next) target = hit.next;
    }

    if (!target) {
      console.warn('[MC speech] no target to navigate to (no data-next / weakMap / aria-next / scene match).');
    }

    // Make sure it's clickable
    if (wasDisabled) { el.disabled = false; el.removeAttribute('aria-disabled'); }

    // Unlock before clicking so overlays don’t swallow it
    try { unlockInteractions(); } catch(_) {}

    // Visual cue
    el.focus();
    el.classList.add('choice-flash'); setTimeout(()=> el.classList.remove('choice-flash'), 300);

    const proxy = el.__speechProxyClick;
    try {
      if (typeof proxy === 'function') {
        proxy();
        return;
      }
    } catch(_) {}
    el.click();

    // If scene didn’t change, force navigate with our resolved target
    requestAnimationFrame(() => {
      const unchanged = (window.currentSceneId === before);
      if (unchanged && target) {
        console.warn('[MC speech] click swallowed → forcing loadScene:', target, { before });
        try { window.loadScene(target); } catch(e){ console.warn('[MC speech] force navigate failed', e); }
      } else {
        console.log('[MC speech] click succeeded', { before, after: window.currentSceneId });
      }
      if (wasDisabled) { el.disabled = true; el.setAttribute('aria-disabled','true'); }
    });

  } catch(e) {
    console.warn('[MC speech] click failed', e);
  }
}







      function leadInText(s, n = 11){
        const txt = String(s||'').replace(/\s+/g,' ').trim();
        const words = txt.split(' ');
        const head = words.slice(0, n).join(' ');
        return words.length > n ? head + '…' : head;
      }

      function scoreChoice(heard, choice, lang, weights, studentMode){
        const H = prepHeard(heard);
        let tokenCov = 0, phonCov = 0;
        try {
          if (window.SpeechFeature?.match) {
            const base = SpeechFeature.match(H, choice.rawPrep, { allowOrderFlex: true })?.coverage || 0;
            const altMax = Math.max(0, ...(choice.alts||[]).map(a => SpeechFeature.match(H, prepChoice(a), { allowOrderFlex:true })?.coverage || 0));
            tokenCov = Math.max(base, altMax);
          }
        } catch{}
        try {
          if (typeof phonemeScore === 'function') {
            const base = phonemeScore(H, choice.raw, lang)?.coverage || 0;
            const altMax = Math.max(0, ...(choice.alts||[]).map(a => phonemeScore(H, a, lang)?.coverage || 0));
            phonCov = Math.max(base, altMax);
          }
        } catch{}
        let blended = (weights.token * tokenCov) + (weights.phoneme * phonCov);
        const Hset = new Set(H.split(/\s+/).filter(Boolean));
        const posHits = (choice.kws||[]).reduce((n,w)=> n + (Hset.has(w)?1:0), 0);
        const negHits = (choice.kwsNeg||[]).reduce((n,w)=> n + (Hset.has(w)?1:0), 0);
        if (studentMode){
          blended += Math.min(0.25, posHits * 0.10);
          const hToks = toks(H);
          if (hToks.length <= 5 && posHits >= 1) blended += 0.08;
        }
        blended -= Math.min(0.24, negHits * 0.08);
        blended = Math.max(0, Math.min(1, blended));
        return { score: blended, posHits, negHits, phonCov };
      }

      function tryLabelPick(heard){
        const hRaw = String(heard||'').toLowerCase();
        const h = hRaw.replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/\s+/g,' ').trim();
        const stripFillers = s => s.replace(/\b(uh|um|erm|please|por favor|ok|okay|vale|eh)\b/gi, '').replace(/\s+/g,' ').trim();
        const hNoFill = stripFillers(h);
        const letters = ['a','b','c','d','e','f','g','h','i','j'];
        for (let i=0;i<letters.length;i++){
          const l = letters[i];
          const rePref = new RegExp(`\\b(?:option|choice|opcion|opción)\\s*${l}\\b`, 'i');
          if (rePref.test(hNoFill)) return { index:i, letter:l };
          if (hNoFill === l) return { index:i, letter:l };
        }
        const numberWords = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10, uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10 };
        const prefNum = hNoFill.match(/\b(?:option|choice|opcion|opción)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i);
        if (prefNum){
          const tok = prefNum[1].toLowerCase();
          const n = /^\d+$/.test(tok) ? Number(tok) : numberWords[tok];
          if (Number.isInteger(n)) return { index:n-1, letter: letters[n-1] };
        }
        if (/^\d+$/.test(hNoFill)){
          const n = Number(hNoFill); if (n>=1 && n<=10) return { index:n-1, letter: letters[n-1] };
        } else if (numberWords[hNoFill]){
          const n = numberWords[hNoFill]; return { index:n-1, letter: letters[n-1] };
        }
        return null;
      }

      function rankChoicesFor(utterance, lang, weights, student){
        return choiceData.map(ch => ({ ch, ...scoreChoice(utterance, ch, lang, weights, student) })).sort((a,b)=> b.score - a.score);
      }

      function setMicBusy(busy){
        mic.disabled = !!busy;
        mic.dataset.listening = busy ? '1' : '0';
        mic.textContent = busy ? '🎙️ Listening…' : '🎙️ Speak Choice';
      }

mic.addEventListener('click', () => {
  // 0) Ensure Web Speech exists
  const hasAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!hasAPI) { alert('Speech API not available in this browser.'); return; }

  const student = isStudentMode();

  // 1) Hard-enable SF (headless mode, no UI)
  const SF = (window.SpeechFeature ||= { enabled:true, settings:{ lang:'en-US', tolerance:0.80 } });
  SF.enabled = true; // force-on
  if (!SF.settings.lang) SF.settings.lang = 'en-US';
  if (typeof SF.settings.tolerance !== 'number') SF.settings.tolerance = 0.80;
  const desiredWindow = estimateSpeechWindowFromChoices(choiceData);
  const prevListen = Number(SF.settings.listenMs) || 0;
  const minSceneWindow = student ? 9000 : 8000;
  SF.settings.listenMs = Math.max(desiredWindow, prevListen, minSceneWindow);

  // 2) Scene context
  const tol = (SF.settings?.tolerance ?? 0.80);
  const lang = SF.settings?.lang || 'en-US';
  const isTimedScene = ((sc && typeof sc.timer === 'number' && sc.timer > 0) ||
                        !!document.querySelector('#timer, #countdown, .timer, .countdown, [data-timer], .progress-bar, #progress-bar'));
  const pron = !!(SF.settings && SF.settings.pronunciationFocus);

  // 3) Busy/lock + single-shot guards + nav watcher so we never hang
  lockInteractions();
  setMicBusy(true);
  __speechGuard_onStart();

  let committed = false;
  let finished  = false;

  const beforeId = window.currentSceneId || '';
  const NAV_POLL_MS = 60;

  let navWatch = null;
  let watchdog = null;

  const clearGuards = () => {
    try { if (watchdog) clearTimeout(watchdog); } catch {}
    try { if (navWatch) clearInterval(navWatch); } catch {}
    watchdog = null; navWatch = null;
  };

  const finish = (didCommit) => {
    if (finished) return;
    finished = true;
    committed = !!didCommit;
    clearGuards();
    try { setMicBusy(false); } catch {}
    try { unlockInteractions(); } catch {}
    try { __speechGuard_onFinish(committed); } catch {}
  };

  // watch for navigation success (e.g., clickChoice advanced scene)
  navWatch = setInterval(() => {
    if (!finished && window.currentSceneId && window.currentSceneId !== beforeId) {
      finish(true); // scene changed → consider committed
    }
  }, NAV_POLL_MS);

  // cancel if engine never calls back
  const WATCHDOG_MS = Math.max(6500, SF.settings.listenMs || 0);
  watchdog = setTimeout(() => {
    if (finished) return;
    console.warn('[MC speech] watchdog timeout — cancelling listen');
    const fb = document.getElementById('scramble-feedback') || container || document.body;
    try { fb.style.display='block'; fb.style.color='#ffd166'; fb.textContent = 'No speech heard. Try again.'; } catch {}
    finish(false);
  }, WATCHDOG_MS);

  // 4) Start recognition
  try {
    SF.start((heard, alts) => {
      if (finished) return; // single-shot guard
      clearGuards();

      // === scoring policy ===
      const policy = computePickPolicy({ tol, timed: isTimedScene, student, pronunciationFocus: pron });
      const weights = policy.weights;
      const minChoiceScore = (typeof SF.settings?.minScore === 'number') ? SF.settings.minScore : policy.minScore;
      const wantMargin     = (typeof SF.settings?.strictPick === 'number') ? SF.settings.strictPick : policy.margin;
      const minPhoneme     = (typeof SF.settings?.minPhoneme === 'number') ? SF.settings.minPhoneme : policy.minPhoneme;

      const heardAliased = prepHeard(heard);
      const altList = Array.isArray(alts) ? alts : [];
      const candidates = [heardAliased, ...altList.map(prepHeard)];

      // (A) labels A/B/1/2
      const direct = tryLabelPick(heardAliased);
      if (direct) {
        const d = choiceData[direct.index];
        if (d) { clickChoice(d); finish(true); return; }
        finish(false); return;
      }

      // (B) unique prefix
      try {
        const prefixHits = choiceData.filter(ch => strongPrefixPass(heardAliased, ch.raw, isTimedScene));
        if (prefixHits.length === 1) { clickChoice(prefixHits[0]); finish(true); return; }
      } catch {}

      // (C) best score + margin
      const rank = (utt) => choiceData.map(ch => ({ ch, ...scoreChoice(utt, ch, lang, weights, student) }))
                                      .sort((a,b)=> b.score - a.score);
      const top = rank(heardAliased);
      const top1 = top[0], top2 = top[1];
      const margin = (top1?.score ?? 0) - (top2?.score ?? 0);
      const havePhon = (typeof window.phonemeScore === 'function');
      const phonOK = havePhon ? ((top1?.phonCov ?? 0) >= minPhoneme) : true;

      if (top1 && top1.score >= minChoiceScore && margin >= wantMargin && phonOK) {
        clickChoice(top1.ch);
        finish(true);
        return;
      }

      // Coach, don’t navigate
      const fb = document.getElementById('scramble-feedback') || container || document.body;
      try { fb.style.display='block'; fb.style.color='#ffd166'; fb.textContent = 'Not confident yet. Read the beginning of your chosen option clearly (8–12 words).'; }
      catch {}
      finish(false);
    }, () => {
      if (finished) return; // single-shot guard
      clearGuards();
      const fb = document.getElementById('scramble-feedback') || container || document.body;
      try { fb.style.display='block'; fb.style.color='#ffd166'; fb.textContent = 'No speech heard. Try again.'; } catch {}
      finish(false);
    });
  } catch (e) {
    if (!finished) {
      clearGuards();
      console.warn('[MC speech] start() failed', e);
      finish(false);
    }
  }
});



      document.addEventListener('keydown', (e) => {
        if ((e.key === 'm' || e.key === 'M') && mic && !mic.disabled && isVisible(mic)) mic.click();
      }, { passive: true });
    });
  }

  /* ---------------- free-text helpers (GLOBAL) ---------------- */
  function evaluateFreeText(heard, rubric){
    const lang = rubric?.lang || (window.SpeechFeature?.settings?.lang) || 'en-US';
    const tol  = rubric?.tol  || (window.SpeechFeature?.settings?.tolerance) || 0.80;
    const student = !!(window.SpeechFeature?.settings?.studentMode);

    const H0 = prepHeard(heard);
    const weights = student ? { token:0.60, phoneme:0.40 } : { token:0.75, phoneme:0.25 };

    function cov(a,b){
      let tokenCov=0, phonCov=0;
      try { tokenCov = window.SpeechFeature?.match(a,b,{allowOrderFlex:true})?.coverage || 0; } catch{}
      try { if (typeof phonemeScore==='function') phonemeScore(a,b,lang)?.coverage || 0; } catch{}
      return weights.token*tokenCov + weights.phoneme*phonCov;
    }

    const models = [rubric?.model, ...(rubric?.alts||[])].filter(Boolean);
    let best = 0;
    for (const m of models) best = Math.max(best, cov(H0, m));

    const heardTokens = new Set((toks(H0)||[]));
    const incHits = (rubric?.include||[]).reduce((n,w)=> n + (heardTokens.has(String(w).toLowerCase())?1:0), 0);
    const excHits = (rubric?.exclude||[]).reduce((n,w)=> n + (heardTokens.has(String(w).toLowerCase())?1:0), 0);
    if (student) best += Math.min(0.25, incHits*0.10);
    best -= Math.min(0.24, excHits*0.08);
    best = Math.max(0, Math.min(1, best));

    const pass = best >= Math.max(0.45, tol*0.55) - (student ? 0.06 : 0);
    return { pass, score:best, incHits, excHits };
  }

  function attachFreeTextSpeechCheck(btn, rubric, onPass){
    if (!btn) return;
    btn.addEventListener('click', ()=>{
      const SF = window.SpeechFeature||{};
      if (!SF.enabled) return alert('Enable speech first (⚙️).');
      lockInteractions(); __speechGuard_onStart();
      SF.start(function(heard /*, alts*/){
        const r = evaluateFreeText(heard, rubric||{});
        __speechGuard_onFinish(r?.pass === true);
        unlockInteractions();
        if (r.pass) { try { onPass?.(r); } catch{} }
        else {
          const fb = document.getElementById('scramble-feedback') || document.body;
          try { fb.style.display='block'; fb.style.color='#ffd166'; fb.textContent = `Not confident yet (score ${(r.score*100|0)}%). Try again with key details.`; }
          catch { alert(`Not confident yet (score ${(r.score*100|0)}%). Try again with key details.`); }
        }
      }, ()=> { __speechGuard_onCancel(); unlockInteractions(); });
    });
  }

  window.SpeechFreeText = { evaluateFreeText, attachFreeTextSpeechCheck };

})(); // end hook

// Global start (configurable)
window.currentSceneId = window.currentSceneId || (window.START_SCENE_ID || 'scene1');
window.loadScene(window.currentSceneId);

// Student mode toggle wiring (settings panel)
(function wireStudentModeToggle(){
  function init(){
    const el = document.getElementById('speech-student-mode');
    if (!el) return false;
    window.SpeechFeature = window.SpeechFeature || {};
    SpeechFeature.settings = SpeechFeature.settings || {};
    const saved = localStorage.getItem('speech.studentMode');
    const initial = (saved === null) ? !!SpeechFeature.settings.studentMode : (saved === '1');
    el.checked = initial;
    SpeechFeature.settings.studentMode = el.checked;
    el.addEventListener('change', () => {
      SpeechFeature.settings.studentMode = el.checked;
      localStorage.setItem('speech.studentMode', el.checked ? '1' : '0');
      console.log('[Speech] Student mode →', el.checked ? 'ON' : 'OFF');
    });
    return true;
  }
  if (!init()){
    let tries = 0;
    const t = setInterval(() => { if (init() || ++tries > 60) clearInterval(t); }, 100);
  }
})();

// Arm speech for MC choices with retries (no hook changes)
window.__armSpeechForChoices = function __armSpeechForChoices(hostSel = '#choices-container') {
  // Clean any stuck overlay/focus from prior scene
  try {
    const lock = document.getElementById('speech-lock-overlay');
    if (lock) lock.remove();
    window.__speechListening = false;
    window.__speechChoiceCommitted = false;
  } catch(_) {}

  const MAX_TRIES = 5;
  let tries = 0;

  function attempt() {
    const host = document.querySelector(hostSel);
    const hasChoices = !!host && host.querySelector('.choice');
    if (!hasChoices) {
      if (tries++ < MAX_TRIES) return setTimeout(attempt, 60);
      return; // give up quietly
    }

    try { updateSpeechUIForScene(firstSceneId); } catch(_) {}
    try { 
      if (typeof window.addSpeechForMultipleChoice === 'function') {
        window.addSpeechForMultipleChoice();    // inject mic into #choices-container
      }
    } catch(_) {}

    // if mic still missing, retry a few times
    const mic = document.getElementById('mc-speak-btn') || document.querySelector('.speech-btn');
    if (!mic && tries++ < MAX_TRIES) return setTimeout(attempt, 80);
  }

  // rAF twice to ensure layout committed, then start attempts
  requestAnimationFrame(() => requestAnimationFrame(attempt));
};

// ==== SAFE SPEECH CHOICES ARMER (polymorphic arg + idempotent) ====
(function(){
  // If a stable version already exists, replace it to gain the polymorphic behavior
  function armOnce(host){
    try {
      if (!host || !host.children || !host.children.length) return;
      if (host.__speechArmed) return;            // idempotent per host
      host.__speechArmed = true;

      const hook = window.__armSpeechForChoicesLegacy || window.__armSpeechForChoicesRaw || window.__armSpeechForChoices;

      if (typeof hook === 'function') {
        // 1) Try passing the element (modern form)
        try { hook(host); return; }
        catch (e1) {
          // 2) If their hook uses querySelector(sel), retry with a selector string
          if (e1 && /querySelector/.test(String(e1.message||e1))) {
            try { hook('#choices-container'); return; } catch(e2){}
          }
          // 3) Final fallback: do nothing silently (never throw)
        }
      }
      // If no hook present, fail silently.
    } catch(_) {}
  }

  function armWithRetries(host){
    let tries = 0, max = 6;
    function tick(){
      if (!host || !document.body.contains(host)) return;
      armOnce(host);
      if (!host.__speechArmed && ++tries < max) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // public stable entry
  function stableArm(host){
    if (!host) return;
    try {
      document.dispatchEvent(new CustomEvent('choices-ready', {
        detail:{ sceneId: window.currentSceneId || '', hostId: host.id || '' }
      }));
    } catch(_) {}
    armWithRetries(host);
  }
  stableArm.__stable = true;

  // Preserve any existing raw hook so we can call it
  if (typeof window.__armSpeechForChoices === 'function' && !window.__armSpeechForChoices.__stable) {
    window.__armSpeechForChoicesRaw = window.__armSpeechForChoices;
  }
  // Also store a legacy alias if one exists elsewhere
  if (typeof window.__armSpeechForChoicesLegacy === 'undefined' && typeof window.__armSpeechForChoices === 'function') {
    window.__armSpeechForChoicesLegacy = window.__armSpeechForChoices;
  }

  window.__armSpeechForChoices = stableArm;
})();

/* ===== Global Speech Button Guard (sticky + observer) ===== */
/* ===== Global Speech Button Guard (sticky + observer + watchdog) ===== */
(function installSpeechGuard(){
  if (window.__speechGuardInstalled) return;
  window.__speechGuardInstalled = true;

  // --- helpers ----------------------------------------------------------
  function getChoicesHost(){
    // Canonical host used by loaders
    var host = document.querySelector('#choices-container');
    if (!host) host = document.querySelector('#vc-choices'); // fallback if you ever use it
    if (!host) return null;
    // Only consider it valid when real options exist
    if (!host.querySelector('.choice')) return null;
    return host;
  }

function ensureMic(host){
  if (!host) return false;

  // 🔒 Per-scene gate: respect disableSpeech / noSpeechUI / shouldSceneHaveSpeech
  try {
    const curId = window.currentSceneId;
    const sc = (window.scenes || {})[curId] || null;

    // If this scene explicitly disables speech UI → remove mic and bail
    if (sc && (sc.disableSpeech === true || sc.noSpeechUI === true) && sc.forceSpeechUI !== true) {
      host.querySelector('#mc-speak-btn')?.remove();
      return false;
    }

    // If we have the global helper, let it decide
    if (typeof window.shouldSceneHaveSpeech === 'function') {
      if (!window.shouldSceneHaveSpeech(sc)) {
        host.querySelector('#mc-speak-btn')?.remove();
        return false;
      }
    }
  } catch (e) {
    console.warn('[speech guard] ensureMic gate failed:', e);
  }

  // If we’re allowed and it already exists, we’re done
  if (host.querySelector('#mc-speak-btn')) return true;

  // ✅ Create the speak button (only on allowed scenes)
  var btn = document.createElement('button');
  btn.id = 'mc-speak-btn';
  btn.className = 'speech-btn choice';
  btn.type = 'button';
  btn.textContent = '🎤 Speak answer';
  btn.dataset.sticky = '1';

  if (host.firstChild) host.insertBefore(btn, host.firstChild);
  else host.appendChild(btn);

  try {
    if (typeof addSpeechForMultipleChoice === 'function') {
      addSpeechForMultipleChoice();
    }
  } catch(e){
    console.warn('[speech guard] addSpeechForMultipleChoice failed:', e);
  }

  return true;
}


  // --- observer (fires on DOM mutations) --------------------------------
  var root = document.getElementById('game-container') || document.body;
  var mo = new MutationObserver(function(){
    var host = getChoicesHost();
    if (host) ensureMic(host);
  });
  mo.observe(root, { childList: true, subtree: true });

  // --- events (our own scene/choices signals) ----------------------------
  document.addEventListener('choices-ready', function(){
    var host = getChoicesHost();
    if (host) ensureMic(host);
  });

  // Wrap loadScene to emit a scene-changed signal
  (function wrapLoadSceneOnce(){
    var orig = window.loadScene;
    if (typeof orig !== 'function') return;
    if (orig.__speechWrapped) return;
    function wrapped(id){
      var r = orig.apply(this, arguments);
      try { document.dispatchEvent(new CustomEvent('scene-changed', { detail:{ id:id }})); } catch(_){}
      return r;
    }
    wrapped.__speechWrapped = true;
    window.loadScene = wrapped;
  })();

  // --- watchdog (periodic re-check for late wipes) -----------------------
  var watchTimer = null;
  var watchScene = null;

  function stopWatch(){
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    watchScene = null;
  }

  function startWatch(){
    stopWatch();
    watchScene = window.currentSceneId || null;
    var ticks = 0, goodStreak = 0;

    watchTimer = setInterval(function(){
      // bail if scene changed
      if (watchScene && window.currentSceneId && window.currentSceneId !== watchScene) {
        stopWatch(); return;
      }
      var host = getChoicesHost();
      if (!host) { goodStreak = 0; ticks++; if (ticks > 120) stopWatch(); return; } // ~30s max
      var ok = ensureMic(host);
      if (ok) { goodStreak++; } else { goodStreak = 0; }
      ticks++;
      // stop after we’ve seen the mic present a couple of consecutive checks
      if (goodStreak >= 2 || ticks > 120) stopWatch();
    }, 250);
  }

  document.addEventListener('scene-changed', function(){
    startWatch();
    try { unlockInteractions(); } catch(_) {}
  });
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) startWatch();
  });

  // First pass (covers already-rendered scene on load)
  setTimeout(function(){
    var host = getChoicesHost();
    if (host) ensureMic(host);
    startWatch();
  }, 0);
})();

/* ===== Floating Speech Mic (container-agnostic) ===== */
(function installFloatingMCmic(){
  if (window.__floatingMicInstalled) return;
  window.__floatingMicInstalled = true;

  // host slot (sticks to bottom of game container)
  function getGame(){
    return document.getElementById('game-container') || document.body;
  }
  function ensureSlot(){
    var slot = document.getElementById('speech-mc-slot');
    if (slot) return slot;
    slot = document.createElement('div');
    slot.id = 'speech-mc-slot';
    slot.style.cssText = [
      'position:sticky','bottom:0','margin-top:8px','padding:8px',
      'display:none','justify-content:flex-end','gap:8px',
      'background:transparent','z-index:50'
    ].join(';');
    getGame().appendChild(slot);
    return slot;
  }

  function choicesPresent(){
    // look anywhere under game container; don’t depend on a specific id
    var root = getGame();
    return !!root.querySelector('.choice');
  }

  function ensureMicVisible(){
  var slot = ensureSlot();
  var game = getGame();
  if (!slot || !game) return;

  // 🔒 Scene-level gate
  try {
    const scId = window.currentSceneId;
    const sc = (window.scenes || {})[scId] || null;

    // Respect global helper if present
    if (typeof window.shouldSceneHaveSpeech === 'function') {
      if (!window.shouldSceneHaveSpeech(sc)) {
        slot.style.display = 'none';
        slot.innerHTML = '';
        return;
      }
    }

    // Respect hard flags
    if (sc && (sc.disableSpeech === true || sc.noSpeechUI === true) && sc.forceSpeechUI !== true) {
      slot.style.display = 'none';
      slot.innerHTML = '';
      return;
    }
  } catch(e) {
    console.warn('[floating mic] gate failed:', e);
  }

  // Only show if there are actual choices
  var hasChoices = choicesPresent();
  if (!hasChoices){
    slot.style.display = 'none';
    slot.innerHTML = '';
    return;
  }

  // If already present, keep it
  var btn = slot.querySelector('#floating-mc-mic');
  if (!btn){
    btn = document.createElement('button');
    btn.id = 'floating-mc-mic';
    btn.type = 'button';
    btn.className = 'speech-btn';
    btn.textContent = '🎤 Speak answer';
    btn.style.cssText = [
      'padding:10px 14px','border:none','border-radius:10px',
      'font-weight:700','cursor:pointer',
      'background:#00ffff','color:#000'
    ].join(';');

    // Delegate to native mic when clicked
    btn.addEventListener('click', function(){
      try { window.SceneTimer?.pause?.(); } catch(_){}
      var nativeBtn =
        document.getElementById('mc-speak-btn') ||
        document.querySelector('#choices-container #mc-speak-btn');
      if (nativeBtn) { nativeBtn.click(); return; }

      try { typeof addSpeechForMultipleChoice === 'function' && addSpeechForMultipleChoice(); } catch(_){}

      let tries = 0;
      (function wait(){
        var nb =
          document.getElementById('mc-speak-btn') ||
          document.querySelector('#choices-container #mc-speak-btn');
        if (nb) { nb.click(); return; }
        if (tries++ < 10) setTimeout(wait, 60);
      })();
    });

    slot.appendChild(btn);
  }

  slot.style.display = 'flex';
}


  // Re-evaluate on scene changes and DOM churn
  function emitCheckSoon(){
    // a couple of delayed checks to catch late rewrites
    setTimeout(ensureMicVisible, 0);
    setTimeout(ensureMicVisible, 200);
    setTimeout(ensureMicVisible, 500);
  }

  // Wrap loadScene to signal scene changes
  (function wrapLoadSceneOnce(){
    var orig = window.loadScene;
    if (typeof orig !== 'function' || orig.__speechFloatingWrapped) return;
    function wrapped(id){
      var r = orig.apply(this, arguments);
      try { document.dispatchEvent(new CustomEvent('scene-changed', { detail:{ id:id } })); } catch(_){}
      emitCheckSoon();
      return r;
    }
    wrapped.__speechFloatingWrapped = true;
    window.loadScene = wrapped;
  })();

  // Listen for our existing “choices-ready” signals if any
  document.addEventListener('choices-ready', emitCheckSoon);
  document.addEventListener('scene-changed', emitCheckSoon);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) emitCheckSoon(); });
  // Some loaders rebuild choices after feedback; watch for that too.
document.addEventListener('choices-updated', emitCheckSoon);


  // Mutation observer as a backstop
var mo = null;
function bindObserver() {
  try { if (mo) mo.disconnect(); } catch(_){}
  var root = getGame();
  if (!root) return;
  mo = new MutationObserver(function(){ emitCheckSoon(); });
  mo.observe(root, { childList:true, subtree:true });
}

// (re)bind on install and on every scene change
bindObserver();
document.addEventListener('scene-changed', bindObserver);


  // First pass
  emitCheckSoon();
})();

/* === Floating MC Mic + Native Mic Ensurer (safe, idempotent) === */
(function(){
  if (window.__floatingMicInstalled) return;
  window.__floatingMicInstalled = true;

  // Debounce helper
  function debounce(fn, ms){ let t; return function(){ clearTimeout(t); t=setTimeout(fn, ms); }; }

  // Try to inject the native mic (the working one your hook normally adds)
  function ensureNativeMic() {
    var host = document.querySelector('#choices-container');
    if (!host) return false;

    // If it's already there, nothing to do.
    if (document.getElementById('mc-speak-btn')) return true;

    // Ask the hook to add it
    try {
      if (typeof addSpeechForMultipleChoice === 'function') {
        addSpeechForMultipleChoice();
      }
    } catch(e) {
      console.warn('[floating mic] addSpeechForMultipleChoice() threw:', e);
    }

    // Re-check shortly; if still missing, add a small shim that delegates to the hook
    setTimeout(function(){
      if (document.getElementById('mc-speak-btn')) return; // hook succeeded
      var againHost = document.querySelector('#choices-container');
      if (!againHost) return;

      var shim = document.createElement('button');
      shim.id = 'mc-speak-btn';              // same id so downstream logic works
      shim.className = 'speech-btn';         // same class styling
      shim.textContent = '🎤 Speak answer';
      shim.style.cssText = 'margin-bottom:8px;';
      shim.addEventListener('click', function(){
        try { window.SceneTimer && window.SceneTimer.pause && window.SceneTimer.pause(); } catch(_){}
        try {
          if (typeof addSpeechForMultipleChoice === 'function') {
            addSpeechForMultipleChoice();
          }
        } catch(e) {
          console.warn('[floating mic shim] addSpeechForMultipleChoice() failed:', e);
        }
      });
      againHost.prepend(shim);
    }, 60);

    return true;
  }

  // One floating mic that always appears when choices are visible
  var btn = document.getElementById('floating-mc-mic');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'floating-mc-mic';
    btn.type = 'button';
    btn.textContent = '🎤 Speak answer';
    btn.style.cssText = 'display:none;margin:10px 0;padding:10px 14px;border:none;border-radius:10px;background:#00ffff;color:#000;font-weight:700;cursor:pointer';
    // Put it near the game container; we’ll move/show/hide via check()
    var gc = document.getElementById('game-container') || document.body;
    gc.prepend(btn);
  }

  // Clicking the floating mic should trigger the native mic
  btn.addEventListener('click', function(){
    // Prefer the native mic if present
    var nativeBtn = document.getElementById('mc-speak-btn');
    if (nativeBtn) {
      nativeBtn.click();
      return;
    }
    // Else try to create it, then click again
    ensureNativeMic();
    setTimeout(function(){
      var nb = document.getElementById('mc-speak-btn');
      if (nb) nb.click();
    }, 120);
  });

  // Core re-check: show/hide floating, ensure native mic exists when choices exist
  function check() {
    var host = document.querySelector('#choices-container');
    var hasChoices = !!(host && host.querySelectorAll('.choice').length);

    // show/hide floating mic based on choices visibility
    btn.style.display = hasChoices ? '' : 'none';

    // if choices exist but no native mic, inject/ensure it
    if (hasChoices && !document.getElementById('mc-speak-btn')) {
      ensureNativeMic();
    }
  }
  var checkSoon = debounce(check, 50);

  // Observe changes inside the game container to react to scene/choice mounts
  var gc = document.getElementById('game-container');
  if (gc && window.MutationObserver) {
    var mo = new MutationObserver(checkSoon);
    mo.observe(gc, { childList: true, subtree: true });
  }

  // Also react when loaders emit this (some of your loaders already do)
  document.addEventListener('choices-ready', checkSoon);

  // Run now and once more shortly after mount
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ check(); setTimeout(check, 120); });
  } else {
    check(); setTimeout(check, 120);
  }
})();

/* === Mic Guardian: re-ensures native mic on every scene (safe & idempotent) === */
(function(){
  if (window.__micGuardianInstalled) return;
  window.__micGuardianInstalled = true;

  // Minimal ensureNativeMic fallback (uses your hook if available, else shims a button)
  window.ensureNativeMic = window.ensureNativeMic || function ensureNativeMic(){
    var host = document.querySelector('#choices-container');
    if (!host) return false;

    // already there?
    if (document.getElementById('mc-speak-btn')) return true;

    // try real hook first
    try {
      if (typeof window.addSpeechForMultipleChoice === 'function') {
        window.addSpeechForMultipleChoice();
      }
    } catch(e) { console.warn('[MicGuardian] addSpeechForMultipleChoice() threw:', e); }

    // if still missing, add a shim button that delegates to the hook
    setTimeout(function(){
      if (document.getElementById('mc-speak-btn')) return; // hook succeeded
      var h = document.querySelector('#choices-container'); if (!h) return;
      var shim = document.createElement('button');
      shim.id = 'mc-speak-btn';
      shim.className = 'speech-btn';
      shim.textContent = '🎤 Speak answer';
      shim.dataset.sticky = "1"; // hint for any cleanups
      shim.style.cssText = 'margin-bottom:8px;';
      shim.addEventListener('click', function(){
        try { window.SceneTimer && window.SceneTimer.pause && window.SceneTimer.pause(); } catch(_){}
        try {
          if (typeof window.addSpeechForMultipleChoice === 'function') {
            window.addSpeechForMultipleChoice();
          }
        } catch(e) { console.warn('[MicGuardian] shim click failed:', e); }
      });
      h.prepend(shim);
    }, 40);

    return true;
  };

  function startMicGuardian(){
    function startMicGuardian(){
  stopMicGuardian();
  var ticks = 0;
  window.__micGuardianTimer = setInterval(function(){
    ticks++;

    var curId = window.currentSceneId;
    var sc = (window.scenes || {})[curId] || null;

    // 🔒 Respect scene gate
    try {
      if (typeof window.shouldSceneHaveSpeech === 'function') {
        if (!window.shouldSceneHaveSpeech(sc)) {
          if (document.getElementById('mc-speak-btn')) {
            document.getElementById('mc-speak-btn').remove();
          }
          return;
        }
      }
      if (sc && (sc.disableSpeech === true || sc.noSpeechUI === true) && sc.forceSpeechUI !== true) {
        if (document.getElementById('mc-speak-btn')) {
          document.getElementById('mc-speak-btn').remove();
        }
        return;
      }
    } catch(e){
      console.warn('[MicGuardian] gate failed:', e);
    }

    var host = document.querySelector('#choices-container');
    var hasChoices = !!(host && host.querySelectorAll('.choice').length);

    if (hasChoices && !document.getElementById('mc-speak-btn')) {
      try { window.ensureNativeMic && window.ensureNativeMic(); } catch(_){}
    }

    if (ticks > 100) stopMicGuardian();  // ~20s max
  }, 200);
}

  }
  function stopMicGuardian(){
    if (window.__micGuardianTimer) {
      clearInterval(window.__micGuardianTimer);
      window.__micGuardianTimer = null;
    }
  }

  // Wrap loadScene WITHOUT replacing earlier wrappers
  (function wrapLoadScene(){
    var prev = window.loadScene;
    if (typeof prev !== 'function') {
      // if loadScene isn’t ready yet, try again soon
      var tries = 0;
      (function wait(){
        if (typeof window.loadScene === 'function') { wrapLoadScene(); return; }
        if (tries++ > 200) return;
        setTimeout(wait, 30);
      })();
      return;
    }
    window.loadScene = function(id){
      var r = prev.apply(this, arguments);
      try { startMicGuardian(); } catch(_){}
      return r;
    };
  })();

  // Also react when loaders announce choices are ready
  document.addEventListener('choices-ready', function(){
    try { startMicGuardian(); } catch(_){}
  });

  // One initial kick on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ try { startMicGuardian(); } catch(_){ } });
  } else {
    try { startMicGuardian(); } catch(_){}
  }
})();

// === Speech allow-list helper ===
function shouldSceneHaveSpeech(sc) {
  if (!sc || typeof sc !== 'object') return false;

  // Manual overrides:
  if (sc.noSpeechUI === true)    return false;
  if (sc.forceSpeechUI === true) return true;

  const t = sc.type || 'text';

  const hasTextChoices =
    Array.isArray(sc.choices) &&
    sc.choices.some(c => c && typeof c.text === 'string' && c.text.trim().length);

  // interaction-audio-mc: only enable speech if options are textual, not pure audio files
  const isIAMC_TextOptions = (() => {
    if (t !== 'interaction-audio-mc') return false;
    const opts = Array.isArray(sc.options) ? sc.options : [];
    if (!opts.length) return false;

    const isAudioFile = v =>
      typeof v === 'string' && /\.(mp3|wav|ogg|m4a)$/i.test(v);

    const isTextOption =
      v =>
        (typeof v === 'string' && !isAudioFile(v)) ||
        (v && typeof v === 'object' && typeof v.text === 'string');

    return opts.some(isTextOption);
  })();

  switch (t) {
    case 'hangman':
      return true;

    case 'interaction-audio-mc':
      // Only those with text options get speech
      return isIAMC_TextOptions;

    // Video challenges or text scenes with TEXT choices:
    case 'video-choice':
    case 'video-multi-question':
    case 'video-multi-audio-choice':
    case 'video-scramble':
    case 'video-fill-in-the-blank':
    case 'text':
      return hasTextChoices;

    default:
      // Buckets, survivor, pure audio MC, email, dashboards, etc → no speech
      return false;
  }
}

function updateSpeechUIForScene(sceneOrId) {
  const sc = (typeof sceneOrId === 'string')
    ? (window.scenes || {})[sceneOrId]
    : sceneOrId;

  const need = shouldSceneHaveSpeech(sc);

  if (!need) {
    const hud  = document.getElementById('speech-hud');
    const pnl  = document.getElementById('speech-settings');
    const test = document.getElementById('speech-test');
    const out  = document.getElementById('speech-test-out');

    if (hud)  hud.style.display  = 'none';
    if (pnl)  pnl.style.display  = 'none';
    if (test) test.style.display = 'none';
    if (out)  out.style.display  = 'none';

    return;
  }

  // Scene DOES want speech → ensure UI exists + show it
  try { ensureSpeechUI(); } catch (e) {
    console.warn('[SpeechUI] ensureSpeechUI failed:', e);
  }

  const hud  = document.getElementById('speech-hud');
  const pnl  = document.getElementById('speech-settings');
  const test = document.getElementById('speech-test');
  const out  = document.getElementById('speech-test-out');

  if (hud)  hud.style.display  = '';
  if (pnl)  pnl.style.display  = '';
  if (test) test.style.display = '';
  if (out)  out.style.display  = 'block';
}

window.shouldSceneHaveSpeech  = window.shouldSceneHaveSpeech  || shouldSceneHaveSpeech;
window.updateSpeechUIForScene = window.updateSpeechUIForScene || updateSpeechUIForScene;
