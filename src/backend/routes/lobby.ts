import express from "express";
import db from "../db/connection";

const router = express.Router();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session: any = (req as any).session;
  if (!session || !session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

// GET /lobby – show lobby with games list
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const games = await db.manyOrNone<{
      id: number;
      name: string;
      state: string;
      max_players: number;
      hidden_joker_rank: string | null;
    }>("SELECT * FROM games ORDER BY created_at DESC");

    const session: any = (req as any).session;
    
    // Check if the current user is in any active games
    let activeGame: { id: number; name: string; state: string; player_count: number; max_players: number } | null = null;
    if (session?.user) {
      activeGame = await db.oneOrNone<{
        id: number;
        name: string;
        state: string;
        player_count: number;
        max_players: number;
      }>(
        `SELECT g.id, g.name, g.state, g.max_players, 
         (SELECT COUNT(*) FROM game_players WHERE game_id = g.id) as player_count
         FROM games g 
         JOIN game_players gp ON g.id = gp.game_id 
         WHERE gp.user_id = $1 AND g.state IN ('waiting', 'in_progress') 
         LIMIT 1`,
        [session.user.id]
      );
    }
    
    // Use the updated lobby template that shows the current user chip
    res.render("lobby/lobby", { games, user: session?.user, activeGame });
  } catch (err) {
    next(err);
  }
});

// POST /lobby/create-game – create a new game
router.post("/create-game", requireAuth, async (req, res, next) => {
  const session: any = (req as any).session;
  const { name, max_players } = req.body as { name?: string; max_players?: string };

  if (!name || !max_players) {
    return res.redirect("/lobby");
  }

  const maxPlayersInt = parseInt(max_players, 10);
  if (Number.isNaN(maxPlayersInt) || maxPlayersInt < 2 || maxPlayersInt > 4) {
    return res.redirect("/lobby");
  }

  try {
    const game = await db.one<{ id: number }>(
      "INSERT INTO games (name, created_by, state, max_players) VALUES ($1, $2, 'waiting', $3) RETURNING id",
      [name, session.user.id, maxPlayersInt]
    );

    // Auto-join the creator into the game
    await db.none(
      `INSERT INTO game_players (game_id, user_id) VALUES ($1, $2) ON CONFLICT (game_id, user_id) DO NOTHING`,
      [game.id, session.user.id]
    );

    // Optionally auto-join the creator into game_players later.
    return res.redirect(`/games/${game.id}`);
  } catch (err) {
    next(err);
  }
});

export default router;
