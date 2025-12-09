import { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { sessionMiddleware } from "../config/session";
import logger from "../lib/logger";
import type { User } from "../types/types";
import { GLOBAL_ROOM } from "../../shared/chat-key";

export default function initSockets(httpServer: HttpServer) {
  const io = new IOServer(httpServer);

  // attach express-session middleware to engine.io so sockets have access to session
  // engine.io exposes the raw request/response; wrap the middleware
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io.engine.use((req: any, res: any, next: any) => sessionMiddleware(req, res, next));

  io.on("connection", (socket) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = socket.request as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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