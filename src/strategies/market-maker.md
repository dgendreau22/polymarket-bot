---
name: Market Maker
version: 1.0.0
author: System
---

# Market Maker Strategy

## Description

Provides liquidity by placing bid/ask orders around the market price. Profits from the spread between buy and sell prices while maintaining a neutral position.

The market maker continuously quotes both sides of the market, earning the spread when both sides get filled. This strategy requires careful risk management to avoid accumulating large directional positions.

## Algorithm

1. **Calculate Mid-Price**: Get best bid and ask from order book, compute mid-price
2. **Quote Calculation**:
   - Bid price = mid-price * (1 - spread/2)
   - Ask price = mid-price * (1 + spread/2)
3. **Position Check**: Adjust quotes based on current position
   - If long: widen ask, tighten bid (encourage selling)
   - If short: widen bid, tighten ask (encourage buying)
4. **Order Management**: Place/update orders at calculated prices
5. **Refresh**: Cancel and replace stale orders periodically

## Parameters

| Name | Type | Default | Min | Max | Description |
|------|------|---------|-----|-----|-------------|
| spread | number | 0.02 | 0.005 | 0.10 | Target spread as decimal (2% = 0.02) |
| orderSize | string | 10 | - | - | Size per order in USDC |
| maxPosition | string | 100 | - | - | Maximum position size in USDC |
| minLiquidity | string | 1000 | - | - | Minimum order book liquidity required |
| refreshInterval | number | 30000 | 5000 | 300000 | Order refresh interval in ms |

## Risk Management

- **maxPositionSize**: $100 (maximum directional exposure)
- **maxDrawdown**: 5% (stop if drawdown exceeds)
- **stopLoss**: 3% (close position if loss exceeds)

## Execution Logic

```typescript
async function execute(context: StrategyContext): Promise<StrategySignal[]> {
  const { position, orderBook, bot } = context;
  const config = bot.config.strategyConfig || {};

  const spread = config.spread || 0.02;
  const orderSize = config.orderSize || "10";
  const maxPosition = parseFloat(config.maxPosition || "100");

  const bestBid = parseFloat(orderBook.bids[0]?.price || "0");
  const bestAsk = parseFloat(orderBook.asks[0]?.price || "1");
  const midPrice = (bestBid + bestAsk) / 2;

  const ourBid = (midPrice * (1 - spread / 2)).toFixed(4);
  const ourAsk = (midPrice * (1 + spread / 2)).toFixed(4);

  const signals: StrategySignal[] = [];
  const positionSize = parseFloat(position.size);

  // Place bid if room to buy
  if (positionSize < maxPosition) {
    signals.push({
      action: 'BUY',
      side: 'YES',
      price: ourBid,
      quantity: orderSize,
      reason: 'Market making - providing bid liquidity',
      confidence: 0.8
    });
  }

  // Place ask if room to sell
  if (positionSize > -maxPosition) {
    signals.push({
      action: 'SELL',
      side: 'YES',
      price: ourAsk,
      quantity: orderSize,
      reason: 'Market making - providing ask liquidity',
      confidence: 0.8
    });
  }

  return signals;
}
```

## Notes

- Requires trading credentials for live execution
- Best suited for liquid markets with tight spreads
- Monitor position drift and rebalance as needed
- Consider implementing inventory skew for better risk management
