const express = require('express');
const webPush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// VAPID keys setup
const publicVapidKey = 'BOvVmTl1KIRUC3upnnvkxOfrULKixcxV3UKLgA59yogkU7Po84lAT1gga_74eBMpa09UuqvRaFh5KXG1saEAfKU';
const privateVapidKey = 'o0_HJzV5m2iMdirkLHv9YxcQlHrkgz-XeLa8xRcZsoM';

webPush.setVapidDetails(
  'mailto:test@example.com',
  publicVapidKey,
  privateVapidKey
);

// In-memory store
const store = {
  subscriptions: {},       // keyed by endpoint
  lastTakenTimestamp: null, // epoch ms of last "Mark as Taken"
  lastReminderSent: null   // epoch ms of last reminder push (to avoid spam)
};

// Routes
app.get('/vapidPublicKey', (req, res) => {
  res.send(publicVapidKey);
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  store.subscriptions[subscription.endpoint] = subscription.keys;
  console.log('New subscription registered. Total:', Object.keys(store.subscriptions).length);
  res.status(201).json({ message: 'Subscribed successfully.' });
});

app.post('/mark-taken', (req, res) => {
  store.lastTakenTimestamp = Date.now();
  store.lastReminderSent = null; // Reset so we can remind again 24h from now
  console.log(`Marked as taken at ${new Date(store.lastTakenTimestamp).toISOString()}`);
  res.status(200).json({ message: 'Marked as taken.', timestamp: store.lastTakenTimestamp });
});

app.get('/test-push', (req, res) => {
  sendPushToAll("Test Push", "This is a test notification from your cloud backend!");
  res.send("Pushes sent (check server logs).");
});

app.get('/', (req, res) => {
  const msSinceTaken = store.lastTakenTimestamp ? Date.now() - store.lastTakenTimestamp : null;
  const hoursSinceTaken = msSinceTaken ? (msSinceTaken / 1000 / 60 / 60).toFixed(1) : 'never';
  res.json({
    status: 'Daily Scoop Backend is running!',
    subscriptions: Object.keys(store.subscriptions).length,
    lastTaken: store.lastTakenTimestamp ? new Date(store.lastTakenTimestamp).toISOString() : 'never',
    hoursSinceLastTaken: hoursSinceTaken,
    nextReminderIn: store.lastTakenTimestamp ? `${Math.max(0, 24 - parseFloat(hoursSinceTaken)).toFixed(1)} hours` : 'waiting for first dose'
  });
});

// Logic to send push
const sendPushToAll = (title, body) => {
  const payload = JSON.stringify({
    title: title,
    body: body,
    icon: '/daily-scoop/favicon.svg'
  });

  const endpoints = Object.keys(store.subscriptions);
  console.log(`Sending push to ${endpoints.length} subscriber(s)...`);

  endpoints.forEach(endpoint => {
    const sub = {
      endpoint: endpoint,
      keys: store.subscriptions[endpoint]
    };
    webPush.sendNotification(sub, payload).catch(error => {
      console.error('Error sending push:', error.statusCode || error.message);
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.log('Subscription expired, removing:', endpoint);
        delete store.subscriptions[endpoint];
      }
    });
  });
};

// Check every 30 minutes: has it been 24+ hours since last taken?
cron.schedule('*/30 * * * *', () => {
  const now = Date.now();
  console.log(`[Cron] Checking at ${new Date(now).toISOString()}...`);

  // If never taken, don't spam
  if (!store.lastTakenTimestamp) {
    console.log('[Cron] No dose recorded yet. Skipping.');
    return;
  }

  const hoursSinceTaken = (now - store.lastTakenTimestamp) / 1000 / 60 / 60;
  console.log(`[Cron] Hours since last taken: ${hoursSinceTaken.toFixed(1)}`);

  if (hoursSinceTaken >= 24) {
    // Only send ONE reminder per missed window (don't spam every 30 min)
    if (store.lastReminderSent) {
      const hoursSinceReminder = (now - store.lastReminderSent) / 1000 / 60 / 60;
      if (hoursSinceReminder < 12) {
        console.log('[Cron] Already reminded recently. Skipping.');
        return;
      }
    }

    console.log('[Cron] 24+ hours since last dose! Sending reminder.');
    sendPushToAll("Daily Scoop 🥄", "It's been 24 hours since your last creatine! Time for your daily scoop.");
    store.lastReminderSent = now;
  } else {
    console.log(`[Cron] Only ${hoursSinceTaken.toFixed(1)}h. Next check in 30 min.`);
  }
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
  console.log('24-hour reminder system active (checks every 30 min)');
});
