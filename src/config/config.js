import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

export const CONFIG = {
  PORT: parseInt(process.env.PORT || "5000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174",
  SCRAPER: {
    HEADLESS: process.env.SCRAPER_HEADLESS === "true",
    SLOWMO: parseInt(process.env.SCRAPER_SLOWMO || "500", 10),
    TIMEOUT: parseInt(process.env.SCRAPER_TIMEOUT || "60000", 10),
  },
};

export default CONFIG;
