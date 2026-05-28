import https from "https";
import http from "http";

/**
 * Self-ping Keep-Alive Service
 * Prevents Render's free tier from sleeping by pinging itself.
 */
export const startKeepAlive = () => {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
  if (!url) {
    console.log("ℹ️ [Keep-Alive] No RENDER_EXTERNAL_URL or SELF_URL defined. Skipping keep-alive self-pinging.");
    return;
  }

  console.log(`🚀 [Keep-Alive] Self-ping service initialized for URL: ${url}`);

  const ping = () => {
    console.log(`⏱️ [Keep-Alive] Sending self-ping request to keep Render server awake...`);
    const client = url.startsWith("https") ? https : http;

    client.get(url, (res) => {
      console.log(`✅ [Keep-Alive] Self-ping successful. Status Code: ${res.statusCode}`);
    }).on("error", (err) => {
      console.error(`⚠️ [Keep-Alive] Self-ping failed: ${err.message}`);
      
      // If it fails, schedule a retry in 15 minutes as requested
      console.log("🔄 [Keep-Alive] Scheduling a retry in 15 minutes...");
      setTimeout(() => {
        console.log("🔄 [Keep-Alive] Executing failed-ping retry...");
        ping();
      }, 15 * 60 * 1000); // 15 minutes
    });
  };

  // Run every 10 minutes to keep the Render free tier awake (timeout is usually 15 mins)
  setInterval(ping, 10 * 60 * 1000);

  // Run once immediately on startup (wait 5s to allow server to bind to port)
  setTimeout(ping, 5000);
};

export default startKeepAlive;
