import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

// Seguridad + logs + JSON
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// CORS (ajusta origins si quieres restringir)
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.options("*", cors());

// ---------- POSTGRES ----------
if (!process.env.DATABASE_URL) {
  console.error("❌ Falta DATABASE_URL");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // para Neon en Render
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      ip TEXT
    );
  `);
  console.log("✅ Tabla 'subscribers' lista");
}

// Rutas utilitarias
app.get("/", (req, res) => res.send("API OK"));
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

// API notify
app.post("/api/notify", async (req, res) => {
  const { email } = req.body || {};
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

  if (!email || !re.test(email)) {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  const norm = String(email).trim().toLowerCase();

  try {
    // inserta ignorando duplicados (por UNIQUE en email)
    const result = await pool.query(
      `INSERT INTO subscribers (email, ip)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id;`,
      [norm, req.ip]
    );

    if (result.rowCount === 0) {
      return res.json({ ok: true, message: "Ya estabas suscrito" });
    }
    return res.status(201).json({ ok: true, message: "Suscripción creada" });
  } catch (err) {
    console.error("❌ Error insertando:", err);
    return res.status(500).json({ ok: false, error: "DB error" });
  }
});

app.listen(PORT, async () => {
  try {
    await ensureSchema();
    console.log(`🚀 API lista en puerto ${PORT}`);
  } catch (e) {
    console.error("❌ Error al iniciar:", e);
    process.exit(1);
  }
});
