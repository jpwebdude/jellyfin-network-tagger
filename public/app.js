(() => {
  const VIDEO_EXTENSIONS = new Set([
    ".mp4",
    ".mkv",
    ".avi",
    ".m4v",
    ".mov",
    ".webm",
    ".ts",
    ".wmv",
    ".flv",
  ]);

  const ROUTES = {
    "/": {
      viewId: "view-network",
      breadcrumb: "Jellyfin Network Tagger",
      ctaLabel: "Run Dry Scan",
    },
    "/local-tagger": {
      viewId: "view-local",
      breadcrumb: "Local Library Tagger",
      ctaLabel: "Scan Library",
    },
    "/settings": {
      viewId: "view-settings",
      breadcrumb: "Settings",
      ctaLabel: "Save Settings",
    },
  };

  const state = {
    currentRoute: "/",
    statusData: null,
    formInitialized: false,
    localMode: "server",
    localScan: null,
    localFilter: "all",
    localSearch: "",
    localBusy: false,
    browserHandles: {
      moviesRoot: null,
      tvRoot: null,
      entriesById: new Map(),
    },
    browseTarget: "movie",
    browseCurrentPath: "/",
    browseParentPath: null,
    overrideItemId: null,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    sidebar: $("sidebar"),
    sidebarBackdrop: $("sidebar-backdrop"),
    menuToggle: $("menu-toggle"),
    topbarBreadcrumb: $("topbar-breadcrumb"),
    topbarPrimaryBtn: $("topbar-primary-btn"),

    // Network Tagger
    networkConfigNotice: $("network-config-notice"),
    networkConfigNoticeText: $("network-config-notice-text"),
    configStatusText: $("config-status-text"),
    runStatusText: $("run-status-text"),
    runMeta: $("run-meta"),
    statUpdated: $("stat-updated"),
    statUnchanged: $("stat-unchanged"),
    statNoId: $("stat-no-id"),
    statNoTmdb: $("stat-no-tmdb"),
    statNoProviders: $("stat-no-providers"),
    statErrors: $("stat-errors"),
    btnDryRun: $("btn-dry-run"),
    btnLiveRun: $("btn-live-run"),
    btnRefresh: $("btn-refresh"),
    runMsg: $("run-msg"),
    logs: $("logs"),
    testProviderInput: $("test-provider-input"),
    btnTestProvider: $("btn-test-provider"),
    testProviderResult: $("test-provider-result"),
    providerTableBody: $("provider-table-body"),

    // Local Library Tagger
    localTmdbNotice: $("local-tmdb-notice"),
    localTmdbNoticeText: $("local-tmdb-notice-text"),
    localIframeNotice: $("local-iframe-notice"),
    localIframeNoticeText: $("local-iframe-notice-text"),
    modeServerBtn: $("mode-server-btn"),
    modeBrowserBtn: $("mode-browser-btn"),
    localServerPanel: $("local-server-panel"),
    localBrowserPanel: $("local-browser-panel"),
    moviePathsInput: $("movie-paths-input"),
    tvPathsInput: $("tv-paths-input"),
    btnBrowseMovie: $("btn-browse-movie"),
    btnBrowseTv: $("btn-browse-tv"),
    btnPickMovies: $("btn-pick-movies"),
    btnPickTv: $("btn-pick-tv"),
    pickedMoviesLabel: $("picked-movies-label"),
    pickedTvLabel: $("picked-tv-label"),
    localDryRun: $("local-dry-run"),
    btnLocalScan: $("btn-local-scan"),
    btnEmptyScan: $("btn-empty-scan"),
    btnLocalApply: $("btn-local-apply"),
    btnExportSh: $("btn-export-sh"),
    btnExportPs1: $("btn-export-ps1"),
    localMsg: $("local-msg"),
    localScanMeta: $("local-scan-meta"),
    lstatTotal: $("lstat-total"),
    lstatReady: $("lstat-ready"),
    lstatTagged: $("lstat-tagged"),
    lstatUnmatched: $("lstat-unmatched"),
    lstatRenamed: $("lstat-renamed"),
    lstatErrors: $("lstat-errors"),
    localSearchInput: $("local-search-input"),
    localEmpty: $("local-empty"),
    localTable: $("local-table"),
    localTableBody: $("local-table-body"),

    // Settings
    configForm: $("config-form"),
    tmdbAuthStatus: $("tmdb-auth-status"),
    tmdbApiKey: $("tmdbApiKey"),
    tmdbCountry: $("tmdbCountry"),
    btnTestTmdb: $("btn-test-tmdb"),
    tmdbTestMsg: $("tmdb-test-msg"),
    jfConfigStatus: $("jf-config-status"),
    jellyfinUrl: $("jellyfinUrl"),
    jellyfinApiKey: $("jellyfinApiKey"),
    runIntervalHours: $("runIntervalHours"),
    btnTestJf: $("btn-test-jf"),
    jfTestMsg: $("jf-test-msg"),
    ignoreProviders: $("ignoreProviders"),
    dryRun: $("dryRun"),
    configMsg: $("config-msg"),

    // Browse Modal
    browseModal: $("browse-modal"),
    btnBrowseClose: $("btn-browse-close"),
    browseCurrentInput: $("browse-current-input"),
    btnBrowseGo: $("btn-browse-go"),
    btnBrowseUp: $("btn-browse-up"),
    browseList: $("browse-list"),
    btnBrowseSelect: $("btn-browse-select"),

    // Override Modal
    overrideModal: $("override-modal"),
    btnOverrideClose: $("btn-override-close"),
    overrideItemLabel: $("override-item-label"),
    overrideQuery: $("override-query"),
    overrideYear: $("override-year"),
    btnOverrideSearch: $("btn-override-search"),
    overrideResults: $("override-results"),
    overrideMsg: $("override-msg"),
  };

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("open");
  }

  function normalizeRoute(rawPath) {
    if (rawPath === "/local-tagger" || rawPath === "/settings") {
      return rawPath;
    }
    return "/";
  }

  function navigate(rawPath, push = true) {
    const route = normalizeRoute(rawPath);
    state.currentRoute = route;
    if (push && window.location.pathname !== route) {
      history.pushState({ route }, "", route);
    }

    const meta = ROUTES[route];
    document.querySelectorAll(".view-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === meta.viewId);
    });
    document.querySelectorAll(".sidebar-nav .nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === route);
    });

    els.topbarBreadcrumb.innerHTML = "";
    const prefix = document.createTextNode("Dashboard / ");
    const strong = document.createElement("strong");
    strong.textContent = meta.breadcrumb;
    els.topbarBreadcrumb.appendChild(prefix);
    els.topbarBreadcrumb.appendChild(strong);

    updateTopbarPrimaryButton();
    closeSidebar();
  }

  function updateTopbarPrimaryButton() {
    if (state.currentRoute === "/") {
      els.topbarPrimaryBtn.textContent = "Run Dry Scan";
      els.topbarPrimaryBtn.disabled = Boolean(state.statusData?.isRunning);
    } else if (state.currentRoute === "/local-tagger") {
      els.topbarPrimaryBtn.textContent = els.localDryRun.checked
        ? "Scan Library (Dry Run)"
        : "Scan & Tag Library";
      els.topbarPrimaryBtn.disabled = state.localBusy;
    } else {
      els.topbarPrimaryBtn.textContent = "Save Settings";
      els.topbarPrimaryBtn.disabled = false;
    }
  }

  function statusLabelText(status) {
    switch (status) {
      case "ready":
        return { text: "Ready", cls: "state-ok" };
      case "already_tagged":
        return { text: "Already Tagged", cls: "" };
      case "unmatched":
        return { text: "Needs Review", cls: "state-warn" };
      case "collision":
        return { text: "Collision", cls: "state-err" };
      case "renamed":
        return { text: "Renamed", cls: "state-ok" };
      case "error":
        return { text: "Error", cls: "state-err" };
      default:
        return { text: status, cls: "" };
    }
  }

  function getFileExtension(name) {
    const idx = name.lastIndexOf(".");
    if (idx <= 0) return "";
    return name.slice(idx);
  }

  function isIgnoredName(name) {
    return (
      name.startsWith(".") ||
      name === "@eaDir" ||
      name === "#recycle" ||
      name === "System Volume Information" ||
      name === "$RECYCLE.BIN"
    );
  }

  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      state.statusData = data;

      els.configStatusText.textContent = data.configured
        ? "Jellyfin Configured"
        : "Credentials Needed";
      els.configStatusText.className = data.configured ? "state-ok" : "state-warn";

      if (data.configError) {
        els.networkConfigNoticeText.textContent = data.configError;
        els.networkConfigNotice.classList.remove("hidden");
      } else {
        els.networkConfigNotice.classList.add("hidden");
      }

      if (data.tmdbConfigured) {
        els.localTmdbNotice.classList.add("hidden");
        const modeLabel =
          data.tmdbAuthMode === "bearer" ? "Read Access Token" : "v3 API Key";
        els.tmdbAuthStatus.textContent = `Configured (${modeLabel})`;
        els.tmdbAuthStatus.className = "meta-inline state-ok";
      } else {
        els.localTmdbNoticeText.textContent =
          data.tmdbError || "TMDB API Key or Read Access Token is required.";
        els.localTmdbNotice.classList.remove("hidden");
        els.tmdbAuthStatus.textContent = "Not Configured";
        els.tmdbAuthStatus.className = "meta-inline state-warn";
      }

      els.jfConfigStatus.textContent = data.configured ? "Ready" : "Incomplete";
      els.jfConfigStatus.className = data.configured
        ? "meta-inline state-ok"
        : "meta-inline state-warn";

      const runStatus = data.isRunning
        ? "Running"
        : data.lastRun?.status ?? "Idle";
      els.runStatusText.textContent = runStatus;
      els.runStatusText.className = data.isRunning
        ? "state-warn"
        : data.lastRun?.status === "failed"
          ? "state-err"
          : data.lastRun?.status === "completed"
            ? "state-ok"
            : "";

      if (!state.formInitialized) {
        els.jellyfinUrl.value = data.config.jellyfinUrl || "";
        els.jellyfinApiKey.placeholder = data.config.hasJellyfinApiKey
          ? "Configured (leave blank to keep)"
          : "e.g. your-jellyfin-api-key (Dashboard -> API Keys)";
        els.tmdbApiKey.placeholder = data.config.hasTmdbApiKey
          ? "Configured (leave blank to keep)"
          : "e.g. eyJ...your-tmdb-read-access-token or 32-char API key";
        els.tmdbCountry.value = data.config.tmdbCountry || "US";
        els.runIntervalHours.value = String(data.config.runIntervalHours || 24);
        els.ignoreProviders.value = (data.config.ignoreProviders || []).join(", ");
        els.dryRun.checked = Boolean(data.config.dryRun);
        if (!els.moviePathsInput.value.trim() && Array.isArray(data.config.localMoviePaths)) {
          els.moviePathsInput.value = data.config.localMoviePaths.join("\n");
        }
        if (!els.tvPathsInput.value.trim() && Array.isArray(data.config.localTvPaths)) {
          els.tvPathsInput.value = data.config.localTvPaths.join("\n");
        }
        state.formInitialized = true;
      }

      const stats = data.lastRun?.stats ?? {
        updated: 0,
        unchanged: 0,
        skipped_no_id: 0,
        skipped_no_tmdb: 0,
        skipped_no_providers: 0,
        errors: 0,
      };
      els.statUpdated.textContent = stats.updated;
      els.statUnchanged.textContent = stats.unchanged;
      els.statNoId.textContent = stats.skipped_no_id;
      els.statNoTmdb.textContent = stats.skipped_no_tmdb;
      els.statNoProviders.textContent = stats.skipped_no_providers;
      els.statErrors.textContent = stats.errors;

      if (data.lastRun) {
        els.runMeta.textContent = `${data.lastRun.dryRun ? "Dry Run" : "Live"} (${data.lastRun.country}) · ${data.lastRun.moviesCount} movies · ${data.lastRun.seriesCount} series`;
        if (data.lastRun.status === "failed" && data.lastRun.error && !els.runMsg.textContent) {
          els.runMsg.textContent = data.lastRun.error;
        }
      } else {
        els.runMeta.textContent = data.nextRunAt
          ? `Next check: ${data.nextRunAt.slice(0, 19).replace("T", " ")}`
          : "No runs yet";
      }

      els.btnDryRun.disabled = data.isRunning;
      els.btnLiveRun.disabled = data.isRunning;
      updateTopbarPrimaryButton();

      els.logs.textContent =
        (data.logs || [])
          .map((l) => `${l.timestamp} [${l.level}] ${l.message}`)
          .join("\n") || "No log entries yet.";
      els.logs.scrollTop = els.logs.scrollHeight;
    } catch (err) {
      console.error("Failed to fetch status", err);
    }
  }

  async function loadProviders() {
    const res = await fetch("/api/providers");
    const data = await res.json();
    const entries = Object.entries(data.map || {});
    els.providerTableBody.innerHTML = "";
    for (const [raw, normalized] of entries) {
      const tr = document.createElement("tr");
      const tdRaw = document.createElement("td");
      tdRaw.textContent = raw;
      const tdNorm = document.createElement("td");
      tdNorm.className = "mono";
      tdNorm.textContent = normalized;
      tr.appendChild(tdRaw);
      tr.appendChild(tdNorm);
      els.providerTableBody.appendChild(tr);
    }
  }

  async function triggerNetworkRun(dryRun) {
    els.runMsg.textContent = dryRun
      ? "Starting dry run..."
      : "Starting live tagging run...";
    els.btnDryRun.disabled = true;
    els.btnLiveRun.disabled = true;
    updateTopbarPrimaryButton();
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        els.runMsg.textContent = data.error || "Run failed.";
      } else {
        els.runMsg.textContent = `Completed: ${data.summary.stats.updated} tagged, ${data.summary.stats.unchanged} unchanged.`;
      }
    } catch (err) {
      els.runMsg.textContent = err.message || "Request error.";
    }
    await loadStatus();
  }

  async function saveSettings(e) {
    if (e) e.preventDefault();
    els.configMsg.textContent = "Saving settings...";
    const payload = {
      jellyfinUrl: els.jellyfinUrl.value,
      jellyfinApiKey: els.jellyfinApiKey.value,
      tmdbApiKey: els.tmdbApiKey.value,
      tmdbCountry: els.tmdbCountry.value,
      runIntervalHours: Number(els.runIntervalHours.value),
      ignoreProviders: els.ignoreProviders.value,
      dryRun: els.dryRun.checked,
    };
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        els.jellyfinApiKey.value = "";
        els.tmdbApiKey.value = "";
        state.formInitialized = false;
        await loadStatus();
        els.configMsg.textContent = "Settings saved.";
      } else {
        els.configMsg.textContent = "Failed to save settings.";
      }
    } catch (err) {
      els.configMsg.textContent = err.message || "Error saving settings.";
    }
  }

  async function testTmdbConnection() {
    els.tmdbTestMsg.textContent = "Testing TMDB connection...";
    try {
      const res = await fetch("/api/tmdb/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbApiKey: els.tmdbApiKey.value }),
      });
      const data = await res.json();
      if (data.ok) {
        const mode = data.authMode === "bearer" ? "Read Access Token" : "v3 API Key";
        els.tmdbTestMsg.textContent = `Connected to TMDB successfully (${mode}).`;
      } else {
        els.tmdbTestMsg.textContent = data.error || "TMDB test failed.";
      }
    } catch (err) {
      els.tmdbTestMsg.textContent = err.message || "TMDB connection error.";
    }
  }

  async function testJellyfinConnection() {
    els.jfTestMsg.textContent = "Testing Jellyfin connection...";
    try {
      const res = await fetch("/api/jellyfin/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jellyfinUrl: els.jellyfinUrl.value,
          jellyfinApiKey: els.jellyfinApiKey.value,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        els.jfTestMsg.textContent = `Connected to ${data.serverName} (Jellyfin v${data.version}).`;
        els.jfConfigStatus.textContent = `Connected · v${data.version}`;
        els.jfConfigStatus.className = "meta-inline state-ok";
      } else {
        els.jfTestMsg.textContent = data.error || "Jellyfin test failed.";
      }
    } catch (err) {
      els.jfTestMsg.textContent = err.message || "Jellyfin connection error.";
    }
  }

  // ── Local Library Tagger ────────────────────────────────────────────────

  function setLocalMode(mode) {
    state.localMode = mode;
    els.modeServerBtn.classList.toggle("active", mode === "server");
    els.modeBrowserBtn.classList.toggle("active", mode === "browser");
    els.localServerPanel.classList.toggle("hidden", mode !== "server");
    els.localBrowserPanel.classList.toggle("hidden", mode !== "browser");

    if (mode === "browser") {
      if (typeof window.showDirectoryPicker !== "function") {
        els.localIframeNoticeText.textContent =
          "Your current browser does not support the Folder Picker API. Use Server / Mounted Paths or Chrome/Edge in a standalone tab.";
        els.localIframeNotice.classList.remove("hidden");
      } else if (window.self !== window.top) {
        els.localIframeNoticeText.textContent =
          "Browser folder picker may be blocked inside an embedded preview iframe. If blocked, open this page in a new tab or use Server / Mounted Paths.";
        els.localIframeNotice.classList.remove("hidden");
      } else {
        els.localIframeNotice.classList.add("hidden");
      }
    } else {
      els.localIframeNotice.classList.add("hidden");
    }
  }

  function updateLocalControls() {
    const dryRun = els.localDryRun.checked;
    els.btnLocalScan.textContent = dryRun
      ? "Scan Library (Dry Run)"
      : "Scan & Tag Library";
    els.btnLocalScan.disabled = state.localBusy;
    els.btnEmptyScan.disabled = state.localBusy;

    const items = state.localScan?.items ?? [];
    const readyCount = items.filter((i) => i.status === "ready").length;
    els.btnExportSh.disabled = state.localBusy || readyCount === 0;
    els.btnExportPs1.disabled = state.localBusy || readyCount === 0;
    els.btnLocalApply.disabled = state.localBusy || dryRun || readyCount === 0;
    updateTopbarPrimaryButton();
  }

  function recalculateSummary(items) {
    const summary = {
      total: items.length,
      ready: 0,
      alreadyTagged: 0,
      unmatched: 0,
      collision: 0,
      renamed: 0,
      errors: 0,
    };
    for (const item of items) {
      if (item.status === "ready") summary.ready += 1;
      else if (item.status === "already_tagged") summary.alreadyTagged += 1;
      else if (item.status === "unmatched") summary.unmatched += 1;
      else if (item.status === "collision") summary.collision += 1;
      else if (item.status === "renamed") summary.renamed += 1;
      else if (item.status === "error") summary.errors += 1;
    }
    return summary;
  }

  function renderLocalTable() {
    const scan = state.localScan;
    if (!scan) {
      els.localEmpty.classList.remove("hidden");
      els.localTable.classList.add("hidden");
      els.lstatTotal.textContent = "0";
      els.lstatReady.textContent = "0";
      els.lstatTagged.textContent = "0";
      els.lstatUnmatched.textContent = "0";
      els.lstatRenamed.textContent = "0";
      els.lstatErrors.textContent = "0";
      els.localScanMeta.textContent = "No scan run yet";
      updateLocalControls();
      return;
    }

    const summary = recalculateSummary(scan.items);
    scan.summary = summary;

    els.lstatTotal.textContent = summary.total;
    els.lstatReady.textContent = summary.ready;
    els.lstatTagged.textContent = summary.alreadyTagged;
    els.lstatUnmatched.textContent = summary.unmatched;
    els.lstatRenamed.textContent = summary.renamed;
    els.lstatErrors.textContent = summary.errors + summary.collision;

    els.localScanMeta.textContent = `${scan.mode === "server" ? "Server Paths" : "Browser Picker"} · ${scan.dryRun ? "Dry Run" : "Live"} · ${summary.total} items`;

    const query = state.localSearch.trim().toLowerCase();
    const filtered = scan.items.filter((item) => {
      if (state.localFilter === "ready" && item.status !== "ready") return false;
      if (state.localFilter === "unmatched" && item.status !== "unmatched") return false;
      if (state.localFilter === "already_tagged" && item.status !== "already_tagged") return false;
      if (state.localFilter === "error" && item.status !== "error" && item.status !== "collision") {
        return false;
      }
      if (query) {
        const hay = `${item.originalName} ${item.proposedName} ${item.parsedTitle} ${item.matchedTitle || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (scan.items.length === 0) {
      els.localEmpty.classList.remove("hidden");
      els.localTable.classList.add("hidden");
      updateLocalControls();
      return;
    }

    els.localEmpty.classList.add("hidden");
    els.localTable.classList.remove("hidden");
    els.localTableBody.innerHTML = "";

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.style.textAlign = "center";
      td.style.color = "var(--muted)";
      td.textContent = "No items match the selected filter.";
      tr.appendChild(td);
      els.localTableBody.appendChild(tr);
      updateLocalControls();
      return;
    }

    for (const item of filtered) {
      const tr = document.createElement("tr");

      const tdType = document.createElement("td");
      tdType.style.whiteSpace = "nowrap";
      tdType.textContent =
        item.libraryType === "movie"
          ? "Movie"
          : item.kind === "folder"
            ? "TV Folder"
            : "TV Video";

      const tdOrig = document.createElement("td");
      tdOrig.className = "file-cell";
      tdOrig.textContent = item.originalName;
      if (item.parentDir) {
        const sub = document.createElement("span");
        sub.className = "subpath";
        sub.textContent = item.parentDir;
        tdOrig.appendChild(sub);
      }

      const tdProp = document.createElement("td");
      tdProp.className = "file-cell";
      tdProp.textContent = item.proposedName;
      if (item.error) {
        const errSpan = document.createElement("span");
        errSpan.className = "subpath state-err";
        errSpan.textContent = item.error;
        tdProp.appendChild(errSpan);
      }

      const tdMatch = document.createElement("td");
      if (item.tmdbId) {
        const titlePart = item.matchedTitle || item.parsedTitle;
        const yearPart = item.matchedYear ? ` (${item.matchedYear})` : "";
        tdMatch.textContent = `${titlePart}${yearPart} `;
        const idSpan = document.createElement("span");
        idSpan.className = "mono";
        idSpan.style.color = "var(--accent)";
        idSpan.textContent = `[tmdbid-${item.tmdbId}]`;
        tdMatch.appendChild(idSpan);
      } else {
        tdMatch.style.color = "var(--muted)";
        tdMatch.textContent = `Parsed: ${item.parsedTitle}${item.parsedYear ? ` (${item.parsedYear})` : ""}`;
      }

      const tdStatus = document.createElement("td");
      tdStatus.style.whiteSpace = "nowrap";
      const st = statusLabelText(item.status);
      const stSpan = document.createElement("span");
      stSpan.className = st.cls;
      stSpan.textContent = st.text;
      tdStatus.appendChild(stSpan);

      const tdAct = document.createElement("td");
      tdAct.style.whiteSpace = "nowrap";
      if (item.status !== "already_tagged" && item.status !== "renamed") {
        const fixBtn = document.createElement("button");
        fixBtn.type = "button";
        fixBtn.className = "sm";
        fixBtn.textContent = "Fix Match";
        fixBtn.addEventListener("click", () => openOverrideModal(item));
        tdAct.appendChild(fixBtn);
      } else {
        tdAct.style.color = "var(--muted)";
        tdAct.textContent = "—";
      }

      tr.appendChild(tdType);
      tr.appendChild(tdOrig);
      tr.appendChild(tdProp);
      tr.appendChild(tdMatch);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAct);
      els.localTableBody.appendChild(tr);
    }

    updateLocalControls();
  }

  async function pickBrowserFolder(kind) {
    if (typeof window.showDirectoryPicker !== "function") {
      els.localMsg.textContent =
        "Browser folder picker is not available here. Use Server / Mounted Paths or Chrome/Edge in a new tab.";
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (kind === "movie") {
        state.browserHandles.moviesRoot = handle;
        els.pickedMoviesLabel.textContent = `Selected: ${handle.name}`;
      } else {
        state.browserHandles.tvRoot = handle;
        els.pickedTvLabel.textContent = `Selected: ${handle.name}`;
      }
      els.localMsg.textContent = `Selected ${handle.name}. Click Scan Library to match against TMDB.`;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (err && err.name === "SecurityError") {
        els.localIframeNoticeText.textContent =
          "Browser blocked the folder picker inside this iframe. Click 'Open in New Tab' to pick local folders directly, or switch to Server / Mounted Paths.";
        els.localIframeNotice.classList.remove("hidden");
      }
      els.localMsg.textContent = err?.message || "Could not open folder picker.";
    }
  }

  async function collectBrowserDirectoryEntries(
    dirHandle,
    libraryType,
    parentRelPath,
    parentShowKey,
    entries,
    handleMap,
    seqObj
  ) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (isIgnoredName(name)) continue;
      const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;

      if (handle.kind === "directory") {
        if (libraryType === "tv" && !parentShowKey) {
          const id = `brw-${seqObj.n++}`;
          const showKey = relPath;
          entries.push({
            id,
            libraryType: "tv",
            kind: "folder",
            relativePath: relPath,
            parentDir: parentRelPath,
            parentShowKey: showKey,
            originalName: name,
            extension: "",
          });
          handleMap.set(id, { handle, parentDirHandle: dirHandle });
          await collectBrowserDirectoryEntries(
            handle,
            libraryType,
            relPath,
            showKey,
            entries,
            handleMap,
            seqObj
          );
        } else {
          await collectBrowserDirectoryEntries(
            handle,
            libraryType,
            relPath,
            parentShowKey,
            entries,
            handleMap,
            seqObj
          );
        }
      } else if (handle.kind === "file") {
        const ext = getFileExtension(name);
        if (!VIDEO_EXTENSIONS.has(ext.toLowerCase())) continue;
        const id = `brw-${seqObj.n++}`;
        entries.push({
          id,
          libraryType,
          kind: "file",
          relativePath: relPath,
          parentDir: parentRelPath,
          parentShowKey,
          originalName: name,
          extension: ext,
        });
        handleMap.set(id, { handle, parentDirHandle: dirHandle });
      }
    }
  }

  async function applyBrowserRenames(items) {
    const ordered = items
      .filter((item) => item.status === "ready" && item.tmdbId)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "file" ? -1 : 1;
        return b.originalPath.length - a.originalPath.length;
      });

    let folderUnsupportedCount = 0;

    for (const item of ordered) {
      const ref = state.browserHandles.entriesById.get(item.id);
      if (!ref) {
        item.status = "error";
        item.error = "Browser file handle expired — re-scan folder.";
        continue;
      }

      if (typeof ref.handle.move !== "function") {
        if (item.kind === "folder") {
          folderUnsupportedCount += 1;
          item.status = "error";
          item.error = "Browser does not support folder.move() — use Download .sh / .ps1 Script.";
        } else {
          item.status = "error";
          item.error = "Browser does not support file.move() — use Download .sh / .ps1 Script.";
        }
        continue;
      }

      try {
        // Check collision in parent directory
        let exists = false;
        try {
          if (item.kind === "file") {
            await ref.parentDirHandle.getFileHandle(item.proposedName);
          } else {
            await ref.parentDirHandle.getDirectoryHandle(item.proposedName);
          }
          exists = true;
        } catch {
          exists = false;
        }

        if (exists && item.proposedName !== item.originalName) {
          item.status = "collision";
          item.error = "Target already exists";
          continue;
        }

        await ref.handle.move(item.proposedName);
        item.originalName = item.proposedName;
        item.originalPath = item.proposedPath;
        item.status = "renamed";
        item.error = undefined;
      } catch (err) {
        item.status = "error";
        item.error = err?.message || "Rename failed in browser.";
      }
    }

    return folderUnsupportedCount;
  }

  async function runLocalScan() {
    if (state.localBusy) return;
    const dryRun = els.localDryRun.checked;
    state.localBusy = true;
    els.localMsg.textContent = "Scanning folders and querying TMDB...";
    updateLocalControls();

    try {
      if (state.localMode === "server") {
        const moviePaths = els.moviePathsInput.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const tvPaths = els.tvPathsInput.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

        const res = await fetch("/api/local/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moviePaths, tvPaths, dryRun }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          els.localMsg.textContent = data.error || "Local scan failed.";
        } else {
          state.localScan = data.result;
          renderLocalTable();
          if (!dryRun && data.result.summary.ready > 0) {
            if (data.result.summary.errors === 0 && data.result.summary.collision === 0) {
              await applyLocalRenamesInternal();
              return;
            }
            els.localMsg.textContent =
              "Scan finished with warnings/errors. Review items below before clicking Apply Renames to Disk.";
          } else {
            els.localMsg.textContent = dryRun
              ? `Dry Run complete: ${data.result.summary.ready} ready to tag, ${data.result.summary.unmatched} need review.`
              : "Scan complete.";
          }
        }
      } else {
        const entries = [];
        const handleMap = new Map();
        const seqObj = { n: 1 };

        if (state.browserHandles.moviesRoot) {
          await collectBrowserDirectoryEntries(
            state.browserHandles.moviesRoot,
            "movie",
            state.browserHandles.moviesRoot.name,
            undefined,
            entries,
            handleMap,
            seqObj
          );
        }
        if (state.browserHandles.tvRoot) {
          await collectBrowserDirectoryEntries(
            state.browserHandles.tvRoot,
            "tv",
            state.browserHandles.tvRoot.name,
            undefined,
            entries,
            handleMap,
            seqObj
          );
        }

        if (entries.length === 0) {
          els.localMsg.textContent =
            "Select a Movies or TV Shows folder containing video files first.";
          state.localBusy = false;
          updateLocalControls();
          return;
        }

        state.browserHandles.entriesById = handleMap;

        const res = await fetch("/api/local/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries, dryRun }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          els.localMsg.textContent = data.error || "TMDB matching failed.";
        } else {
          state.localScan = data.result;
          renderLocalTable();
          if (!dryRun && data.result.summary.ready > 0) {
            await applyLocalRenamesInternal();
            return;
          }
          els.localMsg.textContent = dryRun
            ? `Dry Run complete: ${data.result.summary.ready} ready to tag, ${data.result.summary.unmatched} need review.`
            : "Scan complete.";
        }
      }
    } catch (err) {
      els.localMsg.textContent = err?.message || "Scan error.";
    } finally {
      state.localBusy = false;
      updateLocalControls();
    }
  }

  async function applyLocalRenamesInternal() {
    if (!state.localScan) return;
    if (els.localDryRun.checked) {
      els.localMsg.textContent =
        "Dry Run is still enabled. Uncheck Dry Run first to apply renames.";
      return;
    }

    state.localBusy = true;
    els.localMsg.textContent = "Applying [tmdbid-ID] renames...";
    updateLocalControls();

    try {
      if (state.localScan.mode === "server") {
        const res = await fetch("/api/local/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: state.localScan.items,
            dryRun: false,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          els.localMsg.textContent = data.error || "Failed to apply renames.";
        } else {
          state.localScan.items = data.items;
          state.localScan.dryRun = false;
          renderLocalTable();
          els.localMsg.textContent = `Tagging complete: ${data.summary.renamed} renamed, ${data.summary.errors + data.summary.collision} errors/collisions.`;
        }
      } else {
        const folderUnsupported = await applyBrowserRenames(state.localScan.items);
        state.localScan.dryRun = false;
        renderLocalTable();
        const s = state.localScan.summary;
        els.localMsg.textContent =
          folderUnsupported > 0
            ? `Renamed ${s.renamed} files. ${folderUnsupported} TV folders require the downloadable .sh / .ps1 script due to browser folder.move() limits.`
            : `Tagging complete: ${s.renamed} renamed, ${s.errors + s.collision} errors.`;
      }
    } catch (err) {
      els.localMsg.textContent = err?.message || "Failed to apply renames.";
    } finally {
      state.localBusy = false;
      updateLocalControls();
    }
  }

  async function downloadRenameScript(format) {
    if (!state.localScan) return;
    try {
      const res = await fetch("/api/local/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: state.localScan.items, format }),
      });
      if (!res.ok) {
        els.localMsg.textContent = "Could not generate rename script.";
        return;
      }
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jellyfin-tmdb-rename.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      els.localMsg.textContent = `Downloaded jellyfin-tmdb-rename.${format}.`;
    } catch (err) {
      els.localMsg.textContent = err?.message || "Download failed.";
    }
  }

  // ── Server Directory Browser Modal ──────────────────────────────────────

  async function loadBrowsePath(targetPath) {
    const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
    const res = await fetch(`/api/local/browse${qs}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      els.browseList.innerHTML = `<div class="list-row"><span class="state-err">${data.error || "Cannot list directory"}</span></div>`;
      return;
    }
    state.browseCurrentPath = data.currentPath;
    state.browseParentPath = data.parentPath;
    els.browseCurrentInput.value = data.currentPath;
    els.btnBrowseUp.disabled = !data.parentPath;

    els.browseList.innerHTML = "";
    if (!data.directories || data.directories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-row";
      empty.style.color = "var(--muted)";
      empty.textContent = "No subdirectories inside this folder.";
      els.browseList.appendChild(empty);
      return;
    }

    for (const dir of data.directories) {
      const row = document.createElement("div");
      row.className = "list-row";
      const nameSpan = document.createElement("span");
      nameSpan.className = "mono";
      nameSpan.style.fontSize = "0.84rem";
      nameSpan.textContent = dir.name;

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "sm";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => loadBrowsePath(dir.path));

      row.appendChild(nameSpan);
      row.appendChild(openBtn);
      els.browseList.appendChild(row);
    }
  }

  function openBrowseModal(target) {
    state.browseTarget = target;
    els.browseModal.classList.add("open");
    const existing =
      target === "movie"
        ? els.moviePathsInput.value.split(/\r?\n/)[0]?.trim()
        : els.tvPathsInput.value.split(/\r?\n/)[0]?.trim();
    void loadBrowsePath(existing || "");
  }

  function selectBrowsedFolder() {
    const box = state.browseTarget === "movie" ? els.moviePathsInput : els.tvPathsInput;
    const currentLines = box.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!currentLines.includes(state.browseCurrentPath)) {
      currentLines.push(state.browseCurrentPath);
    }
    box.value = currentLines.join("\n");
    els.browseModal.classList.remove("open");
  }

  // ── Manual TMDB Override Modal ──────────────────────────────────────────

  function openOverrideModal(item) {
    state.overrideItemId = item.id;
    els.overrideItemLabel.textContent = item.originalName;
    els.overrideQuery.value = item.parsedTitle || "";
    els.overrideYear.value = item.parsedYear ? String(item.parsedYear) : "";
    els.overrideMsg.textContent = "";
    els.overrideResults.innerHTML = "";
    els.overrideModal.classList.add("open");
    void runOverrideSearch();
  }

  async function runOverrideSearch() {
    const item = state.localScan?.items.find((i) => i.id === state.overrideItemId);
    if (!item) return;

    const query = els.overrideQuery.value.trim();
    const year = els.overrideYear.value.trim();
    if (!query) {
      els.overrideMsg.textContent = "Enter a title to search TMDB.";
      return;
    }

    els.overrideMsg.textContent = "Searching TMDB...";
    els.overrideResults.innerHTML = "";

    try {
      const params = new URLSearchParams({
        type: item.libraryType,
        query,
      });
      if (year) params.set("year", year);

      const res = await fetch(`/api/tmdb/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        els.overrideMsg.textContent = data.error || "Search failed.";
        return;
      }

      if (!data.results || data.results.length === 0) {
        els.overrideMsg.textContent = "No TMDB matches found.";
        return;
      }

      els.overrideMsg.textContent = "";
      for (const match of data.results) {
        const row = document.createElement("div");
        row.className = "list-row";

        const info = document.createElement("div");
        const titleEl = document.createElement("div");
        titleEl.style.fontWeight = "600";
        titleEl.textContent = `${match.title}${match.year ? ` (${match.year})` : ""} · [tmdbid-${match.id}]`;

        const descEl = document.createElement("div");
        descEl.style.fontSize = "0.78rem";
        descEl.style.color = "var(--muted)";
        descEl.textContent = (match.overview || "").slice(0, 140);

        info.appendChild(titleEl);
        if (match.overview) info.appendChild(descEl);

        const pickBtn = document.createElement("button");
        pickBtn.type = "button";
        pickBtn.className = "sm primary";
        pickBtn.textContent = "Select";
        pickBtn.addEventListener("click", () => applyOverrideSelection(match));

        row.appendChild(info);
        row.appendChild(pickBtn);
        els.overrideResults.appendChild(row);
      }
    } catch (err) {
      els.overrideMsg.textContent = err?.message || "TMDB search failed.";
    }
  }

  async function applyOverrideSelection(match) {
    if (!state.localScan) return;
    const targetItem = state.localScan.items.find((i) => i.id === state.overrideItemId);
    if (!targetItem) return;

    const toUpdate = [targetItem];
    // If overriding a TV show folder, cascade the TMDB ID to all untagged child videos in that folder
    if (
      targetItem.libraryType === "tv" &&
      targetItem.kind === "folder" &&
      targetItem.parentShowKey
    ) {
      for (const candidate of state.localScan.items) {
        if (
          candidate.id !== targetItem.id &&
          candidate.parentShowKey === targetItem.parentShowKey &&
          candidate.status !== "already_tagged" &&
          candidate.status !== "renamed"
        ) {
          toUpdate.push(candidate);
        }
      }
    }

    for (const item of toUpdate) {
      const res = await fetch("/api/local/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item,
          mode: state.localScan.mode,
          tmdbId: match.id,
          matchedTitle: match.title,
          matchedYear: match.year || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const idx = state.localScan.items.findIndex((x) => x.id === item.id);
        if (idx >= 0) {
          state.localScan.items[idx] = data.item;
        }
      }
    }

    els.overrideModal.classList.remove("open");
    renderLocalTable();
    els.localMsg.textContent = `Updated match to ${match.title} [tmdbid-${match.id}].`;
  }

  // ── Wire Events ─────────────────────────────────────────────────────────

  document.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.getAttribute("data-route") || "/");
    });
  });

  window.addEventListener("popstate", () => {
    navigate(window.location.pathname, false);
  });

  els.menuToggle.addEventListener("click", () => {
    els.sidebar.classList.toggle("open");
    els.sidebarBackdrop.classList.toggle("open");
  });

  els.sidebarBackdrop.addEventListener("click", closeSidebar);

  els.topbarPrimaryBtn.addEventListener("click", () => {
    if (state.currentRoute === "/") {
      void triggerNetworkRun(true);
    } else if (state.currentRoute === "/local-tagger") {
      void runLocalScan();
    } else {
      void saveSettings();
    }
  });

  // Network Tagger controls
  els.btnDryRun.addEventListener("click", () => void triggerNetworkRun(true));
  els.btnLiveRun.addEventListener("click", () => void triggerNetworkRun(false));
  els.btnRefresh.addEventListener("click", () => void loadStatus());

  els.btnTestProvider.addEventListener("click", async () => {
    const name = els.testProviderInput.value.trim();
    if (!name) {
      els.testProviderResult.textContent = "Enter a provider name to normalise.";
      return;
    }
    const res = await fetch(`/api/providers?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.sample) {
      els.testProviderResult.textContent = `"${data.sample.raw}" → "${data.sample.normalized}"`;
    }
  });

  // Settings controls
  els.configForm.addEventListener("submit", (e) => void saveSettings(e));
  els.btnTestTmdb.addEventListener("click", () => void testTmdbConnection());
  els.btnTestJf.addEventListener("click", () => void testJellyfinConnection());

  // Local Library Tagger controls
  els.modeServerBtn.addEventListener("click", () => setLocalMode("server"));
  els.modeBrowserBtn.addEventListener("click", () => setLocalMode("browser"));
  els.localDryRun.addEventListener("change", updateLocalControls);
  els.btnLocalScan.addEventListener("click", () => void runLocalScan());
  els.btnEmptyScan.addEventListener("click", () => void runLocalScan());
  els.btnLocalApply.addEventListener("click", () => void applyLocalRenamesInternal());
  els.btnExportSh.addEventListener("click", () => void downloadRenameScript("sh"));
  els.btnExportPs1.addEventListener("click", () => void downloadRenameScript("ps1"));

  els.btnBrowseMovie.addEventListener("click", () => openBrowseModal("movie"));
  els.btnBrowseTv.addEventListener("click", () => openBrowseModal("tv"));
  els.btnPickMovies.addEventListener("click", () => void pickBrowserFolder("movie"));
  els.btnPickTv.addEventListener("click", () => void pickBrowserFolder("tv"));

  document.querySelectorAll("[data-local-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.localFilter = btn.getAttribute("data-local-filter") || "all";
      document.querySelectorAll("[data-local-filter]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderLocalTable();
    });
  });

  els.localSearchInput.addEventListener("input", () => {
    state.localSearch = els.localSearchInput.value;
    renderLocalTable();
  });

  // Browse modal controls
  els.btnBrowseClose.addEventListener("click", () => els.browseModal.classList.remove("open"));
  els.btnBrowseGo.addEventListener("click", () => void loadBrowsePath(els.browseCurrentInput.value));
  els.btnBrowseUp.addEventListener("click", () => {
    if (state.browseParentPath) void loadBrowsePath(state.browseParentPath);
  });
  els.btnBrowseSelect.addEventListener("click", selectBrowsedFolder);

  // Override modal controls
  els.btnOverrideClose.addEventListener("click", () => els.overrideModal.classList.remove("open"));
  els.btnOverrideSearch.addEventListener("click", () => void runOverrideSearch());

  // Initialize
  navigate(window.location.pathname, false);
  setLocalMode("server");
  renderLocalTable();
  void loadStatus();
  void loadProviders();
  setInterval(() => void loadStatus(), 5000);
})();
