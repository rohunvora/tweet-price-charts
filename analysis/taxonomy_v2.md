# Tweet Categorization Taxonomy v2

**Created:** 2024-12-29
**Method:** Q&A alignment session, then subagent validation on all assets

---

## Philosophy

Single-dimension, content-based categorization answering: **"What is this tweet ABOUT?"**

Rejected the previous topic × intent matrix (6×7=42 cells) as over-engineered.

---

## The 9 Categories

### 1. Update
Product shipped/live, feature announcements, concrete changes.
- "API is now live"
- "Mainnet launching tomorrow"
- "New feature: you can now..."

### 2. Vision
Mission statements, philosophy, community values, origin stories.
- "We believe in decentralization"
- "This is why we started building"
- "Our mission is to..."

### 3. Price
ATH mentions, listings, volume milestones, mcap, price targets.
- "ATH!"
- "Just got listed on Binance"
- "$10 incoming"
- "100M mcap"

### 4. Data/Metrics
Platform stats, performance numbers (uptime, users, TVL, etc).
- "1M users"
- "99.9% uptime this month"
- "10B volume processed"

### 5. FUD Response
Responding to criticism, debunking, defensive explanations.
- "Addressing the FUD..."
- "Let me clarify..."
- "This is false, here's why..."

### 6. Media/Promo
Podcast appearances, interviews, external coverage.
- "Excited to be on Bankless tomorrow"
- "Great interview with..."
- "Featured in CoinDesk"

### 7. Community
Ecosystem shoutouts, engagement questions, congrats to others.
- "Congrats to the team!"
- "Who's building on X?"
- "Great work @project"

### 8. Pre-hype
Teasing upcoming features, "something big coming", hints.
- "Something big coming..."
- "Announcement tomorrow"
- "You're not ready for what's next"

### 9. Shitpost
Low substance, memes, vibes, GMs, casual flexes, "wagmi", diamond hands.
- "gm"
- "wagmi"
- "Fartcoin coded"
- Random memes

---

## Filtering Rules

### Filter Out Entirely (mark as "Filtered")
- Bare links with no text
- Just mentions/tags with no content
- Gibberish or incomprehensible text
- Single emojis or reaction-only tweets

### Flag for Review (mark as "Uncategorized")
- Genuinely unclear tweets where category is ambiguous

---

## Decision Heuristics

1. **Price vs Data/Metrics**: Price = token value (ATH, listings, mcap). Metrics = platform performance (users, uptime, volume processed).

2. **Vision vs Shitpost**: Vision has substance about mission/values. Shitpost is vibes without substance.

3. **Update vs Pre-hype**: Update = concrete shipped feature. Pre-hype = teasing something not yet live.

4. **Community vs Shitpost**: Community engages others specifically (shoutouts, questions). Shitpost is self-directed vibes.

---

## Founder Type Patterns

| Type | Dominant Categories |
|------|---------------------|
| Protocol founders (JUP, MONAD, HYPE) | Vision, Update, Community |
| Memecoin founders (FARTCOIN) | Shitpost, Price |
| Adopters/evangelists (WIF, ZEC, USELESS) | Shitpost, Vision, Price |

---

## Validation

Taxonomy validated on all 14 assets (4,258 tweets) using subagent categorization. Clear patterns emerged with minimal category overlap.
