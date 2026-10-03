# syntax=docker/dockerfile:1.7
#
# Base images: Docker Hardened Images (dhi.io), pinned by digest. Chosen over
# gcr.io/distroless/python3-debian12 because distroless python3-debian12
# ships Python 3.11 (verified: `python3 --version` -> 3.11.x), but
# pyproject.toml pins `requires-python = ">=3.12"`; dhi.io/python:3.12-debian12
# ships the exact Python 3.12.14 needed (verified live). The non-dev runtime
# variant has no shell/pip (verified: `sh` -> exec error), default non-root
# uid 65532 ("nonroot" convention). The `-dev` variant has a shell + pip for
# the build stage.
#
# Build context = services/pipeline (not repo root): the pipeline is a
# standalone uv project with no dependency on the pnpm workspace, so a
# narrower context keeps the build fast. See services/pipeline/.dockerignore.
#
# IMAGE SIZE FLAG (not hidden, per the verification-pipeline baseline
# change): this image measured ~478MB after adding fastembed/onnxruntime/
# numpy/pillow (the Embedder's real backend, ADR-0004 step 3) and the
# anthropic SDK -- over the 400MB target. onnxruntime + numpy + pillow
# (fastembed's transitive deps) are the bulk of the add. The fastembed
# model itself is NOT downloaded at build or first-call in this image (the
# default Embedder is the in-memory FakeEmbedder; FastEmbedEmbedder is
# only constructed when PIPELINE_USE_REAL_EMBEDDER=1 is set, see
# app/clients/embedder_factory.py), so the measured size is the *library*
# cost alone -- the ONNX model weights (tens of MB more) are a further,
# separate add the first time a real embed() call runs in a deployed
# environment with that flag set. Tracked as tech debt, not resolved here:
# options to revisit are (a) a slimmer ONNX-only install instead of the
# full `fastembed` extras, or (b) moving embedding to a separate, smaller
# service/image (the ADR-0009 Rust-service roadmap already points this
# direction for a different reason: performance, not just image size).

FROM dhi.io/python:3.12-debian12-dev@sha256:86d4db28585ae3de3bc0e4c21e42d3a1404ef20b4b858decd48134836ace7cf3 AS build
WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.22
COPY pyproject.toml uv.lock ./
# Dependencies first (cacheable layer), compiled to .pyc; no dev deps.
RUN uv sync --frozen --no-dev --no-install-project --compile-bytecode
COPY app ./app
RUN uv sync --frozen --no-dev --compile-bytecode

# Runtime: dhi.io/python non-dev — no shell, no pip, default non-root
# user (uid 65532). Native wheels in the venv were resolved by uv for this
# same base image's libc/arch, so they match at runtime (same Debian 12 /
# glibc base in build and runtime stages, only the dev tooling differs).
FROM dhi.io/python:3.12-debian12@sha256:480ff00b5db2c6452e03504129e606fa9937bf6ed80458f8b58253e5ceb16525 AS runtime
WORKDIR /app
COPY --from=build --chown=65532:65532 /app/.venv /app/.venv
COPY --from=build --chown=65532:65532 /app/app ./app
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1
USER 65532
EXPOSE 8000
# No shell in this image, so PORT (Cloud Run sets it; default 8000 for local
# dry runs) can't be read via `sh -c`. Read it in Python and exec uvicorn
# programmatically instead.
CMD ["/app/.venv/bin/python3", "-c", "import os,uvicorn; uvicorn.run('app.main:app', host='0.0.0.0', port=int(os.environ.get('PORT', '8000')))"]
