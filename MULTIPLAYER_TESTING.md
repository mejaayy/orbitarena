# Orbit Arena - Multiplayer Testing Guide

## Testing Real-Time Multiplayer

This game features true online multiplayer using WebSockets. Players on different devices and networks can see and interact with each other in real-time.

### Quick Test (Same Computer)

1. **Open two browser windows** (or tabs)
   - Navigate to the game URL in both
   - Position them side-by-side so you can see both

2. **Join the game in each window**
   - Enter a different nickname in each window
   - Click "Enter Arena" in both
   - You should see both players appear on each screen

3. **Test movement**
   - Move your mouse in one window - that player should move
   - The other window should show that player moving in real-time

4. **Test eliminations**
   - Grow one player by eating food
   - Have the larger player consume the smaller one
   - The eliminated player should see the "Eliminated" dialog

### Testing on Different Devices

1. **Get the game URL**
   - Copy the URL from your browser's address bar
   - The URL should look like: `https://your-repl-name.replit.app`

2. **Open on a second device**
   - Phone, tablet, or another computer
   - Make sure both devices are connected to the internet
   - The devices do NOT need to be on the same network

3. **Join and play**
   - Both devices should see each other's players
   - Movement is synchronized across devices
   - Eliminations work across devices

### Testing Stake Mode (Devnet USDC)

**Prerequisites:**
- Install Phantom wallet browser extension
- Switch Phantom to Devnet (Settings > Developer Settings > Devnet)
- Get Devnet USDC from a faucet

**Steps:**
1. Enable "Stake Mode" toggle in the lobby
2. Connect your Phantom wallet when prompted
3. Each player starts with 1 USDC balance
4. When you eliminate another player, you receive 1 USDC from them
5. To exit, hold the "Leave" button for 3 seconds
6. On exit, 10% fee is deducted, 90% returned to you
7. You cannot exit during or within 3 seconds of combat

### Verifying Server-Authoritative Gameplay

The server controls all game logic:
- **Movement**: Server validates and applies all position updates
- **Collisions**: Server detects player-vs-player and player-vs-food collisions
- **Eliminations**: Server determines who gets eliminated and handles transfers
- **Food spawning**: Server generates and manages all food items

This prevents cheating since clients only send input vectors, not positions.

### Server Status

- Check `/api/game/status` for current player count
- Maximum 15 players per server
- Players can join and leave at any time
- Game runs continuously (no rounds or match end)

### Troubleshooting

**Players not seeing each other:**
- Refresh both browsers
- Check browser console for WebSocket errors
- Ensure you're connected to the internet

**Lag or delayed movement:**
- This is normal over long distances
- Server updates at 30Hz for optimal performance

**Cannot connect:**
- Make sure the server is running (check workflow status)
- Try refreshing the page
