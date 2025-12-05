import express from "express";
import { GLOBAL_ROOM, CHAT_MESSAGE, CHAT_LISTING } from "../../shared/chat-key";
import { Chat } from "../db";

const router = express.Router();

router.get("/", async (request, response) => {
  // Respond immediately to avoid blocking the request
  response.status(202).send();

  const messages = await Chat.list();
  const io = request.app.get("io");

  // send listing to the requesting session room if available, otherwise broadcast to global room
  const sid = String(request.sessionID || "");
  if (sid && io) {
    io.to(sid).emit(CHAT_LISTING, { messages });
  } else if (io) {
    io.to(GLOBAL_ROOM).emit(CHAT_LISTING, { messages });
  }
});

router.post("/", async (request, response) => {
  response.status(202).send();

  const { message } = request.body;
  const { id } = request.session.user!;

  const result = await Chat.create(id, message);
  
  const io = request.app.get("io");
  if (io) io.to(GLOBAL_ROOM).emit(CHAT_MESSAGE, { message: result });
});

export default router;
