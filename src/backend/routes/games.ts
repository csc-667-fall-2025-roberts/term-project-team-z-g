import express from "express";
import createHttpError from "http-errors";
import { Games } from "../db";

const router = express.Router();

// GET /games – list all games
router.get("/", async (req, res, next) => {
  try {
    const games = await Games.list();
    res.json(games);
  } catch (err) {
    next(err);
  }
});

// POST /games – create a new game
router.post("/", async (req, res, next) => {
  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const game = await Games.create(session.user.id);
    const io = req.app.get("io");
    
    if (io) {
      io.emit("game:created", { game });
    }
    
    res.status(201).json(game);
  } catch (err) {
    next(err);
  }
});

// GET /games/:id – show single game
router.get("/:id", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const game = await Games.get(gameId);

    if (!game) {
      return next(createHttpError(404, "Game not found"));
    }

    return res.render("games/game", { game });
  } catch (err) {
    next(err);
  }
});

// POST /games/:id/join – join a game
router.post("/:id/join", async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const session: any = (req as any).session;
    if (!session || !session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    await Games.join(gameId, session.user.id);
    const io = req.app.get("io");
    
    if (io) {
      io.emit("game:joined", { gameId, userId: session.user.id });
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
