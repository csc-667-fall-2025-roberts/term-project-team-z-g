import { MigrationBuilder } from 'node-pg-migrate';

const TABLE = 'games';
const CONSTRAINT = 'games_max_players_between_2_and_4';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addConstraint(TABLE, CONSTRAINT, {
    check: 'max_players >= 2 AND max_players <= 4'
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint(TABLE, CONSTRAINT);
}
