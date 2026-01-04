---
name: Arbitrage v2 (YES + NO < $1)
version: 1.0.0
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

## Risk Management

- **Cost Constraint**: Combined average entry price (YES avg + NO avg) must always be < $1.00
- **Position Balancing**: Lagging leg gets priority to minimize unhedged exposure
- **maxOpenOrders**: 1 per leg at a time
- **Position Status**:
  - `building` - Accumulating YES and/or NO positions
  - `complete` - Both legs have balanced positions, holding for resolution
  - `closed` - Position exited