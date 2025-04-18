const User = require("../models/User");
const winston = require("winston");
const getCountryFromIP = require("../utils/getcountry");

const logger = winston.createLogger({
  level: "error",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "error.log" })],
});

const formatDate = (date) => {
  if (!date) return "Never";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

// Dashboard Stats Functions
const getTotalUsers = () => User.countDocuments().then(c => [{ count: c }]).catch(() => [{ count: 0 }]);
const getSignupsByDay = () => User.aggregate([{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 7 }]).then(r => r.map(x => ({ date: formatDate(x._id), count: x.count })).reverse()).catch(() => []);
const getSignupsByWeek = () => User.aggregate([{ $group: { _id: { week: { $week: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { "_id.year": -1, "_id.week": -1 } }, { $limit: 8 }]).then(r => r.map(x => ({ date: `${String(x._id.week).padStart(2, "0")}-${x._id.year}`, count: x.count })).reverse()).catch(() => []);
const getSignupsByYear = () => User.aggregate([{ $group: { _id: { $year: "$createdAt" }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }]).then(r => r.map(x => ({ date: String(x._id), count: x.count })).reverse()).catch(() => []);
const getUsersByCountry = () => User.aggregate([{ $group: { _id: "$location.country", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $match: { _id: { $ne: null } } }]).then(r => r.map(x => ({ country: x._id || "Unknown", count: x.count }))).catch(() => []);
const getActiveUsers = () => User.countDocuments({ lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }).then(c => [{ count: c }]).catch(() => [{ count: 0 }]);
const getTopCities = () => User.aggregate([{ $group: { _id: "$location.city", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]).then(r => r.map(x => ({ city: x._id || "Unknown", count: x.count }))).catch(() => []);
const getTopHashtags = () => User.aggregate([{ $unwind: "$posts" }, { $unwind: "$posts.hashtags" }, { $group: { _id: "$posts.hashtags", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]).then(r => r.map(x => ({ hashtag: x._id || "None", count: x.count }))).catch(() => []);
const getTopUsersByCountry = () => User.aggregate([{ $group: { _id: "$location.country", count: { $sum: 1 }, users: { $push: { username: "$username", id: "$_id" } } } }, { $sort: { count: -1 } }, { $limit: 5 }, { $match: { _id: { $ne: null } } }]).then(r => r.map(x => ({ country: x._id || "Unknown", count: x.count, topUsers: x.users.slice(0, 3) }))).catch(() => []);
const getTopUsersByState = () => User.aggregate([{ $group: { _id: "$location.state", count: { $sum: 1 }, users: { $push: { username: "$username", id: "$_id" } } } }, { $sort: { count: -1 } }, { $limit: 5 }, { $match: { _id: { $ne: null } } }]).then(r => r.map(x => ({ state: x._id || "Unknown", count: x.count, topUsers: x.users.slice(0, 3) }))).catch(() => []);
const getCurrentUserLocation = async (req) => { const location = await getCountryFromIP(req).catch(() => ({ country: "Unknown", state: null, localTime: null })); return [{ country: location.country, state: location.state, localTime: location.localTime }]; };
const getPostsLast7Days = () => User.aggregate([{ $unwind: "$posts" }, { $match: { "posts.createdAt": { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$posts.createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }]).then(r => r.map(x => ({ date: formatDate(x._id), count: x.count })).reverse()).catch(() => []);
const getTopActiveUsers = () => User.aggregate([{ $match: { lastActive: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }, { $group: { _id: "$username", activityCount: { $sum: 1 }, id: { $first: "$_id" } } }, { $sort: { activityCount: -1 } }, { $limit: 5 }]).then(r => r.map(x => ({ username: x._id, id: x.id, activityCount: x.activityCount }))).catch(() => []);
const getTotalLikes = () => User.aggregate([{ $unwind: "$posts" }, { $group: { _id: null, count: { $sum: "$posts.likes" } } }]).then(r => [{ count: r[0]?.count || 0 }]).catch(() => [{ count: 0 }]);
const getTotalComments = () => User.aggregate([{ $unwind: "$posts" }, { $group: { _id: null, count: { $sum: "$posts.comments" } } }]).then(r => [{ count: r[0]?.count || 0 }]).catch(() => [{ count: 0 }]);
const getMostLikedPost = () => User.aggregate([{ $unwind: "$posts" }, { $sort: { "posts.likes": -1 } }, { $limit: 1 }, { $project: { username: "$username", postId: "$posts._id", likes: "$posts.likes", content: "$posts.content" } }]).then(r => r[0] ? [r[0]] : []).catch(() => []);
const getMostCommentedPost = () => User.aggregate([{ $unwind: "$posts" }, { $sort: { "posts.comments": -1 } }, { $limit: 1 }, { $project: { username: "$username", postId: "$posts._id", comments: "$posts.comments", content: "$posts.content" } }]).then(r => r[0] ? [r[0]] : []).catch(() => []);
const getVerifiedUsers = () => User.countDocuments({ isVerified: true }).then(c => [{ count: c }]).catch(() => [{ count: 0 }]);
const getVerifiedUsersWithNames = () => User.find({ isVerified: true }).select("username").lean().then(r => [{ count: r.length, usernames: r.map(u => u.username) }]).catch(err => { logger.error("getVerifiedUsersWithNames error:", { message: err.message }); return [{ count: 0, usernames: [] }]; });
const getUnverifiedUsersWithNames = () => User.find({ isVerified: false }).select("username").lean().then(r => [{ count: r.length, usernames: r.map(u => u.username) }]).catch(err => { logger.error("getUnverifiedUsersWithNames error:", { message: err.message }); return [{ count: 0, usernames: [] }]; });


// GetDashboardStats (Updated with Unverified Users)
const GetDashboardStats = async (req, res) => {
  try {
    const [totalUsers, signupsByDay, signupsByWeek, signupsByYear, usersByCountry, activeUsers, topCities, topHashtags, topUsersByCountry, topUsersByState, currentUserLocation, verifiedUsers, postsLast7Days, topActiveUsers, totalLikes, totalComments, mostLikedPost, mostCommentedPost, verifiedUsersWithNames, unverifiedUsersWithNames] = await Promise.all([
      getTotalUsers(), getSignupsByDay(), getSignupsByWeek(), getSignupsByYear(), getUsersByCountry(), getActiveUsers(), getTopCities(), getTopHashtags(), getTopUsersByCountry(), getTopUsersByState(), getCurrentUserLocation(req), getVerifiedUsers(), getPostsLast7Days(), getTopActiveUsers(), getTotalLikes(), getTotalComments(), getMostLikedPost(), getMostCommentedPost(), getVerifiedUsersWithNames(), getUnverifiedUsersWithNames()
    ]);
    res.status(200).json({
      success: true,
      stats: [
        { name: "Total Users", data: totalUsers },
        { name: "Signups by Day", data: signupsByDay },
        { name: "Signups by Week", data: signupsByWeek },
        { name: "Signups by Year", data: signupsByYear },
        { name: "Users by Country", data: usersByCountry },
        { name: "Active Users (30d)", data: activeUsers },
        { name: "Top Cities", data: topCities },
        { name: "Top Hashtags", data: topHashtags },
        { name: "Top Users by Country", data: topUsersByCountry },
        { name: "Top Users by State", data: topUsersByState },
        { name: "Current User Location", data: currentUserLocation },
        { name: "Verified Users", data: verifiedUsers },
        { name: "Posts Last 7 Days", data: postsLast7Days },
        { name: "Top Active Users (7d)", data: topActiveUsers },
        { name: "Total Likes", data: totalLikes },
        { name: "Total Comments", data: totalComments },
        { name: "Most Liked Post", data: mostLikedPost },
        { name: "Most Commented Post", data: mostCommentedPost },
        { name: "Verified Users with Names", data: verifiedUsersWithNames },
        { name: "Unverified Users with Names", data: unverifiedUsersWithNames }, // New stat
      ],
    });
  } catch (error) {
    logger.error("GetDashboardStats error:", { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: "An unexpected error occurred while fetching dashboard stats." });
  }
};

// GetUserList
const GetUserList = () => async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const users = await User.find({})
      .select("username email name role status createdAt lastActive location posts followers following bannedIPs suspensionEnd lockUntil isVerified")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .lean()
      .then(r => r.map(u => ({
        id: u._id.toString(),
        username: u.username,
        email: u.email,
        name: u.name || "N/A",
        role: u.role || "user",
        status: u.status || "active",
        signupDate: formatDate(u.createdAt),
        lastActive: formatDate(u.lastActive),
        location: {
          country: u.location?.country || "Unknown",
          state: u.location?.state || "Unknown",
          city: u.location?.city || "Unknown",
        },
        postCount: u.posts?.length || 0,
        followerCount: u.followers?.length || 0,
        followingCount: u.following?.length || 0,
        bannedIPs: u.bannedIPs || [],
        suspensionEnd: u.suspensionEnd ? formatDate(u.suspensionEnd) : null,
        lockUntil: u.lockUntil ? formatDate(u.lockUntil) : null,
        isVerified: u.isVerified || false,
      })))
      .catch(() => []);

    const total = await User.countDocuments().catch(() => 0);

    res.status(200).json({
      success: true,
      stats: [{ name: "User List", data: users }],
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error("GetUserList error:", { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: "An unexpected error occurred while fetching user list." });
  }
};

// SearchUsers
const SearchUsers = () => async (req, res) => {
  try {
    const { username, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (!username || username.trim() === "") {
      return res.status(200).json({
        success: true,
        stats: [{ name: "Searched Users", data: [] }],
        pagination: { total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 },
      });
    }

    const filter = { username: { $regex: `^${username}$`, $options: "i" } };

    const users = await User.find(filter)
      .select("username email name role status createdAt lastActive location posts followers following bannedIPs suspensionEnd lockUntil isVerified")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .lean()
      .then(r => r.map(u => ({
        id: u._id.toString(),
        username: u.username,
        email: u.email,
        name: u.name || "N/A",
        role: u.role || "user",
        status: u.status || "active",
        signupDate: formatDate(u.createdAt),
        lastActive: formatDate(u.lastActive),
        location: {
          country: u.location?.country || "Unknown",
          state: u.location?.state || "Unknown",
          city: u.location?.city || "Unknown",
        },
        postCount: u.posts?.length || 0,
        followerCount: u.followers?.length || 0,
        followingCount: u.following?.length || 0,
        bannedIPs: u.bannedIPs || [],
        suspensionEnd: u.suspensionEnd ? formatDate(u.suspensionEnd) : null,
        lockUntil: u.lockUntil ? formatDate(u.lockUntil) : null,
        isVerified: u.isVerified || false,
      })))
      .catch(() => []);

    const total = await User.countDocuments(filter).catch(() => 0);

    res.status(200).json({
      success: true,
      stats: [{ name: "Searched Users", data: users }],
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error("SearchUsers error:", { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: "An unexpected error occurred while searching users." });
  }
};

// VerifyUser
const VerifyUser = () => async (req, res) => {
  try {
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "User is already verified." });
    }

    user.isVerified = true;
    await user.save();

    logger.info("User verified:", { userId, adminId: req.user?._id || "unknown", timestamp: new Date() });

    res.status(200).json({
      success: true,
      message: `User ${user.username} has been verified successfully.`,
      user: { id: user._id.toString(), username: user.username, isVerified: user.isVerified },
    });
  } catch (error) {
    logger.error("VerifyUser error:", { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: "An unexpected error occurred while verifying the user." });
  }
};

// UnverifyUser (Updated)
const UnverifyUser = () => async (req, res) => {
  try {
    const userId = req.body.userId || req.query.userId;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!user.isVerified) {
      return res.status(400).json({ success: false, message: "User is already unverified." });
    }

    user.isVerified = false;
    await user.save();

    logger.info("User unverified:", { userId, adminId: req.user?._id || "unknown", timestamp: new Date() });

    res.status(200).json({
      success: true,
      message: `User ${user.username} has been unverified successfully.`,
      user: { id: user._id.toString(), username: user.username, isVerified: user.isVerified },
    });
  } catch (error) {
    logger.error("UnverifyUser error:", { message: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: "An unexpected error occurred while unverifying the user." });
  }
};

module.exports = {
  GetDashboardStats,
  GetUserList: GetUserList(),
  SearchUsers: SearchUsers(),
  VerifyUser: VerifyUser(),
  UnverifyUser: UnverifyUser(),
};