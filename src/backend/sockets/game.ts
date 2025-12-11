import { Server, Socket } from "socket.io";
import db from "../db/connection";
import { GameLogic } from "../services/game-logic";

export function initGameSockets(io: Server, socket: Socket) {
  // Join a game room
  socket.on("game:join-room", async ({ gameId }) => {
    socket.join(`game:${gameId}`);
    console.log(`Socket ${socket.id} joined game room ${gameId}`);
  });

  // Leave a game room
  socket.on("game:leave-room", async ({ gameId }) => {
    socket.leave(`game:${gameId}`);
    console.log(`Socket ${socket.id} left game room ${gameId}`);
  });

  // Request game state
  socket.on("game:request-state", async ({ gameId, userId }) => {
    try {
      const gameState = await GameLogic.getGameState(gameId);
      const playerHand = await GameLogic.getPlayerHand(gameId, userId);
      
      socket.emit("game:state-update", { gameState, playerHand });
    } catch (error: any) {
      socket.emit("game:error", { message: error.message });
    }
  });

  // Draw from deck
  socket.on("game:draw-deck", async ({ gameId, userId }) => {
    try {
      const card = await GameLogic.drawFromDeck(gameId, userId);
      const playerHand = await GameLogic.getPlayerHand(gameId, userId);
      
      // Send card to the player
      socket.emit("game:card-drawn", { card, playerHand });
      
      // Notify others in the room
      socket.to(`game:${gameId}`).emit("game:player-drew", { 
        userId, 
        source: "deck" 
      });
    } catch (error: any) {
      socket.emit("game:error", { message: error.message });
    }
  });

  // Draw from discard
  socket.on("game:draw-discard", async ({ gameId, userId }) => {
    try {
      const card = await GameLogic.drawFromDiscard(gameId, userId);
      const playerHand = await GameLogic.getPlayerHand(gameId, userId);
      
      // Send card to the player
      socket.emit("game:card-drawn", { card, playerHand });
      
      // Notify others in the room with the card
      socket.to(`game:${gameId}`).emit("game:player-drew", { 
        userId, 
        source: "discard",
        card 
      });
    } catch (error: any) {
      socket.emit("game:error", { message: error.message });
    }
  });

  // Discard a card
  socket.on("game:discard", async ({ gameId, userId, cardId }) => {
    try {
      await GameLogic.discardCard(gameId, userId, cardId);
      const gameState = await GameLogic.getGameState(gameId);
      const playerHand = await GameLogic.getPlayerHand(gameId, userId);
      
      // Update the player who discarded
      socket.emit("game:discard-success", { playerHand });
      
      // Notify all players in the room
      io.to(`game:${gameId}`).emit("game:state-update", { gameState });
    } catch (error: any) {
      socket.emit("game:error", { message: error.message });
    }
  });

  // Declare winner
  socket.on("game:declare", async ({ gameId, userId }) => {
    try {
      await GameLogic.declareWinner(gameId, userId);
      const gameState = await GameLogic.getGameState(gameId);
      
      // Notify all players
      io.to(`game:${gameId}`).emit("game:winner", { 
        winnerId: userId,
        gameState 
      });
    } catch (error: any) {
      socket.emit("game:error", { message: error.message });
    }
  });

  // Restart game (server-side emit only; REST endpoint performs actual reset)
  socket.on("game:restart", async (data: { gameId: number; userId: number }) => {
    const { gameId, userId } = data;
    if (!gameId || !userId) return;

    // Lightweight guard: ensure user is part of the game
    const players = await db.manyOrNone<{ user_id: number }>(
      `SELECT user_id FROM game_players WHERE game_id = $1 ORDER BY hand_order`,
      [gameId]
    );
    if (!players.length || !players.some(p => p.user_id === userId)) return;

    // Re-initialize with current players
    await GameLogic.initializeGame(gameId, players.map(p => p.user_id));
    io.to(`game:${gameId}`).emit("game:restart", { gameId });
  });
}
