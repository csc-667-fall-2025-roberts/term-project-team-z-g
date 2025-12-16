import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('player_hands', {
    joker_revealed: {
      type: 'boolean',
      default: false,
      notNull: true,
      comment: 'True if player has laid down a pure sequence and can see the hidden joker rank',
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('player_hands', 'joker_revealed');
}
