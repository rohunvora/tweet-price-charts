# Tweet Categorization Results - v2 Taxonomy

**Generated:** 2024-12-29
**Method:** Subagent categorization using aligned 9-category taxonomy
**Total Tweets:** 4,258 across 14 assets

---

## Executive Summary

Successfully categorized all tweets using Claude subagents instead of external LLM APIs. The 9-category single-dimension taxonomy (replacing the previous topic × intent matrix) works well with clear patterns per founder type.

---

## Overall Distribution

| Category | Count | % |
|----------|-------|---|
| Shitpost | ~1,600 | 38% |
| Vision | ~750 | 18% |
| Price | ~400 | 9% |
| Update | ~350 | 8% |
| Community | ~300 | 7% |
| Data/Metrics | ~280 | 7% |
| FUD Response | ~200 | 5% |
| Pre-hype | ~130 | 3% |
| Media/Promo | ~80 | 2% |
| Filtered | ~170 | 4% |

---

## Per-Asset Results

### Memecoins

| Asset | Tweets | Top Category | 2nd Category |
|-------|--------|--------------|--------------|
| FARTCOIN | 1,876 | Shitpost (70%) | Price (15%) |
| WIF | 300 | Shitpost (39%) | Price (26%) |
| GORK | 106 | Filtered (38%) | Shitpost (37%) |

**Patterns:**
- Shitpost-dominant content
- Heavy price commentary
- Repetitive catchphrases
- Zero product updates

### Protocol Founders

| Asset | Tweets | Top Category | 2nd Category |
|-------|--------|--------------|--------------|
| JUP | 680 | Vision (27%) | Update (17%) |
| MONAD | 66 | Update (30%) | Community (26%) |
| HYPE | 35 | Vision (26%) | FUD Response (14%) |
| META | 142 | Vision (25%) | Update (16%) |
| XPL | 26 | Vision (42%) | Shitpost (12%) |
| BELIEVE | 81 | Vision (27%) | Update (23%) |
| PUMP | 102 | Shitpost (31%) | Vision (23%) |

**Patterns:**
- Vision/Update dominant
- Low price mentions
- Technical depth
- FUD response when attacked

### Adopters/Evangelists

| Asset | Tweets | Top Category | 2nd Category |
|-------|--------|--------------|--------------|
| USELESS | 435 | Vision (35%) | Data/Metrics (20%) |
| ASTER | 318 | Vision (16%) | Community (16%) |
| ZEC | 89 | Vision (27%) | Data/Metrics (19%) |
| WLD | 2 | Vision (50%) | Data/Metrics (50%) |

**Patterns:**
- Thesis-driven evangelism
- Data citations as proof
- Bridge multiple communities

---

## Key Insights

### 1. Shitpost is Huge (~38%)
Memecoin culture dominates the dataset. FARTCOIN alone (1,876 tweets) is 44% of all data and 70% shitpost.

### 2. Vision is Universal
Every founder type uses vision content, but intensity varies:
- Protocol founders: ~25-42%
- Memecoins: ~3-14%
- Adopters: ~27-50%

### 3. Price Commentary Splits Cleanly
- Memecoins: 15-26% price content
- Protocols: 0-2% (actively avoid)
- Adopters: varies by token type

### 4. Filtering Works
- ~4% overall should be filtered
- GORK highest (38%) - mostly bare @gork mentions
- Most founder accounts have <5% filtered

### 5. FUD Response is Context-Dependent
- HYPE (14%) - defending Hyperliquid architecture
- ZEC (16%) - defending privacy narrative
- FARTCOIN (3%) - ignores FUD, uses humor

---

## Taxonomy Validation

The 9-category system successfully handles:

| Tweet Type | Category |
|------------|----------|
| "gm", memes, vibes | Shitpost |
| "ATH!", "$10 incoming" | Price |
| "API is now live" | Update |
| "We believe in X" | Vision |
| "1M users!" | Data/Metrics |
| "Something big coming" | Pre-hype |
| "Addressing the FUD" | FUD Response |
| "Congrats @team!" | Community |
| "Featured on Bankless" | Media/Promo |
| Bare links, emojis | Filtered |

---

## Files Created

- `analysis/taxonomy_v2.md` - Category definitions
- `analysis/categorization_results_v2.json` - Machine-readable results
- `analysis/categorization_summary_v2.md` - This file

---

## Next Steps

1. **Persist to database** - Load results into DuckDB for querying
2. **Build filter UI** - Enable chart filtering by category
3. **Impact analysis** - Correlate categories with price movements
4. **Review "Uncategorized"** - Handle edge cases
