/* ============================================================
   PERSONAL VIDEO LIBRARY — app.js
   Home page logic: load videos.json, render folders + grid,
   handle navigation, search, quality grouping, thumbnails.
   ============================================================ */

(function () {
  "use strict";

  /* ==========================================================
     CONFIG
     ========================================================== */
  const CONFIG = {
    videosJsonPath: "videos.json",
    videosFolder: "videos",       // subfolder where video files live
    defaultThumb: null,            // null = use built-in SVG placeholder
    // Recognised quality tags in filenames, best-first
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
    folders: [],           // [{ name, videos: [videoEntry...] }]
    allVideos: [],         // flattened list of video entries
    currentFolder: null,   // folder name or null (all videos)
    searchQuery: "",
    sidebarOpen: true,
  };

  /* ==========================================================
     DOM REFS
     ========================================================== */
  const dom = {};

  function cacheDom() {
    dom.menuToggle       = document.getElementById("menuToggle");
    dom.sidebar          = document.getElementById("sidebar");
    dom.searchInput      = document.getElementById("searchInput");
    dom.searchClearBtn   = document.getElementById("searchClearBtn");
    dom.navAllVideos     = document.getElementById("navAllVideos");
    dom.navFolders       = document.getElementById("navFolders");
    dom.sidebarFolderList= document.getElementById("sidebarFolderList");
    dom.sidebarStats     = document.getElementById("sidebarStats");
    dom.breadcrumbBar    = document.getElementById("breadcrumbBar");
    dom.backBtn          = document.getElementById("backBtn");
    dom.breadcrumbText   = document.getElementById("breadcrumbText");
    dom.breadcrumbCount  = document.getElementById("breadcrumbCount");
    dom.sectionHeader    = document.getElementById("sectionHeader");
    dom.sectionTitle     = document.getElementById("sectionTitle");
    dom.foldersSection   = document.getElementById("foldersSection");
    dom.foldersGrid      = document.getElementById("foldersGrid");
    dom.videosGrid       = document.getElementById("videosGrid");
    dom.emptyState       = document.getElementById("emptyState");
    dom.emptyTitle       = document.getElementById("emptyTitle");
    dom.emptyMessage     = document.getElementById("emptyMessage");
  }

  /* ==========================================================
     UTILITIES
     ========================================================== */

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripExtension(filename) {
    if (!filename) return "";
    const i = filename.lastIndexOf(".");
    return i > 0 ? filename.slice(0, i) : filename;
  }

  /**
   * Try to detect a quality tag in a filename.
   * Returns { base, qualityLabel } or null if no tag found.
   * Matches: video_720p.mp4, video-1080p.mp4, video.480p.mp4, video (720p).mp4
   */
  function detectQuality(filename) {
    if (!filename) return null;
    const nameNoExt = stripExtension(filename);
    // Look for tag preceded by _ - . ( or space, and followed by end or non-word
    for (const q of CONFIG.qualityTags) {
      const re = new RegExp("[_\\-.\\s(]" + q.tag + "(?=$|[)\\s_.\\-])", "i");
      const m = nameNoExt.match(re);
      if (m) {
        const idx = m.index;
        const base = nameNoExt.slice(0, idx);
        return { base: base.trim(), qualityLabel: q.label };
      }
      // Also allow the whole name to end with the tag, e.g. "video720p"
      const re2 = new RegExp(q.tag + "$", "i");
      if (re2.test(nameNoExt)) {
        const base = nameNoExt.replace(re2, "");
        return { base: base.trim(), qualityLabel: q.label };
      }
    }
    return null;
  }

  /**
   * Given a list of video entries from a folder, group by shared base title
   * if they have quality tags. Returns an array of grouped "cards":
   *   { title, folder, qualities: [{ label, file, title }], primary: entry, isGroup: bool }
   */
  function groupByQuality(entries, folderName) {
    const groups = [];
    const used = new Set();

    entries.forEach((entry, i) => {
      if (used.has(i)) return;

      const parsed = detectQuality(entry.file);
      if (!parsed) {
        // No quality tag → standalone card
        groups.push({
          title: entry.title || stripExtension(entry.file),
          folder: folderName,
          qualities: [{
            label: "Original",
            file: entry.file,
            title: entry.title || stripExtension(entry.file),
          }],
          primary: entry,
          isGroup: false,
        });
        used.add(i);
        return;
      }

      // Find other entries with matching base (case-insensitive)
      const baseKey = parsed.base.toLowerCase();
      const variants = [{
        label: parsed.qualityLabel,
        file: entry.file,
        title: entry.title || stripExtension(entry.file),
      }];
      used.add(i);

      entries.forEach((other, j) => {
        if (used.has(j)) return;
        if (other === entry) return;
        const otherParsed = detectQuality(other.file);
        if (!otherParsed) return;
        if (otherParsed.base.toLowerCase() === baseKey) {
          variants.push({
            label: otherParsed.qualityLabel,
            file: other.file,
            title: other.title || stripExtension(other.file),
          });
          used.add(j);
        }
      });

      // Sort variants best-first (by qualityTags order)
      variants.sort((a, b) => {
        const ai = CONFIG.qualityTags.findIndex((q) => q.label === a.label);
        const bi = CONFIG.qualityTags.findIndex((q) => q.label === b.label);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      // If only one variant matched after all, treat as standalone
      if (variants.length === 1) {
        groups.push({
          title: entry.title || stripExtension(entry.file),
          folder: folderName,
          qualities: variants,
          primary: entry,
          isGroup: false,
        });
      } else {
        // Group title = base (humanized) or explicit title from any entry
        const groupTitle =
          entry.title && entry.title !== stripExtension(entry.file)
            ? entry.title
            : parsed.base || stripExtension(entry.file);

        groups.push({
          title: groupTitle,
          folder: folderName,
          qualities: variants,
          primary: entry,
          isGroup: true,
        });
      }
    });

    return groups;
  }

  /**
   * Build a blob-friendly path to a video file.
   * Videos are expected at: /videos/<folder>/<file>
   * URL-encode each segment so spaces work.
   */
  // function videoUrl(folder, file) {
  //   const enc = (s) => encodeURIComponent(s);
  //   if (folder) {
  //     return `${CONFIG.videosFolder}/${enc(folder)}/${enc(file)}`;
  //   }
  //   return `${CONFIG.videosFolder}/${enc(file)}`;
  // }

   // Replaced function

   function videoUrl(folder, file) {
  // If it's already a full URL (http/https) or absolute path, use it directly.
  if (/^https?:\/\//i.test(file) || file.startsWith("//") || file.startsWith("/")) {
    return file;
  }
  const enc = (s) => encodeURIComponent(s);
  if (folder) {
    return `${CONFIG.videosFolder}/${enc(folder)}/${enc(file)}`;
  }
  return `${CONFIG.videosFolder}/${enc(file)}`;
}

  /**
   * Build thumbnail URL. Convention: same folder, same basename, .jpg extension.
   * Also tries .png, .jpeg, .webp. The actual file may not exist; onerror
   * will fall back to the built-in SVG placeholder.
   */
  function thumbCandidates(folder, file) {
    const base = stripExtension(file);
    const exts = ["jpg", "jpeg", "png", "webp"];
    return exts.map((ext) => videoUrl(folder, `${base}.${ext}`));
  }

  /* ==========================================================
     ICONS (inline SVG strings)
     ========================================================== */

  const PLACEHOLDER_SVG = `
    <div class="thumb-placeholder">
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="#666" stroke-width="1.5"/>
        <path d="M10 9l6 3-6 3z" fill="#666"/>
      </svg>
    </div>`;

  const FOLDER_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;

  const SIDEBAR_FOLDER_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" class="folder-icon">
      <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;

  /* ==========================================================
     DATA LOADING
     ========================================================== */

  async function loadVideos() {
    try {
      const res = await fetch(CONFIG.videosJsonPath, { cache: "no-cache" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      // Validate shape
      if (!data || !Array.isArray(data.folders)) {
        throw new Error("Invalid videos.json: missing 'folders' array");
      }

      state.folders = data.folders
        .filter((f) => f && typeof f.name === "string")
        .map((f) => ({
          name: f.name.trim(),
          videos: Array.isArray(f.videos)
            ? f.videos
                .filter((v) => v && typeof v.file === "string")
                .map((v) => ({
                  file: v.file.trim(),
                  title: typeof v.title === "string" ? v.title.trim() : "",
                  thumb: typeof v.thumb === "string" ? v.thumb.trim() : "",
                  // Optional: explicit qualities array (advanced)
                  qualities: Array.isArray(v.qualities) ? v.qualities : null,
                }))
            : [],
        }))
        .filter((f) => f.name && f.videos.length > 0);

      // Flatten
      state.allVideos = [];
      state.folders.forEach((folder) => {
        folder.videos.forEach((v) => {
          state.allVideos.push({ ...v, folder: folder.name });
        });
      });

      return true;
    } catch (err) {
      console.error("Failed to load videos.json:", err);
      state.folders = [];
      state.allVideos = [];
      return false;
    }
  }

  /* ==========================================================
     RENDER — SIDEBAR
     ========================================================== */

  function renderSidebar() {
    // Folder list
    dom.sidebarFolderList.innerHTML = "";
    state.folders.forEach((folder) => {
      const li = document.createElement("li");
      li.className = "sidebar-folder-item";
      if (state.currentFolder === folder.name) li.classList.add("active");
      li.innerHTML = `
        ${SIDEBAR_FOLDER_SVG}
        <span class="folder-name">${escapeHtml(folder.name)}</span>
        <span class="folder-count">${folder.videos.length}</span>
      `;
      li.addEventListener("click", () => selectFolder(folder.name));
      dom.sidebarFolderList.appendChild(li);
    });

    // Stats
    const totalVideos = state.allVideos.length;
    const totalFolders = state.folders.length;
    dom.sidebarStats.textContent =
      `${totalVideos} video${totalVideos === 1 ? "" : "s"} · ` +
      `${totalFolders} folder${totalFolders === 1 ? "" : "s"}`;

    // Nav active state
    dom.navAllVideos.classList.toggle("active", state.currentFolder === null);
    dom.navFolders.classList.toggle("active", state.currentFolder !== null);
  }

  /* ==========================================================
     RENDER — FOLDERS GRID (home only)
     ========================================================== */

  function renderFoldersGrid() {
    // Only show folder grid when:
    //  - not inside a folder
    //  - no search query
    const shouldShow = state.currentFolder === null && !state.searchQuery;
    if (!shouldShow) {
      dom.foldersSection.classList.add("hidden");
      dom.foldersGrid.innerHTML = "";
      return;
    }

    dom.foldersSection.classList.remove("hidden");
    dom.foldersGrid.innerHTML = "";

    if (state.folders.length === 0) {
      dom.foldersSection.classList.add("hidden");
      return;
    }

    state.folders.forEach((folder) => {
      const card = document.createElement("div");
      card.className = "folder-card";
      card.innerHTML = `
        <div class="folder-thumb">${FOLDER_SVG}</div>
        <div class="folder-info">
          <div class="folder-name">${escapeHtml(folder.name)}</div>
          <div class="folder-meta">${folder.videos.length} video${folder.videos.length === 1 ? "" : "s"}</div>
        </div>
      `;
      card.addEventListener("click", () => selectFolder(folder.name));
      dom.foldersGrid.appendChild(card);
    });
  }

  /* ==========================================================
     RENDER — VIDEOS GRID
     ========================================================== */

  function getVisibleVideos() {
    let list;

    if (state.currentFolder) {
      // Videos from a single folder
      const folder = state.folders.find((f) => f.name === state.currentFolder);
      list = folder
        ? folder.videos.map((v) => ({ ...v, folder: folder.name }))
        : [];
    } else {
      // All videos
      list = state.allVideos.slice();
    }

    // Apply search
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter((v) => {
        const title = (v.title || stripExtension(v.file)).toLowerCase();
        return title.includes(q) || v.file.toLowerCase().includes(q);
      });
    }

    return list;
  }

  function renderVideosGrid() {
    dom.videosGrid.innerHTML = "";

    const videos = getVisibleVideos();

    if (videos.length === 0) {
      dom.emptyState.classList.remove("hidden");
      if (state.searchQuery) {
        dom.emptyTitle.textContent = "No results";
        dom.emptyMessage.textContent = `No videos match "${state.searchQuery}".`;
      } else if (state.currentFolder) {
        dom.emptyTitle.textContent = "Folder is empty";
        dom.emptyMessage.textContent = `No videos found in "${state.currentFolder}".`;
      } else {
        dom.emptyTitle.textContent = "No videos yet";
        dom.emptyMessage.textContent =
          "Add videos to your /videos folder and update videos.json.";
      }
      return;
    }

    dom.emptyState.classList.add("hidden");

    // Group by quality within the current listing
    // Group by folder first (so mixed folders on home don't cross-merge)
    const byFolder = new Map();
    videos.forEach((v) => {
      const key = v.folder || "";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key).push(v);
    });

    const cards = [];
    byFolder.forEach((entries, folderName) => {
      const grouped = groupByQuality(entries, folderName);
      cards.push(...grouped);
    });

    // Sort cards: keep folder order, then insertion order
    cards.forEach((card) => {
      dom.videosGrid.appendChild(buildVideoCard(card));
    });
  }

  /**
   * Build a single video card DOM node from a grouped card descriptor.
   */
  function buildVideoCard(card) {
    const el = document.createElement("div");
    el.className = "video-card";

    const primary = card.primary;
    const folderName = card.folder;
    const primaryFile = primary.file;
    const title = card.title;
    const bestQuality = card.qualities[0];

    // Thumbnail
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "video-thumb";

    // Prefer explicit thumb field, else convention-based candidates
    const thumbSources = [];
    if (primary.thumb) {
      thumbSources.push(
        primary.thumb.startsWith("http") || primary.thumb.startsWith("/")
          ? primary.thumb
          : videoUrl(folderName, primary.thumb)
      );
    }
    thumbCandidates(folderName, primaryFile).forEach((u) => thumbSources.push(u));

    // Placeholder by default; swap to <img> on first successful load
    thumbWrap.innerHTML = PLACEHOLDER_SVG;

    tryThumbnails(thumbWrap, thumbSources, title);

    // Duration badge (unknown until load; we display "—" placeholder and
    // let watch page compute the real duration). We show the folder name
    // instead since we can't read metadata without loading the video.
    // (We deliberately do NOT load the video here to keep the grid fast.)

    // Quality badge
    if (card.qualities.length > 1) {
      const badge = document.createElement("div");
      badge.className = "video-quality-badge";
      badge.textContent = `${card.qualities.length} qualities`;
      thumbWrap.appendChild(badge);
    } else if (card.qualities.length === 1 && card.qualities[0].label !== "Original") {
      const badge = document.createElement("div");
      badge.className = "video-quality-badge";
      badge.textContent = card.qualities[0].label;
      thumbWrap.appendChild(badge);
    }

    el.appendChild(thumbWrap);

    // Info row
    const info = document.createElement("div");
    info.className = "video-card-info";

    const avatar = document.createElement("div");
    avatar.className = "video-card-avatar";
    avatar.textContent = (folderName || "V").charAt(0);

    const text = document.createElement("div");
    text.className = "video-card-text";

    const t = document.createElement("div");
    t.className = "video-card-title";
    t.textContent = title || stripExtension(primaryFile);
    t.title = t.textContent;

    const f = document.createElement("div");
    f.className = "video-card-folder";
    f.textContent = folderName || "Library";

    text.appendChild(t);
    text.appendChild(f);

    info.appendChild(avatar);
    info.appendChild(text);
    el.appendChild(info);

    // Click → open watch page with folder + file
    el.addEventListener("click", () => {
      const params = new URLSearchParams();
      if (folderName) params.set("folder", folderName);
      params.set("file", primaryFile);
      // If multiple qualities, remember them so watch page can show the menu
      if (card.qualities.length > 1) {
        params.set("qualities", card.qualities.map((q) => `${q.label}::${q.file}`).join("|"));
      }
      window.location.href = `watch.html?${params.toString()}`;
    });

    return el;
  }

  /**
   * Try to load a thumbnail from a list of candidate URLs.
   * On success, replace the placeholder with the <img>.
   * On total failure, leave placeholder.
   */
  function tryThumbnails(wrapEl, urls, altText) {
    if (!urls || urls.length === 0) return;

    let index = 0;
    const tryNext = () => {
      if (index >= urls.length) return;
      const url = urls[index++];
      const img = new Image();
      img.alt = altText || "";
      img.loading = "lazy";
      img.onload = () => {
        // Clear placeholder and insert the loaded image
        wrapEl.innerHTML = "";
        wrapEl.appendChild(img);
      };
      img.onerror = () => {
        tryNext();
      };
      img.src = url;
    };
    tryNext();
  }

  /* ==========================================================
     NAVIGATION
     ========================================================== */

  function selectFolder(name) {
    state.currentFolder = name;
    state.searchQuery = "";
    dom.searchInput.value = "";
    dom.searchClearBtn.classList.add("hidden");
    updateUrlHash();
    renderAll();
    window.scrollTo({ top: 0, behavior: "smooth" });
    closeSidebarOnMobile();
  }

  function showAllVideos() {
    state.currentFolder = null;
    state.searchQuery = "";
    dom.searchInput.value = "";
    dom.searchClearBtn.classList.add("hidden");
    updateUrlHash();
    renderAll();
    closeSidebarOnMobile();
  }

  function updateUrlHash() {
    // Optional: keep the URL in sync so refresh keeps you in the folder
    const hash = state.currentFolder ? `#folder=${encodeURIComponent(state.currentFolder)}` : "";
    if (location.hash !== hash) {
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
  }

  function readUrlHash() {
    const m = location.hash.match(/^#folder=(.+)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (state.folders.some((f) => f.name === name)) {
        state.currentFolder = name;
      }
    }
  }

  /* ==========================================================
     SEARCH
     ========================================================== */

  function handleSearch() {
    const q = dom.searchInput.value.trim();
    state.searchQuery = q;
    dom.searchClearBtn.classList.toggle("hidden", q === "");
    renderAll();
  }

  function clearSearch() {
    dom.searchInput.value = "";
    state.searchQuery = "";
    dom.searchClearBtn.classList.add("hidden");
    renderAll();
  }

  /* ==========================================================
     SIDEBAR TOGGLE (desktop + mobile)
     ========================================================== */

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    dom.sidebar.classList.toggle("collapsed", !state.sidebarOpen);
  }

  function closeSidebarOnMobile() {
    if (window.innerWidth <= 900) {
      state.sidebarOpen = false;
      dom.sidebar.classList.add("collapsed");
    }
  }

  /* ==========================================================
     MASTER RENDER
     ========================================================== */

  function renderAll() {
    // Section title
    if (state.searchQuery) {
      dom.sectionTitle.textContent = `Search: "${state.searchQuery}"`;
      dom.breadcrumbBar.classList.add("hidden");
    } else if (state.currentFolder) {
      dom.sectionTitle.textContent = state.currentFolder;
      dom.breadcrumbBar.classList.remove("hidden");
      dom.breadcrumbText.textContent = state.currentFolder;
      const folder = state.folders.find((f) => f.name === state.currentFolder);
      const count = folder ? folder.videos.length : 0;
      dom.breadcrumbCount.textContent = `${count} video${count === 1 ? "" : "s"}`;
    } else {
      dom.sectionTitle.textContent = "All Videos";
      dom.breadcrumbBar.classList.add("hidden");
    }

    renderSidebar();
    renderFoldersGrid();
    renderVideosGrid();
  }

  /* ==========================================================
     EVENT WIRING
     ========================================================== */

  function wireEvents() {
    dom.menuToggle.addEventListener("click", toggleSidebar);
    dom.navAllVideos.addEventListener("click", (e) => {
      e.preventDefault();
      showAllVideos();
    });
    dom.navFolders.addEventListener("click", (e) => {
      e.preventDefault();
      // Scroll to folders grid on home; do nothing special if inside a folder
      if (state.currentFolder) showAllVideos();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    dom.backBtn.addEventListener("click", () => showAllVideos());

    dom.searchInput.addEventListener("input", handleSearch);
    dom.searchClearBtn.addEventListener("click", clearSearch);

    // Keyboard: "/" focuses search
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        dom.searchInput.focus();
      }
      if (e.key === "Escape" && document.activeElement === dom.searchInput) {
        clearSearch();
        dom.searchInput.blur();
      }
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener("click", (e) => {
      if (window.innerWidth > 900) return;
      if (!state.sidebarOpen) return;
      const insideSidebar = dom.sidebar.contains(e.target);
      const insideToggle = dom.menuToggle.contains(e.target);
      if (!insideSidebar && !insideToggle) {
        state.sidebarOpen = false;
        dom.sidebar.classList.add("collapsed");
      }
    });

    // Handle browser back/forward for hash changes
    window.addEventListener("hashchange", () => {
      const m = location.hash.match(/^#folder=(.+)$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        if (state.folders.some((f) => f.name === name)) {
          state.currentFolder = name;
        } else {
          state.currentFolder = null;
        }
      } else {
        state.currentFolder = null;
      }
      renderAll();
    });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  /* ==========================================================
     INIT
     ========================================================== */

  async function init() {
    cacheDom();

    // Hide sidebar on small screens by default
    if (window.innerWidth <= 900) {
      state.sidebarOpen = false;
      dom.sidebar.classList.add("collapsed");
    }

    wireEvents();

    const ok = await loadVideos();

    if (!ok) {
      // Show a helpful error in the empty state
      dom.emptyState.classList.remove("hidden");
      dom.emptyTitle.textContent = "Could not load videos.json";
      dom.emptyMessage.textContent =
        "Make sure videos.json is in the same folder as index.html " +
        "and contains a valid JSON object with a 'folders' array.";
      return;
    }

    readUrlHash();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
