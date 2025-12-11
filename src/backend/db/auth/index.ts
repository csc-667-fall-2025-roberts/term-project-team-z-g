import bcrypt from "bcrypt";
import type { SecureUser, User } from "../../types/types";
import db from "../connection";
import { LOGIN, SIGNUP } from "./sql";

const signup = async (username: string, email: string, clearTextPassword: string) => {
  const password = await bcrypt.hash(clearTextPassword, 10);
  
  try {
    return await db.one<User>(SIGNUP, [username, email, password]);
  } catch (err) {
    console.error(err);
    throw new Error("Email or username invalid");
  }
};

const login = async (usernameOrEmail: string, clearTextPassword: string) => {
  const identifier = usernameOrEmail.trim();
  console.log("Auth.login - Looking up user:", identifier);
  // Use oneOrNone so we can handle the "no rows" case without an exception
  const secureUser = await db.oneOrNone<SecureUser>(LOGIN, [identifier]);

  if (!secureUser) {
    // No user found with that username
    console.log("Auth.login - User not found:", identifier);
    throw new Error("Invalid login information");
  }

  console.log("Auth.login - User found:", secureUser.username);
  const isValid = await bcrypt.compare(clearTextPassword, secureUser.password);
  console.log("Auth.login - Password valid:", isValid);
  if (!isValid) {
    throw new Error("Invalid login information");
  }

  const { id, username: uname, email, created_at } = secureUser;
  return { id, username: uname, email, created_at };
};

export { login, signup };