// 御言葉台帳 — MVP
const STORAGE_KEY = "mikotoba.entries.v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  entries: load(),
  pageIndex: 0,
  photoDataUrl: null,
};

/* ===== JS ↔ Swift ブリッジ ===== */
const isIOS = !!window.webkit?.messageHandlers?.okotoba;
function nativeCall(payload) {
  return new Promise((resolve) => {
    if (!isIOS) return resolve({ ok: false, error: "not_ios" });
    window.__okotobaCallback = (res) => resolve(res);
    window.webkit.messageHandlers.okotoba.postMessage(payload);
  });
}

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
        <div class="page-logo" aria-hidden="true">御</div>
      </div>
      <div class="page-stamp">${e.category || "自分"}</div>
    `;
    book.appendChild(page);
  });

  indicator.textContent = `${Math.min(state.pageIndex + 1, entries.length)} / ${entries.length}`;
  // テキストがページに収まるように自動でフォントサイズ調整
  requestAnimationFrame(autoFitAllPages);
}

/* ページ内テキストが溢れないように自動スケール
   縦書きなので「列数」と「列の高さ」両方をチェック */
function autoFitPage(pageEl) {
  const inner = pageEl.querySelector(".page-inner");
  const text = pageEl.querySelector(".page-text");
  if (!inner || !text) return;
  // リセット
  text.style.fontSize = "";
  text.style.maxWidth = "";
  text.style.letterSpacing = "";
  const baseSize = 24;
  let size = baseSize;
  let maxWidth = 65;       // %（縦書き時の幅 = 列方向）
  // 縦書きの「収まり」は、scrollHeight > clientHeight ではなく
  // scrollWidth > clientWidth で測る（vertical-rl のため）
  let guard = 0;
  while (
    (text.scrollWidth > inner.clientWidth - 4 || text.scrollHeight > inner.clientHeight - 4)
    && size > 11
    && guard++ < 30
  ) {
    size -= 1;
    text.style.fontSize = size + "px";
    if (size < 18) {
      maxWidth = Math.min(95, maxWidth + 4);
      text.style.maxWidth = maxWidth + "%";
    }
    if (size < 14) {
      text.style.letterSpacing = "0.04em";
      text.style.lineHeight = "1.7";
    }
  }
}
function autoFitAllPages() {
  document.querySelectorAll(".page").forEach(autoFitPage);
}
window.addEventListener("resize", () => requestAnimationFrame(autoFitAllPages));

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

  // AI 解析（任意）— 失敗しても保存は続行（最大3秒でタイムアウト）
  try {
    const ai = await Promise.race([
      analyzeWithAI(entry),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ai_timeout")), 3000)),
    ]);
    if (ai) entry.ai = ai;
  } catch (err) {
    console.warn("AI解析スキップ:", err);
  }

  state.entries.push(entry);
  save();
  state.pageIndex = 0;
  renderBook();
  showView("view-home");

  // 計測：本文・出典は送らず、種類とメタ情報のみ
  window.OkotobaAnalytics?.track("entry_created", {
    category: entry.category,
    has_photo: !!entry.photo,
    has_source: !!entry.source,
    text_length_bucket: bucketLen(entry.text.length),
    via: state._lastInputMethod || "text",
  });
  state._lastInputMethod = null;

  // クラウド同期（サインイン済みなら）— バックグラウンドで実行、失敗しても無視
  syncPushIfSignedIn();
}

function bucketSizeKb(bytes) {
  const kb = Math.round(bytes / 1024);
  if (kb < 100) return "0-99";
  if (kb < 300) return "100-299";
  if (kb < 600) return "300-599";
  if (kb < 1000) return "600-999";
  return "1000+";
}
function bucketLen(n) {
  if (n < 20) return "0-19";
  if (n < 50) return "20-49";
  if (n < 100) return "50-99";
  if (n < 200) return "100-199";
  return "200+";
}

/* ===== クラウド同期 ===== */
async function syncPushIfSignedIn() {
  if (!isIOS) return;
  try {
    // 同期前に各エントリのサイズチェック。1MB超の写真は同期から除外。
    const sanitized = state.entries.map(e => {
      if (e.photo && e.photo.length > 1_000_000) {
        return { ...e, photo: null, _photoOmitted: true };
      }
      return e;
    });
    await nativeCall({ action: "syncPush", entries: sanitized });
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
// 写真は最大幅1280pxにリサイズ、JPEG 0.78でエンコード。
// D1の行サイズ制限と同期負荷を抑える。
async function resizePhoto(file, maxDim = 1280, quality = 0.78) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$("#input-photo")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await resizePhoto(file);
    // 約500KB相当を超える場合はさらに圧縮
    if (dataUrl.length > 700_000) {
      state.photoDataUrl = await resizePhoto(file, 960, 0.7);
    } else {
      state.photoDataUrl = dataUrl;
    }
    $("#photo-img").src = state.photoDataUrl;
    $("#photo-preview").hidden = false;
    state._lastInputMethod = "photo";
    window.OkotobaAnalytics?.track("photo_attached", { size_kb_bucket: bucketSizeKb(state.photoDataUrl.length) });
  } catch (err) {
    console.warn("写真の読み込みに失敗:", err);
    alert("写真の読み込みに失敗しました。");
  }
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
  state._lastInputMethod = "voice";
  window.OkotobaAnalytics?.track("voice_input_started");
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
  window.OkotobaAnalytics?.track("export_used", { count_bucket: bucketCountSimple(state.entries.length) });
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
  if (isIOS) {
    $("#btn-apple")?.click();
  } else {
    showView("view-home");
  }
});

/* ===== サインイン状態のUI反映 ===== */
async function refreshAuthUI() {
  let signedIn = false;
  let name = null;
  if (isIOS) {
    try {
      const r = await nativeCall({ action: "isSignedIn" });
      signedIn = !!(r && r.ok);
      name = r?.name || null;
    } catch {}
  }
  const label = $("#settings-account-label");
  const signoutBtn = $("#settings-signout");
  const deleteBtn = $("#settings-delete-account");
  const accountBtn = $("#settings-account");
  if (signedIn) {
    if (label) label.textContent = name ? `${name} としてサインイン中` : "サインイン中";
    if (accountBtn) accountBtn.disabled = true;
    if (signoutBtn) signoutBtn.hidden = false;
    if (deleteBtn) deleteBtn.hidden = false;
  } else {
    if (label) label.textContent = "アカウント登録 / ログイン";
    if (accountBtn) accountBtn.disabled = false;
    if (signoutBtn) signoutBtn.hidden = true;
    if (deleteBtn) deleteBtn.hidden = true;
  }
  // Web版ではアカウント画面に注意書きを表示
  const webNote = $("#acct-web-note");
  if (webNote) webNote.hidden = isIOS;
  // ヘッダーのアカウント登録リンクはサインイン済みなら隠す
  const headerAcct = $("#btn-account");
  if (headerAcct) headerAcct.hidden = signedIn;
}

$("#settings-signout")?.addEventListener("click", async () => {
  if (!confirm("サインアウトしますか？\n端末上の言葉は残ります。")) return;
  await nativeCall({ action: "signOut" });
  window.OkotobaAnalytics?.track("signed_out");
  alert("サインアウトしました。");
  refreshAuthUI();
});

$("#settings-delete-account")?.addEventListener("click", async () => {
  if (!confirm("アカウントを削除しますか？\nクラウド上のデータはすべて削除されます。")) return;
  if (!confirm("本当に削除します。元に戻せません。")) return;
  const r = await nativeCall({ action: "deleteAccount" });
  if (r && r.ok) {
    window.OkotobaAnalytics?.track("account_deleted");
    alert("アカウントを削除しました。");
    refreshAuthUI();
    showView("view-home");
  } else {
    alert("削除に失敗しました。通信状況をご確認ください。");
  }
});

// 設定画面を開いた時 & 起動時に状態反映
$("#btn-settings")?.addEventListener("click", refreshAuthUI);
refreshAuthUI();

// Apple Sign In ボタン
$("#btn-apple")?.addEventListener("click", async () => {
  if (!isIOS) {
    alert("Sign in with Apple は iPhone アプリでご利用いただけます。");
    return;
  }
  const r = await nativeCall({ action: "signInWithApple" });
  if (r.ok) {
    window.OkotobaAnalytics?.track("signin_completed", { method: "apple" });
    alert("ようこそ" + (r.name ? "、" + r.name : "") + "！");
    showView("view-home");
    // 初回サインイン後にクラウドから取り込み
    await syncPullIfSignedIn();
    // ローカルに既にある言葉もサーバへ送る
    await syncPushIfSignedIn();
  } else {
    window.OkotobaAnalytics?.track("signin_cancelled");
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
      window.OkotobaAnalytics?.track("notification_enabled");
      alert("毎朝8:00に今日の言葉をお届けします。");
    } else {
      e.target.checked = false;
      alert(isIOS ? "通知が許可されていません。設定アプリからオンにしてください。" : "通知は iPhone アプリでご利用いただけます。");
    }
  } else {
    await nativeCall({ action: "cancelNotification" });
    localStorage.setItem("okotoba.notify", "0");
    window.OkotobaAnalytics?.track("notification_disabled");
  }
});
refreshNotifyToggle();

// プライバシー: 分析オプトアウト
function refreshAnalyticsToggle() {
  const t = $("#settings-analytics-toggle");
  if (!t || !window.OkotobaAnalytics) return;
  t.checked = !window.OkotobaAnalytics.isOptedOut();
}
$("#settings-analytics-toggle")?.addEventListener("change", (e) => {
  if (!window.OkotobaAnalytics) return;
  if (e.target.checked) window.OkotobaAnalytics.optIn();
  else window.OkotobaAnalytics.optOut();
});
refreshAnalyticsToggle();
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
  window.OkotobaAnalytics?.track("book_opened", {
    entries_count_bucket: bucketCountSimple(state.entries.length),
  });
}
function bucketCountSimple(n) {
  if (n === 0) return "0";
  if (n < 5) return "1-4";
  if (n < 20) return "5-19";
  if (n < 50) return "20-49";
  return "50+";
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
/* ===== 検索オーバーレイ ===== */
function renderSearchResults(q) {
  const list = $("#search-results");
  const empty = $("#search-empty");
  list.innerHTML = "";
  const query = (q || "").trim();
  if (!query) { empty.style.display = "none"; return; }
  const hits = state.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.text + " " + (e.source || "")).toLowerCase().includes(query.toLowerCase()));
  if (hits.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";
  hits.slice(0, 50).forEach(({ e, i }) => {
    const li = document.createElement("li");
    li.innerHTML = `<div>${escapeHtml(e.text).slice(0, 120)}</div>` +
      (e.source ? `<div class="src">— ${escapeHtml(e.source)}</div>` : "");
    li.addEventListener("click", () => {
      state.pageIndex = state.entries.length - 1 - i;
      $("#book-cover")?.classList.add("opened");
      renderBook();
      showView("view-home");
    });
    list.appendChild(li);
  });
}
$("#btn-search").addEventListener("click", () => {
  $("#search-input").value = "";
  $("#search-results").innerHTML = "";
  $("#search-empty").style.display = "none";
  showView("view-search");
  setTimeout(() => $("#search-input").focus(), 50);
  window.OkotobaAnalytics?.track("search_opened");
});
$("#btn-search-back")?.addEventListener("click", () => showView("view-home"));
$("#search-input")?.addEventListener("input", (e) => renderSearchResults(e.target.value));

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
