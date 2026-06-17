import ExcelJS from "exceljs";
import fs from "fs";
import CONFIG from "../config/config.js";

export const REQUIRED_MASTER_COLUMNS = ["HallTicket", "RegistrationNumber", "StudentName"];
export const FAILED_STUDENTS_COLUMNS = ["HallTicket", "RegistrationNumber", "Error"];

// Fixed AP EAPCET MPC/Engineering question-to-subject mapping. Only valid
// when a student's totalQuestions === 160 (other streams have a different
// question structure we don't have a mapping for).
export const SUBJECT_RANGES = [
  { subject: "Mathematics", from: 1, to: 80, max: 80 },
  { subject: "Physics", from: 81, to: 120, max: 40 },
  { subject: "Chemistry", from: 121, to: 160, max: 40 },
];

export const SUMMARY_SHEET_NAME = "📊 SUMMARY";
export const SUMMARY_COLUMNS = [
  "#", "Registration No", "Hall Ticket", "Candidate Name", "Exam Date",
  "Math(80)", "Phy(40)", "Chem(40)", "Total(160)",
  "Math%", "Phy%", "Chem%", "Overall%", "Q Found", "Rank", "Status",
];

const DETAIL_SUBJECT_HEADERS = ["Subject", "Max", "Correct", "Wrong", "Unattempted", "Score", "Pct"];
const DETAIL_QUESTION_HEADERS = ["Q.No", "Subject", "Correct Ans", "Student Ans", "Status", "Marks"];

/**
 * Reads a cell's display value as a trimmed string, handling ExcelJS's
 * rich-text/formula/Date value shapes (not just plain strings/numbers).
 */
const cellText = (cell) => {
  const value = cell?.value;
  let raw = "";
  if (value === null || value === undefined) {
    raw = "";
  } else if (value instanceof Date) {
    raw = value.toISOString();
  } else if (typeof value === "object") {
    if (Array.isArray(value.richText)) raw = value.richText.map((t) => t.text).join("");
    else if (value.text !== undefined) raw = String(value.text);
    else if (value.result !== undefined) raw = String(value.result);
  } else {
    raw = String(value);
  }
  return raw.trim();
};

const getHeaderMap = (worksheet) => {
  const map = {};
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell);
    if (text) map[text] = colNumber;
  });
  return map;
};

export const ensureDataDir = () => {
  fs.mkdirSync(CONFIG.EXCEL.DATA_DIR, { recursive: true });
};

export const loadWorkbook = async () => {
  if (!fs.existsSync(CONFIG.EXCEL.WORKBOOK_PATH)) {
    const error = new Error("No workbook has been uploaded yet. Upload one via POST /api/excel/upload.");
    error.statusCode = 400;
    throw error;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CONFIG.EXCEL.WORKBOOK_PATH);
  return workbook;
};

export const loadWorkbookFromBuffer = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
};

export const saveWorkbook = async (workbook) => {
  ensureDataDir();
  await workbook.xlsx.writeFile(CONFIG.EXCEL.WORKBOOK_PATH);
};

export const sanitizeSheetName = (rawName) => {
  const cleaned = String(rawName ?? "").trim().replace(/[\\/?*[\]:]/g, "_");
  return cleaned.slice(0, 31) || "UNKNOWN";
};

const hasRequiredColumns = (worksheet) => {
  const map = getHeaderMap(worksheet);
  return REQUIRED_MASTER_COLUMNS.every((col) => map[col]);
};

/**
 * Finds the roster/input sheet by its COLUMNS, not by a fixed name — any
 * sheet name works as long as it has HallTicket/RegistrationNumber/StudentName
 * headers. Prefers a sheet literally named "Master" if multiple sheets match.
 */
export const getMasterSheet = (workbook) => {
  const matches = workbook.worksheets.filter((ws) => hasRequiredColumns(ws));
  if (matches.length === 0) {
    const error = new Error(
      `No sheet found with the required column(s): ${REQUIRED_MASTER_COLUMNS.join(", ")}. ` +
      "The sheet can be named anything, but it must contain these column headers."
    );
    error.statusCode = 400;
    throw error;
  }
  return matches.find((ws) => ws.name === "Master") || matches[0];
};

/** Validates the sheet has the 3 required seed columns and returns its current header map. */
export const validateMasterSheet = (worksheet) => {
  const map = getHeaderMap(worksheet);
  const missing = REQUIRED_MASTER_COLUMNS.filter((col) => !map[col]);
  if (missing.length > 0) {
    const error = new Error(`Roster sheet "${worksheet.name}" is missing required column(s): ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  return map;
};

/** Returns one entry per non-empty Master data row (skips rows with no HallTicket). */
export const readMasterRows = (worksheet) => {
  const map = validateMasterSheet(worksheet);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const hallticket = cellText(row.getCell(map.HallTicket));
    if (!hallticket) continue;
    rows.push({
      rowNumber,
      hallticket,
      regno: cellText(row.getCell(map.RegistrationNumber)),
      studentName: cellText(row.getCell(map.StudentName)),
    });
  }
  return rows;
};

/** Gets (or creates) the FailedStudents sheet. `reset: true` clears it for a fresh run. */
export const ensureFailedStudentsSheet = (workbook, { reset = true } = {}) => {
  let sheet = workbook.getWorksheet("FailedStudents");
  if (sheet && reset) {
    workbook.removeWorksheet(sheet.id);
    sheet = null;
  }
  if (!sheet) {
    sheet = workbook.addWorksheet("FailedStudents");
    const headerRow = sheet.getRow(1);
    FAILED_STUDENTS_COLUMNS.forEach((name, idx) => {
      headerRow.getCell(idx + 1).value = name;
    });
    headerRow.font = { bold: true };
  }
  return sheet;
};

export const appendFailedStudent = (workbook, { hallticket, regno, error }) => {
  const sheet = ensureFailedStudentsSheet(workbook, { reset: false });
  sheet.addRow([hallticket, regno, error]);
};

/**
 * Aggregates raw per-question scrape data into a Math/Physics/Chemistry/TOTAL
 * breakdown using the fixed EAPCET MPC mapping. Returns null when the paper
 * isn't the standard 160-question Engineering structure (no known mapping).
 */
export const computeSubjectBreakdown = (questions, totalQuestions) => {
  if (totalQuestions !== 160 || !Array.isArray(questions)) return null;

  const breakdown = SUBJECT_RANGES.map(({ subject, from, to, max }) => {
    const slice = questions.filter((q) => q.qNo >= from && q.qNo <= to);
    const correct = slice.filter((q) => q.status === "Correct").length;
    const wrong = slice.filter((q) => q.status === "Wrong").length;
    const unattempted = slice.filter((q) => q.status === "Unattempted").length;
    return {
      subject,
      max,
      correct,
      wrong,
      unattempted,
      score: correct,
      pct: max ? +((correct / max) * 100).toFixed(2) : 0,
    };
  });

  const totalCorrect = breakdown.reduce((sum, b) => sum + b.correct, 0);
  const totalWrong = breakdown.reduce((sum, b) => sum + b.wrong, 0);
  const totalUnattempted = breakdown.reduce((sum, b) => sum + b.unattempted, 0);
  breakdown.push({
    subject: "TOTAL",
    max: 160,
    correct: totalCorrect,
    wrong: totalWrong,
    unattempted: totalUnattempted,
    score: totalCorrect,
    pct: +((totalCorrect / 160) * 100).toFixed(2),
  });

  return breakdown;
};

/**
 * Returns a sanitized, <=31-char sheet name for a student.
 * No deduplication — callers are expected to overwrite existing sheets
 * for the same student via buildStudentDetailSheet (which removes before recreating).
 */
export const buildStudentSheetName = (workbook, studentName, fallbackKey) => {
  const cleaned = String(studentName ?? "").replace(/[^\w\s]/g, "").trim().slice(0, 20);
  return sanitizeSheetName(cleaned || fallbackKey || "UNKNOWN").slice(0, 31);
};

/**
 * Creates a per-student detail sheet: header line, subject breakdown table
 * (when available), and the full per-question table. Caller is responsible
 * for sheet-name uniqueness via buildStudentSheetName before calling this.
 */
export const buildStudentDetailSheet = (workbook, sheetName, student) => {
  const { studentName, regno, hallticket, testDate, questions, subjectBreakdown } = student;

  // Remove existing sheet (blank placeholder from generate-sheets, or a prior run) before recreating.
  const existing = workbook.getWorksheet(sheetName);
  if (existing) workbook.removeWorksheet(existing.id);

  const sheet = workbook.addWorksheet(sheetName);

  sheet.getCell("A1").value = `${studentName || "Unknown"} | Reg: ${regno || ""} | HT: ${hallticket || ""}`;
  sheet.getCell("A1").font = { bold: true };
  if (testDate) {
    sheet.getCell("A2").value = `Exam Date: ${testDate}`;
    sheet.getCell("A2").font = { italic: true };
  }

  let row = 4;
  if (subjectBreakdown) {
    const headerRow = sheet.getRow(row);
    DETAIL_SUBJECT_HEADERS.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.font = { bold: true };
    row += 1;

    subjectBreakdown.forEach((b) => {
      sheet.getRow(row).values = [b.subject, b.max, b.correct, b.wrong, b.unattempted, b.score, b.pct];
      row += 1;
    });
    row += 1; // blank separator row
  }

  const qHeaderRow = sheet.getRow(row);
  DETAIL_QUESTION_HEADERS.forEach((h, i) => { qHeaderRow.getCell(i + 1).value = h; });
  qHeaderRow.font = { bold: true };
  row += 1;

  (questions || []).forEach((q) => {
    const subjForQ = SUBJECT_RANGES.find((r) => q.qNo >= r.from && q.qNo <= r.to)?.subject || "";
    sheet.getRow(row).values = [
      q.qNo, subjForQ, q.correctOption, q.chosenOption, q.status, q.status === "Correct" ? 1 : 0,
    ];
    row += 1;
  });

  sheet.columns = [{ width: 8 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 8 }];
  return sheet;
};

/**
 * Rebuilds the Summary sheet from scratch using the full in-memory results
 * array collected during a bulk fetch run. Rank is computed locally among
 * successfully-scraped (totalMarks > 0) students, sorted descending — this
 * is NOT an official portal rank. Must be called once, after the sequential
 * scrape loop completes, since rank requires every student's total.
 */
export const buildSummarySheet = (workbook, allResults) => {
  let sheet = workbook.getWorksheet(SUMMARY_SHEET_NAME);
  if (sheet) workbook.removeWorksheet(sheet.id);
  sheet = workbook.addWorksheet(SUMMARY_SHEET_NAME);

  const headerRow = sheet.getRow(1);
  SUMMARY_COLUMNS.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.font = { bold: true };

  const valid = allResults.filter((r) => (r.totalMarks ?? 0) > 0);
  valid.sort((a, b) => (b.totalMarks ?? 0) - (a.totalMarks ?? 0));
  const rankByHallTicket = new Map();
  valid.forEach((r, i) => rankByHallTicket.set(r.hallticket, i + 1));

  allResults.forEach((r, i) => {
    const b = r.subjectBreakdown;
    const get = (subject, field) => b?.find((x) => x.subject === subject)?.[field] ?? null;
    sheet.getRow(i + 2).values = [
      i + 1,
      r.regno,
      r.hallticket,
      r.studentName,
      r.testDate || null,
      get("Mathematics", "score"),
      get("Physics", "score"),
      get("Chemistry", "score"),
      r.totalMarks ?? null,
      get("Mathematics", "pct"),
      get("Physics", "pct"),
      get("Chemistry", "pct"),
      r.percentage ?? null,
      r.totalQuestions ?? null,
      rankByHallTicket.get(r.hallticket) ?? null,
      r.status || "OK",
    ];
  });

  sheet.columns = SUMMARY_COLUMNS.map(() => ({ width: 16 }));
  return sheet;
};

/**
 * Finds a student by HallTicket, preferring the richer Summary sheet
 * (post-fetch) and falling back to Master (pre-fetch, basic info only).
 */
export const findStudentByHallTicket = (workbook, hallticket) => {
  const target = String(hallticket ?? "").trim().toLowerCase();

  const summary = workbook.getWorksheet(SUMMARY_SHEET_NAME);
  if (summary) {
    const map = getHeaderMap(summary);
    for (let r = 2; r <= summary.rowCount; r += 1) {
      const row = summary.getRow(r);
      if (cellText(row.getCell(map["Hall Ticket"])).toLowerCase() === target) {
        const mathScore = row.getCell(map["Math(80)"]).value ?? null;
        const physicsScore = row.getCell(map["Phy(40)"]).value ?? null;
        const chemistryScore = row.getCell(map["Chem(40)"]).value ?? null;
        const hasBreakdown = mathScore !== null || physicsScore !== null || chemistryScore !== null;
        return {
          source: "summary",
          hallTicket: cellText(row.getCell(map["Hall Ticket"])),
          registrationNumber: cellText(row.getCell(map["Registration No"])),
          studentName: cellText(row.getCell(map["Candidate Name"])),
          rank: row.getCell(map["Rank"]).value ?? null,
          totalScore: row.getCell(map["Total(160)"]).value ?? null,
          overallPercentage: row.getCell(map["Overall%"]).value ?? null,
          subjects: hasBreakdown
            ? {
                math: { score: mathScore, pct: row.getCell(map["Math%"]).value ?? null },
                physics: { score: physicsScore, pct: row.getCell(map["Phy%"]).value ?? null },
                chemistry: { score: chemistryScore, pct: row.getCell(map["Chem%"]).value ?? null },
              }
            : null,
          status: cellText(row.getCell(map["Status"])),
        };
      }
    }
  }

  // Fallback: Master, basic info only — covers the pre-fetch case.
  const master = getMasterSheet(workbook);
  const map = validateMasterSheet(master);
  for (let r = 2; r <= master.rowCount; r += 1) {
    const row = master.getRow(r);
    if (cellText(row.getCell(map.HallTicket)).toLowerCase() === target) {
      return {
        source: "master",
        hallTicket: cellText(row.getCell(map.HallTicket)),
        registrationNumber: cellText(row.getCell(map.RegistrationNumber)),
        studentName: cellText(row.getCell(map.StudentName)),
        rank: null,
        totalScore: null,
        overallPercentage: null,
        subjects: null,
        status: "Not fetched yet",
      };
    }
  }
  return null;
};

export default {
  REQUIRED_MASTER_COLUMNS,
  FAILED_STUDENTS_COLUMNS,
  SUBJECT_RANGES,
  SUMMARY_SHEET_NAME,
  SUMMARY_COLUMNS,
  ensureDataDir,
  loadWorkbook,
  loadWorkbookFromBuffer,
  saveWorkbook,
  sanitizeSheetName,
  getMasterSheet,
  validateMasterSheet,
  readMasterRows,
  ensureFailedStudentsSheet,
  appendFailedStudent,
  computeSubjectBreakdown,
  buildStudentSheetName,
  buildStudentDetailSheet,
  buildSummarySheet,
  findStudentByHallTicket,
};
