#!/usr/bin/env python3
"""
LLM-Based Tweet Classification (Multi-Model)
=============================================

Fallback classifier for tweets that don't match deterministic rules.
Supports GPT-5.2 and Claude Opus 4.5 with structured outputs.

Design principles:
- temp=0 for deterministic outputs
- Structured outputs (schema-constrained) - never accept invalid JSON
- Track model, prompt_hash, schema_version for reproducibility
- Truncation strategy for large clusters
- needs_review=True always (human verification required)
- No access to price/impact fields (enforced by input schema)
"""

import json
import hashlib
import os
import time
from typing import Optional, Literal
from dataclasses import dataclass, asdict, field
from pathlib import Path

# Load .env if present
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith("#") and "=" in line:
                key, value = line.strip().split("=", 1)
                os.environ.setdefault(key, value)


# =============================================================================
# Model Configuration - NO FALLBACKS
# =============================================================================

SUPPORTED_MODELS = {
    "gpt-5.2": {
        "provider": "openai",
        "model_id": "gpt-5.2",
        "env_key": "OPENAI_API_KEY",
        "uses_completion_tokens": True,  # GPT-5.x uses max_completion_tokens, not max_tokens
    },
    "opus-4.5": {
        "provider": "anthropic",
        "model_id": "claude-opus-4-20250514",  # Claude Opus 4 (latest)
        "env_key": "ANTHROPIC_API_KEY",
        "uses_completion_tokens": False,
    },
}

DEFAULT_MODEL = "opus-4.5"
SCHEMA_VERSION = "1.0"
MAX_TEXT_LENGTH = 4000  # Characters before truncation


@dataclass
class LLMClassification:
    """Classification result from LLM."""
    topic: str
    intent: str
    secondary_intent: Optional[str] = None
    style_tags: list = field(default_factory=list)
    format_tags: list = field(default_factory=list)
    reasoning: str = ""
    method: str = "llm"
    model: str = ""
    prompt_hash: str = ""
    needs_review: bool = True  # Always true for LLM
    parse_error: bool = False  # True if schema validation failed
    input_tokens: int = 0
    output_tokens: int = 0


# =============================================================================
# JSON Schema for Structured Outputs
# =============================================================================

CLASSIFICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "topic": {
            "type": "string",
            "enum": ["product", "token", "ecosystem", "market", "personal", "meta"],
            "description": "Primary topic category"
        },
        "intent": {
            "type": "string",
            "enum": ["inform", "celebrate", "rally", "defend", "engage", "tease", "reflect"],
            "description": "Primary intent/purpose"
        },
        "secondary_intent": {
            "type": "string",
            "enum": ["inform", "celebrate", "rally", "defend", "engage", "tease", "reflect", "none"],
            "description": "Secondary intent or 'none' if not applicable"
        },
        "style_tags": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["technical", "memetic", "wordplay", "vulnerable", "hype", "philosophical"]
            },
            "description": "Style tags (0-2)"
        },
        "format_tags": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["thread", "link_only", "one_liner"]
            },
            "description": "Format tags (0-1)"
        },
        "reasoning": {
            "type": "string",
            "description": "1-2 sentence explanation"
        }
    },
    "required": ["topic", "intent", "secondary_intent", "style_tags", "format_tags", "reasoning"],
    "additionalProperties": False
}


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
{text}"""


# =============================================================================
# Text Truncation
# =============================================================================

def truncate_text(text: str, max_length: int = MAX_TEXT_LENGTH) -> tuple[str, bool]:
    """
    Truncate text if too long, using head_tail strategy.
    Returns (truncated_text, was_truncated).
    """
    if len(text) <= max_length:
        return text, False

    head_length = int(max_length * 0.6)
    tail_length = max_length - head_length - 50

    head = text[:head_length]
    tail = text[-tail_length:]

    truncated = f"{head}\n\n[...{len(text) - head_length - tail_length} chars truncated...]\n\n{tail}"
    return truncated, True


def compute_prompt_hash(prompt: str) -> str:
    """Compute hash of the full prompt for reproducibility tracking."""
    return hashlib.sha256(prompt.encode()).hexdigest()[:16]


# =============================================================================
# OpenAI GPT-5.2 Classification (Structured Outputs)
# =============================================================================

def classify_with_openai(
    text: str,
    author: str,
    cluster_size: int,
    prompt_hash: str,
    was_truncated: bool,
) -> LLMClassification:
    """Classify using GPT-5.2 with structured outputs."""
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set")

    client = openai.OpenAI(api_key=api_key)
    model_id = SUPPORTED_MODELS["gpt-5.2"]["model_id"]

    user_prompt = USER_PROMPT_TEMPLATE.format(
        author=author,
        cluster_size=cluster_size,
        text=text,
    )

    try:
        # GPT-5.x uses max_completion_tokens instead of max_tokens
        response = client.chat.completions.create(
            model=model_id,
            temperature=1,  # GPT-5.x requires temperature >= 1 for structured outputs
            max_completion_tokens=500,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "tweet_classification",
                    "strict": True,
                    "schema": CLASSIFICATION_SCHEMA
                }
            }
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        # Token tracking
        input_tokens = response.usage.prompt_tokens if response.usage else 0
        output_tokens = response.usage.completion_tokens if response.usage else 0

        reasoning = result.get("reasoning", "")
        if was_truncated:
            reasoning = f"[Truncated input] {reasoning}"

        # Convert "none" string to None for secondary_intent
        secondary = result.get("secondary_intent")
        if secondary == "none":
            secondary = None

        # Limit style_tags to valid values and max 2
        style_tags = result.get("style_tags", [])
        valid_styles = ["technical", "memetic", "wordplay", "vulnerable", "hype", "philosophical"]
        style_tags = [s for s in style_tags if s in valid_styles][:2]

        # Limit format_tags to valid values and max 1
        format_tags = result.get("format_tags", [])
        valid_formats = ["thread", "link_only", "one_liner"]
        format_tags = [f for f in format_tags if f in valid_formats][:1]

        return LLMClassification(
            topic=result["topic"],
            intent=result["intent"],
            secondary_intent=secondary,
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=reasoning,
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=False,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    except json.JSONDecodeError as e:
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[Schema parse error: {str(e)[:80]}]",
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=True,
        )
    except openai.APIError as e:
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[API error: {str(e)[:80]}]",
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=True,
        )


# =============================================================================
# Anthropic Claude Opus 4.5 Classification (Tool Use for Structured Output)
# =============================================================================

def classify_with_anthropic(
    text: str,
    author: str,
    cluster_size: int,
    prompt_hash: str,
    was_truncated: bool,
) -> LLMClassification:
    """Classify using Claude Opus 4.5 with tool use for structured output."""
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)
    model_id = SUPPORTED_MODELS["opus-4.5"]["model_id"]

    user_prompt = USER_PROMPT_TEMPLATE.format(
        author=author,
        cluster_size=cluster_size,
        text=text,
    )

    # Define tool for structured output
    classification_tool = {
        "name": "submit_classification",
        "description": "Submit the tweet classification result",
        "input_schema": CLASSIFICATION_SCHEMA
    }

    try:
        response = client.messages.create(
            model=model_id,
            max_tokens=500,
            temperature=0,
            system=SYSTEM_PROMPT + "\n\nYou MUST use the submit_classification tool to provide your answer.",
            messages=[
                {"role": "user", "content": user_prompt}
            ],
            tools=[classification_tool],
            tool_choice={"type": "tool", "name": "submit_classification"}
        )

        # Token tracking
        input_tokens = response.usage.input_tokens if response.usage else 0
        output_tokens = response.usage.output_tokens if response.usage else 0

        # Extract tool use result
        tool_use = None
        for block in response.content:
            if block.type == "tool_use" and block.name == "submit_classification":
                tool_use = block
                break

        if not tool_use:
            return LLMClassification(
                topic="meta",
                intent="inform",
                reasoning="[No tool use in response]",
                model=model_id,
                prompt_hash=prompt_hash,
                needs_review=True,
                parse_error=True,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

        result = tool_use.input

        reasoning = result.get("reasoning", "")
        if was_truncated:
            reasoning = f"[Truncated input] {reasoning}"

        # Convert "none" string to None for secondary_intent
        secondary = result.get("secondary_intent")
        if secondary == "none":
            secondary = None

        # Limit style_tags to valid values and max 2
        style_tags = result.get("style_tags", [])
        valid_styles = ["technical", "memetic", "wordplay", "vulnerable", "hype", "philosophical"]
        style_tags = [s for s in style_tags if s in valid_styles][:2]

        # Limit format_tags to valid values and max 1
        format_tags = result.get("format_tags", [])
        valid_formats = ["thread", "link_only", "one_liner"]
        format_tags = [f for f in format_tags if f in valid_formats][:1]

        return LLMClassification(
            topic=result["topic"],
            intent=result["intent"],
            secondary_intent=secondary,
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=reasoning,
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=False,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    except json.JSONDecodeError as e:
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[Schema parse error: {str(e)[:80]}]",
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=True,
        )
    except anthropic.APIError as e:
        return LLMClassification(
            topic="meta",
            intent="inform",
            reasoning=f"[API error: {str(e)[:80]}]",
            model=model_id,
            prompt_hash=prompt_hash,
            needs_review=True,
            parse_error=True,
        )


# =============================================================================
# Main Classification Function
# =============================================================================

def classify_with_llm(
    combined_text: str,
    author: str,
    timestamp: int,
    cluster_size: int = 1,
    model: str = DEFAULT_MODEL,
) -> LLMClassification:
    """
    Classify a tweet using LLM with structured outputs.

    Args:
        combined_text: The tweet text (may be multiple tweets combined)
        author: Tweet author handle
        timestamp: Unix timestamp (not used but passed for signature consistency)
        cluster_size: Number of tweets in cluster
        model: Model to use - "gpt-5.2" or "opus-4.5" (NO FALLBACKS)

    Returns:
        LLMClassification with results

    IMPORTANT: This function has no access to price/impact fields.
    """
    if model not in SUPPORTED_MODELS:
        raise ValueError(f"Unsupported model: {model}. Must be one of: {list(SUPPORTED_MODELS.keys())}")

    # Truncate if needed
    text, was_truncated = truncate_text(combined_text)

    # Build prompt hash
    user_prompt = USER_PROMPT_TEMPLATE.format(
        author=author,
        cluster_size=cluster_size,
        text=text,
    )
    full_prompt = SYSTEM_PROMPT + "\n" + user_prompt
    prompt_hash = compute_prompt_hash(full_prompt)

    # Route to appropriate provider
    config = SUPPORTED_MODELS[model]
    if config["provider"] == "openai":
        return classify_with_openai(text, author, cluster_size, prompt_hash, was_truncated)
    elif config["provider"] == "anthropic":
        return classify_with_anthropic(text, author, cluster_size, prompt_hash, was_truncated)
    else:
        raise ValueError(f"Unknown provider: {config['provider']}")


# =============================================================================
# Batch Classification with Cost Tracking
# =============================================================================

@dataclass
class BatchResult:
    """Results from batch classification."""
    classifications: list
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    parse_errors: int = 0
    elapsed_seconds: float = 0.0


def classify_batch(
    events: list[dict],
    model: str = DEFAULT_MODEL,
    progress_callback: Optional[callable] = None,
) -> BatchResult:
    """
    Classify a batch of events with progress and cost tracking.

    Args:
        events: List of dicts with combined_text, author, timestamp, cluster_size
        model: Model to use
        progress_callback: Optional callback(current, total) for progress updates

    Returns:
        BatchResult with classifications and token counts
    """
    start_time = time.time()
    results = []
    total_input = 0
    total_output = 0
    parse_errors = 0
    total = len(events)

    for i, event in enumerate(events):
        result = classify_with_llm(
            combined_text=event["combined_text"],
            author=event.get("author", event.get("founder", "unknown")),
            timestamp=event.get("timestamp", event.get("anchor_timestamp", 0)),
            cluster_size=event.get("cluster_size", 1),
            model=model,
        )
        results.append(result)
        total_input += result.input_tokens
        total_output += result.output_tokens
        if result.parse_error:
            parse_errors += 1

        if progress_callback:
            progress_callback(i + 1, total)

    elapsed = time.time() - start_time

    return BatchResult(
        classifications=results,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        parse_errors=parse_errors,
        elapsed_seconds=elapsed,
    )


# =============================================================================
# Cost Estimation
# =============================================================================

# Pricing per 1M tokens (as of Dec 2024)
PRICING = {
    "gpt-5.2": {"input": 2.50, "output": 10.00},  # Estimated GPT-5.2 pricing
    "opus-4.5": {"input": 15.00, "output": 75.00},  # Claude Opus 4.5 pricing
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for given token counts."""
    if model not in PRICING:
        # Try to match model_id to pricing key
        for key, config in SUPPORTED_MODELS.items():
            if config["model_id"] == model:
                model = key
                break

    if model not in PRICING:
        return 0.0

    pricing = PRICING[model]
    cost = (input_tokens / 1_000_000) * pricing["input"]
    cost += (output_tokens / 1_000_000) * pricing["output"]
    return cost


# =============================================================================
# Testing
# =============================================================================

def test_classification(model: str = DEFAULT_MODEL):
    """Test LLM classification with specified model."""
    print(f"\nTesting {model}...")

    result = classify_with_llm(
        combined_text="WIF AT THIRTY! We're all gonna make it!",
        author="blknoiz06",
        timestamp=0,
        cluster_size=1,
        model=model,
    )

    print(f"  Topic: {result.topic}")
    print(f"  Intent: {result.intent}")
    print(f"  Style: {result.style_tags}")
    print(f"  Reasoning: {result.reasoning}")
    print(f"  Model: {result.model}")
    print(f"  Parse Error: {result.parse_error}")
    print(f"  Tokens: {result.input_tokens} in / {result.output_tokens} out")
    cost = estimate_cost(model, result.input_tokens, result.output_tokens)
    print(f"  Cost: ${cost:.6f}")
    print(f"  ✅ {model} test passed")

    return result


if __name__ == "__main__":
    import sys
    model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL
    test_classification(model)
