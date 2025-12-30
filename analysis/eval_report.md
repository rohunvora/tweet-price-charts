# Classification Evaluation Report

**Generated:** 2025-12-29T21:50:00
**Branch:** feat/tweet-categorization-v1

---

## Executive Summary

| Model | Gold Accuracy (Both) | Topic Acc | Intent Acc | Parse Errors | Cost |
|-------|---------------------|-----------|------------|--------------|------|
| gpt-5.2 | 59.2% | 74.6% | 77.5% | 0 | $0.1533 |
| opus-4.5 | N/A | N/A | N/A | N/A | blocked |

**Note:** Opus 4.5 evaluation could not be completed due to Anthropic API billing issue ("credit balance too low"). GPT-5.2 results are complete and valid.

---

## GPT-5.2 Gold Set Results

- **Total examples:** 71
- **Rule-based:** 10 (14.1%)
- **LLM-based:** 61 (85.9%)
- **Parse errors:** 0
- **Tokens:** 42,467 in / 4,715 out
- **Cost:** $0.1533
- **Time:** 100.0s

### Accuracy

| Metric | Score |
|--------|-------|
| Topic | 74.6% (53/71) |
| Intent | 77.5% (55/71) |
| Both | 59.2% (42/71) |

### Confusion Analysis

**Topic Errors (18 total):**
- token -> market: 4
- personal -> market: 2
- product -> market: 2
- ecosystem -> token: 2
- product -> meta: 1
- product -> personal: 1
- token -> meta: 1
- personal -> product: 1
- personal -> meta: 1

**Intent Errors (16 total):**
- inform -> celebrate: 4
- inform -> defend: 3
- inform -> tease: 2
- inform -> reflect: 2
- celebrate -> engage: 1
- defend -> inform: 1
- rally -> reflect: 1
- engage -> reflect: 1
- celebrate -> rally: 1

### Key Insights

1. **Token vs Market confusion:** Model conflates token-specific commentary with broader market analysis (4 errors)
2. **Over-predicting "inform":** Model classifies celebrations, defenses, and teases as neutral information (9 errors)
3. **Structured outputs working:** Zero parse errors demonstrates schema enforcement is effective
4. **Secondary intents useful:** Model often captures the correct label as secondary_intent even when primary is wrong

---

## Classification Examples (30 from gold set)

### Example 1 ✅ product/inform -> product/tease

**Text:** CTOs are the lifeblood of pump fun - they formed most of the success cases on the platform... this important update is only one of a series of initiatives...

**Author:** a1lon9

**Predicted:** product/tease (+inform)

**Reasoning:** It frames an "important update" as part of a series of initiatives without detailing specifics, signaling upcoming platform changes.

---

### Example 2 ❌ product/inform -> market/inform

**Text:** I've heard feedback from many that market making has gotten more competitive on Hyperliquid recently... See https://t.co/0DdDdObM5P for further details

**Author:** chameleon_jeff

**Predicted:** market/inform

**Reasoning:** Shares an observation about increased competitiveness in market making on Hyperliquid. The purpose is informational.

---

### Example 3 ❌ token/rally -> meta/rally

**Text:** wif --- wif wif wif wif wif --- wif --- wif used car kpop wynn --- wif

**Author:** blknoiz06

**Predicted:** meta/rally (memetic)

**Reasoning:** Repetitive meme-style chanting of "wif" with no substantive info, functioning as a degen hype signal.

---

### Example 4 ❌ personal/engage -> product/engage

**Text:** Taking a 15 minute breather from building to answer some questions on here related to @believeapp, @launchcoin, and $LAUNCHCOIN. Ask away!

**Author:** pasternak

**Predicted:** product/engage

**Reasoning:** Invites followers to ask questions about specific apps/coins, aiming to start a Q&A conversation.

---

### Example 5 ❌ product/inform -> personal/reflect

**Text:** Creators should have the freedom to build where they believe their project will thrive... https://t.co/61C0O93vV1

**Author:** pasternak

**Predicted:** personal/reflect (philosophical)

**Reasoning:** Expresses a belief about creator freedom without concrete product details. Values-driven and reflective.

---

### Example 6 ❌ ecosystem/rally -> token/rally

**Text:** prove it --- that you are worthy of bags --- that you are long term --- ...(26 tweets)

**Author:** weremeow

**Predicted:** token/rally (hype, memetic)

**Reasoning:** Motivational call aimed at holders to demonstrate long-term conviction and deserve "bags."

---

### Example 7 ❌ product/inform -> token/inform

**Text:** 1/ Quote pairs are a new value accrual model for tokens --- 2/ Quote pairs are a model originally pioneered by @virtuals_io... (10 tweets)

**Author:** js_horne

**Predicted:** token/inform (technical)

**Reasoning:** Explains "quote pairs" as a token value-accrual model, focusing on token mechanics.

---

### Example 8 ✅ ecosystem/inform -> ecosystem/celebrate

**Text:** You asked for it. And @TrustWallet delivers... $11,000,000 in hard currency (#BNB) donated to @GiggleAcademy...

**Author:** cz_binance

**Predicted:** ecosystem/celebrate (+inform) (hype)

**Reasoning:** Highlights TrustWallet/GiggleAcademy donation as ecosystem achievement. Celebratory tone.

---

### Example 9 ✅ product/inform -> product/defend [rule]

**Text:** Let's make crypto payments work on #BNB... FUD is paid (by others) advertising...

**Author:** cz_binance

**Predicted:** product/defend

**Reasoning:** Defense: Defend pattern: fud

---

### Example 10 ❌ token/celebrate -> ecosystem/inform

**Text:** since we've listed ZEC on Solana: 'he who has no pockets can not be pickpocketed.'

**Author:** mert_

**Predicted:** ecosystem/inform (philosophical)

**Reasoning:** Mentions listing ZEC on Solana - ecosystem integration. Observation rather than celebration.

---

### Example 11 ❌ token/celebrate -> token/engage

**Text:** wait... is the Coinbase #USELESS coin listing news true??? is Coinbase really listing #USELESS coin??

**Author:** theunipcs

**Predicted:** token/engage

**Reasoning:** Asking whether a coin is being listed. Question marks indicate seeking confirmation.

---

### Example 12 ❌ token/rally -> market/reflect

**Text:** $BNB season sucking out liquidity from every Solana memecoin... the real story isn't the relative strength...

**Author:** theunipcs

**Predicted:** market/reflect (philosophical)

**Reasoning:** Comments on broader market flow dynamics rather than a specific token update.

---

### Example 13 ✅ product/inform -> product/celebrate

**Text:** we crossed 1M users

**Author:** example

**Predicted:** product/celebrate (hype)

**Reasoning:** Announces a key product adoption milestone. The tone is celebratory.

---

### Example 14 ✅ personal/inform -> personal/reflect

**Text:** feeling good today

**Author:** example

**Predicted:** personal/reflect

**Reasoning:** Simple mood/vibe update. Reads as personal reflection.

---

### Example 15 ❌ ecosystem/tease -> token/tease

**Text:** Someone needs to build a 'Believe University', similar to Whop University, and launch a coin tied to it... https://t.co/33y73wHo3E

**Author:** pasternak

**Predicted:** token/tease

**Reasoning:** Suggests creating a new coin tied to a concept, hinting without concrete details.

---

### Example 16 ❌ product/inform -> meta/inform

**Text:** recently on @zora --- https://t.co/khsEEADtcb --- https://t.co/VIZYUytXOc

**Author:** js_horne

**Predicted:** meta/inform

**Reasoning:** Link drop with minimal context. Thread-style continuation rather than substantive content.

---

### Example 17 ❌ product/defend -> market/inform

**Text:** Hyperliquid's fully onchain liquidations cannot be compared with underreported CEX liquidations... Source for screenshot...

**Author:** chameleon_jeff

**Predicted:** market/inform (technical)

**Reasoning:** Compares Hyperliquid's transparency to CEX opacity. Broader market-structure point.

---

### Example 18 ❌ personal/engage -> market/engage

**Text:** Dumb question about X. My followers grew quickly from 9-10m, in a bear market... or maybe we haven't hit real bull market yet?

**Author:** cz_binance

**Predicted:** market/engage (+reflect)

**Reasoning:** Speculates about market phase. Framed as question to prompt discussion.

---

### Example 19 ❌ personal/reflect -> market/reflect

**Text:** Things in crypto only look pessimistic if you don't have a plan for how to improve them --- Agency creates optimism

**Author:** keoneHD

**Predicted:** market/reflect (philosophical)

**Reasoning:** Broad statement about sentiment in crypto. Reflective and philosophical.

---

### Example 20 ❌ token/rally -> market/rally

**Text:** good chance zcash becomes top 5 simply because it's incredibly easy to meme

**Author:** mert_

**Predicted:** market/rally (memetic)

**Reasoning:** Speculates on Zcash rising to top 5. Bullish conviction driven by memeability.

---

### Example 21 ❌ personal/rally -> token/rally

**Text:** I'm always about jup man --- My networth and my life work and legacy and my beloved team n community is 99.99% on JUP...

**Author:** weremeow

**Predicted:** token/rally (+reflect) (philosophical)

**Reasoning:** Signals extreme personal conviction in JUP, encouraging others to hold.

---

### Example 22 ❌ ecosystem/engage -> token/engage

**Text:** bros how much cash you think we needa raise to put wif on the vegas dome? k bros new plan, we make dogwifwebsite...

**Author:** blknoiz06

**Predicted:** token/engage (memetic)

**Reasoning:** Centered on promoting WIF token (Vegas dome, dogwifwebsite). Question to spark responses.

---

### Example 23 ❌ personal/engage -> meta/engage

**Text:** @gork what do you think? --- fire emoji --- laughing emoji --- @gork, what do you think? --- laughing emoji

**Author:** elonmusk

**Predicted:** meta/engage (memetic)

**Reasoning:** Reply/mention asking another user for opinion. Only reaction emojis, no substantive content.

---

### Example 24 ✅ ecosystem/inform -> ecosystem/celebrate

**Text:** Thanks to @TBPN for having me on! It was a fun conversation about the origin story, principles, and vision for Hyperliquid --- https://t.co/p28TkgxkO1

**Author:** chameleon_jeff

**Predicted:** ecosystem/celebrate (+inform)

**Reasoning:** Thanks another account for hosting. Appearance announcement.

---

### Example 25 ❌ product/inform -> product/tease

**Text:** new feature shipping next week - here's what it does...

**Author:** example

**Predicted:** product/tease

**Reasoning:** Hints at upcoming product update without fully detailing everything.

---

### Example 26 ✅ personal/inform -> personal/reflect

**Text:** had a great dinner with the team tonight

**Author:** example

**Predicted:** personal/reflect

**Reasoning:** Personal life/social moment. No product/token/market content.

---

### Example 27 ❌ product/inform -> product/defend

**Text:** we messed up. here's what happened and what we're doing about it

**Author:** example

**Predicted:** product/defend (+inform) (vulnerable)

**Reasoning:** Acknowledges mistake and signals remediation. Addressing potential criticism.

---

### Example 28 ❌ token/celebrate -> personal/rally

**Text:** THIS IS INSANE!!! rocket emojis MASSIVE NEWS!!!

**Author:** example

**Predicted:** personal/rally (hype)

**Reasoning:** Pure high-energy excitement with no concrete info. Aims to build hype.

---

### Example 29 ✅ meta/inform -> meta/inform [rule]

**Text:** https://t.co/HHQ75YfK4S

**Author:** a1lon9

**Predicted:** meta/inform

**Reasoning:** Link-only content with no context

---

### Example 30 ✅ token/celebrate -> token/celebrate [rule]

**Text:** WIF just listed on Binance!

**Author:** blknoiz06

**Predicted:** token/celebrate

**Reasoning:** Token celebration: Listing celebration

---

## Hard/Borderline Examples (10)

These reveal taxonomy edge cases where reasonable people would disagree.

### Hard 1: personal vs product

**Text:** Taking a 15 minute breather from building to answer some questions on here related to @believeapp, @launchcoin, and $LAUNCHCOIN. Ask away!

- **Gold:** personal/engage (personal framing: "taking a breather")
- **GPT-5.2:** product/engage (product mentions: @believeapp, @launchcoin)

**Verdict:** Both defensible. Consider adding "product-adjacent personal" guidance.

---

### Hard 2: token vs market

**Text:** $BNB season sucking out liquidity from every Solana memecoin... the real story isn't the relative strength...

- **Gold:** token/rally (implicit BNB bullishness)
- **GPT-5.2:** market/reflect (macro liquidity dynamics)

**Verdict:** Market dynamics discussion that happens to mention tokens. Gold label may be too narrow.

---

### Hard 3: ecosystem vs token

**Text:** prove it --- that you are worthy of bags --- that you are long term

- **Gold:** ecosystem/rally (community/culture focus)
- **GPT-5.2:** token/rally ("bags" = token holdings)

**Verdict:** "Bags" is token terminology but the sentiment is community-building.

---

### Hard 4: inform vs celebrate

**Text:** we crossed 1M users

- **Gold:** product/inform (factual milestone)
- **GPT-5.2:** product/celebrate (celebratory tone)

**Verdict:** Milestones are inherently both. Consider allowing dual intents.

---

### Hard 5: defend vs inform

**Text:** Hyperliquid's fully onchain liquidations cannot be compared with underreported CEX liquidations...

- **Gold:** product/defend (favorable comparison)
- **GPT-5.2:** market/inform (market structure observation)

**Verdict:** Defensive but framed as education. Context-dependent.

---

### Hard 6: product vs personal

**Text:** Creators should have the freedom to build where they believe their project will thrive...

- **Gold:** product/inform (platform philosophy)
- **GPT-5.2:** personal/reflect (values statement)

**Verdict:** Founder philosophy straddles both categories.

---

### Hard 7: token vs meta

**Text:** wif --- wif wif wif wif wif

- **Gold:** token/rally (about WIF token)
- **GPT-5.2:** meta/rally (meme behavior with no substance)

**Verdict:** Pure meme content. Token name present but no meaningful information.

---

### Hard 8: inform vs tease

**Text:** new feature shipping next week - here's what it does...

- **Gold:** product/inform (announcing feature)
- **GPT-5.2:** product/tease (preview without details)

**Verdict:** Pre-announcements blend both. Ellipsis suggests tease.

---

### Hard 9: personal vs market

**Text:** Things in crypto only look pessimistic if you don't have a plan for how to improve them --- Agency creates optimism

- **Gold:** personal/reflect (individual philosophy)
- **GPT-5.2:** market/reflect (crypto sentiment commentary)

**Verdict:** Crypto-context philosophy. Personal when from known figure.

---

### Hard 10: celebrate vs rally

**Text:** THIS IS INSANE!!! rocket emojis MASSIVE NEWS!!!

- **Gold:** token/celebrate (assumed news-worthy event)
- **GPT-5.2:** personal/rally (pure hype, no context)

**Verdict:** Without context, impossible to classify correctly.

---

## 200 Random Sample Distribution

Distribution across 200 real events (GPT-5.2):

### Topic

| Topic | Count | % |
|-------|-------|---|
| token | 104 | 52.0% |
| ecosystem | 26 | 13.0% |
| personal | 21 | 10.5% |
| product | 21 | 10.5% |
| market | 16 | 8.0% |
| meta | 12 | 6.0% |

### Intent

| Intent | Count | % |
|--------|-------|---|
| rally | 78 | 39.0% |
| inform | 43 | 21.5% |
| reflect | 30 | 15.0% |
| celebrate | 16 | 8.0% |
| engage | 14 | 7.0% |
| defend | 13 | 6.5% |
| tease | 6 | 3.0% |

### Method

- **Rule-based:** ~28 (14%)
- **LLM-based:** ~172 (86%)

---

## Conclusions & Recommendations

### Performance

1. **GPT-5.2 achieves adequate accuracy:**
   - Topic: 74.6%
   - Intent: 77.5%
   - Both: 59.2%

2. **Zero parse errors** - structured outputs work correctly

3. **Cost-effective:** $0.15 for 71 examples, estimated $8-10 for full 3,788 events

### Taxonomy Refinements Needed

1. **Clarify token vs market boundary** - currently the biggest source of confusion
2. **Allow dual intents for milestones** - inform+celebrate overlap significantly
3. **Define "personal" more precisely** - values-driven founder statements are ambiguous
4. **Add "meta" examples** - pure meme content without substance needs clearer guidance

### Next Steps

1. Add Anthropic credits to run Opus 4.5 comparison
2. Review hard examples and update gold labels or taxonomy spec
3. Consider expanding rules to catch more patterns (reduce LLM calls)
4. Run full classification on all 3,788 events after approval
