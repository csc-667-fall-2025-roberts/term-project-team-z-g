import { ChatMessage } from "../../types/types";
import db from "../connection";
import { CREATE_MESSAGES, RECENT_MESSAGES } from "./sql";

const list = async (limit: number = 50) => {
    return await db.manyOrNone<ChatMessage>(RECENT_MESSAGES, [limit]);
};

const create = async (user_id: number, message: string) => {
    return await db.one<ChatMessage>(CREATE_MESSAGES, [user_id, message]);
};

export { create, list };