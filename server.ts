import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyServerRenames,
  browseServerDirectory,
  buildTaggedName,
  generateRenameScript,
  matchBrowserEntries,
  scanServerLibraries,
  tmdbSearch,
  type BrowserEntryInput,
  type LibraryType,
  type LocalMediaItem,
} from "./src/localTagger.ts";
import { PROVIDER_NAME_MAP, TaggerService, normalise } from "./src/tagger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10) || 3000;
const HOST = "0.0.0.0";

const tagger = new TaggerService();

app.use(express.json({ limit: "5mb" }));
app.use("/docs", express.static(path.join(__dirname, "docs")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  const status = tagger.getPublicStatus();
  res.json({
    status: "ok",
    configured: status.configured,
    tmdbConfigured: status.tmdbConfigured,
    isRunning: status.isRunning,
    lastRun: status.lastRun,
  });
});

app.get("/api/status", (_req, res) => {
  res.json(tagger.getPublicStatus());
});

app.get("/api/providers", (req, res) => {
  const query = typeof req.query.name === "string" ? req.query.name.trim() : "";
  res.json({
    map: PROVIDER_NAME_MAP,
    sample: query ? { raw: query, normalized: normalise(query) } : null,
  });
});

app.post("/api/config", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ignoreRaw = body.ignoreProviders;
  const ignoreProviders = Array.isArray(ignoreRaw)
    ? ignoreRaw.map((v) => String(v))
    : typeof ignoreRaw === "string"
      ? ignoreRaw.split(",")
      : undefined;

  tagger.updateConfig({
    jellyfinUrl: typeof body.jellyfinUrl === "string" ? body.jellyfinUrl : undefined,
    jellyfinApiKey: typeof body.jellyfinApiKey === "string" ? body.jellyfinApiKey : undefined,
    tmdbApiKey: typeof body.tmdbApiKey === "string" ? body.tmdbApiKey : undefined,
    tmdbCountry: typeof body.tmdbCountry === "string" ? body.tmdbCountry : undefined,
    runIntervalHours:
      body.runIntervalHours !== undefined ? Number(body.runIntervalHours) : undefined,
    dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
    ignoreProviders,
  });

  res.json(tagger.getPublicStatus());
});

app.post("/api/tmdb/test", async (req, res) => {
  const body = (req.body ?? {}) as { tmdbApiKey?: unknown };
  const overrideKey = typeof body.tmdbApiKey === "string" ? body.tmdbApiKey : undefined;
  const result = await tagger.testTmdbConnection(overrideKey);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/jellyfin/test", async (req, res) => {
  const body = (req.body ?? {}) as { jellyfinUrl?: unknown; jellyfinApiKey?: unknown };
  const overrideUrl = typeof body.jellyfinUrl === "string" ? body.jellyfinUrl : undefined;
  const overrideKey = typeof body.jellyfinApiKey === "string" ? body.jellyfinApiKey : undefined;
  const result = await tagger.testJellyfinConnection(overrideUrl, overrideKey);
  res.status(result.ok ? 200 : 400).json(result);
});

app.get("/api/tmdb/search", async (req, res) => {
  const tmdbErr = tagger.getTmdbValidationError();
  if (tmdbErr) {
    res.status(400).json({ ok: false, error: tmdbErr });
    return;
  }

  const mediaType: LibraryType = req.query.type === "tv" ? "tv" : "movie";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const yearRaw = typeof req.query.year === "string" ? Number.parseInt(req.query.year, 10) : NaN;
  const year = Number.isFinite(yearRaw) ? yearRaw : null;

  if (!query) {
    res.status(400).json({ ok: false, error: "Search query is required." });
    return;
  }

  try {
    const results = await tmdbSearch(tagger.getTmdbApiKey(), mediaType, query, year);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/run", async (req, res) => {
  const body = (req.body ?? {}) as { dryRun?: boolean };
  try {
    const summary = await tagger.runTaggingJob(
      typeof body.dryRun === "boolean" ? body.dryRun : undefined
    );
    res.json({ ok: true, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes("already running") ? 409 : 400;
    res.status(statusCode).json({ ok: false, error: message });
  }
});

app.get("/api/local/browse", async (req, res) => {
  const targetPath = typeof req.query.path === "string" ? req.query.path : undefined;
  try {
    const listing = await browseServerDirectory(targetPath);
    res.json({ ok: true, ...listing });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/local/scan", async (req, res) => {
  const tmdbErr = tagger.getTmdbValidationError();
  if (tmdbErr) {
    res.status(400).json({
      ok: false,
      error: `${tmdbErr} Add your TMDB API Key or Read Access Token in Settings first.`,
    });
    return;
  }

  const body = (req.body ?? {}) as {
    moviePaths?: unknown;
    tvPaths?: unknown;
    dryRun?: unknown;
  };
  const moviePaths = Array.isArray(body.moviePaths)
    ? body.moviePaths.map((p) => String(p))
    : typeof body.moviePaths === "string"
      ? body.moviePaths.split(/\r?\n/)
      : [];
  const tvPaths = Array.isArray(body.tvPaths)
    ? body.tvPaths.map((p) => String(p))
    : typeof body.tvPaths === "string"
      ? body.tvPaths.split(/\r?\n/)
      : [];
  const dryRun = body.dryRun === undefined ? true : Boolean(body.dryRun);

  try {
    tagger.updateLocalPaths(moviePaths, tvPaths);
    const result = await scanServerLibraries({
      moviePaths,
      tvPaths,
      apiKey: tagger.getTmdbApiKey(),
      dryRun,
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/local/match", async (req, res) => {
  const tmdbErr = tagger.getTmdbValidationError();
  if (tmdbErr) {
    res.status(400).json({
      ok: false,
      error: `${tmdbErr} Add your TMDB API Key or Read Access Token in Settings first.`,
    });
    return;
  }

  const body = (req.body ?? {}) as {
    entries?: BrowserEntryInput[];
    dryRun?: boolean;
  };
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) {
    res.status(400).json({ ok: false, error: "No video files or TV folders found to match." });
    return;
  }

  try {
    const result = await matchBrowserEntries({
      entries,
      apiKey: tagger.getTmdbApiKey(),
      dryRun: body.dryRun === undefined ? true : Boolean(body.dryRun),
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/local/override", async (req, res) => {
  const body = (req.body ?? {}) as {
    item?: LocalMediaItem;
    mode?: "server" | "browser";
    tmdbId?: number;
    matchedTitle?: string;
    matchedYear?: string | null;
  };

  if (!body.item || !body.tmdbId || !Number.isFinite(Number(body.tmdbId))) {
    res.status(400).json({ ok: false, error: "Valid item and TMDB ID are required." });
    return;
  }

  const item = { ...body.item };
  const tmdbId = Number(body.tmdbId);
  const proposedName = buildTaggedName(item.originalName, item.extension, item.kind, tmdbId);
  const proposedPath =
    body.mode === "server"
      ? path.join(item.parentDir, proposedName)
      : item.parentDir
        ? `${item.parentDir}/${proposedName}`
        : proposedName;

  let collision = false;
  if (body.mode === "server" && proposedPath !== item.originalPath) {
    collision = await fs
      .access(proposedPath)
      .then(() => true)
      .catch(() => false);
  }

  item.tmdbId = tmdbId;
  item.matchedTitle = body.matchedTitle ?? item.matchedTitle ?? item.parsedTitle;
  item.matchedYear = body.matchedYear ?? item.matchedYear;
  item.proposedName = proposedName;
  item.proposedPath = proposedPath;
  item.status =
    proposedName === item.originalName
      ? "already_tagged"
      : collision
        ? "collision"
        : "ready";
  item.error = collision ? "Target filename already exists" : undefined;

  res.json({ ok: true, item });
});

app.post("/api/local/apply", async (req, res) => {
  const body = (req.body ?? {}) as {
    items?: LocalMediaItem[];
    dryRun?: boolean;
  };

  if (body.dryRun !== false) {
    res.status(400).json({
      ok: false,
      error: "Dry Run is enabled. Disable Dry Run before applying renames to disk.",
    });
    return;
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    res.status(400).json({ ok: false, error: "No scanned items to rename." });
    return;
  }

  try {
    const outcome = await applyServerRenames(items);
    res.json({ ok: true, ...outcome });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/local/script", (req, res) => {
  const body = (req.body ?? {}) as {
    items?: LocalMediaItem[];
    format?: string;
  };
  const items = Array.isArray(body.items) ? body.items : [];
  const format = body.format === "ps1" ? "ps1" : "sh";
  const script = generateRenameScript(items, format);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="jellyfin-tmdb-rename.${format}"`
  );
  res.send(script);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  tagger.addLog("INFO", `Jellyfin Network Tagger server listening on http://${HOST}:${PORT}`);
  tagger.startScheduler();

  const configError = tagger.getConfigValidationError();
  if (!configError) {
    void tagger.runTaggingJob(undefined, true).catch(() => {
      // Failure details are already recorded in tagger logs and lastRun status.
    });
  } else {
    tagger.addLog(
      "WARN",
      `${configError} Configure real Jellyfin and TMDB credentials via Settings or .env to run a scan.`
    );
  }
});
