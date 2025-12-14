import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initGameServer, getGameServer } from "./gameServer";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  initGameServer(httpServer);

  app.get("/api/game/status", (req, res) => {
    const gameServer = getGameServer();
    res.json({
      playerCount: gameServer?.getPlayerCount() || 0,
      maxPlayers: 15,
      status: "running"
    });
  });

  return httpServer;
}
