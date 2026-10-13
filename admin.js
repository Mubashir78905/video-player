/* ============================================================
   PERSONAL VIDEO LIBRARY — admin.js
   Admin helper: parse folder structure, generate videos.json,
   copy/download, load existing JSON, quick-add rows.
   ============================================================ */

(function () {
  "use strict";

  /* ==========================================================
     DOM CACHE
     ========================================================== */
  const dom = {};

  function cacheDom() {
    dom.folderInput     = document.getElementById("folderInput");
    dom.generateBtn     = document.getElementById("generateBtn");
    dom.clearBtn        = document.getElementById("clearBtn");
    dom.loadExampleBtn  = document.getElementById("loadExampleBtn");
    dom.jsonPreview     = document.getElementById("jsonPreview");
    dom.copyBtn         = document.getElementById("copyBtn");
    dom.downloadBtn     = document.getElementById("downloadBtn");
    dom.uploadJsonBtn   = document.getElementById("uploadJsonBtn");
    dom.jsonFileInput   = document.getElementById("jsonFileInput");
    dom.statusMsg       = document.getElementById("statusMsg");
    dom.singleFolder    = document.getElementById("singleFolder");
    dom.singleFile      = document.getElementById("singleFile");
    dom.singleTitle     = document.getElementById("singleTitle");
    dom.addSingleBtn    = document.getElementById("addSingleBtn");
    dom.manualList      = document.getElementById("manualList");
  }

  /* ==========================================================
     STATE
     ========================================================== */
  const state = {
    // Parsed structure: { folders: [ { name, videos: [ {file, title} ] } ] }
    structure: null,
    // Manual additions (in addition to pasted structure)
    manual: [], // [{ folder, file, title }]
  };

  /* ==========================================================
     UTILITIES
     ========================================================== */

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripExtension(name) {
    if (!name) return "";
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  }

  function setStatus(msg, isError) {
    dom.statusMsg.textContent = msg || "";
    dom.statusMsg.style.color = isError ? "#ff6b6b" : "#7ee787";
  }

  /* ==========================================================
     PARSER
     Parses lines like:
       Movies:
         - vid1.mp4 | My First Movie
         - vid2.mp4
       Learning:
         - lesson01.mp4 | Introduction
         - lesson02.mp4

     Rules:
       - A line ending in ":" (optionally with trailing spaces) starts a new folder.
       - A line starting with "-" or "*" or "•" or a number followed by "." or ")"
         is a video entry.
       - After the filename, an optional "| Title" defines a custom title.
       - Indentation is optional but recommended.
       - Blank lines and lines starting with "#" or "//" are ignored.
     ========================================================== */

  function parseStructure(text) {
    if (!text || !text.trim()) {
      throw new Error("Nothing to parse. Paste your folder structure first.");
    }

    const folders = [];
    let current = null;

    const lines = text.replace(/\r\n/g, "\n").split("\n");

    lines.forEach((rawLine, idx) => {
      const lineNumber = idx + 1;
      const line = rawLine.trim();

      // Skip blanks & comments
      if (!line) return;
      if (line.startsWith("#") || line.startsWith("//")) return;

      // Folder header? Ends with ":" and (before colon) has no "/" or "."
      if (line.endsWith(":")) {
        const name = line.slice(0, -1).trim();
        if (!name) {
          throw new Error(`Line ${lineNumber}: folder name is empty.`);
        }
        if (name.includes("/") || name.includes("\\")) {
          throw new Error(`Line ${lineNumber}: folder names cannot contain slashes.`);
        }
        current = { name, videos: [] };
        folders.push(current);
        return;
      }

      // Video entry? Starts with "-", "*", "•", or "N." / "N)"
      const videoMatch = line.match(/^([-*•]|\d+[.)])\s*(.+)$/);
      if (videoMatch) {
        if (!current) {
          // Auto-create a "Videos" folder if user forgot a header
          current = { name: "Videos", videos: [] };
          folders.push(current);
        }

        let entry = videoMatch[2].trim();
        let title = "";

        // Split on "|" for optional title
        const pipeIdx = entry.indexOf("|");
        if (pipeIdx !== -1) {
          title = entry.slice(pipeIdx + 1).trim();
          entry = entry.slice(0, pipeIdx).trim();
        }

        if (!entry) {
          throw new Error(`Line ${lineNumber}: missing filename.`);
        }

        // Sanitise filename (no slashes)
        if (entry.includes("/") || entry.includes("\\")) {
          throw new Error(`Line ${lineNumber}: filename cannot contain slashes.`);
        }

        current.videos.push({
          file: entry,
          title: title || stripExtension(entry),
        });
        return;
      }

      // Bare filename without a leading dash, inside a folder
      if (current) {
        let entry = line;
        let title = "";
        const pipeIdx = entry.indexOf("|");
        if (pipeIdx !== -1) {
          title = entry.slice(pipeIdx + 1).trim();
          entry = entry.slice(0, pipeIdx).trim();
        }
        if (entry && !entry.includes("/") && !entry.includes("\\")) {
          current.videos.push({
            file: entry,
            title: title || stripExtension(entry),
          });
          return;
        }
      }

      // Otherwise: a line that isn't a folder, isn't a video, and isn't blank.
      // If we're inside a folder, treat as bare filename; else error.
      if (!current) {
        throw new Error(
          `Line ${lineNumber}: expected a folder header ending with ":" but got "${line}".`
        );
      }
    });

    if (folders.length === 0) {
      throw new Error("No folders found. Add at least one line like \"Movies:\".");
    }

    // Drop empty folders
    const nonEmpty = folders.filter((f) => f.videos.length > 0);
    if (nonEmpty.length === 0) {
      throw new Error("No video entries found. Add lines starting with \"- filename.mp4\".");
    }

    return { folders: nonEmpty };
  }

  /* ==========================================================
     MERGE MANUAL ENTRIES
     ========================================================== */

  function mergeManual(structure) {
    if (!state.manual.length) return structure;

    // Deep copy structure
    const merged = {
      folders: structure.folders.map((f) => ({
        name: f.name,
        videos: f.videos.map((v) => ({ ...v })),
      })),
    };

    state.manual.forEach((entry) => {
      let folder = merged.folders.find((f) => f.name === entry.folder);
      if (!folder) {
        folder = { name: entry.folder, videos: [] };
        merged.folders.push(folder);
      }
      folder.videos.push({
        file: entry.file,
        title: entry.title || stripExtension(entry.file),
      });
    });

    return merged;
  }

  /* ==========================================================
     BUILD JSON
     ========================================================== */

  function buildJson() {
    if (!state.structure) return null;
    const merged = mergeManual(state.structure);

    // Clean output: drop empty title (default to stripped filename)
    const output = {
      folders: merged.folders.map((f) => ({
        name: f.name,
        videos: f.videos.map((v) => {
          const clean = { file: v.file };
          if (v.title && v.title !== stripExtension(v.file)) {
            clean.title = v.title;
          }
          return clean;
        }),
      })),
    };

    return output;
  }

  /* ==========================================================
     RENDER — PREVIEW
     ========================================================== */

  function renderPreview() {
    const output = buildJson();
    if (!output) {
      dom.jsonPreview.textContent = "// Generated JSON will appear here…";
      return;
    }
    dom.jsonPreview.textContent = JSON.stringify(output, null, 2);
  }

  /* ==========================================================
     RENDER — MANUAL LIST
     ========================================================== */

  function renderManual() {
    dom.manualList.innerHTML = "";
    state.manual.forEach((entry, i) => {
      const li = document.createElement("li");
      const label = `${entry.folder} / ${entry.file}` +
        (entry.title ? ` — ${entry.title}` : "");
      li.innerHTML = `
        <span>${escapeHtml(label)}</span>
        <button class="remove-manual" title="Remove" data-index="${i}">✕</button>
      `;
      dom.manualList.appendChild(li);
    });

    // Wire remove buttons
    dom.manualList.querySelectorAll(".remove-manual").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.index, 10);
        state.manual.splice(i, 1);
        renderManual();
        renderPreview();
      });
    });
  }

  /* ==========================================================
     ACTIONS
     ========================================================== */

  function handleGenerate() {
    setStatus("");
    try {
      const text = dom.folderInput.value;
      state.structure = parseStructure(text);
      renderPreview();

      const totalVideos = state.structure.folders.reduce(
        (sum, f) => sum + f.videos.length, 0
      );
      setStatus(
        `✓ Parsed ${state.structure.folders.length} folder(s) with ${totalVideos} video(s).`,
        false
      );
    } catch (err) {
      state.structure = null;
      dom.jsonPreview.textContent = "// Generated JSON will appear here…";
      setStatus("✗ " + err.message, true);
    }
  }

  function handleClear() {
    dom.folderInput.value = "";
    state.structure = null;
    state.manual = [];
    renderManual();
    renderPreview();
    setStatus("");
  }

  function handleLoadExample() {
    const example = `Movies:
  - vid1.mp4 | My First Movie
  - vid2.mp4
Learning:
  - lesson01.mp4 | Introduction
  - lesson02.mp4 | Deep Dive
  - lesson03.mp4
Concerts:
  - live2024.mp4 | Live in 2024`;
    dom.folderInput.value = example;
    handleGenerate();
  }

  async function handleCopy() {
    const output = buildJson();
    if (!output) {
      setStatus("✗ Generate the JSON first.", true);
      return;
    }
    const text = JSON.stringify(output, null, 2);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setStatus("✓ Copied to clipboard. Paste into videos.json.", false);
    } catch (err) {
      setStatus("✗ Copy failed. Select the JSON and copy manually.", true);
    }
  }

  function handleDownload() {
    const output = buildJson();
    if (!output) {
      setStatus("✗ Generate the JSON first.", true);
      return;
    }
    const blob = new Blob(
      [JSON.stringify(output, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "videos.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("✓ Download started.", false);
  }

  function handleLoadJson() {
    dom.jsonFileInput.click();
  }

  function handleJsonFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);

        // Validate
        if (!data || !Array.isArray(data.folders)) {
          throw new Error("Missing 'folders' array.");
        }

        // Convert to text form for the textarea (so user can edit)
        const lines = [];
        data.folders.forEach((f) => {
          if (!f || typeof f.name !== "string" || !Array.isArray(f.videos)) return;
          lines.push(f.name + ":");
          f.videos.forEach((v) => {
            if (!v || typeof v.file !== "string") return;
            const title = v.title && v.title !== stripExtension(v.file) ? v.title : "";
            lines.push("  - " + v.file + (title ? " | " + title : ""));
          });
          lines.push("");
        });

        dom.folderInput.value = lines.join("\n").trim();
        handleGenerate();
        setStatus("✓ Loaded videos.json successfully.", false);
      } catch (err) {
        setStatus("✗ Could not read JSON: " + err.message, true);
      }
    };
    reader.onerror = () => setStatus("✗ Could not read file.", true);
    reader.readAsText(file);

    // Reset so the same file can be picked again
    dom.jsonFileInput.value = "";
  }

  /* ==========================================================
     QUICK-ADD (single row)
     ========================================================== */

  function handleAddSingle() {
    const folder = dom.singleFolder.value.trim();
    const file = dom.singleFile.value.trim();
    const title = dom.singleTitle.value.trim();

    if (!folder) {
      setStatus("✗ Enter a folder name.", true);
      return;
    }
    if (!file) {
      setStatus("✗ Enter a filename.", true);
      return;
    }
    if (file.includes("/") || file.includes("\\")) {
      setStatus("✗ Filenames cannot contain slashes.", true);
      return;
    }

    state.manual.push({ folder, file, title });
    renderManual();
    renderPreview();

    // Clear inputs
    dom.singleFolder.value = "";
    dom.singleFile.value = "";
    dom.singleTitle.value = "";
    dom.singleFolder.focus();

    // If structure already generated, keep it; else build from manual only
    if (!state.structure) {
      state.structure = { folders: [] };
    }
    renderPreview();
    setStatus(`✓ Added "${file}" to "${folder}".`, false);
  }

  /* ==========================================================
     EVENT WIRING
     ========================================================== */

  function wireEvents() {
    dom.generateBtn.addEventListener("click", handleGenerate);
    dom.clearBtn.addEventListener("click", handleClear);
    dom.loadExampleBtn.addEventListener("click", handleLoadExample);
    dom.copyBtn.addEventListener("click", handleCopy);
    dom.downloadBtn.addEventListener("click", handleDownload);
    dom.uploadJsonBtn.addEventListener("click", handleLoadJson);
    dom.jsonFileInput.addEventListener("change", handleJsonFileChange);
    dom.addSingleBtn.addEventListener("click", handleAddSingle);

    // Enter in quick-add inputs triggers add
    [dom.singleFolder, dom.singleFile, dom.singleTitle].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAddSingle();
        }
      });
    });

    // Live-preview on input (only after first generate, so we don't spam errors)
    dom.folderInput.addEventListener("input", () => {
      if (state.structure) {
        try {
          state.structure = parseStructure(dom.folderInput.value);
          renderPreview();
          setStatus("");
        } catch (err) {
          // Silent on live typing errors
          setStatus("");
        }
      }
    });

    // Keyboard shortcut: Ctrl/Cmd + S → download
    document.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleDownload();
      }
    });
  }

  /* ==========================================================
     INIT
     ========================================================== */

  function init() {
    cacheDom();
    wireEvents();
    renderManual();
    renderPreview();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();