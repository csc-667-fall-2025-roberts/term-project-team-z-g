// src/backend/server.ts
import express from "express";
import createHttpError from "http-errors";
import morgan from "morgan";
import * as path from "path";

import rootRoutes from "./routes/roots";
import { testRouter } from "./routes/test";

const app = express();

const PORT = process.env.PORT || 3000;

app.use(morgan("dev"));
app.use(express.static(path.join(process.cwd(), "src/backend/public")));
app.set("views", path.join(process.cwd(), "src/backend/views"));
app.set("view engine", "ejs");

app.use("/", rootRoutes);
app.use("/test", testRouter);

app.use((_request, _response, next) => {
  next(createHttpError(404));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
