/**
 * Deribit API Type Definitions
 *
 * Types for BTC options data and implied volatility surface.
 */

/**
 * Deribit instrument metadata from get_instruments API
 */
export interface DeribitInstrument {
  instrument_name: string;
  strike: number;
  expiration_timestamp: number;
  option_type: "call" | "put";
  base_currency: string;
  quote_currency: string;
  is_active: boolean;
  tick_size: number;
  min_trade_amount: number;
  settlement_period: string;
}

/**
 * Deribit ticker data from get_ticker API
 */
export interface DeribitTicker {
  instrument_name: string;
  mark_iv: number;
  underlying_price: number;
  bid_iv: number | null;
  ask_iv: number | null;
  mark_price: number;
  best_bid_price: number | null;
  best_ask_price: number | null;
  open_interest: number;
  last_price: number | null;
  timestamp: number;
}

/**
 * IV data at a specific strike price
 */
export interface StrikeIV {
  strike: number;
  call_iv: number | null;
  put_iv: number | null;
  call_mark_iv: number;
  put_mark_iv: number;
}

/**
 * IV data for a single expiry date
 */
export interface ExpiryData {
  expiry_date: string; // ISO date string (YYYY-MM-DD)
  expiry_timestamp: number;
  time_to_expiry_years: number;
  strikes: StrikeIV[];
}

/**
 * Complete IV surface snapshot
 */
export interface IVSnapshot {
  underlying_price: number;
  timestamp: number;
  expiries: ExpiryData[];
}
