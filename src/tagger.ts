import fs from "node:fs";
import path from "node:path";

export interface TaggerConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  tmdbApiKey: string;
  tmdbCountry: string;
  runIntervalHours: number;
  dryRun: boolean;
  ignoreProviders: string[];
  localMoviePaths: string[];
  localTvPaths: string[];
}

export interface RunStats {
  updated: number;
  unchanged: number;
  skipped_no_id: number;
  skipped_no_tmdb: number;
  skipped_no_providers: number;
  errors: number;
}

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  message: string;
}

export interface TaggedItemPreview {
  name: string;
  mediaType: "movie" | "tv";
  added: string[];
  allTags: string[];
  dryRun: boolean;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  country: string;
  status: "running" | "completed" | "failed";
  error?: string;
  moviesCount: number;
  seriesCount: number;
  stats: RunStats;
  taggedItems: TaggedItemPreview[];
}

interface JellyfinUser {
  Id: string;
  Policy?: {
    IsAdministrator?: boolean;
  };
}

interface JellyfinItem {
  Id: string;
  Name?: string;
  Tags?: string[];
  Genres?: string[];
  Studios?: unknown[];
  ProviderIds?: Record<string, string>;
  Overview?: string;
  ProductionYear?: number;
  OfficialRating?: string;
}

export const PROVIDER_TYPES = ["flatrate", "free", "ads"] as const;

export const PROVIDER_NAME_MAP: Record<string, string> = {
  // Netflix
  "Netflix basic with Ads": "Netflix",
  "Netflix Standard with Ads": "Netflix",
  "Netflix with Ads": "Netflix",
  "Netflix Kids": "Netflix",

  // Prime Video
  "Amazon Prime Video": "Prime Video",
  "Amazon Prime Video with Ads": "Prime Video",
  "Amazon Prime Video Free with Ads": "Prime Video",
  "Amazon Video": "Prime Video",
  "Prime Video with Ads": "Prime Video",

  // Apple TV+
  "Apple TV": "Apple TV+",
  "Apple TV Plus": "Apple TV+",
  "Apple TV Amazon Channel": "Apple TV+",
  "Apple TV+ Amazon Channel": "Apple TV+",
  "Apple TV Channels": "Apple TV+",

  // Max
  "HBO Max": "Max",
  "HBO Max Amazon Channel": "Max",
  "Max Amazon Channel": "Max",
  "Max Apple TV Channel": "Max",

  // Disney+
  "Disney Plus": "Disney+",
  "Disney+ Amazon Channel": "Disney+",
  "Disney Plus Amazon Channel": "Disney+",

  // Peacock
  "Peacock Premium": "Peacock Premium",
  "Peacock Premium Plus": "Peacock Premium",
  "Peacock Amazon Channel": "Peacock Premium",

  // Paramount+
  "Paramount Plus": "Paramount+",
  "Paramount+ Essential": "Paramount+",
  "Paramount Plus Essential": "Paramount+",
  "Paramount Plus Premium": "Paramount+",
  "Paramount+ Premium": "Paramount+",
  "Paramount+ Amazon Channel": "Paramount+",
  "Paramount Plus Apple TV Channel": "Paramount+",
  "Paramount+ Apple TV Channel": "Paramount+",
  "Paramount+ Roku Premium Channel": "Paramount+",
  "Paramount Network": "Paramount+",

  // Discovery+
  "Discovery Plus": "Discovery+",
  "Discovery+ Amazon Channel": "Discovery+",

  // Cinemax
  "Cinemax Amazon Channel": "Cinemax",
  "Cinemax Apple TV Channel": "Cinemax",

  // Showtime
  "Showtime Amazon Channel": "Showtime",
  "Showtime Apple TV Channel": "Showtime",
  "Showtime Roku Premium Channel": "Showtime",

  // Starz
  "Starz Amazon Channel": "Starz",
  "Starz Apple TV Channel": "Starz",
  "Starz Roku Premium Channel": "Starz",
  "STARZ": "Starz",

  // MGM+
  "MGM Plus": "MGM+",
  "MGM+ Amazon Channel": "MGM+",
  "MGM Plus Roku Premium Channel": "MGM+",

  // AMC+
  "AMC+ Amazon Channel": "AMC+",
  "AMC+ Apple TV Channel": "AMC+",
  "AMC Plus Apple TV Channel": "AMC+",
  "AMC+ Roku Premium Channel": "AMC+",

  // YOUTUBE
  "YouTube Free": "YouTube",
};

export function normalise(name: string): string {
  return PROVIDER_NAME_MAP[name] ?? name;
}

function parseIgnoreProviders(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveConfigFilePath(): string {
  const custom = (process.env.CONFIG_FILE ?? "").trim();
  return custom ? path.resolve(custom) : path.join(process.cwd(), "data", "config.json");
}

function loadEnvConfig(): TaggerConfig {
  const intervalRaw = Number.parseInt(process.env.RUN_INTERVAL_HOURS ?? "24", 10);
  return {
    jellyfinUrl: (process.env.JELLYFIN_URL ?? "").trim().replace(/\/+$/, ""),
    jellyfinApiKey: (process.env.JELLYFIN_API_KEY ?? "").trim(),
    tmdbApiKey: (process.env.TMDB_API_KEY ?? "").trim(),
    tmdbCountry: (process.env.TMDB_COUNTRY ?? "US").trim() || "US",
    runIntervalHours: Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : 24,
    dryRun: (process.env.DRY_RUN ?? "false").toLowerCase() === "true",
    ignoreProviders: parseIgnoreProviders(process.env.IGNORE_PROVIDERS),
    localMoviePaths: [],
    localTvPaths: [],
  };
}

function loadPersistedConfig(filePath: string): TaggerConfig {
  const base = loadEnvConfig();
  try {
    if (!fs.existsSync(filePath)) {
      return base;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const saved = JSON.parse(raw) as Partial<TaggerConfig>;
    return {
      jellyfinUrl:
        typeof saved.jellyfinUrl === "string"
          ? saved.jellyfinUrl.trim().replace(/\/+$/, "")
          : base.jellyfinUrl,
      jellyfinApiKey:
        typeof saved.jellyfinApiKey === "string" && saved.jellyfinApiKey.trim() !== ""
          ? saved.jellyfinApiKey.trim()
          : base.jellyfinApiKey,
      tmdbApiKey:
        typeof saved.tmdbApiKey === "string" && saved.tmdbApiKey.trim() !== ""
          ? saved.tmdbApiKey.trim()
          : base.tmdbApiKey,
      tmdbCountry:
        typeof saved.tmdbCountry === "string" && saved.tmdbCountry.trim() !== ""
          ? saved.tmdbCountry.trim().toUpperCase()
          : base.tmdbCountry,
      runIntervalHours:
        typeof saved.runIntervalHours === "number" &&
        Number.isFinite(saved.runIntervalHours) &&
        saved.runIntervalHours > 0
          ? saved.runIntervalHours
          : base.runIntervalHours,
      dryRun: typeof saved.dryRun === "boolean" ? saved.dryRun : base.dryRun,
      ignoreProviders: Array.isArray(saved.ignoreProviders)
        ? saved.ignoreProviders.map((s) => String(s).trim()).filter(Boolean)
        : base.ignoreProviders,
      localMoviePaths: Array.isArray(saved.localMoviePaths)
        ? saved.localMoviePaths.map((s) => String(s).trim()).filter(Boolean)
        : base.localMoviePaths,
      localTvPaths: Array.isArray(saved.localTvPaths)
        ? saved.localTvPaths.map((s) => String(s).trim()).filter(Boolean)
        : base.localTvPaths,
    };
  } catch {
    return base;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export function isTmdbBearerToken(apiKey: string): boolean {
  const trimmed = apiKey.trim();
  return trimmed.startsWith("eyJ") || (trimmed.includes(".") && trimmed.length > 40);
}

export function buildTmdbRequest(
  pathWithQuery: string,
  apiKey: string
): { url: string; headers: Record<string, string> } {
  const trimmed = apiKey.trim();
  const baseUrl = `https://api.themoviedb.org/3${pathWithQuery}`;
  if (isTmdbBearerToken(trimmed)) {
    return {
      url: baseUrl,
      headers: {
        Authorization: `Bearer ${trimmed}`,
        Accept: "application/json",
      },
    };
  }
  const sep = baseUrl.includes("?") ? "&" : "?";
  return {
    url: `${baseUrl}${sep}api_key=${encodeURIComponent(trimmed)}`,
    headers: {
      Accept: "application/json",
    },
  };
}

export class TaggerService {
  private readonly configFilePath: string = resolveConfigFilePath();
  private config: TaggerConfig = loadPersistedConfig(this.configFilePath);
  private logs: LogEntry[] = [];
  private isRunning = false;
  private lastRun: RunSummary | null = null;
  private nextRunAt: string | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;

  private persistConfig(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.configFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), "utf8");
      fs.renameSync(tmpPath, this.configFilePath);
    } catch (err) {
      this.addLog(
        "WARN",
        `Could not persist settings to ${this.configFilePath}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  public addLog(level: LogEntry["level"], message: string): void {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level,
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs.shift();
    }
    const line = `${entry.timestamp} [${level}] ${message}`;
    if (level === "ERROR") {
      console.error(line);
    } else if (level === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  public getTmdbValidationError(cfg: TaggerConfig = this.config): string | null {
    if (!cfg.tmdbApiKey) {
      return "TMDB API Key or Read Access Token must be set.";
    }
    if (cfg.tmdbApiKey.toLowerCase().includes("your-tmdb")) {
      return "TMDB credential is still set to a placeholder value.";
    }
    return null;
  }

  public getJellyfinValidationError(cfg: TaggerConfig = this.config): string | null {
    if (!cfg.jellyfinUrl || !cfg.jellyfinApiKey) {
      return "JELLYFIN_URL and JELLYFIN_API_KEY must be set.";
    }
    const lowerUrl = cfg.jellyfinUrl.toLowerCase();
    if (
      lowerUrl.includes("192.168.x.x") ||
      lowerUrl.includes("your-jellyfin") ||
      lowerUrl.includes("example.com")
    ) {
      return `JELLYFIN_URL is still set to a placeholder (${cfg.jellyfinUrl}).`;
    }
    if (cfg.jellyfinApiKey.toLowerCase().includes("your-jellyfin-api-key")) {
      return "Jellyfin API key is still set to a placeholder value.";
    }
    try {
      const parsed = new URL(cfg.jellyfinUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `JELLYFIN_URL must start with http:// or https:// (got ${parsed.protocol}).`;
      }
      if (!parsed.hostname) {
        return "JELLYFIN_URL is missing a valid hostname.";
      }
    } catch {
      return `JELLYFIN_URL is not a valid URL (${cfg.jellyfinUrl}).`;
    }
    return null;
  }

  public getConfigValidationError(cfg: TaggerConfig = this.config): string | null {
    const jfErr = this.getJellyfinValidationError(cfg);
    if (jfErr) return jfErr;
    return this.getTmdbValidationError(cfg);
  }

  public isConfigured(cfg: TaggerConfig = this.config): boolean {
    return this.getConfigValidationError(cfg) === null;
  }

  public getTmdbApiKey(): string {
    return this.config.tmdbApiKey;
  }

  public getTmdbAuthMode(apiKey: string = this.config.tmdbApiKey): "bearer" | "api_key" | "none" {
    if (!apiKey || this.getTmdbValidationError({ ...this.config, tmdbApiKey: apiKey }) !== null) {
      return "none";
    }
    return isTmdbBearerToken(apiKey) ? "bearer" : "api_key";
  }

  public async testTmdbConnection(overrideKey?: string): Promise<{
    ok: boolean;
    authMode: "bearer" | "api_key" | "none";
    error?: string;
  }> {
    const key = (overrideKey?.trim() || this.config.tmdbApiKey).trim();
    const validationErr = this.getTmdbValidationError({ ...this.config, tmdbApiKey: key });
    if (validationErr) {
      return { ok: false, authMode: "none", error: validationErr };
    }
    const authMode = isTmdbBearerToken(key) ? "bearer" : "api_key";
    const req = buildTmdbRequest("/configuration", key);
    try {
      const r = await this.fetchWithContext(req.url, { headers: req.headers }, "TMDB");
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          ok: false,
          authMode,
          error: `TMDB rejected credential (HTTP ${r.status}): ${text.slice(0, 160)}`,
        };
      }
      return { ok: true, authMode };
    } catch (err) {
      return {
        ok: false,
        authMode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async testJellyfinConnection(
    overrideUrl?: string,
    overrideApiKey?: string
  ): Promise<{
    ok: boolean;
    serverName?: string;
    version?: string;
    operatingSystem?: string;
    error?: string;
  }> {
    const jellyfinUrl = (overrideUrl?.trim() || this.config.jellyfinUrl)
      .trim()
      .replace(/\/+$/, "");
    const jellyfinApiKey = (overrideApiKey?.trim() || this.config.jellyfinApiKey).trim();
    const validationErr = this.getJellyfinValidationError({
      ...this.config,
      jellyfinUrl,
      jellyfinApiKey,
    });
    if (validationErr) {
      return { ok: false, error: validationErr };
    }
    const tempCfg: TaggerConfig = {
      ...this.config,
      jellyfinUrl,
      jellyfinApiKey,
    };
    try {
      const r = await this.fetchWithContext(
        `${jellyfinUrl}/System/Info`,
        { headers: this.jfHeaders(tempCfg) },
        "Jellyfin"
      );
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          ok: false,
          error: `Jellyfin returned HTTP ${r.status}: ${text.slice(0, 180)}`,
        };
      }
      const info = (await r.json()) as {
        ServerName?: string;
        Version?: string;
        OperatingSystem?: string;
      };
      return {
        ok: true,
        serverName: info.ServerName ?? "Jellyfin Server",
        version: info.Version ?? "unknown",
        operatingSystem: info.OperatingSystem ?? "",
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public getPublicStatus() {
    return {
      configured: this.isConfigured(),
      configError: this.getConfigValidationError(),
      tmdbConfigured: this.getTmdbValidationError() === null,
      tmdbError: this.getTmdbValidationError(),
      tmdbAuthMode: this.getTmdbAuthMode(),
      isRunning: this.isRunning,
      configFilePath: this.configFilePath,
      config: {
        jellyfinUrl: this.config.jellyfinUrl,
        hasJellyfinApiKey:
          Boolean(this.config.jellyfinApiKey) &&
          !this.config.jellyfinApiKey.toLowerCase().includes("your-jellyfin"),
        hasTmdbApiKey:
          Boolean(this.config.tmdbApiKey) &&
          !this.config.tmdbApiKey.toLowerCase().includes("your-tmdb"),
        tmdbCountry: this.config.tmdbCountry,
        runIntervalHours: this.config.runIntervalHours,
        dryRun: this.config.dryRun,
        ignoreProviders: this.config.ignoreProviders,
        localMoviePaths: this.config.localMoviePaths,
        localTvPaths: this.config.localTvPaths,
      },
      nextRunAt: this.nextRunAt,
      lastRun: this.lastRun,
      logs: this.logs.slice(-150),
    };
  }

  public updateLocalPaths(moviePaths: string[], tvPaths: string[]): void {
    this.config = {
      ...this.config,
      localMoviePaths: moviePaths.map((s) => s.trim()).filter(Boolean),
      localTvPaths: tvPaths.map((s) => s.trim()).filter(Boolean),
    };
    this.persistConfig();
  }

  public updateConfig(patch: Partial<TaggerConfig>): void {
    const next: TaggerConfig = {
      jellyfinUrl:
        patch.jellyfinUrl !== undefined
          ? patch.jellyfinUrl.trim().replace(/\/+$/, "")
          : this.config.jellyfinUrl,
      jellyfinApiKey:
        patch.jellyfinApiKey !== undefined && patch.jellyfinApiKey.trim() !== ""
          ? patch.jellyfinApiKey.trim()
          : this.config.jellyfinApiKey,
      tmdbApiKey:
        patch.tmdbApiKey !== undefined && patch.tmdbApiKey.trim() !== ""
          ? patch.tmdbApiKey.trim()
          : this.config.tmdbApiKey,
      tmdbCountry:
        patch.tmdbCountry !== undefined
          ? patch.tmdbCountry.trim().toUpperCase() || "US"
          : this.config.tmdbCountry,
      runIntervalHours:
        patch.runIntervalHours !== undefined &&
        Number.isFinite(Number(patch.runIntervalHours)) &&
        Number(patch.runIntervalHours) > 0
          ? Number(patch.runIntervalHours)
          : this.config.runIntervalHours,
      dryRun: patch.dryRun !== undefined ? Boolean(patch.dryRun) : this.config.dryRun,
      ignoreProviders:
        patch.ignoreProviders !== undefined
          ? patch.ignoreProviders.map((s) => s.trim()).filter(Boolean)
          : this.config.ignoreProviders,
      localMoviePaths:
        patch.localMoviePaths !== undefined
          ? patch.localMoviePaths.map((s) => s.trim()).filter(Boolean)
          : this.config.localMoviePaths,
      localTvPaths:
        patch.localTvPaths !== undefined
          ? patch.localTvPaths.map((s) => s.trim()).filter(Boolean)
          : this.config.localTvPaths,
    };

    const intervalChanged = next.runIntervalHours !== this.config.runIntervalHours;
    this.config = next;
    this.persistConfig();
    this.addLog(
      "INFO",
      `Configuration saved (Country: ${next.tmdbCountry}, Interval: ${next.runIntervalHours}h, Dry Run: ${next.dryRun})`
    );
    if (intervalChanged || this.scheduleTimer === null) {
      this.startScheduler();
    }
  }

  public startScheduler(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    const intervalMs = Math.min(
      this.config.runIntervalHours * 60 * 60 * 1000,
      2_147_483_647
    );
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    this.scheduleTimer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      if (this.isConfigured()) {
        void this.runTaggingJob().catch((err) => {
          this.addLog("ERROR", `Scheduled run failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }, intervalMs);
  }

  private jfHeaders(cfg: TaggerConfig): Record<string, string> {
    return {
      Authorization: `MediaBrowser Token="${cfg.jellyfinApiKey}"`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async fetchWithContext(
    url: string,
    init: RequestInit,
    label: string
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15000),
      });
    } catch (err) {
      const errorObj = err as Error & { cause?: { code?: string; message?: string } };
      const causeDetail = errorObj.cause?.code || errorObj.cause?.message;
      const detail = causeDetail ? `${errorObj.message} (${causeDetail})` : errorObj.message;
      throw new Error(`${label} unreachable at ${url}: ${detail}`);
    }
  }

  private async jfGetUserId(cfg: TaggerConfig): Promise<string> {
    const r = await this.fetchWithContext(
      `${cfg.jellyfinUrl}/Users`,
      { headers: this.jfHeaders(cfg) },
      "Jellyfin"
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Jellyfin /Users failed: HTTP ${r.status} ${body.slice(0, 200)}`);
    }
    const users = (await r.json()) as JellyfinUser[];
    if (!Array.isArray(users) || users.length === 0) {
      throw new Error("No Jellyfin users returned by /Users");
    }
    const admin = users.find((u) => u.Policy?.IsAdministrator);
    return (admin ?? users[0]).Id;
  }

  private async jfGetItems(
    cfg: TaggerConfig,
    userId: string,
    itemType: "Movie" | "Series"
  ): Promise<JellyfinItem[]> {
    const pageSize = 1000;
    const collected: JellyfinItem[] = [];
    let startIndex = 0;
    let useLegacyRoute = false;

    while (true) {
      const params = new URLSearchParams({
        IncludeItemTypes: itemType,
        Recursive: "true",
        Fields: "Tags,Studios,ProviderIds,Overview,Genres,OfficialRating",
        StartIndex: String(startIndex),
        Limit: String(pageSize),
      });

      let r: Response;
      if (!useLegacyRoute) {
        const v12Params = new URLSearchParams(params);
        v12Params.set("userId", userId);
        r = await this.fetchWithContext(
          `${cfg.jellyfinUrl}/Items?${v12Params.toString()}`,
          { headers: this.jfHeaders(cfg) },
          "Jellyfin"
        );
        if (r.status === 404 || r.status === 400) {
          useLegacyRoute = true;
        }
      } else {
        r = await this.fetchWithContext(
          `${cfg.jellyfinUrl}/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
          { headers: this.jfHeaders(cfg) },
          "Jellyfin"
        );
      }

      if (useLegacyRoute && (!r! || r!.status === 404 || r!.status === 400)) {
        r = await this.fetchWithContext(
          `${cfg.jellyfinUrl}/Users/${encodeURIComponent(userId)}/Items?${params.toString()}`,
          { headers: this.jfHeaders(cfg) },
          "Jellyfin"
        );
      }

      if (!r!.ok) {
        const body = await r!.text().catch(() => "");
        throw new Error(`Jellyfin Items query failed: HTTP ${r!.status} ${body.slice(0, 200)}`);
      }

      const data = (await r!.json()) as {
        Items?: JellyfinItem[];
        TotalRecordCount?: number;
      };
      const batch = data.Items ?? [];
      collected.push(...batch);
      startIndex += batch.length;

      const total = data.TotalRecordCount ?? collected.length;
      if (batch.length === 0 || collected.length >= total || batch.length < pageSize) {
        break;
      }
    }

    return collected;
  }

  private async jfGetFullItem(
    cfg: TaggerConfig,
    userId: string,
    itemId: string
  ): Promise<Record<string, unknown>> {
    const v12Url = `${cfg.jellyfinUrl}/Items/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`;
    let r = await this.fetchWithContext(v12Url, { headers: this.jfHeaders(cfg) }, "Jellyfin");

    if (r.status === 404 || r.status === 400) {
      const legacyUrl = `${cfg.jellyfinUrl}/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`;
      r = await this.fetchWithContext(legacyUrl, { headers: this.jfHeaders(cfg) }, "Jellyfin");
    }

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Jellyfin GET item ${itemId} failed: HTTP ${r.status} ${body.slice(0, 200)}`);
    }

    return (await r.json()) as Record<string, unknown>;
  }

  private async jfUpdateTags(
    cfg: TaggerConfig,
    userId: string,
    item: JellyfinItem,
    newTags: string[]
  ): Promise<boolean> {
    const itemId = item.Id;
    let payload: Record<string, unknown>;

    try {
      const fullDto = await this.jfGetFullItem(cfg, userId, itemId);
      payload = {
        ...fullDto,
        Id: itemId,
        Tags: newTags,
        Genres: Array.isArray(fullDto.Genres) ? fullDto.Genres : (item.Genres ?? []),
        Studios: Array.isArray(fullDto.Studios) ? fullDto.Studios : (item.Studios ?? []),
        LockedFields: Array.isArray(fullDto.LockedFields) ? fullDto.LockedFields : [],
        ProviderIds:
          fullDto.ProviderIds && typeof fullDto.ProviderIds === "object"
            ? fullDto.ProviderIds
            : (item.ProviderIds ?? {}),
      };
    } catch (err) {
      this.addLog(
        "WARN",
        `FAILED fetching full DTO for '${item.Name ?? "Unknown"}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return false;
    }

    const r = await this.fetchWithContext(
      `${cfg.jellyfinUrl}/Items/${encodeURIComponent(itemId)}`,
      {
        method: "POST",
        headers: this.jfHeaders(cfg),
        body: JSON.stringify(payload),
      },
      "Jellyfin"
    );

    if (r.status === 200 || r.status === 204) {
      return true;
    }

    const text = await r.text().catch(() => "");
    this.addLog(
      "WARN",
      `FAILED '${item.Name ?? "Unknown"}' — HTTP ${r.status} — ${text.slice(0, 500)}`
    );
    return false;
  }

  private async tmdbFindByImdb(
    cfg: TaggerConfig,
    imdbId: string,
    mediaType: "movie" | "tv"
  ): Promise<number | null> {
    const req = buildTmdbRequest(
      `/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`,
      cfg.tmdbApiKey
    );
    const r = await this.fetchWithContext(req.url, { headers: req.headers }, "TMDB");
    if (r.status !== 200) {
      return null;
    }
    const data = (await r.json()) as {
      movie_results?: Array<{ id: number }>;
      tv_results?: Array<{ id: number }>;
    };
    const results = mediaType === "movie" ? data.movie_results : data.tv_results;
    return results && results.length > 0 ? results[0].id : null;
  }

  private async tmdbGetProviders(
    cfg: TaggerConfig,
    tmdbId: number,
    mediaType: "movie" | "tv"
  ): Promise<string[]> {
    const req = buildTmdbRequest(`/${mediaType}/${tmdbId}/watch/providers`, cfg.tmdbApiKey);
    const r = await this.fetchWithContext(req.url, { headers: req.headers }, "TMDB");
    if (r.status !== 200) {
      return [];
    }
    const data = (await r.json()) as {
      results?: Record<string, Record<string, Array<{ provider_name?: string }>>>;
    };
    const countryData = data.results?.[cfg.tmdbCountry] ?? {};
    const ignoreSet = new Set(cfg.ignoreProviders);
    const providers: string[] = [];

    for (const ptype of PROVIDER_TYPES) {
      const entries = countryData[ptype] ?? [];
      for (const p of entries) {
        const name = (p.provider_name ?? "").trim();
        if (name && !ignoreSet.has(name) && !providers.includes(name)) {
          providers.push(name);
        }
      }
    }
    return providers;
  }

  private async processItem(
    cfg: TaggerConfig,
    userId: string,
    item: JellyfinItem,
    mediaType: "movie" | "tv",
    stats: RunStats,
    taggedItems: TaggedItemPreview[]
  ): Promise<void> {
    const name = item.Name ?? "Unknown";
    const ids = item.ProviderIds ?? {};
    const imdbId = ids.Imdb || ids.IMDB;

    if (!imdbId) {
      stats.skipped_no_id += 1;
      return;
    }

    const tmdbId = await this.tmdbFindByImdb(cfg, imdbId, mediaType);
    if (!tmdbId) {
      stats.skipped_no_tmdb += 1;
      return;
    }

    const rawProviders = await this.tmdbGetProviders(cfg, tmdbId, mediaType);
    const providers = rawProviders.map(normalise);
    if (providers.length === 0) {
      stats.skipped_no_providers += 1;
      return;
    }

    const existingTags = new Set(item.Tags ?? []);
    const newTagsSet = new Set([...existingTags, ...providers]);

    if (newTagsSet.size === existingTags.size) {
      stats.unchanged += 1;
      return;
    }

    const added = [...newTagsSet].filter((t) => !existingTags.has(t)).sort();
    const sortedAllTags = [...newTagsSet].sort();

    this.addLog("INFO", `  TAGGING: ${name.padEnd(45, " ")} +${JSON.stringify(added)}`);

    if (!cfg.dryRun) {
      const ok = await this.jfUpdateTags(cfg, userId, item, sortedAllTags);
      if (ok) {
        stats.updated += 1;
        taggedItems.push({ name, mediaType, added, allTags: sortedAllTags, dryRun: false });
      } else {
        stats.errors += 1;
      }
    } else {
      stats.updated += 1;
      taggedItems.push({ name, mediaType, added, allTags: sortedAllTags, dryRun: true });
    }

    // Polite TMDB rate limit
    await sleep(280);
  }

  public async runTaggingJob(
    overrideDryRun?: boolean,
    isStartup = false
  ): Promise<RunSummary> {
    if (this.isRunning) {
      throw new Error("A tagging job is already running.");
    }

    const cfg: TaggerConfig = {
      ...this.config,
      dryRun: overrideDryRun !== undefined ? overrideDryRun : this.config.dryRun,
    };

    const validationError = this.getConfigValidationError(cfg);
    if (validationError) {
      throw new Error(validationError);
    }

    this.isRunning = true;
    const stats: RunStats = {
      updated: 0,
      unchanged: 0,
      skipped_no_id: 0,
      skipped_no_tmdb: 0,
      skipped_no_providers: 0,
      errors: 0,
    };

    const summary: RunSummary = {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      dryRun: cfg.dryRun,
      country: cfg.tmdbCountry,
      status: "running",
      moviesCount: 0,
      seriesCount: 0,
      stats,
      taggedItems: [],
    };
    this.lastRun = summary;

    this.addLog("INFO", "============================================================");
    this.addLog(
      "INFO",
      `Jellyfin Network Tagger — starting run${cfg.dryRun ? " [DRY RUN]" : ""}`
    );
    this.addLog(
      "INFO",
      `Country: ${cfg.tmdbCountry} | Interval: ${cfg.runIntervalHours}h`
    );
    this.addLog("INFO", "============================================================");

    try {
      const userId = await this.jfGetUserId(cfg);

      // Movies
      const movies = await this.jfGetItems(cfg, userId, "Movie");
      summary.moviesCount = movies.length;
      this.addLog("INFO", `Found ${movies.length} movies in Jellyfin library`);

      for (let i = 0; i < movies.length; i += 1) {
        if ((i + 1) % 50 === 0) {
          this.addLog("INFO", `Movies progress: ${i + 1} / ${movies.length}`);
        }
        try {
          await this.processItem(cfg, userId, movies[i], "movie", stats, summary.taggedItems);
        } catch (err) {
          this.addLog(
            "WARN",
            `Error processing movie ${movies[i].Name ?? "Unknown"}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          stats.errors += 1;
        }
      }

      // TV Series
      const series = await this.jfGetItems(cfg, userId, "Series");
      summary.seriesCount = series.length;
      this.addLog("INFO", `Found ${series.length} TV series in Jellyfin library`);

      for (let i = 0; i < series.length; i += 1) {
        if ((i + 1) % 50 === 0) {
          this.addLog("INFO", `Series progress: ${i + 1} / ${series.length}`);
        }
        try {
          await this.processItem(cfg, userId, series[i], "tv", stats, summary.taggedItems);
        } catch (err) {
          this.addLog(
            "WARN",
            `Error processing series ${series[i].Name ?? "Unknown"}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          stats.errors += 1;
        }
      }

      summary.status = "completed";
      summary.finishedAt = new Date().toISOString();

      this.addLog("INFO", "------------------------------------------------------------");
      this.addLog(
        "INFO",
        `Run complete: ${stats.updated} tagged | ${stats.unchanged} unchanged | ${stats.skipped_no_id} no-id | ${stats.skipped_no_tmdb} no-tmdb | ${stats.skipped_no_providers} no-providers | ${stats.errors} errors`
      );
      this.addLog("INFO", `Next run in ${cfg.runIntervalHours} hours`);
      this.addLog("INFO", "============================================================");

      return summary;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.status = "failed";
      summary.error = msg;
      summary.finishedAt = new Date().toISOString();
      this.addLog(isStartup ? "WARN" : "ERROR", `Run stopped: ${msg}`);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }
}
