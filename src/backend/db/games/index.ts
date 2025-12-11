import type { Game } from "../../types/types";
import db from "../connection";
import { LIST, GET, CREATE, JOIN } from "./sql";

const list = async () => {
  return await db.manyOrNone<Game>(LIST);
};

const get = async (gameId: number) => {
  return await db.oneOrNone<Game>(GET, [gameId]);
};

const create = async (userId: number, name: string = "Game", maxPlayers: number = 4) => {
  return await db.one<Game>(CREATE, [name, userId, maxPlayers]);
};

const join = async (gameId: number, userId: number) => {
  return await db.none(JOIN, [gameId, userId]);
};

export { list, get, create, join };
