# Build context is the repo root so the server shares merge.py with the plugin.
FROM python:3.12-alpine
WORKDIR /app
COPY server/app.py server/index.html server/manifest.webmanifest server/icon.svg server/sw.js py_modules/merge.py ./
ENV DATA_DIR=/data PORT=8430 PYTHONUNBUFFERED=1
EXPOSE 8430
CMD ["python", "app.py"]
