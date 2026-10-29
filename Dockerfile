FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ZONA_DATA_DIR=/data
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY zona ./zona
COPY web ./web

# /data holds the Garmin token cache (and the SQLite file when ZONA_STORE=sqlite)
RUN useradd --uid 1000 --no-create-home zona && mkdir -p /data && chown 1000:1000 /data
USER 1000
EXPOSE 8080

# One process on purpose: two workers would sync and nudge twice. Cloud Run sets $PORT.
CMD exec uvicorn zona.main:app --host 0.0.0.0 --port "${PORT:-8080}" --proxy-headers --forwarded-allow-ips "*"
