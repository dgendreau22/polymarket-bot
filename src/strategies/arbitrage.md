---
name: Arbitrage
version: 1.0.0
author: System
---

# Arbitrage Strategy

## Description

Detects and exploits pricing inefficiencies between YES and NO outcomes in binary markets. When YES + NO prices sum to less than 1.0, there's a risk-free arbitrage opportunity.

In a perfect market, YES price + NO price = 1.0. When this sum is less than 1.0, buying both outcomes guarantees a profit regardless of the outcome.

## Algorithm

1. **Monitor Prices**: Track YES and NO prices for target markets
2. **Detect Opportunity**: Check if YES + NO < 1.0 (accounting for fees)
3. **Calculate Profit**:
   - Cost = YES_price + NO_price
   - Revenue = 1.0 (guaranteed payout)
   - Profit = Revenue - Cost - Fees
4. **Execute**: If profit > minSpread, buy both YES and NO
5. **Hold to Settlement**: Wait for market resolution to collect payout

## Parameters

| Name | Type | Default | Min | Max | Description |
|------|------|---------|-----|-----|-------------|
| minSpread | number | 0.01 | 0.005 | 0.05 | Minimum spread to trigger trade (1% = 0.01) |
| maxSlippage | number | 0.005 | 0.001 | 0.02 | Maximum acceptable slippage |
| orderSize | string | 50 | - | - | Size per trade in USDC |
| marketsToMonitor | string[] | [] | - | - | List of market IDs to monitor |

## Risk Management

- **maxPositionSize**: $500 (maximum capital deployed per opportunity)
- **maxDrawdown**: 2% (very conservative due to "risk-free" nature)
- **maxOpenOrders**: 2 (limit concurrent arbitrage positions)

## Execution Logic

```typescript
async function checkArbitrage(market: Market): Promise<ArbitrageOpportunity | null> {
  const yesPrice = parseFloat(market.outcomePrices[0]);
  const noPrice = parseFloat(market.outcomePrices[1]);

  const totalCost = yesPrice + noPrice;
  const spread = 1.0 - totalCost;

  // Check if there's a profitable opportunity
  if (spread > config.minSpread) {
    const profit = spread * parseFloat(config.orderSize);

    return {
      marketId: market.id,
      yesPrice,
      noPrice,
      spread,
      expectedProfit: profit,
      confidence: 0.95
    };
  }

  return null;
}

async function execute(context: StrategyContext): Promise<StrategySignal[]> {
  const opportunity = await checkArbitrage(context.market);

  if (!opportunity) return [];

  return [
    {
      action: 'BUY',
      side: 'YES',
      price: opportunity.yesPrice.toString(),
      quantity: config.orderSize,
      reason: `Arbitrage: ${(opportunity.spread * 100).toFixed(2)}% spread`,
      confidence: opportunity.confidence
    },
    {
      action: 'BUY',
      side: 'NO',
      price: opportunity.noPrice.toString(),
      quantity: config.orderSize,
      reason: `Arbitrage: ${(opportunity.spread * 100).toFixed(2)}% spread`,
      confidence: opportunity.confidence
    }
  ];
}
```

## Notes

- True arbitrage opportunities are rare in efficient markets
- Account for trading fees when calculating profitability
- Execution speed is critical - opportunities disappear quickly
- Capital is locked until market resolution
- Consider time value of money for long-dated markets
