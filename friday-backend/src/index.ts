// src/index.ts
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import fridayRoutes from "./routes"; // alebo "./friday/routes" podľa umiestnenia

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use("/friday", fridayRoutes(prisma));
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
