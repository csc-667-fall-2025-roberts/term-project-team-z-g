import express from "express";
import db from "../db/connection";

const router = express.Router();

// GET /users - list all users (authenticated only)
router.get("/", async (_req, res, next) => {
  try {
    const users = await db.manyOrNone(
      `SELECT id, username, email, created_at
       FROM users
       ORDER BY id`
    );
    res.json(users);
  } catch (error) {
    next(error);
  }
});

export default router;
