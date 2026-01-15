---
name: "Time Above 50"
version: "1.0.0"
author: "Strategy Spec"
---

# Polymarket 15-Minute YES/NO Strategy (Bot-Deployable)

## Description

15-minute binary market strategy using time-above-0.50 signal with consensus pricing from YES/NO books, exponential decay, and comprehensive risk controls.

## Parameters

| Name | Type | Default | Min | Max | Description |
|------|------|---------|-----|-----|-------------|
| Q_max | number | 600 | 10 | 10000 | Maximum exposure in shares |
| q_step | number | 10 | 1 | 100 | Minimum step size for rebalancing |
| H_tau | number | 45 | 10 | 300 | Time-above EW half-life in seconds |
| H_d | number | 60 | 10 | 300 | Displacement EW half-life in seconds |
| E_enter | number | 0.18 | 0.05 | 0.50 | Edge threshold to enter/expand position |
| E_exit | number | 0.10 | 0.01 | 0.30 | Edge threshold to exit position |
| spread_max_entry | number | 0.025 | 0.005 | 0.10 | Max spread for new entries |
| spread_halt | number | 0.04 | 0.01 | 0.15 | Spread to halt all activity |
| T_flat | number | 1.0 | 0.5 | 5.0 | Minutes before resolution to flatten |
| rebalance_interval | number | 2.0 | 0.5 | 10.0 | Seconds between decisions |
| cooldown | number | 2.0 | 0.5 | 10.0 | Cooldown after fill in seconds |

## Assumptions + limitations

- **Market type**: Polymarket-style binary markets. A **YES** share pays `1` if outcome is YES else `0`. A **NO** share pays `1` if outcome is NO else `0`.
- **No shorting / no borrowing**: inventories must satisfy `inv_yes ≥ 0` and `inv_no ≥ 0` at all times.
- **Trading allowed**: you can **buy and sell** YES and NO anytime (i.e., you can exit positions before resolution).
- **Data available**: full order book (bids/asks levels) + top-of-book `bid/ask/mid` for both YES and NO; timestamps; known `resolution_time`.
- **15-minute horizon**: microstructure costs (spread/impact/fees/adverse selection) dominate. The strategy requires EV gating and strong throttles. It can fail if the market is efficient or fees are high.
- **No guaranteed profits**: this is a hypothesis-driven strategy; treat as experimental.

---

## 1) Signal definition

We compute a **consensus probability** for YES using both YES and NO books to reduce temporary inconsistencies.

### 1.1 Consensus price `p_t`

Let:

- `mid_yes = (bid_yes + ask_yes)/2`
- `mid_no  = (bid_no  + ask_no)/2`
- `p_from_no = 1 - mid_no`

Weight by tightness (tighter spread gets more weight):

- `spread_yes = ask_yes - bid_yes`
- `spread_no  = ask_no  - bid_no`
- `w_yes = 1/(spread_yes + εs)`, `w_no = 1/(spread_no + εs)`, `εs = 1e-6`

Consensus:

\[ p_t = \frac{w_{yes}\,mid_{yes} + w_{no}\,(1-mid_{no})}{w_{yes}+w_{no}} \]

Distance from 0.50:

- `d_t = p_t - 0.50`

### 1.2 “Time above 0.50” (rigorous)

Use an exponentially time-decayed estimator (handles irregular ticks):

Let `I_t = 1[p_t > 0.50]`. Maintain `τ_t ∈ [0,1]`:

\[ \tau_t = \tau_{t^-}\,e^{-\Delta t/H_\tau} + I_t\,(1-e^{-\Delta t/H_\tau}) \]

Signed score:

\[ A_t = 2\tau_t - 1 \in [-1,1] \]

Default: `Hτ = 45s`.

### 1.3 Smoothed displacement `\bar d_t`

Maintain EW mean displacement:

\[ \bar d_t = \bar d_{t^-}\,e^{-\Delta t/H_d} + d_t\,(1-e^{-\Delta t/H_d}) \]

Default: `Hd = 60s`.

### 1.4 Chop / uncertainty metrics (short horizon)

Compute over rolling window `W_chop` (default 90 seconds):

1) **Crossing rate** around 0.50:
- Let `s_i = sign(p_i - 0.5)` (ignore zeros).
- Count sign flips `C` within the window.

\[ cross_t = \frac{C}{W_{chop}/60} \quad \text{(flips per minute)} \]

2) **Realized volatility** in logit space:
- `z = logit(clip(p, 0.01, 0.99))`
- returns `r_j = z_j - z_{j-1}` in the window
- `σ_t = stdev(r_j)`

### 1.5 Time to resolution

Let `T_t` be minutes remaining until resolution:

- `T_t = max(0, (resolution_time - t)/60)`

### 1.6 Theta-like scaler (more conservative near end)

\[ \theta(T_t) = \left(\frac{T_t}{T_t + T_0}\right)^b \]

Defaults: `T0 = 3.0 minutes`, `b = 1.5`.

### 1.7 Chop penalty

\[ \chi_t = \frac{1}{1 + (cross_t/c_0)^2 + (\sigma_t/\sigma_0)^2} \]

Defaults: `c0 = 2.0 flips/min`, `σ0 = 0.08` (logit units).

### 1.8 Combined edge score `E_t`

\[ E_t = \theta(T_t)\,\chi_t\,\Big(\alpha A_t + \beta\tanh(\bar d_t/d_0) + \gamma\tanh(d_t/d_1)\Big) \]

Default parameters:

- `α=1.0`, `β=0.6`, `γ=0.3`
- `d0=0.015`, `d1=0.010`

---

## 2) Sizing (“gamma/theta” analog) + deadband/hysteresis

### 2.1 Gamma-like weight (peaks at 0.50)

\[ g(p_t) = 4p_t(1-p_t) \in [0,1] \]

### 2.2 Net exposure representation (no shorting)

Maintain inventories:

- `inv_yes ≥ 0`, `inv_no ≥ 0`

Define net directional exposure:

- `q_t = inv_yes - inv_no` (can be negative without shorting)

### 2.3 Bounded target exposure

\[ q^*_t = Q_{max}\,g(p_t)\,\tanh(kE_t) \]

Defaults: `k=2.5`. `Qmax` set from risk (see §4).

### 2.4 Adaptive deadband near 0.50

Let `spread_c = min(spread_yes, spread_no)`.

\[ \delta_t = \max(\delta_{min},\; \delta_0 + \lambda_s\,spread_c + \lambda_c\,cross_t) \]

Defaults:

- `δmin=0.003`, `δ0=0.004`
- `λs=0.5`, `λc=0.002`
- persistence gate `|A_t| ≥ A_min` with `A_min=0.15`

**Rule**: if `|d_t| < δ_t` and `|A_t| < A_min`, force `q*_t = 0`.

### 2.5 Hysteresis on signal strength

- Enter/expand only if `|E_t| > E_enter` (default `0.18`).
- Exit/flatten when `|E_t| < E_exit` (default `0.10`).

In the gray zone `E_exit ≤ |E_t| < E_enter`: allow **reductions only** (no increasing `|q|`).

### 2.6 Switching protocol (YES ↔ NO)

When changing sign of exposure:

1. **Unwind first**: sell the currently-held side until `q → 0`.
2. **Then build** the opposite side via buys.

This prevents being long both YES and NO unintentionally.

---

## 3) Entry/exit logic

### 3.1 Timing & throttles

- Decision loop runs on every book update (or 1 Hz), but order actions are throttled:
  - `rebalance_interval = 2s`
  - after any fill: `cooldown = 2s`
  - minimum hold before direction flip: `min_hold = 15s` (unless risk exit)

### 3.2 Liquidity gates

- Block **new entries** if `spread_c > spread_max_entry` (default `0.025`).
- If `spread_c > spread_halt` (default `0.04`): block entries; allow only risk-reducing sells.
- If no book update for `> 5s`: treat as stale data; stop submitting new orders.

### 3.3 Time-based flatten near resolution

- If `T_t < T_flat` (default `1.0 min`), target `q* = 0` unless override:
  - `|E_t| ≥ E_override` (default `0.35`) **and** `spread_c ≤ 0.015`.

### 3.4 Rebalancing action selection

Let `dq = q* - q`.

- If `dq > 0` (need more YES exposure):
  1) if `inv_no > 0`: **sell NO** first (reduces NO inventory)
  2) else: **buy YES**

- If `dq < 0` (need more NO exposure):
  1) if `inv_yes > 0`: **sell YES** first
  2) else: **buy NO**

Only act if `|dq| ≥ q_step` (default `10 shares`).

---

## 4) Risk management

### 4.1 Worst-case loss budgeting (works with no shorting)

Approximate worst-case loss to settlement:

- YES: `L_yes ≈ inv_yes * avg_entry_yes`
- NO:  `L_no  ≈ inv_no  * avg_entry_no`

Enforce per market:

- `L_yes + L_no ≤ L_max_market` (e.g., 0.25% of bankroll)

### 4.2 Mark-to-market stop

If market PnL drops below `-stop_loss_market`:

- flatten immediately (taker allowed)
- disable re-entry for `cooloff = 60s`

### 4.3 Portfolio-level controls (across correlated crypto markets)

- Cap total worst-case loss across markets: `Σ L_max_market_used ≤ L_max_portfolio`.
- Cap theme concentration (BTC/crypto highly correlated).

---

## 5) Execution plan (full order book)

### 5.1 Book-walk slippage model

For a taker buy of `Q` YES shares:

- Walk asks to compute `vwap_buy_yes(Q)`.

For a taker sell of `Q` YES shares:

- Walk bids to compute `vwap_sell_yes(Q)`.

Use these for:

- impact gating (don’t trade sizes that create large VWAP distance)
- EV gating (below)

### 5.2 Maker vs taker (two-stage)

For required adjustment `|dq|`:

1) **Stage A (maker)**: post-only at best bid (for buys) / best ask (for sells). Wait `t_wait = 2s`.
2) **Stage B (optional taker)**: if unfilled and urgency/strength holds:
   - allow taker slices when `|E| ≥ E_taker` (default `0.30`) or `T < 2 minutes`
   - only if EV after taker impact is still positive

### 5.3 Fees + impact-aware EV gate

Map edge score into a probability forecast:

- `z = logit(clip(p, 0.01, 0.99))`
- `p_hat = sigmoid(z + m*E)` with `m=1.0` (calibrate in backtest)

Per-share EV for buys:

- Buy YES at expected fill `px_yes`:

  `EV_YES = p_hat - px_yes - fee(px_yes) - impact_buffer`

- Buy NO at expected fill `px_no`:

  `EV_NO = (1 - p_hat) - px_no - fee(px_no) - impact_buffer`

Trade only if `EV > EV_min` (default `EV_min = 0.003`, i.e., 0.3¢).

Impact buffer guidelines:

- maker: `0.25*spread + b_m*sigma` (start `b_m=0.002`)
- taker: `(vwap - best_price) + b_t*sigma` (start `b_t=0.004`)

### 5.4 Order management

- Cancel/replace if:
  - target changes by ≥ `2*q_step`, or
  - top-of-book moved away significantly, or
  - order age exceeds `order_ttl = 3s`

---

## 6) Pseudocode (Python-like)

> Notes:
> - Uses full book levels for VWAP impact.
> - Maintains `inv_yes`, `inv_no` (no shorting).
> - Uses consensus `p` derived from both books.

```python
import math
from collections import deque

def clip(x, lo, hi):
    return max(lo, min(hi, x))

def logit(p):
    p = clip(p, 0.01, 0.99)
    return math.log(p/(1-p))

def sigmoid(z):
    return 1/(1+math.exp(-z))

def gamma_weight(p):
    return 4*p*(1-p)  # peaks at 0.5

def walk_book_vwap(levels, qty):
    """levels: list[(price, size)] sorted best->worse"""
    rem = qty
    cost = 0.0
    for price, size in levels:
        take = min(rem, size)
        cost += take * price
        rem -= take
        if rem <= 1e-9:
            break
    filled = qty - rem
    if filled <= 0:
        return None, 0.0
    return cost/filled, filled

class FifteenMinPolymarketBot:
    def __init__(self, resolution_ts, fee_fn):
        self.resolution_ts = resolution_ts
        self.fee_fn = fee_fn  # fee_fn(price, qty, taker_bool) -> fee_notional

        # inventories (no shorting)
        self.inv_yes = 0.0
        self.inv_no  = 0.0

        # signal state
        self.tau = 0.5
        self.dbar = 0.0
        self.p_hist = deque(maxlen=5000)  # (ts, p)

        # defaults (tune)
        self.H_tau = 45.0
        self.H_d = 60.0
        self.W_chop_sec = 90

        self.T0 = 3.0
        self.theta_b = 1.5

        self.alpha, self.beta, self.gamma = 1.0, 0.6, 0.3
        self.d0, self.d1 = 0.015, 0.010

        self.c0 = 2.0
        self.sigma0 = 0.08

        self.k = 2.5
        self.m = 1.0

        self.Q_max = 600.0
        self.q_step = 10.0

        self.delta_min, self.delta0 = 0.003, 0.004
        self.lambda_s, self.lambda_c = 0.5, 0.002
        self.A_min = 0.15

        self.E_enter, self.E_exit = 0.18, 0.10
        self.E_taker = 0.30
        self.E_override = 0.35

        self.spread_max_entry = 0.025
        self.spread_halt = 0.04

        self.T_flat = 1.0

        self.rebalance_interval = 2.0
        self.cooldown = 2.0

        self.last_decision = 0.0
        self.last_fill = 0.0

    def theta(self, T_min):
        if T_min <= 0:
            return 0.0
        return (T_min/(T_min+self.T0))**self.theta_b

    def consensus_p(self, book_yes, book_no):
        bid_y, ask_y = book_yes["bid"], book_yes["ask"]
        bid_n, ask_n = book_no["bid"],  book_no["ask"]
        mid_y = 0.5*(bid_y + ask_y)
        mid_n = 0.5*(bid_n + ask_n)
        spread_y = ask_y - bid_y
        spread_n = ask_n - bid_n

        w_y = 1.0/(spread_y + 1e-6)
        w_n = 1.0/(spread_n + 1e-6)

        p_from_no = 1.0 - mid_n
        p = (w_y*mid_y + w_n*p_from_no)/(w_y+w_n)
        return p, spread_y, spread_n

    def compute_chop(self, now):
        start = now - self.W_chop_sec
        xs = [(t,p) for (t,p) in self.p_hist if t >= start]
        if len(xs) < 6:
            return 0.0, 0.0

        # crossing rate
        def sgn(x):
            return 1 if x>0 else (-1 if x<0 else 0)

        flips = 0
        prev = sgn(xs[0][1] - 0.5)
        for _, p in xs[1:]:
            cur = sgn(p - 0.5)
            if prev!=0 and cur!=0 and prev*cur==-1:
                flips += 1
            if cur!=0:
                prev = cur

        cross = flips / (self.W_chop_sec/60.0)  # flips/min

        # logit vol
        zs = [logit(p) for _, p in xs]
        rets = [zs[i]-zs[i-1] for i in range(1, len(zs))]
        mu = sum(rets)/len(rets)
        var = sum((r-mu)**2 for r in rets) / max(1, (len(rets)-1))
        sigma = math.sqrt(var)

        return cross, sigma

    def step(self, now, book_yes, book_no):
        # throttle
        if now - self.last_decision < self.rebalance_interval:
            return []
        if now - self.last_fill < self.cooldown:
            return []

        # consensus price and spreads
        p, spread_y, spread_n = self.consensus_p(book_yes, book_no)
        spread_c = min(spread_y, spread_n)
        d = p - 0.5

        # store price history
        self.p_hist.append((now, p))

        # update EW tau and dbar
        if len(self.p_hist) >= 2:
            dt = max(1e-3, self.p_hist[-1][0] - self.p_hist[-2][0])
        else:
            dt = 1.0

        w_tau = 1.0 - math.exp(-(math.log(2)/self.H_tau)*dt)
        w_d   = 1.0 - math.exp(-(math.log(2)/self.H_d)*dt)

        I = 1.0 if p > 0.5 else 0.0
        self.tau  = (1-w_tau)*self.tau + w_tau*I
        self.dbar = (1-w_d)*self.dbar + w_d*d

        A = 2*self.tau - 1.0

        # chop
        cross, sigma = self.compute_chop(now)
        chi = 1.0 / (1.0 + (cross/self.c0)**2 + (sigma/self.sigma0)**2)

        # time
        T_min = max(0.0, (self.resolution_ts - now)/60.0)
        th = self.theta(T_min)

        # deadband
        delta = max(self.delta_min, self.delta0 + self.lambda_s*spread_c + self.lambda_c*cross)

        if abs(d) < delta and abs(A) < self.A_min:
            E = 0.0
        else:
            E = th * chi * (
                self.alpha*A
                + self.beta*math.tanh(self.dbar/self.d0)
                + self.gamma*math.tanh(d/self.d1)
            )

        # hysteresis + time flatten
        if abs(E) < self.E_exit:
            E_eff = 0.0
        else:
            E_eff = E

        if T_min < self.T_flat and abs(E) < self.E_override:
            E_eff = 0.0

        # target
        q = self.inv_yes - self.inv_no
        q_star = self.Q_max * gamma_weight(p) * math.tanh(self.k * E_eff)

        # gray zone: no expansions
        if self.E_exit <= abs(E) < self.E_enter:
            if abs(q_star) > abs(q):
                q_star = q

        dq = q_star - q
        if abs(dq) < self.q_step:
            return []

        # spread gates
        if spread_c > self.spread_halt and abs(q_star) > abs(q):
            return []
        if spread_c > self.spread_max_entry and abs(q_star) > abs(q):
            return []

        # probability forecast
        p_hat = sigmoid(logit(p) + self.m*E_eff)

        # EV helpers using full book for taker impact
        def ev_buy_yes_taker(qty):
            vwap, filled = walk_book_vwap(book_yes["asks"], qty)
            if filled <= 0:
                return None
            fee_per = self.fee_fn(vwap, filled, True)/filled
            impact_buf = (vwap - book_yes["asks"][0][0]) + 0.004*sigma
            return p_hat - vwap - fee_per - impact_buf

        def ev_buy_no_taker(qty):
            vwap, filled = walk_book_vwap(book_no["asks"], qty)
            if filled <= 0:
                return None
            fee_per = self.fee_fn(vwap, filled, True)/filled
            impact_buf = (vwap - book_no["asks"][0][0]) + 0.004*sigma
            return (1-p_hat) - vwap - fee_per - impact_buf

        EV_min = 0.003
        orders = []

        # unwind-first execution policy
        if dq > 0:
            # need more YES exposure
            if self.inv_no > 0:
                qty = min(self.inv_no, abs(dq))
                orders.append({"type":"SELL_NO_MAKER", "qty":qty, "price":book_no["asks"][0][0]})
            else:
                qty = abs(dq)
                px = book_yes["bids"][0][0]  # best bid (maker)
                fee_per = self.fee_fn(px, qty, False)/qty
                impact_buf = 0.25*(book_yes["ask"]-book_yes["bid"]) + 0.002*sigma
                EV = p_hat - px - fee_per - impact_buf

                if EV > EV_min:
                    orders.append({"type":"BUY_YES_MAKER", "qty":qty, "price":px, "post_only":True})
                elif abs(E_eff) >= self.E_taker:
                    slice_qty = max(self.q_step, 0.2*qty)
                    EVt = ev_buy_yes_taker(slice_qty)
                    if EVt is not None and EVt > EV_min:
                        orders.append({"type":"BUY_YES_TAKER", "qty":slice_qty})

        else:
            # need more NO exposure
            if self.inv_yes > 0:
                qty = min(self.inv_yes, abs(dq))
                orders.append({"type":"SELL_YES_MAKER", "qty":qty, "price":book_yes["bids"][0][0]})
            else:
                qty = abs(dq)
                px = book_no["bids"][0][0]
                fee_per = self.fee_fn(px, qty, False)/qty
                impact_buf = 0.25*(book_no["ask"]-book_no["bid"]) + 0.002*sigma
                EV = (1-p_hat) - px - fee_per - impact_buf

                if EV > EV_min:
                    orders.append({"type":"BUY_NO_MAKER", "qty":qty, "price":px, "post_only":True})
                elif abs(E_eff) >= self.E_taker:
                    slice_qty = max(self.q_step, 0.2*qty)
                    EVt = ev_buy_no_taker(slice_qty)
                    if EVt is not None and EVt > EV_min:
                        orders.append({"type":"BUY_NO_TAKER", "qty":slice_qty})

        self.last_decision = now
        return orders
```

---

## Default parameter block (15-minute markets)

- Time-above EW half-life: `Hτ = 45s`
- Displacement EW half-life: `Hd = 60s`
- Chop window: `W_chop = 90s`

- Theta scaler: `T0=3.0m`, `b=1.5`
- Flatten: `T_flat = 1.0m`, override: `E_override = 0.35`

- Hysteresis: `E_enter=0.18`, `E_exit=0.10`, taker threshold `E_taker=0.30`

- Deadband: `δmin=0.003`, `δ0=0.004`, `λs=0.5`, `λc=0.002`, `A_min=0.15`

- Liquidity gates: `spread_max_entry=0.025`, `spread_halt=0.04`

- Throttles: `rebalance_interval=2s`, `cooldown=2s`, `q_step=10`

---

## Backtesting checklist (minimum viable)

1. Event-driven replay with order submission timestamps.
2. Maker fill model with queue assumptions (optimistic/pessimistic bands).
3. Taker fills using book-walk VWAP.
4. Fees implemented via your exact `fee_fn`.
5. Latency simulation (e.g., 200–500ms) and rate limits.
6. Walk-forward tuning: optimize net PnL after fees, turnover, drawdown.

