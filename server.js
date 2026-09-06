import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

dotenv.config();

// CommonJS module imports for backend models and routes
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const connectDB = require("./Server/config/db.js");
const authRoutes = require("./Server/routes/auth.js");
const predictRoute = require("./Server/routes/predictRoute.js");
const extractRoute = require("./Server/routes/extractRoute.js");
const historyRoute = require("./Server/routes/historyRoute.js");

// Connect MongoDB if available
connectDB();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API Routes
  app.use("/api/auth", authRoutes);
  app.use("/api", predictRoute);
  app.use("/api", extractRoute);
  app.use("/api/history", historyRoute);

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Electricity Bill Predictor API",
      timestamp: new Date().toISOString(),
      keys: {
        geminiApiKey: Boolean(process.env.GEMINI_API_KEY),
        geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        mongoDb: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI),
        jwtSecret: Boolean(process.env.JWT_SECRET),
        smtpConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
      },
    });
  });

  // Vite middleware in dev / Static files in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port: 3000 },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n⚡ Electricity Bill Predictor Server running:`);
    console.log(`   ➜ Local:   http://localhost:${PORT}`);
    console.log(`   ➜ Network: http://127.0.0.1:${PORT}\n`);
  });
}

startServer();
