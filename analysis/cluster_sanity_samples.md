# Clustering Sanity Samples

Random sample of multi-tweet clusters from highest-reduction assets.
**Goal:** Confirm clusters are coherent "single moments", not unrelated tweets merged by time.

## Assessment Summary

| Asset | Multi-tweet Clusters | Sample Size | Verdict |
|-------|---------------------|-------------|---------|
| GORK | 21 | 10 | ✅ PASS - All are continuous Elon↔Gork conversations |
| XPL | 1 | 1 | ✅ PASS - Single 14-tweet thread (0s span) |
| ZORA | 98 | 10 | ✅ PASS - Short 2-3 tweet bursts, all coherent |

**No bad merges detected.** Proceed with current 15-minute window.

---

## GORK (21 multi-tweet clusters)

**Pattern:** Elon's rapid-fire emoji responses and @gork mentions. Each cluster is a continuous conversation session.

### Cluster 1 (14 tweets, 50m span)

- `2025-05-04T13:49:51`: sup @gork  changed my pp to urs wdyt
- `2025-05-04T13:52:36`: @gork now we have same pp 👀 🤭
- `2025-05-04T13:55:00`: u got it bro 😎
- `2025-05-04T14:00:00`: 🔥😂
- `2025-05-04T14:02:00`: 🖍️ 😋
- `2025-05-04T14:03:00`: @gork wuz made by urmomai
- `2025-05-04T14:07:00`: 🦾
- `2025-05-04T14:09:00`: dun
- `2025-05-04T14:16:00`: 😂
- `2025-05-04T14:20:00`: Too much gravitas
- `2025-05-04T14:30:00`: 🔥🤣
- `2025-05-04T14:32:00`: nice
- `2025-05-04T14:38:00`: 😂
- `2025-05-04T14:40:00`: Will work on that

**Assessment:** ✅ Single conversation session with @gork. 50m span is long but content is clearly continuous - emoji reactions interspersed with short replies. Would be worse to split.

### Cluster 2 (7 tweets, 42m span)

- `2025-05-04T17:41:00`: 😂💯
- `2025-05-04T17:52:00`: 🍆 + 🏀 🏀 @gork
- `2025-05-04T17:53:00`: 🍆 + 🏀 🏀
- `2025-05-04T18:08:00`: @gork
- `2025-05-04T18:12:00`: @gork
- `2025-05-04T18:14:00`: @gork 🤷‍♂️
- `2025-05-04T18:23:00`: 🎯

**Assessment:** ✅ Another @gork conversation session, same pattern.

### Cluster 3 (4 tweets, 12m span)

- `2025-05-11T13:04:00`: @gork
- `2025-05-11T13:11:00`: not a fully loaded gun tbh
- `2025-05-11T13:15:00`: 💯😂
- `2025-05-11T13:16:00`: My is Sandy Poon.   That's just what happens if you're a nudist on the beach 🤷‍♂️

**Assessment:** ✅ Continuous conversation, tight 12m span.

### Cluster 4 (4 tweets, 18m span)

- `2025-05-11T09:44:00`: 🎯
- `2025-05-11T09:47:00`: 😂
- `2025-05-11T09:56:00`: Exactly
- `2025-05-11T10:02:00`: We're working on improving the phone latency of @gork

**Assessment:** ✅ Conversation ending with product comment about Gork.

### Cluster 5-10 (2-tweet clusters)

All 2-tweet clusters with 0-11m spans - clearly coherent pairs.

**Assessment:** ✅ All pass.

---

## XPL (1 multi-tweet cluster)

**Pattern:** Single long-form thread posted all at once.

### Cluster 1 (14 tweets, 0m span)

- `2025-12-11T09:43:53`: A staggering amount of brainpower and capital is spent optimizing throughput, latency, decentralization specs, etc...
- `2025-12-11T09:43:53`: There is an unspoken assumption in crypto that everyone nods to but is rarely reflected...
- `2025-12-11T09:43:53`: The reality is: Selling blockspace is a commodity business already...
- `2025-12-11T09:43:54`: Chris Dixon lied to you. Blockspace is not the new oil, it is a race to zero.
- `2025-12-11T09:43:54`: As hardware improves and data compression gets better...
- `2025-12-11T09:43:55`: Visa and Stripe don't win because they have the best database...
- `2025-12-11T09:43:55`: @0xCryptoSam's breakdown of "crypto neobanks" gets at the same core idea...
- `2025-12-11T09:43:55`: At Plasma, we operate on that conviction...
- `2025-12-11T09:43:56`: Plasma One is a step for Plasma towards owning that surface...
- `2025-12-11T09:43:56`: The winners going forward won't be the chains that sell the most expensive blocks...
- `2025-12-11T09:43:57`: For this reason, we have been focused on building a gigantic network...
- `2025-12-11T09:43:57`: These efforts will pay massive dividends...
- `2025-12-11T09:43:58`: The path to winning necessitates aggressive verticalization...
- `2025-12-11T09:43:58`: Trillions.

**Assessment:** ✅ Perfect thread detection - 14-part manifesto posted in 5 seconds. This is exactly what clustering should catch.

---

## ZORA (98 multi-tweet clusters)

**Pattern:** Short 2-3 tweet bursts, typically product thoughts + link drops.

### Cluster 1 (3 tweets, 4m span)

- `2025-10-26T13:27:40`: pretty crazy that prediction markets allow you to directly ask the market any question
- `2025-10-26T13:31:32`: prediction markets are questions  memecoins are statements
- `2025-10-26T13:32:12`: markets are a language

**Assessment:** ✅ Coherent philosophical thread about markets.

### Cluster 2 (2 tweets, 2m span)

- `2025-10-28T13:17:07`: We are rolling out @zora streaming to more users this week...
- `2025-10-28T13:19:53`: Zora team is hanging out with SOLANA on Wall St today

**Assessment:** ✅ Product update + team update in same session.

### Cluster 3 (2 tweets, 0m span)

- `2025-08-20T21:28:13`: love seeing my images remixed
- `2025-08-20T21:28:23`: https://t.co/a9JPqLCDvJ

**Assessment:** ✅ Comment + link pair, same moment.

### Cluster 4 (2 tweets, 0m span)

- `2025-10-26T15:15:01`: equities onchain = newspapers online
- `2025-10-26T15:15:27`: an improvement but not the net new thing

**Assessment:** ✅ Two-part philosophical observation.

### Cluster 5 (2 tweets, 9m span)

- `2025-07-28T20:24:02`: throwback https://t.co/8PfitYMByH
- `2025-07-28T20:33:27`: yo @notthreadguy here's the onramp image I mentioned on stream

**Assessment:** ✅ Image share + follow-up context.

### Clusters 6-10 (2-tweet clusters)

All 0-3m spans, all coherent pairs (image + link, comment + follow-up).

**Assessment:** ✅ All pass.

---

## Conclusion

**No clustering rule changes needed.** All sampled clusters are coherent single moments:
- GORK: Continuous conversation sessions with @gork
- XPL: Thread dumps posted in seconds
- ZORA: Quick thought bursts with follow-up links

The 15-minute window with thread chaining (when reply_to data exists) is working correctly.
