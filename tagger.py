#!/usr/bin/env python3
"""
Jellyfin Network Tagger
-----------------------
Fetches all Movies AND TV Series from Jellyfin, looks up their streaming
providers via TMDB using the IMDB ID, and writes provider names as Tags
back into Jellyfin metadata. Runs on a configurable schedule (default 24h).

GitHub: https://github.com/jpwebdude/jellyfin-network-tagger
"""

import os
import time
import logging
import schedule
import requests

# ─── Logging ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("jellyfin-tagger")

# ─── Config (from environment variables) ────────────────────────────────────

JELLYFIN_URL       = os.environ["JELLYFIN_URL"].rstrip("/")
JELLYFIN_API_KEY   = os.environ["JELLYFIN_API_KEY"]
TMDB_API_KEY       = os.environ["TMDB_API_KEY"]
TMDB_COUNTRY       = os.environ.get("TMDB_COUNTRY", "US")
RUN_INTERVAL_HOURS = int(os.environ.get("RUN_INTERVAL_HOURS", 24))
DRY_RUN            = os.environ.get("DRY_RUN", "false").lower() == "true"

PROVIDER_TYPES   = ["flatrate", "free", "ads"]
IGNORE_PROVIDERS = set(os.environ.get("IGNORE_PROVIDERS", "").split(",")) - {""}

# ─── HTTP Sessions ───────────────────────────────────────────────────────────

jf_session = requests.Session()
jf_session.headers.update({
    "Authorization": f'MediaBrowser Token="{JELLYFIN_API_KEY}"',
    "Content-Type":  "application/json",
    "Accept":        "application/json",
})

tmdb_session = requests.Session()
tmdb_session.headers.update({
    "Authorization": f"Bearer {TMDB_API_KEY}",

    "Accept":        "application/json",
})

# ─── Jellyfin helpers ────────────────────────────────────────────────────────

def jf_get_user_id() -> str:
    """Return the first admin user's ID."""
    r = jf_session.get(f"{JELLYFIN_URL}/Users")
    r.raise_for_status()
    users = r.json()
    for u in users:

        if u.get("Policy", {}).get("IsAdministrator"):
            return u["Id"]
    return users[0]["Id"]


def jf_get_items(user_id: str, item_type: str) -> list[dict]:
    """Return all items of the given type with the fields we need."""
    params = {
        "IncludeItemTypes": item_type,
        "Recursive":        "true",
        "Fields":           "Tags,Studios,ProviderIds,Overview,Genres,OfficialRating",
        "Limit":            5000,
    }
    r = jf_session.get(f"{JELLYFIN_URL}/Users/{user_id}/Items", params=params)
    r.raise_for_status()
    return r.json().get("Items", [])


def jf_update_tags(item: dict, new_tags: list[str]) -> bool:
    """
    POST updated tags back to Jellyfin using only the fields we already
    have from the library fetch — no extra GET required.
    """
    item_id = item["Id"]

    payload = {
        "Id":             item_id,
        "Name":           item.get("Name", ""),
        "Tags":           new_tags,
        "Genres":         item.get("Genres", []),
        "Studios":        item.get("Studios", []),
        "ProviderIds":    item.get("ProviderIds", {}),
        "Overview":       item.get("Overview", ""),
        "ProductionYear": item.get("ProductionYear"),
        "OfficialRating": item.get("OfficialRating"),
    }

    r = jf_session.post(f"{JELLYFIN_URL}/Items/{item_id}", json=payload)
    if r.status_code in (200, 204):
        return True

    log.warning("FAILED '%s' — HTTP %s — %s",
                item.get("Name"), r.status_code, r.text[:500])
    return False

# ─── TMDB helpers ───────────────────────────────────────────────────────────

def tmdb_find_by_imdb(imdb_id: str, media_type: str) -> int | None:
    """
    Convert an IMDB ID to a TMDB ID.
    media_type: "movie" or "tv"
    """
    r = tmdb_session.get(
        f"https://api.themoviedb.org/3/find/{imdb_id}",

        params={"external_source": "imdb_id"},
    )
    if r.status_code != 200:
        return None
    key     = "movie_results" if media_type == "movie" else "tv_results"
    results = r.json().get(key, [])
    return results[0]["id"] if results else None


def tmdb_get_providers(tmdb_id: int, media_type: str, country: str) -> list[str]:
    """
    Return streaming provider names for the given item and country.

    media_type: "movie" or "tv"
    """
    url = f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}/watch/providers"
    r   = tmdb_session.get(url)
    if r.status_code != 200:
        return []
    country_data = r.json().get("results", {}).get(country, {})
    providers = []
    for ptype in PROVIDER_TYPES:
        for p in country_data.get(ptype, []):
            name = p.get("provider_name", "").strip()
            if name and name not in IGNORE_PROVIDERS and name not in providers:
                providers.append(name)
    return providers

# ─── Provider name normalisation ─────────────────────────────────────────────

PROVIDER_NAME_MAP = {
    # Netflix
    "Netflix basic with Ads":               "Netflix",
    "Netflix Standard with Ads":            "Netflix",
    "Netflix with Ads":                     "Netflix",
    "Netflix Kids":                         "Netflix",

    # Prime Video
    "Amazon Prime Video":                   "Prime Video",
    "Amazon Prime Video with Ads":          "Prime Video",
    "Amazon Prime Video Free with Ads":     "Prime Video",
    "Amazon Video":                         "Prime Video",
    "Prime Video with Ads":                 "Prime Video",

    # Apple TV+
    "Apple TV":                             "Apple TV+",
    "Apple TV Plus":                        "Apple TV+",
    "Apple TV Amazon Channel":              "Apple TV+",
    "Apple TV+ Amazon Channel":             "Apple TV+",
    "Apple TV Channels":                    "Apple TV+",

    # Max
    "HBO Max":                              "Max",
    "HBO Max Amazon Channel":               "Max",
    "Max Amazon Channel":                   "Max",
    "Max Apple TV Channel":                 "Max",

    # Disney+
    "Disney Plus":                          "Disney+",
    "Disney+ Amazon Channel":               "Disney+",

    "Disney Plus Amazon Channel":           "Disney+",

    # Peacock
    "Peacock Premium":                      "Peacock Premium",
    "Peacock Premium Plus":                 "Peacock Premium",
    "Peacock Amazon Channel":               "Peacock Premium",

    # Paramount+
    "Paramount Plus":                       "Paramount+",
    "Paramount+ Essential":                 "Paramount+",
    "Paramount Plus Essential":             "Paramount+",
    "Paramount Plus Premium":               "Paramount+",
    "Paramount+ Premium":                   "Paramount+",
    "Paramount+ Amazon Channel":            "Paramount+",
    "Paramount Plus Apple TV Channel":      "Paramount+",
    "Paramount+ Apple TV Channel":          "Paramount+",
    "Paramount+ Roku Premium Channel":      "Paramount+",
    "Paramount Network":                    "Paramount+",

    # Discovery+
    "Discovery Plus":                       "Discovery+",
    "Discovery+ Amazon Channel":            "Discovery+",
    
    # Cinemax
    "Cinemax Amazon Channel":               "Cinemax",
    "Cinemax Apple TV Channel":             "Cinemax",

    # Showtime
    "Showtime Amazon Channel":              "Showtime",
    "Showtime Apple TV Channel":            "Showtime",
    "Showtime Roku Premium Channel":        "Showtime",

    # Starz
    "Starz Amazon Channel":                 "Starz",
    "Starz Apple TV Channel":               "Starz",
    "Starz Roku Premium Channel":           "Starz",
    "STARZ":                                "Starz",

    # MGM+
    "MGM Plus":                             "MGM+",
    "MGM+ Amazon Channel":                  "MGM+",
    "MGM Plus Roku Premium Channel":        "MGM+",

    # AMC+
    "AMC+ Amazon Channel":                  "AMC+",
    "AMC+ Apple TV Channel":                "AMC+",
    "AMC Plus Apple TV Channel":            "AMC+",
    "AMC+ Roku Premium Channel":            "AMC+",
    
    # YOUTUBE
    "YouTube Free":                         "YouTube",

}

def normalise(name: str) -> str:
    return PROVIDER_NAME_MAP.get(name, name)

# ─── Core logic ─────────────────────────────────────────────────────────────

def process_item(item: dict, media_type: str, stats: dict) -> None:
    """
    Process a single movie or TV series.

    media_type: "movie" or "tv"
    """
    name    = item.get("Name", "Unknown")
    item_id = item["Id"]
    ids     = item.get("ProviderIds", {})
    imdb_id = ids.get("Imdb") or ids.get("IMDB")

    if not imdb_id:
        log.debug("  SKIP (no IMDB ID): %s", name)
        stats["skipped_no_id"] += 1
        return

    tmdb_id = tmdb_find_by_imdb(imdb_id, media_type)
    if not tmdb_id:
        log.debug("  SKIP (not on TMDB): %s (%s)", name, imdb_id)
        stats["skipped_no_tmdb"] += 1
        return

    providers = [normalise(p) for p in tmdb_get_providers(tmdb_id, media_type, TMDB_COUNTRY)]
    if not providers:
        log.debug("  SKIP (no providers in %s): %s", TMDB_COUNTRY, name)
        stats["skipped_no_providers"] += 1
        return

    existing_tags = set(item.get("Tags") or [])
    new_tags      = existing_tags | set(providers)

    if new_tags == existing_tags:
        log.debug("  UNCHANGED: %s", name)
        stats["unchanged"] += 1
        return

    added = new_tags - existing_tags

    log.info("  TAGGING: %-45s  +%s", name, sorted(added))

    if not DRY_RUN:
        if jf_update_tags(item, sorted(new_tags)):
            stats["updated"] += 1
        else:
            stats["errors"] += 1
    else:
        stats["updated"] += 1

    # Polite TMDB rate limit
    time.sleep(0.28)


def run_tagging_job() -> None:
    log.info("=" * 60)
    log.info("Jellyfin Network Tagger — starting run%s", " [DRY RUN]" if DRY_RUN else "")
    log.info("Country: %s | Interval: %sh", TMDB_COUNTRY, RUN_INTERVAL_HOURS)
    log.info("=" * 60)

    stats = {
        "updated": 0,
        "unchanged": 0,
        "skipped_no_id": 0,
        "skipped_no_tmdb": 0,
        "skipped_no_providers": 0,
        "errors": 0,
    }

    try:
        user_id = jf_get_user_id()

        # ── Movies ──────────────────────────────────────────────────────────
        movies = jf_get_items(user_id, "Movie")
        log.info("Found %d movies in Jellyfin library", len(movies))
        for i, movie in enumerate(movies, 1):
            if i % 50 == 0:
                log.info("Movies progress: %d / %d", i, len(movies))
            try:
                process_item(movie, "movie", stats)
            except Exception as e:
                log.warning("Error processing movie %s: %s", movie.get("Name"), e)
                stats["errors"] += 1

        # ── TV Series ───────────────────────────────────────────────────────
        series = jf_get_items(user_id, "Series")
        log.info("Found %d TV series in Jellyfin library", len(series))
        for i, show in enumerate(series, 1):
            if i % 50 == 0:
                log.info("Series progress: %d / %d", i, len(series))
            try:
                process_item(show, "tv", stats)
            except Exception as e:
                log.warning("Error processing series %s: %s", show.get("Name"), e)
                stats["errors"] += 1

    except Exception as e:
        log.error("Fatal error during run: %s", e)
        raise

    log.info("-" * 60)
    log.info(
        "Run complete: %d tagged | %d unchanged | %d no-id | "
        "%d no-tmdb | %d no-providers | %d errors",

        stats["updated"], stats["unchanged"],
        stats["skipped_no_id"], stats["skipped_no_tmdb"],
        stats["skipped_no_providers"], stats["errors"],
    )
    log.info("Next run in %d hours", RUN_INTERVAL_HOURS)
    log.info("=" * 60)

# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Jellyfin Network Tagger starting up...")
    run_tagging_job()
    schedule.every(RUN_INTERVAL_HOURS).hours.do(run_tagging_job)
    while True:
        schedule.run_pending()
        time.sleep(60)
