# Orbit Arena

## Overview

Orbit Arena is a real-time multiplayer combat browser game where players control character shapes in an arena, collect HP/Charge pickups, and use abilities to damage and eliminate opponents. The game features two modes:
- **Free Mode**: Casual play with instant join/leave
- **Stake Mode**: Tournament-based rounds with USDC entry fees and prize payouts via Solana/Phantom wallet

The application uses a React frontend with canvas-based game rendering, an Express backend with WebSocket support for real-time multiplayer synchronization, and PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing (Lobby → Game pages)
- **UI Components**: shadcn/ui component library built on Radix UI primitives with Tailwind CSS
- **Game Engine**: Custom canvas-based `GameEngine` class handling rendering, physics, and WebSocket communication
- **State Management**: React Query for server state, local React state for UI
- **Mobile Support**: Touch joystick component for mobile controls using react-joystick-component

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Real-time Communication**: Native WebSocket server (ws library) attached to HTTP server for game state synchronization
- **Game Logic**: Server-authoritative game loop managing player positions, collisions, food spawning, and eliminations
- **Build System**: esbuild for server bundling, Vite for client bundling

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema**: 
  - `users`: Basic user accounts (id, username, password)
  - `player_balances`: Internal custodial balances (walletAddress, availableCents, lockedCents, lifetime stats)
  - `balance_transactions`: Transaction ledger with unique externalRef for idempotency
- **In-Memory State**: Game state (players, food, pending deposits) stored in memory on the server for real-time performance
- **Session Storage**: MemStorage class for user sessions (can be upgraded to PostgreSQL)

### Blockchain Layer (Mainnet-Ready)
Server-side Solana utility in `server/solana.ts`:
- Network driven by `SOLANA_NETWORK` env var (default: `mainnet-beta`)
- RPC driven by `SOLANA_RPC_URL` env var (falls back to public endpoint)
- USDC mint auto-selected per network (mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- `verifyUSDCDeposit()`: verifies on-chain USDC tx before crediting balance
- `executeUSDCWithdrawal()`: signs real USDC transfers from platform wallet using `PLATFORM_WALLET_PRIVATE_KEY`
- Client fetches network config from `/api/config` on mount (no hardcoded addresses)

**Required secrets for stake mode:**
- `PLATFORM_WALLET_ADDRESS` — public key of the platform wallet (already set)
- `PLATFORM_WALLET_PRIVATE_KEY` — JSON array of 64 bytes for signing withdrawals
- `SOLANA_RPC_URL` — reliable mainnet RPC URL (e.g. Helius, QuickNode)

### Internal Custodial Balance System
The game uses an off-chain balance ledger for stake mode:

**Architecture:**
- Players deposit USDC to their internal game balance (verified on-chain before crediting)
- Match entry fees are locked from internal balance (no on-chain tx during play)
- Prizes are credited to internal balance
- Players withdraw from internal balance (triggers real on-chain USDC transfer)

**Key Components:**
- `BalanceService`: Handles deposits, locks, payouts, withdrawals with atomic DB transactions
- `player_balances` table: Tracks available + locked cents per wallet
- `balance_transactions` table: Immutable ledger with idempotency via unique externalRef

**Security Features:**
- Server-generated deposit tokens (production would verify on-chain tx)
- Unique constraint on externalRef prevents double-crediting
- Lock verification before settlement (can't debit more than locked)
- Platform revenue tracked separately

**Production Requirements:**
- Deposit confirmation should verify on-chain transaction signatures
- Withdrawal should trigger actual on-chain USDC transfer
- Consider adding admin authentication for deposit endpoints

### Game Architecture
- **World Size**: 4000x4000 pixel arena
- **Network Model**: Server sends authoritative state updates; clients send input vectors
- **Message Types**: JOIN, INPUT, LEAVE, ABILITY (client); STATE, JOINED, ELIMINATED, PLAYER_LEFT, ERROR, ROUND_STATUS, ROUND_END, PICKUP_DELTA, DAMAGE, ABILITY_EFFECT (server)
- **Escrow Service**: Server-side balance tracking for stake mode with deposit/payout/refund operations

### Combat System
- **HP System**: Players start with 100 HP (max 200). HP determines player size (radius = 20 + √hp × 1.5). Death occurs at 0 HP.
- **Charge System**: Players start with 0 charge (max 100). Charge is used to power abilities.
- **Pickups**: Two types spawn in arena:
  - **HP Pickups** (red with cross): Restore 5 HP
  - **Charge Pickups** (blue with lightning): Add 5 charge
- **Character Shapes**: Players choose from 3 shapes with unique abilities:
  - **Circle**: Pull (40 charge) - pulls nearby enemies toward you; Slam (40 charge) - area damage around you
  - **Triangle**: Dash (40 charge) - quick forward dash; Pierce (40 charge) - projectile attack in facing direction
  - **Square**: Push (40 charge) - pushes nearby enemies away; Stun Wave (40 charge) - stuns enemies in area
- **Scoring**: 1 point per kill (used for leaderboard ranking)

### Stake Mode Tournament System

Stake mode uses a round-based tournament structure (StakeGameRoom class):

**Round States:**
- `LOBBY`: Waiting for 15 players, shows player count and prize pool
- `COUNTDOWN`: 3-second countdown after lobby fills (resets if anyone leaves)
- `PLAYING`: 2-minute active game round
- `ENDED`: Shows standings and payouts, then resets to LOBBY

**Entry & Prize Pool:**
- $1 USDC entry fee per player
- $0.10 platform fee (kept by platform)
- $0.90 per player goes to prize pool
- Prize pool = numberOfPlayers × $0.90 = $13.50 for 15 players

**Payouts (Fixed Amounts):**
- 1st Place: $4.00
- 2nd Place: $3.00
- 3rd Place: $2.00

**Key Rules:**
- Round lasts 3 minutes OR ends when only 1 player remains
- No mid-round joining - players must wait for next round
- Death converts to spectator mode (can watch but not play)
- No re-entry after elimination
- No player-to-player balance transfers
- All scoring is deterministic (based on kills)

### Admin Panel Security

The admin panel uses a secure server-side authentication system:

**Authentication:**
- Password hashed with bcrypt (12 salt rounds) before storage in PostgreSQL
- Minimum 8-character password required
- Session tokens: 256-bit cryptographically random, stored in database with 24-hour expiry
- All admin endpoints require valid `X-Admin-Token` header

**Protection Measures:**
- Rate limiting: 5 login attempts max, then 15-minute IP-based lockout
- Setup bypass prevention: Can't set new password if one already exists
- Log masking: Wallet addresses automatically masked in server logs (first4****last4)
- Session invalidation on logout

**Database Tables:**
- `admin_auth`: Stores bcrypt password hash
- `admin_sessions`: Active session tokens with expiry timestamps
- `banned_wallets`: Wallet ban list with reasons
- `admin_settings`: Key-value settings (leaderboard frozen, etc.)
- `win_streaks`: Player win streak tracking for alert system

**Protected Endpoints:**
- All `/api/admin/*` endpoints except `/auth/status`, `/auth/setup`, `/auth/login`

### Blockchain Integration
- **Network**: Solana Devnet
- **Wallet**: Phantom wallet integration for authentication and transactions
- **Token**: USDC (SPL token) for entry fees and rewards
- **Entry Fee**: 1 USDC to join stake mode

## External Dependencies

### Third-Party Services
- **Solana Blockchain**: Devnet cluster for cryptocurrency transactions
- **Phantom Wallet**: Browser extension for Solana wallet connectivity

### Key Libraries
- **@solana/web3.js & @solana/spl-token**: Solana blockchain interaction and SPL token operations
- **ws**: WebSocket server for real-time multiplayer
- **drizzle-orm**: TypeScript ORM for PostgreSQL
- **@tanstack/react-query**: Server state management
- **Radix UI**: Accessible UI component primitives
- **Tailwind CSS v4**: Utility-first CSS framework

### Database
- **PostgreSQL**: Primary database (requires DATABASE_URL environment variable)
- **Drizzle Kit**: Database migrations and schema management

### Development Tools
- **Vite**: Frontend dev server with HMR
- **esbuild**: Server bundling for production
- **TypeScript**: Type safety across full stack
