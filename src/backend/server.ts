// src/backend/server.ts
import express from "express";
import createHttpError from "http-errors";
import morgan from "morgan";
import * as path from "path";

import rootRoutes from "./routes/roots";
import { userRouter } from "./routes/users";

const app = express();

const PORT = process.env.PORT || 3000;

// Middleware & Configuration
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "src/backend/public")));
app.set("views", path.join(process.cwd(), "src/backend/views"));
app.set("view engine", "ejs");

// Routes
app.use("/", rootRoutes);
app.use("/users", userRouter);

// Error handling - MUST be last
app.use((_request, _response, next) => {
  next(createHttpError(404));
});

// Express error handler
app.use((err: any, _request: any, response: any, _next: any) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  response.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});