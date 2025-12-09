import express from "express";
import { GLOBAL_ROOM, CHAT_MESSAGE, CHAT_LISTING } from "../../shared/chat-key";
import { Chat } from "../db";

const router = express.Router();

router.get("/", async (request, response) => {
  try {
    const messages = await Chat.list();
    const io = request.app.get("io");

    // send listing to the requesting session room if available, otherwise broadcast to global room
    const sid = String(request.sessionID || "");
    if (sid && io) {
      io.to(sid).emit(CHAT_LISTING, { messages });
    } else if (io) {
      io.to(GLOBAL_ROOM).emit(CHAT_LISTING, { messages });
    }

    response.status(202).send();
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    response.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/", async (request, response) => {
  try {
    const { message } = request.body;
    const { id } = request.session.user!;

    const result = await Chat.create(id, message);
    
    const io = request.app.get("io");
    if (io) io.to(GLOBAL_ROOM).emit(CHAT_MESSAGE, { message: result });

    response.status(202).send();
  } catch (error) {
    console.error("Error creating chat message:", error);
    response.status(500).json({ error: "Failed to create message" });
  }
});

export default router;
