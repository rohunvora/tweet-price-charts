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
    python classify_tweets.py --asset pump           # Classify one asset
    python classify_tweets.py --all                  # Classify all assets
    python classify_tweets.py --asset pump --dry-run # Preview without writing
    python classify_tweets.py --eval                 # Evaluate against gold set
"""

import json
import argparse
import time
from pathlib import Path
from typing import Optional
from datetime import datetime

# Local imports
from classification_rules import classify_by_rules, Classification
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
        # Handle v2 schema with nested assets
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
    api_key: Optional[str] = None,
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
        # Rule matched
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
        }

    # Fall back to LLM
    if use_llm:
        # Lazy import to allow rules-only mode without anthropic
        from classification_llm import classify_with_llm
        llm_result = classify_with_llm(
            combined_text=combined_text,
            author=author,
            timestamp=timestamp,
            cluster_size=cluster_size,
            api_key=api_key,
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
        }

    # No LLM, no rule match - return unclassified
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
    }


def classify_asset(
    asset_id: str,
    dry_run: bool = False,
    use_llm: bool = True,
    api_key: Optional[str] = None,
    skip_existing: bool = True,
) -> dict:
    """
    Classify all events for an asset.

    Args:
        asset_id: Asset ID to classify
        dry_run: If True, don't write to DB
        use_llm: If False, only use rule-based classification
        api_key: Anthropic API key for LLM
        skip_existing: Skip events that already have classification

    Returns:
        Stats dict with counts
    """
    asset = get_asset_by_id(asset_id)
    if not asset:
        raise ValueError(f"Asset not found: {asset_id}")

    founder = asset.get("founder", asset.get("adopter", "unknown"))

    # Load and cluster tweets
    events = load_tweet_events(asset_id)
    if not events:
        print(f"  No events found for {asset_id}")
        return {"total": 0, "rule": 0, "llm": 0, "skipped": 0}

    clusters = cluster_tweets(events)

    # Initialize DB
    conn = get_connection()
    init_schema(conn)

    stats = {"total": len(clusters), "rule": 0, "llm": 0, "skipped": 0, "none": 0}

    for i, cluster in enumerate(clusters):
        event_id = cluster["event_id"]

        # Check if already classified
        if skip_existing:
            existing = get_latest_classification(conn, event_id)
            if existing:
                stats["skipped"] += 1
                continue

        # Save clustered event to DB first
        if not dry_run:
            save_clustered_event(
                conn=conn,
                event_id=event_id,
                asset_id=asset_id,
                anchor_tweet_id=cluster["anchor_tweet_id"],
                tweet_ids=cluster["tweet_ids"],
                combined_text=cluster["combined_text"],
                event_timestamp=cluster["anchor_timestamp"],
                cluster_size=cluster["cluster_size"],
                time_span_seconds=cluster["time_span_seconds"],
                cluster_reason=cluster["cluster_reason"],
                founder=founder,
            )

        # Classify
        classification = classify_event(
            event=cluster,
            use_llm=use_llm,
            api_key=api_key,
        )

        # Track stats
        method = classification["classification_method"]
        if method == "rule":
            stats["rule"] += 1
        elif method == "llm":
            stats["llm"] += 1
        else:
            stats["none"] += 1

        # Save classification
        if not dry_run and classification["topic"]:
            save_classification_run(
                conn=conn,
                event_id=event_id,
                classification_method=classification["classification_method"],
                topic=classification["topic"],
                intent=classification["intent"],
                secondary_intent=classification["secondary_intent"],
                style_tags=classification["style_tags"],
                format_tags=classification["format_tags"],
                needs_review=classification["needs_review"],
                reasoning=classification["reasoning"],
                model=classification["model"],
                prompt_hash=classification["prompt_hash"],
            )

        # Progress
        if (i + 1) % 10 == 0:
            print(f"  Processed {i + 1}/{len(clusters)} events...")

    conn.close()
    return stats


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


def evaluate_gold_set(use_llm: bool = True, api_key: Optional[str] = None) -> dict:
    """
    Evaluate classifier against gold set.

    Returns accuracy report.
    """
    gold = load_gold_set()

    results = {
        "total": len(gold),
        "topic_correct": 0,
        "intent_correct": 0,
        "both_correct": 0,
        "rule_used": 0,
        "llm_used": 0,
        "misclassified": [],
    }

    for example in gold:
        text = example["text"]
        author = example.get("founder", example.get("author", "unknown"))
        expected_topic = example["topic"]
        expected_intent = example["intent"]

        # Classify
        event = {
            "combined_text": text,
            "founder": author,
            "anchor_timestamp": 0,
            "cluster_size": 1,
        }
        classification = classify_event(event, use_llm=use_llm, api_key=api_key)

        # Track method
        if classification["classification_method"] == "rule":
            results["rule_used"] += 1
        elif classification["classification_method"] == "llm":
            results["llm_used"] += 1

        # Check accuracy
        topic_match = classification["topic"] == expected_topic
        intent_match = classification["intent"] == expected_intent

        if topic_match:
            results["topic_correct"] += 1
        if intent_match:
            results["intent_correct"] += 1
        if topic_match and intent_match:
            results["both_correct"] += 1
        else:
            results["misclassified"].append({
                "text": text[:100] + "..." if len(text) > 100 else text,
                "author": author,
                "expected": f"{expected_topic}/{expected_intent}",
                "got": f"{classification['topic']}/{classification['intent']}",
                "method": classification["classification_method"],
                "reasoning": classification.get("reasoning", ""),
            })

    # Calculate percentages
    total = results["total"]
    results["topic_accuracy"] = round(100 * results["topic_correct"] / total, 1)
    results["intent_accuracy"] = round(100 * results["intent_correct"] / total, 1)
    results["both_accuracy"] = round(100 * results["both_correct"] / total, 1)

    return results


def print_eval_report(results: dict):
    """Print evaluation report."""
    print("\n" + "=" * 60)
    print("GOLD SET EVALUATION REPORT")
    print("=" * 60)
    print(f"\nTotal examples: {results['total']}")
    print(f"Rule-based classifications: {results['rule_used']}")
    print(f"LLM-based classifications: {results['llm_used']}")
    print(f"\nAccuracy:")
    print(f"  Topic:  {results['topic_accuracy']}% ({results['topic_correct']}/{results['total']})")
    print(f"  Intent: {results['intent_accuracy']}% ({results['intent_correct']}/{results['total']})")
    print(f"  Both:   {results['both_accuracy']}% ({results['both_correct']}/{results['total']})")

    if results["misclassified"]:
        print(f"\nMisclassified examples ({len(results['misclassified'])}):")
        print("-" * 60)
        for m in results["misclassified"][:15]:  # Show first 15
            print(f"\n  Text: {m['text']}")
            print(f"  Author: {m['author']}")
            print(f"  Expected: {m['expected']}")
            print(f"  Got: {m['got']} ({m['method']})")
            if m.get("reasoning"):
                print(f"  Reasoning: {m['reasoning'][:80]}...")


# =============================================================================
# Sample Generation
# =============================================================================

def generate_samples(
    n_samples: int = 50,
    use_llm: bool = True,
    api_key: Optional[str] = None,
) -> list[dict]:
    """
    Generate random classification samples for review.

    Returns list of classified samples.
    """
    import random

    # Load all events across assets
    assets = load_assets()
    all_clusters = []

    for asset in assets:
        asset_id = asset["id"]
        events = load_tweet_events(asset_id)
        if events:
            clusters = cluster_tweets(events)
            for c in clusters:
                c["asset_id"] = asset_id
                c["founder"] = asset.get("founder", asset.get("adopter", "unknown"))
            all_clusters.extend(clusters)

    # Random sample
    if len(all_clusters) < n_samples:
        sample = all_clusters
    else:
        sample = random.sample(all_clusters, n_samples)

    # Classify each
    results = []
    for i, cluster in enumerate(sample):
        classification = classify_event(cluster, use_llm=use_llm, api_key=api_key)

        results.append({
            "asset_id": cluster["asset_id"],
            "founder": cluster["founder"],
            "cluster_size": cluster["cluster_size"],
            "text": cluster["combined_text"][:500],  # Truncate for readability
            "topic": classification["topic"],
            "intent": classification["intent"],
            "secondary_intent": classification.get("secondary_intent"),
            "style_tags": classification.get("style_tags", []),
            "format_tags": classification.get("format_tags", []),
            "method": classification["classification_method"],
            "reasoning": classification.get("reasoning", ""),
        })

        if (i + 1) % 10 == 0:
            print(f"  Sampled {i + 1}/{len(sample)}...")

    return results


def write_samples_markdown(samples: list[dict], output_path: Path):
    """Write samples to markdown file for review."""
    with open(output_path, "w") as f:
        f.write("# Classification Samples\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write(f"Total samples: {len(samples)}\n\n")

        # Summary stats
        by_method = {}
        by_topic = {}
        by_intent = {}
        for s in samples:
            by_method[s["method"]] = by_method.get(s["method"], 0) + 1
            by_topic[s["topic"]] = by_topic.get(s["topic"], 0) + 1
            by_intent[s["intent"]] = by_intent.get(s["intent"], 0) + 1

        f.write("## Summary\n\n")
        f.write("| Method | Count |\n|--------|-------|\n")
        for k, v in sorted(by_method.items()):
            f.write(f"| {k} | {v} |\n")
        f.write("\n")

        f.write("| Topic | Count |\n|-------|-------|\n")
        for k, v in sorted(by_topic.items(), key=lambda x: -x[1]):
            f.write(f"| {k} | {v} |\n")
        f.write("\n")

        f.write("| Intent | Count |\n|--------|-------|\n")
        for k, v in sorted(by_intent.items(), key=lambda x: -x[1]):
            f.write(f"| {k} | {v} |\n")
        f.write("\n---\n\n")

        # Individual samples
        f.write("## Samples\n\n")
        for i, s in enumerate(samples, 1):
            f.write(f"### Sample {i}: {s['asset_id']} ({s['founder']})\n\n")
            f.write(f"**Classification:** {s['topic']}/{s['intent']}")
            if s.get("secondary_intent"):
                f.write(f" (+{s['secondary_intent']})")
            f.write(f" [{s['method']}]\n\n")

            if s.get("style_tags"):
                f.write(f"**Style:** {', '.join(s['style_tags'])}\n\n")
            if s.get("format_tags"):
                f.write(f"**Format:** {', '.join(s['format_tags'])}\n\n")

            f.write(f"**Text ({s['cluster_size']} tweet(s)):**\n```\n{s['text']}\n```\n\n")

            if s.get("reasoning"):
                f.write(f"**Reasoning:** {s['reasoning']}\n\n")

            f.write("---\n\n")

    print(f"Wrote {len(samples)} samples to {output_path}")


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
    parser.add_argument("--samples", type=int, help="Generate N random samples for review")
    parser.add_argument("--force", action="store_true", help="Re-classify even if already classified")
    args = parser.parse_args()

    use_llm = not args.no_llm
    skip_existing = not args.force

    if args.eval:
        print("Evaluating against gold set...")
        results = evaluate_gold_set(use_llm=use_llm)
        print_eval_report(results)

        # Save report
        report_path = ANALYSIS_DIR / "gold_eval_report.json"
        with open(report_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nFull report saved to {report_path}")

    elif args.samples:
        print(f"Generating {args.samples} random samples...")
        samples = generate_samples(n_samples=args.samples, use_llm=use_llm)
        output_path = ANALYSIS_DIR / "classification_samples.md"
        write_samples_markdown(samples, output_path)

    elif args.asset:
        print(f"Classifying {args.asset}...")
        stats = classify_asset(
            asset_id=args.asset,
            dry_run=args.dry_run,
            use_llm=use_llm,
            skip_existing=skip_existing,
        )
        print(f"\nResults for {args.asset}:")
        print(f"  Total events: {stats['total']}")
        print(f"  Rule-based: {stats['rule']}")
        print(f"  LLM-based: {stats['llm']}")
        print(f"  Skipped (existing): {stats['skipped']}")

    elif args.all:
        assets = load_assets()
        print(f"Classifying {len(assets)} assets...")
        total_stats = {"total": 0, "rule": 0, "llm": 0, "skipped": 0}

        for asset in assets:
            print(f"\n{asset['id']}...")
            stats = classify_asset(
                asset_id=asset["id"],
                dry_run=args.dry_run,
                use_llm=use_llm,
                skip_existing=skip_existing,
            )
            for k in total_stats:
                total_stats[k] += stats.get(k, 0)

        print(f"\n{'=' * 40}")
        print(f"TOTAL:")
        print(f"  Events: {total_stats['total']}")
        print(f"  Rule-based: {total_stats['rule']}")
        print(f"  LLM-based: {total_stats['llm']}")
        print(f"  Skipped: {total_stats['skipped']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
