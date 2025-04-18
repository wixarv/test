const express = require("express");
const router = express.Router();
const {
  GetDashboardStats,
  SearchUsers,
  GetActivityLogs,
  DeleteActivityLog,
  GetUserActivitySummary,
  ClearUserLoginHistory,
  BulkRestoreUsers,
  GetPostStats,
  DeleteAllUserPosts,
  GetSystemHealth,
  LockUserAccount,
  UnlockUserAccount,
  GetIPStats,
  ExportActivityLogs,
  PurgeOldLogs,
  GetPendingFollowRequests,
  ApproveFollowRequest,
  BanUserByEmail,
  GetRateLimitStats,
  BulkAction,
  ManagePost,
  GetModeratorActivity,
  BanIP,
  BanUser,
  SuspendUser,
  RestoreUser,
  AssignModerator,
  RemoveModerator,
  GetUserDetails,
  GetUserList,
  VerifyUser,
  UnverifyUser,
} = require("../controllers/adminController");
const adminMiddleware = require("../middleware/adminMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");


router.get("/dashboard", adminMiddleware, GetDashboardStats);
router.get("/users", adminMiddleware, GetUserList);
router.get("/search-users", adminMiddleware, SearchUsers);
router.post("/verify-user", adminMiddleware, VerifyUser);
router.post("/unverify-user", adminMiddleware, UnverifyUser);



// router.get("/search-users", adminMiddleware, SearchUsers);
// router.get("/activity-logs", adminMiddleware, GetActivityLogs);
// router.post("/delete-activity-log", adminMiddleware, DeleteActivityLog);
// router.get("/user-activity-summary", adminMiddleware, GetUserActivitySummary);
// router.post("/clear-user-login-history", adminMiddleware, ClearUserLoginHistory);
// router.post("/bulk-restore-users", adminMiddleware, BulkRestoreUsers);
// router.get("/post-stats", adminMiddleware, GetPostStats);
// router.post("/delete-all-user-posts", adminMiddleware, DeleteAllUserPosts);
// router.get("/system-health", adminMiddleware, GetSystemHealth);
// router.post("/lock-user-account", adminMiddleware, LockUserAccount);
// router.post("/unlock-user-account", adminMiddleware, UnlockUserAccount);
// router.get("/ip-stats", adminMiddleware, GetIPStats);
// router.get("/export-activity-logs", adminMiddleware, ExportActivityLogs);
// router.post("/purge-old-logs", adminMiddleware, PurgeOldLogs);
// router.get("/pending-follow-requests", adminMiddleware, GetPendingFollowRequests);
// router.post("/approve-follow-request", adminMiddleware, ApproveFollowRequest);
// router.post("/ban-user-by-email", adminMiddleware, BanUserByEmail);
// router.get("/rate-limit-stats", adminMiddleware, GetRateLimitStats);
// router.post("/bulk-action", adminMiddleware, BulkAction);
// router.post("/manage-post", roleMiddleware(["admin", "moderator"]), ManagePost);
// router.get("/moderator-activity", adminMiddleware, GetModeratorActivity);
// router.post("/ban-ip", adminMiddleware, BanIP);
// router.post("/ban-user", adminMiddleware, BanUser);
// router.post("/suspend-user", adminMiddleware, SuspendUser);
// router.post("/restore-user", adminMiddleware, RestoreUser);
// router.post("/assign-moderator", adminMiddleware, AssignModerator);
// router.post("/remove-moderator", adminMiddleware, RemoveModerator);
// router.get("/user-details", roleMiddleware(["admin", "moderator"]), GetUserDetails);

module.exports = router;