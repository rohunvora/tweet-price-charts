// Price candle data (compact format from static JSON)
export interface Candle {
  t: number;  // timestamp epoch
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

export interface PriceData {
  timeframe: string;
  count: number;
  start: number;
  end: number;
  candles: Candle[];
}

// Tweet event data (aligned with prices)
export interface TweetEvent {
  tweet_id: string;
  timestamp: number;
  timestamp_iso: string;
  text: string;
  price_at_tweet: number | null;
  price_1h: number | null;
  price_24h: number | null;
  change_1h_pct: number | null;
  change_24h_pct: number | null;
  likes: number;
  retweets: number;
  impressions: number;
}

export interface TweetEventsData {
  generated_at: string;
  price_definition: string;
  count: number;
  events: TweetEvent[];
}

// Statistics data
export interface Stats {
  generated_at: string;
  summary: {
    total_tweets: number;
    tweets_with_price: number;
    date_range: {
      start: string;
      end: string;
    };
  };
  daily_comparison: {
    tweet_day_count: number;
    tweet_day_avg_return: number;
    tweet_day_win_rate: number;
    no_tweet_day_count: number;
    no_tweet_day_avg_return: number;
    no_tweet_day_win_rate: number;
    t_statistic: number | null;
    p_value: number | null;
    significant: boolean;
  };
  correlation: {
    correlation_7d: number;
    p_value: number;
    significant: boolean;
    sample_size: number;
  };
  current_status: {
    days_since_last_tweet: number;
    price_change_during_silence: number | null;
    last_tweet_date: string | null;
  };
  quiet_periods: Array<{
    start_ts: number;
    end_ts: number;
    gap_days: number;
    start_date: string;
    end_date: string;
    price_start: number | null;
    price_end: number | null;
    change_pct: number | null;
    is_current?: boolean;
  }>;
}

// Timeframe options
export type Timeframe = '15m' | '1h' | '4h' | '1d';

// Chart marker for tweet bubbles
export interface TweetMarker {
  time: number;
  price: number;
  tweet: TweetEvent;
}

// Clustered tweets by timeframe window
export interface TweetCluster {
  startTime: number;      // Start of the time window
  endTime: number;        // End of the time window
  tweets: TweetEvent[];   // All tweets in this window
  count: number;          // Number of tweets
  candleHigh: number;     // High price of the candle (for positioning)
  candleLow: number;      // Low price of the candle
  periodChange: number;   // Price change during this period (%)
  gapToNext: number | null;     // Seconds until next cluster
  gapChange: number | null;     // Price change during gap (%)
}

