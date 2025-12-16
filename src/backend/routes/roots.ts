import express from "express";
import { GameLogic } from "../services/game-logic";
import db from "../db/connection";

const router = express.Router();

router.get("/", (_request, response) => {
  response.render("root");
});

// POST /api/games/:id/restart?force=1 - Force restart endpoint (no auth required)
router.post("/api/games/:id/restart", async (req, res, next) => {
  const force = req.query.force === "1" || req.query.force === "true";
  if (!force) {
    return res.status(400).json({ error: "Use ?force=1 to restart" });
  }

  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return res.status(400).json({ error: "Invalid game id" });
  }

  try {
    const players = await db.manyOrNone<{ user_id: number }>(
      `SELECT gp.user_id FROM game_players gp
       LEFT JOIN player_hands ph ON ph.game_id = gp.game_id AND ph.player_id = gp.user_id
       WHERE gp.game_id = $1
       ORDER BY COALESCE(ph.hand_order, gp.id)`,
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
});

export default router;
