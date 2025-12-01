import { MigrationBuilder, PgType } from 'node-pg-migrate';

const TABLE_NAME = 'users';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(TABLE_NAME, {
    id: 'id',
    username: {
      type: `${PgType.VARCHAR}(50)`,
      notNull: true,
      unique: true,
    },
    email: {
      type: `${PgType.VARCHAR}(255)`,
      notNull: true,
      unique: true,
    },
    password: {
      type: `${PgType.VARCHAR}(100)`,
      notNull: true,
    },
    created_at: {
      type: PgType.TIMESTAMP,
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable(TABLE_NAME);
}