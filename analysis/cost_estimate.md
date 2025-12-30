# Cost Estimation for Full Classification Run

**Generated:** 2025-12-29T21:52:00
**Total Clustered Events:** 3,788

---

## Per-Model Estimates

| Model | Sample Size | Tokens/Event (avg) | Est. LLM Events | Est. Total Tokens | Est. Cost | Time (projected) |
|-------|-------------|-------------------|-----------------|-------------------|-----------|------------------|
| gpt-5.2 | 71 gold | 773 | 3,258 | 2,518,534 | **$8.54** | 85 min |
| opus-4.5 | N/A | N/A | 3,258 | ~2.5M | **~$50** | ~90 min |

### GPT-5.2 Calculation Details

From gold set evaluation:
- **Input tokens:** 42,467 (for 61 LLM events)
- **Output tokens:** 4,715 (for 61 LLM events)
- **Total:** 47,182 tokens
- **Avg per LLM event:** 773 tokens

Projections:
- **Rule-based events:** ~530 (14% of 3,788)
- **LLM events:** ~3,258 (86% of 3,788)
- **Est. input tokens:** 42,467 × (3,258 / 61) = 2,267,817
- **Est. output tokens:** 4,715 × (3,258 / 61) = 251,717
- **Est. cost:** ($2.50 × 2.27) + ($10.00 × 0.25) = $5.67 + $2.52 = **$8.19**

With 5% buffer: **~$8.54**

### Opus 4.5 Projection (estimated)

Assuming similar token usage:
- **Est. input tokens:** ~2,267,817
- **Est. output tokens:** ~251,717
- **Est. cost:** ($15.00 × 2.27) + ($75.00 × 0.25) = $34.05 + $18.75 = **~$53**

---

## 200 Random Sample Results

| Model | Samples | Rule | LLM | Input Tokens | Output Tokens | Cost | Time |
|-------|---------|------|-----|--------------|---------------|------|------|
| gpt-5.2 | 200 | 28 | 172 | 118,321 | 13,195 | $0.486 | 296s |

### Per-event averages (200 sample):
- **Input:** 688 tokens/event
- **Output:** 77 tokens/event
- **Total:** 765 tokens/event
- **Cost:** $0.00243/event

---

## Pricing Reference

| Model | Input (per 1M) | Output (per 1M) |
|-------|----------------|------------------|
| gpt-5.2 | $2.50 | $10.00 |
| opus-4.5 | $15.00 | $75.00 |

---

## Summary

| Scenario | Model | Est. Cost | Est. Time |
|----------|-------|-----------|-----------|
| Full run (3,788 events) | gpt-5.2 | **$8-10** | ~90 min |
| Full run (3,788 events) | opus-4.5 | **$50-55** | ~90 min |
| Gold + 200 sample | gpt-5.2 | $0.64 | 7 min |

---

## Notes

- **Rule-based = free:** ~14% of events caught by rules
- **Token efficiency:** GPT-5.2 structured outputs are concise (~77 output tokens)
- **Time estimates:** Sequential; parallelization could reduce to ~20 min
- **Caching:** Not applicable - each event is unique
- **Temperature:** Set to 1 (GPT-5.2 requirement for structured outputs)

---

## Recommendation

**Use GPT-5.2 for production classification:**
- 6x cheaper than Opus 4.5 ($8 vs $50)
- Adequate accuracy (74.6% topic, 77.5% intent)
- Zero parse errors with structured outputs
- Fast enough for full dataset (~90 min sequential)

Opus 4.5 comparison blocked by Anthropic billing - add credits if comparison needed.
