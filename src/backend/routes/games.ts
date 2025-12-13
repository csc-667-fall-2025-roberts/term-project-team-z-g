import express from "express";
import createHttpError from "http-errors";
import { Games } from "../db";
import { GameLogic } from "../services/game-logic";
import db from "../db/connection";

const router = express.Router();

// GET /games – list all games
router.get("/", async (req, res, next) => {
  try {
    const session: any = (req as any).session;
    const games = await Games.list();
    
    // If user is logged in, check which games they're already in
    if (session?.user) {
      const userGameIds = await db.manyOrNone<{ game_id: number }>(
        "SELECT game_id FROM game_players WHERE user_id = $1",
        [session.user.id]
      );
      const userGameIdSet = new Set(userGameIds.map(row => row.game_id));
      
      // Add 'user_in_game' flag to each game
      games.forEach((game: any) => {
        game.user_in_game = userGameIdSet.has(game.id);
      });
    }
    
    res.json(games);
  } catch (err) {
    next(err);
  }
});

// POST /games – create a new game
router.post("/", async (req, res, next) => {
  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { name, max_players } = req.body;
    const gameName = name || "Game";
    const maxPlayers = max_players ? Number(max_players) : 4;

    const game = await Games.create(session.user.id, gameName, maxPlayers);
    // auto-join creator
    await Games.join(game.id, session.user.id);
    const io = req.app.get("io");
    
    if (io) {
      io.emit("game:created", { game });
    }
    
    res.status(201).json(game);
  } catch (err) {
    next(err);
  }
});

// GET /games/:id – show single game
router.get("/:id", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const game = await Games.get(gameId);

    if (!game) {
      return next(createHttpError(404, "Game not found"));
    }

    const session: any = (req as any).session;
    let gameFullError = false;

    // If the game is already finished, send users straight to the results page
    if (game.state === "finished") {
      if (req.accepts(["html", "json"]) && req.accepts("html")) {
        return res.redirect(`/games/${gameId}/results`);
      }
      return res.json({ state: game.state, redirect: `/games/${gameId}/results` });
    }
    
    // Auto-join the current user if not already in the game and game is not full
    if (session?.user) {
      try {
        // Check player count
        const playerCount = await db.one<{ count: string }>(
          `SELECT COUNT(*) as count FROM game_players WHERE game_id = $1`,
          [gameId]
        );
        const currentCount = Number(playerCount.count);
        
        // Check if user is already in the game
        const userInGame = await db.oneOrNone(
          `SELECT 1 FROM game_players WHERE game_id = $1 AND user_id = $2`,
          [gameId, session.user.id]
        );
        
        // Only join if there's room and user is not already in the game
        if (!userInGame && currentCount < game.max_players) {
          await Games.join(gameId, session.user.id);
        } else if (!userInGame && currentCount >= game.max_players) {
          // Game is full and user is not in it
          gameFullError = true;
        }
      } catch (err) {
        // Silently ignore "already joined" errors
        console.log(`User ${session.user.id} join attempt for game ${gameId}:`, (err as any).message);
      }
    }
    
    // If the game is full and the user is not in it, block access entirely
    if (gameFullError) {
      // JSON (for API callers)
      if (req.accepts(["json"])) {
        return res.status(403).json({ error: "Game is full" });
      }
      // HTML response
      return res
        .status(403)
        .render("error/error", {
          status: 403,
          message: "Game is full. You cannot join this game.",
          stack: undefined,
        });
    }

    const gameState = await GameLogic.getGameState(gameId);
    const playerHand = session?.user ? await GameLogic.getPlayerHand(gameId, session.user.id) : [];
    const myLaidCards = session?.user ? await db.manyOrNone(
      `SELECT id, suit, rank FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'laid' 
       ORDER BY position`,
      [gameId, session.user.id]
    ) : [];

    return res.render("games/game", { 
      game, 
      gameState,
      playerHand,
      currentUser: session?.user,
      gameFullError
    });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/join – join a game
router.post("/:id/join", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if game exists and get its details
    const game = await Games.get(gameId);
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Check if game is full
    const playerCount = await db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM game_players WHERE game_id = $1`,
      [gameId]
    );
    const currentCount = Number(playerCount.count);

    if (currentCount >= game.max_players) {
      return res.status(400).json({ error: "Game is full" });
    }

    await Games.join(gameId, session.user.id);
    const io = req.app.get("io");
    
    if (io) {
      io.emit("game:joined", { gameId, userId: session.user.id });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/start – start the game
router.post("/:id/start", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = session.user.id;

    // Don't re-initialize if already started
    const existingGame = await Games.get(gameId);
    if (!existingGame) {
      return next(createHttpError(404, "Game not found"));
    }
    if (existingGame.state !== "waiting") {
      return res.status(400).json({ error: "Game already started" });
    }

    // Get all players in the game
    // game_players uses column user_id; alias it to player_id for game logic
    const players = await db.manyOrNone(
      `SELECT user_id AS player_id FROM game_players 
       WHERE game_id = $1 
       ORDER BY joined_at`,
      [gameId]
    );

    // Check that player count matches max_players
    if (players.length !== existingGame.max_players) {
      return res.status(400).json({ 
        error: `Game requires ${existingGame.max_players} players to start. Currently ${players.length}/${existingGame.max_players}.` 
      });
    }

    // Ensure the creator/current user is part of the game
    const playerIds = players.map((p: any) => p.player_id);
    if (!playerIds.includes(userId)) {
      await Games.join(gameId, userId);
      playerIds.push(userId);
    }

    if (playerIds.length === 0) {
      return res.status(400).json({ error: "No players joined this game" });
    }
    
    try {
      await GameLogic.initializeGame(gameId, playerIds);
    } catch (e: any) {
      console.error("/games/:id/start initialize error", { gameId, playerIds, error: e });
      return res.status(500).json({ error: e?.message || "Failed to start game" });
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("game:started", { gameId });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("/games/:id/start error", err);
    res.status(500).json({ error: err?.message || "Failed to start game" });
  }
});

// POST /games/:id/draw-deck – draw from deck
router.post("/:id/draw-deck", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const card = await GameLogic.drawFromDeck(gameId, session.user.id);
    
    const io = req.app.get("io");
    if (io) {
      io.emit("game:card-drawn", { gameId, userId: session.user.id, source: "deck" });
    }

    res.json({ card });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/draw-discard – draw from discard
router.post("/:id/draw-discard", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const card = await GameLogic.drawFromDiscard(gameId, session.user.id);
    
    const io = req.app.get("io");
    if (io) {
      io.emit("game:card-drawn", { gameId, userId: session.user.id, source: "discard" });
    }

    res.json({ card });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/discard – discard a card
router.post("/:id/discard", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { cardId } = req.body;
    await GameLogic.discardCard(gameId, session.user.id, cardId);
    
    // Check if player has won (no cards left in hand)
    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'`,
      [gameId, session.user.id]
    );

    if (handSize.count === 0) {
      // Player has won!
      await GameLogic.declareWinner(gameId, session.user.id);
      const io = req.app.get("io");
      if (io) {
        io.emit("game:won", { gameId, winnerId: session.user.id });
      }
      return res.json({ success: true, won: true });
    }
    
    const io = req.app.get("io");
    if (io) {
      io.emit("game:card-discarded", { gameId, userId: session.user.id, cardId });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/lay-set – lay down a set of cards
router.post("/:id/lay-set", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { cardIds } = req.body;
    
    if (!cardIds || !Array.isArray(cardIds) || cardIds.length < 3) {
      return res.status(400).json({ error: "Must provide at least 3 cards" });
    }

    // Get the cards from database
    const cards = await db.manyOrNone(
      `SELECT id, suit, rank FROM game_cards 
       WHERE id = ANY($1) AND game_id = $2 AND player_id = $3`,
      [cardIds, gameId, session.user.id]
    );

    if (cards.length !== cardIds.length) {
      return res.status(400).json({ error: "Invalid cards selected" });
    }

    // Validate the set (sets only: same rank, all distinct suits)
    if (!GameLogic.validateMeld(cards as any)) {
      return res.status(400).json({ error: "Invalid set. Cards must be 3 or 4 of the same rank with all distinct suits." });
    }

    // Store the meld in player_hands melds column
    const playerHand = await db.one(
      `SELECT melds FROM player_hands WHERE game_id = $1 AND player_id = $2`,
      [gameId, session.user.id]
    );

    const currentMelds = playerHand.melds || [];
    currentMelds.push(cardIds);

    await db.none(
      `UPDATE player_hands SET melds = $1 WHERE game_id = $2 AND player_id = $3`,
      [JSON.stringify(currentMelds), gameId, session.user.id]
    );

    // Mark cards as laid down (move to a "laid" location)
    await db.none(
      `UPDATE game_cards SET location = 'laid', player_id = $1 
       WHERE id = ANY($2) AND game_id = $3`,
      [session.user.id, cardIds, gameId]
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("game:set-laid", { gameId, userId: session.user.id, cardIds });
    }

    // Check win condition: if player has no cards left in hand, declare winner
    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'`,
      [gameId, session.user.id]
    );

    if (Number(handSize.count) === 0) {
      await GameLogic.declareWinner(gameId, session.user.id);
      if (io) {
        io.to(`game:${gameId}`).emit("game:winner", { gameId, winnerId: session.user.id });
      }
      return res.json({ success: true, won: true });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/declare – declare winner
router.post("/:id/declare", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    await GameLogic.declareWinner(gameId, session.user.id);
    
    const io = req.app.get("io");
    if (io) {
      io.emit("game:winner", { gameId, winnerId: session.user.id });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/restart – reset game state and redeal
router.post("/:id/restart", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Only players in the game can restart (lightweight guard)
    const players = await db.manyOrNone<{ user_id: number }>(
      `SELECT user_id FROM game_players WHERE game_id = $1 ORDER BY hand_order`,
      [gameId]
    );
    if (!players.length) {
      return res.status(400).json({ error: "No players in this game" });
    }
    const isPlayer = players.some(p => p.user_id === session.user.id);
    if (!isPlayer) {
      return res.status(403).json({ error: "Not part of this game" });
    }

    // Re-initialize game (reshuffle, redeal, set hidden joker)
    await GameLogic.initializeGame(gameId, players.map(p => p.user_id));

    const io = req.app.get("io");
    if (io) {
      io.to(`game:${gameId}`).emit("game:restart", { gameId });
      // Force all connected clients in this game to logout
      io.to(`game:${gameId}`).emit("game:force-logout", { gameId });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/arrange-hand – update card positions in hand
router.post("/:id/arrange-hand", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { cardIds } = req.body;
    
    if (!cardIds || !Array.isArray(cardIds)) {
      return res.status(400).json({ error: "Invalid card IDs" });
    }

    // Update position for each card
    for (let i = 0; i < cardIds.length; i++) {
      await db.none(
        `UPDATE game_cards SET position = $1 
         WHERE id = $2 AND game_id = $3 AND player_id = $4`,
        [i, cardIds[i], gameId, session.user.id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /games/:id/results – show a standalone results page
router.get("/:id/results", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const game = await Games.get(gameId);
    if (!game) {
      return next(createHttpError(404, "Game not found"));
    }

    const session: any = (req as any).session;
    const gameState = await GameLogic.getGameState(gameId);

    // If the game isn't finished, send folks back to the live table
    if (gameState?.state !== "finished") {
      return res.redirect(`/games/${gameId}`);
    }

    const players = Array.isArray(gameState?.players) ? gameState.players : [];
    const winnerId = gameState?.winner_id ?? null;
    const winner = winnerId ? players.find((p: any) => p.player_id === winnerId) : null;
    const scores = players
      .map((p: any) => ({ name: p.username, points: Number(p.card_count) || 0 }))
      .sort((a: any, b: any) => a.points - b.points);

    return res.render("games/results", {
      game,
      winner,
      scores,
      hiddenJokerRank: gameState?.hidden_joker_rank || null,
      currentUser: session?.user || null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /games/:id/state – get game state
router.get("/:id/state", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    // Disable caching
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const session: any = (req as any).session;
    const gameState = await GameLogic.getGameState(gameId);
    console.log('State endpoint - userId:', session?.user?.id, 'gameId:', gameId);
    const playerHand = session?.user ? await GameLogic.getPlayerHand(gameId, session.user.id) : [];
    console.log('playerHand from GameLogic:', playerHand, 'length:', playerHand?.length);
    const myLaidCards = session?.user ? await db.manyOrNone(
      `SELECT id, suit, rank FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'laid' 
       ORDER BY position`,
      [gameId, session.user.id]
    ) : [];
    console.log('myLaidCards:', myLaidCards, 'length:', myLaidCards?.length);

    console.log('getGameState result:', JSON.stringify(gameState, null, 2));
    console.log('playerHand result (before clean):', JSON.stringify(playerHand, null, 2));

    // Clean the gameState to ensure it's JSON serializable
    const cleanState = {
      id: gameState?.id,
      game_id: gameState?.game_id,
      state: gameState?.state,
      current_turn_player_id: gameState?.current_turn_player_id,
      hidden_joker_rank: gameState?.hidden_joker_rank,
      winner_id: gameState?.winner_id,
      turn_number: gameState?.turn_number || 0,
      players: gameState?.players || [],
      discard_pile: gameState?.discard_pile || [],
      deck_count: gameState?.deck_count || 0
    };

    console.log('cleanState to send:', cleanState);
    res.json({ gameState: cleanState, playerHand, myLaidCards });
  } catch (err) {
    console.error('Error fetching game state:', err);
    next(err);
  }
});

export default router;
