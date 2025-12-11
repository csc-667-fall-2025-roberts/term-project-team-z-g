import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Cards table - represents all cards in play for a game
  pgm.createTable('game_cards', {
    id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      references: 'games',
      onDelete: 'CASCADE',
    },
    suit: {
      type: 'varchar(10)',
      notNull: true,
    },
    rank: {
      type: 'varchar(5)',
      notNull: true,
    },
    location: {
      type: 'varchar(20)',
      notNull: true,
      default: 'deck',
      comment: 'deck, discard, or player_hand',
    },
    player_id: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    position: {
      type: 'integer',
      default: 0,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('game_cards', 'game_id');
  pgm.createIndex('game_cards', ['game_id', 'location']);
  pgm.createIndex('game_cards', ['game_id', 'player_id']);

  // Player hands - track each player's hand in a game
  pgm.createTable('player_hands', {
    id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      references: 'games',
      onDelete: 'CASCADE',
    },
    player_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    hand_order: {
      type: 'integer',
      notNull: true,
      comment: 'Turn order in game',
    },
    melds: {
      type: 'jsonb',
      default: '[]',
      comment: 'Array of meld groups',
    },
    has_drawn: {
      type: 'boolean',
      default: false,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addConstraint('player_hands', 'player_hands_game_player_unique', {
    unique: ['game_id', 'player_id'],
  });
  pgm.createIndex('player_hands', 'game_id');

  // Game state - track current state of the game
  pgm.createTable('game_state', {
    id: 'id',
    game_id: {
      type: 'integer',
      notNull: true,
      unique: true,
      references: 'games',
      onDelete: 'CASCADE',
    },
    current_turn_player_id: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    hidden_joker_rank: {
      type: 'varchar(5)',
    },
    winner_id: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    turn_number: {
      type: 'integer',
      default: 0,
    },
    last_action: {
      type: 'text',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('game_state', 'game_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('game_state');
  pgm.dropTable('player_hands');
  pgm.dropTable('game_cards');
}

