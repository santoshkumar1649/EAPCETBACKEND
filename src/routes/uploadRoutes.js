import express from "express";
import { scrapeResult } from "../services/scraperService.js";

const router = express.Router();

/**
 * @route   POST /api/upload/result
 * @desc    Alternative result scraping route
 * @access  Public
 */
router.post("/result", async (req, res, next) => {
  try {
    const { regno, hallticket } = req.body;

    if (!regno || !hallticket) {
      return res.status(400).json({
        success: false,
        message: "Registration Number and Hallticket are required",
      });
    }

    const response = await scrapeResult({
      regno,
      hallticket,
    });

    if (response.success) {
      return res.json({
        success: true,
        result: response.result,
      });
    } else {
      return res.status(422).json({
        success: false,
        error: response.error,
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;