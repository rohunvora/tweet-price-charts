#!/usr/bin/env python3
"""
Rule-Based Tweet Classification
===============================

Deterministic rules layer that catches obvious cases with confidence=1.
If no rule matches, returns None and falls through to LLM.

Design principles:
- Readable over clever
- Each rule is independently testable
- Order matters: more specific rules first
- No access to price/impact fields (enforced by input schema)

Input: combined_text, author, timestamp, cluster_size
Output: Classification dict or None
"""

import re
from typing import Optional
from dataclasses import dataclass


@dataclass
class Classification:
    """Classification result from rules."""
    topic: str
    intent: str
    secondary_intent: Optional[str] = None
    style_tags: list = None
    format_tags: list = None
    reasoning: str = ""
    method: str = "rule"
    needs_review: bool = False  # Rule-based = auto-accept

    def __post_init__(self):
        if self.style_tags is None:
            self.style_tags = []
        if self.format_tags is None:
            self.format_tags = []


# =============================================================================
# Format Detection (structural, not content-based)
# =============================================================================

def is_link_only(text: str) -> bool:
    """Check if text is just a URL with no/minimal context."""
    # Remove whitespace
    stripped = text.strip()

    # Just a URL
    if re.match(r'^https?://\S+$', stripped):
        return True

    # URL with only emoji
    if re.match(r'^https?://\S+\s*[\U0001F300-\U0001F9FF\s]*$', stripped):
        return True

    # Multiple URLs only (thread of links)
    lines = [l.strip() for l in stripped.split('\n') if l.strip()]
    if all(re.match(r'^https?://\S+$', l) or l == '---' for l in lines):
        return True

    return False


def is_one_liner(text: str) -> bool:
    """Check if text is extremely short (≤3 words or ≤15 chars)."""
    # Remove thread separators
    clean = text.replace('---', ' ').strip()

    # Character count
    if len(clean) <= 15:
        return True

    # Word count
    words = clean.split()
    if len(words) <= 3:
        return True

    return False


def is_thread(text: str) -> bool:
    """Check if text is a multi-part thread."""
    return '---' in text and text.count('---') >= 1


def detect_format_tags(text: str) -> list[str]:
    """Detect format tags from text structure."""
    tags = []

    if is_link_only(text):
        tags.append("link_only")
    elif is_one_liner(text):
        tags.append("one_liner")

    if is_thread(text) and "link_only" not in tags:
        tags.append("thread")

    # Only return first tag (max 1 per spec)
    return tags[:1]


# =============================================================================
# Topic Detection Rules
# =============================================================================

def detect_topic_meta(text: str) -> bool:
    """Detect if topic is 'meta' (link drops, thread markers, minimal content)."""
    if is_link_only(text):
        return True

    # Thread continuation markers
    lower = text.lower().strip()
    if lower in ['👆', '☝️', 'see above', 'continued', '...']:
        return True

    # Just numbers (thread markers like "1/" "2/")
    if re.match(r'^\d+/?$', lower):
        return True

    return False


def detect_topic_token(text: str) -> Optional[str]:
    """Detect if topic is about token/price/trading."""
    lower = text.lower()

    # Price indicators
    price_patterns = [
        r'\$\d+',           # $10, $100
        r'at \d+',          # at 30 cents
        r'to \$?\d+',       # to $10
        r'ath',             # all time high
        r'market cap',
        r'mcap',
        r'listing',
        r'listed on',
        r'robinhood',
        r'coinbase',
        r'binance',
        r'exchange',
        r'trading',
        r'pumping',
        r'dumping',
    ]

    for pattern in price_patterns:
        if re.search(pattern, lower):
            return "High confidence: contains price/trading terms"

    return None


def detect_topic_product(text: str) -> Optional[str]:
    """Detect if topic is about product/features."""
    lower = text.lower()

    product_patterns = [
        r'shipped',
        r'launching',
        r'live now',
        r'is live',
        r'now live',
        r'api',
        r'feature',
        r'update',
        r'v\d+',            # v2, v3
        r'version',
        r'bug fix',
        r'improvement',
        r'mobile app',
        r'download',
        r'ios',
        r'android',
    ]

    for pattern in product_patterns:
        if re.search(pattern, lower):
            return "High confidence: contains product terms"

    return None


def detect_topic_personal(text: str) -> Optional[str]:
    """Detect if topic is personal/vibes."""
    lower = text.lower().strip()

    # Pure greetings
    if lower in ['gm', 'gn', 'good morning', 'good night']:
        return "Greeting"

    # Feeling statements
    if lower.startswith('feeling ') or lower.startswith('i feel '):
        return "Feeling statement"

    # Very short emoji-only
    if len(lower) <= 10 and re.match(r'^[\U0001F300-\U0001F9FF\s]+$', lower):
        return "Emoji only"

    return None


# =============================================================================
# Intent Detection Rules
# =============================================================================

def detect_intent_engage(text: str) -> Optional[str]:
    """Detect if intent is 'engage' (questions, conversation starters)."""
    lower = text.lower()

    # Questions
    if '?' in text:
        return "Contains question mark"

    # Explicit engagement
    engage_patterns = [
        r'what do you think',
        r'thoughts\?',
        r'who else',
        r'anyone else',
        r'gm',
        r'good morning',
    ]

    for pattern in engage_patterns:
        if re.search(pattern, lower):
            return f"Engagement pattern: {pattern}"

    return None


def detect_intent_celebrate(text: str) -> Optional[str]:
    """Detect if intent is 'celebrate' (achievements, milestones)."""
    lower = text.lower()

    # Exclamation heavy + achievement words
    exclamation_count = text.count('!')
    if exclamation_count >= 2:
        celebrate_words = ['ath', 'high', 'milestone', 'congrats', 'crossed', 'hit', 'reached']
        if any(w in lower for w in celebrate_words):
            return "Multiple exclamations + achievement words"

    # Listed on exchange (celebration context)
    if 'listed' in lower and '!' in text:
        return "Listing celebration"

    return None


def detect_intent_rally(text: str) -> Optional[str]:
    """Detect if intent is 'rally' (conviction calls, hold/buy signals)."""
    lower = text.lower()

    rally_patterns = [
        r'diamond hands',
        r'hodl',
        r'hold the line',
        r'conviction',
        r'wagmi',
        r'we\'re gonna make it',
        r'lfg',
        r'let\'s go',
        r'to the moon',
        r'inevitable',
        r'unstoppable',
        r'you\'re either .* or against',
    ]

    for pattern in rally_patterns:
        if re.search(pattern, lower):
            return f"Rally pattern: {pattern}"

    return None


def detect_intent_defend(text: str) -> Optional[str]:
    """Detect if intent is 'defend' (responding to FUD/criticism)."""
    lower = text.lower()

    defend_patterns = [
        r'fud',
        r'debunk',
        r'actually,',
        r'let me clarify',
        r'misconception',
        r'critics',
        r'haters',
    ]

    for pattern in defend_patterns:
        if re.search(pattern, lower):
            return f"Defend pattern: {pattern}"

    return None


# =============================================================================
# Style Tag Detection
# =============================================================================

def detect_style_tags(text: str) -> list[str]:
    """Detect style tags (max 2)."""
    tags = []
    lower = text.lower()

    # Technical
    technical_signals = ['how it works', 'architecture', 'protocol', 'mechanism',
                         'implementation', 'technical', 'code', 'algorithm']
    if any(s in lower for s in technical_signals):
        tags.append("technical")

    # Memetic
    memetic_signals = ['ser', 'fren', 'wagmi', 'ngmi', 'anon', 'degen', '🚀', 'gm']
    if any(s in lower for s in memetic_signals):
        tags.append("memetic")

    # Hype
    if text.count('!') >= 3 or text.isupper() or '🚀🚀' in text:
        tags.append("hype")

    # Philosophical
    philosophical_signals = ['believe', 'truth', 'wisdom', 'lesson', 'patience',
                             'life', 'journey', 'meaning']
    if any(s in lower for s in philosophical_signals) and len(text) > 50:
        tags.append("philosophical")

    # Wordplay (token name substitution)
    # This is hard to detect without knowing the token - skip for rules

    return tags[:2]  # Max 2


# =============================================================================
# Main Classification Function
# =============================================================================

def classify_by_rules(
    combined_text: str,
    author: str,
    timestamp: int,
    cluster_size: int = 1,
) -> Optional[Classification]:
    """
    Attempt to classify using deterministic rules.

    Returns Classification if confident, None if should fall through to LLM.

    IMPORTANT: This function has no access to price/impact fields.
    """
    # -------------------------------------------------------------------------
    # NO-LEAKAGE ASSERTION
    # This function must never receive price data. The signature enforces this.
    # If you're tempted to add price_at_tweet or change_pct, DON'T.
    # -------------------------------------------------------------------------

    text = combined_text.strip()
    format_tags = detect_format_tags(text)
    style_tags = detect_style_tags(text)

    # =========================================================================
    # Rule 1: Link-only → meta/inform
    # =========================================================================
    if is_link_only(text):
        return Classification(
            topic="meta",
            intent="inform",
            format_tags=["link_only"],
            reasoning="Link-only content with no context",
        )

    # =========================================================================
    # Rule 2: Pure greeting → personal/engage
    # =========================================================================
    lower = text.lower().strip()
    if lower in ['gm', 'gn', 'good morning', 'good night']:
        return Classification(
            topic="personal",
            intent="engage",
            style_tags=["memetic"] if lower in ['gm', 'gn'] else [],
            format_tags=["one_liner"],
            reasoning="Pure greeting",
        )

    # =========================================================================
    # Rule 3: Single emoji → meta/inform
    # =========================================================================
    if len(text) <= 5 and re.match(r'^[\U0001F300-\U0001F9FF\s]+$', text):
        return Classification(
            topic="meta",
            intent="inform",
            format_tags=["one_liner"],
            reasoning="Emoji-only response",
        )

    # =========================================================================
    # Rule 4: Thread marker only → meta/inform
    # =========================================================================
    if re.match(r'^\d+/?\.?\s*$', text):
        return Classification(
            topic="meta",
            intent="inform",
            reasoning="Thread marker only",
        )

    # =========================================================================
    # For remaining cases, we need more confidence to auto-classify.
    # Only proceed if multiple signals align.
    # =========================================================================

    # Detect potential topics
    topic_token = detect_topic_token(text)
    topic_product = detect_topic_product(text)
    topic_personal = detect_topic_personal(text)

    # Detect potential intents
    intent_engage = detect_intent_engage(text)
    intent_celebrate = detect_intent_celebrate(text)
    intent_rally = detect_intent_rally(text)
    intent_defend = detect_intent_defend(text)

    # =========================================================================
    # Rule 5: Clear rally call → token/rally
    # =========================================================================
    if intent_rally and (topic_token or 'wif' in lower or 'fartcoin' in lower):
        return Classification(
            topic="token",
            intent="rally",
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=f"Rally call: {intent_rally}",
        )

    # =========================================================================
    # Rule 6: Clear celebration with price context → token/celebrate
    # =========================================================================
    if intent_celebrate and topic_token:
        return Classification(
            topic="token",
            intent="celebrate",
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=f"Token celebration: {intent_celebrate}",
        )

    # =========================================================================
    # Rule 7: Clear FUD response → product or token / defend
    # =========================================================================
    if intent_defend:
        topic = "product" if topic_product else "token" if topic_token else "product"
        return Classification(
            topic=topic,
            intent="defend",
            style_tags=style_tags,
            format_tags=format_tags,
            reasoning=f"Defense: {intent_defend}",
        )

    # =========================================================================
    # No confident rule match → fall through to LLM
    # =========================================================================
    return None


# =============================================================================
# Testing
# =============================================================================

def test_rules():
    """Quick sanity tests."""
    tests = [
        ("https://t.co/abc123", "meta", "inform"),
        ("gm", "personal", "engage"),
        ("😂", "meta", "inform"),
        ("1/", "meta", "inform"),
        ("WIF TO THE MOON wagmi", "token", "rally"),
        ("just listed on Binance!!!", "token", "celebrate"),
        ("let me address the FUD", "product", "defend"),
    ]

    for text, expected_topic, expected_intent in tests:
        result = classify_by_rules(text, "test", 0)
        if result:
            status = "✅" if result.topic == expected_topic and result.intent == expected_intent else "❌"
            print(f"{status} '{text[:30]}...' → {result.topic}/{result.intent} (expected {expected_topic}/{expected_intent})")
        else:
            print(f"⏭️  '{text[:30]}...' → None (fell through to LLM)")


if __name__ == "__main__":
    test_rules()
