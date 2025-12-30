# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Requirements

### Objective

Generate consistent revenue from crypto markets by extracting value from market inefficiencies. The system connects to market APIs and automates trading by sending buy and sell orders. Currently targeted at prediction markets (Polymarket).

### Target Audience

Small proprietary trading businesses seeking automated trading solutions for prediction markets.

### User Stories

- **Market Discovery**: As a trader, I want to browse, search, and scan for potential markets so that I can identify trading opportunities.
- **Bot Creation**: As a trader, I want to create bots using specialized strategies (arbitrage, market making, trend trading, etc.) on specific markets so that I can automate my trading.
- **Monitoring**: As a trader, I want to track and monitor the progress of all my bots in real-time so that I can ensure they are performing as expected.
- **Analytics**: As a trader, I want statistics to be tracked and analyzed so that I can improve bot performance over time.

## Commands

```bash
npm run dev      # Start development server at http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Architecture

Next.js 16 App Router application with React 19, TypeScript, Tailwind CSS v4, and shadcn/ui. This is a Polymarket trading bot with a dashboard UI and bot testing framework.

### Core Modules

**`src/lib/polymarket/`** - Polymarket SDK integration:
- `client.ts` - SDK initialization with GammaSDK (market data, no auth) and ClobClient (trading, requires auth)
- `websocket.ts` - `PolymarketWebSocket` class for real-time order book and price streaming with auto-reconnect
- `types.ts` - Type definitions for markets, orders, positions, and strategy configs

**`src/lib/bots/`** - Bot Testing Framework:
- `Bot.ts` - Core bot class with state machine (running/paused/stopped), fetches prices directly from CLOB API, WebSocket subscriptions for real-time price/order book updates, infers tick size from order book prices, exposes `getOrderBook()` for marketable order detection
- `BotManager.ts` - Singleton orchestrating bot lifecycle, persistence, and trade execution. Uses `globalThis` for Next.js hot reload persistence. `updateBotPosition()` syncs in-memory state with database
- `DryRunExecutor.ts` - Simulates trades without real execution (for testing). `getMarketableFillPrice()` detects orders that cross the spread and fills them immediately at creation
- `LimitOrderMatcher.ts` - Processes trades to fill limit orders. `fillMarketableOrders()` checks pending orders against order book each execution cycle to fill orders that become marketable
- `LiveExecutor.ts` - Executes real trades via ClobClient
- `types.ts` - Type definitions for BotConfig, BotInstance, Trade, StrategySignal, FillResult, etc.

**`src/lib/strategies/`** - Strategy System:
- `StrategyLoader.ts` - Parses markdown strategy files from `src/strategies/*.md` on-demand (no caching)
- `registry.ts` - Maps strategy slugs to `IStrategyExecutor` implementations. Executors use `roundToTick()` to ensure order prices match market tick size precision
- `market-maker.ts` - MarketMaker class for bid/ask liquidity
- `arbitrage.ts` - ArbitrageDetector for YES/NO mispricing

**Strategy Architecture:**
| Component | Purpose | When Loaded |
|-----------|---------|-------------|
| `.md` files | Documentation (name, params, description) | Every API request |
| `registry.ts` executors | Actual trading logic | Server startup (cached) |

The **slug** (filename without `.md`) links documentation to executors.

**`src/lib/persistence/`** - SQLite Persistence:
- `database.ts` - SQLite connection via better-sqlite3. Uses `globalThis` singleton for Next.js hot reload persistence
- `schema.ts` - Database schema with migrations (bots, trades, positions tables)
- `BotRepository.ts` - Bot CRUD operations, converts between BotRow and BotConfig
- `TradeRepository.ts` - Trade history with statistics, uses JOIN for bot names
- `LimitOrderRepository.ts` - Limit order CRUD, `getOpenOrdersByBotId()` and `getOpenOrdersByAssetId()` for order queries

**`src/strategies/`** - Strategy Definition Files (Markdown):
- `test-oscillator.md` - Simple buy/sell oscillator for testing
- `market-maker.md` - Market making strategy
- `arbitrage.md` - Arbitrage detection strategy

Each `.md` file contains: frontmatter (name, version, author), description, algorithm, parameters table, risk management rules.

### API Routes

**Bot Management:**
- `GET /api/bots` - List all bots (filters: `state`, `mode`, `strategy`)
- `POST /api/bots` - Create bot (auto-fetches assetId from Gamma API if not provided)
- `GET /api/bots/[id]` - Get bot details
- `DELETE /api/bots/[id]` - Delete stopped bot
- `POST /api/bots/[id]/start` - Start bot
- `POST /api/bots/[id]/stop` - Stop bot
- `POST /api/bots/[id]/pause` - Pause bot
- `POST /api/bots/[id]/resume` - Resume paused bot
- `GET /api/bots/[id]/orders` - Get pending orders for bot
- `DELETE /api/bots/[id]/orders` - Cancel all pending orders
- `POST /api/bots/[id]/close-position` - Close position with market order (dry-run: sells at best bid)

**Strategies:**
- `GET /api/strategies` - List all strategies with stats
- `GET /api/strategies/[slug]` - Strategy details with bots and trades

**Markets & Trading:**
- `GET /api/markets` - Fetch active markets (params: `limit`, `active`)
- `GET /api/markets/[id]` - Market details
- `GET /api/markets/search` - Search markets
- `GET /api/orderbook` - Order book data for price fetching
- `GET /api/trades` - Trade history (filters: `botId`, `strategySlug`, `limit`)
- `GET /api/positions` - Connected account positions

**Legacy:**
- `GET /api/bot/status` - Bot status including portfolio balance

### UI Pages

- `/dashboard` - Main dashboard with bot overview, active positions section
- `/bots/[id]` - Bot detail page with real-time market data and pending orders (side-by-side layout)
- `/strategies/[slug]` - Strategy detail page with active bots, stats, parameters, recent trades (sticky header, scrollable)
- `/market/[id]` - Market detail with create bot button (pre-fills market)

### Bot Detail Page Features (`/bots/[id]`)

**Market Data Panel:**
- Best bid/ask prices with spread calculation
- Last trade price with side indicator (BUY/SELL)
- Live order book (top 10 levels) with pending order highlighting
- WebSocket connection status indicator

**Order Book Highlighting:**
- Pending BUY orders highlight only the bid side cells (left columns)
- Pending SELL orders highlight only the ask side cells (right columns)
- Blue CircleDot indicator shows which price levels have pending orders

**Pending Orders Panel:**
- Lists all active limit orders with side, outcome, price, quantity, fill status
- Cancel All button to remove all pending orders
- Prices formatted to match market tick size precision

**Current Position Panel:**
- Shows current position size, average entry price, outcome (YES/NO)
- Real-time unrealized PnL based on mid-market price
- Close Position button to exit with market sell order (dry-run mode)
- Position synced between database and in-memory bot state

**Price Precision:**
- Tick size inferred from order book prices when `tick_size_change` events aren't available
- All prices (order book, pending orders, signals) formatted to match market precision
- `formatPrice()` helper uses tick size to determine decimal places

### Limit Order Matching

**Marketable Order Detection:**
- BUY orders at or above best ask fill immediately at creation
- SELL orders at or below best bid fill immediately at creation
- `getMarketableFillPrice()` in DryRunExecutor checks spread crossing

**Pending Order Fills:**
- `fillMarketableOrders()` runs each execution cycle to check pending orders
- Orders that become marketable due to market movement fill automatically
- Fills update position, create trade records, and calculate PnL

### Components

**`src/components/bots/`:**
- `BotCard.tsx` - Bot card with state controls, delete button, market link
- `BotList.tsx` - Grid of BotCards
- `BotCreateModal.tsx` - Modal for creating bots with strategy/market defaults

**`src/components/trades/`:**
- `TradesTable.tsx` - Trade history table with sticky header, bot name via JOIN, trade aggregation (consecutive same-side trades collapsed into expandable rows)

### Database

SQLite database stored at `data/polymarket-bot.db` (or `DATABASE_PATH` env var).

**Tables:**
- `bots` - Bot configurations and state
- `trades` - Trade history with PnL tracking
- `positions` - Bot positions
- `limit_orders` - Pending limit orders with fill status

### Environment Variables

Required for trading operations (not needed for market data):
```
POLYMARKET_PRIVATE_KEY      # Wallet private key
POLYMARKET_FUNDER_ADDRESS   # Wallet address for trades
POLYMARKET_CHAIN_ID         # Default: 137 (Polygon)
POLYMARKET_CLOB_HOST        # Default: https://clob.polymarket.com
POLYMARKET_GAMMA_HOST       # Default: https://gamma-api.polymarket.com
DATABASE_PATH               # Optional: SQLite database path
```

### Key Dependencies

- `@hk/polymarket` (GammaSDK) - Market data fetching
- `@polymarket/clob-client` - Order execution and account management
- `better-sqlite3` - SQLite database
- `gray-matter` - Markdown frontmatter parsing
- `date-fns` - Date formatting
- `uuid` - ID generation
- shadcn/ui with Lucide icons

**Import alias:** `@/*` maps to `./src/*`
