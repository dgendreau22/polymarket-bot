---
name: Smile-Arb IV
version: 1.0.0
author: System
---

# Smile-Arb IV Strategy

## Description

An implied volatility arbitrage strategy that exploits mispricing between Deribit options IV data and Polymarket binary markets for daily BTC price predictions.

The strategy uses real-time IV surface data from Deribit options to compute theoretical fair prices for Polymarket's "BTC above $X" binary markets. When the Polymarket quote deviates significantly from the IV-derived fair value, the strategy identifies an arbitrage opportunity.

Key features:
- **IV-Derived Pricing**: Uses Deribit's liquid options market as the source of truth for implied volatility
- **Auto-Discovery**: Automatically scans for active Polymarket BTC binary markets matching the settlement date
- **Manual Mode**: Supports explicit market IDs for targeted trading
- **Dual-Sided Edge**: Calculates edge for both YES and NO sides to maximize opportunities

## Algorithm

1. **Market Discovery**:
   - Auto-scan mode: Search Polymarket for markets matching "BTC above $" pattern with target settlement date
   - Manual mode: Use explicitly provided market IDs
   - Extract strike prices from market titles

2. **IV Surface Fetch**:
   - Fetch Deribit options IV for expiries nearest to settlement date
   - Use both calls and puts to build complete IV surface
   - Refresh at configurable interval (default: 30 seconds)

3. **IV Interpolation**:
   - Use total variance method: TV = IV^2 * T
   - Interpolate/extrapolate to exact settlement time
   - Handle weekends and holidays in time calculation

4. **Fair Price Calculation** (Black-Scholes Digital):
   - d2 = (ln(S/K) + (r - 0.5 * IV^2) * T) / (IV * sqrt(T))
   - Fair price (YES) = N(d2) where N() is cumulative normal distribution
   - Fair price (NO) = 1 - N(d2)

5. **Edge Calculation**:
   - YES edge = Fair price - Polymarket ask price
   - NO edge = (1 - Fair price) - Polymarket NO ask price
   - Only trade when edge > edgeBuffer and depth > minDepth

6. **Order Execution**:
   - Check position limits (per-strike and total notional)
   - Verify time is before cutoff window
   - Place limit order at best ask if edge criteria met

## Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| discoveryMode | string | "auto-scan" | Market discovery mode: "auto-scan" or "manual" |
| searchPattern | string | "BTC above $" | Pattern for auto-scan market discovery |
| manualMarketIds | string[] | [] | Explicit market IDs for manual mode |
| settlementDate | string | - | Target settlement date (YYYY-MM-DD format) |
| maxNotionalPerExpiry | number | 1000 | Maximum total notional exposure in USDC |
| maxNotionalPerStrike | number | 200 | Maximum notional per strike in USDC |
| cutoffMinutes | number | 10 | Stop trading X minutes before settlement |
| edgeBuffer | number | 0.02 | Minimum edge required to trade (2% = 0.02) |
| minDepth | number | 100 | Minimum shares at top of book to trade |
| ivRefreshSeconds | number | 30 | IV surface refresh interval in seconds |
| orderSize | number | 10 | Number of shares per order |

## Risk Management

- **Per-Strike Limits**: `maxNotionalPerStrike` caps exposure to any single strike price, preventing concentration risk
- **Portfolio Limits**: `maxNotionalPerExpiry` limits total notional across all strikes for the settlement date
- **Cutoff Window**: `cutoffMinutes` stops all trading before settlement to avoid gamma risk and settlement uncertainty
- **Depth Requirements**: `minDepth` ensures sufficient liquidity to execute without excessive slippage
- **Edge Buffer**: `edgeBuffer` prevents trading on thin edges that may not survive transaction costs and timing

## Notes

- Requires access to Deribit API for IV data (no authentication needed for public market data)
- Best suited for liquid BTC markets with multiple strike prices
- IV surface quality depends on Deribit options liquidity; may be less reliable for far OTM strikes
- Settlement timing must match between Polymarket market and IV interpolation
- Consider running in `dry_run` mode first to validate IV data quality and edge calculations
- Monitor for IV surface staleness during low-liquidity periods
