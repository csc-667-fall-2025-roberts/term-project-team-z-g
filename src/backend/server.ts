import express from "express";
import createHttpError from "http-errors";
import morgan from "morgan";
import * as path from "path";
import { sessionMiddleware } from "./config/session";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";
import * as routes from "./routes";
import { requireUser } from "./middleware";
import { createServer } from "http";
import logger from "./lib/logger";

configDotenv();

const isDevelopment = process.env.NODE_ENV !== "production";

// Set up livereload in development (optional)
// Temporarily disabled due to port conflicts
/*
if (isDevelopment) {
  try {
    const livereload = require("livereload");
    const liveReloadServer = livereload.createServer({ exts: ["ejs", "css", "js"] });
    liveReloadServer.watch([path.join(__dirname, "views"), path.join(__dirname, "public")]);
    liveReloadServer.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('Livereload port in use, skipping livereload');
      } else {
        logger.error('Livereload error:', err);
      }
    });
  } catch (_err) {
    logger.warn("livereload not installed; skipping live reload");
  }
}
*/

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// Try to initialize sockets if available (optional)
try {
  const initSockets = require("./sockets").default;
  if (typeof initSockets === "function") {
    app.set("io", initSockets(httpServer));
  }
  } catch (_err) {
    logger.info("Socket initialization skipped (no ./sockets module)");
    logger.error(String(_err));
  }// Filter out browser-generated requests from logs
if (isDevelopment) {
  try {
    const connectLivereload = require("connect-livereload");
    app.use(connectLivereload());
  } catch (_err) {
    logger.warn("connect-livereload not installed; skipping injection of livereload script");
  }
}

// Filter out browser-generated requests from logs
app.use(
  morgan("dev", {
    skip: (req) => req.url.startsWith("/.well-known/"),
  }),
);
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());

// Serve static files from public directory (relative to this file's location)
// Dev: src/backend/public | Prod: dist/public
app.use(express.static(path.join(__dirname, "public")));

// Set views directory (relative to this file's location)
// Dev: src/backend/views | Prod: dist/views
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(sessionMiddleware);

app.use("/", routes.root);
app.use("/auth", routes.auth);
app.use("/lobby", requireUser, routes.lobby);
app.use("/chat", requireUser, routes.chat);
// Allow force-restart to bypass requireUser
app.post("/games/:id/restart", async (req, res, next) => {
  const force = req.query.force === "1" || req.query.force === "true";
  if (force) {
    const gameId = Number(req.params.id);
    if (Number.isNaN(gameId)) {
      return res.status(400).json({ error: "Invalid game id" });
    }
    try {
      const { GameLogic } = await import("./services/game-logic");
      const db = (await import("./db/connection")).default;
      const players = await db.manyOrNone<{ user_id: number }>(
        `SELECT user_id FROM game_players WHERE game_id = $1 ORDER BY hand_order`,
        [gameId]
      );
      if (!players.length) {
        return res.status(400).json({ error: "No players in this game" });
      }
      console.log("[force-restart] Restarting game", gameId);
      await GameLogic.initializeGame(gameId, players.map(p => p.user_id));
      const io = req.app.get("io");
      if (io) {
        io.to(`game:${gameId}`).emit("game:restart", { gameId, force: true });
        io.to(`game:${gameId}`).emit("game:state-refresh", { gameId });
      }
      return res.json({ success: true, message: "Game restarted" });
    } catch (err) {
      console.error("[force-restart] Error:", err);
      return next(err);
    }
  }
  next();
});

app.use("/games", requireUser, routes.games);
app.use("/users", requireUser, routes.users);

app.use((_req, _res, next) => {
  next(createHttpError(404));
});

// Error handler middleware (must be last)
app.use((err: Error, req: express.Request, res: express.Response) => {
  const status = (err as any).status || 500;
  const message = err.message || "Internal Server Error";
  const isProduction = process.env.NODE_ENV === "production";

  // Skip logging browser-generated requests
  if (!req.url.startsWith("/.well-known/")) {
    const errorMsg = `${message} (${req.method} ${req.url})`;

    if (isProduction) {
      // Production: Log to file with full stack, show concise console message
      logger.error(`${errorMsg} - stack: ${String((err as any)?.stack)}`);
      console.error(`Error ${status}: ${message} - See logs/error.log for details`);
    } else {
      // Development: Log everything to console
      logger.error(`${errorMsg} - ${String(err)}`);
    }
  }

  // Check if this is an API request (returns JSON) or HTML request
  const isApiRequest = req.url.startsWith('/api/') || req.url.startsWith('/games/') && req.url.includes('/state') || req.accepts(['json', 'html']) === 'json';
  
  if (isApiRequest) {
    // Return JSON for API requests
    res.status(status).json({
      error: message,
      status,
      ...(isProduction ? {} : { stack: err.stack })
    });
  } else {
    // Return HTML for page requests
    res.status(status).render("error/error", {
      status,
      message,
      stack: isProduction ? null : err.stack,
    });
  }
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

httpServer.on("error", (error) => {
  logger.error(`Server error: ${String(error)}`);
});