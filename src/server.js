import express from "express";
import cors from "cors";
import CONFIG from "./config/config.js";
import resultRoutes from "./routes/resultRoutes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// 1. Middleware
const allowedOrigins = CONFIG.FRONTEND_URL ? CONFIG.FRONTEND_URL.split(",") : ["http://localhost:5173", "http://localhost:5174"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like curl, postman, or direct mobile queries)
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

// 2. Base / Healthcheck Route
app.get("/", (req, res) => {
  res.status(200).send("EAPCET Result Extractor API Running");
});

// 3. API Routes
app.use("/api", resultRoutes);

// 4. Fallback for unhandled routes
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// 5. Global Error Handling Middleware
app.use(errorHandler);

// 6. Listen to Server
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 [Server] Running in ${CONFIG.NODE_ENV} mode on port ${CONFIG.PORT}`);
});

export default app;