# ─── Jellyfin Network Tagger ────────────────────────────────────────────────
# Lightweight Python service that tags your Jellyfin library with streaming
# provider names (Netflix, Max, Disney+, etc.) sourced from TMDB.
#
# Build:  docker compose up --build jellyfin-network-tagger
# Pull:   docker pull jhosted/jellyfin-network-tagger:latest
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tagger.py .

CMD ["python", "tagger.py"]
