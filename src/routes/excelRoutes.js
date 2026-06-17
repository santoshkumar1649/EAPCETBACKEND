import express from "express";
import multer from "multer";
import {
  uploadWorkbook,
  generateSheets,
  fetchResults,
  getProgress,
  downloadWorkbook,
} from "../controllers/excelController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @route   POST /api/excel/upload
 * @desc    Upload a roster workbook (multipart field name: "workbook"); any sheet
 *          name works as long as it has HallTicket/RegistrationNumber/StudentName columns
 */
router.post("/upload", upload.single("workbook"), uploadWorkbook);

/**
 * @route   POST /api/excel/generate-sheets
 * @desc    Create Template + per-student sheets from Master, return the file
 */
router.post("/generate-sheets", generateSheets);

/**
 * @route   POST /api/excel/fetch-results
 * @desc    Bulk-scrape every Master row via the existing scraper service
 */
router.post("/fetch-results", fetchResults);

/**
 * @route   GET /api/excel/progress
 * @desc    Poll the status of an in-progress (or last) bulk fetch job
 */
router.get("/progress", getProgress);

/**
 * @route   GET /api/excel/download
 * @desc    Download the current state of the workbook
 */
router.get("/download", downloadWorkbook);

export default router;
