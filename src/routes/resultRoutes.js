import express from "express";
import { getResult } from "../controllers/resultController.js";

const router = express.Router();

/**
 * @route   POST /api/result
 * @desc    Submit registration & hallticket numbers to scrape and parse results
 * @access  Public
 */
router.post("/result", getResult);

export default router;