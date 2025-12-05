import express from "express";
import createHttpError from "http-errors";
import morgan from "morgan";
import * as path from "path";
import session from "express-session";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";

import rootRoutes from "./routes/roots";
import { userRoutes } from "./routes/users";
import authRoutes from "./routes/auth";
import lobbyRoutes from "./routes/lobby";
import gamesRoutes from "./routes/games";

configDotenv();

const app = express();
const PORT = process.env.PORT || 3001;
const isDev = process.env.NODE_ENV !== "production";

// --- Middleware setup ---

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(morgan("dev"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Serve static files (CSS, JS, images)
const publicDir = isDev
  ? path.join(process.cwd(), "src", "backend", "public")
  : path.join("dist", "public");
app.use(express.static(publicDir));

// Views location + engine
const viewsDir = isDev
  ? path.join(process.cwd(), "src", "backend", "views")
  : path.join(__dirname, "views");
app.set("views", viewsDir);
app.set("view engine", "ejs");

// Make currentUser available to all views
app.use((req, res, next) => {
  const s: any = (req as any).session;
  if (s && s.userId) {
    res.locals.currentUser = { id: s.userId, username: s.username };
  } else {
    res.locals.currentUser = null;
  }
  next();
});

// --- Routes ---

// Redirect root to login or lobby based on session
app.get("/", (req, res) => {
  const s: any = (req as any).session;
  if (s && s.userId) {
    return res.redirect("/lobby");
  }
  return res.redirect("/auth/login");
});

// Auth routes (login, signup, logout)
app.use("/auth", authRoutes);

// Lobby + game routes
app.use("/lobby", lobbyRoutes);
app.use("/games", gamesRoutes);

// Existing example routes (optional)
app.use("/users", userRoutes);
app.use("/", rootRoutes);

// 404 handler
app.use((_request, _response, next) => {
  next(createHttpError(404, "Page not found"));
});

// Error handler middleware (must be last)
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = err.status || 500;
    const message = err.message || "Internal Server Error";

    console.error(`Error ${status}:`, message);
    if (isDev && err.stack) {
      console.error(err.stack);
    }

    // Render your styled error page
    res.status(status).render("error", { message });
  }
);

const server = app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
