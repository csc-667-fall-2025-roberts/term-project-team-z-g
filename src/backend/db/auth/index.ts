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

const login = async (username: string, clearTextPassword: string) => {
  // Use oneOrNone so we can handle the "no rows" case without an exception
  const secureUser = await db.oneOrNone<SecureUser>(LOGIN, [username]);

  if (!secureUser) {
    // No user found with that username
    throw new Error("Invalid login information");
  }

  const isValid = await bcrypt.compare(clearTextPassword, secureUser.password);
  if (!isValid) {
    throw new Error("Invalid login information");
  }

  const { id, username: uname, email, created_at } = secureUser;
  return { id, username: uname, email, created_at };
};

export { login, signup };