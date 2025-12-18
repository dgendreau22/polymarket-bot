---
name: Test Oscillator
version: 1.0.0
author: System
---

# Test Oscillator Strategy

## Description

A simple test strategy that oscillates between buying and selling to validate the bot framework. This strategy is designed purely for testing purposes and should only be run in dry_run mode initially.

The strategy alternates between buying and selling 1 YES share at configurable intervals, making it easy to verify that the entire bot lifecycle, trade execution, persistence, and UI update pipeline is working correctly.

## Algorithm

1. **Initialize**: Start with no position (size = 0)
2. **Buy Phase**:
   - If position size is 0, BUY 1 YES share at current best ask price
   - Wait for configured interval (default: 5 seconds)
3. **Sell Phase**:
   - If position size is greater than 0, SELL 1 YES share at current best bid price
   - Wait for configured interval (default: 5 seconds)
4. **Repeat**: Return to step 2 and continue the oscillation

The strategy operates in an infinite loop until stopped.

## Parameters

| Name | Type | Default | Min | Max | Description |
|------|------|---------|-----|-----|-------------|
| interval | number | 5000 | 1000 | 60000 | Time between trades in milliseconds |
| quantity | string | 1 | - | - | Number of shares per trade |
| outcome | string | YES | - | - | Which outcome to trade (YES or NO) |

## Risk Management

- **maxPositionSize**: 10 (maximum shares to hold at any time)
- **maxDrawdown**: 10% (stop bot if drawdown exceeds this percentage)
- **maxDailyLoss**: $5 (stop bot if daily loss exceeds this amount)

## Execution Logic

```typescript
async function execute(context: StrategyContext): Promise<StrategySignal | null> {
  const { position, currentPrice, bot } = context;
  const config = bot.config.strategyConfig || {};
  const quantity = config.quantity || "1";
  const outcome = config.outcome || "YES";

  const currentSize = parseFloat(position.size);
  const price = outcome === "YES" ? currentPrice.yes : currentPrice.no;

  // If no position, buy
  if (currentSize === 0) {
    return {
      action: 'BUY',
      side: outcome,
      price,
      quantity,
      reason: 'Opening oscillator position',
      confidence: 1.0
    };
  }

  // If holding, sell
  if (currentSize > 0) {
    return {
      action: 'SELL',
      side: outcome,
      price,
      quantity,
      reason: 'Closing oscillator position',
      confidence: 1.0
    };
  }

  return null;
}
```

## Notes

- This strategy is for **testing purposes only**
- Always run in `dry_run` mode first to validate the framework
- Validates bot lifecycle, trade persistence, and UI updates
- Expected behavior: alternating BUY/SELL trades every 5 seconds
- PnL will depend on market price movement during the interval
