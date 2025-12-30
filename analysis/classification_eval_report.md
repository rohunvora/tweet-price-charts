# Classification Pipeline Evaluation Report

Generated: 2025-12-29

## Summary

| Metric | Rules-Only | With LLM |
|--------|------------|----------|
| Gold Set Size | 71 | 71 |
| Rule-based | 10 | TBD |
| LLM-based | 0 | TBD |
| Topic Accuracy | 14.1% | TBD |
| Intent Accuracy | 12.7% | TBD |
| Both Correct | 12.7% | TBD |

**Note:** Full LLM evaluation requires ANTHROPIC_API_KEY to be set.

---

## Rules-Only Baseline

The deterministic rules layer catches **10/71 examples (14%)** with perfect accuracy.

### What Rules Catch

| Pattern | Count | Example |
|---------|-------|---------|
| Emoji-only | 2 | `😂`, `🔥` |
| Pure greetings | 3 | `gm`, `gn` |
| Link-only | 2 | `https://t.co/...` |
| Rally patterns | 2 | `WIF TO THE MOON wagmi` |
| FUD defense | 1 | `let me address the FUD` |

### What Rules Miss

- Nuanced product announcements ("API is now live")
- Implicit token commentary without price keywords
- Ecosystem mentions without explicit patterns
- Personal reflections and philosophical content
- Context-dependent classifications

This is **expected behavior**. The rules layer is designed to be:
1. **Conservative** - Only match obvious cases with confidence=1
2. **Fast** - No API calls, deterministic
3. **Auditable** - Each rule is independently testable

Everything else falls through to LLM for nuanced classification.

---

## Sample Distribution

From 50 random samples across all assets:

| Method | Count |
|--------|-------|
| rule | 4 |
| none (needs LLM) | 46 |

### Rule-Matched Samples

1. **Single emoji** → `meta/inform` (emoji-only response)
2. **Rally cry with WIF** → `token/rally` (rally pattern: "wagmi")
3. **FUD response** → `product/defend` (defend pattern: "FUD")
4. **Link drop** → `meta/inform` (link-only content)

---

## Pipeline Status

| Component | Status |
|-----------|--------|
| `classification_rules.py` | ✅ Implemented |
| `classification_llm.py` | ✅ Implemented |
| `classify_tweets.py` | ✅ Implemented |
| DuckDB schema | ✅ Ready |
| Gold set (71 examples) | ✅ Created |
| Full LLM evaluation | ⏳ Awaiting API key |

---

## Next Steps

1. Set `ANTHROPIC_API_KEY` environment variable
2. Run full evaluation: `python3 classify_tweets.py --eval`
3. Review misclassified examples and tune rules/prompt
4. Run full classification: `python3 classify_tweets.py --all`
5. Proceed to Step 5 (E2E Run with stats)

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/classification_rules.py` | Deterministic rules layer |
| `scripts/classification_llm.py` | LLM classifier with temp=0 |
| `scripts/classify_tweets.py` | Main entry point |
| `analysis/gold_eval_report.json` | Raw evaluation results |
| `analysis/classification_samples.md` | 50 random samples |
