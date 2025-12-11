import { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { sessionMiddleware } from "../config/session";
import logger from "../lib/logger";
import type { User } from "../types/types";
import { GLOBAL_ROOM, CHAT_LISTING, CHAT_MESSAGE } from "../../shared/chat-key";
import { Chat } from "../db";
import { initGameSockets } from "./game";

export default function initSockets(httpServer: HttpServer) {
  const io = new IOServer(httpServer);

  // attach express-session middleware to engine.io so sockets have access to session
  // engine.io exposes the raw request/response; wrap the middleware
  io.engine.use((req: any, res: any, next: any) => sessionMiddleware(req, res, next));

  io.on("connection", async (socket) => {
    const req = socket.request as any;
    const session = req.session as { user?: User } | undefined;

    if (!session || !session.user) {
      logger.info("Socket connected without authenticated session; disconnecting");
      socket.disconnect(true);
      return;
    }

    logger.info(`socket for user ${session.user.username} established`);

    // join two rooms: the session id (so server can target this session) and a global room
    const sid = String(req.sessionID || "");
    if (sid) socket.join(sid);
    socket.join(GLOBAL_ROOM);

    // Send recent messages to new connection
    try {
      const messages = await Chat.list();
      socket.emit(CHAT_LISTING, { messages });
    } catch (error) {
      logger.info(String(error));
    }

    // Initialize game socket handlers
    initGameSockets(io, socket);

    socket.on("disconnect", () => {
      if (session && session.user) {
        logger.info(`socket for user ${session.user.username} disconnected`);
      } else {
        logger.info("socket disconnected");
      }
    });
  });

  return io;
}