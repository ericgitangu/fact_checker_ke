"""Real Embedder implementation: fastembed, multilingual-e5-small, 384-dim.

Model choice — `intfloat/multilingual-e5-small` via fastembed, justified:
- **384-dim**: matches the pgvector column width the dedup/retrieve stage
  needs (ADR-0004 step 3), keeping index size and cosine-distance cost
  small relative to a 768/1024-dim alternative, with negligible quality
  loss for the short-claim-text regime this pipeline operates in (claims
  are capped at 2000 chars; this is not long-document retrieval).
- **Multilingual**: e5-small's training mixture covers Swahili alongside
  English (E5 family is trained on a multilingual mixture incl. mMARCO),
  which this pipeline needs for sw/en/Sheng-code-switched claims — a
  monolingual English embedder (e.g. all-MiniLM-L6-v2) would silently
  degrade dedup recall on Swahili claims (ADR-0023 §5's Sheng/Swahili
  coverage concern applies to embedding, not only classification).
- **fastembed**: ONNX runtime, no PyTorch/CUDA dependency chain — keeps the
  Docker image smaller and CPU inference fast enough for Cloud Run's
  request-based CPU model (ADR-0017 §... Cloud Run `cpu_idle=true`).
- **Protocol-shaped** (app/protocols/embedder.py): a later Rust service
  (ADR-0009 roadmap) can replace this without touching call sites.

Tech debt / open gap: this choice is not yet validated against the 100+
claim Kenyan eval set for dedup recall on Sheng/code-switched text (ADR-0004
trade-off: "we should build our own eval set... before trusting accuracy
numbers"). Swap or re-validate once that eval set exists.
"""

from __future__ import annotations

from app.protocols.embedder import EMBEDDING_DIM, EmbeddingError

_MODEL_NAME = "intfloat/multilingual-e5-small"


class FastEmbedEmbedder:
    """Lazily imports `fastembed` on first use so importing this module (and
    the rest of the app) never requires the model download / onnxruntime
    import at process startup — only when a real embedding is actually
    requested. The `/healthz` dry run and most tests never touch this path.
    """

    def __init__(self) -> None:
        self._model: object | None = None

    @property
    def dimensions(self) -> int:
        return EMBEDDING_DIM

    def _ensure_model(self) -> object:
        if self._model is None:
            try:
                from fastembed import TextEmbedding
            except ImportError as exc:  # pragma: no cover - exercised only without the dep
                raise EmbeddingError(
                    "fastembed is not installed; add it to pyproject.toml dependencies"
                ) from exc
            self._model = TextEmbedding(model_name=_MODEL_NAME)
        return self._model

    def embed(self, text: str) -> list[float]:
        if not text.strip():
            raise EmbeddingError("cannot embed empty text")
        model = self._ensure_model()
        # fastembed's TextEmbedding.embed is a generator over an iterable of
        # documents; we pass a single-item list and take the first vector.
        vectors = list(model.embed([f"query: {text}"]))  # type: ignore[attr-defined]
        vector = vectors[0]
        result = [float(x) for x in vector]
        if len(result) != EMBEDDING_DIM:
            raise EmbeddingError(
                f"expected {EMBEDDING_DIM}-dim embedding, got {len(result)} from {_MODEL_NAME}"
            )
        return result
