import express from "express";
import createHttpError from "http-errors";
import morgan from "morgan";
import * as path from "path";
import { sessionMiddleware } from "./config/session";
import bodyParser from "body-parser";
import { configDotenv } from "dotenv";
import * as routes from "./routes";
import { requireUser } from "./middleware";

configDotenv();

const app = express();

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== "production";


// Filter out browser-generated requests from logs
app.use(
  morgan("dev", {
    skip: (req) => req.url.startsWith("/.well-known"),
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

app.use(sessionMiddleware)

app.use("/", routes.root);
app.use("/auth", routes.auth);
app.use("/lobby", requireUser, routes.lobby);

app.use((_request, _response, next) => {
  next(createHttpError(404));
});

// Error handler middleware (must be last)
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next;
  const errorObj = typeof err === 'object' && err !== null
    ? (err as { status?: unknown; message?: unknown; stack?: unknown })
    : {};

  const status = typeof errorObj.status === 'number' ? errorObj.status : 500;
  const message = typeof errorObj.message === 'string' ? errorObj.message : 'Internal Server Error';

  console.error(`Error ${status}:`, message);
  if (isDev && typeof errorObj.stack === "string") {
    console.error(errorObj.stack);
  }

  res
    .status(status)
    .send(
      isDev
        ? `<html><body><h1>Error ${status}</h1><pre>${message}\n\n${typeof errorObj.stack === 'string' ? errorObj.stack : ""}</pre></body></html>`
        : `<html><body><h1>Error ${status}</h1><p>${message}</p></body></html>`,
    );
});

const server = app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
