FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

ENV DATA_DIR=/data
ENV AUTO_SEED=1
RUN mkdir -p /data

EXPOSE 8000

CMD uvicorn main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}
