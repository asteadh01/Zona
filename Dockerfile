FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ZONA_DATA_DIR=/data
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY zona ./zona
COPY web ./web

RUN useradd --uid 1000 --no-create-home zona && mkdir -p /data && chown 1000:1000 /data
USER 1000
EXPOSE 8000

# One process on purpose: the sync loop runs inside the app, and two workers would sync and nudge twice.
CMD ["uvicorn", "zona.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
