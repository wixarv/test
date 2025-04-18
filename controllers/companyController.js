const Company = require("../models/Company");
const winston = require("winston");

const logger = winston.createLogger({ level: "error", format: winston.format.json(), transports: [new winston.transports.File({ filename: "error.log" })] });

// App Version CRUD
const CreateAppVersion = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { version, description, changelog } = req.body;
    if (!version) return res.status(400).json({ success: false, message: "Version is required.", errorCode: "MISSING_VERSION" });

    const company = await Company.findOne({ name: "AB Company" }) || new Company({ name: "AB Company", createdBy: req.userId });
    if (company.appVersion.some(v => v.version === version)) return res.status(400).json({ success: false, message: "Version already exists.", errorCode: "DUPLICATE_VERSION" });

    const newVersion = { version, description: description || "Latest version.", changelog: changelog || [] };
    company.appVersion.push(newVersion);
    await company.save();

    logger.info("App version created:", { version, adminId: req.userId });
    res.status(201).json({ success: true, data: company.appVersion.slice(-1)[0], message: "Version created." });
  } catch (error) {
    logger.error("CreateAppVersion error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error creating version.", error: error.message, errorCode: "UNKNOWN" });
  }
};

const GetAppVersion = () => async (req, res) => {
  try {
    const company = await Company.findOne({ name: "AB Company" }).select("appVersion").lean();
    if (!company || !company.appVersion.length) return res.status(404).json({ success: false, message: "No versions found." });
    res.status(200).json({ success: true, data: company.appVersion, message: "Versions retrieved." });
  } catch (error) {
    logger.error("GetAppVersion error:", { message: error.message });
    res.status(500).json({ success: false, message: "Error fetching versions.", error: error.message });
  }
};

const UpdateAppVersion = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { versionId, version, description, changelog } = req.body;
    if (!versionId) return res.status(400).json({ success: false, message: "Version ID is required.", errorCode: "MISSING_VERSION_ID" });

    const company = await Company.findOne({ "appVersion._id": versionId });
    if (!company) return res.status(404).json({ success: false, message: "Version not found.", errorCode: "VERSION_NOT_FOUND" });

    const appVer = company.appVersion.id(versionId);
    if (version) appVer.version = version;
    if (description) appVer.description = description;
    if (changelog) appVer.changelog = changelog;
    appVer.updateTime = Date.now();

    await company.save();
    logger.info("App version updated:", { versionId, adminId: req.userId });
    res.status(200).json({ success: true, data: appVer, message: "Version updated." });
  } catch (error) {
    logger.error("UpdateAppVersion error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error updating version.", error: error.message });
  }
};

const DeleteAppVersion = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { versionId } = req.body;
    if (!versionId) return res.status(400).json({ success: false, message: "Version ID is required.", errorCode: "MISSING_VERSION_ID" });

    const company = await Company.findOne({ "appVersion._id": versionId });
    if (!company) return res.status(404).json({ success: false, message: "Version not found.", errorCode: "VERSION_NOT_FOUND" });

    company.appVersion.id(versionId).remove();
    await company.save();

    logger.info("App version deleted:", { versionId, adminId: req.userId });
    res.status(200).json({ success: true, message: "Version deleted." });
  } catch (error) {
    logger.error("DeleteAppVersion error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error deleting version.", error: error.message });
  }
};

// FAQ CRUD
const CreateFAQ = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ success: false, message: "Question and answer are required." });

    const company = await Company.findOne({ name: "AB Company" }) || new Company({ name: "AB Company", createdBy: req.userId });
    company.faqs.push({ question, answer });
    await company.save();

    logger.info("FAQ created:", { question, adminId: req.userId });
    res.status(201).json({ success: true, data: company.faqs.slice(-1)[0], message: "FAQ created." });
  } catch (error) {
    logger.error("CreateFAQ error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error creating FAQ.", error: error.message });
  }
};

const GetFAQ = () => async (req, res) => {
  try {
    const company = await Company.findOne({ name: "AB Company" }).select("faqs").lean();
    if (!company || !company.faqs.length) return res.status(404).json({ success: false, message: "No FAQs found." });
    res.status(200).json({ success: true, data: company.faqs, message: "FAQs retrieved." });
  } catch (error) {
    logger.error("GetFAQ error:", { message: error.message });
    res.status(500).json({ success: false, message: "Error fetching FAQs.", error: error.message });
  }
};

const UpdateFAQ = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { faqId, question, answer } = req.body;
    if (!faqId) return res.status(400).json({ success: false, message: "FAQ ID is required." });

    const company = await Company.findOne({ "faqs._id": faqId });
    if (!company) return res.status(404).json({ success: false, message: "FAQ not found." });

    const faq = company.faqs.id(faqId);
    if (question) faq.question = question;
    if (answer) faq.answer = answer;
    faq.updatedAt = Date.now();

    await company.save();
    logger.info("FAQ updated:", { faqId, adminId: req.userId });
    res.status(200).json({ success: true, data: faq, message: "FAQ updated." });
  } catch (error) {
    logger.error("UpdateFAQ error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error updating FAQ.", error: error.message });
  }
};

const DeleteFAQ = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { faqId } = req.body;
    if (!faqId) return res.status(400).json({ success: false, message: "FAQ ID is required." });

    const company = await Company.findOne({ "faqs._id": faqId });
    if (!company) return res.status(404).json({ success: false, message: "FAQ not found." });

    company.faqs.id(faqId).remove();
    await company.save();

    logger.info("FAQ deleted:", { faqId, adminId: req.userId });
    res.status(200).json({ success: true, message: "FAQ deleted." });
  } catch (error) {
    logger.error("DeleteFAQ error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error deleting FAQ.", error: error.message });
  }
};

// Question Handling
const AskAQuestion = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: User access required.", errorCode: "UNAUTHORIZED" });
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: "Question is required." });

    const company = await Company.findOne({ name: "AB Company" }) || new Company({ name: "AB Company", createdBy: req.userId });
    company.questions.push({ userId: req.userId, question });
    await company.save();

    logger.info("Question asked:", { question, userId: req.userId });
    res.status(201).json({ success: true, data: company.questions.slice(-1)[0], message: "Question submitted." });
  } catch (error) {
    logger.error("AskAQuestion error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error submitting question.", error: error.message });
  }
};

const GetUserQuestions = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: User access required.", errorCode: "UNAUTHORIZED" });
    const company = await Company.findOne({ name: "AB Company" }).select("questions").lean();
    if (!company || !company.questions.length) return res.status(404).json({ success: false, message: "No questions found." });

    const userQuestions = company.questions.filter(q => q.userId.toString() === req.userId.toString());
    res.status(200).json({ success: true, data: userQuestions, message: "Your questions retrieved." });
  } catch (error) {
    logger.error("GetUserQuestions error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error fetching your questions.", error: error.message });
  }
};

const GetAllQuestions = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const company = await Company.findOne({ name: "AB Company" }).select("questions").lean();
    if (!company || !company.questions.length) return res.status(404).json({ success: false, message: "No questions found." });

    res.status(200).json({ success: true, data: company.questions, message: "All questions retrieved." });
  } catch (error) {
    logger.error("GetAllQuestions error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error fetching questions.", error: error.message });
  }
};

const ReplyToQuestion = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { questionId, reply } = req.body;
    if (!questionId || !reply) return res.status(400).json({ success: false, message: "Question ID and reply are required." });

    const company = await Company.findOne({ "questions._id": questionId });
    if (!company) return res.status(404).json({ success: false, message: "Question not found." });

    const q = company.questions.id(questionId);
    q.reply = reply;
    q.repliedAt = Date.now();
    q.repliedBy = req.userId;

    await company.save();
    logger.info("Question replied:", { questionId, adminId: req.userId });
    res.status(200).json({ success: true, data: q, message: "Reply submitted." });
  } catch (error) {
    logger.error("ReplyToQuestion error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error replying to question.", error: error.message });
  }
};

// Problem Reporting
const ReportProblem = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: User access required.", errorCode: "UNAUTHORIZED" });
    const { problem } = req.body;
    if (!problem) return res.status(400).json({ success: false, message: "Problem description is required." });

    const company = await Company.findOne({ name: "AB Company" }) || new Company({ name: "AB Company", createdBy: req.userId });
    company.problems.push({ userId: req.userId, problem });
    await company.save();

    logger.info("Problem reported:", { problem, userId: req.userId });
    res.status(201).json({ success: true, data: company.problems.slice(-1)[0], message: "Problem reported." });
  } catch (error) {
    logger.error("ReportProblem error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error reporting problem.", error: error.message });
  }
};

const ResolveProblem = () => async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, message: "Unauthorized: Admin access required.", errorCode: "UNAUTHORIZED" });
    const { problemId, resolution, status } = req.body;
    if (!problemId || !status) return res.status(400).json({ success: false, message: "Problem ID and status are required." });

    const company = await Company.findOne({ "problems._id": problemId });
    if (!company) return res.status(404).json({ success: false, message: "Problem not found." });

    const p = company.problems.id(problemId);
    p.status = status;
    if (resolution) p.resolution = resolution;
    if (status !== "pending") p.resolvedAt = Date.now();
    p.resolvedBy = req.userId;

    await company.save();
    logger.info("Problem resolved:", { problemId, adminId: req.userId });
    res.status(200).json({ success: true, data: p, message: "Problem updated." });
  } catch (error) {
    logger.error("ResolveProblem error:", { message: error.message, userId: req.userId });
    res.status(500).json({ success: false, message: "Error resolving problem.", error: error.message });
  }
};

const GetProblems = () => async (req, res) => {
  try {
    const company = await Company.findOne({ name: "AB Company" }).select("problems").lean();
    if (!company || !company.problems.length) return res.status(404).json({ success: false, message: "No problems found." });
    res.status(200).json({ success: true, data: company.problems, message: "Problems retrieved." });
  } catch (error) {
    logger.error("GetProblems error:", { message: error.message });
    res.status(500).json({ success: false, message: "Error fetching problems.", error: error.message });
  }
};

module.exports = {
  CreateAppVersion: CreateAppVersion(),
  GetAppVersion: GetAppVersion(),
  UpdateAppVersion: UpdateAppVersion(),
  DeleteAppVersion: DeleteAppVersion(),
  CreateFAQ: CreateFAQ(),
  GetFAQ: GetFAQ(),
  UpdateFAQ: UpdateFAQ(),
  DeleteFAQ: DeleteFAQ(),
  AskAQuestion: AskAQuestion(),
  GetUserQuestions: GetUserQuestions(),
  GetAllQuestions: GetAllQuestions(),
  ReplyToQuestion: ReplyToQuestion(),
  ReportProblem: ReportProblem(),
  ResolveProblem: ResolveProblem(),
  GetProblems: GetProblems(),
};