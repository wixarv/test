require("dotenv").config();
const app = require("./app");
const http = require("http");
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
