const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG, JPG, and PNG images are allowed'));
  },
});

module.exports = upload;
