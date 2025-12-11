import { NextFunction, Request, Response } from "express";

const requireUser = (request: Request, response: Response, next: NextFunction) => {
  console.log("requireUser - session:", request.session);
  console.log("requireUser - session.user:", request.session.user);
  console.log("requireUser - session.id:", request.sessionID);
  
  if (request.session.user === undefined) {
    console.log("requireUser - user not found, redirecting");
    response.redirect("/");
    return;
  }

  console.log("requireUser - user found, allowing access");
  next();
};

export default requireUser;
