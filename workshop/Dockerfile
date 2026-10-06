# Build context is the repo root so the Workshop shares Steam sign-in code with the sync server
# and the Scroll format (and its Ed25519 signatures) with the Deck plugin.
FROM python:3.12-alpine
WORKDIR /app
COPY workshop/app.py workshop/db.py workshop/index.html server/steam.py py_modules/scrollfmt.py py_modules/ed25519.py ./
# The official Scrolls (built from scrolls/ with `node scrolls/build.mjs`), published and signed on start.
COPY workshop/scrolls ./scrolls
ENV DATA_DIR=/data PORT=8431 PYTHONUNBUFFERED=1
EXPOSE 8431
CMD ["python", "app.py"]
