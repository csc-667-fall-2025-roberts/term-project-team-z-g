import express from "express";
import { Auth } from "../db";

const router = express.Router();

// 1. send the user a form (signup or signin) - GET
// 2. receive signup/signin info from client - POST
// 3. logout route

router.get("/signup", async (_request, response) => {
  response.render("auth/signup", { local: { error: null } });
});

router.get("/login", async (_request, response) => {
  response.render("auth/login", { local: { error: null } });
});

router.post("/signup", async (request, response) => {
  const { username, email, password } = request.body;

  try {
    request.session.user = await Auth.signup(username, email, password);
    console.log("Session user set:", request.session.user);
    response.redirect("/lobby");
  } catch (e: any) {
    // Handle database constraint errors
    let errorMessage = "Username or email already exists";
    
    if (e.code === '23505') {
      if (e.constraint === 'users_username_key') {
        errorMessage = "Username already exists";
      } else if (e.constraint === 'users_email_key') {
        errorMessage = "Email already exists";
      }
    }
    
    response.render("auth/signup", { local: { error: errorMessage } });
  }
});

router.post("/login", async (request, response) => {
  const { username, password } = request.body;
  console.log("Login attempt - username:", username, "password:", password ? "***" : "missing");

  try {
    request.session.user = await Auth.login(username, password);
    console.log("Session user set:", request.session.user);
    response.redirect("/lobby");
  } catch (e: any) {
    console.error("Login error:", e.message);
    response.render("auth/login", { local: { error: e.message } });
  }
});

router.get("/logout", async (request, response) => {
  await new Promise((resolve, reject) => {
    request.session.destroy((err) => {
      if (err) {
        reject(err);
      } else {
        resolve("");
      }
    });
  }).catch((error) => console.error(error));

  response.redirect("/");
});

export default router;