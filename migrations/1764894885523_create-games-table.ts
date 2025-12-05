import { MigrationBuilder, PgType } from "node-pg-migrate";

const TABLE_NAME = "games";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(TABLE_NAME, {
    id: "id",

    name: {
      type: `${PgType.VARCHAR}(100)`,
      notNull: true,
    },

    created_by: {
      type: "integer",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE",
    },

    state: {
      type: `${PgType.VARCHAR}(20)`,
      notNull: true,
      default: "waiting", // 'waiting' | 'playing' | 'ended'
    },

    max_players: {
      type: "integer",
      notNull: true,
    },

    hidden_joker_rank: {
      type: `${PgType.VARCHAR}(5)`,
      notNull: false,
    },

    created_at: {
      type: PgType.TIMESTAMP,
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex(TABLE_NAME, "created_by");
  pgm.createIndex(TABLE_NAME, "state");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(TABLE_NAME);
}
