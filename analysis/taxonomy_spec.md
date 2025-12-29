# Tweet Categorization Taxonomy v1.0

## Overview

This document defines the dimensional taxonomy for classifying founder/adopter tweets.
Each tweet event (clustered) receives labels across multiple dimensions.

**Classification Unit:** Clustered event (not individual tweets)

---

## Dimension 1: Topic (6 categories, mutually exclusive)

What is the tweet **about**?

| Topic | Code | Definition | Decision Criteria |
|-------|------|------------|-------------------|
| **Product** | `product` | Features, launches, updates, bugs, roadmap | Mentions specific product functionality, shipping, building |
| **Token** | `token` | Price, market cap, trading, listings, supply | Price numbers, exchange names, buy/sell, ATH, market mechanics |
| **Ecosystem** | `ecosystem` | Partners, other projects, community shoutouts | @mentions other projects, "congrats to", collaborations |
| **Market** | `market` | Broader crypto/macro commentary | Bitcoin, ETH, "the market", macro takes, sector analysis |
| **Personal** | `personal` | Founder's life, beliefs, vibes, greetings | "gm", personal updates, philosophy unrelated to project |
| **Meta** | `meta` | Thread continuations, link drops, replies | Just a link, "see above", thread markers, image-only |

### Topic Decision Tree

```
Is this just a link/image with no context?
  YES → meta
  NO  ↓

Does it mention specific product features, shipping, or building?
  YES → product
  NO  ↓

Does it mention price, trading, listings, or token mechanics?
  YES → token
  NO  ↓

Does it mention other projects/people in the ecosystem?
  YES → ecosystem
  NO  ↓

Is it commentary on the broader market (BTC, ETH, macro)?
  YES → market
  NO  ↓

Is it personal (gm, vibes, philosophy)?
  YES → personal
  NO  → meta (default fallback)
```

### Topic Examples

**Product:**
- "API is now live"
- "shipped the new trading view"
- "working on mobile app"

**Token:**
- "WIF AT THIRTY"
- "just listed on Robinhood"
- "hitting new ATH"

**Ecosystem:**
- "congrats to @project on their launch"
- "pumping with @bonk today"
- "shoutout to the community"

**Market:**
- "BTC looking strong"
- "ETH rotation happening"
- "macro uncertainty"

**Personal:**
- "gm"
- "feeling good about the future"
- "patience is bitter but fruit is sweet"

**Meta:**
- "https://t.co/..." (link only)
- "👆" (pointing to previous tweet)
- "1/" (thread marker only)

---

## Dimension 2: Intent (7 categories, primary + optional secondary)

What is the tweet **trying to do**?

| Intent | Code | Definition | Decision Criteria |
|--------|------|------------|-------------------|
| **Inform** | `inform` | Neutral announcement, sharing information | No emotional charge, just stating facts |
| **Celebrate** | `celebrate` | Celebrating achievements, milestones, wins | "!", excitement, ATH, milestone numbers |
| **Rally** | `rally` | Building conviction, hold/buy calls, WAGMI | "diamond hands", "this is where X pays", calls to action |
| **Defend** | `defend` | Responding to FUD, addressing criticism | "FUD", "actually...", defensive posture |
| **Engage** | `engage` | Starting conversation, asking questions | Questions, "what do you think?", polls |
| **Tease** | `tease` | Hinting at upcoming without revealing | "soon", "something big", cryptic hints |
| **Reflect** | `reflect` | Philosophical musing, personal reflection | Abstract thoughts, lessons learned, no call to action |

### Intent Decision Tree

```
Is this responding to criticism or negative sentiment?
  YES → defend
  NO  ↓

Does it ask a question or invite response?
  YES → engage
  NO  ↓

Does it hint at something upcoming without details?
  YES → tease
  NO  ↓

Is it celebrating a milestone or achievement?
  YES → celebrate
  NO  ↓

Is it a conviction call, hold/buy signal, or WAGMI?
  YES → rally
  NO  ↓

Is it philosophical/reflective without action intent?
  YES → reflect
  NO  → inform (default)
```

### Intent Examples

**Inform:**
- "API is now live" (neutral announcement)
- "we've made some changes to the UI"

**Celebrate:**
- "NEW ATH!"
- "we just crossed 1M users"
- "LFG" (in context of achievement)

**Rally:**
- "this is where conviction pays"
- "diamond hands will be rewarded"
- "you're either wif us or against us"

**Defend:**
- "let me address the FUD"
- "actually, here's what happened..."
- "the critics don't understand"

**Engage:**
- "what are we buying today?"
- "thoughts on this?"
- "gm fam" (inviting response)

**Tease:**
- "something big coming this week"
- "you're not ready for what's next"
- cryptic hints without specifics

**Reflect:**
- "patience is bitter but fruit is sweet"
- "lessons from this journey"
- philosophical musings

---

## Dimension 3: Style Tags (max 2, non-exclusive)

How does the tweet **sound**?

| Tag | Code | Definition | Signal Words/Patterns |
|-----|------|------------|----------------------|
| **Technical** | `technical` | Deep-dive explanations, system details | "how X works", architecture, code-adjacent |
| **Memetic** | `memetic` | Meme-culture, degen speak, slang | "ser", "fren", "wagmi", emoji-heavy |
| **Wordplay** | `wordplay` | Puns, creative word substitution | "wif" instead of "with", token name puns |
| **Vulnerable** | `vulnerable` | Admitting mistakes, honest about struggles | "sorry", "we messed up", transparency |
| **Hype** | `hype` | High energy, multiple exclamation marks | "!!!", ALL CAPS, "INSANE", "MASSIVE" |
| **Philosophical** | `philosophical` | Abstract wisdom, belief statements | Quotes, universal truths, values |

### Style Tag Rules

- Assign 0-2 tags (most tweets get 0-1)
- Tags are additive, not mutually exclusive
- Don't force a tag if none fit
- Prioritize the most dominant style

---

## Dimension 4: Format Tags (max 1, structural)

What **form** does the tweet take?

| Tag | Code | Definition |
|-----|------|------------|
| **Thread** | `thread` | Part of a multi-tweet thread |
| **Reply** | `reply` | Replying to someone else |
| **Quote** | `quote` | Quote-tweeting another tweet |
| **Link Only** | `link_only` | Just a URL with no/minimal text |
| **Image** | `image` | Primarily an image post |
| **One-liner** | `one_liner` | Single short statement (≤3 words or ≤10 chars) |

### Format Tag Rules

- Assign exactly 1 format tag (or none if standard tweet)
- Detection order: link_only > one_liner > thread > reply > quote > image
- Standard tweets (no special format) get no format tag

---

## Classification Examples by Founder Archetype

### Technical Founder (HYPE - Jeff)
```
Tweet: "Here's how margin works on Hyperliquid..."
→ topic: product, intent: inform, style: [technical]

Tweet: "Hyperliquid had 100% uptime with zero bad debt"
→ topic: product, intent: defend, style: [technical]
```

### Vibes Founder (PUMP - Alon)
```
Tweet: "gm"
→ topic: personal, intent: engage, style: [memetic], format: one_liner

Tweet: "the trenches >>> getting a job"
→ topic: personal, intent: reflect, style: [memetic]
```

### CEO Founder (BELIEVE - Pasternak)
```
Tweet: "Taking a 15 min break to answer questions"
→ topic: personal, intent: engage

Tweet: "We shipped the migration tool today"
→ topic: product, intent: inform
```

### Adopter (WIF - blknoiz06)
```
Tweet: "WIF AT THIRTY"
→ topic: token, intent: celebrate, style: [hype], format: one_liner

Tweet: "you're either wif us or against us"
→ topic: token, intent: rally, style: [wordplay]
```

---

## Boundary Cases (NOT this)

### Product vs Token
- "we're launching on Binance" → **product** (it's about the product getting listed)
- "WIF just listed on Binance!" → **token** (celebrating the listing, price context)

### Inform vs Celebrate
- "we crossed 1M users" → **inform** (neutral statement)
- "WE CROSSED 1M USERS!!!" → **celebrate** (emotional, exclamation)

### Rally vs Reflect
- "diamond hands will win" → **rally** (call to action, conviction)
- "patience is the key to success" → **reflect** (philosophical, no action)

### Engage vs Personal
- "gm" → **engage** (inviting response)
- "feeling good today" → **personal** + **inform** (no question, just vibes)

### Meta Detection
- Link with commentary → NOT meta (has substance)
- Pure link → meta
- "see above 👆" → meta
- Image with caption → NOT meta (has context)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12-29 | Initial taxonomy based on exploratory analysis |

---

## Notes for Labelers

1. **Read the full text** before classifying, not just first words
2. **Context matters** - same words can have different intent
3. **When uncertain**, choose the more conservative label
4. **Document edge cases** in the gold examples with reasoning
5. **Don't over-tag** - fewer tags is often more accurate
