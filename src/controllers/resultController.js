import { scrapeResult } from "../services/scraperService.js";

/**
 * Controller to handle AP EAPCET Result Scraping
 */
export const getResult = async (req, res, next) => {
  try {
    const { regno, hallticket } = req.body;

    // 1. Validate inputs
    if (!regno || !hallticket) {
      return res.status(400).json({
        success: false,
        error: "Both Registration Number (regno) and Hall Ticket Number (hallticket) are required.",
      });
    }

    // 2. Call the scraper service
    const response = await scrapeResult({ regno, hallticket });

    // 3. Return results
    if (response.success) {
      return res.status(200).json(response);
    } else {
      return res.status(422).json({
        success: false,
        error: response.error || "Could not retrieve the result from the EAPCET database.",
      });
    }
  } catch (error) {
    // Pass exception down to the global error handler
    next(error);
  }
};
