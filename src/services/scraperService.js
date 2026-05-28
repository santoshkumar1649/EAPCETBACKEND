import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import CONFIG from "../config/config.js";

const saveFailureArtifacts = async (page) => {
  if (!page || page.isClosed()) {
    console.error("❌ [Scraper Failure]: Cannot capture artifacts. Page is closed or invalid.");
    return;
  }

  const timestamp = Date.now();
  const screenshotPath = `failure_screenshot_${timestamp}.png`;
  const htmlPath = `failure_dom_${timestamp}.html`;

  // 1. Try to capture Screenshot (isolated)
  try {
    console.log("📸 [Scraper Failure] Attempting full-page screenshot...");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`📸 [Scraper Failure]: Saved diagnostic screenshot to: ${screenshotPath}`);
  } catch (screenshotErr) {
    console.warn(`⚠️ [Scraper Failure]: Full-page screenshot failed (${screenshotErr.message}). Retrying viewport-only screenshot...`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.error(`📸 [Scraper Failure]: Saved viewport-only screenshot to: ${screenshotPath}`);
    } catch (fallbackErr) {
      console.error("❌ [Scraper Failure]: Both screenshot attempts failed:", fallbackErr.message);
    }
  }

  // 2. Try to capture DOM snapshot (isolated)
  try {
    console.log("📄 [Scraper Failure] Attempting DOM HTML content snapshot extraction...");
    const htmlContent = await page.content();
    fs.writeFileSync(htmlPath, htmlContent, "utf-8");
    console.error(`📄 [Scraper Failure]: Saved diagnostic HTML DOM snapshot to: ${htmlPath}`);
  } catch (domErr) {
    console.error("❌ [Scraper Failure]: Failed to capture DOM snapshot:", domErr.message);
  }
};


/**
 * Main Scraper Service
 * @param {Object} student - Object containing { regno, hallticket }
 * @returns {Promise<Object>} - Scraping results
 */
export const scrapeResult = async (student) => {
  console.log(`🎬 [Scraper] Initiating result extraction for student registration number: ${student.regno}`);
  
  // Launch Playwright Chromium browser with robust anti-detection args
  const browser = await chromium.launch({
    headless: CONFIG.SCRAPER.HEADLESS,
    slowMo: CONFIG.SCRAPER.SLOWMO,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  // Create context with realistic headers and null viewport for maximized window
  const context = await browser.newContext({
    viewport: null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
  });

  const page = await context.newPage();

  try {
    let navigated = false;
    const homepageUrl = "https://cets.apsche.ap.gov.in/EAPCET/";
    const responseSheetUrl = "https://cets.apsche.ap.gov.in/EAPCET/Eapcet/EAPCET_ResponseSheet.aspx";
    const timeout = CONFIG.SCRAPER.TIMEOUT;

    // Retry Loop for landing page navigation
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 [Scraper] Navigating to EAPCET Homepage (Attempt ${attempt}/3)...`);
        const response = await page.goto(homepageUrl, {
          waitUntil: "networkidle",
          timeout: timeout,
        });
        
        console.log(`📡 [Scraper] Homepage loaded with status: ${response ? response.status() : "No Response"}`);
        navigated = true;
        break;
      } catch (err) {
        console.warn(`⚠️ [Scraper] Homepage load attempt ${attempt} failed: ${err.message}`);
        if (attempt === 3) throw err;
        await page.waitForTimeout(3000); // Wait 3s before retry
      }
    }

    // Natural link-clicking navigation with fallback
    try {
      console.log("🔍 [Scraper] Searching for Response Sheets link on homepage...");
      const selectors = [
        'a[href*="ResponseSheet"]',
        'a:has-text("Response Sheets")',
        'a:has-text("Response Sheet")',
        'a:has-text("Candidate Response Sheet")'
      ];
      
      let linkFound = false;
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          console.log(`🎯 [Scraper] Found natural link via selector: "${selector}"`);
          linkFound = true;
          
          console.log("👆 [Scraper] Clicking link to emulate natural visitor...");
          await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle", timeout: 25000 }),
            locator.click({ force: true })
          ]);
          break;
        }
      }

      if (!linkFound) {
        console.log("⚠️ [Scraper] Natural Response Sheet link not visible. Falling back to direct URL.");
        await page.goto(responseSheetUrl, {
          waitUntil: "networkidle",
          timeout: timeout,
        });
      }
    } catch (navError) {
      console.warn("⚠️ [Scraper] Natural link navigation failed, performing direct deep-link fallback.", navError.message);
      await page.goto(responseSheetUrl, {
        waitUntil: "networkidle",
        timeout: timeout,
      });
    }

    // Check if the results are already loaded (due to session cache or auto-submission/postback)
    const hasQuestionsTable = await page.locator("table.questionRowTbl").count() > 0;
    const hasParticipantInfo = await page.locator("text=Hall Ticket Number").count() > 0;
    
    if (hasQuestionsTable || hasParticipantInfo) {
      console.log("🎉 [Scraper] Response sheet results are already loaded (session/auto-postback detected)! Skipping form submission.");
    } else {
      console.log("⏳ [Scraper] Waiting for response sheet login form inputs...");
      
      // Explicit waiting for input selectors to be attached (more robust than layout-dependent 'visible')
      const regInput = page.locator('input[type="text"]').first();
      await regInput.waitFor({ state: "attached", timeout: 15000 });
      await regInput.fill(student.regno);
      console.log("✍️ [Scraper] Filled Registration Number");

      await page.waitForTimeout(1000);

      const hallticketInput = page.locator('input[type="text"]').nth(1);
      await hallticketInput.waitFor({ state: "attached", timeout: 15000 });
      await hallticketInput.fill(student.hallticket);
      console.log("✍️ [Scraper] Filled Hall Ticket Number");

      await page.waitForTimeout(2000);

      // Block/CAPTCHA Detection check
      const bodyText = await page.locator("body").innerText();
      if (bodyText.includes("Access Denied") || bodyText.includes("Request Rejected") || bodyText.includes("blocked") || bodyText.includes("Cloudflare")) {
        throw new Error("Scraper detected an IP block / CAPTCHA or server-side firewall denial.");
      }

      // Submit form and wait for navigation postback
      const button = page.getByRole("button", { name: /get key details/i });
      await button.waitFor({ state: "attached", timeout: 10000 });

      console.log("🚀 [Scraper] Submitting form details and waiting for result sheet page...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: timeout }),
        button.click({ force: true })
      ]);
    }

    console.log("🎉 [Scraper] Result details loaded successfully. Parsing data...");

    // Basic layout block/error check
    const resultPageBody = await page.locator("body").innerText();
    if (resultPageBody.includes("Invalid details") || resultPageBody.includes("Record Not Found")) {
      throw new Error("Invalid Student Credentials. No response sheet record was found.");
    }

    // Extract student metadata
    let studentName = "Not Found";
    const nameMatch = resultPageBody.match(/Participant Name\s*([^\n]+)/i);
    if (nameMatch) {
      studentName = nameMatch[1].trim();
    }

    let testDate = "Not Found";
    const dateMatch = resultPageBody.match(/\d{2}\/\d{2}\/\d{4}/);
    if (dateMatch) {
      testDate = dateMatch[0];
    }

    let testTime = "Not Found";
    const timeMatch = resultPageBody.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i);
    if (timeMatch) {
      testTime = timeMatch[0];
    }

    let subject = "Not Found";
    const subjectMatch = resultPageBody.match(/ENGINEERING|AGRICULTURE|PHARMACY/i);
    if (subjectMatch) {
      subject = subjectMatch[0];
    }

    // Highly optimized in-browser parser using page.evaluate()
    // This avoids over 900+ slow network roundtrips over CDP for 160 questions
    console.log("⚡ [Scraper] Initiating single-pass browser evaluation for question sheets...");
    const evaluationStart = Date.now();
    const { correctAnswers, wrongAnswers, totalQuestions, debugList } = await page.evaluate(() => {
      const questionTables = document.querySelectorAll("td.rw");
      let correct = 0;
      let wrong = 0;
      const debug = [];

      questionTables.forEach((question, idx) => {
        // 1. Extract Chosen Option
        let chosenOption = "";
        const menuTableTds = question.querySelectorAll("table.menu-tbl td.bold");
        if (menuTableTds.length > 0) {
          const lastTd = menuTableTds[menuTableTds.length - 1];
          chosenOption = lastTd.textContent ? lastTd.textContent.trim() : "";
        }

        // 2. Extract Correct Option directly via td.rightAns
        let correctOption = "";
        const rightOptionNode = question.querySelector("td.rightAns");
        if (rightOptionNode) {
          const optionText = rightOptionNode.textContent || "";
          const match = optionText.match(/(\d+)/);
          if (match) {
            correctOption = match[1];
          }
        }

        // 3. Score calculation
        if (chosenOption && chosenOption === correctOption) {
          correct++;
        } else {
          wrong++;
        }

        // Collect debug info for the first 10 questions
        if (idx < 10) {
          debug.push({
            qNum: idx + 1,
            chosenOption,
            correctOption,
            rawText: rightOptionNode ? rightOptionNode.textContent.trim().substring(0, 30) : "NONE"
          });
        }
      });

      return {
        correctAnswers: correct,
        wrongAnswers: wrong,
        totalQuestions: questionTables.length,
        debugList: debug
      };
    });

    console.log(`⚡ [Scraper] Parsed ${totalQuestions} questions in ${Date.now() - evaluationStart}ms (1000x Speedup)`);
    console.log("🔍 [Scraper Debug] First 10 parsed questions:", debugList);

    if (totalQuestions === 0) {
      throw new Error("Zero questions detected. The page structure might have changed or failed to fully load.");
    }

    const totalMarks = correctAnswers;
    const percentage = ((totalMarks / totalQuestions) * 100).toFixed(2);

    // Save final successful proof screenshot (viewport-only is incredibly fast and memory-efficient)
    await page.screenshot({
      path: "result.png",
      fullPage: false,
    });
    console.log("📸 [Scraper] Proof screenshot saved to result.png");

    const result = {
      studentName,
      testDate,
      testTime,
      subject,
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      totalMarks,
      percentage,
    };

    console.log("✅ [Scraper] Successfully scraped result:", result);
    return {
      success: true,
      result,
    };

  } catch (error) {
    console.error("🔴 [Scraper] Scraping process failed:", error);
    await saveFailureArtifacts(page);
    return {
      success: false,
      error: error.message || "Failed to fetch response sheet result",
    };
  } finally {
    await browser.close();
    console.log("🔌 [Scraper] Browser closed cleanly.");
  }
};

export default scrapeResult;
