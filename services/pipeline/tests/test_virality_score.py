"""Feed-quality (virality): the log-weighted engagement score the fetch
engine carries on a `submission.received` event. Pure unit tests — no DB,
no vendor calls — pinning the formula and its edge cases."""

from __future__ import annotations

import math

from app.stores.outbox_postgres import compute_virality_score


def test_none_engagement_is_none_not_zero() -> None:
    # A submission-sourced item (or a fetch item with no counts) has NO
    # engagement — it is excluded from the "most viral" ranking, not ranked
    # as a zero-traction item.
    assert compute_virality_score(None) is None
    assert compute_virality_score({}) is None


def test_all_zero_engagement_is_a_real_zero() -> None:
    # A fetch item that genuinely has zero traction yet is 0.0, distinct from
    # None — it IS in the ranking, just at the bottom.
    assert compute_virality_score({"views": 0, "likes": 0, "comments": 0}) == 0.0


def test_formula_is_log_weighted_views_likes_comments() -> None:
    engagement = {"views": 100_000, "likes": 4_000, "comments": 250}
    expected = round(
        1.0 * math.log1p(100_000) + 2.0 * math.log1p(4_000) + 3.0 * math.log1p(250),
        4,
    )
    assert compute_virality_score(engagement) == expected


def test_scarcer_signals_weigh_more() -> None:
    # Same raw count, but a comment outweighs a like outweighs a view.
    views_only = compute_virality_score({"views": 1_000, "likes": 0, "comments": 0})
    likes_only = compute_virality_score({"views": 0, "likes": 1_000, "comments": 0})
    comments_only = compute_virality_score({"views": 0, "likes": 0, "comments": 1_000})
    assert views_only is not None and likes_only is not None and comments_only is not None
    assert comments_only > likes_only > views_only


def test_negative_and_missing_counts_are_clamped() -> None:
    # Defensive: a malformed negative count never produces a negative score or
    # a math-domain error, and absent keys default to zero.
    assert compute_virality_score({"views": -5}) == 0.0
    assert compute_virality_score({"likes": 10}) == round(2.0 * math.log1p(10), 4)
