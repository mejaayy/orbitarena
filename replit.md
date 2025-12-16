# Orbit Arena

## Overview

Orbit Arena is a real-time multiplayer browser game similar to agar.io, where players control circular avatars in an arena, consume food to grow, and eliminate smaller players. The game features two modes:
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

### Internal Custodial Balance System
The game uses an off-chain balance ledger for stake mode:

**Architecture:**
- Players deposit USDC to their internal game balance
- Match entry fees are locked from internal balance (no on-chain tx during play)
- Prizes are credited to internal balance
- Players withdraw from internal balance when desired

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
- **Network Model**: Server-authoritative with client-side prediction and reconciliation
- **Server Tick Rate**: 60 Hz for precise physics and collision detection
- **Message Types**: JOIN, INPUT (with sequence number), LEAVE (client); STATE (with timestamp and per-player lastInputSeq), JOINED, ELIMINATED, PLAYER_LEFT, ERROR, ROUND_STATUS, ROUND_END (server)
- **Escrow Service**: Server-side balance tracking for stake mode with deposit/payout/refund operations

### Network Reconciliation System
The game uses a sophisticated reconciliation system for smooth, accurate competitive gameplay:

**Server-Side:**
- Tracks lastInputSeq per player to acknowledge processed inputs
- Includes timestamp and sequence numbers in STATE broadcasts
- 60 Hz tick rate ensures precise position updates

**Client-Side:**
- **Input Buffering**: Stores sent inputs with sequence numbers for replay
- **Snapshot Buffering**: Maintains 8 recent server states for interpolation
- **Rewind/Replay**: On each server update, filters to unacknowledged inputs, then replays them from server position to get predicted position
- **Smooth Correction**: < 30px drift uses gentle lerp; >= 30px snaps to prevent desync

**Remote Player Interpolation:**
- Uses 50ms render delay for buffer stability
- Cubic smoothing (t²(3-2t)) between snapshot pairs
- Defaults to newest snapshot pair when render time exceeds buffer

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
- 1st Place: $6.00
- 2nd Place: $4.50
- 3rd Place: $3.00

**Key Rules:**
- No mid-round joining - players must wait for next round
- Death converts to spectator mode (can watch but not play)
- No re-entry after elimination
- No player-to-player balance transfers
- All scoring is deterministic (based on points from eating food/players)

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
