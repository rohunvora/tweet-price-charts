# Tweet Categorization Analysis

## Project Goal
Qualitatively categorize tweet content to add a new dimension to the tweet-price correlation analysis. Eventually integrate into the data pipeline for all assets.

## Status
- [x] HYPE (Jeff/@chameleon_jeff) - 35 tweets - Founder
- [x] PUMP (Alon/@a1lon9) - 102 tweets - Founder
- [x] BELIEVE (Pasternak/@pasternak) - 81 tweets - Founder
- [ ] WIF (@blknoiz06) - 300 tweets - **Adopter** (in progress)
- [ ] Additional assets TBD

---

## Category System (v2)

| Category | Code | Definition | Example |
|----------|------|------------|---------|
| SHIP | `ship` | Product launches, features, updates | "API is now live" |
| VISION | `vision` | Big-picture mission, disruption narrative | "We will revolutionize X" |
| FLEX | `flex` | Metrics, market share, growth stats | "44% of Bybit volume" |
| DEFEND | `defend` | FUD response, addressing criticism | "Debunking the FUD..." |
| ECOSYSTEM | `eco` | Partner/project shoutouts | "Congrats to @project on launch!" |
| RALLY | `rally` | Conviction calls, diamond hands, hold/buy | "This is where conviction pays" |
| VIBES | `vibes` | Pure sentiment, mood, no substance | "gm", "higher", "comfy" |
| ENGAGE | `engage` | Q&A, conversation starters | "What are we buying today?" |
| TEASE | `tease` | Upcoming hints, "something big coming" | "Huge announcement this week" |
| MEDIA | `media` | Podcast/interview promos | "Thanks for having me on!" |
| TECHNICAL | `tech` | Deep-dive explanations of systems | "Here's how margin works..." |
| TRANSPARENT | `transparent` | Admitting mistakes, honest updates | "Sorry for the chaos" |
| ROADMAP | `roadmap` | Priority lists, "focused on X, Y, Z" | "Currently focused on: 1. 2. 3." |
| PHILOSOPHY | `philosophy` | Abstract belief/values statements | "Patience is bitter but fruit is sweet" |
| META | `meta` | Thread continuations, links only | "https://t.co/..." (FILTER OUT) |

---

## Founder Profiles

### HYPE - Jeff (@chameleon_jeff)
**Style:** Technical Founder / Professional
**Tweet Count:** 35
**Key Traits:**
- Writes detailed technical explanations
- Never does "gm" or vibes tweets
- FUD response = essays with data
- Podcast appearances are common
- Zero emotional/sentiment tweets

**Category Distribution:**
- VISION: 4 (rare but high impact)
- SHIP: 5 (detailed announcements)
- FLEX: 3 (data-heavy)
- DEFEND: 5 (essay-style rebuttals)
- TECHNICAL: 4 (deep dives)
- MEDIA: 4 (podcast promos)
- ECOSYSTEM: 3 (formal congrats)
- META: 4 (thread continuations)

**Impact Observations:**
- Vision tweets during euphoria = huge (+26%)
- FUD response tweets = mixed, mostly flat 1h
- Podcast promos = noise
- Technical tweets = small positive bias

---

### PUMP - Alon (@a1lon9)
**Style:** Degen Vibes King / Community Leader
**Tweet Count:** 102
**Key Traits:**
- Heavy on vibes/sentiment tweets
- Frequent "gm" and conversation starters
- Rally/conviction calls common
- Ecosystem shilling enthusiastic
- Never writes technical content
- Teases upcoming announcements

**Category Distribution:**
- VIBES: ~20 (core to his style)
- SHIP: ~12 (teased, not detailed)
- VISION: ~10 (vibes-adjacent)
- RALLY: ~15 (conviction calls)
- ENGAGE: ~12 (gm, what are we buying)
- FLEX: ~8 (comparisons to competitors)
- ECOSYSTEM: ~10 (enthusiastic shills)
- TEASE: ~8 (upcoming hints)
- DEFEND: ~4 (dismissive, not essays)
- META: ~3

**Impact Observations:**
- VIBES tweets have HUGE variance (+27% to -19%)
- RALLY tweets during uptrend = amplified moves
- Ecosystem shoutouts = moderate positive
- TEASE tweets = mixed, sometimes negative

**Key Insight:** Alon's pure sentiment tweets probably amplify whatever direction price was already going. His style is less predictable than Jeff's.

---

### BELIEVE - Pasternak (@pasternak)
**Style:** Startup CEO / Transparent Builder
**Tweet Count:** 81
**Key Traits:**
- Talks like a startup founder, not crypto degen
- Heavy on transparency and admitting mistakes
- Product shipping cadence is constant
- Philosophy/belief as recurring theme
- VC disruption narrative
- Never does vibes tweets

**Category Distribution:**
- SHIP: ~25 (heavy, constant updates)
- VISION: ~15 (disruption narrative)
- ROADMAP: ~10 (priority lists)
- TRANSPARENT: ~8 (unique to him)
- PHILOSOPHY: ~8 (belief statements)
- ENGAGE: ~6 (Q&A sessions)
- ECOSYSTEM: ~4
- TEASE: ~3
- META: ~2

**Impact Observations:**
- SHIP during euphoria = MASSIVE (+344%, +132%)
- TRANSPARENT during downtrend = more downside
- VISION tweets = high variance
- PHILOSOPHY tweets = moderate positive bias

**Unique Categories Identified:**
- TRANSPARENT (admitting mistakes)
- ROADMAP (priority lists)
- PHILOSOPHY (abstract belief statements)

---

## Cross-Founder Category Matrix

| Category | HYPE (Jeff) | PUMP (Alon) | BELIEVE (Pasternak) |
|----------|-------------|-------------|---------------------|
| SHIP | ✓ Detailed | ✓ Teased | ✓ **Heavy** |
| VISION | ✓ Rare | ✓ Common | ✓ **Heavy** |
| FLEX | ✓ Data | ✓ Comparisons | ✓ Metrics |
| DEFEND | ✓ Essays | ✓ Dismissive | ✗ Rare |
| ECOSYSTEM | ✓ Formal | ✓ Enthusiastic | ✓ Occasional |
| VIBES | ✗ Never | ✓ **Heavy** | ✗ Rare |
| RALLY | ✗ Never | ✓ **Heavy** | ✓ Some |
| ENGAGE | ✗ Never | ✓ Common | ✓ Q&A |
| TEASE | ✗ Rare | ✓ Common | ✓ Some |
| TECHNICAL | ✓ **Heavy** | ✗ Never | ✗ Rare |
| TRANSPARENT | ✗ Never | ✗ Never | ✓ **Unique** |
| ROADMAP | ✗ Rare | ✗ Rare | ✓ **Unique** |
| PHILOSOPHY | ✗ Never | ✗ Never | ✓ **Unique** |
| MEDIA | ✓ Common | ✗ Rare | ✗ Rare |
| META | ✓ Some | ✓ Some | ✓ Some |

---

## Key Observations So Far

### 1. Founder Style Archetypes
- **Technical Founder** (Jeff): Data-driven, professional, explains systems
- **Vibes King** (Alon): Sentiment-driven, community-focused, hype machine
- **Startup CEO** (Pasternak): Transparent, product-focused, mission-driven

### 2. Category Impact Patterns
- **SHIP during euphoria** = amplified positive moves
- **VIBES tweets** = high variance, amplify existing direction
- **DEFEND tweets** = usually flat or slightly negative
- **TRANSPARENT tweets** = can trigger more downside if already down
- **MEDIA/podcast tweets** = generally noise, no impact

### 3. Filtering Recommendations
- **FILTER OUT:** META (thread continuations, link-only tweets)
- **WEIGHT HIGHER:** SHIP, VISION during early token phases
- **WEIGHT LOWER:** MEDIA, META

---

## Adopter vs Founder Hypothesis

**Founders** store ALL tweets - their entire presence affects the token.

**Adopters** only store keyword-matching tweets - they mention the token specifically.

**Expected Differences:**
- Adopter tweets should be more directly about the token
- Adopter VIBES tweets may not exist (filtered by keyword)
- Adopter categories may skew toward ECOSYSTEM/FLEX
- Adopter impact may be more predictable (direct mentions)

---

---

## ADOPTER ANALYSIS

### WIF - blknoiz06 (@blknoiz06)
**Style:** Memetic Hype Lord / Community Cheerleader
**Tweet Count:** 300
**Founder Type:** ADOPTER (not token creator)

**Key Traits:**
- Heavy on RALLY content - constant conviction calls
- Price milestone celebrations ("WIF AT THIRTY", "bros wif is at 77 cents")
- Community identity building ("you're either wif us, or against us")
- Creative wordplay with "wif" in every phrase
- Playful FUD dismissal (not defensive essays like Jeff)
- Ecosystem awareness - mentions BONK, SOL, JUP alongside WIF
- Calls to action (Vegas Sphere fundraise)
- Exchange listing celebration
- NO SHIP, NO TECHNICAL, NO ROADMAP (he's adopting, not building)

**Category Distribution (Estimated from 300 tweets):**
- RALLY: ~80 (conviction calls, diamond hands)
- PRICE_MILESTONE: ~40 (celebrating price points)
- WORDPLAY: ~35 (creative "wif" usage)
- COMMENTARY: ~30 (market analysis, comparisons)
- ENGAGE: ~25 (roll calls, "who's wif me")
- LISTING_NEWS: ~20 (exchange listings)
- ECOSYSTEM: ~20 (mentions of BONK, SOL, etc)
- FUD_DISMISS: ~15 (playful dismissal)
- CALL_TO_ACTION: ~10 (Vegas Sphere, send memes)
- IDENTITY: ~10 (community building)
- META: ~15 (single word "wif" tweets)

**Notable Price Impacts:**

| Tweet | Category | 24h% |
|-------|----------|------|
| "BLOCKGRAZE LEADER OF THE DOGS WIF HATS" | RALLY | **+119%** |
| "idk which coin CBS talking about, only one wif a hat" | COMMENTARY | **+90%** |
| "robinhood delisted sol at $15, now listing WIF" | LISTING_NEWS | **+52%** |
| "if solana -> $140, wif == first dog to a dolla" | RALLY | **+38%** |
| "you're either wif us, or against us" | IDENTITY | **+37%** |
| "job not finished, manlets wif seiyans strong" | RALLY | **+68%** |
| "any targets under $4 for WIF are fud" | RALLY | **+33%** |
| "hey @_RichardTeng 2k retweets = list WIF" | CALL_TO_ACTION | **+41%** |
| "whoever dumped 1% WIF supply, eternal pain" | FUD_DISMISS | **-5%** |
| "told wife about ETH rotation, slapped me, walked out wif the kids" | WORDPLAY | **-16%** |

**Key Insight:**
- blknoiz06's RALLY tweets during uptrends = MASSIVE amplification
- His WORDPLAY tweets are mostly neutral/noise
- LISTING_NEWS tweets have strong positive bias
- Unlike founders, he has NO product-related categories
- His tweets are almost purely sentiment/cheerleading

---

## Adopter vs Founder Comparison

| Aspect | FOUNDERS | ADOPTERS |
|--------|----------|----------|
| Product tweets (SHIP) | ✓ Common | ✗ Never |
| Technical deep-dives | ✓ Some (Jeff) | ✗ Never |
| Roadmaps/priorities | ✓ Some (Pasternak) | ✗ Never |
| Price celebrations | ✗ Rare | ✓ Very common |
| Rally/conviction | Varies | ✓ Heavy |
| Wordplay with token | ✗ Rare | ✓ Heavy |
| Listing news | Indirect | ✓ Direct celebration |
| FUD response style | Essays or dismissive | Playful |
| Community identity | Mission-focused | Tribe-focused |

**Adopter-Specific Categories:**
These categories are unique or heavily weighted for adopters:
- `PRICE_MILESTONE` - Celebrating specific prices
- `LISTING_NEWS` - Exchange listing celebrations
- `WORDPLAY` - Creative token name usage
- `IDENTITY` - Tribe/community building ("wif us or against us")
- `CALL_TO_ACTION` - Community mobilization

---

## Updated Universal Category System (v3)

### Core Categories (All Tweeter Types)
| Category | Code | Definition |
|----------|------|------------|
| SHIP | `ship` | Product launches, features, updates |
| VISION | `vision` | Big-picture mission, disruption narrative |
| FLEX | `flex` | Metrics, market share, growth stats |
| DEFEND | `defend` | FUD response, addressing criticism |
| ECOSYSTEM | `eco` | Partner/project shoutouts |
| RALLY | `rally` | Conviction calls, diamond hands, hold/buy |
| VIBES | `vibes` | Pure sentiment, mood, no substance |
| ENGAGE | `engage` | Q&A, conversation starters |
| TEASE | `tease` | Upcoming hints, "something big coming" |
| MEDIA | `media` | Podcast/interview promos |
| TECHNICAL | `tech` | Deep-dive explanations of systems |
| TRANSPARENT | `transparent` | Admitting mistakes, honest updates |
| ROADMAP | `roadmap` | Priority lists, "focused on X, Y, Z" |
| PHILOSOPHY | `philosophy` | Abstract belief/values statements |
| META | `meta` | Thread continuations, links only |

### Adopter-Heavy Categories
| Category | Code | Definition |
|----------|------|------------|
| PRICE_MILESTONE | `price` | Celebrating specific price points |
| LISTING_NEWS | `listing` | Exchange listing announcements/celebration |
| WORDPLAY | `wordplay` | Creative token name usage in phrases |
| IDENTITY | `identity` | Tribe building ("us vs them") |
| CALL_TO_ACTION | `cta` | Community mobilization |
| COMMENTARY | `commentary` | Market analysis, token comparisons |

---

## Category Applicability Matrix

| Category | Founder (Tech) | Founder (Vibes) | Founder (CEO) | Adopter |
|----------|----------------|-----------------|---------------|---------|
| SHIP | ✓✓✓ | ✓ | ✓✓✓ | ✗ |
| VISION | ✓ | ✓✓ | ✓✓✓ | ✗ |
| FLEX | ✓✓ | ✓✓ | ✓✓ | ✓ |
| DEFEND | ✓✓✓ | ✓ | ✗ | ✓ |
| ECOSYSTEM | ✓ | ✓✓ | ✓ | ✓✓ |
| RALLY | ✗ | ✓✓✓ | ✓ | ✓✓✓ |
| VIBES | ✗ | ✓✓✓ | ✗ | ✓ |
| ENGAGE | ✗ | ✓✓ | ✓✓ | ✓✓ |
| TEASE | ✗ | ✓✓ | ✓ | ✗ |
| MEDIA | ✓✓ | ✗ | ✗ | ✗ |
| TECHNICAL | ✓✓✓ | ✗ | ✗ | ✗ |
| TRANSPARENT | ✗ | ✗ | ✓✓✓ | ✗ |
| ROADMAP | ✗ | ✗ | ✓✓✓ | ✗ |
| PHILOSOPHY | ✗ | ✗ | ✓✓ | ✗ |
| PRICE_MILESTONE | ✗ | ✗ | ✗ | ✓✓✓ |
| LISTING_NEWS | ✗ | ✓ | ✗ | ✓✓✓ |
| WORDPLAY | ✗ | ✗ | ✗ | ✓✓✓ |
| IDENTITY | ✗ | ✓ | ✗ | ✓✓✓ |
| CALL_TO_ACTION | ✗ | ✓ | ✗ | ✓✓ |
| COMMENTARY | ✗ | ✗ | ✗ | ✓✓ |

Legend: ✗ = Never, ✓ = Occasional, ✓✓ = Common, ✓✓✓ = Heavy

---

## Founder Archetype Summary

| Archetype | Example | Primary Categories | Style |
|-----------|---------|-------------------|-------|
| **Technical Founder** | Jeff (HYPE) | TECHNICAL, DEFEND, SHIP, MEDIA | Professional, data-driven |
| **Vibes Founder** | Alon (PUMP) | VIBES, RALLY, ENGAGE, ECOSYSTEM | Community-focused, memetic |
| **CEO Founder** | Pasternak (BELIEVE) | SHIP, VISION, TRANSPARENT, ROADMAP | Startup-like, mission-driven |
| **Adopter** | blknoiz06 (WIF) | RALLY, PRICE_MILESTONE, WORDPLAY, IDENTITY | Cheerleader, tribe builder |

---

## Next Steps
1. ~~Analyze WIF (adopter) to test hypothesis~~ ✓ DONE
2. Test categorization on 1-2 more assets for validation
3. Consider building semi-automated categorization script
4. Design how categories flow into the data pipeline
5. Plan UI integration (filters, color coding)

---

## Raw Data References
- HYPE: `/web/public/static/hype/tweet_events.json` (35 tweets)
- PUMP: `/web/public/static/pump/tweet_events.json` (102 tweets)
- BELIEVE: `/web/public/static/believe/tweet_events.json` (81 tweets)
- WIF: `/web/public/static/wif/tweet_events.json` (300 tweets)
