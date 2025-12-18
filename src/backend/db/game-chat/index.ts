import db from "../connection";
import * as sql from "./sql";

export const list = async (game_id: number, limit: number = 50) => {
  return db.any(sql.RECENT_GAME_MESSAGES, [game_id, limit]);
};

export const create = async (game_id: number, user_id: number, message: string) => {
  return db.one(sql.CREATE_GAME_MESSAGE, [game_id, user_id, message]);
};
