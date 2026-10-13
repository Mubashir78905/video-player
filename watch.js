/* ============================================================
   PERSONAL VIDEO LIBRARY — watch.js
   Full player logic for watch.html:
     - Loads videos.json, finds current video, builds "Up next"
     - Custom controls: play/pause, seek, 10s/30s skip, volume,
       speed, quality, fullscreen, theater, mini player, PiP
     - Keyboard shortcuts, auto-hide, state preservation
   ============================================================ */

(function () {
  "use strict";

  /* ==========================================================
     CONFIG
     ========================================================== */
  const CONFIG = {
    videosJsonPath: "videos.json",
    videosFolder: "videos",
    controlsHideDelay: 2800,
    skipShort: 10,
    skipLong: 30,
    speeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    qualityTags: [
      { tag: "2160p", label: "4K" },
      { tag: "1440p", label: "1440p" },
      { tag: "1080p", label: "1080p" },
      { tag: "720p",  label: "720p" },
      { tag: "480p",  label: "480p" },
      { tag: "360p",  label: "360p" },
      { tag: "240p",  label: "240p" },
      { tag: "144p",  label: "144p" },
    ],
  };

  /* ==========================================================
     STATE
     ========================================================== */
  const state = {
    folders: [],
    currentFolder: null,
    currentFile: null,
    currentVideo: null,         // the video entry we're playing
    qualities: [],              // [{ label, file }] — sorted best-first
    currentQualityIndex: 0,
    upNext: [],                 // [{ folder, file, title }] — ordered
    upNextIndex: -1,
    speed: 1,
    volume: 1,
    muted: false,
    theater: false,
    mini: false,
    controlsVisible: true,
    idleTimer: null,
    settingsOpen: false,
    seeking: false,
    miniDrag: null,
  };

  const LS_SPEED = "pvp_speed";
  const LS_VOLUME = "pvp_volume";
  const LS_MUTED = "pvp_muted";

  /* ==========================================================
     DOM CACHE
     ========================================================== */
  const dom = {};

  function cacheDom() {
    // Player shell
    dom.playerShell     = document.getElementById("playerShell");
    dom.playerWrapper   = document.getElementById("playerWrapper");
    dom.videoPlayer     = document.getElementById("videoPlayer");
    dom.bigPlayBtn      = document.getElementById("bigPlayBtn");
    dom.loadingIndicator= document.getElementById("loadingIndicator");
    dom.errorOverlay    = document.getElementById("errorOverlay");
    dom.errorMessage    = document.getElementById("errorMessage");
    dom.dismissError    = document.getElementById("dismissError");
    dom.customControls  = document.getElementById("customControls");

    // Progress
    dom.progressContainer = document.getElementById("progressContainer");
    dom.progressBuffer    = document.getElementById("progressBuffer");
    dom.progressFill      = document.getElementById("progressFill");
    dom.progressHandle    = document.getElementById("progressHandle");
    dom.progressTooltip   = document.getElementById("progressTooltip");

    // Buttons
    dom.playPauseBtn   = document.getElementById("playPauseBtn");
    dom.playIcon       = document.getElementById("playIcon");
    dom.pauseIcon      = document.getElementById("pauseIcon");
    dom.prevBtn        = document.getElementById("prevBtn");
    dom.nextBtn        = document.getElementById("nextBtn");
    dom.muteBtn        = document.getElementById("muteBtn");
    dom.volumeUpIcon   = document.getElementById("volumeUpIcon");
    dom.volumeOffIcon  = document.getElementById("volumeOffIcon");
    dom.volumeSlider   = document.getElementById("volumeSlider");
    dom.timeDisplay    = document.getElementById("timeDisplay");
    dom.back30Btn      = document.getElementById("back30Btn");
    dom.back10Btn      = document.getElementById("back10Btn");
    dom.forward10Btn   = document.getElementById("forward10Btn");
    dom.forward30Btn   = document.getElementById("forward30Btn");
    dom.speedBtn       = document.getElementById("speedBtn");
    dom.qualityBtn     = document.getElementById("qualityBtn");
    dom.settingsBtn    = document.getElementById("settingsBtn");
    dom.theaterBtn     = document.getElementById("theaterBtn");
    dom.miniBtn        = document.getElementById("miniBtn");
    dom.pipBtn         = document.getElementById("pipBtn");
    dom.fullscreenBtn  = document.getElementById("fullscreenBtn");
    dom.fullscreenIcon = document.getElementById("fullscreenIcon");

    // Meta
    dom.videoTitle     = document.getElementById("videoTitle");
    dom.videoDuration  = document.getElementById("videoDuration");
    dom.videoFolder    = document.getElementById("videoFolder");

    // Up next
    dom.upNextTitle    = document.getElementById("upNextTitle");
    dom.upNextList     = document.getElementById("upNextList");
    dom.watchSidebar   = document.getElementById("watchSidebar");
    dom.watchLayout    = document.getElementById("watchLayout");

    // Settings popup
    dom.settingsPopup  = document.getElementById("settingsPopup");
    dom.speedOptionsPopup   = document.getElementById("speedOptionsPopup");
    dom.qualitySection = document.getElementById("qualitySection");
    dom.qualityOptionsPopup = document.getElementById("qualityOptionsPopup");
    dom.qualityNote    = document.getElementById("qualityNote");

    // Mini
    dom.miniPlayer     = document.getElementById("miniPlayer");
    dom.miniVideo      = document.getElementById("miniVideo");
    dom.miniTitle      = document.getElementById("miniTitle");
    dom.miniPlayPause  = document.getElementById("miniPlayPause");
    dom.miniRestore    = document.getElementById("miniRestore");
    dom.miniClose      = document.getElementById("miniClose");
    dom.miniDragHandle = document.getElementById("miniDragHandle");

    // Toast
    dom.toast          = document.getElementById("toast");

    // Top bar (search disabled on watch page, but we keep menu toggle)
    dom.menuToggle     = document.getElementById("menuToggle");
  }

  /* ==========================================================
     UTILITIES
     ========================================================== */

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function stripExtension(name) {
    if (!name) return "";
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  }

  function detectQuality(filename) {
    if (!filename) return null;
    const nameNoExt = stripExtension(filename);
    for (const q of CONFIG.qualityTags) {
      const re = new RegExp("[_\\-.\\s(]" + q.tag + "(?=$|[)\\s_.\\-])", "i");
      const m = nameNoExt.match(re);
      if (m) return { base: nameNoExt.slice(0, m.index).trim(), qualityLabel: q.label };
      const re2 = new RegExp(q.tag + "$", "i");
      if (re2.test(nameNoExt)) return { base: nameNoExt.replace(re2, "").trim(), qualityLabel: q.label };
    }
    return null;
  }

  function videoUrl(folder, file) {
    const enc = encodeURIComponent;
    return folder
      ? `${CONFIG.videosFolder}/${enc(folder)}/${enc(file)}`
      : `${CONFIG.videosFolder}/${enc(file)}`;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, ms = 2500) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove("hidden");
    // force reflow for animation
    void dom.toast.offsetWidth;
    dom.toast.classList.add("show");
    clearTimeout(dom.toast._timer);
    dom.toast._timer = setTimeout(() => {
      dom.toast.classList.remove("show");
      setTimeout(() => dom.toast.classList.add("hidden"), 260);
    }, ms);
  }

  /* ==========================================================
     LOAD videos.json
     ========================================================== */

  async function loadVideosJson() {
    try {
      const res = await fetch(CONFIG.videosJsonPath, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.folders)) throw new Error("bad shape");
      state.folders = data.folders
        .filter((f) => f && typeof f.name === "string" && Array.isArray(f.videos))
        .map((f) => ({
          name: f.name.trim(),
          videos: f.videos
            .filter((v) => v && typeof v.file === "string")
            .map((v) => ({
              file: v.file.trim(),
              title: typeof v.title === "string" ? v.title.trim() : "",
              thumb: typeof v.thumb === "string" ? v.thumb.trim() : "",
            })),
        }))
        .filter((f) => f.name && f.videos.length > 0);
      return true;
    } catch (e) {
      console.error("watch.js: failed to load videos.json", e);
      return false;
    }
  }

  /* ==========================================================
     RESOLVE CURRENT VIDEO FROM URL
     ========================================================== */

  function readParams() {
    const p = new URLSearchParams(window.location.search);
    return {
      folder: p.get("folder") || null,
      file: p.get("file") || null,
      qualities: p.get("qualities") || null, // "1080p::file.mp4|720p::file2.mp4"
    };
  }

  function findVideoEntry(folderName, fileName) {
    // If folder specified, search there first
    if (folderName) {
      const folder = state.folders.find((f) => f.name === folderName);
      if (folder) {
        const v = folder.videos.find((x) => x.file === fileName);
        if (v) return { folder, video: v };
      }
    }
    // Fallback: search everywhere
    for (const folder of state.folders) {
      const v = folder.videos.find((x) => x.file === fileName);
      if (v) return { folder, video: v };
    }
    return null;
  }

  /**
   * Build the quality list for the current video.
   * If URL provides qualities param, use it (in order given).
   * Otherwise auto-detect from other videos in the same folder with the same base.
   * Always at least one entry ("Original").
   */
  function buildQualities(entry, folder, urlQualities) {
    const result = [];

    if (urlQualities) {
      // format: "label::file|label::file"
      urlQualities.split("|").forEach((pair) => {
        const [label, file] = pair.split("::");
        if (label && file) result.push({ label: label.trim(), file: file.trim() });
      });
    }

    if (result.length === 0) {
      // Auto-detect from siblings
      const parsed = detectQuality(entry.file);
      if (parsed) {
        const baseKey = parsed.base.toLowerCase();
        // include current + all siblings with matching base
        folder.videos.forEach((sib) => {
          const sibParsed = detectQuality(sib.file);
          if (sibParsed && sibParsed.base.toLowerCase() === baseKey) {
            result.push({ label: sibParsed.qualityLabel, file: sib.file });
          }
        });
      }
    }

    // If nothing found, single Original
    if (result.length === 0) {
      result.push({ label: "Original", file: entry.file });
    }

    // Ensure current file is present; if not, add it as "Original"
    if (!result.some((q) => q.file === entry.file)) {
      result.push({ label: "Original", file: entry.file });
    }

    // Sort best-first
    result.sort((a, b) => {
      const ai = CONFIG.qualityTags.findIndex((q) => q.label === a.label);
      const bi = CONFIG.qualityTags.findIndex((q) => q.label === b.label);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    return result;
  }

  /* ==========================================================
     BUILD "UP NEXT" LIST
     ========================================================== */

  function buildUpNext(currentFolder, currentFile) {
    const list = [];

    // 1) Videos in the same folder (in folder order), starting from current
    const folder = state.folders.find((f) => f.name === currentFolder);
    if (folder) {
      folder.videos.forEach((v) => {
        list.push({
          folder: folder.name,
          file: v.file,
          title: v.title || stripExtension(v.file),
          thumb: v.thumb || "",
          isCurrent: v.file === currentFile && folder.name === currentFolder,
        });
      });
    }

    // 2) Videos from other folders (in folders order, then video order)
    state.folders.forEach((f) => {
      if (f.name === currentFolder) return;
      f.videos.forEach((v) => {
        list.push({
          folder: f.name,
          file: v.file,
          title: v.title || stripExtension(v.file),
          thumb: v.thumb || "",
          isCurrent: false,
        });
      });
    });

    // Find current index
    state.upNextIndex = list.findIndex(
      (x) => x.folder === currentFolder && x.file === currentFile
    );
    return list;
  }

  function renderUpNext() {
    dom.upNextList.innerHTML = "";

    if (state.upNext.length === 0) {
      const empty = document.createElement("div");
      empty.style.color = "var(--text-3)";
      empty.style.fontSize = "13px";
      empty.style.padding = "8px";
      empty.textContent = "No other videos available.";
      dom.upNextList.appendChild(empty);
      return;
    }

    // Section heading: same folder
    const sameFolder = state.upNext.filter((x) => x.folder === state.currentFolder);
    const otherFolders = state.upNext.filter((x) => x.folder !== state.currentFolder);

    if (sameFolder.length > 0) {
      sameFolder.forEach((item) => {
        dom.upNextList.appendChild(buildUpNextItem(item));
      });
    }

    if (otherFolders.length > 0) {
      const divider = document.createElement("div");
      divider.className = "up-next-divider";
      divider.textContent = "More from your library";
      dom.upNextList.appendChild(divider);

      // Group others by folder for readability
      const byFolder = new Map();
      otherFolders.forEach((item) => {
        if (!byFolder.has(item.folder)) byFolder.set(item.folder, []);
        byFolder.get(item.folder).push(item);
      });

      byFolder.forEach((items, folderName) => {
        const label = document.createElement("div");
        label.className = "up-next-divider";
        label.style.borderTop = "none";
        label.style.marginTop = "4px";
        label.style.paddingTop = "6px";
        label.textContent = folderName;
        dom.upNextList.appendChild(label);

        items.forEach((item) => {
          dom.upNextList.appendChild(buildUpNextItem(item));
        });
      });
    }

    // Update heading
    dom.upNextTitle.textContent = state.upNext.length
      ? `Up next (${state.upNext.length})`
      : "Up next";
  }

  function buildUpNextItem(item) {
    const el = document.createElement("div");
    el.className = "up-next-item";
    if (item.isCurrent) el.classList.add("active");

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "up-next-thumb";
    thumbWrap.innerHTML = `
      <div class="thumb-placeholder">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="20" height="16" rx="2" stroke="#666" stroke-width="1.5"/>
          <path d="M10 9l6 3-6 3z" fill="#666"/>
        </svg>
      </div>`;

    // Try thumbnails
    const sources = [];
    if (item.thumb) {
      sources.push(
        item.thumb.startsWith("http") || item.thumb.startsWith("/")
          ? item.thumb
          : videoUrl(item.folder, item.thumb)
      );
    }
    const base = stripExtension(item.file);
    ["jpg", "jpeg", "png", "webp"].forEach((ext) => {
      sources.push(videoUrl(item.folder, `${base}.${ext}`));
    });

    let idx = 0;
    const tryNext = () => {
      if (idx >= sources.length) return;
      const url = sources[idx++];
      const img = new Image();
      img.alt = "";
      img.loading = "lazy";
      img.onload = () => {
        thumbWrap.innerHTML = "";
        thumbWrap.appendChild(img);
      };
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();

    const info = document.createElement("div");
    info.className = "up-next-info";
    info.innerHTML = `
      <div class="up-next-title">${escapeHtml(item.title)}</div>
      <div class="up-next-meta">${escapeHtml(item.folder)}</div>
    `;

    el.appendChild(thumbWrap);
    el.appendChild(info);

    el.addEventListener("click", () => {
      // Preserve time if clicking the currently playing item
      if (item.isCurrent) {
        togglePlayPause();
        return;
      }
      navigateTo(item.folder, item.file);
    });

    return el;
  }

  /* ==========================================================
     NAVIGATE TO A VIDEO
     ========================================================== */

  function navigateTo(folder, file, keepTime) {
    const params = new URLSearchParams();
    if (folder) params.set("folder", folder);
    params.set("file", file);
    // Preserve qualities if we know them and it's the same base
    // (Simple approach: don't pass qualities on navigation — watch page
    //  will auto-detect from siblings, which works the same way.)
    const url = `watch.html?${params.toString()}`;
    if (keepTime) {
      // Save current position for the new video (rare case)
      sessionStorage.setItem("pvp_resume_time", String(dom.videoPlayer.currentTime || 0));
    }
    window.location.href = url;
  }

  /* ==========================================================
     LOAD CURRENT VIDEO INTO PLAYER
     ========================================================== */

  function loadCurrentVideo() {
    const { folder, file, qualities } = readParams();

    if (!file) {
      showError("No video specified in the URL.");
      return false;
    }

    const found = findVideoEntry(folder, file);
    if (!found) {
      showError(`Video "${file}" was not found in videos.json.`);
      return false;
    }

    state.currentFolder = found.folder.name;
    state.currentVideo = found.video;
    state.currentFile = file;

    // Build qualities list
    state.qualities = buildQualities(found.video, found.folder, qualities);
    state.currentQualityIndex = state.qualities.findIndex((q) => q.file === file);
    if (state.currentQualityIndex < 0) state.currentQualityIndex = 0;

    // Update UI meta
    const title = state.currentVideo.title || stripExtension(state.currentVideo.file);
    dom.videoTitle.textContent = title;
    dom.videoFolder.textContent = state.currentFolder;
    document.title = `${title} — My Video Library`;

    // Quality button visibility
    if (state.qualities.length > 1) {
      dom.qualityBtn.classList.remove("hidden");
      dom.qualityBtn.textContent = state.qualities[state.currentQualityIndex].label;
    } else {
      dom.qualityBtn.classList.add("hidden");
    }

    // Build up-next
    state.upNext = buildUpNext(state.currentFolder, state.currentFile);
    renderUpNext();

    // Set source
    const src = videoUrl(state.currentFolder, state.currentVideo.file);
    dom.videoPlayer.src = src;
    dom.videoPlayer.load();

    // Apply stored prefs
    dom.videoPlayer.playbackRate = state.speed;
    dom.videoPlayer.volume = state.volume;
    dom.videoPlayer.muted = state.muted;
    dom.volumeSlider.value = state.muted ? 0 : state.volume;
    updateVolumeIcon();

    // Loading state
    showLoading(true);
    hideError();
    showBigPlay(true);

    // Metadata handler (one-time)
    dom.videoPlayer.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    dom.videoPlayer.addEventListener("error", onPlayerError, { once: true });

    return true;
  }

  function onLoadedMetadata() {
    showLoading(false);
    updateTimeDisplay();
    updateProgressBar();

    // Update video meta duration
    dom.videoDuration.textContent = formatTime(dom.videoPlayer.duration);

    // Restore resume position if set
    const resume = parseFloat(sessionStorage.getItem("pvp_resume_time") || "0");
    if (resume > 0.5 && resume < dom.videoPlayer.duration - 1) {
      try {
        dom.videoPlayer.currentTime = resume;
      } catch (e) {}
      sessionStorage.removeItem("pvp_resume_time");
      showToast(`Resumed from ${formatTime(resume)}`);
    }

    // Autoplay (browsers allow this if user gesture happened)
    dom.videoPlayer.play().catch(() => {
      // Autoplay blocked → show big play button
      showBigPlay(true);
      updatePlayPauseIcon();
    });
  }

  function onPlayerError() {
    showLoading(false);
    showError(
      "Unable to play this video. The file may be missing, in an unsupported " +
      "format, or blocked by the server (check for 404 or CORS errors in DevTools)."
    );
  }

  function showLoading(show) {
    dom.loadingIndicator.classList.toggle("hidden", !show);
  }

  function showError(msg) {
    dom.errorMessage.textContent = msg;
    dom.errorOverlay.classList.remove("hidden");
  }
  function hideError() {
    dom.errorOverlay.classList.add("hidden");
  }

  function showBigPlay(show) {
    dom.bigPlayBtn.classList.toggle("hidden", !show);
  }

  /* ==========================================================
     PLAY / PAUSE
     ========================================================== */

  function togglePlayPause() {
    if (!dom.videoPlayer.src) return;
    if (dom.videoPlayer.paused) {
      dom.videoPlayer.play().catch(() => {});
    } else {
      dom.videoPlayer.pause();
    }
  }

  function updatePlayPauseIcon() {
    const paused = dom.videoPlayer.paused;
    dom.playIcon.classList.toggle("hidden", !paused);
    dom.pauseIcon.classList.toggle("hidden", paused);
    // Big play visible only when paused and currentTime is near 0 OR user paused
    if (paused && !dom.videoPlayer.ended) {
      showBigPlay(dom.videoPlayer.currentTime < 0.5);
    } else {
      showBigPlay(false);
    }
    // Sync mini
    if (dom.miniVideo.src) {
      dom.miniPlayPause.textContent = paused ? "▶" : "⏸";
    }
  }

  /* ==========================================================
     TIME / PROGRESS
     ========================================================== */

  function updateTimeDisplay() {
    const cur = dom.videoPlayer.currentTime || 0;
    const dur = dom.videoPlayer.duration || 0;
    dom.timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  }

  function updateProgressBar() {
    const cur = dom.videoPlayer.currentTime || 0;
    const dur = dom.videoPlayer.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    dom.progressFill.style.width = pct + "%";
    dom.progressHandle.style.left = pct + "%";

    // Buffered
    try {
      if (dom.videoPlayer.buffered.length > 0) {
        const bufEnd = dom.videoPlayer.buffered.end(dom.videoPlayer.buffered.length - 1);
        const bufPct = dur > 0 ? (bufEnd / dur) * 100 : 0;
        dom.progressBuffer.style.width = bufPct + "%";
      } else {
        dom.progressBuffer.style.width = "0%";
      }
    } catch (e) {
      dom.progressBuffer.style.width = "0%";
    }
  }

  function seekToFraction(frac) {
    const dur = dom.videoPlayer.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const clamped = Math.max(0, Math.min(1, frac));
    try {
      dom.videoPlayer.currentTime = clamped * dur;
    } catch (e) {}
  }

  function seekRelative(deltaSec) {
    const dur = dom.videoPlayer.duration;
    if (!isFinite(dur)) return;
    const next = Math.max(0, Math.min(dur - 0.1, (dom.videoPlayer.currentTime || 0) + deltaSec));
    try {
      dom.videoPlayer.currentTime = next;
    } catch (e) {}
    showToast((deltaSec > 0 ? "+" : "") + deltaSec + "s");
  }

  /* ==========================================================
     VOLUME
     ========================================================== */

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    dom.videoPlayer.volume = state.volume;
    if (state.volume > 0) {
      state.muted = false;
      dom.videoPlayer.muted = false;
    }
    dom.volumeSlider.value = state.volume;
    updateVolumeIcon();
    try { localStorage.setItem(LS_VOLUME, String(state.volume)); } catch (e) {}
    try { localStorage.setItem(LS_MUTED, String(state.muted)); } catch (e) {}
  }

  function toggleMute() {
    state.muted = !state.muted;
    dom.videoPlayer.muted = state.muted;
    updateVolumeIcon();
    try { localStorage.setItem(LS_MUTED, String(state.muted)); } catch (e) {}
    showToast(state.muted ? "Muted" : "Unmuted");
  }

  function updateVolumeIcon() {
    const eff = dom.videoPlayer.muted ? 0 : dom.videoPlayer.volume;
    if (eff === 0) {
      dom.volumeUpIcon.classList.add("hidden");
      dom.volumeOffIcon.classList.remove("hidden");
      dom.volumeSlider.value = 0;
    } else {
      dom.volumeUpIcon.classList.remove("hidden");
      dom.volumeOffIcon.classList.add("hidden");
      dom.volumeSlider.value = eff;
    }
  }

  /* ==========================================================
     PLAYBACK SPEED
     ========================================================== */

  function setSpeed(s) {
    state.speed = s;
    dom.videoPlayer.playbackRate = s;
    dom.speedBtn.textContent = s === 1 ? "1x" : `${s}x`;
    try { localStorage.setItem(LS_SPEED, String(s)); } catch (e) {}
    renderSpeedPopup();
    // Sync mini
    if (dom.miniVideo.src) dom.miniVideo.playbackRate = s;
  }

  function renderSpeedPopup() {
    dom.speedOptionsPopup.innerHTML = "";
    CONFIG.speeds.forEach((s) => {
      const opt = document.createElement("div");
      opt.className = "settings-option" + (s === state.speed ? " active" : "");
      opt.textContent = s === 1 ? "Normal (1x)" : `${s}x`;
      opt.addEventListener("click", () => {
        setSpeed(s);
        closeSettings();
        showToast(`Speed: ${s}x`);
      });
      dom.speedOptionsPopup.appendChild(opt);
    });
  }

  /* ==========================================================
     QUALITY
     ========================================================== */

  function renderQualityPopup() {
    dom.qualityOptionsPopup.innerHTML = "";

    if (state.qualities.length <= 1) {
      dom.qualitySection.style.display = "none";
      dom.qualityNote.textContent = "";
      return;
    }
    dom.qualitySection.style.display = "";

    state.qualities.forEach((q, i) => {
      const opt = document.createElement("div");
      opt.className = "settings-option" + (i === state.currentQualityIndex ? " active" : "");
      opt.textContent = q.label;
      opt.addEventListener("click", () => {
        switchQuality(i);
        closeSettings();
      });
      dom.qualityOptionsPopup.appendChild(opt);
    });

    dom.qualityNote.textContent =
      "Switching quality reloads the video and tries to resume at the same position.";
  }

  function switchQuality(index) {
    if (index === state.currentQualityIndex) return;
    if (index < 0 || index >= state.qualities.length) return;

    const q = state.qualities[index];
    const wasPlaying = !dom.videoPlayer.paused;
    const currentTime = dom.videoPlayer.currentTime || 0;

    state.currentQualityIndex = index;

    // Build new URL — the video files live at videos/<folder>/<file>
    const newSrc = videoUrl(state.currentFolder, q.file);

    // Keep the resume time
    sessionStorage.setItem("pvp_resume_time", String(currentTime));

    // Swap source
    dom.videoPlayer.src = newSrc;
    dom.videoPlayer.load();
    showLoading(true);

    // On loadedmetadata, the standard handler will resume from sessionStorage
    // But we also want to autoplay if it was playing
    dom.videoPlayer.addEventListener("loadedmetadata", () => {
      if (wasPlaying) dom.videoPlayer.play().catch(() => {});
    }, { once: true });

    // Update quality button
    dom.qualityBtn.textContent = q.label;

    // Refresh popup marker
    renderQualityPopup();

    showToast(`Quality: ${q.label}`);
  }

  /* ==========================================================
     FULLSCREEN
     ========================================================== */

  function toggleFullscreen() {
    const el = dom.playerWrapper;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else {
        showToast("Fullscreen is not supported here.");
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function updateFullscreenIcon() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    dom.fullscreenIcon.innerHTML = isFs
      ? `<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>`
      : `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }

  /* ==========================================================
     THEATER MODE
     ========================================================== */

  function toggleTheater() {
    state.theater = !state.theater;
    dom.watchLayout.classList.toggle("theater-mode", state.theater);
    showToast(state.theater ? "Theater mode" : "Normal mode");
  }

  /* ==========================================================
     MINI PLAYER
     ========================================================== */

  function openMini() {
    if (state.mini) return;
    if (!dom.videoPlayer.src) {
      showToast("No video loaded.");
      return;
    }

    const currentTime = dom.videoPlayer.currentTime || 0;
    const wasPlaying = !dom.videoPlayer.paused;

    // Prepare mini source: use the same URL as the main player
    const src = dom.videoPlayer.currentSrc || dom.videoPlayer.src;
    dom.miniVideo.src = src;
    dom.miniVideo.volume = state.volume;
    dom.miniVideo.muted = state.muted;
    dom.miniVideo.playbackRate = state.speed;

    dom.miniVideo.addEventListener("loadedmetadata", () => {
      try {
        dom.miniVideo.currentTime = currentTime;
      } catch (e) {}
    }, { once: true });

    // Hide the main wrapper visually
    dom.playerWrapper.style.visibility = "hidden";

    // Show mini
    dom.miniPlayer.classList.remove("hidden");
    dom.miniTitle.textContent = state.currentVideo
      ? (state.currentVideo.title || stripExtension(state.currentVideo.file))
      : "Mini player";
    state.mini = true;

    if (wasPlaying) {
      dom.miniVideo.play().catch(() => {});
    }

    // Pause main to avoid double audio
    dom.videoPlayer.pause();

    dom.miniPlayPause.textContent = dom.miniVideo.paused ? "▶" : "⏸";

    showToast("Mini player enabled");
  }

  function closeMini() {
    if (!state.mini) return;

    const time = dom.miniVideo.currentTime || 0;
    const wasPlaying = !dom.miniVideo.paused;

    dom.miniVideo.pause();
    dom.miniVideo.removeAttribute("src");
    dom.miniVideo.load();

    dom.miniPlayer.classList.add("hidden");
    dom.playerWrapper.style.visibility = "";
    state.mini = false;

    // Restore main position
    try {
      dom.videoPlayer.currentTime = time;
    } catch (e) {}
    if (wasPlaying) {
      dom.videoPlayer.play().catch(() => {});
    }

    updatePlayPauseIcon();
    showToast("Returned to main player");
  }

  function wireMiniDrag() {
    const handle = dom.miniDragHandle;
    const box = dom.miniPlayer;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const rect = box.getBoundingClientRect();
      state.miniDrag = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      };
      box.style.right = "auto";
      box.style.bottom = "auto";
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!state.miniDrag) return;
      const x = e.clientX - state.miniDrag.offsetX;
      const y = e.clientY - state.miniDrag.offsetY;
      // Clamp within viewport
      const maxX = window.innerWidth - box.offsetWidth;
      const maxY = window.innerHeight - box.offsetHeight;
      box.style.left = Math.max(0, Math.min(maxX, x)) + "px";
      box.style.top = Math.max(0, Math.min(maxY, y)) + "px";
    });

    document.addEventListener("mouseup", () => {
      state.miniDrag = null;
    });

    // Touch drag
    handle.addEventListener("touchstart", (e) => {
      if (e.target.closest("button")) return;
      const t = e.touches[0];
      const rect = box.getBoundingClientRect();
      state.miniDrag = {
        offsetX: t.clientX - rect.left,
        offsetY: t.clientY - rect.top,
      };
      box.style.right = "auto";
      box.style.bottom = "auto";
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (!state.miniDrag) return;
      const t = e.touches[0];
      const x = t.clientX - state.miniDrag.offsetX;
      const y = t.clientY - state.miniDrag.offsetY;
      const maxX = window.innerWidth - box.offsetWidth;
      const maxY = window.innerHeight - box.offsetHeight;
      box.style.left = Math.max(0, Math.min(maxX, x)) + "px";
      box.style.top = Math.max(0, Math.min(maxY, y)) + "px";
    }, { passive: true });

    document.addEventListener("touchend", () => {
      state.miniDrag = null;
    });
  }

  /* ==========================================================
     PICTURE-IN-PICTURE
     ========================================================== */

  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (!document.pictureInPictureEnabled || !dom.videoPlayer.requestPictureInPicture) {
        showToast("Picture-in-Picture is not supported in this browser.");
        return;
      }
      await dom.videoPlayer.requestPictureInPicture();
    } catch (err) {
      console.warn("PiP error:", err);
      showToast("Picture-in-Picture could not be started.");
    }
  }

  /* ==========================================================
     SETTINGS POPUP
     ========================================================== */

  function openSettings() {
    state.settingsOpen = true;
    dom.settingsPopup.classList.remove("hidden");
    renderSpeedPopup();
    renderQualityPopup();
  }
  function closeSettings() {
    state.settingsOpen = false;
    dom.settingsPopup.classList.add("hidden");
  }
  function toggleSettings() {
    if (state.settingsOpen) closeSettings();
    else openSettings();
  }

  /* ==========================================================
     CONTROLS VISIBILITY (auto-hide)
     ========================================================== */

  function showControls() {
    dom.customControls.classList.add("visible");
    state.controlsVisible = true;
    resetIdle();
  }

  function hideControls() {
    if (dom.videoPlayer.paused) return;
    if (state.settingsOpen) return;
    if (state.mini) return;
    dom.customControls.classList.remove("visible");
    state.controlsVisible = false;
  }

  function resetIdle() {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(hideControls, CONFIG.controlsHideDelay);
  }

  /* ==========================================================
     KEYBOARD SHORTCUTS
     ========================================================== */

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  function handleKey(e) {
    if (isTypingTarget(e.target)) return;

    const k = e.key;
    const lower = k.toLowerCase();

    switch (lower) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlayPause();
        showControls();
        return;

      case "arrowleft":
        e.preventDefault();
        seekRelative(-CONFIG.skipShort);
        showControls();
        return;

      case "arrowright":
        e.preventDefault();
        seekRelative(CONFIG.skipShort);
        showControls();
        return;

      case "j":
        e.preventDefault();
        seekRelative(-CONFIG.skipLong);
        showControls();
        return;

      case "l":
        e.preventDefault();
        seekRelative(CONFIG.skipLong);
        showControls();
        return;

      case "arrowup":
        e.preventDefault();
        setVolume(state.volume + 0.05);
        showControls();
        return;

      case "arrowdown":
        e.preventDefault();
        setVolume(state.volume - 0.05);
        showControls();
        return;

      case "m":
        e.preventDefault();
        toggleMute();
        showControls();
        return;

      case "f":
        e.preventDefault();
        toggleFullscreen();
        return;

      case "t":
        e.preventDefault();
        toggleTheater();
        return;

      case "i":
        e.preventDefault();
        togglePiP();
        return;

      case "n":
        e.preventDefault();
        playNext();
        return;

      case "p":
        e.preventDefault();
        playPrev();
        return;

      case "escape":
        if (state.settingsOpen) closeSettings();
        if (state.mini) closeMini();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        return;
    }

    // Number keys 0–9: seek to 0%, 10% … 90%
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      const n = parseInt(k, 10);
      seekToFraction(n / 10);
      showControls();
    }
  }

  /* ==========================================================
     NEXT / PREV
     ========================================================== */

  function playNext() {
    if (state.upNext.length === 0) return;
    let idx = state.upNextIndex + 1;
    if (idx >= state.upNext.length) {
      showToast("End of library.");
      return;
    }
    const item = state.upNext[idx];
    navigateTo(item.folder, item.file, true);
  }

  function playPrev() {
    if (state.upNext.length === 0) return;
    let idx = state.upNextIndex - 1;
    if (idx < 0) {
      showToast("Start of library.");
      return;
    }
    const item = state.upNext[idx];
    navigateTo(item.folder, item.file, true);
  }

  /* ==========================================================
     PROGRESS BAR INTERACTION
     ========================================================== */

  function wireProgress() {
    const container = dom.progressContainer;

    const getFractionFromEvent = (e) => {
      const rect = container.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    };

    const updateTooltip = (e) => {
      const frac = getFractionFromEvent(e);
      const dur = dom.videoPlayer.duration || 0;
      const time = frac * dur;
      const rect = container.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      dom.progressTooltip.style.left = x + "px";
      dom.progressTooltip.textContent = formatTime(time);
    };

    container.addEventListener("mousemove", (e) => {
      if (!dom.videoPlayer.duration) return;
      dom.progressTooltip.classList.remove("hidden");
      updateTooltip(e);
    });
    container.addEventListener("mouseleave", () => {
      dom.progressTooltip.classList.add("hidden");
    });

    container.addEventListener("mousedown", (e) => {
      state.seeking = true;
      const frac = getFractionFromEvent(e);
      seekToFraction(frac);
      showControls();
    });

    document.addEventListener("mousemove", (e) => {
      if (!state.seeking) return;
      const frac = getFractionFromEvent(e);
      seekToFraction(frac);
    });
    document.addEventListener("mouseup", () => {
      state.seeking = false;
    });

    // Touch
    container.addEventListener("touchstart", (e) => {
      const frac = getFractionFromEvent(e);
      seekToFraction(frac);
      showControls();
    }, { passive: true });
    container.addEventListener("touchmove", (e) => {
      const frac = getFractionFromEvent(e);
      seekToFraction(frac);
    }, { passive: true });
  }

  /* ==========================================================
     EVENT WIRING
     ========================================================== */

  function wireEvents() {
    // Playback
    dom.playPauseBtn.addEventListener("click", togglePlayPause);
    dom.bigPlayBtn.addEventListener("click", togglePlayPause);
    dom.videoPlayer.addEventListener("click", togglePlayPause);

    // Skip buttons
    dom.back30Btn.addEventListener("click", () => seekRelative(-CONFIG.skipLong));
    dom.back10Btn.addEventListener("click", () => seekRelative(-CONFIG.skipShort));
    dom.forward10Btn.addEventListener("click", () => seekRelative(CONFIG.skipShort));
    dom.forward30Btn.addEventListener("click", () => seekRelative(CONFIG.skipLong));

    // Prev / Next
    dom.prevBtn.addEventListener("click", playPrev);
    dom.nextBtn.addEventListener("click", playNext);

    // Volume
    dom.muteBtn.addEventListener("click", toggleMute);
    dom.volumeSlider.addEventListener("input", (e) => setVolume(parseFloat(e.target.value)));

    // Speed / Quality quick buttons
    dom.speedBtn.addEventListener("click", () => {
      openSettings();
      // Focus on speed section visually? Just open menu.
    });
    dom.qualityBtn.addEventListener("click", () => {
      openSettings();
    });

    // Settings
    dom.settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSettings();
    });
    document.addEventListener("click", (e) => {
      if (!state.settingsOpen) return;
      if (dom.settingsPopup.contains(e.target)) return;
      if (dom.settingsBtn.contains(e.target)) return;
      if (dom.speedBtn.contains(e.target)) return;
      if (dom.qualityBtn.contains(e.target)) return;
      closeSettings();
    });

    // Theater / Mini / PiP / Fullscreen
    dom.theaterBtn.addEventListener("click", toggleTheater);
    dom.miniBtn.addEventListener("click", () => {
      if (state.mini) closeMini();
      else openMini();
    });
    dom.pipBtn.addEventListener("click", togglePiP);
    dom.fullscreenBtn.addEventListener("click", toggleFullscreen);

    // Mini controls
    dom.miniPlayPause.addEventListener("click", () => {
      if (dom.miniVideo.paused) dom.miniVideo.play().catch(() => {});
      else dom.miniVideo.pause();
    });
    dom.miniClose.addEventListener("click", closeMini);
    dom.miniRestore.addEventListener("click", closeMini);

    // Mini video events
    dom.miniVideo.addEventListener("play", () => { dom.miniPlayPause.textContent = "⏸"; });
    dom.miniVideo.addEventListener("pause", () => { dom.miniPlayPause.textContent = "▶"; });
    dom.miniVideo.addEventListener("ended", () => {
      // Advance to next when mini finishes
      if (state.upNextIndex + 1 < state.upNext.length) {
        const item = state.upNext[state.upNextIndex + 1];
        // Restore first
        closeMini();
        navigateTo(item.folder, item.file);
      }
    });

    // Main video events
    dom.videoPlayer.addEventListener("play", () => {
      updatePlayPauseIcon();
      showControls();
    });
    dom.videoPlayer.addEventListener("pause", () => {
      updatePlayPauseIcon();
      showControls();
    });
    dom.videoPlayer.addEventListener("timeupdate", () => {
      updateTimeDisplay();
      updateProgressBar();
    });
    dom.videoPlayer.addEventListener("progress", updateProgressBar);
    dom.videoPlayer.addEventListener("volumechange", updateVolumeIcon);
    dom.videoPlayer.addEventListener("waiting", () => showLoading(true));
    dom.videoPlayer.addEventListener("canplay", () => showLoading(false));
    dom.videoPlayer.addEventListener("playing", () => showLoading(false));
    dom.videoPlayer.addEventListener("ended", () => {
      updatePlayPauseIcon();
      // Auto-advance
      if (state.upNextIndex + 1 < state.upNext.length) {
        const item = state.upNext[state.upNextIndex + 1];
        navigateTo(item.folder, item.file);
      } else {
        showToast("Finished. No more videos.");
      }
    });

    // Double-click on video → fullscreen
    dom.playerWrapper.addEventListener("dblclick", (e) => {
      if (e.target === dom.videoPlayer || e.target === dom.playerWrapper) {
        toggleFullscreen();
      }
    });

    // Auto-hide controls
    dom.playerWrapper.addEventListener("mousemove", showControls);
    dom.playerWrapper.addEventListener("mouseleave", () => {
      if (!dom.videoPlayer.paused) {
        setTimeout(hideControls, 800);
      }
    });

    // Fullscreen change
    document.addEventListener("fullscreenchange", updateFullscreenIcon);
    document.addEventListener("webkitfullscreenchange", updateFullscreenIcon);

    // PiP events
    dom.videoPlayer.addEventListener("enterpictureinpicture", () => showToast("Picture-in-Picture enabled"));
    dom.videoPlayer.addEventListener("leavepictureinpicture", () => showToast("Picture-in-Picture closed"));

    // Error dismiss
    dom.dismissError.addEventListener("click", hideError);

    // Keyboard
    document.addEventListener("keydown", handleKey);

    // Menu toggle (just shows/hides sidebar on home; on watch, jump to home)
    dom.menuToggle.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    // Save position on unload
    window.addEventListener("beforeunload", () => {
      if (state.currentVideo) {
        try {
          sessionStorage.setItem("pvp_resume_time", String(dom.videoPlayer.currentTime || 0));
        } catch (e) {}
      }
    });

    // Handle resize: if leaving mobile sidebar, ensure mini is repositioned
    window.addEventListener("resize", () => {
      if (state.mini) {
        // Keep in bounds
        const box = dom.miniPlayer;
        const rect = box.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          box.style.left = (window.innerWidth - box.offsetWidth - 12) + "px";
          box.style.right = "auto";
        }
        if (rect.bottom > window.innerHeight) {
          box.style.top = (window.innerHeight - box.offsetHeight - 12) + "px";
          box.style.bottom = "auto";
        }
      }
    });
  }

  /* ==========================================================
     LOAD PREFERENCES
     ========================================================== */

  function loadPrefs() {
    try {
      const s = parseFloat(localStorage.getItem(LS_SPEED));
      if (s && CONFIG.speeds.includes(s)) state.speed = s;
      const v = parseFloat(localStorage.getItem(LS_VOLUME));
      if (!isNaN(v) && v >= 0 && v <= 1) state.volume = v;
      const m = localStorage.getItem(LS_MUTED);
      if (m === "true") state.muted = true;
    } catch (e) {}
  }

  /* ==========================================================
     INIT
     ========================================================== */

  async function init() {
    cacheDom();
    loadPrefs();

    // Set initial UI from prefs
    dom.speedBtn.textContent = state.speed === 1 ? "1x" : `${state.speed}x`;
    dom.volumeSlider.value = state.muted ? 0 : state.volume;

    // Wire events before loading data (so controls respond even on error)
    wireEvents();
    wireProgress();
    wireMiniDrag();

    // Load data
    const ok = await loadVideosJson();
    if (!ok) {
      showError(
        "Could not load videos.json. Make sure it exists in the same folder as " +
        "watch.html and contains a valid JSON object with a 'folders' array."
      );
      return;
    }

    // Load and play the video from URL
    const loaded = loadCurrentVideo();
    if (!loaded) return;

    // Show controls initially
    showControls();
    updateFullscreenIcon();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();