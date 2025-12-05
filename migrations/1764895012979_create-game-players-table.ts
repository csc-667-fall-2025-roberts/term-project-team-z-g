import { MigrationBuilder, PgType } from "node-pg-migrate";

const TABLE_NAME = "game_players";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(TABLE_NAME, {
    id: "id",

    game_id: {
      type: "integer",
      notNull: true,
      references: '"games"',
      onDelete: "CASCADE",
    },

    user_id: {
      type: "integer",
      notNull: true,
      references: '"users"',
      onDelete: "CASCADE",
    },

    joined_at: {
      type: PgType.TIMESTAMP,
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // prevent same user joining same game twice
  pgm.addConstraint(TABLE_NAME, "game_players_game_user_unique", {
    unique: ["game_id", "user_id"],
  });

  pgm.createIndex(TABLE_NAME, ["game_id"]);
  pgm.createIndex(TABLE_NAME, ["user_id"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(TABLE_NAME);
}

