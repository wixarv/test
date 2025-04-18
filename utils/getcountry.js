const axios = require("axios");
const NodeCache = require("node-cache"); // You'll need to install this: npm install node-cache

// Create a cache with 24-hour TTL
const geoCache = new NodeCache({ stdTTL: 86400 });

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
    
    console.log("Detected IP:", realIP);
    
    // Check cache first
    const cachedResult = geoCache.get(realIP);
    if (cachedResult) {
      console.log("Using cached geolocation data for IP:", realIP);
      return cachedResult;
    }
    
    let ipToUse = realIP;
    
    // Check if it's a local IP
    if (
      realIP === "127.0.0.1" ||
      realIP === "localhost" ||
      realIP === "::1" ||
      realIP.startsWith("192.168.") ||
      realIP.startsWith("10.") ||
      (realIP.startsWith("172.") && 
        parseInt(realIP.split(".")[1]) >= 16 && 
        parseInt(realIP.split(".")[1]) <= 31)
    ) {
      console.log("Local IP detected, using public IP detection");
      
      // Try multiple services to get public IP
      const publicIPServices = [
        { url: "https://api.ipify.org?format=json", path: "ip" },
        { url: "https://api.myip.com", path: "ip" },
        { url: "https://api.bigdatacloud.net/data/client-ip", path: "ipString" },
        { url: "https://ipwho.is", path: "ip" }
      ];
      
      for (const service of publicIPServices) {
        try {
          const { data } = await axios.get(service.url, { timeout: 3000 });
          if (data && data[service.path]) {
            ipToUse = data[service.path];
            console.log("Public IP detected:", ipToUse);
            break;
          }
        } catch (error) {
          console.log(`${service.url} failed:`, error.message);
          continue;
        }
      }
    }
    
    // List of free geolocation APIs to try
    const geoServices = [
      {
        name: "ipapi.co",
        url: `https://ipapi.co/${ipToUse}/json/`,
        mapResponse: (data) => ({
          country: data.country_name || "Unknown",
          state: data.region || "Unknown",
          city: data.city || "Unknown",
          localTime: new Date().toLocaleString("en-US", { timeZone: data.timezone }) || new Date().toISOString(),
          language: data.country_code ? data.country_code.toLowerCase() : "en",
          ip: ipToUse
        })
      },
      {
        name: "ipwho.is",
        url: `https://ipwho.is/${ipToUse}`,
        mapResponse: (data) => ({
          country: data.country || "Unknown",
          state: data.region || "Unknown",
          city: data.city || "Unknown",
          localTime: new Date().toLocaleString("en-US", { timeZone: data.timezone?.id }) || new Date().toISOString(),
          language: data.country_code ? data.country_code.toLowerCase() : "en",
          ip: ipToUse
        })
      },
      {
        name: "ipgeolocation.io",
        url: `https://api.ipgeolocation.io/ipgeo?ip=${ipToUse}`,
        mapResponse: (data) => ({
          country: data.country_name || "Unknown",
          state: data.state_prov || "Unknown",
          city: data.city || "Unknown",
          localTime: data.time_zone?.current_time || new Date().toISOString(),
          language: data.country_code2 ? data.country_code2.toLowerCase() : "en",
          ip: ipToUse
        })
      },
      {
        name: "ip-api.com",
        url: `http://ip-api.com/json/${ipToUse}`,
        mapResponse: (data) => ({
          country: data.country || "Unknown",
          state: data.regionName || "Unknown",
          city: data.city || "Unknown",
          localTime: new Date().toLocaleString("en-US", { timeZone: data.timezone }) || new Date().toISOString(),
          language: data.countryCode ? data.countryCode.toLowerCase() : "en",
          ip: ipToUse
        })
      },
      {
        name: "freegeoip.app",
        url: `https://freegeoip.app/json/${ipToUse}`,
        mapResponse: (data) => ({
          country: data.country_name || "Unknown",
          state: data.region_name || "Unknown",
          city: data.city || "Unknown",
          localTime: new Date().toISOString(),
          language: data.country_code ? data.country_code.toLowerCase() : "en",
          ip: ipToUse
        })
      }
    ];
    
    // Try each service with random delay to avoid detection patterns
    for (const service of geoServices) {
      try {
        // Add a small random delay between requests
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500)));
        
        console.log(`Trying ${service.name}...`);
        const { data } = await axios.get(service.url, { 
          timeout: 3000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
          }
        });
        
        if (data) {
          const result = service.mapResponse(data);
          // Cache the result
          geoCache.set(realIP, result);
          return result;
        }
      } catch (error) {
        console.log(`${service.name} failed:`, error.message);
        continue;
      }
    }
    
    // If all services failed, return default response
    const defaultResponse = {
      country: "Unknown",
      state: "Unknown",
      city: "Unknown",
      localTime: new Date().toISOString(),
      language: "en",
      ip: ipToUse
    };
    
    // Cache the default response too (but with shorter TTL)
    geoCache.set(realIP, defaultResponse, 3600); // 1 hour TTL for failed lookups
    return defaultResponse;
    
  } catch (err) {
    console.error("All geolocation attempts failed:", err.message);
    return {
      country: "Unknown",
      state: "Unknown",
      city: "Unknown",
      localTime: new Date().toISOString(),
      language: "en",
      ip: realIP
    };
  }
};

module.exports = getCountryFromIP;