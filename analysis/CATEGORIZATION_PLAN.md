# Tweet Categorization System - Phase A Execution Plan

**Branch:** `feat/tweet-categorization-v1`
**Status:** In Progress
**Last Updated:** 2024-12-29

---

## Non-Negotiable Acceptance Gates (Before Merge to Main)

| Gate | Criteria | Verification |
|------|----------|--------------|
| **Clustering sanity** | Show distribution of cluster sizes + event count vs raw tweet count per asset | Output metrics table |
| **Determinism** | Same input = same labels | temp=0, prompt_hash recorded, re-run produces identical output |
| **Override persistence** | Overrides survive re-runs, can diff run vs override | Test: override → re-run → override still applied |
| **No leakage** | Classifier never sees price/impact fields | Code review + assertion in classifier input |

---

## What We Will NOT Do in Phase A (Scope Boundary)

- ❌ Agreement-based confidence (dual-run) — deferred to Phase B
- ❌ Hedging detection heuristics — rejected as brittle
- ❌ Volatility normalization in impact analysis — Phase B
- ❌ Full 15-asset rollout — only 2 assets for validation
- ❌ UI integration beyond presets spec — backend must prove out first
- ❌ Automatic pipeline integration — manual runs only
- ❌ Public methodology doc — draft only, publish in Phase B

---

## Execution Plan

### Step 1: Event Clustering

**Goal:** Group tweets within time windows to eliminate double-counting.

**Deliverables:**
- `scripts/cluster_tweets.py` — clustering logic
- `analysis/clustering_metrics.md` — before/after metrics

**Implementation:**
```
1. Load raw tweet_events.json for an asset
2. Sort by timestamp
3. Group tweets within 15-minute window (same author)
4. Also detect explicit threads via reply chains if available
5. Output: clustered events with anchor_tweet_id, tweet_ids[], combined_text
```

**Success Criteria:**
- [ ] Metrics show reduction (e.g., PUMP: 102 tweets → ~70 events)
- [ ] Each cluster has sensible grouping (manual spot-check 10 clusters)
- [ ] No tweets lost or duplicated

**Timebox:** 2 hours

**Output Artifact:**
```
analysis/clustering_metrics.md:
| Asset | Raw Tweets | Clustered Events | Reduction % | Avg Cluster Size |
|-------|------------|------------------|-------------|------------------|
| PUMP  | 102        | ~70              | ~31%        | 1.46             |
| WIF   | 300        | ~200             | ~33%        | 1.50             |
```

---

### Step 2: Taxonomy Specification

**Goal:** Lock in the dimensional taxonomy with unambiguous definitions.

**Deliverables:**
- `analysis/taxonomy_spec.md` — formal definitions
- `analysis/taxonomy_examples.json` — 50-100 gold-standard labeled examples

**Implementation:**
```
1. Finalize topic (6) and intent (7) definitions
2. Finalize style_tags (6) and format_tags (5)
3. Write decision tree for each dimension
4. Manually label 50-100 examples across 4 founders (HYPE, PUMP, BELIEVE, WIF)
5. Include ~10 "NOT this" examples for tricky boundaries
```

**Success Criteria:**
- [ ] Each category has 5+ positive examples and 3+ "NOT this" examples
- [ ] Decision tree has no ambiguous branches
- [ ] Second reviewer (or self after 24h) agrees on 90%+ of gold labels

**Timebox:** 3 hours

**Output Artifact:**
```json
// analysis/taxonomy_examples.json
{
  "schema_version": "1.0",
  "examples": [
    {
      "tweet_id": "123",
      "text": "API is now live",
      "author": "pasternak",
      "topic": "product",
      "intent": "inform",
      "style_tags": [],
      "format_tags": ["one_liner"],
      "reasoning": "Announces feature launch, neutral tone"
    }
  ]
}
```

---

### Step 3: Storage Schema

**Goal:** Create auditable, versioned storage for classifications.

**Deliverables:**
- `scripts/categorization_db.py` — schema + CRUD operations
- `data/categorization.duckdb` — new database (separate from analytics.duckdb)

**Implementation:**
```sql
-- tweet_events_clustered: the clustered events (source of truth for analysis)
CREATE TABLE tweet_events_clustered (
  event_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  anchor_tweet_id TEXT NOT NULL,
  tweet_ids TEXT[] NOT NULL,  -- all tweets in cluster
  combined_text TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  cluster_size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- category_runs: append-only classification history
CREATE TABLE category_runs (
  run_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  prompt_hash TEXT,  -- NULL for rule-based
  model TEXT,        -- NULL for rule-based
  classification_method TEXT NOT NULL,  -- 'rule' or 'llm'
  topic TEXT NOT NULL,
  intent TEXT NOT NULL,
  secondary_intent TEXT,
  style_tags TEXT[],
  format_tags TEXT[],
  needs_review BOOLEAN DEFAULT FALSE,
  reasoning TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- category_overrides: manual corrections (sparse, persistent)
CREATE TABLE category_overrides (
  event_id TEXT PRIMARY KEY,
  override_topic TEXT,
  override_intent TEXT,
  override_secondary_intent TEXT,
  override_style_tags TEXT[],
  override_format_tags TEXT[],
  reason TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Success Criteria:**
- [ ] Schema creates without errors
- [ ] Can insert run, query latest, apply override
- [ ] Override survives re-run (test explicitly)

**Timebox:** 1.5 hours

---

### Step 4: Classification Pipeline

**Goal:** Build rules-first classifier with LLM fallback.

**Deliverables:**
- `scripts/classify_tweets.py` — main classifier
- `scripts/classification_rules.py` — deterministic rules
- `scripts/classification_llm.py` — LLM classifier (isolated)

**Implementation:**

**4a. Rule-Based Fast Path (deterministic, confidence=1)**
```python
def classify_by_rules(event) -> Optional[Classification]:
    """Returns classification if rules match, None otherwise."""

    text = event['combined_text'].lower().strip()

    # Format detection
    if is_link_only(text):
        return Classification(topic='meta', intent='inform', format_tags=['link_only'], method='rule')

    if is_reply(event):
        format_tags = ['reply']  # Tag but continue classification

    if len(text.split()) <= 3:
        format_tags.append('one_liner')

    # Topic rules
    if contains_price_terms(text):  # "$X", "market cap", "listing", price numbers
        topic = 'token'
    elif contains_product_terms(text):  # "shipped", "live", "launching", "API", "feature"
        topic = 'product'
    # ... etc

    # Intent rules
    if is_question(text):  # ends with ?, "what do you think"
        intent = 'engage'
    elif contains_celebration(text):  # "ATH", "!", milestone numbers
        intent = 'celebrate'
    # ... etc

    # Only return if BOTH topic and intent are confidently determined
    if topic and intent and high_confidence:
        return Classification(..., method='rule', needs_review=False)

    return None  # Fall through to LLM
```

**4b. LLM Classifier (needs_review=True unless gold match)**
```python
def classify_by_llm(event, gold_examples) -> Classification:
    """LLM classification. Always needs_review=True unless exact gold match."""

    # CRITICAL: No price/impact data in prompt
    prompt = build_prompt(
        text=event['combined_text'],
        author=event['founder'],  # OK to include
        timestamp=event['event_timestamp'],  # OK to include
        gold_examples=gold_examples
    )

    response = call_llm(prompt, temperature=0)  # Deterministic

    classification = parse_response(response)
    classification.prompt_hash = hash(prompt)
    classification.model = MODEL_VERSION
    classification.method = 'llm'

    # Check if matches gold example exactly
    if matches_gold_example(classification, gold_examples):
        classification.needs_review = False
    else:
        classification.needs_review = True

    return classification
```

**4c. No-Leakage Assertion**
```python
def build_prompt(text, author, timestamp, gold_examples):
    """Build classifier prompt. NEVER includes price/impact."""

    # Defensive assertion
    assert 'price' not in str(locals()).lower()
    assert 'change' not in str(locals()).lower()
    assert 'impact' not in str(locals()).lower()

    return PROMPT_TEMPLATE.format(...)
```

**Success Criteria:**
- [ ] Rule-based handles ~30-40% of events (meta, obvious cases)
- [ ] LLM handles remainder with reasoning
- [ ] Same event → same output on re-run (temp=0)
- [ ] No price/impact in any classifier input (assertion + code review)

**Timebox:** 4 hours

---

### Step 5: End-to-End Run on 2 Assets

**Goal:** Full pipeline run on HYPE (small) and PUMP (medium).

**Deliverables:**
- `data/categorization.duckdb` populated with real data
- `analysis/e2e_run_report.md` — metrics and samples

**Implementation:**
```
1. Run clustering on HYPE → tweet_events_clustered
2. Run classification on HYPE → category_runs
3. Generate metrics (rule vs LLM split, needs_review count)
4. Spot-check 20 random classifications
5. Repeat for PUMP
6. Compare distributions across assets
```

**Success Criteria:**
- [ ] Both assets fully classified
- [ ] Distribution makes sense (not all one category)
- [ ] Spot-check: 90%+ look correct to human eye
- [ ] Re-run produces identical results

**Timebox:** 2 hours

**Output Artifact:**
```
analysis/e2e_run_report.md:
## HYPE (35 tweets → X events)
| Method | Count | % |
|--------|-------|---|
| rule   | X     | X |
| llm    | X     | X |

| Needs Review | Count |
|--------------|-------|
| True         | X     |
| False        | X     |

## Topic Distribution
| Topic | Count | % |
|-------|-------|---|
| product | X | X |
| token | X | X |
...
```

---

### Step 6: Override Workflow Test

**Goal:** Verify amendments work correctly.

**Deliverables:**
- `scripts/apply_override.py` — CLI for manual overrides
- Test documentation in `analysis/e2e_run_report.md`

**Implementation:**
```
1. Pick 3 events, apply overrides via script
2. Re-run classification pipeline
3. Verify: overrides persist, non-overridden events re-classified
4. Query "current view" (latest run + overrides) and verify correctness
```

**Success Criteria:**
- [ ] Override persists after re-run
- [ ] Can diff: original classification vs override
- [ ] Current view correctly merges run + overrides

**Timebox:** 1 hour

---

### Step 7: UI Presets Specification

**Goal:** Define filter presets for future UI integration.

**Deliverables:**
- `analysis/ui_presets_spec.md` — preset definitions
- NO CODE CHANGES TO WEB/ — backend must prove out first

**Implementation:**
```javascript
// Spec only, not implemented yet
const FILTER_PRESETS = {
  "Product updates": {
    description: "Feature launches, updates, announcements",
    filters: { topic: ["product"], intent: ["inform", "celebrate", "tease"] }
  },
  "Rally calls": {
    description: "Conviction building, hold/buy signals",
    filters: { intent: ["rally"] }
  },
  "FUD responses": {
    description: "Defending against criticism",
    filters: { intent: ["defend"] }
  },
  "Price milestones": {
    description: "Celebrating price achievements",
    filters: { topic: ["token"], intent: ["celebrate"] }
  },
  "Community Q&A": {
    description: "Questions and engagement",
    filters: { intent: ["engage"] }
  },
  "Deep dives": {
    description: "Technical explanations",
    filters: { style_tags: ["technical"] }
  }
};
```

**Success Criteria:**
- [ ] Presets cover 80%+ of interesting use cases
- [ ] Each preset maps cleanly to taxonomy
- [ ] No preset requires complex boolean logic

**Timebox:** 30 minutes

---

### Step 8: Draft Methodology Document

**Goal:** Document the system for transparency (draft, not published).

**Deliverables:**
- `analysis/METHODOLOGY_DRAFT.md`

**Contents:**
```markdown
# Tweet Classification Methodology (DRAFT v1.0)

## Overview
## Taxonomy Definitions
## Decision Rules
## Classification Pipeline
  - Rule-based (deterministic)
  - LLM-based (needs review)
## Event Clustering
## Known Limitations
## Changelog
```

**Success Criteria:**
- [ ] All taxonomy definitions included with examples
- [ ] Decision tree documented
- [ ] Limitations explicitly stated
- [ ] Would pass external review for "is this reproducible?"

**Timebox:** 1 hour

---

## Execution Order Summary

| Order | Step | Timebox | Dependencies |
|-------|------|---------|--------------|
| 1 | Event Clustering | 2h | None |
| 2 | Taxonomy Spec + Examples | 3h | None (parallel with 1) |
| 3 | Storage Schema | 1.5h | None (parallel with 1,2) |
| 4 | Classification Pipeline | 4h | Steps 2, 3 |
| 5 | E2E Run (HYPE, PUMP) | 2h | Steps 1, 3, 4 |
| 6 | Override Workflow Test | 1h | Step 5 |
| 7 | UI Presets Spec | 0.5h | Step 5 |
| 8 | Methodology Draft | 1h | Steps 1-6 |

**Total Timebox:** ~15 hours

---

## File Structure After Phase A

```
tweet-price/
├── analysis/
│   ├── CATEGORIZATION_PLAN.md        # This file
│   ├── tweet_categorization_notes.md  # Exploratory notes (existing)
│   ├── taxonomy_spec.md               # Formal taxonomy
│   ├── taxonomy_examples.json         # Gold standard examples
│   ├── clustering_metrics.md          # Before/after metrics
│   ├── e2e_run_report.md              # End-to-end results
│   ├── ui_presets_spec.md             # UI filter presets
│   └── METHODOLOGY_DRAFT.md           # Draft methodology doc
│
├── scripts/
│   ├── cluster_tweets.py              # Event clustering
│   ├── categorization_db.py           # Storage schema + CRUD
│   ├── classify_tweets.py             # Main classifier entry
│   ├── classification_rules.py        # Rule-based classifier
│   ├── classification_llm.py          # LLM classifier
│   └── apply_override.py              # Manual override CLI
│
└── data/
    └── categorization.duckdb          # Classification database
```

---

## Merge Criteria (Branch → Main)

Before merging `feat/tweet-categorization-v1` to `main`:

- [ ] All 4 acceptance gates pass (clustering sanity, determinism, override persistence, no leakage)
- [ ] E2E run successful on 2 assets with sensible distributions
- [ ] Spot-check accuracy ≥ 90%
- [ ] Methodology draft complete and internally reviewable
- [ ] No changes to existing prod code paths (isolated in new files)

---

## Next Action

**Proceed with Step 1: Event Clustering**

Starting with PUMP (102 tweets) to validate clustering logic, then WIF (300 tweets) for scale test.
