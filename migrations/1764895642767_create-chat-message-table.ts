import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';
import { PgType } from 'node-pg-migrate';
import { Server as HttpServer } from "http";

export const TABLE_NAME = 'chat_message';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(TABLE_NAME, {
    id:"id",
      user_id: {
      type: PgType.INTEGER,
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    message: {
      type: PgType.TEXT,
      notNull: true,
    },
    created_at: {
      type: PgType.TIMESTAMP,
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
  pgm.createIndex(TABLE_NAME, "created_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropTable(TABLE_NAME);
}

export default function initSockets(httpServer: HttpServer) {
  // placeholder: implement socket.io or other socket init here
  // const io = new Server(httpServer);
  // return io;
  return null;
}
