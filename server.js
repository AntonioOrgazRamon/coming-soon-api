import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

// 🛡️ Seguridad + logs + JSON
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());

// 🌍 CORS abierto (ajusta si quieres limitar dominios)
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.options("*", cors());

// 🗄️ Conexión a PostgreSQL (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // necesario en Neon
});

// 🚑 Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// 📩 Endpoint de suscripción
app.post("/api/notify", async (req, res) => {
  console.log("📩 POST recibido:", req.body, "desde IP:", req.ip);
  const { email } = req.body || {};
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

  if (!email || !re.test(email)) {
    return res.status(400).json({ ok: false, error: "Email inválido" });
  }

  const norm = String(email).trim().toLowerCase();

  try {
    // Verificar si ya existe
    const exists = await pool.query(
      "SELECT 1 FROM subscribers WHERE email = $1",
      [norm]
    );

    if (exists.rowCount > 0) {
      return res.json({ ok: true, message: "Ya estabas suscrito" });
    }

    // Insertar en PostgreSQL
    await pool.query(
      "INSERT INTO subscribers (email, created_at, ip) VALUES ($1, NOW(), $2)",
      [norm, req.ip]
    );

    return res.status(201).json({ ok: true, message: "Suscripción creada" });
  } catch (err) {
    console.error("❌ Error DB:", err);
    return res.status(500).json({ ok: false, error: "Error en el servidor" });
  }
});

// 📤 Exportar como CSV desde PostgreSQL
app.get("/admin/export.csv", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT email, created_at, ip FROM subscribers ORDER BY created_at DESC"
    );

    const rows = result.rows;
    const csv = [
      "email,created_at,ip",
      ...rows.map(
        (r) => `${r.email},${r.created_at.toISOString()},${r.ip ?? ""}`
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=subscribers.csv"
    );
    res.send(csv);
  } catch (err) {
    console.error("❌ Error exportando CSV:", err);
    res.status(500).send("Error exportando CSV");
  }
});

// 🚀 Arranque
app.listen(PORT, () => {
  console.log(`🚀 API lista en puerto ${PORT}`);
});
