# Build context is the repo root so the Workshop shares Steam sign-in code with the sync server.
FROM python:3.12-alpine
WORKDIR /app
COPY workshop/app.py workshop/db.py workshop/index.html server/steam.py ./
ENV DATA_DIR=/data PORT=8431 PYTHONUNBUFFERED=1
EXPOSE 8431
CMD ["python", "app.py"]
