# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base
RUN pip install --no-cache-dir uv
WORKDIR /app

FROM base AS deps
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

FROM deps AS runtime
COPY app ./app
RUN uv sync --no-dev
RUN addgroup --system pipeline && adduser --system --ingroup pipeline pipeline
USER pipeline
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
