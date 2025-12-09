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

// Set up livereload in development (optional)
const isDevelopment = process.env.NODE_ENV !== "production";
if (isDevelopment) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const livereload = require("livereload");
    const liveReloadServer = livereload.createServer({ exts: ["ejs", "css", "js"] });
    liveReloadServer.watch([path.join(__dirname, "views"), path.join(__dirname, "public")]);
  } catch (_err) {
    logger.warn("livereload not installed; skipping live reload");
  }
}

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

// Try to initialize sockets if available (optional)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const initSockets = require("./sockets").default;
  if (typeof initSockets === "function") {
    app.set("io", initSockets(httpServer));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (_err) {
    logger.info("Socket initialization skipped (no ./sockets module)");
    logger.error(String(_err));
  }// Filter out browser-generated requests from logs
if (isDevelopment) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
// Optional routes (chat/games) not present in all branches
app.use("/chat", requireUser, routes.chat);
//app.use("/games", requireUser, routes.games);

app.use((_req, _res, next) => {
  next(createHttpError(404));
});

// Error handler middleware (must be last)
app.use((err: Error, req: express.Request, res: express.Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (err as any).status || 500;
  const message = err.message || "Internal Server Error";
  const isProduction = process.env.NODE_ENV === "production";

  // Skip logging browser-generated requests
  if (!req.url.startsWith("/.well-known/")) {
    const errorMsg = `${message} (${req.method} ${req.url})`;

    if (isProduction) {
      // Production: Log to file with full stack, show concise console message
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger.error(`${errorMsg} - stack: ${String((err as any)?.stack)}`);
      console.error(`Error ${status}: ${message} - See logs/error.log for details`);
    } else {
      // Development: Log everything to console
      logger.error(`${errorMsg} - ${String(err)}`);
    }
  }

  res.status(status).render("error/error", {
    status,
    message,
    stack: isProduction ? null : err.stack,
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

httpServer.on("error", (error) => {
  logger.error(`Server error: ${String(error)}`);
});