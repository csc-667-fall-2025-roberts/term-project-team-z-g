import express from "express";
import createHttpError from "http-errors";
import db from "../db/connection";

const router = express.Router();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session: any = (req as any).session;
  if (!session || !session.userId) {
    return res.redirect("/auth/login");
  }
  next();
}

// GET /games/:id – show single game with mockup layout
router.get("/:id", requireAuth, async (req, res, next) => {
  const gameId = Number(req.params.id);
  if (Number.isNaN(gameId)) {
    return next(createHttpError(400, "Invalid game id"));
  }

  try {
    const game = await db.oneOrNone<{
      id: number;
      name: string;
      state: string;
      max_players: number;
      hidden_joker_rank: string | null;
      created_at: Date;
    }>("SELECT * FROM games WHERE id = $1", [gameId]);

    if (!game) {
      return next(createHttpError(404, "Game not found"));
    }

    return res.render("game", { game });
  } catch (err) {
    next(err);
  }
});

export default router;
