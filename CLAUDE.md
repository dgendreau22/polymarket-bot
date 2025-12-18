# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `Bot.ts` - Core bot class with state machine (running/paused/stopped), price fetching, and trade execution
- `BotManager.ts` - Singleton orchestrating bot lifecycle, persistence, and trade execution. Uses `globalThis` for Next.js hot reload persistence
- `DryRunExecutor.ts` - Simulates trades without real execution (for testing)
- `LiveExecutor.ts` - Executes real trades via ClobClient
- `types.ts` - Type definitions for BotConfig, BotInstance, Trade, StrategySignal, etc.

**`src/lib/strategies/`** - Strategy System:
- `StrategyLoader.ts` - Parses markdown strategy files from `src/strategies/*.md` on-demand (no caching)
- `registry.ts` - Maps strategy slugs to `IStrategyExecutor` implementations. Executors loaded once at server startup
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

**`src/strategies/`** - Strategy Definition Files (Markdown):
- `test-oscillator.md` - Simple buy/sell oscillator for testing
- `market-maker.md` - Market making strategy
- `arbitrage.md` - Arbitrage detection strategy

Each `.md` file contains: frontmatter (name, version, author), description, algorithm, parameters table, risk management rules.

### API Routes

**Bot Management:**
- `GET /api/bots` - List all bots (filters: `state`, `mode`, `strategy`)
- `POST /api/bots` - Create bot (body: `name`, `strategySlug`, `marketId`, `marketName`, `assetId`, `mode`, `strategyConfig`)
- `GET /api/bots/[id]` - Get bot details
- `DELETE /api/bots/[id]` - Delete stopped bot
- `POST /api/bots/[id]/start` - Start bot
- `POST /api/bots/[id]/stop` - Stop bot
- `POST /api/bots/[id]/pause` - Pause bot
- `POST /api/bots/[id]/resume` - Resume paused bot

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
- `/strategies/[slug]` - Strategy detail page with active bots, stats, parameters, recent trades (sticky header, scrollable)
- `/market/[id]` - Market detail with create bot button (pre-fills market)

### Components

**`src/components/bots/`:**
- `BotCard.tsx` - Bot card with state controls, delete button, market link
- `BotList.tsx` - Grid of BotCards
- `BotCreateModal.tsx` - Modal for creating bots with strategy/market defaults

**`src/components/trades/`:**
- `TradesTable.tsx` - Trade history table with sticky header, bot name via JOIN

### Database

SQLite database stored at `data/polymarket-bot.db` (or `DATABASE_PATH` env var).

**Tables:**
- `bots` - Bot configurations and state
- `trades` - Trade history with PnL tracking
- `positions` - Bot positions

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
