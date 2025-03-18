const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');

module.exports = async (req, res, next) => {
  const { accessToken, refreshToken, csrfToken } = req.cookies;
  if (!accessToken || !csrfToken || req.headers['x-csrf-token'] !== csrfToken) {
    return res.status(401).json({ success: false, message: 'Missing or invalid authentication tokens' });
  }

  try {
    const decoded = jwt.verify(accessToken, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' && refreshToken) {
      try {
        const decodedRefresh = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const newAccessToken = jwt.sign({ userId: decodedRefresh.userId }, JWT_SECRET, {
          expiresIn: '7d',
        });

        res.cookie('accessToken', newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'Strict' : 'Lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        req.userId = decodedRefresh.userId;
        next();
      } catch (refreshError) {
        return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
      }
    } else {
      return res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
    }
  }
};