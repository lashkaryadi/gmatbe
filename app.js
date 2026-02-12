import "dotenv/config";
import process from "process";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import rateLimit from "express-rate-limit";

// ------------------ ROUTES ------------------
import authRoutes from "./src/routes/authRoutes.js";
import profileRoutes from "./src/routes/profileRoutes.js";
import institutionRoutes from "./src/routes/institution.routes.js";
import searchRoutes from "./src/routes/search.routes.js";
import jobRoutes from "./src/routes/jobRoutes.js";
import jobApplicationRoutes from "./src/routes/jobApplicationRoutes.js";
import paymentRoutes from "./src/routes/payment.routes.js";
import webhookRoutes from "./src/routes/webhook.routes.js";

const app = express();
app.set('trust proxy', 1);


/* ------------------ CORS ------------------ */
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "https://getmeatutor.vercel.app", "https://get-me-a-tutor.vercel.app"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ----------- RATE LIMITER ----------- */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: "Too many requests, try again later." },
});

/* ----------- JSON (NORMAL APIs ONLY) ----------- */
app.use(express.json());

/* ------------------ ROUTES ------------------ */
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.use("/auth", authLimiter, authRoutes);
app.use("/profile", profileRoutes);
app.use("/api/institution", institutionRoutes);
app.use("/search", searchRoutes);
app.use("/jobs", jobRoutes);
app.use("/applications", jobApplicationRoutes);
app.use("/api/payments", paymentRoutes);

/* ----------- WEBHOOK ROUTES (RAW BODY) ----------- */
app.use("/webhooks", webhookRoutes);

/* ------------------ SERVER ------------------ */
const start = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");

    const port = process.env.PORT || 5001;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

start();

export default app;
