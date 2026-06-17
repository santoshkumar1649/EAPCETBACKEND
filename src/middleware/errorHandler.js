import CONFIG from "../config/config.js";

/**
 * Global Error Handler Middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error("🔴 [Global Error Handler]:", err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(CONFIG.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export default errorHandler;
