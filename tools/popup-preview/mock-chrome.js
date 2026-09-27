/* A mock of the chrome.* APIs the popup uses, so every popup state can be
   rendered without a capture running. Patches nothing on disk — serve.mjs
   injects this into a copy of dist/.

   Query params:
     s=disconnected|connected|lost   connection state
     pitch=<n>                       semitones
     bypass=1                        bypass path
     formant=1                       preserve formants
     accom=1                         accompaniment mode
     dead=1                          engine failed to start -> passthrough route
     yt=1                            active tab is youtube.com (shows the volume panel)
     div=1                           audio belongs to another tab (divergence banner)
     mem=1                           this page has a stored record
     nofind=1                        YouTube content script reports no <video>
     fail=<msg>                      REQUEST_CAPTURE fails with this message
     hold=<ms>                       REQUEST_CAPTURE takes this long
     title=<text>                    active tab title
     lang=<tag>                      browser UI language, e.g. en-US / ja-JP /
                                    zh-TW. Defaults to zh-TW. With accept=1 this
                                    sets the preferred-languages list instead. */
(function () {
  var p = new URLSearchParams(location.search);
  var mode = p.get("s") || "disconnected";
  var onYt = p.get("yt") === "1";
  var diverge = p.get("div") === "1";
  var pitch = Number(p.get("pitch") || 0);
  var activePage = onYt
    ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    : "https://www.bilibili.com/video/BV1xx411c7mD";
  var activeTab = {
    id: 1,
    title: p.get("title") || (onYt ? "【升 key 練唱版】經情歌 完整伴奏 - YouTube" : "Bilibili 影片"),
    url: activePage,
  };

  var capture = {
    ok: true,
    state: {
      ready: true,
      // lost 走真實路徑：擷取遺失是連線中被推送的狀態（initializePopup 只在
      // connected 或 captureLost 時套用，而 setConnected(false) 會清掉 lost）。
      connected: mode === "connected" || mode === "lost",
      captureLost: mode === "lost",
      pitch: pitch,
      bypass: p.get("bypass") === "1",
      preserveFormants: p.get("formant") === "1",
      accompanimentMode: p.get("accom") === "1",
      // dead=1 模擬引擎未啟動：圖退回直通，介面誠實報「未處理」。
      route: p.get("bypass") === "1"
        ? "bypass"
        : (p.get("accom") === "1" ? "accompaniment" : (p.get("dead") === "1" ? "passthrough" : "signalsmith")),
      tabId: diverge ? 7 : 1,
      page: diverge ? "https://www.youtube.com/watch?v=OTHERPAGE" : activePage,
    },
  };

  var store = {};
  // 語系：預設 zh-TW，所以沒有 lang= 時預覽維持繁中，圖片才可重現。
  var uiLang = p.get("lang") || "zh-TW";
  var acceptLangs = p.get("accept") === "1" ? [uiLang] : [];
  if (p.get("mem") === "1") {
    // 頁面記憶：此頁已有稀疏記錄（page: 前綴 + pageKey）
    store["page:https://www.youtube.com/watch?v=dQw4w9WgXcQ"] = { pitch: pitch };
  }
  var failMsg = p.get("fail");
  var hold = Number(p.get("hold") || 0);

  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage: function (msg, cb) {
        var respond = function (r) {
          setTimeout(function () {
            cb && cb(r);
          }, 25);
        };
        switch (msg.type) {
          case "GET_STATE":
            respond(capture);
            break;
          case "REQUEST_CAPTURE":
            if (failMsg) {
              respond({ ok: false, error: failMsg });
              break;
            }
            if (hold) {
              setTimeout(function () {
                capture.state.connected = true;
                capture.state.tabId = diverge ? 7 : 1;
                capture.state.page = diverge ? "https://www.youtube.com/watch?v=OTHERPAGE" : activePage;
                cb && cb({ ok: true });
              }, hold);
              break;
            }
            capture.state.connected = true;
            respond({ ok: true });
            break;
          case "RELEASE_CAPTURE":
            capture.state.connected = false;
            respond({ ok: true });
            break;
          case "SET_PITCH":
            capture.state.pitch = msg.value.semitones;
            respond({ ok: true });
            break;
          case "SET_BYPASS":
            capture.state.bypass = msg.value.active;
            respond({ ok: true });
            break;
          case "SET_FORMANTS":
            capture.state.preserveFormants = msg.value.preserve;
            respond({ ok: true });
            break;
          case "SET_ACCOMPANIMENT":
            capture.state.accompanimentMode = msg.value.enabled;
            respond({ ok: true });
            break;
          default:
            respond({ ok: true });
        }
      },
    },
    // Only the two locale-reading methods exist: the extension never calls
    // getMessage, because its copy lives in its own catalog. `lang=` sets the
    // UI language; `accept=1` sets the preferred-languages list instead, which
    // is how the popup prefers a browsing language over a browser UI language.
    i18n: {
      getUILanguage: function () {
        return uiLang;
      },
      getAcceptLanguages: function () {
        return Promise.resolve(acceptLangs);
      },
    },
    tabs: {
      query: function (q, cb) {
        setTimeout(function () {
          cb([activeTab]);
        }, 8);
      },
      get: function (id, cb) {
        setTimeout(function () {
          cb({ id: id, title: diverge ? "另一個分頁的影片｜演唱會 LIVE - YouTube" : activeTab.title });
        }, 8);
      },
      sendMessage: function (tabId, msg, cb) {
        setTimeout(function () {
          if (msg.type === "YT_VOLUME_GET")
            cb({ ok: true, found: p.get("nofind") !== "1", volume: 78, muted: false });
          else if (msg.type === "YT_VOLUME_SET") cb({ ok: true });
          else cb({ ok: false, error: "unexpected message " + msg.type });
        }, 8);
      },
    },
    storage: {
      local: {
        get: function (keys, cb) {
          var out = {};
          keys.forEach(function (k) {
            if (k in store) out[k] = store[k];
          });
          setTimeout(function () {
            cb(out);
          }, 4);
        },
        set: function (vals, cb) {
          Object.assign(store, vals);
          setTimeout(function () {
            cb && cb();
          }, 4);
        },
        remove: function (keys, cb) {
          keys.forEach(function (k) {
            delete store[k];
          });
          setTimeout(function () {
            cb && cb();
          }, 4);
        },
      },
    },
  };

  // Keep the capture at 400px so screenshots frame the popup itself.
  document.documentElement.style.width = "400px";
  document.documentElement.style.background = "#0a0a0a";
})();
