#!/usr/bin/env python3
"""
Tweet Classification Pipeline
=============================

Main entry point for classifying clustered tweet events.

Pipeline:
1. Load clustered events from JSON or DuckDB
2. Try rule-based classification first (fast, deterministic)
3. Fall back to LLM for remaining events
4. Write results to category_runs table

Usage:
    python classify_tweets.py --eval --model opus-4.5     # Evaluate with Opus 4.5
    python classify_tweets.py --eval --model gpt-5.2      # Evaluate with GPT-5.2
    python classify_tweets.py --compare                   # Compare both models
    python classify_tweets.py --asset pump --model opus-4.5
"""

import json
import argparse
import time
import random
from pathlib import Path
from typing import Optional
from datetime import datetime
from dataclasses import dataclass, asdict

# Local imports
from classification_rules import classify_by_rules, Classification
from classification_llm import (
    classify_with_llm, classify_batch, BatchResult,
    estimate_cost, SUPPORTED_MODELS, DEFAULT_MODEL, PRICING
)
from categorization_db import (
    get_connection, init_schema,
    save_clustered_event, save_classification_run,
    get_latest_classification, get_classification_stats,
)
from cluster_tweets import cluster_tweets, load_tweet_events


DATA_DIR = Path(__file__).parent.parent / "data"
ANALYSIS_DIR = Path(__file__).parent.parent / "analysis"
ASSETS_FILE = Path(__file__).parent / "assets.json"


def load_assets() -> list[dict]:
    """Load asset configurations."""
    with open(ASSETS_FILE) as f:
        data = json.load(f)
        if isinstance(data, dict) and "assets" in data:
            return data["assets"]
        return data


def get_asset_by_id(asset_id: str) -> Optional[dict]:
    """Get asset config by ID."""
    assets = load_assets()
    for asset in assets:
        if asset["id"] == asset_id:
            return asset
    return None


# =============================================================================
# Classification Pipeline
# =============================================================================

def classify_event(
    event: dict,
    use_llm: bool = True,
    model: str = DEFAULT_MODEL,
) -> dict:
    """
    Classify a single clustered event.

    Returns dict with classification fields ready for DB insertion.
    """
    combined_text = event["combined_text"]
    author = event.get("founder", event.get("author", "unknown"))
    timestamp = event.get("anchor_timestamp", 0)
    cluster_size = event.get("cluster_size", 1)

    # Try rules first
    rule_result = classify_by_rules(
        combined_text=combined_text,
        author=author,
        timestamp=timestamp,
        cluster_size=cluster_size,
    )

    if rule_result is not None:
        return {
            "classification_method": "rule",
            "topic": rule_result.topic,
            "intent": rule_result.intent,
            "secondary_intent": rule_result.secondary_intent,
            "style_tags": rule_result.style_tags,
            "format_tags": rule_result.format_tags,
            "needs_review": rule_result.needs_review,
            "reasoning": rule_result.reasoning,
            "model": None,
            "prompt_hash": None,
            "parse_error": False,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    # Fall back to LLM
    if use_llm:
        llm_result = classify_with_llm(
            combined_text=combined_text,
            author=author,
            timestamp=timestamp,
            cluster_size=cluster_size,
            model=model,
        )

        return {
            "classification_method": "llm",
            "topic": llm_result.topic,
            "intent": llm_result.intent,
            "secondary_intent": llm_result.secondary_intent,
            "style_tags": llm_result.style_tags,
            "format_tags": llm_result.format_tags,
            "needs_review": llm_result.needs_review,
            "reasoning": llm_result.reasoning,
            "model": llm_result.model,
            "prompt_hash": llm_result.prompt_hash,
            "parse_error": llm_result.parse_error,
            "input_tokens": llm_result.input_tokens,
            "output_tokens": llm_result.output_tokens,
        }

    # No LLM, no rule match
    return {
        "classification_method": "none",
        "topic": None,
        "intent": None,
        "secondary_intent": None,
        "style_tags": [],
        "format_tags": [],
        "needs_review": True,
        "reasoning": "No rule matched, LLM disabled",
        "model": None,
        "prompt_hash": None,
        "parse_error": False,
        "input_tokens": 0,
        "output_tokens": 0,
    }


# =============================================================================
# Gold Set Evaluation
# =============================================================================

def load_gold_set() -> list[dict]:
    """Load gold labeled examples."""
    gold_path = ANALYSIS_DIR / "gold_examples.jsonl"
    if not gold_path.exists():
        raise FileNotFoundError(f"Gold set not found: {gold_path}")

    examples = []
    with open(gold_path) as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    return examples


@dataclass
class EvalResult:
    """Detailed evaluation results."""
    model: str
    total: int
    topic_correct: int
    intent_correct: int
    both_correct: int
    rule_used: int
    llm_used: int
    parse_errors: int
    total_input_tokens: int
    total_output_tokens: int
    elapsed_seconds: float
    classifications: list  # Full classification details
    misclassified: list    # Errors for review

    @property
    def topic_accuracy(self) -> float:
        return round(100 * self.topic_correct / self.total, 1) if self.total else 0

    @property
    def intent_accuracy(self) -> float:
        return round(100 * self.intent_correct / self.total, 1) if self.total else 0

    @property
    def both_accuracy(self) -> float:
        return round(100 * self.both_correct / self.total, 1) if self.total else 0

    @property
    def estimated_cost(self) -> float:
        return estimate_cost(self.model, self.total_input_tokens, self.total_output_tokens)


def evaluate_gold_set(model: str = DEFAULT_MODEL, use_llm: bool = True) -> EvalResult:
    """
    Evaluate classifier against gold set with full tracking.
    """
    gold = load_gold_set()
    start_time = time.time()

    classifications = []
    misclassified = []
    topic_correct = 0
    intent_correct = 0
    both_correct = 0
    rule_used = 0
    llm_used = 0
    parse_errors = 0
    total_input = 0
    total_output = 0

    for i, example in enumerate(gold):
        text = example["text"]
        author = example.get("founder", example.get("author", "unknown"))
        expected_topic = example["topic"]
        expected_intent = example["intent"]

        event = {
            "combined_text": text,
            "founder": author,
            "anchor_timestamp": 0,
            "cluster_size": 1,
        }
        classification = classify_event(event, use_llm=use_llm, model=model)

        # Track tokens
        total_input += classification.get("input_tokens", 0)
        total_output += classification.get("output_tokens", 0)

        # Track method
        if classification["classification_method"] == "rule":
            rule_used += 1
        elif classification["classification_method"] == "llm":
            llm_used += 1

        if classification.get("parse_error"):
            parse_errors += 1

        # Check accuracy
        topic_match = classification["topic"] == expected_topic
        intent_match = classification["intent"] == expected_intent

        if topic_match:
            topic_correct += 1
        if intent_match:
            intent_correct += 1
        if topic_match and intent_match:
            both_correct += 1

        # Store full classification
        full_record = {
            "text": text,
            "author": author,
            "expected_topic": expected_topic,
            "expected_intent": expected_intent,
            "predicted_topic": classification["topic"],
            "predicted_intent": classification["intent"],
            "secondary_intent": classification.get("secondary_intent"),
            "style_tags": classification.get("style_tags", []),
            "format_tags": classification.get("format_tags", []),
            "method": classification["classification_method"],
            "reasoning": classification.get("reasoning", ""),
            "topic_correct": topic_match,
            "intent_correct": intent_match,
        }
        classifications.append(full_record)

        if not (topic_match and intent_match):
            misclassified.append(full_record)

        if (i + 1) % 10 == 0:
            print(f"  Evaluated {i + 1}/{len(gold)}...")

    elapsed = time.time() - start_time

    return EvalResult(
        model=model,
        total=len(gold),
        topic_correct=topic_correct,
        intent_correct=intent_correct,
        both_correct=both_correct,
        rule_used=rule_used,
        llm_used=llm_used,
        parse_errors=parse_errors,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        elapsed_seconds=elapsed,
        classifications=classifications,
        misclassified=misclassified,
    )


def evaluate_random_sample(
    n_samples: int = 200,
    model: str = DEFAULT_MODEL,
    use_llm: bool = True,
    seed: int = 42,
) -> EvalResult:
    """
    Evaluate on random sample of real events (no ground truth, for cost/distribution).
    """
    random.seed(seed)

    # Load all clusters
    assets = load_assets()
    all_clusters = []
    for asset in assets:
        events = load_tweet_events(asset["id"])
        if events:
            clusters = cluster_tweets(events)
            for c in clusters:
                c["asset_id"] = asset["id"]
                c["founder"] = asset.get("founder", asset.get("adopter", "unknown"))
            all_clusters.extend(clusters)

    # Sample
    sample = random.sample(all_clusters, min(n_samples, len(all_clusters)))

    start_time = time.time()
    classifications = []
    rule_used = 0
    llm_used = 0
    parse_errors = 0
    total_input = 0
    total_output = 0

    for i, cluster in enumerate(sample):
        classification = classify_event(cluster, use_llm=use_llm, model=model)

        total_input += classification.get("input_tokens", 0)
        total_output += classification.get("output_tokens", 0)

        if classification["classification_method"] == "rule":
            rule_used += 1
        elif classification["classification_method"] == "llm":
            llm_used += 1

        if classification.get("parse_error"):
            parse_errors += 1

        classifications.append({
            "asset_id": cluster["asset_id"],
            "founder": cluster["founder"],
            "text": cluster["combined_text"][:500],
            "cluster_size": cluster["cluster_size"],
            "topic": classification["topic"],
            "intent": classification["intent"],
            "secondary_intent": classification.get("secondary_intent"),
            "style_tags": classification.get("style_tags", []),
            "format_tags": classification.get("format_tags", []),
            "method": classification["classification_method"],
            "reasoning": classification.get("reasoning", ""),
        })

        if (i + 1) % 20 == 0:
            print(f"  Sampled {i + 1}/{len(sample)}...")

    elapsed = time.time() - start_time

    return EvalResult(
        model=model,
        total=len(sample),
        topic_correct=0,  # No ground truth
        intent_correct=0,
        both_correct=0,
        rule_used=rule_used,
        llm_used=llm_used,
        parse_errors=parse_errors,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        elapsed_seconds=elapsed,
        classifications=classifications,
        misclassified=[],
    )


# =============================================================================
# Report Generation
# =============================================================================

def write_eval_report(
    gold_results: dict[str, EvalResult],
    sample_results: dict[str, EvalResult],
    output_path: Path,
):
    """Write comprehensive evaluation report."""
    with open(output_path, "w") as f:
        f.write("# Classification Evaluation Report\n\n")
        f.write(f"**Generated:** {datetime.now().isoformat()}\n")
        f.write(f"**Branch:** feat/tweet-categorization-v1\n\n")

        f.write("---\n\n")
        f.write("## Executive Summary\n\n")

        # Summary table
        f.write("| Model | Gold Accuracy (Both) | Topic Acc | Intent Acc | Parse Errors | Cost |\n")
        f.write("|-------|---------------------|-----------|------------|--------------|------|\n")
        for model, result in gold_results.items():
            f.write(f"| {model} | {result.both_accuracy}% | {result.topic_accuracy}% | {result.intent_accuracy}% | {result.parse_errors} | ${result.estimated_cost:.4f} |\n")
        f.write("\n")

        # Disagreement analysis
        if len(gold_results) == 2:
            models = list(gold_results.keys())
            r1, r2 = gold_results[models[0]], gold_results[models[1]]
            disagreements = []
            for c1, c2 in zip(r1.classifications, r2.classifications):
                if c1["predicted_topic"] != c2["predicted_topic"] or c1["predicted_intent"] != c2["predicted_intent"]:
                    disagreements.append({
                        "text": c1["text"][:100],
                        f"{models[0]}": f"{c1['predicted_topic']}/{c1['predicted_intent']}",
                        f"{models[1]}": f"{c2['predicted_topic']}/{c2['predicted_intent']}",
                        "expected": f"{c1['expected_topic']}/{c1['expected_intent']}",
                    })

            f.write(f"### Model Disagreements: {len(disagreements)}/{r1.total} ({100*len(disagreements)/r1.total:.1f}%)\n\n")
            if disagreements:
                f.write("| Text | " + " | ".join(models) + " | Expected |\n")
                f.write("|------|" + "|".join(["------"] * len(models)) + "|----------|\n")
                for d in disagreements[:20]:
                    f.write(f"| {d['text'][:50]}... | {d[models[0]]} | {d[models[1]]} | {d['expected']} |\n")
                f.write("\n")

        # Detailed results per model
        for model, result in gold_results.items():
            f.write(f"---\n\n## {model} - Gold Set Results\n\n")
            f.write(f"- **Total examples:** {result.total}\n")
            f.write(f"- **Rule-based:** {result.rule_used}\n")
            f.write(f"- **LLM-based:** {result.llm_used}\n")
            f.write(f"- **Parse errors:** {result.parse_errors}\n")
            f.write(f"- **Tokens:** {result.total_input_tokens:,} in / {result.total_output_tokens:,} out\n")
            f.write(f"- **Cost:** ${result.estimated_cost:.4f}\n")
            f.write(f"- **Time:** {result.elapsed_seconds:.1f}s\n\n")

            f.write("### Accuracy\n\n")
            f.write(f"| Metric | Score |\n|--------|-------|\n")
            f.write(f"| Topic | {result.topic_accuracy}% ({result.topic_correct}/{result.total}) |\n")
            f.write(f"| Intent | {result.intent_accuracy}% ({result.intent_correct}/{result.total}) |\n")
            f.write(f"| Both | {result.both_accuracy}% ({result.both_correct}/{result.total}) |\n\n")

            # Confusion summary
            if result.misclassified:
                f.write(f"### Misclassified ({len(result.misclassified)})\n\n")
                topic_errors = {}
                intent_errors = {}
                for m in result.misclassified:
                    if not m["topic_correct"]:
                        key = f"{m['expected_topic']} → {m['predicted_topic']}"
                        topic_errors[key] = topic_errors.get(key, 0) + 1
                    if not m["intent_correct"]:
                        key = f"{m['expected_intent']} → {m['predicted_intent']}"
                        intent_errors[key] = intent_errors.get(key, 0) + 1

                f.write("**Topic Confusion:**\n")
                for k, v in sorted(topic_errors.items(), key=lambda x: -x[1])[:10]:
                    f.write(f"- {k}: {v}\n")
                f.write("\n**Intent Confusion:**\n")
                for k, v in sorted(intent_errors.items(), key=lambda x: -x[1])[:10]:
                    f.write(f"- {k}: {v}\n")
                f.write("\n")

        # Sample examples section
        f.write("---\n\n## Classification Examples (50 samples)\n\n")

        # Use first model's classifications for examples
        first_model = list(gold_results.keys())[0]
        examples = gold_results[first_model].classifications[:50]

        for i, ex in enumerate(examples, 1):
            status = "✅" if ex["topic_correct"] and ex["intent_correct"] else "❌"
            f.write(f"### Example {i} {status}\n\n")
            f.write(f"**Text:** {ex['text'][:200]}{'...' if len(ex['text']) > 200 else ''}\n\n")
            f.write(f"**Author:** {ex['author']}\n\n")
            f.write(f"**Expected:** {ex['expected_topic']}/{ex['expected_intent']}\n\n")
            f.write(f"**Predicted:** {ex['predicted_topic']}/{ex['predicted_intent']}")
            if ex.get("secondary_intent"):
                f.write(f" (+{ex['secondary_intent']})")
            f.write(f" [{ex['method']}]\n\n")
            if ex.get("style_tags"):
                f.write(f"**Style:** {', '.join(ex['style_tags'])}\n\n")
            if ex.get("reasoning"):
                f.write(f"**Reasoning:** {ex['reasoning']}\n\n")
            f.write("---\n\n")

        # Hard/borderline examples
        f.write("## Hard/Borderline Examples (10)\n\n")
        f.write("These are examples where models disagreed or classification was ambiguous.\n\n")

        # Find disagreements or near-misses
        hard_examples = []
        if len(gold_results) == 2:
            models = list(gold_results.keys())
            for c1, c2 in zip(gold_results[models[0]].classifications, gold_results[models[1]].classifications):
                if c1["predicted_topic"] != c2["predicted_topic"] or c1["predicted_intent"] != c2["predicted_intent"]:
                    hard_examples.append({
                        "text": c1["text"],
                        "author": c1["author"],
                        "expected": f"{c1['expected_topic']}/{c1['expected_intent']}",
                        models[0]: f"{c1['predicted_topic']}/{c1['predicted_intent']}",
                        models[1]: f"{c2['predicted_topic']}/{c2['predicted_intent']}",
                        "reasoning_1": c1.get("reasoning", ""),
                        "reasoning_2": c2.get("reasoning", ""),
                    })

        for i, ex in enumerate(hard_examples[:10], 1):
            f.write(f"### Hard Example {i}\n\n")
            f.write(f"**Text:** {ex['text'][:300]}{'...' if len(ex['text']) > 300 else ''}\n\n")
            f.write(f"**Expected:** {ex['expected']}\n\n")
            for model in list(gold_results.keys()):
                f.write(f"**{model}:** {ex.get(model, 'N/A')}\n\n")
            f.write("---\n\n")

    print(f"Wrote evaluation report to {output_path}")


def write_cost_estimate(sample_results: dict[str, EvalResult], output_path: Path):
    """Write cost estimation report."""
    # Estimate for full 3788 events
    TOTAL_EVENTS = 3788

    with open(output_path, "w") as f:
        f.write("# Cost Estimation for Full Classification Run\n\n")
        f.write(f"**Generated:** {datetime.now().isoformat()}\n")
        f.write(f"**Total Clustered Events:** {TOTAL_EVENTS}\n\n")

        f.write("## Per-Model Estimates\n\n")
        f.write("| Model | Sample Size | Tokens/Event (avg) | Est. Total Tokens | Est. Cost | Time (projected) |\n")
        f.write("|-------|-------------|-------------------|-------------------|-----------|------------------|\n")

        for model, result in sample_results.items():
            avg_input = result.total_input_tokens / result.llm_used if result.llm_used else 0
            avg_output = result.total_output_tokens / result.llm_used if result.llm_used else 0
            avg_total = avg_input + avg_output

            # Assume ~86% need LLM (based on rules catching ~14%)
            llm_events = int(TOTAL_EVENTS * 0.86)

            est_input = int(avg_input * llm_events)
            est_output = int(avg_output * llm_events)
            est_cost = estimate_cost(model, est_input, est_output)

            # Time projection
            time_per_event = result.elapsed_seconds / result.total if result.total else 0
            est_time_minutes = (time_per_event * llm_events) / 60

            f.write(f"| {model} | {result.total} | {avg_total:.0f} | {est_input + est_output:,} | ${est_cost:.2f} | {est_time_minutes:.0f} min |\n")

        f.write("\n## Pricing Reference\n\n")
        f.write("| Model | Input (per 1M) | Output (per 1M) |\n")
        f.write("|-------|----------------|------------------|\n")
        for model, prices in PRICING.items():
            f.write(f"| {model} | ${prices['input']:.2f} | ${prices['output']:.2f} |\n")

        f.write("\n## Notes\n\n")
        f.write("- Estimates assume ~14% caught by rules (rule-based = free)\n")
        f.write("- Actual costs may vary based on tweet length distribution\n")
        f.write("- Caching not applicable (each event is unique)\n")
        f.write("- Time estimates are sequential; parallelization could reduce wall time\n")

    print(f"Wrote cost estimate to {output_path}")


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Tweet classification pipeline")
    parser.add_argument("--asset", type=str, help="Asset ID to classify")
    parser.add_argument("--all", action="store_true", help="Classify all assets")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--no-llm", action="store_true", help="Rules only, no LLM")
    parser.add_argument("--eval", action="store_true", help="Evaluate against gold set")
    parser.add_argument("--compare", action="store_true", help="Compare both models on gold + 200 random")
    parser.add_argument("--samples", type=int, help="Generate N random samples for review")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL,
                        choices=list(SUPPORTED_MODELS.keys()),
                        help=f"Model to use (default: {DEFAULT_MODEL})")
    parser.add_argument("--force", action="store_true", help="Re-classify even if already classified")
    args = parser.parse_args()

    use_llm = not args.no_llm

    if args.compare:
        # Run both models on gold set + 200 random samples
        print("=" * 60)
        print("MODEL COMPARISON: GPT-5.2 vs Opus 4.5")
        print("=" * 60)

        gold_results = {}
        sample_results = {}

        for model in SUPPORTED_MODELS.keys():
            print(f"\n--- Evaluating {model} on gold set ---")
            gold_results[model] = evaluate_gold_set(model=model, use_llm=True)
            print(f"  Accuracy: {gold_results[model].both_accuracy}%")
            print(f"  Cost: ${gold_results[model].estimated_cost:.4f}")

            print(f"\n--- Evaluating {model} on 200 random samples ---")
            sample_results[model] = evaluate_random_sample(n_samples=200, model=model, use_llm=True)
            print(f"  Cost: ${sample_results[model].estimated_cost:.4f}")

        # Write reports
        write_eval_report(gold_results, sample_results, ANALYSIS_DIR / "eval_report.md")
        write_cost_estimate(sample_results, ANALYSIS_DIR / "cost_estimate.md")

        # Summary
        print("\n" + "=" * 60)
        print("COMPARISON COMPLETE")
        print("=" * 60)
        for model in SUPPORTED_MODELS.keys():
            r = gold_results[model]
            print(f"\n{model}:")
            print(f"  Gold Accuracy: {r.both_accuracy}% (topic: {r.topic_accuracy}%, intent: {r.intent_accuracy}%)")
            print(f"  Parse Errors: {r.parse_errors}")
            print(f"  Cost (gold): ${r.estimated_cost:.4f}")

    elif args.eval:
        print(f"Evaluating with {args.model}...")
        result = evaluate_gold_set(model=args.model, use_llm=use_llm)

        print("\n" + "=" * 60)
        print(f"GOLD SET EVALUATION - {args.model}")
        print("=" * 60)
        print(f"\nTotal: {result.total}")
        print(f"Rule-based: {result.rule_used}")
        print(f"LLM-based: {result.llm_used}")
        print(f"Parse errors: {result.parse_errors}")
        print(f"\nAccuracy:")
        print(f"  Topic:  {result.topic_accuracy}%")
        print(f"  Intent: {result.intent_accuracy}%")
        print(f"  Both:   {result.both_accuracy}%")
        print(f"\nTokens: {result.total_input_tokens:,} in / {result.total_output_tokens:,} out")
        print(f"Cost: ${result.estimated_cost:.4f}")
        print(f"Time: {result.elapsed_seconds:.1f}s")

        # Save JSON report
        report_path = ANALYSIS_DIR / f"gold_eval_{args.model.replace('.', '_')}.json"
        with open(report_path, "w") as f:
            json.dump({
                "model": result.model,
                "total": result.total,
                "topic_accuracy": result.topic_accuracy,
                "intent_accuracy": result.intent_accuracy,
                "both_accuracy": result.both_accuracy,
                "rule_used": result.rule_used,
                "llm_used": result.llm_used,
                "parse_errors": result.parse_errors,
                "input_tokens": result.total_input_tokens,
                "output_tokens": result.total_output_tokens,
                "cost": result.estimated_cost,
                "elapsed_seconds": result.elapsed_seconds,
                "misclassified": result.misclassified[:50],
            }, f, indent=2)
        print(f"\nSaved to {report_path}")

    elif args.samples:
        print(f"Generating {args.samples} samples with {args.model}...")
        result = evaluate_random_sample(n_samples=args.samples, model=args.model, use_llm=use_llm)

        output_path = ANALYSIS_DIR / "classification_samples.md"
        with open(output_path, "w") as f:
            f.write("# Classification Samples\n\n")
            f.write(f"Generated: {datetime.now().isoformat()}\n")
            f.write(f"Model: {args.model}\n")
            f.write(f"Total samples: {len(result.classifications)}\n\n")

            # Summary
            by_topic = {}
            by_intent = {}
            for c in result.classifications:
                by_topic[c["topic"]] = by_topic.get(c["topic"], 0) + 1
                by_intent[c["intent"]] = by_intent.get(c["intent"], 0) + 1

            f.write("## Distribution\n\n")
            f.write("| Topic | Count |\n|-------|-------|\n")
            for k, v in sorted(by_topic.items(), key=lambda x: -x[1]):
                f.write(f"| {k} | {v} |\n")
            f.write("\n| Intent | Count |\n|--------|-------|\n")
            for k, v in sorted(by_intent.items(), key=lambda x: -x[1]):
                f.write(f"| {k} | {v} |\n")
            f.write("\n---\n\n")

            f.write("## Samples\n\n")
            for i, c in enumerate(result.classifications, 1):
                f.write(f"### Sample {i}: {c['asset_id']} ({c['founder']})\n\n")
                f.write(f"**Classification:** {c['topic']}/{c['intent']} [{c['method']}]\n\n")
                if c.get("style_tags"):
                    f.write(f"**Style:** {', '.join(c['style_tags'])}\n\n")
                f.write(f"**Text ({c['cluster_size']} tweet(s)):**\n```\n{c['text']}\n```\n\n")
                if c.get("reasoning"):
                    f.write(f"**Reasoning:** {c['reasoning']}\n\n")
                f.write("---\n\n")

        print(f"Wrote samples to {output_path}")
        print(f"Cost: ${result.estimated_cost:.4f}")

    elif args.asset:
        print(f"Classifying {args.asset} with {args.model}...")
        # TODO: Update classify_asset to accept model parameter
        print("Asset classification not yet updated for multi-model support")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
