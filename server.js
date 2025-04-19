// server.js
require("dotenv").config();
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const CsrfToken = require("./models/CsrfToken");
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
app.set('trust proxy', 1); // Trust Render.com's proxy

const io = new Server(server, {
  cors: {
    origin: [process.env.FRONTEND_URL || "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const connectedUsers = new Map(); // Map<userId, socketId[]>

// Socket.io Authentication Middleware
io.use(async (socket, next) => {
  const accessToken = socket.handshake.auth.accessToken;
  const csrfToken = socket.handshake.auth.csrfToken;
  const userIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;

  console.log("Socket.io Auth - Access Token:", accessToken, "CSRF Token:", csrfToken, "User IP:", userIp); // Debugging

  if (!accessToken || !csrfToken) {
    console.error("Socket.io: Missing accessToken or csrfToken");
    return next(new Error("Authentication required"));
  }

  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "your-app-name",
    });
    const tokenData = await CsrfToken.findOne({ token: csrfToken });

    if (!tokenData || tokenData.expiresAt < Date.now() || tokenData.userId.toString() !== decoded.userId) {
      console.error("Socket.io: Invalid CSRF token");
      return next(new Error("Invalid CSRF token"));
    }

    // Temporarily disable IP check for debugging
    // if (tokenData.userIp && tokenData.userIp !== userIp) {
    //   console.error("Socket.io: Invalid token origin");
    //   return next(new Error("Invalid token origin"));
    // }

    socket.userId = decoded.userId;
    next();
  } catch (error) {
    console.error("Socket.io Auth Error:", error);
    next(new Error("Invalid authentication token"));
  }
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id, "User ID:", socket.userId);

  socket.on("register", (userId) => {
    if (!userId || userId !== socket.userId) {
      console.log("Invalid userId received for registration");
      return;
    }
    const userSockets = connectedUsers.get(userId) || [];
    if (!userSockets.includes(socket.id)) {
      userSockets.push(socket.id);
      connectedUsers.set(userId, userSockets);
    }
    console.log(`User ${userId} registered with socket ${socket.id}`);
    console.log("Current connected users:", [...connectedUsers.entries()]);
    socket.emit("registered", { userId });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const [userId, sockets] of connectedUsers.entries()) {
      const updatedSockets = sockets.filter((id) => id !== socket.id);
      if (updatedSockets.length > 0) {
        connectedUsers.set(userId, updatedSockets);
      } else {
        connectedUsers.delete(userId);
      }
      console.log(`Updated sockets for user ${userId}:`, updatedSockets);
    }
    console.log("Updated connected users:", [...connectedUsers.entries()]);
  });

  socket.on("forceLogout", (data) => {
    console.log("Force logout event received on server for user:", data.userId);
  });
});

app.set("io", io);
app.set("connectedUsers", connectedUsers);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});