import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ====== Config DB (Neon / Postgres) ======
if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL no está definida. Añádela en Render → Environment → DATABASE_URL");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requiere SSL en la mayoría de planes gratuitos
  ssl: { rejectUnauthorized: false },
});

// Crea tabla si no existe
async function ensureSchema() {
  await pool.query(`
    create table if not exists subscribers (
      id bigserial primary key,
      email text unique not null,
      created_at timestamptz not null default now(),
      ip inet
    );
    -- índice para búsquedas por email
    create index if not exists idx_subscribers_email on subscribers (lower(email));
  `);
  console.log("✅ Tabla 'subscribers' lista");
}

// ====== Express middlewares ======
app.set("trust proxy", 1);
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// CORS (ajusta orígenes a tu gusto)
const ALLOWED_ORIGINS = [
  "https://nakedcode.es",
  "https://www.nakedcode.es",
  "https://coming-soon-api.onrender.com", // por si llamas desde pruebas
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // permite curl / Postman
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.options("*", cors());

// ====== Rutas utilitarias ======
app.get("/", (req, res) => res.send("API OK"));
app.get("/health", async (req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ====== API: guardar email ======
app.post("/api/notify", async (req, res) => {
  const { email } = req.body || {};
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

  if (!email || !re.test(email)) {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  const norm = String(email).trim().toLowerCase();
  const ip = req.ip?.replace("::ffff:", "") || null;

  try {
    // Inserta evitando duplicados por email
    const q = `
      insert into subscribers (email, ip)
      values ($1, $2::inet)
      on conflict (email) do nothing
      returning id, email, created_at, ip;
    `;
    const { rows } = await pool.query(q, [norm, ip]);

    if (rows.length === 0) {
      // ya existía
      return res.json({ ok: true, message: "Ya estabas suscrito" });
    }
    return res.status(201).json({ ok: true, message: "Suscripción creada" });
  } catch (err) {
    console.error("❌ Error insertando suscriptor:", err);
    return res.status(500).json({ ok: false, error: "Error de servidor" });
  }
});

// ====== Export CSV (proteger con ADMIN_TOKEN) ======
app.get("/admin/export.csv", async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.headers["x-admin-token"] !== token && req.query.token !== token) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const { rows } = await pool.query(
      `select email, created_at, coalesce(ip::text,'') as ip
       from subscribers
       order by created_at desc`
    );

    const csv = [
      "email,created_at,ip",
      ...rows.map((r) => `${r.email},${r.created_at.toISOString()},${r.ip}`),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=subscribers.csv");
    res.send(csv);
  } catch (err) {
    console.error("❌ Error generando CSV:", err);
    res.status(500).send("Server error");
  }
});

// ====== Arranque ======
(async () => {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`🚀 API lista en puerto ${PORT}`);
    });
  } catch (e) {
    console.error("❌ Error al iniciar:", e);
    process.exit(1);
  }
})();
