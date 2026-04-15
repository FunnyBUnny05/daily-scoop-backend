const express = require('express');
const webPush = require('web-push');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// VAPID keys
const publicVapidKey = 'BOvVmTl1KIRUC3upnnvkxOfrULKixcxV3UKLgA59yogkU7Po84lAT1gga_74eBMpa09UuqvRaFh5KXG1saEAfKU';
const privateVapidKey = 'o0_HJzV5m2iMdirkLHv9YxcQlHrkgz-XeLa8xRcZsoM';

webPush.setVapidDetails('mailto:test@example.com', publicVapidKey, privateVapidKey);

// --- Upstash Redis helpers (pure HTTP, no native binaries) ---
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = async (command, ...args) => {
  const url = `${REDIS_URL}/${[command, ...args.map(a => encodeURIComponent(a))].join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const json = await res.json();
  return json.result;
};

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Routes ---
app.get('/vapidPublicKey', (req, res) => {
  res.send(publicVapidKey);
});

// Subscribe: store subscription in Redis hash
app.post('/subscribe', async (req, res) => {
  try {
    const subscription = req.body;
    // Use endpoint as a unique key, store full subscription JSON
    await redis('hset', 'subscriptions', subscription.endpoint, JSON.stringify(subscription));
    const count = await redis('hlen', 'subscriptions');
    console.log(`[subscribe] Stored. Total subscriptions: ${count}`);
    res.status(201).json({ message: 'Subscribed successfully.', total: count });
  } catch (err) {
    console.error('[subscribe] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mark taken: store today's date in Redis
app.post('/mark-taken', async (req, res) => {
  try {
    const dateStr = getTodayStr();
    await redis('set', `status:${dateStr}`, 'taken');
    console.log(`[mark-taken] Marked as taken for ${dateStr}`);
    res.status(200).json({ message: 'Marked as taken for today.', date: dateStr });
  } catch (err) {
    console.error('[mark-taken] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Debug test push — returns full results
app.get('/test-push', async (req, res) => {
  const results = await sendPushToAll('Test Push 🥄', 'Test from your cloud backend — it works!');
  res.json(results);
});

// Status page
app.get('/', async (req, res) => {
  try {
    const count = await redis('hlen', 'subscriptions');
    const dateStr = getTodayStr();
    const status = await redis('get', `status:${dateStr}`);
    res.json({
      status: 'Daily Scoop Backend is running!',
      subscriptions: count,
      takenToday: status === 'taken',
      date: dateStr
    });
  } catch (err) {
    res.json({ status: 'running', error: err.message });
  }
});

// --- Push logic ---
async function sendPushToAll(title, body) {
  try {
    const subsHash = await redis('hgetall', 'subscriptions');
    if (!subsHash) {
      console.log('[push] No subscriptions found in Redis.');
      return { sent: 0, errors: [] };
    }

    const payload = JSON.stringify({ title, body, icon: '/daily-scoop/favicon.svg' });
    const endpoints = Object.keys(subsHash);
    console.log(`[push] Sending to ${endpoints.length} subscriber(s)...`);

    let sent = 0;
    let errors = [];

    for (const endpoint of endpoints) {
      const sub = JSON.parse(subsHash[endpoint]);
      try {
        await webPush.sendNotification(sub, payload);
        sent++;
        console.log(`[push] ✓ Sent to ${endpoint.slice(0, 40)}...`);
      } catch (err) {
        console.error(`[push] ✗ Error ${err.statusCode}: ${err.message}`);
        errors.push({ endpoint: endpoint.slice(0, 40), code: err.statusCode, message: err.message });
        // Remove expired/invalid subscriptions
        if (err.statusCode === 410 || err.statusCode === 404) {
          await redis('hdel', 'subscriptions', endpoint);
          console.log('[push] Removed expired subscription.');
        }
      }
    }

    return { sent, errors, total: endpoints.length };
  } catch (err) {
    console.error('[push] Fatal error:', err);
    return { sent: 0, errors: [err.message] };
  }
}

// Daily cron at 19:00 Israel time — send push only if not taken today
cron.schedule('0 19 * * *', async () => {
  const dateStr = getTodayStr();
  console.log(`[cron] 19:00 check for ${dateStr}...`);

  const status = await redis('get', `status:${dateStr}`);
  if (status === 'taken') {
    console.log('[cron] Already taken today. Skipping push.');
  } else {
    console.log('[cron] Not taken! Sending push reminder.');
    await sendPushToAll("Daily Scoop 🥄", "Don't lose those gains! Time to take your creatine.");
  }
}, { timezone: "Asia/Jerusalem" });

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Upstash Redis: ${REDIS_URL ? '✓ connected' : '✗ NOT SET - set env vars!'}`);
  console.log('Daily reminder cron: 19:00 Israel time');
});
