// src/backend/server.ts
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { query } from "./db";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// simple health route
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "UNO API is running!"
  });
});

// database test route
app.get("/api/db-test", async (_req, res) => {
  try {
    const { rows } = await query<{ now: string }>("SELECT NOW() as now");
    return res.json({
      status: "ok",
      now: rows[0]?.now
    });
  } catch (err) {
    console.error("DB test error:", err);
    return res.status(500).json({
      status: "error",
      message: "DB connection failed"
    });
  }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
