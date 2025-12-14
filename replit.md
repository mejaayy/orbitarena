# Orbit Arena

## Overview

Orbit Arena is a real-time multiplayer browser game similar to agar.io, where players control circular avatars in an arena, consume food to grow, and eliminate smaller players. The game features an optional "stake mode" that integrates with Solana blockchain via Phantom wallet for USDC-based entry fees and rewards.

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
- **Schema**: Currently minimal - users table with id, username, password
- **In-Memory State**: Game state (players, food, escrows) stored in memory on the server for real-time performance
- **Session Storage**: MemStorage class for user sessions (can be upgraded to PostgreSQL)

### Game Architecture
- **World Size**: 4000x4000 pixel arena
- **Network Model**: Server sends authoritative state updates; clients send input vectors
- **Message Types**: JOIN, INPUT, LEAVE (client); STATE, JOINED, ELIMINATED, PLAYER_LEFT, ERROR (server)
- **Escrow Service**: Server-side balance tracking for stake mode with deposit/transfer/withdraw operations

### Blockchain Integration
- **Network**: Solana Devnet
- **Wallet**: Phantom wallet integration for authentication and transactions
- **Token**: USDC (SPL token) for entry fees and rewards
- **Entry Fee**: 1 USDC to join stake mode
- **Exit Fee**: 10% platform fee on withdrawals

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