import express from "express";
import db from "../db/connection";

const router = express.Router();

// Helper to get session safely in TS
function getSession(req: express.Request): any {
  return (req as any).session;
}

// GET /auth/login – show login form
router.get("/login", (req, res) => {
  res.render("login", { error: undefined });
});

// POST /auth/login – handle login
router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).render("login", { error: "Email and password are required." });
  }

  try {
    const user = await db.oneOrNone<{
      id: number;
      username: string;
      email: string;
      password: string;
    }>("SELECT * FROM users WHERE email = $1", [email]);

    if (!user || user.password !== password) {
      return res.status(401).render("login", { error: "Invalid email or password." });
    }

    const session = getSession(req);
    session.userId = user.id;
    session.username = user.username;

    return res.redirect("/lobby");
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).render("login", { error: "Unexpected error during login." });
  }
});

// GET /auth/signup – show signup form
router.get("/signup", (req, res) => {
  res.render("signup", { error: undefined });
});

// POST /auth/signup – create new user
router.post("/signup", async (req, res) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || !email || !password) {
    return res
      .status(400)
      .render("signup", { error: "Username, email, and password are required." });
  }

  try {
    // check if email already taken
    const existing = await db.oneOrNone("SELECT id FROM users WHERE email = $1", [email]);
    if (existing) {
      return res.status(409).render("signup", { error: "Email is already in use." });
    }

    const user = await db.one<{ id: number; username: string }>(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username",
      [username, email, password] // NOTE: plain text for class project; hash in real apps
    );

    const session = getSession(req);
    session.userId = user.id;
    session.username = user.username;

    return res.redirect("/lobby");
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).render("signup", { error: "Unexpected error during signup." });
  }
});

// GET /auth/logout – clear session
router.get("/logout", (req, res) => {
  const session = getSession(req);
  if (session) {
    session.destroy(() => {
      res.redirect("/auth/login");
    });
  } else {
    res.redirect("/auth/login");
  }
});

export default router;
