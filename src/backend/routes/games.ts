import express from "express";
import createHttpError from "http-errors";
import { Games } from "../db";
import { GameLogic } from "../services/game-logic";
import db from "../db/connection";
import * as GameChat from "../db/game-chat";
import { GAME_CHAT_MESSAGE, GAME_CHAT_LISTING } from "../../shared/keys";

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
      session,
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

    // Get hidden joker rank from game
    const game = await db.one(
      `SELECT hidden_joker_rank FROM games WHERE id = $1`,
      [gameId]
    );

    // Validate as a sequence first (with wildcard support), then as a set
    const sequenceValidation = GameLogic.validateSequence(cards as any, game.hidden_joker_rank);
    const setValidation = GameLogic.validateMeld(cards as any, game.hidden_joker_rank);

    if (!sequenceValidation.valid && !setValidation) {
      return res.status(400).json({ error: "Invalid meld. Must be either a sequence (3+ consecutive same suit) or a set (3-4 same rank, distinct suits)." });
    }

    // Store the meld in player_hands melds column
    const playerHand = await db.one(
      `SELECT melds, joker_revealed FROM player_hands WHERE game_id = $1 AND player_id = $2`,
      [gameId, session.user.id]
    );

    const currentMelds = playerHand.melds || [];
    currentMelds.push(cardIds);

    // If this is a pure sequence, reveal the joker to this player
    const shouldRevealJoker = sequenceValidation.valid && sequenceValidation.isPure && !playerHand.joker_revealed;
    
    console.log('[lay-set] Sequence validation:', sequenceValidation);
    console.log('[lay-set] Set validation:', setValidation);
    console.log('[lay-set] Should reveal joker:', shouldRevealJoker);
    
    if (shouldRevealJoker) {
      await db.none(
        `UPDATE player_hands SET melds = $1, joker_revealed = true WHERE game_id = $2 AND player_id = $3`,
        [JSON.stringify(currentMelds), gameId, session.user.id]
      );
    } else {
      await db.none(
        `UPDATE player_hands SET melds = $1 WHERE game_id = $2 AND player_id = $3`,
        [JSON.stringify(currentMelds), gameId, session.user.id]
      );
    }

    // Mark cards as laid down (move to a "laid" location)
    await db.none(
      `UPDATE game_cards SET location = 'laid', player_id = $1 
       WHERE id = ANY($2) AND game_id = $3`,
      [session.user.id, cardIds, gameId]
    );

    const io = req.app.get("io");
    if (io) {
      io.emit("game:set-laid", { gameId, userId: session.user.id, cardIds });
      
      // If pure sequence was laid, notify the player that joker is revealed
      if (shouldRevealJoker) {
        console.log('[lay-set] Emitting joker-revealed to game:', gameId, 'for user:', session.user.id);
        // Emit to all in game room - client will filter by userId
        io.to(`game:${gameId}`).emit("game:joker-revealed", { 
          gameId, 
          userId: session.user.id,
          hiddenJokerRank: game.hidden_joker_rank 
        });
      }
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

// POST /games/:id/add-to-meld – add a card to an existing laid sequence
router.post("/:id/add-to-meld", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { meldIndex, cardId } = req.body;
    if (!Number.isInteger(meldIndex) || !Number.isInteger(cardId)) {
      return res.status(400).json({ error: "Invalid meldIndex or cardId" });
    }

    const state = await GameLogic.getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });
    if (state.state !== "in_progress") {
      return res.status(400).json({ error: "Game is not in progress" });
    }
    if (state.current_turn_player_id !== session.user.id) {
      return res.status(403).json({ error: "Not your turn" });
    }

    // Load melds for this player
    const handRow = await db.oneOrNone(
      `SELECT melds FROM player_hands WHERE game_id = $1 AND player_id = $2`,
      [gameId, session.user.id]
    );
    if (!handRow) return res.status(404).json({ error: "Player hand not found" });

    const melds = Array.isArray(handRow.melds) ? handRow.melds : [];
    if (!Array.isArray(melds[meldIndex])) {
      return res.status(400).json({ error: "Invalid meld index" });
    }

    // Validate card exists in player's hand
    const cardInHand = await db.oneOrNone(
      `SELECT id, suit, rank, location, position FROM game_cards
       WHERE id = $1 AND game_id = $2 AND player_id = $3 AND location = 'player_hand'`,
      [cardId, gameId, session.user.id]
    );
    if (!cardInHand) {
      return res.status(400).json({ error: "Card not in player's hand" });
    }

    // Fetch sequence cards for validation
    const sequenceCardIds: number[] = melds[meldIndex];
    const sequenceCards = await db.manyOrNone(
      `SELECT id, suit, rank, location, position FROM game_cards
       WHERE game_id = $1 AND id = ANY($2)`,
      [gameId, sequenceCardIds]
    );
    if (!sequenceCards || sequenceCards.length !== sequenceCardIds.length) {
      return res.status(400).json({ error: "One or more cards in the meld are missing" });
    }

    // Validate existing meld is actually valid before attempting to extend
    const existingValidation = GameLogic.validateSequence(sequenceCards as any, state.hidden_joker_rank);
    if (!existingValidation.valid) {
      return res.status(400).json({ error: "Existing meld is invalid - cannot add cards to it" });
    }

    const extension = GameLogic.canExtendSequence(
      sequenceCards as any,
      cardInHand as any,
      state.hidden_joker_rank
    );

    if (!extension.canExtend) {
      return res.status(400).json({ error: "Card cannot be added to this sequence" });
    }

    // Update meld ordering
    const updatedMeld = [...sequenceCardIds];
    if (extension.position === "start") {
      updatedMeld.unshift(cardId);
    } else if (extension.position === "end") {
      updatedMeld.push(cardId);
    } else if (extension.position === "middle") {
      // Insert in sorted order by rank
      const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const newRankIdx = RANKS.indexOf(cardInHand.rank);
      let inserted = false;
      for (let i = 0; i < sequenceCards.length; i++) {
        const currRankIdx = RANKS.indexOf(sequenceCards[i].rank);
        if (newRankIdx < currRankIdx) {
          updatedMeld.splice(i, 0, cardId);
          inserted = true;
          break;
        }
      }
      if (!inserted) updatedMeld.push(cardId);
    }

    const updatedMelds = [...melds];
    updatedMelds[meldIndex] = updatedMeld;

    // Move the card to laid
    await db.none(
      `UPDATE game_cards
       SET location = 'laid', player_id = $1
       WHERE id = $2 AND game_id = $3`,
      [session.user.id, cardId, gameId]
    );

    // Persist melds
    await db.none(
      `UPDATE player_hands SET melds = $1 WHERE game_id = $2 AND player_id = $3`,
      [JSON.stringify(updatedMelds), gameId, session.user.id]
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`game:${gameId}`).emit("game:card-added-to-meld", {
        gameId,
        userId: session.user.id,
        meldIndex,
        cardId,
        position: extension.position
      });
    }

    const gameState = await GameLogic.getGameState(gameId);
    return res.json({
      success: true,
      meldIndex,
      cardId,
      position: extension.position,
      gameState
    });
  } catch (err) {
    console.error("/games/:id/add-to-meld error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /games/:id/move-card-between-groups – move a card between hand and laid melds
router.post("/:id/move-card-between-groups", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { cardId, from, to, fromMeldIndex, toMeldIndex } = req.body;
    if (!Number.isInteger(cardId) || (from !== "hand" && from !== "meld") || (to !== "hand" && to !== "meld") || from === to) {
      return res.status(400).json({ error: "Invalid move payload" });
    }

    const state = await GameLogic.getGameState(gameId);
    if (!state) return res.status(404).json({ error: "Game not found" });
    if (state.state !== "in_progress") {
      return res.status(400).json({ error: "Game is not in progress" });
    }
    if (state.current_turn_player_id !== session.user.id) {
      return res.status(403).json({ error: "Not your turn" });
    }

    // Load player's melds
    const handRow = await db.oneOrNone(
      `SELECT melds FROM player_hands WHERE game_id = $1 AND player_id = $2`,
      [gameId, session.user.id]
    );
    if (!handRow) return res.status(404).json({ error: "Player hand not found" });
    
    const melds = Array.isArray(handRow.melds) ? handRow.melds : (handRow.melds ? JSON.parse(handRow.melds) : []);

    // Helper to persist melds
    async function saveMelds(updatedMelds: any[]) {
      await db.none(
        `UPDATE player_hands SET melds = $1 WHERE game_id = $2 AND player_id = $3`,
        [JSON.stringify(updatedMelds), gameId, session.user.id]
      );
    }

    // Helper to validate meld after change
    async function isMeldValid(cardIds: number[]): Promise<boolean> {
      if (!cardIds || cardIds.length < 3) return false;
      const cards = await db.manyOrNone(
        `SELECT id, suit, rank FROM game_cards WHERE game_id = $1 AND id = ANY($2)` ,
        [gameId, cardIds]
      );
      if (!cards || cards.length !== cardIds.length) return false;
      const seq = GameLogic.validateSequence(cards as any, state.hidden_joker_rank);
      if (seq.valid) return true;
      return GameLogic.validateMeld(cards as any, state.hidden_joker_rank);
    }

    if (from === "meld" && to === "hand") {
      if (!Number.isInteger(fromMeldIndex) || !Array.isArray(melds[fromMeldIndex])) {
        return res.status(400).json({ error: "Invalid source meld" });
      }
      const sourceMeld: number[] = melds[fromMeldIndex];
      if (!sourceMeld.includes(cardId)) {
        return res.status(400).json({ error: "Card not found in meld" });
      }

      const updatedMeld = sourceMeld.filter((id: number) => id !== cardId);
      
      // If removing this card would make the meld invalid (< 3 cards or doesn't form valid sequence)
      // then delete the entire meld and move all cards back to hand
      if (!(await isMeldValid(updatedMeld))) {
        console.log(`[move-card-between-groups] Removing card would invalidate meld ${fromMeldIndex}, moving all cards to hand`);
        
        // Move ALL cards from this meld back to hand
        for (const meldCardId of sourceMeld) {
          const maxPosRow = await db.oneOrNone<{ pos: number }>(
            `SELECT COALESCE(MAX(position), -1) AS pos FROM game_cards WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'`,
            [gameId, session.user.id]
          );
          const newPos = (maxPosRow?.pos ?? -1) + 1;
          
          await db.none(
            `UPDATE game_cards SET location = 'player_hand', position = $1 WHERE id = $2 AND game_id = $3 AND player_id = $4`,
            [newPos, meldCardId, gameId, session.user.id]
          );
        }

        // Remove this meld entirely
        const updatedMelds = melds.filter((_, idx) => idx !== fromMeldIndex);
        await saveMelds(updatedMelds);

        const gameState = await GameLogic.getGameState(gameId);
        return res.json({ success: true, gameState, message: "Meld dissolved - all cards returned to hand" });
      }

      const updatedMelds = [...melds];
      updatedMelds[fromMeldIndex] = updatedMeld;

      // Move card to hand with next position
      const maxPosRow = await db.oneOrNone<{ pos: number }>(
        `SELECT COALESCE(MAX(position), -1) AS pos FROM game_cards WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'`,
        [gameId, session.user.id]
      );
      const newPos = (maxPosRow?.pos ?? -1) + 1;

      await db.none(
        `UPDATE game_cards SET location = 'player_hand', position = $1 WHERE id = $2 AND game_id = $3 AND player_id = $4`,
        [newPos, cardId, gameId, session.user.id]
      );

      await saveMelds(updatedMelds);

      const gameState = await GameLogic.getGameState(gameId);
      return res.json({ success: true, gameState });
    }

    if (from === "hand" && to === "meld") {
      if (!Number.isInteger(toMeldIndex) || !Array.isArray(melds[toMeldIndex])) {
        return res.status(400).json({ error: "Invalid target meld" });
      }

      const cardInHand = await db.oneOrNone(
        `SELECT id, suit, rank FROM game_cards WHERE id = $1 AND game_id = $2 AND player_id = $3 AND location = 'player_hand'`,
        [cardId, gameId, session.user.id]
      );
      if (!cardInHand) {
        return res.status(400).json({ error: "Card not in hand" });
      }

      const targetMeldIds: number[] = melds[toMeldIndex];
      const targetCards = await db.manyOrNone(
        `SELECT id, suit, rank FROM game_cards WHERE game_id = $1 AND id = ANY($2)` ,
        [gameId, targetMeldIds]
      );
      if (!targetCards || targetCards.length !== targetMeldIds.length) {
        return res.status(400).json({ error: "Invalid meld cards" });
      }

      const isSeq = GameLogic.validateSequence(targetCards as any, state.hidden_joker_rank).valid;
      const isSet = GameLogic.validateMeld(targetCards as any, state.hidden_joker_rank);

      let updatedMeld: number[] | null = null;

      if (isSeq) {
        const extension = GameLogic.canExtendSequence(targetCards as any, cardInHand as any, state.hidden_joker_rank);
        if (!extension.canExtend) {
          return res.status(400).json({ error: "Card cannot be added to this sequence" });
        }
        updatedMeld = [...targetMeldIds];
        if (extension.position === "start") updatedMeld.unshift(cardId);
        else if (extension.position === "end") updatedMeld.push(cardId);
        else return res.status(400).json({ error: "Invalid sequence position" });
      } else if (isSet) {
        // For sets, simply append and re-validate
        const candidate = [...targetMeldIds, cardId];
        if (!(await isMeldValid(candidate))) {
          return res.status(400).json({ error: "Card cannot be added to this set" });
        }
        updatedMeld = candidate;
      } else {
        return res.status(400).json({ error: "Target meld is invalid" });
      }

      const updatedMelds = [...melds];
      updatedMelds[toMeldIndex] = updatedMeld;

      // Move card to laid
      await db.none(
        `UPDATE game_cards SET location = 'laid', player_id = $1 WHERE id = $2 AND game_id = $3`,
        [session.user.id, cardId, gameId]
      );

      await saveMelds(updatedMelds);

      const gameState = await GameLogic.getGameState(gameId);
      return res.json({ success: true, gameState });
    }

    return res.status(400).json({ error: "Unsupported move" });
  } catch (err) {
    console.error("/games/:id/move-card-between-groups error", err);
    return res.status(500).json({ error: "Internal server error" });
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

    // Find the actual winner (player with 0 cards)
    const actualWinner = await db.oneOrNone<{ player_id: number; count: number }>(
      `SELECT player_id, COUNT(*) as count 
       FROM game_cards 
       WHERE game_id = $1 AND location = 'player_hand'
       GROUP BY player_id
       ORDER BY count ASC
       LIMIT 1`,
      [gameId]
    );

    // If someone has 0 cards, they're the winner; otherwise use player with fewest cards
    let winnerId = session.user.id; // fallback
    if (actualWinner) {
      if (Number(actualWinner.count) === 0) {
        winnerId = actualWinner.player_id;
      } else {
        winnerId = actualWinner.player_id;
      }
    }

    await GameLogic.declareWinner(gameId, winnerId);
    
    const io = req.app.get("io");
    if (io) {
      io.emit("game:winner", { gameId, winnerId });
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
    let winner = winnerId ? players.find((p: any) => p.player_id === winnerId) : null;
    
    // Fallback: if winner has cards but someone else has 0, use the player with 0 cards
    if (winner && Number(winner.card_count) > 0) {
      const playerWith0Cards = players.find((p: any) => Number(p.card_count) === 0);
      if (playerWith0Cards) {
        console.log(`[results] Correcting winner from ${winner.username} to ${playerWith0Cards.username} (0 cards)`);
        winner = playerWith0Cards;
      }
    }
    
    // If no winner found, use player with fewest cards
    if (!winner && players.length > 0) {
      const sorted = [...players].sort((a: any, b: any) => Number(a.card_count) - Number(b.card_count));
      winner = sorted[0];
    }
    
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

// GET /games/:id/chat - Load game chat history
router.get("/:id/chat", async (req, res, next) => {
  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const gameId = parseInt(req.params.id);
    const messages = await GameChat.list(gameId, 50);
    
    const io = req.app.get("io");
    if (io) {
      // Emit to the user's session room
      io.to(session.id).emit(GAME_CHAT_LISTING, { messages });
    }
    
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/chat - Send a game chat message
router.post("/:id/chat", async (req, res, next) => {
  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const gameId = parseInt(req.params.id);
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    const savedMessage = await GameChat.create(gameId, session.user.id, message.trim());
    
    const messageWithUser = {
      ...savedMessage,
      username: session.user.username
    };

    const io = req.app.get("io");
    if (io) {
      // Emit to all users in this game room
      io.to(`game-${gameId}`).emit(GAME_CHAT_MESSAGE, messageWithUser);
    }

    res.status(201).json(messageWithUser);
  } catch (err) {
    next(err);
  }
});

export default router;
