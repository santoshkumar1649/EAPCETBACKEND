import express from "express";
import { getStudentByHallTicket } from "../controllers/studentController.js";

const router = express.Router();

/**
 * @route   GET /api/student/:hallticket
 * @desc    Look up a single student's stored result from the workbook
 */
router.get("/student/:hallticket", getStudentByHallTicket);

export default router;
