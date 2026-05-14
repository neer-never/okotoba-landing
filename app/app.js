// 御言葉台帳 — MVP
const STORAGE_KEY = "mikotoba.entries.v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  entries: load(),
  pageIndex: 0,
  photoDataUrl: null,
};

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(v) && v.length > 0) return v;
  } catch {}
  // 初回起動：偉人の名言を投入
  if (Array.isArray(window.MIKOTOBA_SEED) && window.MIKOTOBA_SEED.length) {
    const now = Date.now();
    const seeded = window.MIKOTOBA_SEED.map((q, i) => ({
      id: "seed-" + i,
      text: q.text,
      source: q.source,
      category: "メディア",
      photo: null,
      createdAt: new Date(now - (window.MIKOTOBA_SEED.length - i) * 60000).toISOString(),
      ai: null,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  return [];
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
}

/* ===== ビュー切替 ===== */
function showView(id) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#" + id).classList.add("active");
}

/* ===== ブック描画 ===== */
function renderBook() {
  const book = $("#book");
  const empty = $("#book-empty");
  const indicator = $("#page-indicator");
  book.innerHTML = "";

  if (state.entries.length === 0) {
    empty.hidden = false;
    indicator.textContent = "";
    return;
  }
  empty.hidden = true;

  // 新しい順
  const entries = [...state.entries].reverse();
  entries.forEach((e, i) => {
    const page = document.createElement("article");
    page.className = "page";
    page.style.zIndex = entries.length - i;
    if (i < state.pageIndex) page.classList.add("flipped");

    const photo = e.photo ? `<img class="page-photo" src="${e.photo}" alt="" />` : "";
    const meta = [
      formatDate(e.createdAt),
      e.source ? "・" + escapeHtml(e.source) : ""
    ].join("");

    page.innerHTML = `
      ${photo}
      <div class="page-inner">
        <div class="page-text">${escapeHtml(e.text)}</div>
        <div class="page-meta">${meta}</div>
      </div>
      <div class="page-stamp">${e.category || "自分"}</div>
    `;
    book.appendChild(page);
  });

  indicator.textContent = `${Math.min(state.pageIndex + 1, entries.length)} / ${entries.length}`;
}

function flipNext() {
  if (state.pageIndex < state.entries.length - 1) {
    state.pageIndex++;
    renderBook();
  }
}
function flipPrev() {
  if (state.pageIndex > 0) {
    state.pageIndex--;
    renderBook();
  }
}

/* ===== 入力画面 ===== */
function openInput() {
  $("#form-entry").reset();
  $("#photo-preview").hidden = true;
  $("#ai-section").hidden = true;
  $("#mic-status").textContent = "";
  state.photoDataUrl = null;
  showView("view-input");
}

async function handleSave(ev) {
  ev?.preventDefault?.();
  const text = $("#input-text").value.trim();
  if (!text) { $("#input-text").focus(); return; }
  const category = document.querySelector('input[name="category"]:checked').value;
  const source = $("#input-source").value.trim();

  const entry = {
    id: crypto.randomUUID(),
    text, category, source,
    photo: state.photoDataUrl,
    createdAt: new Date().toISOString(),
    ai: null,
  };

  // AI 解析（任意）— 失敗しても保存は続行
  try {
    const ai = await analyzeWithAI(entry);
    if (ai) entry.ai = ai;
  } catch (err) {
    console.warn("AI解析スキップ:", err);
  }

  state.entries.push(entry);
  save();
  state.pageIndex = 0;
  renderBook();
  showView("view-home");

  // クラウド同期（サインイン済みなら）— バックグラウンドで実行、失敗しても無視
  syncPushIfSignedIn();
}

/* ===== クラウド同期 ===== */
async function syncPushIfSignedIn() {
  if (!isIOS) return;
  try {
    await nativeCall({ action: "syncPush", entries: state.entries });
  } catch {}
}

async function syncPullIfSignedIn() {
  if (!isIOS) return;
  try {
    const r = await nativeCall({ action: "syncPull" });
    if (!r.ok || !Array.isArray(r.entries) || r.entries.length === 0) return;
    // クラウドの方が信頼度が高い → 全置換（ID重複は最新で上書き）
    const map = new Map();
    state.entries.forEach(e => map.set(e.id, e));
    r.entries.forEach(e => map.set(e.id, e));
    state.entries = Array.from(map.values()).sort((a, b) =>
      new Date(a.createdAt) - new Date(b.createdAt)
    );
    save();
    renderBook();
  } catch {}
}

/* ===== 写真添付 ===== */
$("#input-photo")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.photoDataUrl = reader.result;
    $("#photo-img").src = reader.result;
    $("#photo-preview").hidden = false;
  };
  reader.readAsDataURL(file);
});
$("#btn-remove-photo")?.addEventListener("click", () => {
  state.photoDataUrl = null;
  $("#input-photo").value = "";
  $("#photo-preview").hidden = true;
});

/* ===== 音声入力（Web Speech API） ===== */
let recognition = null;
function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "ja-JP";
  r.continuous = false;
  r.interimResults = true;
  return r;
}
$("#btn-mic")?.addEventListener("click", () => {
  if (!recognition) recognition = setupSpeech();
  if (!recognition) {
    $("#mic-status").textContent = "この端末では音声入力が使えません。";
    return;
  }
  const status = $("#mic-status");
  status.textContent = "聞いています…（話し終わると止まります）";
  const start = $("#input-text").value;
  recognition.onresult = (ev) => {
    let t = "";
    for (const r of ev.results) t += r[0].transcript;
    $("#input-text").value = (start ? start + " " : "") + t;
  };
  recognition.onerror = (e) => { status.textContent = "音声認識エラー: " + e.error; };
  recognition.onend = () => { status.textContent = "音声入力を終了しました。"; };
  try { recognition.start(); } catch {}
});

/* ===== AI解説（無効化中） =====
   将来復活させる場合: worker/ をデプロイし、URLを下に書いて return を有効化。
*/
// const OKOTOBA_AI_URL = "https://okotoba-ai.okotoba.workers.dev";
async function analyzeWithAI(_entry) {
  return null; // AI機能オフ
}

/* ===== ユーティリティ ===== */
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

/* ===== ジェスチャ：右→左スワイプでめくる ===== */
let touchStartX = null;
$("#book-area")?.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
});
$("#book-area")?.addEventListener("touchend", (e) => {
  if (touchStartX == null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (dx < -40) flipNext();      // 右→左
  else if (dx > 40) flipPrev();  // 左→右（戻る）
  touchStartX = null;
});

/* ===== バインド ===== */
$("#btn-new").addEventListener("click", openInput);
$("#btn-back").addEventListener("click", () => showView("view-home"));
$("#btn-account")?.addEventListener("click", () => showView("view-account"));
$("#btn-account-back")?.addEventListener("click", () => showView("view-home"));
$("#btn-settings")?.addEventListener("click", () => showView("view-settings"));
$("#btn-settings-back")?.addEventListener("click", () => showView("view-home"));
$("#settings-account")?.addEventListener("click", () => showView("view-account"));
$("#settings-export")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `okotoba-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$("#settings-clear")?.addEventListener("click", () => {
  if (!confirm("すべての言葉を削除します。よろしいですか？")) return;
  if (!confirm("本当に削除します。元に戻せません。")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.entries = []; state.pageIndex = 0;
  renderBook();
  alert("削除しました。");
  showView("view-home");
});
$("#form-account")?.addEventListener("submit", (e) => {
  e.preventDefault();
  alert("登録機能は近日対応予定です。");
});

/* ===== JS ↔ Swift ブリッジ ===== */
const isIOS = !!window.webkit?.messageHandlers?.okotoba;
function nativeCall(payload) {
  return new Promise((resolve) => {
    if (!isIOS) return resolve({ ok: false, error: "not_ios" });
    window.__okotobaCallback = (res) => resolve(res);
    window.webkit.messageHandlers.okotoba.postMessage(payload);
  });
}

// Apple Sign In ボタン
$("#btn-apple")?.addEventListener("click", async () => {
  if (!isIOS) {
    alert("Sign in with Apple は iPhone アプリでご利用いただけます。");
    return;
  }
  const r = await nativeCall({ action: "signInWithApple" });
  if (r.ok) {
    alert("ようこそ" + (r.name ? "、" + r.name : "") + "！");
    showView("view-home");
    // 初回サインイン後にクラウドから取り込み
    await syncPullIfSignedIn();
    // ローカルに既にある言葉もサーバへ送る
    await syncPushIfSignedIn();
  } else {
    alert("サインインがキャンセルされました。");
  }
});

// 起動時：iOS かつ何らかのキャッシュトークンを持っていれば pull を試みる
if (isIOS) {
  setTimeout(() => syncPullIfSignedIn(), 1500);
}

// 設定: 通知トグル
async function refreshNotifyToggle() {
  const t = $("#settings-notify-toggle");
  if (!t) return;
  const on = localStorage.getItem("okotoba.notify") === "1";
  t.checked = on;
}
$("#settings-notify-toggle")?.addEventListener("change", async (e) => {
  const on = e.target.checked;
  if (on) {
    const r = await nativeCall({ action: "scheduleNotification", hour: 8, minute: 0 });
    if (r.ok) {
      localStorage.setItem("okotoba.notify", "1");
      alert("毎朝8:00に今日の言葉をお届けします。");
    } else {
      e.target.checked = false;
      alert(isIOS ? "通知が許可されていません。設定アプリからオンにしてください。" : "通知は iPhone アプリでご利用いただけます。");
    }
  } else {
    await nativeCall({ action: "cancelNotification" });
    localStorage.setItem("okotoba.notify", "0");
  }
});
refreshNotifyToggle();
$("#btn-save").addEventListener("click", handleSave);
$("#form-entry").addEventListener("submit", handleSave);
// 表紙：タップで開いて「今日の名言」を表示
function pickTodayIndex() {
  if (state.entries.length === 0) return 0;
  const d = new Date();
  const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  const idx = seed % state.entries.length;
  return state.entries.length - 1 - idx; // newest順表示なので反転
}
function openCover() {
  const cover = $("#book-cover");
  if (!cover || cover.classList.contains("opened")) return;
  state.pageIndex = pickTodayIndex();
  renderBook();
  cover.classList.add("opened");
}
$("#book-cover")?.addEventListener("click", openCover);

// 表紙に戻る（本を閉じる）
function closeCover() {
  const cover = $("#book-cover");
  if (!cover) return;
  cover.classList.remove("opened");
  state.pageIndex = 0;
  renderBook();
}
$("#btn-close-book")?.addEventListener("click", closeCover);

// 紙をめくる：ページの右半分タップで次へ、左半分で戻る
$("#book-area").addEventListener("click", (e) => {
  if (e.target.closest(".fab,.icon-btn,.text-btn,.book-cover")) return;
  const rect = $("#book-area").getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x > rect.width / 2) flipNext(); else flipPrev();
});
$("#btn-search").addEventListener("click", () => {
  const q = prompt("検索したい言葉:");
  if (!q) return;
  const i = state.entries.findIndex(e => (e.text + " " + (e.source||"")).includes(q));
  if (i < 0) { alert("見つかりませんでした。"); return; }
  // 新しい順に表示しているので index を反転
  state.pageIndex = state.entries.length - 1 - i;
  renderBook();
});

/* 初期化 */
renderBook();

/* プレビュー（LP用）— ?preview=1 もしくは #preview */
if (new URLSearchParams(location.search).get("preview") === "1" ||
    location.hash === "#preview") {
  document.documentElement.classList.add("is-preview");
  // 表紙を 1.5 秒後に自動で開ける
  setTimeout(() => {
    if (state.entries.length > 0) openCover();
  }, 1500);
}
