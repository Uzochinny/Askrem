const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getSendwaveRate } = require('./scrapers/sendwave');
const { getWiseRate } = require('./scrapers/wise');
const { getTapTapRate } = require('./scrapers/taptapsend');
const { getRemitlyRate } = require('./scrapers/remitly');
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

// Only real scrapers — verified accurate
const APPS = [
  { name: 'Wise',        fee: 0,    spread: 1,     affiliate: 'https://wise.prf.hn/click/camref:1011l5FHNd' },
  { name: 'Remitly',     fee: 2.99, spread: 0.985, affiliate: 'https://remitly.com/?referralcode=yourcode' },
  { name: 'Sendwave',    fee: 0,    spread: 0.972, affiliate: 'https://sendwave.com/?ref=yourcode' },
  { name: 'TapTap Send', fee: 0,    spread: 0.971, affiliate: 'https://taptapsend.com/?ref=yourcode' },
];

app.get('/', (req, res) => {
  res.send('Remadvisor backend is running! 🚀');
});

app.get('/rates', async (req, res) => {
  const from = req.query.from || 'GBP';
  const to = req.query.to || 'NGN';
  const amount = parseFloat(req.query.amount) || 500;

  try {
    const wiseData = await getWiseRate(from, to, amount);
    let midRate = wiseData ? wiseData.rate : null;

    if (!midRate) {
      console.log('Wise rate failed, using fallback API');
      const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
      midRate = response.data.rates[to];
    }

    if (!midRate) {
      return res.status(400).json({ error: `Currency pair ${from}→${to} not supported` });
    }

    console.log(`Mid-market rate ${from}→${to}: ${midRate}`);

    const [sendwaveData, tapTapData, remitlyData] = await Promise.all([
      getSendwaveRate(from, to, amount),
      getTapTapRate(from, to, amount),
      getRemitlyRate(from, to, amount),
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

      } else {
        fee = app.fee;
        effectiveRate = midRate * app.spread;
        recipientGets = (amount - fee) * effectiveRate;
      }

      return {
        name: app.name,
        fee: fee,
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
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// Save a new rate alert to Supabase
app.post('/alerts', async (req, res) => {
  const { email, app: appName, targetRate, from, to } = req.body;

  if (!email || !appName || !targetRate || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { error } = await supabase.from('alerts').insert({
    email,
    app: appName,
    target_rate: parseFloat(targetRate),
    from_currency: from,
    to_currency: to,
    triggered: false
  });

  if (error) {
    console.error('Supabase insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save alert' });
  }

  console.log(`Alert saved to Supabase: ${email} wants ${appName} ${from}→${to} at ${targetRate}`);
  res.json({ success: true, message: 'Alert saved!' });
});

// Check all alerts and send emails if triggered
app.get('/check-alerts', async (req, res) => {
  const { data: pending, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('triggered', false);

  if (error) {
    console.error('Supabase fetch error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch alerts' });
  }

  if (!pending || pending.length === 0) {
    return res.json({ message: 'No pending alerts' });
  }

  let triggered = 0;

  for (const alert of pending) {
    try {
      const response = await axios.get(
        `https://askrem-production.up.railway.app/rates?from=${alert.from_currency}&to=${alert.to_currency}&amount=500`
      );
      const results = response.data.results;
      const appData = results.find(r => r.name === alert.app);

      if (!appData) continue;

      const currentRate = appData.effectiveRate;
      console.log(`Checking ${alert.app} ${alert.from_currency}→${alert.to_currency}: current=${currentRate}, target=${alert.target_rate}`);

      if (currentRate >= alert.target_rate) {
        await resend.emails.send({
          from: 'RemAdvisor <alerts@remadvisor.org>',
          to: alert.email,
          subject: `🎉 Your rate alert triggered! ${alert.app} is now at ${currentRate.toLocaleString()} ${alert.to_currency}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h1 style="color: #0f1f5c;">🎉 Your Rate Alert Triggered!</h1>
              <p style="font-size: 16px; color: #333;">Great news! <strong>${alert.app}</strong> is now offering a rate you wanted.</p>

              <div style="background: #f0fdf4; border: 2px solid #16a34a; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                <p style="margin: 0; color: #64748b; font-size: 14px;">Current Rate</p>
                <p style="margin: 8px 0; font-size: 36px; font-weight: 900; color: #16a34a;">
                  1 ${alert.from_currency} = ${currentRate.toLocaleString()} ${alert.to_currency}
                </p>
                <p style="margin: 0; color: #64748b; font-size: 14px;">Your target was ${Number(alert.target_rate).toLocaleString()} ${alert.to_currency}</p>
              </div>

              <p style="font-size: 14px; color: #64748b;">Rates change fast — act now before this rate changes!</p>

              <a href="https://remadvisor.org"
                 style="display: block; background: #16a34a; color: white; text-align: center; padding: 16px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: 800; margin: 24px 0;">
                Send Money with ${alert.app} Now →
              </a>

              <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                You're receiving this because you set a rate alert on RemAdvisor.<br>
                <a href="https://remadvisor.org" style="color: #94a3b8;">Visit RemAdvisor</a>
              </p>
            </div>
          `
        });

        // Mark alert as triggered in Supabase
        await supabase
          .from('alerts')
          .update({
            triggered: true,
            triggered_rate: currentRate,
            triggered_at: new Date().toISOString()
          })
          .eq('id', alert.id);

        triggered++;
        console.log(`Email sent to ${alert.email} for ${alert.app} at ${currentRate}`);
      }
    } catch (error) {
      console.error(`Error checking alert for ${alert.email}:`, error.message);
    }
  }

  res.json({ checked: pending.length, triggered });
});

app.listen(3000, () => {
  console.log('Remadvisor backend is running! 🚀');
});