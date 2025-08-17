import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás de proxy (Hostinger) para que req.ip y x-forwarded-* funcionen bien
app.set("trust proxy", 1);

// Seguridad + logs + JSON
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// Servir frontend (index.html, css, js)
app.use(express.static(__dirname));

// === DB con lowdb (JSON plano) ===
const file = join(__dirname, "subscribers.json");
const adapter = new JSONFile(file);
const db = new Low(adapter, { subscriptions: [] });

// Asegura estructura inicial aunque el fichero no exista todavía
await db.read();
if (!db.data || !Array.isArray(db.data.subscriptions)) {
  db.data = { subscriptions: [] };
  await db.write();
}

// API: guardar email
app.post("/api/notify", async (req, res) => {
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
  });
  await db.write();

  return res.status(201).json({ ok: true, message: "Suscripción creada" });
});

// Export CSV (PROTEGER con token simple)
app.get("/admin/export.csv", async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (
    token &&
    req.headers["x-admin-token"] !== token &&
    req.query.token !== token
  ) {
    return res.status(401).send("Unauthorized");
  }

  await db.read();
  const rows = db.data.subscriptions;
  const csv = [
    "email,created_at",
    ...rows.map((r) => `${r.email},${r.created_at}`),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
  res.send(csv);
});

// Fallback a index.html (para rutas desconocidas)
app.get("*", (req, res) => res.sendFile(join(__dirname, "index.html")));

// Arranque
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});
