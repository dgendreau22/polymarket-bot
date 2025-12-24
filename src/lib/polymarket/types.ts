/**
 * Polymarket SDK Type Definitions
 */

export interface PolymarketConfig {
  privateKey: string;
  funderAddress: string;
  chainId: number;
  clobHost: string;
  gammaHost: string;
}

export interface MarketEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description: string;
  startDate: string;
  creationDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  featured: boolean;
  restricted: boolean;
  liquidity: number;
  volume: number;
  openInterest: number;
  sortBy: string;
  category: string;
  competitive: number;
  volume24hr: number;
  volume1wk: number;
  volume1mo: number;
  volume1yr: number;
  liquidityAmm: number;
  liquidityClob: number;
  commentCount: number;
  cyom: boolean;
  closedTime: string;
  showAllOutcomes: boolean;
  showMarketImages: boolean;
  enableNegRisk: boolean;
  negRiskAugmented: boolean;
}

export interface Market {
  // Core identifiers
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  clobTokenIds: string[];

  // Market state
  active: boolean;
  closed: boolean;
  closedTime: string;
  endDate: string;
  endDateIso: string;
  archived: boolean;
  restricted: boolean;

  // Pricing & outcomes
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  volumeNum: number;
  liquidity: string;
  liquidityNum: number;

  // Time-based volumes
  volume24hr: number;
  volume1wk: number;
  volume1mo: number;
  volume1yr: number;
  volume1wkAmm: number;
  volume1moAmm: number;
  volume1yrAmm: number;
  volume1wkClob: number;
  volume1moClob: number;
  volume1yrClob: number;

  // Order book stats
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastTradePrice: number;

  // Price changes
  oneHourPriceChange: number;
  oneDayPriceChange: number;
  oneWeekPriceChange: number;
  oneMonthPriceChange: number;
  oneYearPriceChange: number;

  // Media & display
  image: string;
  icon: string;
  description: string;
  category: string;
  twitterCardImage: string;

  // Events
  events: MarketEvent[];

  // Market configuration
  marketType: string;
  marketMakerAddress: string;
  fpmmLive: boolean;
  creator: string;
  ready: boolean;
  funded: boolean;
  approved: boolean;
  cyom: boolean;
  competitive: number;

  // Rewards & fees
  rewardsMinSize: number;
  rewardsMaxSpread: number;
  rfqEnabled: boolean;
  holdingRewardsEnabled: boolean;
  feesEnabled: boolean;

  // Metadata
  createdAt: string;
  updatedAt: string;
  updatedBy: number;
  hasReviewedDates: boolean;
  readyForCron: boolean;
  clearBookOnStart: boolean;
  manualActivation: boolean;
  negRiskOther: boolean;
  pendingDeployment: boolean;
  deploying: boolean;
  pagerDutyNotificationEnabled: boolean;
  mailchimpTag: string;
  umaResolutionStatuses: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: string;
}

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface LastTrade {
  asset_id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  timestamp: string;
}

export interface TickSize {
  asset_id: string;
  tick_size: string;
  timestamp: string;
}

export interface Order {
  id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  status: OrderStatus;
  created_at: string;
}

export type OrderStatus = "LIVE" | "MATCHED" | "CANCELLED";

export interface Position {
  asset_id: string;
  market: string;
  size: string;
  avgPrice: string;
  side: "YES" | "NO";
}

export interface TradeSignal {
  market: string;
  asset_id: string;
  action: "BUY" | "SELL";
  side: "YES" | "NO";
  price: string;
  size: string;
  reason: string;
}

export interface ArbitrageOpportunity {
  markets: string[];
  spread: number;
  expectedProfit: number;
  signals: TradeSignal[];
}

export interface MarketMakerConfig {
  spread: number; // Target spread (e.g., 0.02 for 2%)
  orderSize: string; // Size per order in USDC
  maxPosition: string; // Maximum position size
  minLiquidity: string; // Minimum liquidity threshold
  refreshInterval: number; // Milliseconds between order refreshes
}

export interface ArbitrageConfig {
  minSpread: number; // Minimum spread to trigger arbitrage
  maxSlippage: number; // Maximum allowed slippage
  orderSize: string; // Size per arbitrage trade
}
