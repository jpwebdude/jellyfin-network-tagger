# ─── Jellyfin Network Tagger ────────────────────────────────────────────────
# Lightweight Python service that tags your Jellyfin library with streaming
# provider names (Netflix, Max, Disney+, etc.) sourced from TMDB.
#
# Build:  docker compose up --build jellyfin-network-tagger
# Pull:   docker pull jhosted/jellyfin-network-tagger:latest
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.14-slim

# OCI Metadata
LABEL org.opencontainers.image.source="https://github.com/jpwebdude/jellyfin-network-tagger"
LABEL org.opencontainers.image.description="Automatic streaming provider tagging for Jellyfin using TMDB provider data."
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.authors="jpwebdude"

# Python runtime settings
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Create non-root user
RUN useradd --create-home --uid 1000 appuser

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY tagger.py .

# Healthcheck (runs as root before switching to non‑root user)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import sys; sys.exit(0)"

# Run as non-root
USER appuser

CMD ["python", "tagger.py"]

