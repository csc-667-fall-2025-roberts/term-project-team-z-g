import express from "express";
import db from "../db/connection";

const router = express.Router();

router.get("/", async (_request, response) => {
  try {
    const users = await db.any("SELECT * FROM users");
    response.render("listing", { users });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    response.status(500).send("Error fetching users");
  }
});

router.get("/:id", async (request, response) => {
  const { id } = request.params;
  try {
    const user = await db.one("SELECT * FROM users WHERE id = $1", [id]);
    response.render("user", { user });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error: unknown) {
    response.redirect("/users");
  }
});

router.post("/", async (request, response) => {
  const { username, email } = request.body;

  try {
    const { id } = await db.one<{ id: number }>(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, 'password') RETURNING id",
      [username, email]
    );
    response.redirect(`/users/${id}`);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    response.status(500).send("Error creating user");
  }
});

export { router as userRoutes };