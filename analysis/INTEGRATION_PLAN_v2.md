# Tweet Categorization Integration Plan (v2)

**Created:** 2024-12-30
**Branch:** `feat/tweet-categorization-v1`
**Status:** Planning Complete, Ready for Implementation

---

## Executive Summary

Integrate the 9-category tweet taxonomy into the data pipeline and frontend, enabling users to filter chart markers by category and discover patterns in founder communication.

**Key Decisions (from Q&A session):**
- Primary insight: Pattern discovery (user-driven exploration)
- Visual: Highlight mode (gray default, colored when filtering)
- Filter behavior: Exclusive (hide non-matching tweets)
- Storage: DuckDB (source of truth) + inline in JSON export
- LLM: Subagents for now, GPT-5.2 API for production
- Test asset: PUMP (102 tweets)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  fetch_tweets.py ──► DuckDB ──► classify_tweets.py ──► DuckDB  │
│                       │              │                   │      │
│                       │              ▼                   │      │
│                       │      category_runs table         │      │
│                       │              │                   │      │
│                       ▼              ▼                   ▼      │
│              export_static.py ─────────────────► JSON files    │
│                       │                              │          │
│                       │    Inline category fields    │          │
│                       │    in tweet_events.json      │          │
│                       ▼                              ▼          │
│                  web/public/static/{asset}/tweet_events.json   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  tweet_events.json ──► TweetChart component                    │
│         │                    │                                  │
│         │                    ▼                                  │
│         │            Category filter UI                         │
│         │            (multi-select OR)                          │
│         │                    │                                  │
│         ▼                    ▼                                  │
│    Marker colors      Filtered markers                          │
│    (highlight mode)   (exclusive filter)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Backend Classification Pipeline

### 1.1 DuckDB Schema Extension

Add category storage to existing schema (following `data_overrides.json` pattern):

```sql
-- In scripts/db.py or scripts/categorization_db.py

-- Append-only classification runs (audit trail)
CREATE TABLE IF NOT EXISTS category_runs (
    run_id TEXT PRIMARY KEY,           -- UUID
    tweet_id TEXT NOT NULL,            -- FK to tweets
    asset_id TEXT NOT NULL,            -- Denormalized for queries
    category TEXT NOT NULL,            -- One of 9 categories
    reasoning TEXT,                    -- LLM explanation
    model TEXT,                        -- 'gpt-5.2', 'subagent', 'rule'
    schema_version TEXT DEFAULT 'v2',  -- Taxonomy version
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(tweet_id, schema_version)   -- One classification per schema version
);

-- Index for export queries
CREATE INDEX IF NOT EXISTS idx_category_runs_asset
    ON category_runs(asset_id, schema_version);
```

**Design Notes:**
- Append-only like `category_runs` in original plan
- `schema_version` allows re-classification with taxonomy updates
- No `confidence` field (per discussion - keep simple)
- `reasoning` stored for debugging/review

### 1.2 Classification Script

Create `scripts/classify_tweets.py`:

```python
"""
Classify tweets using 9-category taxonomy.

Usage:
    python classify_tweets.py --asset pump          # Classify one asset
    python classify_tweets.py --all                 # Classify all assets
    python classify_tweets.py --asset pump --force  # Re-classify even if exists
"""
```

**Classification Flow:**
1. Load unclassified tweets from DuckDB
2. For each tweet:
   a. Try rule-based classification (fast path, ~15% coverage)
   b. If no rule match → LLM classification
3. Store results in `category_runs` table
4. Log progress and stats

**Rule-Based Fast Path:**
```python
def classify_by_rules(text: str, tweet: dict) -> Optional[str]:
    """Returns category if rules match with high confidence."""

    text_lower = text.lower().strip()

    # FILTERED: Empty/minimal content
    if len(text_lower) < 5 or is_link_only(text):
        return "Filtered"

    # PRICE: Clear price signals
    if contains_price_terms(text):  # ATH, listing, $X target
        return "Price"

    # UPDATE: Product announcements
    if contains_update_terms(text):  # shipped, live, launching
        return "Update"

    # More rules...

    return None  # Fall through to LLM
```

**LLM Classification:**
- Use existing `classification_llm.py` structure
- Prompt includes taxonomy definitions + 3-5 examples per category
- Returns `{category, reasoning}`
- Temperature = 0 for determinism

### 1.3 Export Integration

Modify `scripts/export_static.py` to include categories:

```python
def export_tweet_events_for_asset(...):
    # ... existing code ...

    # Load categories for this asset
    categories = get_categories_for_asset(conn, asset_id)
    category_map = {c['tweet_id']: c for c in categories}

    for event in events:
        tweet_id = event['tweet_id']
        if tweet_id in category_map:
            cat = category_map[tweet_id]
            event['category'] = cat['category']
            event['category_reasoning'] = cat['reasoning']
        else:
            event['category'] = 'Uncategorized'
            event['category_reasoning'] = None

    # ... rest of export ...
```

**Output JSON Structure:**
```json
{
  "tweet_id": "1945238123908067530",
  "text": "fuck it\n\njew mode.",
  "category": "Shitpost",
  "category_reasoning": "Casual, low-substance post with no product/price/vision content",
  "price_at_tweet": 0.00601024,
  ...
}
```

### 1.4 GitHub Actions Integration

Modify `.github/workflows/hourly-update.yml`:

```yaml
- name: Classify new tweets
  run: |
    cd scripts
    python classify_tweets.py --unclassified-only
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

**Classification runs in same action as scraping** (per decision).

---

## Phase 2: Frontend Integration

### 2.1 Category Filter Component

Create filter UI with multi-select OR logic:

```typescript
// components/CategoryFilter.tsx

const CATEGORIES = [
  { id: 'Update', color: '#22c55e', label: 'Updates' },
  { id: 'Vision', color: '#3b82f6', label: 'Vision' },
  { id: 'Price', color: '#eab308', label: 'Price' },
  { id: 'Data', color: '#06b6d4', label: 'Metrics' },
  { id: 'FUD', color: '#ef4444', label: 'FUD Response' },
  { id: 'Media', color: '#a855f7', label: 'Media' },
  { id: 'Community', color: '#ec4899', label: 'Community' },
  { id: 'Prehype', color: '#f97316', label: 'Pre-hype' },
  { id: 'Shitpost', color: '#6b7280', label: 'Shitpost' },
];

interface Props {
  selected: string[];
  onChange: (categories: string[]) => void;
}

export function CategoryFilter({ selected, onChange }: Props) {
  // Multi-select chip toggles
  // When none selected = show all
  // When some selected = show only those (OR logic)
}
```

### 2.2 Chart Marker Updates

**Highlight Mode Implementation:**
- Default: All markers gray (`#6b7280`)
- When filtering: Matching markers get category color, non-matching hidden
- When hovering category chip: Preview highlight without filtering

```typescript
// In chart component

const getMarkerColor = (tweet: TweetEvent, selectedCategories: string[]) => {
  if (selectedCategories.length === 0) {
    return '#6b7280'; // Gray when no filter
  }

  if (selectedCategories.includes(tweet.category)) {
    return CATEGORY_COLORS[tweet.category];
  }

  return null; // Hidden (exclusive filter)
};
```

### 2.3 Tooltip Enhancement

**Progressive disclosure:**
- Hover: Tweet text + category badge
- Click/expand: Full reasoning

```typescript
// Tooltip content

<div className="tooltip">
  <p>{tweet.text}</p>
  <span className="category-badge" style={{ background: categoryColor }}>
    {tweet.category}
  </span>

  {expanded && tweet.category_reasoning && (
    <p className="reasoning">{tweet.category_reasoning}</p>
  )}
</div>
```

### 2.4 Filtered Tweet Handling

Tweets with `category: "Filtered"` shown but dimmed:
- Smaller marker size
- Lower opacity (0.3)
- Gray color regardless of filter state

```typescript
const getMarkerStyle = (tweet: TweetEvent) => {
  if (tweet.category === 'Filtered') {
    return { opacity: 0.3, size: 4 }; // Dimmed
  }
  return { opacity: 1.0, size: 8 }; // Normal
};
```

---

## Phase 3: Testing & Validation

### 3.1 Test on PUMP First

1. Run classification on PUMP (102 tweets)
2. Manually review 20 random classifications
3. Check distribution makes sense
4. Test export → JSON structure correct
5. Test frontend filtering works

### 3.2 Validation Checklist

- [ ] All tweets have category (no nulls except truly uncategorizable)
- [ ] Distribution is reasonable (not all one category)
- [ ] Reasoning is coherent and matches category
- [ ] Export includes category fields
- [ ] Frontend filters work correctly
- [ ] Filtered tweets are dimmed
- [ ] Multi-select OR logic works
- [ ] Tooltip shows category + reasoning

### 3.3 Full Rollout

After PUMP validation:
1. Run classification on all 14 assets (~4,258 tweets)
2. Spot-check 5 tweets per asset
3. Deploy to production

---

## Implementation Order

| Step | Task | Estimate |
|------|------|----------|
| 1 | Add DuckDB schema for categories | 30 min |
| 2 | Create classify_tweets.py with rules + LLM | 2 hours |
| 3 | Test on PUMP (102 tweets) | 1 hour |
| 4 | Integrate categories into export_static.py | 1 hour |
| 5 | Create CategoryFilter component | 1.5 hours |
| 6 | Update chart markers (highlight mode) | 1 hour |
| 7 | Update tooltip (progressive disclosure) | 30 min |
| 8 | Handle Filtered tweets (dimmed) | 30 min |
| 9 | Add to GitHub Actions | 30 min |
| 10 | Full asset classification + validation | 2 hours |
| 11 | Deploy + verify | 1 hour |

**Total: ~11 hours of work**

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| JSON structure | Inline in tweet_events.json (follows existing patterns) |
| Category colors | 9 distinct colors, but highlight mode makes it manageable |
| Uncategorized handling | Show as gray/neutral |
| Multi-select | OR logic (show any matching) |
| New tweet classification | Automatic in same hourly action |
| LLM choice | GPT-5.2 for production (subagents for development) |

---

## Files to Create/Modify

**Create:**
- `scripts/classify_tweets.py` - Main classification script
- `web/components/CategoryFilter.tsx` - Filter UI component

**Modify:**
- `scripts/db.py` - Add category_runs table
- `scripts/export_static.py` - Include categories in JSON
- `.github/workflows/hourly-update.yml` - Add classification step
- `web/components/TweetChart.tsx` - Marker colors + filtering
- `web/components/TweetTooltip.tsx` - Category badge + reasoning

---

## Success Criteria

1. **Functional:** Users can filter tweets by category on the chart
2. **Accurate:** 90%+ of classifications match human judgment on spot-check
3. **Performant:** Classification adds <5 min to hourly pipeline
4. **Maintainable:** Clear separation between classification and display logic

---

## Next Steps

1. Review and approve this plan
2. Start with Step 1: DuckDB schema
3. Iterate through implementation in order
4. Validate on PUMP before full rollout
