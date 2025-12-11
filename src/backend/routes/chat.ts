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
    const session: any = (request as any).session;
    
    if (!session || !session.user) {
      console.error("Chat POST - No user in session");
      return response.status(401).json({ error: "Not authenticated" });
    }
    
    const { id } = session.user;
    console.log("Chat POST - Creating message from user", id, "message:", message);

    const result = await Chat.create(id, message);
    console.log("Chat POST - Message created:", result);
    
    const io = request.app.get("io");
    if (io) {
      console.log("Chat POST - Emitting to GLOBAL_ROOM");
      io.to(GLOBAL_ROOM).emit(CHAT_MESSAGE, { message: result });
    } else {
      console.error("Chat POST - No io found");
    }

    response.status(202).send();
  } catch (error) {
    console.error("Error creating chat message:", error);
    response.status(500).json({ error: "Failed to create message" });
  }
});

export default router;
