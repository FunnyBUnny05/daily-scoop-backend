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
  subscriptions: {},  // keyed by endpoint
  status: {}          // keyed by date string 'YYYY-MM-DD'
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const dateStr = getTodayStr();
  store.status[dateStr] = true;
  console.log(`Marked as taken for ${dateStr}`);
  res.status(200).json({ message: 'Marked as taken for today.' });
});

app.get('/test-push', async (req, res) => {
  const payload = JSON.stringify({
    title: "Test Push",
    body: "This is a test notification from your cloud backend!",
    icon: '/daily-scoop/favicon.svg'
  });
  
  const endpoints = Object.keys(store.subscriptions);
  let results = [];
  
  for (let endpoint of endpoints) {
    const sub = {
      endpoint: endpoint,
      keys: store.subscriptions[endpoint]
    };
    try {
      await webPush.sendNotification(sub, payload);
      results.push({ endpoint, status: 'success' });
    } catch (err) {
      results.push({ endpoint, status: 'error', code: err.statusCode, message: err.message, body: err.body });
      if (err.statusCode === 410 || err.statusCode === 404) {
        delete store.subscriptions[endpoint];
      }
    }
  }
  res.json({ results, totalSubscriptions: endpoints.length });
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

// Daily cron at 19:00 Israel time — send push only if not taken today
cron.schedule('0 19 * * *', () => {
  const dateStr = getTodayStr();
  console.log(`[Cron] 19:00 check for ${dateStr}...`);

  if (store.status[dateStr]) {
    console.log('[Cron] Already taken today. No push needed.');
  } else {
    console.log('[Cron] Not taken yet! Sending reminder push.');
    sendPushToAll("Daily Scoop 🥄", "Don't lose those gains! Time to take your creatine.");
  }
}, {
  timezone: "Asia/Jerusalem"
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
  console.log('Daily reminder set for 19:00 Israel time (Asia/Jerusalem)');
});
