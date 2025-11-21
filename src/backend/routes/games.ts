import { Router } from "express";

const router = Router();

/**
 * POST /api/games
 * Create a new UNO game
 */
router.post("/", async (req, res) => {
  try {
    // In the future:
    // 1. validate user session
    // 2. create a game in DB
    // 3. add host to game_participants

    return res.status(201).json({
      message: "Game created (placeholder)!",
      game_id: 123,
      room_code: "ABCD12"
    });
  } catch (err) {
    console.error("Create game error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
