import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

// Seguridad + logs + JSON
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// 🔓 CORS abierto (para pruebas)
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.options("*", cors());

// Base de datos
const file = join(__dirname, "subscribers.json");
const adapter = new JSONFile(file);
const db = new Low(adapter, { subscriptions: [] });

await db.read();
if (!db.data || !Array.isArray(db.data.subscriptions)) {
  db.data = { subscriptions: [] };
  await db.write();
}

// Rutas utilitarias
app.get("/", (req, res) => res.send("API OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// API notify
app.post("/api/notify", async (req, res) => {
  console.log("📩 POST recibido:", req.body, "desde IP:", req.ip); // 👈 log
  const { email } = req.body || {};
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

  if (!email || !re.test(email)) {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  const norm = String(email).trim().toLowerCase();

  const exists = db.data.subscriptions.find((e) => e.email === norm);
  if (exists) {
    return res.json({ ok: true, message: "Ya estabas suscrito" });
  }

  db.data.subscriptions.push({
    email: norm,
    created_at: new Date().toISOString(),
    ip: req.ip,
  });
  await db.write();

  return res.status(201).json({ ok: true, message: "Suscripción creada" });
});

// Export CSV
app.get("/admin/export.csv", async (req, res) => {
  await db.read();
  const rows = db.data.subscriptions;
  const csv = [
    "email,created_at,ip",
    ...rows.map((r) => `${r.email},${r.created_at},${r.ip ?? ""}`),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
  res.send(csv);
});

// Arranque
app.listen(PORT, () => {
  console.log(`🚀 API lista en puerto ${PORT}`);
});
