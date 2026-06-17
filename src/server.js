import express from "express";
import cors from "cors";
import CONFIG from "./config/config.js";
import resultRoutes from "./routes/resultRoutes.js";
import excelRoutes from "./routes/excelRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import errorHandler from "./middleware/errorHandler.js";
import { startKeepAlive } from "./services/keepAliveService.js";

const app = express();

// 1. CORS Middleware configured for Vercel/localhost development
const allowedOrigins = CONFIG.FRONTEND_URL 
  ? CONFIG.FRONTEND_URL.split(",") 
  : ["http://localhost:5173", "http://localhost:5174"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like server-to-server or curl)
      if (!origin) return callback(null, true);
      
      const isLocalhost = origin.startsWith("http://localhost:") || 
                          origin.startsWith("https://localhost:") || 
                          origin.startsWith("http://127.0.0.1:") || 
                          origin.startsWith("https://127.0.0.1:");

      if (isLocalhost || allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// 2. Health check route (used by Render to monitor active service)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date() });
});

app.get("/", (req, res) => {
  res.status(200).send("AP EAPCET Result Extractor API is active and running.");
});

// 3. API Routing
app.use("/api", resultRoutes);
app.use("/api/excel", excelRoutes);
app.use("/api", studentRoutes);

// 4. Fallback for unhandled paths
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// 5. Global Exception Catcher
app.use(errorHandler);

// 6. Bind to Port & Start Keep-Alive Cron
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 [Server] Running in ${CONFIG.NODE_ENV} mode on port ${CONFIG.PORT}`);
  // Start the anti-idling Cron self-pings
  startKeepAlive();
});

export default app;