import db from "../db/connection";

export interface Card {
  id: number;
  suit: string;
  rank: string;
  location: string;
  player_id?: number;
  position: number;
}

export interface PlayerHand {
  id: number;
  game_id: number;
  player_id: number;
  hand_order: number;
  melds: any[];
  has_drawn: boolean;
}

export interface GameState {
  id: number;
  game_id: number;
  state?: string;
  current_turn_player_id?: number;
  hidden_joker_rank?: string;
  winner_id?: number;
  turn_number: number;
  last_action?: string;
}

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export class GameLogic {
  /**
   * Initialize a new game with a shuffled deck
   */
  static async initializeGame(gameId: number, playerIds: number[]): Promise<void> {
    console.log("initializeGame start", { gameId, playerIds });
    try {
      // Reset any existing state for idempotent start attempts
      await db.none(`DELETE FROM game_cards WHERE game_id = $1`, [gameId]);
      await db.none(`DELETE FROM player_hands WHERE game_id = $1`, [gameId]);
      await db.none(`DELETE FROM game_state WHERE game_id = $1`, [gameId]);
    } catch (err) {
      console.error("initializeGame cleanup failed", err);
      throw err;
    }

    // Create deck
    const cards: any[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ suit, rank });
      }
    }

    // Shuffle deck
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    try {
      // Insert cards into database
      for (let i = 0; i < cards.length; i++) {
        await db.none(
          `INSERT INTO game_cards (game_id, suit, rank, location, position)
           VALUES ($1, $2, $3, 'deck', $4)`,
          [gameId, cards[i].suit, cards[i].rank, i]
        );
      }
    } catch (err) {
      console.error("initializeGame insert cards failed", err);
      throw err;
    }

    try {
      // Create player hands
      for (let i = 0; i < playerIds.length; i++) {
        await db.none(
          `INSERT INTO player_hands (game_id, player_id, hand_order)
           VALUES ($1, $2, $3)`,
          [gameId, playerIds[i], i]
        );
      }
    } catch (err) {
      console.error("initializeGame create hands failed", err);
      throw err;
    }

    const hiddenJokerRank = RANKS[Math.floor(Math.random() * RANKS.length)];
    try {
      // Create game state
      await db.none(
        `INSERT INTO game_state (game_id, current_turn_player_id, hidden_joker_rank, turn_number)
         VALUES ($1, $2, $3, 1)`,
        [gameId, playerIds[0], hiddenJokerRank]
      );
    } catch (err) {
      console.error("initializeGame create game_state failed", err);
      throw err;
    }

    try {
      // Deal cards
      await this.dealCards(gameId);
    } catch (err) {
      console.error("initializeGame dealCards failed", err);
      throw err;
    }

    try {
      // Update game status
      await db.none(
        `UPDATE games SET state = 'in_progress', hidden_joker_rank = $1 WHERE id = $2`,
        [hiddenJokerRank, gameId]
      );
    } catch (err) {
      console.error("initializeGame update games failed", err);
      throw err;
    }
  }

  /**
   * Deal 12 cards to each player
   */
  static async dealCards(gameId: number): Promise<void> {
    const players = await db.manyOrNone<PlayerHand>(
      `SELECT * FROM player_hands WHERE game_id = $1 ORDER BY hand_order`,
      [gameId]
    );

    const needed = players.length * 12 + 1; // +1 for initial discard
    const deckCards = await db.manyOrNone<Card>(
      `SELECT * FROM game_cards WHERE game_id = $1 AND location = 'deck' ORDER BY position LIMIT $2`,
      [gameId, needed]
    );
    console.log("dealCards fetched deck", { gameId, needed, count: deckCards.length });

    if (deckCards.length < needed) {
      throw new Error(`Not enough cards in deck to deal. Needed ${needed}, got ${deckCards.length}`);
    }

    let cardIndex = 0;
    for (const player of players) {
      for (let i = 0; i < 12; i++) {
        const card = deckCards[cardIndex++];
        await db.none(
          `UPDATE game_cards SET location = 'player_hand', player_id = $1, position = $2
           WHERE id = $3`,
          [player.player_id, i, card.id]
        );
      }
    }

    // Place one card in discard pile
    const discardCard = deckCards[cardIndex];
    if (discardCard) {
      await db.none(
        `UPDATE game_cards SET location = 'discard', position = 0 WHERE id = $1`,
        [discardCard.id]
      );
    }
  }

  /**
   * Draw a card from deck (max 1 card per turn, can draw when at 12 cards)
   */
  static async drawFromDeck(gameId: number, playerId: number): Promise<Card | null> {
    const playerHand = await db.oneOrNone<{ has_drawn: boolean }>(
      `SELECT has_drawn FROM player_hands 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Check if player has already drawn this turn
    if (playerHand?.has_drawn) {
      throw new Error("You have already drawn a card this turn. You must discard before drawing again.");
    }

    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Check if player has more than 12 cards (should only happen if they drew and haven't discarded yet)
    if (handSize.count > 12) {
      throw new Error("You must discard a card before drawing again.");
    }

    const card = await db.oneOrNone<Card>(
      `SELECT * FROM game_cards 
       WHERE game_id = $1 AND location = 'deck' 
       ORDER BY position 
       LIMIT 1`,
      [gameId]
    );

    if (!card) return null;

    await db.none(
      `UPDATE game_cards 
       SET location = 'player_hand', player_id = $1, position = $2
       WHERE id = $3`,
      [playerId, handSize.count, card.id]
    );

    await db.none(
      `UPDATE player_hands SET has_drawn = true 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    return card;
  }

  /**
   * Draw from discard pile (max 1 card per turn, can draw when at 12 cards)
   */
  static async drawFromDiscard(gameId: number, playerId: number): Promise<Card | null> {
    const playerHand = await db.oneOrNone<{ has_drawn: boolean }>(
      `SELECT has_drawn FROM player_hands 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Check if player has already drawn this turn
    if (playerHand?.has_drawn) {
      throw new Error("You have already drawn a card this turn. You must discard before drawing again.");
    }

    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Check if player has more than 12 cards (should only happen if they drew and haven't discarded yet)
    if (handSize.count > 12) {
      throw new Error("You must discard a card before drawing again.");
    }

    const card = await db.oneOrNone<Card>(
      `SELECT * FROM game_cards 
       WHERE game_id = $1 AND location = 'discard' 
       ORDER BY position DESC 
       LIMIT 1`,
      [gameId]
    );

    if (!card) return null;

    await db.none(
      `UPDATE game_cards 
       SET location = 'player_hand', player_id = $1, position = $2
       WHERE id = $3`,
      [playerId, handSize.count, card.id]
    );

    await db.none(
      `UPDATE player_hands SET has_drawn = true 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    return card;
  }

  /**
   * Discard a card
   */
  static async discardCard(gameId: number, playerId: number, cardId: number): Promise<void> {
    const discardCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND location = 'discard'`,
      [gameId]
    );

    await db.none(
      `UPDATE game_cards 
       SET location = 'discard', player_id = NULL, position = $1
       WHERE id = $2 AND player_id = $3`,
      [discardCount.count, cardId, playerId]
    );

    await db.none(
      `UPDATE player_hands SET has_drawn = false 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Move to next player
    await this.nextTurn(gameId);
  }

  /**
   * Move to next player's turn
   */
  static async nextTurn(gameId: number): Promise<void> {
    const state = await db.one<GameState>(
      `SELECT * FROM game_state WHERE game_id = $1`,
      [gameId]
    );

    const players = await db.manyOrNone<PlayerHand>(
      `SELECT * FROM player_hands WHERE game_id = $1 ORDER BY hand_order`,
      [gameId]
    );

    const currentIndex = players.findIndex(p => p.player_id === state.current_turn_player_id);
    const nextIndex = (currentIndex + 1) % players.length;

    await db.none(
      `UPDATE game_state 
       SET current_turn_player_id = $1, turn_number = turn_number + 1, updated_at = CURRENT_TIMESTAMP
       WHERE game_id = $2`,
      [players[nextIndex].player_id, gameId]
    );
  }

  /**
   * Validate a meld (sets only)
   */
  static validateMeld(cards: Card[], hiddenJokerRank?: string): boolean {
    if (cards.length < 3) return false;

    // Only sets: same rank, all distinct suits; allow 3 or 4 cards
    const ranks = new Set(cards.map(c => c.rank));
    if (ranks.size === 1) {
      const suits = new Set(cards.map(c => c.suit));
      return suits.size === cards.length && (cards.length === 3 || cards.length === 4);
    }
    return false;
  }

  /**
   * Declare winner
   */
  static async declareWinner(gameId: number, playerId: number): Promise<void> {
    await db.none(
      `UPDATE game_state SET winner_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE game_id = $2`,
      [playerId, gameId]
    );

    await db.none(
      `UPDATE games SET state = 'finished' WHERE id = $1`,
      [gameId]
    );
  }

  /**
   * Get game state with all information
   */
  static async getGameState(gameId: number): Promise<any> {
    // Game state row (might be null before start)
    const state = await db.oneOrNone<GameState>(
      `SELECT * FROM game_state WHERE game_id = $1`,
      [gameId]
    );

    // Game meta (state lives on games table)
    const gameRow = await db.oneOrNone<{ state: string; hidden_joker_rank: string | null }>(
      `SELECT state, hidden_joker_rank FROM games WHERE id = $1`,
      [gameId]
    );

    // Always list joined players, even before cards are dealt
    const players = await db.manyOrNone(
      `SELECT 
         gp.user_id          AS player_id,
         COALESCE(ph.hand_order, 0) AS hand_order,
         COALESCE(ph.has_drawn, false) AS has_drawn,
         ph.melds,
         u.username,
         COUNT(gc.id) FILTER (WHERE gc.location = 'player_hand') AS card_count
       FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       LEFT JOIN player_hands ph ON ph.game_id = gp.game_id AND ph.player_id = gp.user_id
       LEFT JOIN game_cards gc ON gc.game_id = gp.game_id AND gc.player_id = gp.user_id
       WHERE gp.game_id = $1
       GROUP BY gp.user_id, ph.hand_order, ph.has_drawn, ph.melds, u.username
       ORDER BY COALESCE(ph.hand_order, gp.user_id)`,
      [gameId]
    );

    const discardPile = await db.manyOrNone<Card>(
      `SELECT * FROM game_cards 
       WHERE game_id = $1 AND location = 'discard' 
       ORDER BY position DESC 
       LIMIT 1`,
      [gameId]
    );

    const deckCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND location = 'deck'`,
      [gameId]
    );

    return {
      state: gameRow?.state ?? 'waiting',
      game_id: gameId,
      current_turn_player_id: state?.current_turn_player_id ?? null,
      hidden_joker_rank: gameRow?.hidden_joker_rank ?? state?.hidden_joker_rank ?? null,
      winner_id: state?.winner_id ?? null,
      turn_number: state?.turn_number ?? 0,
      players,
      discard_pile: discardPile,
      deck_count: Number(deckCount.count) || 0,
    };
  }

  /**
   * Get player's hand
   */
  static async getPlayerHand(gameId: number, playerId: number): Promise<Card[]> {
    return await db.manyOrNone<Card>(
      `SELECT * FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'
       ORDER BY position`,
      [gameId, playerId]
    );
  }
}
