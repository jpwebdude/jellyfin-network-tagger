import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTmdbRequest } from "./tagger.ts";

export type LibraryType = "movie" | "tv";
export type ItemKind = "file" | "folder";
export type LocalItemStatus =
  | "ready"
  | "already_tagged"
  | "unmatched"
  | "collision"
  | "renamed"
  | "error";

export interface TmdbSearchResult {
  id: number;
  title: string;
  year: string;
  mediaType: LibraryType;
  overview: string;
}

export interface LocalMediaItem {
  id: string;
  libraryType: LibraryType;
  kind: ItemKind;
  originalPath: string;
  parentDir: string;
  parentShowKey?: string;
  originalName: string;
  extension: string;
  parsedTitle: string;
  parsedYear: number | null;
  tmdbId: number | null;
  matchedTitle: string | null;
  matchedYear: string | null;
  proposedName: string;
  proposedPath: string;
  status: LocalItemStatus;
  error?: string;
}

export interface LocalScanSummary {
  total: number;
  ready: number;
  alreadyTagged: number;
  unmatched: number;
  collision: number;
  renamed: number;
  errors: number;
}

export interface LocalScanResult {
  mode: "server" | "browser";
  dryRun: boolean;
  scannedAt: string;
  summary: LocalScanSummary;
  items: LocalMediaItem[];
}

export interface BrowserEntryInput {
  id: string;
  libraryType: LibraryType;
  kind: ItemKind;
  relativePath: string;
  parentDir: string;
  parentShowKey?: string;
  originalName: string;
  extension: string;
}

export const VIDEO_EXTENSIONS = new Set([
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

const TMDB_TAG_REGEX = /\[(?:tmdbid|tmdb)-(\d+)\]/i;

const FORBIDDEN_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
]);

const NOISE_CUTOFF_REGEX =
  /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10\+?|\bhdr\b|dv|dolby\.?vision|bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|hdrip|dvdrip|remux|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|eac3|dts(?:-hd)?|truehd|atmos|10bit|8bit|proper|repack|extended|unrated|directors\.?cut)\b/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractExistingTmdbId(name: string): number | null {
  const match = name.match(TMDB_TAG_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildTaggedName(
  originalName: string,
  extension: string,
  kind: ItemKind,
  tmdbId: number
): string {
  const tag = `[tmdbid-${tmdbId}]`;
  if (kind === "folder") {
    const cleaned = originalName.replace(TMDB_TAG_REGEX, "").trim();
    return `${cleaned} ${tag}`;
  }
  const stem = extension && originalName.toLowerCase().endsWith(extension.toLowerCase())
    ? originalName.slice(0, -extension.length)
    : originalName;
  const cleanedStem = stem.replace(TMDB_TAG_REGEX, "").trim();
  return `${cleanedStem} ${tag}${extension}`;
}

export function parseMediaName(
  rawName: string,
  isTvEpisode = false
): { title: string; year: number | null } {
  let working = rawName
    .replace(/\[(?:tmdbid|tmdb|imdbid|imdb|tvdbid|tvdb)-[^\]]+\]/gi, " ")
    .replace(/\{(?:tmdb|imdb|tvdb)-\d+\}/gi, " ")
    .replace(/\[[^\]]+\]/g, " ");

  if (isTvEpisode) {
    const epMatch = working.match(/\b(?:S\d{1,2}E\d{1,3}|\d{1,2}x\d{2}|Season\s+\d+)\b/i);
    if (epMatch && epMatch.index !== undefined && epMatch.index > 0) {
      working = working.slice(0, epMatch.index);
    }
  }

  working = working.replace(/[._]+/g, " ");

  const cutoff = working.match(NOISE_CUTOFF_REGEX);
  if (cutoff && cutoff.index !== undefined && cutoff.index > 0) {
    working = working.slice(0, cutoff.index);
  }

  // Prefer explicit parenthesized year: Title (2020)
  let year: number | null = null;
  const parenYears = [...working.matchAll(/\((\b(?:19\d{2}|20\d{2})\b)\)/g)];
  if (parenYears.length > 0) {
    const lastParen = parenYears[parenYears.length - 1];
    year = Number.parseInt(lastParen[1], 10);
    if (lastParen.index !== undefined) {
      working = working.slice(0, lastParen.index);
    }
  } else {
    // Fallback: standalone 4-digit year not at index 0 (protects titles like "2001 A Space Odyssey")
    const bareYears = [...working.matchAll(/\b(19\d{2}|20\d{2})\b/g)].filter(
      (m) => (m.index ?? 0) > 0
    );
    if (bareYears.length > 0) {
      const lastBare = bareYears[bareYears.length - 1];
      year = Number.parseInt(lastBare[1], 10);
      if (lastBare.index !== undefined) {
        working = working.slice(0, lastBare.index);
      }
    }
  }

  const title = working
    .replace(/[()]/g, " ")
    .replace(/[-–—:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { title: title || rawName.trim(), year };
}

export function summarizeItems(items: LocalMediaItem[]): LocalScanSummary {
  const summary: LocalScanSummary = {
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

export async function tmdbSearch(
  apiKey: string,
  mediaType: LibraryType,
  query: string,
  year?: number | null
): Promise<TmdbSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const runSearch = async (withYear: boolean): Promise<TmdbSearchResult[]> => {
    const params = new URLSearchParams({
      query: cleanQuery,
      include_adult: "false",
    });
    if (withYear && year) {
      params.set(mediaType === "movie" ? "year" : "first_air_date_year", String(year));
    }
    const req = buildTmdbRequest(`/search/${mediaType}?${params.toString()}`, apiKey);
    const resp = await fetch(req.url, {
      headers: req.headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`TMDB search failed (HTTP ${resp.status}): ${text.slice(0, 180)}`);
    }
    const data = (await resp.json()) as {
      results?: Array<{
        id: number;
        title?: string;
        name?: string;
        release_date?: string;
        first_air_date?: string;
        overview?: string;
      }>;
    };
    return (data.results ?? []).slice(0, 6).map((row) => ({
      id: row.id,
      title: (mediaType === "movie" ? row.title : row.name) ?? "Untitled",
      year: ((mediaType === "movie" ? row.release_date : row.first_air_date) ?? "").slice(0, 4),
      mediaType,
      overview: row.overview ?? "",
    }));
  };

  const results = await runSearch(Boolean(year));
  if (results.length > 0 || !year) {
    return results;
  }
  return runSearch(false);
}

async function validateDirectoryPath(rawPath: string): Promise<string> {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error(`Invalid directory path: "${rawPath}"`);
  }
  const resolved = path.resolve(trimmed);
  if (FORBIDDEN_ROOTS.has(resolved)) {
    throw new Error(`Scanning system directory "${resolved}" is not allowed.`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Directory not found or not readable: "${resolved}"`);
  }
  return resolved;
}

function isIgnoredEntry(name: string): boolean {
  return (
    name.startsWith(".") ||
    name === "@eaDir" ||
    name === "#recycle" ||
    name === "System Volume Information" ||
    name === "$RECYCLE.BIN"
  );
}

async function collectVideosRecursively(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectVideosRecursively(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function browseServerDirectory(targetPath?: string): Promise<{
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
}> {
  let candidate = (targetPath ?? "").trim();
  if (!candidate) {
    candidate = os.homedir() || "/";
  }
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  const effectivePath = stat && stat.isDirectory() ? resolved : "/";
  const parent = path.dirname(effectivePath);
  const entries = await fs.readdir(effectivePath, { withFileTypes: true }).catch(() => []);
  const directories = entries
    .filter((e) => e.isDirectory() && !isIgnoredEntry(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      path: path.join(effectivePath, e.name),
    }));

  return {
    currentPath: effectivePath,
    parentPath: parent !== effectivePath ? parent : null,
    directories,
  };
}

export async function scanServerLibraries(params: {
  moviePaths: string[];
  tvPaths: string[];
  apiKey: string;
  dryRun: boolean;
}): Promise<LocalScanResult> {
  const movieRoots = params.moviePaths.map((p) => p.trim()).filter(Boolean);
  const tvRoots = params.tvPaths.map((p) => p.trim()).filter(Boolean);

  if (movieRoots.length === 0 && tvRoots.length === 0) {
    throw new Error("Provide at least one Movie or TV Show folder path to scan.");
  }

  const validMovies = await Promise.all(movieRoots.map(validateDirectoryPath));
  const validTv = await Promise.all(tvRoots.map(validateDirectoryPath));

  const searchCache = new Map<string, TmdbSearchResult | null>();
  const lookupCached = async (
    mediaType: LibraryType,
    title: string,
    year: number | null
  ): Promise<TmdbSearchResult | null> => {
    const key = `${mediaType}:${title.toLowerCase()}:${year ?? ""}`;
    if (searchCache.has(key)) {
      return searchCache.get(key) ?? null;
    }
    const matches = await tmdbSearch(params.apiKey, mediaType, title, year);
    const best = matches[0] ?? null;
    searchCache.set(key, best);
    await sleep(90);
    return best;
  };

  const items: LocalMediaItem[] = [];
  let seq = 1;

  // 1. Scan Movie Libraries (video files)
  for (const rootDir of validMovies) {
    const videoFiles = await collectVideosRecursively(rootDir);
    for (const filePath of videoFiles) {
      const originalName = path.basename(filePath);
      const ext = path.extname(originalName);
      const parentDir = path.dirname(filePath);
      const stem = originalName.slice(0, -ext.length);
      const existingId = extractExistingTmdbId(stem);

      let parsed = parseMediaName(stem, false);
      // Fallback to immediate movie folder if filename is generic or lacks year while folder has one
      if (parentDir !== rootDir) {
        const folderParsed = parseMediaName(path.basename(parentDir), false);
        if (parsed.title.length < 2 || (!parsed.year && folderParsed.year)) {
          parsed = {
            title: parsed.title.length < 2 ? folderParsed.title : parsed.title,
            year: parsed.year ?? folderParsed.year,
          };
        }
      }

      if (existingId) {
        items.push({
          id: `srv-${seq++}`,
          libraryType: "movie",
          kind: "file",
          originalPath: filePath,
          parentDir,
          originalName,
          extension: ext,
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: existingId,
          matchedTitle: parsed.title,
          matchedYear: parsed.year ? String(parsed.year) : null,
          proposedName: originalName,
          proposedPath: filePath,
          status: "already_tagged",
        });
        continue;
      }

      try {
        const match = await lookupCached("movie", parsed.title, parsed.year);
        if (!match) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "movie",
            kind: "file",
            originalPath: filePath,
            parentDir,
            originalName,
            extension: ext,
            parsedTitle: parsed.title,
            parsedYear: parsed.year,
            tmdbId: null,
            matchedTitle: null,
            matchedYear: null,
            proposedName: originalName,
            proposedPath: filePath,
            status: "unmatched",
          });
          continue;
        }

        const proposedName = buildTaggedName(originalName, ext, "file", match.id);
        const proposedPath = path.join(parentDir, proposedName);
        const collision =
          proposedPath !== filePath && (await fileExists(proposedPath));

        items.push({
          id: `srv-${seq++}`,
          libraryType: "movie",
          kind: "file",
          originalPath: filePath,
          parentDir,
          originalName,
          extension: ext,
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: match.id,
          matchedTitle: match.title,
          matchedYear: match.year || null,
          proposedName,
          proposedPath,
          status: collision ? "collision" : "ready",
          error: collision ? "Target filename already exists" : undefined,
        });
      } catch (err) {
        items.push({
          id: `srv-${seq++}`,
          libraryType: "movie",
          kind: "file",
          originalPath: filePath,
          parentDir,
          originalName,
          extension: ext,
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: null,
          matchedTitle: null,
          matchedYear: null,
          proposedName: originalName,
          proposedPath: filePath,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 2. Scan TV Show Libraries (both TV show folders AND video files)
  for (const rootDir of validTv) {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullEntryPath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        const showFolderName = entry.name;
        const parsedShow = parseMediaName(showFolderName, false);
        const existingFolderId = extractExistingTmdbId(showFolderName);

        let resolvedTmdbId: number | null = existingFolderId;
        let resolvedTitle: string | null = existingFolderId ? parsedShow.title : null;
        let resolvedYear: string | null = existingFolderId && parsedShow.year
          ? String(parsedShow.year)
          : null;
        let folderLookupError: string | undefined;

        if (!resolvedTmdbId) {
          try {
            const match = await lookupCached("tv", parsedShow.title, parsedShow.year);
            if (match) {
              resolvedTmdbId = match.id;
              resolvedTitle = match.title;
              resolvedYear = match.year || null;
            }
          } catch (err) {
            folderLookupError = err instanceof Error ? err.message : String(err);
          }
        }

        if (existingFolderId) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "folder",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            parentShowKey: fullEntryPath,
            originalName: showFolderName,
            extension: "",
            parsedTitle: parsedShow.title,
            parsedYear: parsedShow.year,
            tmdbId: existingFolderId,
            matchedTitle: resolvedTitle,
            matchedYear: resolvedYear,
            proposedName: showFolderName,
            proposedPath: fullEntryPath,
            status: "already_tagged",
          });
        } else if (folderLookupError) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "folder",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            parentShowKey: fullEntryPath,
            originalName: showFolderName,
            extension: "",
            parsedTitle: parsedShow.title,
            parsedYear: parsedShow.year,
            tmdbId: null,
            matchedTitle: null,
            matchedYear: null,
            proposedName: showFolderName,
            proposedPath: fullEntryPath,
            status: "error",
            error: folderLookupError,
          });
        } else if (!resolvedTmdbId) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "folder",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            parentShowKey: fullEntryPath,
            originalName: showFolderName,
            extension: "",
            parsedTitle: parsedShow.title,
            parsedYear: parsedShow.year,
            tmdbId: null,
            matchedTitle: null,
            matchedYear: null,
            proposedName: showFolderName,
            proposedPath: fullEntryPath,
            status: "unmatched",
          });
        } else {
          const proposedName = buildTaggedName(showFolderName, "", "folder", resolvedTmdbId);
          const proposedPath = path.join(rootDir, proposedName);
          const collision =
            proposedPath !== fullEntryPath && (await fileExists(proposedPath));
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "folder",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            parentShowKey: fullEntryPath,
            originalName: showFolderName,
            extension: "",
            parsedTitle: parsedShow.title,
            parsedYear: parsedShow.year,
            tmdbId: resolvedTmdbId,
            matchedTitle: resolvedTitle,
            matchedYear: resolvedYear,
            proposedName,
            proposedPath,
            status: collision ? "collision" : "ready",
            error: collision ? "Target folder already exists" : undefined,
          });
        }

        // Video files inside this TV show folder
        const showVideos = await collectVideosRecursively(fullEntryPath);
        for (const videoPath of showVideos) {
          const originalName = path.basename(videoPath);
          const ext = path.extname(originalName);
          const parentDir = path.dirname(videoPath);
          const stem = originalName.slice(0, -ext.length);
          const existingFileId = extractExistingTmdbId(stem);

          if (existingFileId) {
            items.push({
              id: `srv-${seq++}`,
              libraryType: "tv",
              kind: "file",
              originalPath: videoPath,
              parentDir,
              parentShowKey: fullEntryPath,
              originalName,
              extension: ext,
              parsedTitle: parsedShow.title,
              parsedYear: parsedShow.year,
              tmdbId: existingFileId,
              matchedTitle: resolvedTitle ?? parsedShow.title,
              matchedYear: resolvedYear,
              proposedName: originalName,
              proposedPath: videoPath,
              status: "already_tagged",
            });
            continue;
          }

          if (folderLookupError) {
            items.push({
              id: `srv-${seq++}`,
              libraryType: "tv",
              kind: "file",
              originalPath: videoPath,
              parentDir,
              parentShowKey: fullEntryPath,
              originalName,
              extension: ext,
              parsedTitle: parsedShow.title,
              parsedYear: parsedShow.year,
              tmdbId: null,
              matchedTitle: null,
              matchedYear: null,
              proposedName: originalName,
              proposedPath: videoPath,
              status: "error",
              error: folderLookupError,
            });
            continue;
          }

          if (!resolvedTmdbId) {
            items.push({
              id: `srv-${seq++}`,
              libraryType: "tv",
              kind: "file",
              originalPath: videoPath,
              parentDir,
              parentShowKey: fullEntryPath,
              originalName,
              extension: ext,
              parsedTitle: parsedShow.title,
              parsedYear: parsedShow.year,
              tmdbId: null,
              matchedTitle: null,
              matchedYear: null,
              proposedName: originalName,
              proposedPath: videoPath,
              status: "unmatched",
            });
            continue;
          }

          const proposedName = buildTaggedName(originalName, ext, "file", resolvedTmdbId);
          const proposedPath = path.join(parentDir, proposedName);
          const collision =
            proposedPath !== videoPath && (await fileExists(proposedPath));

          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "file",
            originalPath: videoPath,
            parentDir,
            parentShowKey: fullEntryPath,
            originalName,
            extension: ext,
            parsedTitle: parsedShow.title,
            parsedYear: parsedShow.year,
            tmdbId: resolvedTmdbId,
            matchedTitle: resolvedTitle,
            matchedYear: resolvedYear,
            proposedName,
            proposedPath,
            status: collision ? "collision" : "ready",
            error: collision ? "Target filename already exists" : undefined,
          });
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!VIDEO_EXTENSIONS.has(ext.toLowerCase())) continue;
        const stem = entry.name.slice(0, -ext.length);
        const existingId = extractExistingTmdbId(stem);
        const parsed = parseMediaName(stem, true);

        if (existingId) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "file",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            originalName: entry.name,
            extension: ext,
            parsedTitle: parsed.title,
            parsedYear: parsed.year,
            tmdbId: existingId,
            matchedTitle: parsed.title,
            matchedYear: parsed.year ? String(parsed.year) : null,
            proposedName: entry.name,
            proposedPath: fullEntryPath,
            status: "already_tagged",
          });
          continue;
        }

        try {
          const match = await lookupCached("tv", parsed.title, parsed.year);
          if (!match) {
            items.push({
              id: `srv-${seq++}`,
              libraryType: "tv",
              kind: "file",
              originalPath: fullEntryPath,
              parentDir: rootDir,
              originalName: entry.name,
              extension: ext,
              parsedTitle: parsed.title,
              parsedYear: parsed.year,
              tmdbId: null,
              matchedTitle: null,
              matchedYear: null,
              proposedName: entry.name,
              proposedPath: fullEntryPath,
              status: "unmatched",
            });
            continue;
          }
          const proposedName = buildTaggedName(entry.name, ext, "file", match.id);
          const proposedPath = path.join(rootDir, proposedName);
          const collision =
            proposedPath !== fullEntryPath && (await fileExists(proposedPath));
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "file",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            originalName: entry.name,
            extension: ext,
            parsedTitle: parsed.title,
            parsedYear: parsed.year,
            tmdbId: match.id,
            matchedTitle: match.title,
            matchedYear: match.year || null,
            proposedName,
            proposedPath,
            status: collision ? "collision" : "ready",
            error: collision ? "Target filename already exists" : undefined,
          });
        } catch (err) {
          items.push({
            id: `srv-${seq++}`,
            libraryType: "tv",
            kind: "file",
            originalPath: fullEntryPath,
            parentDir: rootDir,
            originalName: entry.name,
            extension: ext,
            parsedTitle: parsed.title,
            parsedYear: parsed.year,
            tmdbId: null,
            matchedTitle: null,
            matchedYear: null,
            proposedName: entry.name,
            proposedPath: fullEntryPath,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    mode: "server",
    dryRun: params.dryRun,
    scannedAt: new Date().toISOString(),
    summary: summarizeItems(items),
    items,
  };
}

export async function matchBrowserEntries(params: {
  entries: BrowserEntryInput[];
  apiKey: string;
  dryRun: boolean;
}): Promise<LocalScanResult> {
  const searchCache = new Map<string, TmdbSearchResult | null>();
  const lookupCached = async (
    mediaType: LibraryType,
    title: string,
    year: number | null
  ): Promise<TmdbSearchResult | null> => {
    const key = `${mediaType}:${title.toLowerCase()}:${year ?? ""}`;
    if (searchCache.has(key)) {
      return searchCache.get(key) ?? null;
    }
    const matches = await tmdbSearch(params.apiKey, mediaType, title, year);
    const best = matches[0] ?? null;
    searchCache.set(key, best);
    await sleep(90);
    return best;
  };

  // Resolve TV show folders first so child files inherit their TMDB ID
  const showMatchByKey = new Map<
    string,
    { tmdbId: number | null; title: string | null; year: string | null; error?: string }
  >();

  const items: LocalMediaItem[] = [];

  for (const entry of params.entries) {
    if (entry.libraryType === "tv" && entry.kind === "folder") {
      const parsed = parseMediaName(entry.originalName, false);
      const existingId = extractExistingTmdbId(entry.originalName);

      if (existingId) {
        showMatchByKey.set(entry.parentShowKey || entry.relativePath, {
          tmdbId: existingId,
          title: parsed.title,
          year: parsed.year ? String(parsed.year) : null,
        });
        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "folder",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: "",
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: existingId,
          matchedTitle: parsed.title,
          matchedYear: parsed.year ? String(parsed.year) : null,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "already_tagged",
        });
        continue;
      }

      try {
        const match = await lookupCached("tv", parsed.title, parsed.year);
        if (!match) {
          showMatchByKey.set(entry.parentShowKey || entry.relativePath, {
            tmdbId: null,
            title: null,
            year: null,
          });
          items.push({
            id: entry.id,
            libraryType: "tv",
            kind: "folder",
            originalPath: entry.relativePath,
            parentDir: entry.parentDir,
            parentShowKey: entry.parentShowKey,
            originalName: entry.originalName,
            extension: "",
            parsedTitle: parsed.title,
            parsedYear: parsed.year,
            tmdbId: null,
            matchedTitle: null,
            matchedYear: null,
            proposedName: entry.originalName,
            proposedPath: entry.relativePath,
            status: "unmatched",
          });
          continue;
        }

        showMatchByKey.set(entry.parentShowKey || entry.relativePath, {
          tmdbId: match.id,
          title: match.title,
          year: match.year || null,
        });
        const proposedName = buildTaggedName(entry.originalName, "", "folder", match.id);
        const proposedPath = entry.parentDir
          ? `${entry.parentDir}/${proposedName}`
          : proposedName;

        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "folder",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: "",
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: match.id,
          matchedTitle: match.title,
          matchedYear: match.year || null,
          proposedName,
          proposedPath,
          status: "ready",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showMatchByKey.set(entry.parentShowKey || entry.relativePath, {
          tmdbId: null,
          title: null,
          year: null,
          error: msg,
        });
        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "folder",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: "",
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: null,
          matchedTitle: null,
          matchedYear: null,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "error",
          error: msg,
        });
      }
    }
  }

  for (const entry of params.entries) {
    if (entry.libraryType === "tv" && entry.kind === "folder") continue;

    const stem = entry.extension && entry.originalName.toLowerCase().endsWith(entry.extension.toLowerCase())
      ? entry.originalName.slice(0, -entry.extension.length)
      : entry.originalName;
    const existingId = extractExistingTmdbId(stem);

    if (entry.libraryType === "tv" && entry.parentShowKey && showMatchByKey.has(entry.parentShowKey)) {
      const showInfo = showMatchByKey.get(entry.parentShowKey)!;
      const parsedShow = parseMediaName(entry.parentShowKey.split("/").pop() || stem, false);

      if (existingId) {
        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "file",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: entry.extension,
          parsedTitle: parsedShow.title,
          parsedYear: parsedShow.year,
          tmdbId: existingId,
          matchedTitle: showInfo.title ?? parsedShow.title,
          matchedYear: showInfo.year,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "already_tagged",
        });
        continue;
      }

      if (showInfo.error) {
        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "file",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: entry.extension,
          parsedTitle: parsedShow.title,
          parsedYear: parsedShow.year,
          tmdbId: null,
          matchedTitle: null,
          matchedYear: null,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "error",
          error: showInfo.error,
        });
        continue;
      }

      if (!showInfo.tmdbId) {
        items.push({
          id: entry.id,
          libraryType: "tv",
          kind: "file",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          parentShowKey: entry.parentShowKey,
          originalName: entry.originalName,
          extension: entry.extension,
          parsedTitle: parsedShow.title,
          parsedYear: parsedShow.year,
          tmdbId: null,
          matchedTitle: null,
          matchedYear: null,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "unmatched",
        });
        continue;
      }

      const proposedName = buildTaggedName(
        entry.originalName,
        entry.extension,
        "file",
        showInfo.tmdbId
      );
      const proposedPath = entry.parentDir
        ? `${entry.parentDir}/${proposedName}`
        : proposedName;

      items.push({
        id: entry.id,
        libraryType: "tv",
        kind: "file",
        originalPath: entry.relativePath,
        parentDir: entry.parentDir,
        parentShowKey: entry.parentShowKey,
        originalName: entry.originalName,
        extension: entry.extension,
        parsedTitle: parsedShow.title,
        parsedYear: parsedShow.year,
        tmdbId: showInfo.tmdbId,
        matchedTitle: showInfo.title,
        matchedYear: showInfo.year,
        proposedName,
        proposedPath,
        status: "ready",
      });
      continue;
    }

    // Movie file or loose TV file
    let parsed = parseMediaName(stem, entry.libraryType === "tv");
    if (entry.libraryType === "movie" && entry.parentDir) {
      const parentName = entry.parentDir.split("/").pop() || "";
      if (parentName) {
        const folderParsed = parseMediaName(parentName, false);
        if (parsed.title.length < 2 || (!parsed.year && folderParsed.year)) {
          parsed = {
            title: parsed.title.length < 2 ? folderParsed.title : parsed.title,
            year: parsed.year ?? folderParsed.year,
          };
        }
      }
    }

    if (existingId) {
      items.push({
        id: entry.id,
        libraryType: entry.libraryType,
        kind: "file",
        originalPath: entry.relativePath,
        parentDir: entry.parentDir,
        originalName: entry.originalName,
        extension: entry.extension,
        parsedTitle: parsed.title,
        parsedYear: parsed.year,
        tmdbId: existingId,
        matchedTitle: parsed.title,
        matchedYear: parsed.year ? String(parsed.year) : null,
        proposedName: entry.originalName,
        proposedPath: entry.relativePath,
        status: "already_tagged",
      });
      continue;
    }

    try {
      const match = await lookupCached(entry.libraryType, parsed.title, parsed.year);
      if (!match) {
        items.push({
          id: entry.id,
          libraryType: entry.libraryType,
          kind: "file",
          originalPath: entry.relativePath,
          parentDir: entry.parentDir,
          originalName: entry.originalName,
          extension: entry.extension,
          parsedTitle: parsed.title,
          parsedYear: parsed.year,
          tmdbId: null,
          matchedTitle: null,
          matchedYear: null,
          proposedName: entry.originalName,
          proposedPath: entry.relativePath,
          status: "unmatched",
        });
        continue;
      }

      const proposedName = buildTaggedName(
        entry.originalName,
        entry.extension,
        "file",
        match.id
      );
      const proposedPath = entry.parentDir
        ? `${entry.parentDir}/${proposedName}`
        : proposedName;

      items.push({
        id: entry.id,
        libraryType: entry.libraryType,
        kind: "file",
        originalPath: entry.relativePath,
        parentDir: entry.parentDir,
        originalName: entry.originalName,
        extension: entry.extension,
        parsedTitle: parsed.title,
        parsedYear: parsed.year,
        tmdbId: match.id,
        matchedTitle: match.title,
        matchedYear: match.year || null,
        proposedName,
        proposedPath,
        status: "ready",
      });
    } catch (err) {
      items.push({
        id: entry.id,
        libraryType: entry.libraryType,
        kind: "file",
        originalPath: entry.relativePath,
        parentDir: entry.parentDir,
        originalName: entry.originalName,
        extension: entry.extension,
        parsedTitle: parsed.title,
        parsedYear: parsed.year,
        tmdbId: null,
        matchedTitle: null,
        matchedYear: null,
        proposedName: entry.originalName,
        proposedPath: entry.relativePath,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    mode: "browser",
    dryRun: params.dryRun,
    scannedAt: new Date().toISOString(),
    summary: summarizeItems(items),
    items,
  };
}

export async function applyServerRenames(
  items: LocalMediaItem[]
): Promise<{ summary: LocalScanSummary; items: LocalMediaItem[] }> {
  // Rename files first, then folders (deepest path first) so parent folder renames don't break child paths.
  const orderedIndices = items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      if (a.item.kind !== b.item.kind) {
        return a.item.kind === "file" ? -1 : 1;
      }
      return b.item.originalPath.length - a.item.originalPath.length;
    });

  const updated = items.map((item) => ({ ...item }));

  for (const { idx } of orderedIndices) {
    const item = updated[idx];
    if (item.status !== "ready" || !item.tmdbId) continue;

    const targetName = buildTaggedName(
      item.originalName,
      item.extension,
      item.kind,
      item.tmdbId
    );
    const targetPath = path.join(item.parentDir, targetName);

    if (targetPath === item.originalPath) {
      item.status = "already_tagged";
      continue;
    }

    try {
      const resolvedParent = await validateDirectoryPath(item.parentDir);
      const safeSrc = path.join(resolvedParent, item.originalName);
      const safeDst = path.join(resolvedParent, targetName);

      if (await fileExists(safeDst)) {
        item.status = "collision";
        item.error = "Target already exists on disk";
        continue;
      }

      await fs.rename(safeSrc, safeDst);
      item.originalName = targetName;
      item.originalPath = safeDst;
      item.proposedName = targetName;
      item.proposedPath = safeDst;
      item.status = "renamed";
      item.error = undefined;
    } catch (err) {
      item.status = "error";
      item.error = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    summary: summarizeItems(updated),
    items: updated,
  };
}

function escapeBashSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapePsSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function generateRenameScript(
  items: LocalMediaItem[],
  format: "sh" | "ps1"
): string {
  const pending = items
    .filter((item) => item.status === "ready" && item.tmdbId && item.proposedName !== item.originalName)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "file" ? -1 : 1;
      return b.originalPath.length - a.originalPath.length;
    });

  if (format === "ps1") {
    const lines = [
      "# Jellyfin Local Library Tagger — Batch Rename Script (PowerShell)",
      "# Run inside the parent root folder if using relative paths from Browser Picker,",
      "# or from anywhere if using absolute Server Paths.",
      `$ErrorActionPreference = 'Stop'`,
      `$renamed = 0`,
      `$skipped = 0`,
      "",
    ];
    for (const item of pending) {
      const src = item.originalPath;
      const dst = item.proposedPath;
      const newName = item.proposedName;
      lines.push(
        `if ((Test-Path -LiteralPath ${escapePsSingle(src)}) -and -not (Test-Path -LiteralPath ${escapePsSingle(dst)})) {`,
        `  Rename-Item -LiteralPath ${escapePsSingle(src)} -NewName ${escapePsSingle(newName)}`,
        `  $renamed++`,
        `} else {`,
        `  Write-Host "SKIP (missing source or target exists): ${newName.replace(/"/g, '`"')}"`,
        `  $skipped++`,
        `}`
      );
    }
    lines.push("", `Write-Host "Done: $renamed renamed, $skipped skipped."`);
    return lines.join("\n");
  }

  const lines = [
    "#!/usr/bin/env bash",
    "# Jellyfin Local Library Tagger — Batch Rename Script (Bash)",
    "# Run inside the selected root folder if using relative paths from Browser Picker,",
    "# or from anywhere if using absolute Server Paths.",
    "set -euo pipefail",
    "renamed=0",
    "skipped=0",
    "",
  ];
  for (const item of pending) {
    const src = item.originalPath;
    const dst = item.proposedPath;
    lines.push(
      `if [ -e ${escapeBashSingle(src)} ] && [ ! -e ${escapeBashSingle(dst)} ]; then`,
      `  mv -n -- ${escapeBashSingle(src)} ${escapeBashSingle(dst)}`,
      `  renamed=$((renamed + 1))`,
      `else`,
      `  echo "SKIP (missing source or target exists): ${item.proposedName.replace(/"/g, '\\"')}"`,
      `  skipped=$((skipped + 1))`,
      `fi`
    );
  }
  lines.push("", `echo "Done: $renamed renamed, $skipped skipped."`);
  return lines.join("\n");
}
