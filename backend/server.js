require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getSendwaveRate } = require('./scrapers/sendwave');
const { getWiseRate } = require('./scrapers/wise');
const { getTapTapRate } = require('./scrapers/taptapsend');
const { getRemitlyRate } = require('./scrapers/remitly');
const { getLemFiRate } = require('./scrapers/lemfi');         // ← NEW
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── IN-MEMORY CACHE ─────────────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { delete cache[key]; return null; }
  return entry.data;
}

function setCache(key, data) {
  cache[key] = { data, timestamp: Date.now() };
}

// ─── REMITTANCE APPS ─────────────────────────────────────────────────────────
const APPS = [
  { name: 'Wise',        fee: 0,    spread: 1,     affiliate: 'https://wise.prf.hn/click/camref:1011l5FHNd' },
  { name: 'Remitly',     fee: 2.99, spread: 0.985, affiliate: 'https://remitly.com/?referralcode=yourcode' },
  { name: 'Sendwave',    fee: 0,    spread: 0.972, affiliate: 'https://sendwave.com/?ref=yourcode' },
  { name: 'TapTap Send', fee: 0,    spread: 0.971, affiliate: 'https://taptapsend.com/?ref=yourcode' },
  { name: 'LemFi',       fee: 0,    spread: 1,     affiliate: 'https://lemfi.com/?ref=yourcode' },  // ← NEW
];

// ─── FX PROVIDERS ─────────────────────────────────────────────────────────────
const FX_PROVIDERS = [
  { name: 'Wise',          spread: 0.995, fee: 0,    affiliate: 'https://wise.prf.hn/click/camref:1011l5FHNd' },
  { name: 'Revolut',       spread: 0.993, fee: 0,    affiliate: 'https://revolut.com/referral/yourcode' },
  { name: 'CurrencyFair',  spread: 0.990, fee: 3.00, affiliate: 'https://currencyfair.com/?ref=yourcode' },
  { name: 'XE Money',      spread: 0.985, fee: 0,    affiliate: 'https://xe.com/send/?ref=yourcode' },
  { name: 'OFX',           spread: 0.982, fee: 0,    affiliate: 'https://ofx.com/?ref=yourcode' },
  { name: 'Western Union', spread: 0.970, fee: 4.90, affiliate: 'https://westernunion.com/?ref=yourcode' },
];

// ─── HELPER: cached mid-market FX rate ───────────────────────────────────────
async function getMidRate(from, to) {
  const cacheKey = `fx_${from}`;
  let rates = getCache(cacheKey);
  if (!rates) {
    const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`, { timeout: 8000 });
    rates = response.data.rates;
    setCache(cacheKey, rates);
  }
  return rates[to] || null;
}

app.get('/', (req, res) => {
  res.send('RemAdvisor backend is running! 🚀');
});

// ─── REMITTANCE RATES ─────────────────────────────────────────────────────────
app.get('/rates', async (req, res) => {
  const from   = req.query.from || 'GBP';
  const to     = req.query.to   || 'NGN';
  const amount = parseFloat(req.query.amount) || 500;

  try {
    const wiseData = await getWiseRate(from, to, amount);
    let midRate = wiseData ? wiseData.rate : null;

    if (!midRate) {
      console.log('Wise rate failed, using fallback API');
      midRate = await getMidRate(from, to);
    }

    if (!midRate) {
      return res.status(400).json({ error: `Currency pair ${from}→${to} not supported` });
    }

    // ← LemFi added to Promise.all
    const [sendwaveData, tapTapData, remitlyData, lemfiData] = await Promise.all([
      getSendwaveRate(from, to, amount),
      getTapTapRate(from, to, amount),
      getRemitlyRate(from, to, amount),
      getLemFiRate(from, to, amount),
    ]);

    const results = APPS.map(app => {
      let effectiveRate, fee, recipientGets;

      if (app.name === 'Wise') {
        fee = wiseData ? wiseData.fee : 3.41;
        effectiveRate = midRate;
        recipientGets = (amount - fee) * effectiveRate;

      } else if (app.name === 'Sendwave' && sendwaveData) {
        fee = sendwaveData.fee;
        effectiveRate = sendwaveData.rate;
        recipientGets = (amount - fee) * effectiveRate;

      } else if (app.name === 'TapTap Send' && tapTapData) {
        fee = tapTapData.fee;
        effectiveRate = tapTapData.rate;
        recipientGets = (amount - fee) * effectiveRate;

      } else if (app.name === 'Remitly' && remitlyData) {
        fee = remitlyData.fee;
        effectiveRate = remitlyData.rate;
        recipientGets = remitlyData.recipientGets;

      } else if (app.name === 'LemFi' && lemfiData) {   // ← NEW
        fee = lemfiData.fee;
        effectiveRate = lemfiData.rate;
        recipientGets = lemfiData.recipientGets;

      } else {
        // Fallback: estimate using mid-market rate + spread
        fee = app.fee;
        effectiveRate = midRate * app.spread;
        recipientGets = (amount - fee) * effectiveRate;
      }

      return {
        name: app.name,
        fee,
        effectiveRate: parseFloat(effectiveRate.toFixed(4)),
        recipientGets: parseFloat(recipientGets.toFixed(2)),
        affiliate: app.affiliate,
        isBest: false,
        isRealRate: true
      };
    });

    results.sort((a, b) => b.recipientGets - a.recipientGets);
    results[0].isBest = true;
    res.json({ from, to, amount, midRate, results });

  } catch (error) {
    console.error('Remittance error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// ─── EXCHANGE RATES ───────────────────────────────────────────────────────────
app.get('/exchange-rates', async (req, res) => {
  const from   = req.query.from   || 'USD';
  const to     = req.query.to     || 'NGN';
  const amount = parseFloat(req.query.amount) || 1000;

  try {
    const midRate = await getMidRate(from, to);
    if (!midRate) {
      return res.status(400).json({ error: `Pair ${from}→${to} not supported` });
    }

    const results = FX_PROVIDERS.map(provider => {
      const amountAfterFee = amount - provider.fee;
      const effectiveRate  = midRate * provider.spread;
      const recipientGets  = amountAfterFee * effectiveRate;
      return {
        name:          provider.name,
        fee:           provider.fee,
        effectiveRate: parseFloat(effectiveRate.toFixed(4)),
        recipientGets: parseFloat(recipientGets.toFixed(2)),
        affiliate:     provider.affiliate,
        isBest:        false,
      };
    }).sort((a, b) => b.recipientGets - a.recipientGets);

    results[0].isBest = true;
    res.json({ from, to, amount, midRate, results });

  } catch (error) {
    console.error('Exchange rates error:', error.message);
    res.status(500).json({ error: 'Failed to fetch exchange rates. Please try again.' });
  }
});

// ─── RATE ALERTS ─────────────────────────────────────────────────────────────
app.post('/alerts', async (req, res) => {
  const { email, app: appName, targetRate, from, to } = req.body;
  if (!email || !appName || !targetRate || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const { error } = await supabase.from('alerts').insert({
    email, app: appName,
    target_rate: parseFloat(targetRate),
    from_currency: from, to_currency: to, triggered: false
  });
  if (error) {
    console.error('Supabase insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save alert' });
  }
  res.json({ success: true, message: 'Alert saved!' });
});

// ─── CHECK ALERTS ─────────────────────────────────────────────────────────────
app.get('/check-alerts', async (req, res) => {
  const { data: pending, error } = await supabase.from('alerts').select('*').eq('triggered', false);
  if (error) return res.status(500).json({ error: 'Failed to fetch alerts' });
  if (!pending || pending.length === 0) return res.json({ message: 'No pending alerts' });

  let triggered = 0;
  for (const alert of pending) {
    try {
      const response = await axios.get(
        `https://askrem-production.up.railway.app/rates?from=${alert.from_currency}&to=${alert.to_currency}&amount=500`
      );
      const appData = response.data.results.find(r => r.name === alert.app);
      if (!appData) continue;
      const currentRate = appData.effectiveRate;
      if (currentRate >= alert.target_rate) {
        await resend.emails.send({
          from: 'RemAdvisor <alerts@remadvisor.org>',
          to: alert.email,
          subject: `🎉 Your rate alert triggered! ${alert.app} is now at ${currentRate.toLocaleString()} ${alert.to_currency}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
              <h1 style="color:#0f1f5c;">🎉 Your Rate Alert Triggered!</h1>
              <p>Great news! <strong>${alert.app}</strong> is now offering a rate you wanted.</p>
              <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px;margin:24px 0;text-align:center;">
                <p style="margin:0;color:#64748b;font-size:14px;">Current Rate</p>
                <p style="margin:8px 0;font-size:36px;font-weight:900;color:#16a34a;">
                  1 ${alert.from_currency} = ${currentRate.toLocaleString()} ${alert.to_currency}
                </p>
                <p style="margin:0;color:#64748b;font-size:14px;">Your target was ${Number(alert.target_rate).toLocaleString()} ${alert.to_currency}</p>
              </div>
              <a href="https://remadvisor.org" style="display:block;background:#16a34a;color:white;text-align:center;padding:16px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:800;margin:24px 0;">
                Send Money with ${alert.app} Now →
              </a>
            </div>
          `
        });
        await supabase.from('alerts').update({
          triggered: true, triggered_rate: currentRate, triggered_at: new Date().toISOString()
        }).eq('id', alert.id);
        triggered++;
      }
    } catch (err) {
      console.error(`Error checking alert for ${alert.email}:`, err.message);
    }
  }
  res.json({ checked: pending.length, triggered });
});

// ─── CONTACT FORM ─────────────────────────────────────────────────────────────
app.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await resend.emails.send({
      from: 'RemAdvisor Contact <alerts@remadvisor.org>',
      to: 'chineduuzochukwu@gmail.com',
      subject: `[RemAdvisor] ${subject} from ${name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#0f1f5c;">📬 New Contact Form Submission</h2>
          <div style="background:#f0f4ff;border-radius:12px;padding:20px;margin:16px 0;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
          </div>
          <p><strong>Message:</strong></p>
          <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:16px;border-radius:4px;">${message}</div>
        </div>
      `
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.listen(3000, () => {
  console.log('RemAdvisor backend is running! 🚀');
});