# 🎬 Jellyfin Network Tagger — v1.0.0

**Automatically tag your Jellyfin library with streaming network information**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)[![Python](https://img.shields.io/badge/Python-3.14-blue?logo=python&logoColor=white)](https://www.python.org/)[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/)[![Jellyfin](https://img.shields.io/badge/Jellyfin-10.11-00A4DC?logo=jellyfin&logoColor=white)](https://jellyfin.org/)[![TMDB](https://img.shields.io/badge/Powered%20by-TMDB-01B4E4?logo=themoviedb&logoColor=white)](https://www.themoviedb.org/)

A lightweight Python + Docker service that scans your [Jellyfin](https://jellyfin.org/) library, looks up each item on [TMDB](https://www.themoviedb.org/), and automatically adds clean, normalized streaming provider tags — Netflix, Max, Disney+, Prime Video, Apple TV+, Paramount+, Discovery+ and more.

These tags can then be used by plugins like **Auto Collections** [(github.com)](https://github.com/KeksBombe/jellyfin-plugin-auto-collections") or **SmartLists** [(github.com)](https://github.com/jyourstone/jellyfin-smartlists-plugin") to automatically build per‑network collections, and surfaced beautifully on your Jellyfin homepage with the **KefinTweaks** plugin [(github.com)](https://github.com/ranaldsgift/KefinTweaks").

</div>

---

## 🧩 Highlights

+ 🔍 **Automatic provider tagging** via TMDB API

+ 🧠 **Non‑destructive updates** — adds tags without overwriting existing metadata

+ 🕒 **Scheduled runs** — configurable interval (default: every 24h)

+ 🧰 **Docker‑ready** — build from source or pull pre‑built image

+ 🧾 **Detailed logging** — dry‑run mode for safe testing

+ 💡 **Integrates seamlessly** with Jellyfin Auto Collections and SmartLists

---

## 📸 Screenshots

<p align="center">
<a href="docs/images/jellyfin-desktop-network-rows.jpg">
<img src="docs/images/jellyfin-desktop-network-rows.jpg" width="65%" style="border-radius:8px;" />
</a>
<a href="docs/images/jellyfin-mobile-network-rows.jpg">
<img src="docs/images/jellyfin-mobile-network-rows.jpg" width="25%" style="border-radius:8px;" />
</a>
</p>

## 🎥 Video Preview

(Click image below to view video)

<p align="center">
<a href="https://youtu.be/u2z-TYNpBhs?si=D5jFXIbt20CBf0gM">
<img src="docs/images/jellyfin-network-tagger-video-preview.jpg" width="85%" style="border-radius:8px;" />
</a>
</p>

## Prerequisites

Before deploying, make sure you have the following:

| Requirement                | Notes                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Docker**                 | Docker Engine or Docker Desktop with Compose v2                                                                 |
| **Jellyfin Server**        | Versions 10.8+ to 10.11.11 running as a Docker container. Jellyfin Server v12 is not supported as of this time. |
| **Jellyfin API Key**       | Dashboard → API Keys → **+** (name it `tagger`)                                                                 |
| **TMDB Account**           | Free account at [themoviedb.org](https://www.themoviedb.org/)                                                   |
| **TMDB Read Access Token** | Settings → API → **Read Access Token** (the long `eyJ...` token)                                                |
| **IMDB Metadata**          | Your Jellyfin items must have IMDB IDs in their ProviderIds                                                     |

> ⚠️ **Important:** The TMDB Read Access Token (starts with `eyJ`) is required — *not* the short API key. Using the wrong one will cause all TMDB lookups to fail.



---

## 🧱 Installation

### Option A — Build from source

```bash
git clone https://github.com/jpwebdude/jellyfin-network-tagger.git
cd jellyfin-network-tagger
docker compose up --build jellyfin-network-tagger
```

#### OPTION B — Pull pre‑built image

```
docker pull jhosted/jellyfin-network-tagger:latest
docker compose up -d jellyfin-network-tagger


```

#### Example docker-compose.yml with your existing Jellyfin Stack

```yaml
services:
  # ... your existing services (jellyfin, radarr, etc.)

  jellyfin-network-tagger:
    build:
      context: ./jellyfin-network-tagger
      dockerfile: Dockerfile
    container_name: jellyfin-network-tagger
    restart: unless-stopped
    env_file:
      - ./jellyfin-network-tagger/.env
    networks:
      - media-stack_default   # Must match your existing Docker network name - find yours with command docker network ls

networks:                     # This block must be at ROOT level (zero indentation).
  media-stack_default:        # It tells Compose that this network already exists.
    external: true
```

> ⚠️ The `networks:` declaration must be at **root level** (zero indentation) 

**4. Find your Docker network name**

```bash
docker network ls
# Look for a name ending in _default — usually yourfoldername_default
```

**5. Start with a Dry Run**

```bash
docker compose up  jellyfin-network-tagger
```

<mark>Watch the logs. With `DRY_RUN=true` (the default), the tagger will log everything it *would* tag without writing anything to Jellyfin. Verify the results look right.</mark>

**6. Go live**

Edit `.env` and set `DRY_RUN=false`, then do a clean rebuild:

```bash
docker compose down  jellyfin-network-tagger
docker rmi  jellyfin-network-tagger
docker compose up -d --build jellyfin-network-tagger
```

---



## ⚙️ Configuration

All configuration is done through environment variables in your `.env` file.

| Variable             | Default      | Description                                                                                                                             |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `JELLYFIN_URL`       | *(required)* | Full URL to your Jellyfin server. Use your host's LAN IP from inside Docker — **not** `localhost`. Example: `http://192.168.1.100:8096` |
| `JELLYFIN_API_KEY`   | *(required)* | Your Jellyfin API key from Dashboard → API Keys                                                                                         |
| `TMDB_API_KEY`       | *(required)* | TMDB Read Access Token (the long `eyJ...` one — not the short key)                                                                      |
| `TMDB_COUNTRY`       | `US`         | Two-letter country code for provider lookup                                                                                             |
| `RUN_INTERVAL_HOURS` | `24`         | How often to re-scan the library (hours)                                                                                                |
| `DRY_RUN`            | `false`      | Set to `true` to preview without writing any tags                                                                                       |
| `IGNORE_PROVIDERS`   | *(empty)*    | Comma-separated list of provider names to skip entirely                                                                                 |

Edit `.env` with your Jellyfin + TMDB credentials:

```env
JELLYFIN_URL=http://192.168.1.100:8096
JELLYFIN_API_KEY=your-jellyfin-api-key-here
TMDB_API_KEY=eyJ...your-tmdb-read-access-token-here
TMDB_COUNTRY=US
RUN_INTERVAL_HOURS=24
DRY_RUN=true
IGNORE_PROVIDERS=Tubi TV,Pluto TV,Crackle,The Roku Channel,Kanopy,fuboTV,Philo
```

---

## Provider Name Normalisation

TMDB returns verbose provider names like `Netflix Standard with Ads` or `Paramount+ Roku Premium Channel`. The tagger collapses all variants into clean, consistent display names:

| Raw TMDB Name                         | Normalised Tag |
| ------------------------------------- | -------------- |
| Netflix basic/Standard with Ads       | `Netflix`      |
| Amazon Prime Video / with Ads         | `Prime Video`  |
| Apple TV / Apple TV Plus              | `Apple TV+`    |
| HBO Max / Max Amazon Channel          | `Max`          |
| Disney Plus / Disney+ Amazon Channel  | `Disney+`      |
| Peacock Premium / Premium Plus        | `Peacock`      |
| Paramount Plus / Paramount+ Essential | `Paramount+`   |
| Discovery Plus                        | `Discovery+`   |
| Showtime Amazon/Apple/Roku Channel    | `Showtime`     |
| STARZ / Starz Amazon Channel          | `Starz`        |
| MGM Plus / MGM+ Amazon Channel        | `MGM+`         |
| AMC+ Amazon/Apple/Roku Channel        | `AMC+`         |

> **If you see unmapped provider names appearing as tags, add them to the `PROVIDER_NAME_MAP` dictionary in `tagger.py`, rebuild the container, and restart.**

---

## Daily Operations

**Watch live logs**

```bash
docker logs -f jellyfin-network-tagger
```

**Trigger an immediate re-scan**

```bash
docker compose restart jellyfin-network-tagger
```

**Run in background (detached)**

```bash
docker compose up -d jellyfin-network-tagger
```

**Stop the tagger**

```bash
docker compose down jellyfin-network-tagger
```

**Change the run interval**

```bash
# Edit .env
RUN_INTERVAL_HOURS=24

# Then restart
docker compose restart jellyfin-network-tagger
```

## 📊 Example Run Summary

At the end of each run, the tagger prints a one-line summary:

```
Run complete: 42 tagged | 310 unchanged | 12 no-id | 3 no-tmdb | 8 no-providers | 0 errors
```

| Stat           | Meaning                                                   |
| -------------- | --------------------------------------------------------- |
| `tagged`       | Items that had new provider tags written successfully     |
| `unchanged`    | Items already tagged correctly — skipped                  |
| `no-id`        | Items with no IMDB ID in Jellyfin metadata — skipped      |
| `no-tmdb`      | IMDB ID not found in TMDB database — skipped              |
| `no-providers` | Found on TMDB but no streaming data for your country      |
| `errors`       | Failed to write back to Jellyfin — check logs for details |

---

## 🛠 Troubleshooting

+ **TMDB lookups failing** → ensure you’re using the long Read Access Token (`eyJ...`)

+ **No items processed** → use your host LAN IP for `JELLYFIN_URL`, not `localhost`

+ **Code changes not applying** → run a clean rebuild (`docker rmi jellyfin-network-tagger`)

+ **Network errors** → ensure your `networks:` block is at root level in Compose

```bash
docker compose down jellyfin-network-tagger
docker rmi jellyfin-network-tagger
docker compose up -d --build jellyfin-network-tagger
```

+ **`invalid compose project` or network error** → The `networks:` block is nested under the service instead of at root level. Move it to zero indentation at the bottom of your `docker-compose.yml`.

+ **Provider names appearing unclean** → Add the raw name to `PROVIDER_NAME_MAP` in `tagger.py` mapping it to your preferred clean name, then rebuild.

---

## Updating

When a new version is released:

```bash
# 1. Pull the latest code
git pull

# 2. Force a clean rebuild
docker compose down jellyfin-network-tagger
docker rmi jellyfin-network-tagger
docker compose up -d --build jellyfin-network-tagger

# 3. Verify the new version is running
docker logs jellyfin-network-tagger | head -5
```

> The `--build` flag alone isn't always enough if Docker has cached layers. Always remove the old image with `docker rmi` first to guarantee the new code is running.

---

## Recommended Jellyfin Plugins

The tagger works great alongside these Jellyfin plugins:

- [KeksBombe's - Auto Collections](https://github.com/KeksBombe/jellyfin-plugin-auto-collections) — automatically builds per-network collections from the tags this tool writes.
- [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks) — surfaces those collections as rows on your Jellyfin homepage.
+ [Jellyfin SmartLists](https://github.com/jyourstone/jellyfin-smartlists-plugin)  — automatically builds per-network collections from the tags this tool writes.

---

## ❤️ Acknowledgements

This tool was built by a member of the Jellyfin community for the Jellyfin community.

Streaming provider data is sourced from [The Movie Database (TMDB)](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## 🤝 Contributing

We welcome contributions, bug fixes, and feature requests! Because this plugin is built for the Jellyfin ecosystem, all contributions must adhere to open-source compliance.



## ⚖️ License & Anti-Commercial Policy

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**. 

See the [LICENSE](LICENSE) file for the full legal text.

---

<div align="center">
  <sub>Made with ❤️ for the self-hosting community</sub>
</div>
