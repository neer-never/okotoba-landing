/* 御言葉台帳 — リテンション計測
 *
 * 設計原則:
 *   - PIIは一切送らない（本文・出典・写真・氏名・メールは対象外）
 *   - 匿名デバイスIDのみ（localStorage）
 *   - DNT / opt-out を尊重
 *   - 失敗してもアプリの動作に影響を与えない
 *
 * 計測対象:
 *   app_open / entry_created / entry_viewed / book_opened /
 *   search_used / signin_completed / signout / account_deleted /
 *   notification_enabled / notification_disabled / export_used
 */

(function () {
  // ★ Amplitude API Key — デプロイ前に差し替え。
  //   未設定（"YOUR_AMPLITUDE_KEY"）の場合は計測完全停止。
  const AMPLITUDE_API_KEY = "YOUR_AMPLITUDE_KEY";

  const OPT_OUT_KEY = "okotoba.analytics.optout";
  const DEVICE_KEY = "okotoba.analytics.deviceId";

  const isDisabled = () =>
    AMPLITUDE_API_KEY === "YOUR_AMPLITUDE_KEY" ||
    navigator.doNotTrack === "1" ||
    window.doNotTrack === "1" ||
    localStorage.getItem(OPT_OUT_KEY) === "1";

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           "anon-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  // Amplitude SDK を遅延ロード
  let loadedPromise = null;
  function loadAmplitude() {
    if (loadedPromise) return loadedPromise;
    if (isDisabled()) {
      loadedPromise = Promise.resolve(null);
      return loadedPromise;
    }
    loadedPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz";
      s.async = true;
      s.onload = () => {
        try {
          window.amplitude.init(AMPLITUDE_API_KEY, undefined, {
            deviceId: getDeviceId(),
            defaultTracking: false,         // 自動トラッキング全停止
            minIdLength: 1,
            serverZone: "US",
            trackingOptions: {
              ipAddress: false,             // IPは送らない
              language: true,
              platform: true,
            },
          });
          resolve(window.amplitude);
        } catch {
          resolve(null);
        }
      };
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return loadedPromise;
  }

  // 公開API
  window.OkotobaAnalytics = {
    track(eventName, props) {
      if (isDisabled()) return;
      // propsに本文等の長文があれば落とす安全策
      const safe = sanitizeProps(props || {});
      loadAmplitude().then((amp) => {
        try { amp && amp.track(eventName, safe); } catch {}
      });
    },
    optOut() {
      localStorage.setItem(OPT_OUT_KEY, "1");
      try { window.amplitude && window.amplitude.setOptOut(true); } catch {}
    },
    optIn() {
      localStorage.removeItem(OPT_OUT_KEY);
      try { window.amplitude && window.amplitude.setOptOut(false); } catch {}
    },
    isOptedOut() {
      return localStorage.getItem(OPT_OUT_KEY) === "1";
    },
    isEnabled() {
      return !isDisabled();
    },
  };

  // 長文・URLっぽい値・100文字超を遮断（誤って本文を送ってしまうのを防ぐ）
  function sanitizeProps(props) {
    const out = {};
    for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined) continue;
      if (typeof v === "number" || typeof v === "boolean") { out[k] = v; continue; }
      if (typeof v === "string") {
        if (v.length > 80) continue;            // 長文は捨てる
        if (/https?:\/\//.test(v)) continue;    // URLも捨てる
        out[k] = v;
      }
    }
    return out;
  }

  // 初回ロード時に app_open を送る
  if (!isDisabled()) {
    const isPWA = window.matchMedia("(display-mode: standalone)").matches ||
                  window.navigator.standalone === true;
    const isIOSNative = !!window.webkit?.messageHandlers?.okotoba;
    window.OkotobaAnalytics.track("app_open", {
      platform: isIOSNative ? "ios_native" : (isPWA ? "pwa" : "web"),
      entries_count_bucket: bucketCount(loadEntriesCount()),
    });
  }

  function loadEntriesCount() {
    try {
      const v = JSON.parse(localStorage.getItem("mikotoba.entries.v1"));
      return Array.isArray(v) ? v.length : 0;
    } catch { return 0; }
  }
  // 件数は数値そのままより「区間」で送る（個人特定リスク低減）
  function bucketCount(n) {
    if (n === 0) return "0";
    if (n < 5) return "1-4";
    if (n < 20) return "5-19";
    if (n < 50) return "20-49";
    if (n < 100) return "50-99";
    return "100+";
  }
})();
