- Implement a new arbitrage bot using the following text as description:
    - name the strategy "Arbitrage (YES + NO < $1)"
    - start by using the same layout than the market maket bot page
    - make sure to reuse the same dry run components such as limit order filling simulation developped for the market maker bot
    - on the page strategy, reuse the same "Current position" component from the market maker bot. Make sure it can track both BUY and SELL side opened positions.
    - add both the UP and the DOWN price to the market data component. Also add the combined price which is the sum of the last trade UP and DOWN
    - make sure you reuse already developped component as much as possible. Make it modular so that it can be reused by other types of trading bots
<description>
On 97.7% of markets, he holds Up AND Down positions simultaneously. Delta neutral.

explaining:

Polymarket 15-min crypto bcs MM haven't arrived. Retail is guessing direction. Spreads blow out to 8-15 cents between Up and Down on different time windows.

He enters both legs, not at once, but when combined cost is under $1. Say 48c for Up, 46c for Down = 94c total. Market resolves. One leg pays $1.

Not just arbing static spreads but timing entries around volatility compression.

When BTC consolidates, both outcomes drift toward 50c. He loads up.

When directional move hits, one leg resolves

Average hold time: 8-12 minutes.
23 out of 25 days green. $5K-33K daily.

===============

This is what $324K in 25 days actually looks like on Polymarket

I started tracking a fresh 15-minute market from the second it opened.

The visualization reveals:
Bot enters one leg after market opens.

Waits for spread dislocation. Enters the opposite side when price shifts.

Total position cost: 84-96 cents. Resolution payout: $1. Both sides held simultaneously.

Daily PnL: $5K-$33K.
</description>

- add trade volume at the top of the maket bot page
- finish the debugging of the dryrun mode using the market maker bot as a test case and make sure the order execution is done correctly and as close as possible as LIVE mode

- make sure the connexion to Polymarket account is functional
    - Add current cash balance in account to the dashboard
    - Add a order panel to the market page so that I can test sending orders manually



