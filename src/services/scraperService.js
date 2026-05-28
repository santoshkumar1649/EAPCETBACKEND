import { chromium } from "playwright";
import fs from "fs";
import CONFIG from "../config/config.js";

// Helper to save failure logs
const saveFailureArtifacts = async (page) => {
  if (!page || page.isClosed()) return;
  const timestamp = Date.now();
  try {
    await page.screenshot({ path: `failure_screenshot_${timestamp}.png`, fullPage: false });
    const htmlContent = await page.content();
    fs.writeFileSync(`failure_dom_${timestamp}.html`, htmlContent, "utf-8");
  } catch (err) {
    console.error("❌ [Scraper-Artifacts] Failed to save diagnostics:", err.message);
  }
};

/**
 * Robust Playwright Scraper Service
 * @param {Object} student - { regno, hallticket }
 * @returns {Promise<Object>} - Scraped result payload
 */
export const scrapeResult = async (student) => {
  console.log(`🎬 [Scraper] Starting result extraction for RegNo: ${student.regno}`);

  let browser = null;
  let page = null;
  
  // 1. Retry Browser Launch (up to 3 times) to handle transient memory spikes on Render
  let launchAttempts = 3;
  for (let attempt = 1; attempt <= launchAttempts; attempt++) {
    try {
      browser = await chromium.launch({
        headless: true, // Always headless in production
        slowMo: CONFIG.SCRAPER.SLOWMO || 0,
        // Crucial RAM-saving flags for Render's 512MB limit
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", // Write shared memory to /tmp instead of /dev/shm
          "--disable-gpu",            // Disable hardware graphics acceleration
          "--no-first-run",
          "--no-zygote",
          "--single-process",         // Fit browser processes into one process (Saves ~100MB RAM)
          "--disable-extensions"
        ],
      });
      break; // Success!
    } catch (err) {
      console.warn(`⚠️ [Scraper] Browser launch attempt ${attempt}/${launchAttempts} failed: ${err.message}`);
      if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
      }
      if (attempt === launchAttempts) throw new Error(`Browser launch failed after ${launchAttempts} attempts: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3s before retry
    }
  }

  try {
    const context = await browser.newContext({
      viewport: null,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
      }
    });

    page = await context.newPage();
    const homepageUrl = "https://cets.apsche.ap.gov.in/EAPCET/";
    const responseSheetUrl = "https://cets.apsche.ap.gov.in/EAPCET/Eapcet/EAPCET_ResponseSheet.aspx";
    const timeout = CONFIG.SCRAPER.TIMEOUT || 60000;

    // 2. Retry Page Navigation (up to 3 times) for government site instability
    let navigated = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 [Scraper] Navigating to EAPCET Homepage (Attempt ${attempt}/3)...`);
        await page.goto(homepageUrl, { waitUntil: "networkidle", timeout: 25000 });
        navigated = true;
        break;
      } catch (err) {
        console.warn(`⚠️ [Scraper] Homepage navigation attempt ${attempt} failed: ${err.message}`);
        if (attempt === 3) throw err;
        await page.waitForTimeout(3000);
      }
    }

    // Natural selector interaction
    try {
      console.log("🔍 [Scraper] Searching for Response Sheets link...");
      const linkSelector = 'a[href*="ResponseSheet"], a:has-text("Response Sheets")';
      await page.waitForSelector(linkSelector, { state: "visible", timeout: 8000 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }),
        page.locator(linkSelector).first().click({ force: true })
      ]);
    } catch (navError) {
      console.warn("⚠️ [Scraper] Natural link navigation failed, performing direct deep-link fallback.", navError.message);
      await page.goto(responseSheetUrl, { waitUntil: "networkidle", timeout: timeout });
    }

    // Check if details are already loaded
    const hasQuestionsTable = await page.locator("table.questionRowTbl").count() > 0;
    const hasParticipantInfo = await page.locator("text=Hall Ticket Number").count() > 0;

    if (hasQuestionsTable || hasParticipantInfo) {
      console.log("🎉 [Scraper] Result already cached in session. Parsing directly...");
    } else {
      console.log("⏳ [Scraper] Filling student credentials...");
      
      const regInput = page.locator('input[type="text"]').first();
      await regInput.waitFor({ state: "attached", timeout: 15000 });
      await regInput.fill(student.regno);

      await page.waitForTimeout(1000);

      const hallticketInput = page.locator('input[type="text"]').nth(1);
      await hallticketInput.waitFor({ state: "attached", timeout: 15000 });
      await hallticketInput.fill(student.hallticket);

      await page.waitForTimeout(1500);

      // Firewall check
      const bodyText = await page.locator("body").innerText();
      if (bodyText.includes("Access Denied") || bodyText.includes("Request Rejected") || bodyText.includes("Cloudflare")) {
        throw new Error("Scraper IP block or firewall rejection detected.");
      }

      const button = page.getByRole("button", { name: /get key details/i });
      await button.waitFor({ state: "attached", timeout: 10000 });

      console.log("🚀 [Scraper] Submitting EAPCET form...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: timeout }),
        button.click({ force: true })
      ]);
    }

    const resultPageBody = await page.locator("body").innerText();
    if (resultPageBody.includes("Invalid details") || resultPageBody.includes("Record Not Found")) {
      throw new Error("Invalid student credentials. No EAPCET result sheet record found.");
    }

    // Parse Student Metadata
    let studentName = "Not Found";
    const nameMatch = resultPageBody.match(/Participant Name\s*([^\n]+)/i);
    if (nameMatch) studentName = nameMatch[1].trim();

    let testDate = "Not Found";
    const dateMatch = resultPageBody.match(/\d{2}\/\d{2}\/\d{4}/);
    if (dateMatch) testDate = dateMatch[0];

    let testTime = "Not Found";
    const timeMatch = resultPageBody.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i);
    if (timeMatch) testTime = timeMatch[0];

    let subject = "Not Found";
    const subjectMatch = resultPageBody.match(/ENGINEERING|AGRICULTURE|PHARMACY/i);
    if (subjectMatch) subject = subjectMatch[0];

    // Single-pass browser context parser
    console.log("⚡ [Scraper] Parsing question sheets in browser context...");
    const { correctAnswers, wrongAnswers, totalQuestions } = await page.evaluate(() => {
      const questionTables = document.querySelectorAll("td.rw");
      let correct = 0;
      let wrong = 0;

      questionTables.forEach((question) => {
        let chosenOption = "";
        const menuTableTds = question.querySelectorAll("table.menu-tbl td.bold");
        if (menuTableTds.length > 0) {
          chosenOption = menuTableTds[menuTableTds.length - 1].textContent?.trim() || "";
        }

        let correctOption = "";
        const rightOptionNode = question.querySelector("td.rightAns");
        if (rightOptionNode) {
          const optionText = rightOptionNode.textContent || "";
          const match = optionText.match(/(\d+)/);
          if (match) correctOption = match[1];
        }

        if (chosenOption && chosenOption === correctOption) {
          correct++;
        } else {
          wrong++;
        }
      });

      return {
        correctAnswers: correct,
        wrongAnswers: wrong,
        totalQuestions: questionTables.length
      };
    });

    if (totalQuestions === 0) {
      throw new Error("Response sheet parsing returned 0 questions. Site structure may have evolved.");
    }

    const totalMarks = correctAnswers;
    const percentage = ((totalMarks / totalQuestions) * 100).toFixed(2);

    return {
      success: true,
      result: {
        studentName,
        testDate,
        testTime,
        subject,
        totalQuestions,
        correctAnswers,
        wrongAnswers,
        totalMarks,
        percentage
      }
    };

  } catch (error) {
    console.error("🔴 [Scraper] Failure encountered during execution:", error.message);
    if (page) await saveFailureArtifacts(page);
    return {
      success: false,
      error: error.message || "Failed to parse EAPCET result response sheet."
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔌 [Scraper] Browser closed cleanly.");
    }
  }
};

export default scrapeResult;
