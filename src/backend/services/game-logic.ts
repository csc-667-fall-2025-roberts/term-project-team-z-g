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
      const deletedCards = await db.result(
        `DELETE FROM game_cards WHERE game_id = $1`,
        [gameId]
      );
      console.log(`[initializeGame] Deleted ${deletedCards.rowCount} cards`);
      
      const deletedHands = await db.result(
        `DELETE FROM player_hands WHERE game_id = $1`,
        [gameId]
      );
      console.log(`[initializeGame] Deleted ${deletedHands.rowCount} player_hands`);
      
      const deletedState = await db.result(
        `DELETE FROM game_state WHERE game_id = $1`,
        [gameId]
      );
      console.log(`[initializeGame] Deleted ${deletedState.rowCount} game_state rows`);
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
   * Deal 13 cards to each player
   */
  static async dealCards(gameId: number): Promise<void> {
    const players = await db.manyOrNone<PlayerHand>(
      `SELECT * FROM player_hands WHERE game_id = $1 ORDER BY hand_order`,
      [gameId]
    );

    const needed = players.length * 13 + 1; // +1 for initial discard
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
      for (let i = 0; i < 13; i++) {
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
   * Draw a card from deck (max 1 card per turn, can draw when at 13 cards)
   * If deck is empty, reshuffle discard pile into deck
   */
  static async drawFromDeck(gameId: number, playerId: number): Promise<Card | null> {
    const playerHand = await db.oneOrNone<{ has_drawn: boolean }>(
      `SELECT has_drawn FROM player_hands 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Only allow one draw per turn (has_drawn)
    if (playerHand?.has_drawn) {
      throw new Error("You have already drawn a card this turn. You must discard before drawing again.");
    }

    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Allow draw if player has 13 cards, block if already at 14 or more
    if (handSize.count >= 14) {
      throw new Error("You must discard a card before drawing again.");
    }

    let card = await db.oneOrNone<Card>(
      `SELECT * FROM game_cards 
       WHERE game_id = $1 AND location = 'deck' 
       ORDER BY position 
       LIMIT 1`,
      [gameId]
    );

    // If deck is empty, reshuffle discard pile into deck
    if (!card) {
      const discardCount = await db.one<{ count: number }>(
        `SELECT COUNT(*) as count FROM game_cards 
         WHERE game_id = $1 AND location = 'discard'`,
        [gameId]
      );

      if (discardCount.count === 0) {
        // No cards available at all
        return null;
      }

      // Move all discard cards back to deck and shuffle
      const deckCards = await db.manyOrNone<Card>(
        `SELECT * FROM game_cards 
         WHERE game_id = $1 AND location = 'discard'`,
        [gameId]
      );

      // Shuffle the array
      for (let i = deckCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
      }

      // Update all cards back to deck with new positions
      for (let i = 0; i < deckCards.length; i++) {
        await db.none(
          `UPDATE game_cards SET location = 'deck', position = $1 WHERE id = $2`,
          [i, deckCards[i].id]
        );
      }

      // Now draw the top card from reshuffled deck
      card = await db.oneOrNone<Card>(
        `SELECT * FROM game_cards 
         WHERE game_id = $1 AND location = 'deck' 
         ORDER BY position 
         LIMIT 1`,
        [gameId]
      );

      if (!card) return null;
    }

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
   * Draw from discard pile (max 1 card per turn, can draw when at 13 cards)
   */
  static async drawFromDiscard(gameId: number, playerId: number): Promise<Card | null> {
    const playerHand = await db.oneOrNone<{ has_drawn: boolean }>(
      `SELECT has_drawn FROM player_hands 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Only allow one draw per turn (has_drawn)
    if (playerHand?.has_drawn) {
      throw new Error("You have already drawn a card this turn. You must discard before drawing again.");
    }

    const handSize = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM game_cards 
       WHERE game_id = $1 AND player_id = $2`,
      [gameId, playerId]
    );

    // Check if player has more than 14 cards (should only happen if they drew and haven't discarded yet)
    if (handSize.count > 14) {
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
   * Validate a sequence (run)
   * - Pure: consecutive cards of the same suit, no wildcards
   * - Impure: consecutive after substituting wildcards (hidden joker rank)
   * Note: We do NOT use printed jokers (no suit==='joker' cards in deck).
   */
  static validateSequence(cards: Card[], hiddenJokerRank?: string): { valid: boolean; isPure: boolean } {
    console.log('[validateSequence] Input cards:', cards.map(c => `${c.rank}${c.suit}`), 'hiddenJoker:', hiddenJokerRank);

    if (cards.length < 3) {
      return { valid: false, isPure: false };
    }

    // All NON-WILDCARD cards must be same suit (wildcards ignore suit)
    const nonWildcard = cards.filter(c => c.rank !== hiddenJokerRank);
    const suits = new Set(nonWildcard.map(c => c.suit));
    if (suits.size > 1) {
      console.log('[validateSequence] Failed: multiple suits in non-wildcards', Array.from(suits));
      return { valid: false, isPure: false };
    }

    const rankOrder: { [key: string]: number } = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
      'J': 11, 'Q': 12, 'K': 13
    };

    const sorted = cards.slice().sort((a, b) => {
      const aRank = rankOrder[a.rank] || 0;
      const bRank = rankOrder[b.rank] || 0;
      return aRank - bRank;
    });
    const ranks = sorted.map(c => rankOrder[c.rank] || 0);

    // Pure check: no wildcards present
    const hasWildcard = !!hiddenJokerRank && cards.some(c => c.rank === hiddenJokerRank);
    const pureCards = hasWildcard ? cards.filter(c => c.rank !== hiddenJokerRank) : cards;
    const pureSorted = pureCards.slice().sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
    let pureConsecutive = true;
    for (let i = 1; i < pureSorted.length; i++) {
      const prev = rankOrder[pureSorted[i - 1].rank] || 0;
      const curr = rankOrder[pureSorted[i].rank] || 0;
      if (curr !== prev + 1) {
        pureConsecutive = false;
        break;
      }
    }
    if (!hasWildcard) {
      return { valid: pureConsecutive, isPure: pureConsecutive };
    }

    // Impure check: can wildcards fill exact gaps to make consecutive
    // Count gaps among non-wildcard ranks
    const regularRanks = pureSorted.map(c => rankOrder[c.rank] || 0);
    let gaps = 0;
    for (let i = 1; i < regularRanks.length; i++) {
      const diff = regularRanks[i] - regularRanks[i - 1];
      if (diff === 1) continue;
      if (diff > 1) gaps += (diff - 1);
      else { // duplicate or backwards
        return { valid: false, isPure: false };
      }
    }
    const wildcardCount = cards.filter(c => c.rank === hiddenJokerRank).length;
    const canFill = wildcardCount >= gaps;
    return { valid: canFill && regularRanks.length > 0, isPure: false };
  }

  /**
   * Check if a single card can extend an existing sequence
   * Returns { canExtend: boolean, position: 'start' | 'end' | 'middle' | null }
   * Now supports filling gaps, not just extending ends
   */
  static canExtendSequence(sequenceCards: Card[], newCard: Card, hiddenJokerRank?: string): { canExtend: boolean; position: 'start' | 'end' | 'middle' | null } {
    if (sequenceCards.length < 3) {
      return { canExtend: false, position: null };
    }

    const nonWildcard = sequenceCards.filter(c => c.rank !== hiddenJokerRank);
    const suits = new Set(nonWildcard.map(c => c.suit));
    
    // Sequence must be single suit among non-wildcards (wildcards are suit-agnostic)
    if (suits.size > 1) {
      console.log('[canExtendSequence] Failed: multiple suits in existing sequence', Array.from(suits));
      return { canExtend: false, position: null };
    }

    const suit = suits.size > 0 ? Array.from(suits)[0] : null;
    
    // New card must match suit OR be wildcard (wildcards ignore suit requirement)
    if (newCard.rank !== hiddenJokerRank && suit && newCard.suit !== suit) {
      console.log('[canExtendSequence] Failed: new card suit mismatch', newCard.suit, 'vs', suit);
      return { canExtend: false, position: null };
    }

    const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const allCards = [...sequenceCards, newCard];
    const allNonWild = allCards.filter(c => c.rank !== hiddenJokerRank);
    const rankIndices = allNonWild.map(c => RANKS.indexOf(c.rank)).filter(idx => idx >= 0).sort((a, b) => a - b);
    
    // Check for duplicate ranks (invalid)
    for (let i = 1; i < rankIndices.length; i++) {
      if (rankIndices[i] === rankIndices[i - 1]) {
        return { canExtend: false, position: null };
      }
    }

    const minRank = Math.min(...rankIndices);
    const maxRank = Math.max(...rankIndices);
    const newCardRankIdx = RANKS.indexOf(newCard.rank);
    
    // Count wildcards
    const wildcardCount = allCards.filter(c => c.rank === hiddenJokerRank).length;
    
    // Calculate gaps in the new combined sequence
    let totalGaps = 0;
    for (let i = 1; i < rankIndices.length; i++) {
      const diff = rankIndices[i] - rankIndices[i - 1];
      if (diff > 1) totalGaps += (diff - 1);
    }
    
    // Wildcards must be able to fill all gaps
    if (totalGaps > wildcardCount) {
      return { canExtend: false, position: null };
    }

    // Determine position: start, end, or middle
    const origNonWild = sequenceCards.filter(c => c.rank !== hiddenJokerRank);
    const origIndices = origNonWild.map(c => RANKS.indexOf(c.rank)).filter(idx => idx >= 0);
    const origMin = Math.min(...origIndices);
    const origMax = Math.max(...origIndices);
    
    if (newCardRankIdx === origMin - 1) {
      return { canExtend: true, position: 'start' };
    }
    if (newCardRankIdx === origMax + 1) {
      return { canExtend: true, position: 'end' };
    }
    // Card fills a gap in the middle
    if (newCardRankIdx > origMin && newCardRankIdx < origMax) {
      return { canExtend: true, position: 'middle' };
    }

    return { canExtend: false, position: null };
  }

  /**
   * Validate a set (same rank)
   * - Minimum 3 cards
   * - All ranks equal OR wildcards (hidden joker rank) substituting
   * - Suits can repeat (duplicates allowed)
   */
  static validateSet(cards: Card[], hiddenJokerRank?: string): { valid: boolean } {
    if (cards.length < 3) return { valid: false };
    if (!hiddenJokerRank) {
      // Without wildcards, all ranks must match exactly
      const ranks = new Set(cards.map(c => c.rank));
      return { valid: ranks.size === 1 };
    }
    const nonWild = cards.filter(c => c.rank !== hiddenJokerRank);
    if (nonWild.length === 0) {
      // All wildcards is not a valid set
      return { valid: false };
    }
    const targetRank = nonWild[0].rank;
    const mismatch = nonWild.some(c => c.rank !== targetRank);
    return { valid: !mismatch };
  }

  /**
   * Validate a meld (sets: same rank, all distinct suits)
   * Wildcards (hidden joker rank) can fill missing suits
   */
  static validateMeld(cards: Card[], hiddenJokerRank?: string): boolean {
    if (cards.length < 3 || cards.length > 4) return false;

    // Separate non-wildcards from wildcards
    const nonWild = cards.filter(c => c.rank !== hiddenJokerRank);
    const wildcards = cards.filter(c => c.rank === hiddenJokerRank);

    // All non-wildcard cards must have the same rank
    if (nonWild.length === 0) return false;
    const ranks = new Set(nonWild.map(c => c.rank));
    if (ranks.size !== 1) return false;

    // Wildcards can substitute any rank, suits can repeat (no distinct suit requirement)
    return true;
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
         COALESCE(ph.melds, '[]'::jsonb) AS melds,
         COALESCE(ph.joker_revealed, false) AS joker_revealed,
         u.username,
         COUNT(gc.id) FILTER (WHERE gc.location = 'player_hand') AS card_count
       FROM game_players gp
       JOIN users u ON u.id = gp.user_id
       LEFT JOIN player_hands ph ON ph.game_id = gp.game_id AND ph.player_id = gp.user_id
       LEFT JOIN game_cards gc ON gc.game_id = gp.game_id AND gc.player_id = gp.user_id
       WHERE gp.game_id = $1
       GROUP BY gp.user_id, ph.hand_order, ph.has_drawn, ph.melds, ph.joker_revealed, u.username
       ORDER BY COALESCE(ph.hand_order, gp.user_id)`,
      [gameId]
    );

    const discardPile = await db.manyOrNone<Card>(
      `SELECT id, game_id, suit, rank, location, player_id, position FROM game_cards 
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
      `SELECT id, game_id, suit, rank, location, player_id, position FROM game_cards 
       WHERE game_id = $1 AND player_id = $2 AND location = 'player_hand'
       ORDER BY position`,
      [gameId, playerId]
    );
  }
}
