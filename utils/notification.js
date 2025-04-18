const webPush = require('web-push');
const User = require('../models/user'); // Adjust path as per your structure

// VAPID keys for push notifications (generate once and store in .env)
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};
webPush.setVapidDetails('mailto:your-email@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

// Send WebSocket Notification
const sendWebSocketNotification = (clients, userId, message) => {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'notification', message }));
  }
};

// Send Push Notification
const sendPushNotification = async (userId, message) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.pushSubscription) return; // Check if user has subscribed

    const payload = JSON.stringify({ title: 'New Notification', body: message });
    await webPush.sendNotification(user.pushSubscription, payload);
  } catch (err) {
    console.error('Push notification error:', err);
  }
};

// Combined Notification Function
const sendNotification = async (clients, userId, message) => {
  sendWebSocketNotification(clients, userId, message); // Real-time WebSocket
  await sendPushNotification(userId, message); // Push notification
};

module.exports = { sendNotification };