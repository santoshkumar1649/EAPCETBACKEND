import { loadWorkbook, findStudentByHallTicket } from "../services/excelService.js";

/**
 * GET /api/student/:hallticket
 * Looks up a single student's result — prefers the Summary sheet (post-fetch,
 * rich: subjects + rank) and falls back to Master (pre-fetch, basic info).
 */
export const getStudentByHallTicket = async (req, res, next) => {
  try {
    const { hallticket } = req.params;
    const workbook = await loadWorkbook();
    const student = findStudentByHallTicket(workbook, hallticket);

    if (!student) {
      return res.status(404).json({ success: false, error: `No student found with HallTicket: ${hallticket}` });
    }

    return res.status(200).json({ success: true, student });
  } catch (error) {
    next(error);
  }
};

export default getStudentByHallTicket;
