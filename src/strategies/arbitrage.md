---
name: Arbitrage (YES + NO < $1)
version: 3.0.0
author: System
---

# Arbitrage Strategy

## Description

Exploits pricing inefficiencies where YES + NO prices sum to less than $1.00. The strategy enters legs separately during price dislocations, prioritizes balancing positions, and holds until market resolution for the guaranteed $1 payout.

In a perfect market, YES price + NO price = $1.00. When this sum is less than $1.00, there's a guaranteed arbitrage profit at resolution.

**Key Insight**: Once one leg is entered, the strategy shifts focus to accumulate the other leg to hedge the position. This ensures balanced exposure and reduces risk.

## Algorithm

1. **Monitor Prices**: Track YES and NO best bid/ask prices from order books
2. **Prioritize Lagging Leg**: Always focus on the leg with smaller position size
3. **Imbalance Limit**:
   - No absolute limit on individual leg size
   - The **difference** between legs must not exceed `maxPosition`
   - Example: If maxPosition=100 and YES=170, NO=80: diff=90 ≤ 100 ✓ Can buy either
4. **Adaptive Order Placement**:
   - Normal: Place passive orders below best bid
   - Large imbalance (>50%): Place aggressive orders at best ask for immediate fill
5. **Cost Validation**: Before each order, verify projected avg cost sum < $1
6. **Hold to Settlement**: Wait for market resolution to collect $1 payout per matched pair

## Parameters

| Name | Type | Default | Min | Max | Description |
|------|------|---------|-----|-----|-------------|
| orderSize | number | 10 | 1 | 1000 | Size per order (shares) |
| maxPosition | number | 100 | 10 | 10000 | Max allowed difference between leg sizes (imbalance limit) |
| profitThreshold | number | 0.98 | 0.90 | 0.99 | Combined avg cost must stay below this |
| maxSingleLegPrice | number | 0.75 | 0.50 | 0.90 | Max price for entering a leg without the other leg |
| imbalanceThreshold | number | 0.50 | 0.20 | 0.80 | Imbalance ratio to trigger aggressive mode |
| closeOutThreshold | number | 0.90 | 0.50 | 0.95 | Time progress (0-1) to activate close-out mode |
| normalCooldownMs | number | 3000 | 500 | 10000 | Cooldown between orders per leg (ms) |
| closeOutCooldownMs | number | 500 | 100 | 2000 | Faster cooldown in close-out mode (ms) |
| closeOutOrderMultiplier | number | 3 | 1 | 10 | Order size multiplier in close-out mode |
| sellThreshold | number | 0.75 | 0.60 | 0.95 | Price above which to sell leading leg in close-out |
| minImbalanceForSell | number | 30 | 10 | 100 | Minimum imbalance required before selling is allowed |

## Risk Management

- **Cost Constraint**: Combined average entry price (YES avg + NO avg) must always be < $1.00
- **Position Balancing**: Lagging leg gets priority to minimize unhedged exposure
- **maxOpenOrders**: 1 per leg at a time
- **Position Status**:
  - `building` - Accumulating YES and/or NO positions
  - `complete` - Both legs have balanced positions, holding for resolution
  - `closed` - Position exited

## Entry Logic

```
Priority 1: Balance lagging leg (if position exists)
- If imbalance > 50%: Use AGGRESSIVE orders (at best ask)
- Otherwise: Use passive orders (at best bid)
- Only if projected combined avg < $1.00

Priority 2: Enter either leg (initial entry or balanced accumulation)
- Enter any leg that passes position limits
- Only if projected combined avg < $1.00

Entry Criterion:
- wouldCostBeValid(): "If this order fills, will my new avg still be profitable?"
- (new leg avg) + (other leg avg) < $1.00

Safety checks:
- Never place orders that would push combined avg >= $1.00
```

## Imbalance Control

```
sizeDiff = abs(YES_size - NO_size)

A leg can buy more if:
- It's the lagging leg (buying reduces the diff), OR
- It's the leading leg but diff < maxPosition (still room to grow)

Examples (maxPosition=100):
- YES=50, NO=0   → diff=50  ✓ Can buy YES (at limit soon)
- YES=100, NO=0  → diff=100 ✓ Can buy YES (at limit)
- YES=101, NO=0  → diff=101 ✗ Must buy NO first
- YES=170, NO=80 → diff=90  ✓ Can buy either
- YES=170, NO=60 → diff=110 ✗ Must buy NO to reduce diff

This ensures one side never grows too much without hedging.
Individual leg sizes are unlimited - only the imbalance is capped.
```

## Expected Profit Calculation

```
Cost per pair = YES entry price + NO entry price
Revenue per pair = $1.00 (guaranteed at resolution)
Profit per pair = $1.00 - Cost
ROI = (1.00 - Cost) / Cost

Example with YES@0.48, NO@0.47:
- Cost = $0.95
- Profit = $0.05 per share
- ROI = 5.26%
```

## Notes

- Legs are entered separately with focus on balancing
- Capital is locked until market resolution
- Time value of money matters for long-dated markets
- Strategy works best on markets with volatile spreads
- Position tracking is dual-leg: tracks YES and NO sizes independently
- Aggressive mode activates when imbalance exceeds 50%
- All orders validated against $1 cost ceiling before placement
