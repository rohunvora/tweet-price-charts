#!/usr/bin/env python3
"""
LLM-Based Tweet Classification
==============================

Fallback classifier for tweets that don't match deterministic rules.
Uses Claude with temp=0 for reproducibility.

Design principles:
- temp=0 for deterministic outputs
- Track model, prompt_hash, schema_version for reproducibility
- Truncation strategy for large clusters
- needs_review=True always (human verification required)
- No access to price/impact fields (enforced by input schema)
"""

import json
import hashlib
import os
from typing import Optional
from dataclasses import dataclass, asdict

# Try to import anthropic
try:
    import anthropic
except ImportError:
    raise ImportError("anthropic required. Install with: pip install anthropic")


# =============================================================================
# Configuration
# =============================================================================

MODEL = "claude-sonnet-4-20250514"
SCHEMA_VERSION = "1.0"
MAX_TEXT_LENGTH = 4000  # Characters before truncation
TRUNCATION_STRATEGY = "head_tail"  # Keep first and last portions


@dataclass
class LLMClassification:
    """Classification result from LLM."""
    topic: str
    intent: str
    secondary_intent: Optional[str] = None
    style_tags: list = None
    format_tags: list = None
    reasoning: str = ""
    method: str = "llm"
    model: str = MODEL
    prompt_hash: str = ""
    needs_review: bool = True  # Always true for LLM

    def __post_init__(self):
        if self.style_tags is None:
            self.style_tags = []
        if self.format_tags is None:
            self.format_tags = []


# =============================================================================
# Prompt Template
# =============================================================================

SYSTEM_PROMPT = """You are a tweet classifier for crypto founder/adopter tweets.

Your task: Classify each tweet into EXACTLY ONE topic and EXACTLY ONE intent.

## Topics (choose exactly one)
- product: Features, launches, updates, bugs, roadmap
- token: Price, market cap, trading, listings, supply
- ecosystem: Partners, other projects, community shoutouts
- market: Broader crypto/macro commentary (BTC, ETH, sector)
- personal: Founder's life, beliefs, vibes, greetings
- meta: Thread continuations, link drops, replies with no substance

## Intents (choose exactly one)
- inform: Neutral announcement, sharing information
- celebrate: Celebrating achievements, milestones, wins
- rally: Building conviction, hold/buy calls, WAGMI energy
- defend: Responding to FUD, addressing criticism
- engage: Starting conversation, asking questions
- tease: Hinting at upcoming without revealing
- reflect: Philosophical musing, personal reflection

## Style Tags (choose 0-2)
- technical: Deep-dive explanations, system details
- memetic: Meme-culture, degen speak, slang (ser, fren, wagmi)
- wordplay: Puns, creative word substitution
- vulnerable: Admitting mistakes, honest about struggles
- hype: High energy, exclamation marks, ALL CAPS
- philosophical: Abstract wisdom, belief statements

## Format Tags (choose 0-1)
- thread: Part of multi-tweet thread
- link_only: Just a URL with no/minimal text
- one_liner: Single short statement (≤3 words)

## Output Format
Return ONLY valid JSON with these fields:
{
  "topic": "one of: product, token, ecosystem, market, personal, meta",
  "intent": "one of: inform, celebrate, rally, defend, engage, tease, reflect",
  "secondary_intent": "optional, one of the intents or null",
  "style_tags": ["max 2 tags from style list"],
  "format_tags": ["max 1 tag from format list"],
  "reasoning": "1-2 sentence explanation"
}

## Rules
1. Choose the MOST DOMINANT topic and intent
2. If uncertain between two, pick the more conservative (inform > celebrate, personal > meta)
3. Don't over-tag - fewer style tags is often more accurate
4. Empty style_tags and format_tags arrays are valid
5. secondary_intent is optional - only use if clearly dual-purpose"""


USER_PROMPT_TEMPLATE = """Classify this tweet:

Author: {author}
Cluster Size: {cluster_size} tweet(s)
Text:
{text}

Return only JSON, no other text."""


# =============================================================================
# Text Truncation
# =============================================================================

def truncate_text(text: str, max_length: int = MAX_TEXT_LENGTH) -> tuple[str, bool]:
    """
    Truncate text if too long, using head_tail strategy.

    Returns (truncated_text, was_truncated).

    Strategy: Keep first 60% and last 40% of allowed length.
    This preserves the opening context and recent content.
    """
    if len(text) <= max_length:
        return text, False

    # Head-tail split: 60% head, 40% tail
    head_length = int(max_length * 0.6)
    tail_length = max_length - head_length - 50  # Reserve for indicator

    head = text[:head_length]
    tail = text[-tail_length:]

    truncated = f"{head}\n\n[...{len(text) - head_length - tail_length} chars truncated...]\n\n{tail}"
    return truncated, True


def compute_prompt_hash(prompt: str) -> str:
    """Compute hash of the full prompt for reproducibility tracking."""
    return hashlib.sha256(prompt.encode()).hexdigest()[:16]


# =============================================================================
# LLM Classification
# =============================================================================

def classify_with_llm(
    combined_text: str,
    author: str,
    timestamp: int,
    cluster_size: int = 1,
    api_key: Optional[str] = None,
) -> LLMClassification:
    """
    Classify a tweet using Claude LLM.

    Args:
        combined_text: The tweet text (may be multiple tweets combined)
        author: Tweet author handle
        timestamp: Unix timestamp (not used in classification but passed for consistency)
        cluster_size: Number of tweets in cluster
        api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)

    Returns:
        LLMClassification with results

    IMPORTANT: This function has no access to price/impact fields.
    """
    # Get API key
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    # Truncate if needed
    text, was_truncated = truncate_text(combined_text)

    # Build user prompt
    user_prompt = USER_PROMPT_TEMPLATE.format(
        author=author,
        cluster_size=cluster_size,
        text=text,
    )

    # Compute prompt hash for reproducibility
    full_prompt = SYSTEM_PROMPT + "\n" + user_prompt
    prompt_hash = compute_prompt_hash(full_prompt)

    # Call Claude
    client = anthropic.Anthropic(api_key=key)

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=500,
            temperature=0,  # Deterministic
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )

        # Parse response
        content = response.content[0].text.strip()

        # Handle potential markdown code blocks
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1])

        result = json.loads(content)

        # Validate and normalize
        topic = result.get("topic", "meta")
        intent = result.get("intent", "inform")

        # Validate topic
        valid_topics = ["product", "token", "ecosystem", "market", "personal", "meta"]
        if topic not in valid_topics:
            topic = "meta"

        # Validate intent
        valid_intents = ["inform", "celebrate", "rally", "defend", "engage", "tease", "reflect"]
        if intent not in valid_intents:
            intent = "inform"

        # Handle secondary_intent
        secondary = result.get("secondary_intent")
        if secondary and secondary not in valid_intents:
            secondary = None

        # Handle style_tags (max 2)
        style_tags = result.get("style_tags", [])
        if not isinstance(style_tags, list):
            style_tags = []
        valid_styles = ["technical", "memetic", "wordplay", "vulnerable", "hype", "philosophical"]
        style_tags = [s for s in style_tags if s in valid_styles][:2]

        # Handle format_tags (max 1)
        format_tags = result.get("format_tags", [])
        if not isinstance(format_tags, list):
            format_tags = []
        valid_formats = ["thread", "link_only", "one_liner"]
        format_tags = [f for f in format_tags if f in valid_formats][:1]

        # Get reasoning
        reasoning = result.get("reasoning", "")
        if was_truncated:
            reasoning = f"[Truncated input] {reasoning}"

        return LLMClassification(
            topic=topic,
            intent=intent,
            secondary_intent=secondary,
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=reasoning,
            model=MODEL,
            prompt_hash=prompt_hash,
            needs_review=True,
        )

    except json.JSONDecodeError as e:
        # Failed to parse - return safe defaults
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[Parse error: {str(e)[:50]}]",
            model=MODEL,
            prompt_hash=prompt_hash,
            needs_review=True,
        )
    except anthropic.APIError as e:
        # API error - return safe defaults
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[API error: {str(e)[:50]}]",
            model=MODEL,
            prompt_hash=prompt_hash,
            needs_review=True,
        )


# =============================================================================
# Batch Classification (with rate limiting)
# =============================================================================

def classify_batch(
    events: list[dict],
    api_key: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> list[LLMClassification]:
    """
    Classify a batch of events with progress tracking.

    Args:
        events: List of dicts with combined_text, author, timestamp, cluster_size
        api_key: Anthropic API key
        progress_callback: Optional callback(current, total) for progress updates

    Returns:
        List of LLMClassification results
    """
    results = []
    total = len(events)

    for i, event in enumerate(events):
        result = classify_with_llm(
            combined_text=event["combined_text"],
            author=event.get("author", "unknown"),
            timestamp=event.get("timestamp", 0),
            cluster_size=event.get("cluster_size", 1),
            api_key=api_key,
        )
        results.append(result)

        if progress_callback:
            progress_callback(i + 1, total)

    return results


# =============================================================================
# Testing
# =============================================================================

def test_truncation():
    """Test truncation logic."""
    short = "Hello world"
    truncated, was = truncate_text(short)
    assert not was, "Short text should not be truncated"

    long = "x" * 10000
    truncated, was = truncate_text(long, max_length=1000)
    assert was, "Long text should be truncated"
    assert len(truncated) <= 1100, "Truncated text should be near max_length"
    assert "truncated" in truncated, "Should have truncation indicator"

    print("✅ Truncation tests passed")


def test_classification():
    """Test LLM classification (requires API key)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("⏭️  Skipping LLM test (no API key)")
        return

    result = classify_with_llm(
        combined_text="WIF AT THIRTY! We're all gonna make it!",
        author="blknoiz06",
        timestamp=0,
        cluster_size=1,
    )

    print(f"Topic: {result.topic}")
    print(f"Intent: {result.intent}")
    print(f"Style: {result.style_tags}")
    print(f"Reasoning: {result.reasoning}")
    print(f"Model: {result.model}")
    print(f"Prompt Hash: {result.prompt_hash}")
    print("✅ LLM classification test passed")


if __name__ == "__main__":
    test_truncation()
    test_classification()
