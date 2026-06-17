import { scrapeResult } from "../services/scraperService.js";
import * as progressTracker from "../services/progressTracker.js";
import {
  loadWorkbook,
  loadWorkbookFromBuffer,
  saveWorkbook,
  getMasterSheet,
  validateMasterSheet,
  readMasterRows,
  ensureFailedStudentsSheet,
  appendFailedStudent,
  computeSubjectBreakdown,
  buildStudentSheetName,
  buildStudentDetailSheet,
  buildSummarySheet,
} from "../services/excelService.js";
import CONFIG from "../config/config.js";

/**
 * POST /api/excel/upload
 * Accepts a multipart "workbook" file, validates it has a sheet (any name)
 * with the required seed columns, and persists it as the active workbook.
 */
export const uploadWorkbook = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded. Attach it under field name 'workbook'." });
    }

    const workbook = await loadWorkbookFromBuffer(req.file.buffer);
    const masterSheet = getMasterSheet(workbook);
    validateMasterSheet(masterSheet);

    await saveWorkbook(workbook);

    console.log(`📥 [Excel-Controller] Workbook uploaded and saved. Sheets: ${workbook.worksheets.map((s) => s.name).join(", ")}`);

    return res.status(200).json({
      success: true,
      message: "Workbook uploaded successfully.",
      sheets: workbook.worksheets.map((s) => s.name),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/excel/generate-sheets
 * Pre-creates a blank per-student detail sheet (named by student name) for
 * every Master row, ahead of a fetch-results run.
 */
export const generateSheets = async (req, res, next) => {
  try {
    const workbook = await loadWorkbook();
    const masterSheet = getMasterSheet(workbook);
    const masterRows = readMasterRows(masterSheet);

    masterRows.forEach(({ hallticket, regno, studentName }) => {
      const sheetName = buildStudentSheetName(workbook, studentName, regno);
      buildStudentDetailSheet(workbook, sheetName, {
        studentName,
        regno,
        hallticket,
        testDate: null,
        questions: [],
        subjectBreakdown: null,
      });
    });

    await saveWorkbook(workbook);

    console.log(`📄 [Excel-Controller] Generated ${masterRows.length} placeholder student sheet(s).`);

    return res.download(CONFIG.EXCEL.WORKBOOK_PATH, "eapcet-student-sheets.xlsx");
  } catch (error) {
    next(error);
  }
};

/**
 * Runs the sequential (NOT parallel — see scraperService's RAM-conscious
 * launch flags) scrape loop for every Master row. Fire-and-forget: the
 * HTTP response for fetch-results has already been sent before this runs.
 * The Summary sheet is rebuilt once at the end, since ranking requires
 * every student's total to be known first.
 */
const runFetchAll = async (workbook) => {
  try {
    const masterSheet = getMasterSheet(workbook);
    validateMasterSheet(masterSheet);
    const rows = readMasterRows(masterSheet);

    ensureFailedStudentsSheet(workbook, { reset: true });

    const allResults = [];
    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const { hallticket, regno, studentName } = rows[index];
      progressTracker.updateProgress({ currentStudent: studentName || hallticket });

      try {
        console.log(`🔎 [Excel-Bulk] (${index + 1}/${rows.length}) Fetching result for HallTicket: ${hallticket}`);
        const response = await scrapeResult({ regno, hallticket });

        if (response.success) {
          const r = response.result;
          const subjectBreakdown = computeSubjectBreakdown(r.questions, r.totalQuestions);
          const entry = {
            hallticket,
            regno,
            studentName: studentName || r.studentName,
            testDate: r.testDate,
            subject: r.subject,
            totalQuestions: r.totalQuestions,
            correctAnswers: r.correctAnswers,
            wrongAnswers: r.wrongAnswers,
            totalMarks: r.totalMarks,
            percentage: r.percentage,
            questions: r.questions,
            subjectBreakdown,
            status: "OK",
          };

          const sheetName = buildStudentSheetName(workbook, entry.studentName, regno);
          buildStudentDetailSheet(workbook, sheetName, entry);

          allResults.push(entry);
          successCount += 1;
        } else {
          appendFailedStudent(workbook, { hallticket, regno, error: response.error });
          allResults.push({ hallticket, regno, studentName, totalMarks: 0, status: "Failed" });
          failedCount += 1;
        }
      } catch (err) {
        appendFailedStudent(workbook, { hallticket, regno, error: err.message });
        allResults.push({ hallticket, regno, studentName, totalMarks: 0, status: "Failed" });
        failedCount += 1;
      }

      progressTracker.updateProgress({ processed: index + 1, success: successCount, failed: failedCount });

      // Incremental save every 5 students so a restart doesn't lose all progress.
      if ((index + 1) % 5 === 0) {
        await saveWorkbook(workbook);
      }
    }

    buildSummarySheet(workbook, allResults);
    await saveWorkbook(workbook);
    progressTracker.updateProgress({
      status: "completed",
      currentStudent: null,
      finishedAt: new Date().toISOString(),
    });
    console.log(`✅ [Excel-Bulk] Completed. Success: ${successCount}, Failed: ${failedCount}`);
  } catch (error) {
    console.error("🔴 [Excel-Bulk] Fatal error during bulk fetch:", error.message);
    progressTracker.updateProgress({
      status: "failed",
      lastError: error.message,
      finishedAt: new Date().toISOString(),
    });
  }
};

/**
 * POST /api/excel/fetch-results
 * Kicks off the bulk scrape as a background job and responds immediately,
 * since scraping dozens of students would far exceed any HTTP timeout.
 */
export const fetchResults = async (req, res, next) => {
  try {
    if (progressTracker.isRunning()) {
      return res.status(409).json({ success: false, error: "A fetch-results job is already running." });
    }

    const workbook = await loadWorkbook();
    const masterSheet = getMasterSheet(workbook);
    const rows = readMasterRows(masterSheet);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: "Roster sheet has no student rows." });
    }

    progressTracker.resetProgress(rows.length);
    res.status(202).json({ success: true, message: `Fetch started for ${rows.length} student(s).`, total: rows.length });

    runFetchAll(workbook);
  } catch (error) {
    next(error);
  }
};

/** GET /api/excel/progress */
export const getProgress = (req, res) => {
  res.status(200).json({ success: true, progress: progressTracker.getProgress() });
};

/** GET /api/excel/download */
export const downloadWorkbook = (req, res, next) => {
  res.download(CONFIG.EXCEL.WORKBOOK_PATH, "eapcet-workbook.xlsx", (err) => {
    if (err) {
      const error = new Error("No workbook available to download. Upload one first.");
      error.statusCode = 404;
      next(error);
    }
  });
};
