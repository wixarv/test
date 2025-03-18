const axios = require("axios");

const getCountryFromIP = async (req) => {
  try {
    // Enhanced IP detection
    const realIP =
      req.headers["true-client-ip"] ||
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.headers["x-real-ip"] ||
      req.headers["x-cluster-client-ip"] ||
      req.connection?.remoteAddress ||
      req.ip ||
      "0.0.0.0";
    
    console.log("Detected IP:", realIP); // Debugging
    
    let ipToUse = realIP; // Default IP to use for lookup

    // Check if it's a local IP
    if (
      realIP === "127.0.0.1" ||
      realIP === "localhost" ||
      realIP === "::1" ||
      realIP.startsWith("192.168.") ||
      realIP.startsWith("10.") ||
      realIP.startsWith("172.")
    ) {
      console.log("Local IP detected, using fallback geolocation service");
      // Use a service that detects the client's public IP
      const { data } = await axios.get("https://api.ipify.org?format=json", {
        timeout: 3000,
      });
      
      if (data && data.ip) {
        console.log("Public IP from ipify:", data.ip);
        ipToUse = data.ip; // Update ipToUse to the public IP
        // Now get location data with the public IP
        const geoData = await axios.get(`https://ipapi.co/${ipToUse}/json/`, { timeout: 3000 });
        return {
          country: geoData.data.country_name || "Unknown",
          state: geoData.data.region || "Unknown",
          city: geoData.data.city || "Unknown",
          localTime: new Date().toLocaleString("en-US", { timeZone: geoData.data.timezone }) || new Date().toISOString(),
          language: geoData.data.country_code ? geoData.data.country_code.toLowerCase() : "en",
          ip: ipToUse // Return the public IP instead of realIP
        };
      }
    }
    
    // Use HTTPS for security and reliability with the detected IP
    const { data } = await axios.get(`https://ipapi.co/${ipToUse}/json/`, { timeout: 3000 });
    return {
      country: data.country_name || "Unknown",
      state: data.region || "Unknown",
      city: data.city || "Unknown",
      localTime: new Date().toLocaleString("en-US", { timeZone: data.timezone }) || new Date().toISOString(),
      language: data.country_code ? data.country_code.toLowerCase() : "en",
      ip: ipToUse // Return the detected IP (non-local)
    };
  } catch (err) {
    console.error("IP lookup failed:", err.message);
    try {
      // Final fallback to a different service
      const { data } = await axios.get("https://ipinfo.io/json", {
        headers: { Accept: "application/json" },
        timeout: 3000,
      });
      return {
        country: data.country || "Unknown",
        state: data.region || "Unknown",
        city: data.city || "Unknown",
        localTime: new Date().toLocaleString("en-US", { timeZone: data.timezone }) || new Date().toISOString(),
        language: data.country_code ? data.country_code.toLowerCase() : "en",
        ip: data.ip // Return the IP from ipinfo.io
      };
    } catch (error) {
      console.error("All IP lookup services failed:", error.message);
      return {
        country: "Unknown",
        state: "Unknown",
        city: "Unknown",
        localTime: new Date().toISOString(),
        language: "en",
        ip: realIP // Fallback to realIP if all services fail
      };
    }
  }
};

module.exports = getCountryFromIP;