const express = require("express");
const router = express.Router();
const { CreateAppVersion, GetAppVersion, UpdateAppVersion, DeleteAppVersion, CreateFAQ, GetFAQ, UpdateFAQ, DeleteFAQ, AskAQuestion, GetUserQuestions, GetAllQuestions, ReplyToQuestion, ReportProblem, ResolveProblem, GetProblems } = require("../controllers/companyController");
const adminMiddleware = require("../middleware/adminMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

// App Version Routes
router.post("/app-version", adminMiddleware, CreateAppVersion);   // Admin
router.get("/app-version", GetAppVersion);                       // Public
router.put("/app-version", adminMiddleware, UpdateAppVersion);   // Admin
router.delete("/app-version", adminMiddleware, DeleteAppVersion); // Admin

// FAQ Routes
router.post("/faq", adminMiddleware, CreateFAQ);   // Admin
router.get("/faq", GetFAQ);                        // Public
router.put("/faq", adminMiddleware, UpdateFAQ);    // Admin
router.delete("/faq", adminMiddleware, DeleteFAQ); // Admin

// Question Routes
router.post("/ask-question", authMiddleware, AskAQuestion);       // User
router.get("/my-questions", authMiddleware, GetUserQuestions);    // User (own questions)
router.get("/all-questions", adminMiddleware, GetAllQuestions);   // Admin
router.put("/reply-question", adminMiddleware, ReplyToQuestion);  // Admin
                         // Public

module.exports = router;