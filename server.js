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

// Detrás de proxy (Render/Hostinger) para req.ip y x-forwarded-*
app.set("trust proxy", 1);

// ===== Seguridad + logs + JSON =====
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// ===== CORS: permite tu frontend en nakedcode.es =====
const ALLOWED_ORIGINS = [
  "https://nakedcode.es",
  "https://www.nakedcode.es",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // permite Postman/curl
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Importante: responder a las peticiones preflight de navegadores móviles
app.options("*", cors());

// ===== Base de datos (lowdb con JSON) =====
const file = join(__dirname, "subscribers.json");
const adapter = new JSONFile(file);
const db = new Low(adapter, { subscriptions: [] });

await db.read();
if (!db.data || !Array.isArray(db.data.subscriptions)) {
  db.data = { subscriptions: [] };
  await db.write();
}

// ===== Rutas utilitarias =====
app.get("/", (req, res) => res.send("API OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// ===== API: guardar email =====
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
    ip: req.ip,
  });
  await db.write();

  return res.status(201).json({ ok: true, message: "Suscripción creada" });
});

// ===== Export CSV (opcional, protegido por token) =====
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
    "email,created_at,ip",
    ...rows.map((r) => `${r.email},${r.created_at},${r.ip ?? ""}`),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=subscribers.csv"
  );
  res.send(csv);
});

// ===== Arranque =====
app.listen(PORT, () => {
  console.log(`🚀 API lista en puerto ${PORT}`);
});
