require('dotenv').config();

module.exports = {
  PORT: process.env.PORT,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET:process.env.JWT_REFRESH_SECRET,
  REDIS_UR:process.env.REDIS_UR,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,

};