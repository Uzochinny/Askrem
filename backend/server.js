const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getSendwaveRate } = require('./scrapers/sendwave');

const app = express();
app.use(cors());

// App list with affiliate links
const APPS = [
  { name: 'Wise',         fee: 0,    spread: 1,     affiliate: 'https://wise.com/invite/u/yourcode' },
  { name: 'Remitly',      fee: 2.99, spread: 0.985, affiliate: 'https://remitly.com/?referralcode=yourcode' },
  { name: 'WorldRemit',   fee: 1.99, spread: 0.978, affiliate: 'https://worldremit.com/?referral=yourcode' },
  { name: 'Sendwave',     fee: 0,    spread: 0.972, affiliate: 'https://sendwave.com/?ref=yourcode' },
  { name: 'LemFi',        fee: 0,    spread: 0.970, affiliate: 'https://lemfi.com/?ref=yourcode' },
  { name: 'TapTap Send',  fee: 0,    spread: 0.971, affiliate: 'https://taptapsend.com/?ref=yourcode' },
  { name: 'Revolut',      fee: 0,    spread: 0.968, affiliate: 'https://revolut.com/?ref=yourcode' },
  { name: 'Azimo',        fee: 1.99, spread: 0.975, affiliate: 'https://azimo.com/?ref=yourcode' },
  { name: 'Xoom',         fee: 4.99, spread: 0.980, affiliate: 'https://xoom.com/?ref=yourcode' },
  { name: 'Western Union',fee: 5.00, spread: 0.968, affiliate: 'https://westernunion.com/?ref=yourcode' },
  { name: 'Paysend',      fee: 2.00, spread: 0.975, affiliate: 'https://paysend.com/?ref=yourcode' },
  { name: 'TransferGo',   fee: 0.99, spread: 0.980, affiliate: 'https://transfergo.com/?ref=yourcode' },
  { name: 'OFX',          fee: 0,    spread: 0.978, affiliate: 'https://ofx.com/?ref=yourcode' },
  { name: 'Instarem',     fee: 0,    spread: 0.974, affiliate: 'https://instarem.com/?ref=yourcode' },
];

// Fetch real Wise rate
async function getWiseRate(from, to) {
  try {
    const response = await axios.get(
      `https://wise.com/rates/history+live?source=${from}&target=${to}&length=1&resolution=hourly&unit=day`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'application/json'
        }
      }
    );
    const data = response.data;
    if (data && data.length > 0) {
      return data[data.length - 1].value;
    }
    return null;
  } catch (error) {
    console.error('Wise rate error:', error.message);
    return null;
  }
}

app.get('/', (req, res) => {
  res.send('Remadvisor backend is running! 🚀');
});

app.get('/rates', async (req, res) => {
  const from = req.query.from || 'GBP';
  const to = req.query.to || 'NGN';
  const amount = parseFloat(req.query.amount) || 500;

  try {
    // Get real Wise rate
    let midRate = await getWiseRate(from, to);
    if (!midRate) {
      console.log('Wise rate failed, using fallback API');
      const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
      midRate = response.data.rates[to];
    }

    if (!midRate) {
      return res.status(400).json({ error: `Currency pair ${from}→${to} not supported` });
    }

    console.log(`Mid-market rate ${from}→${to}: ${midRate}`);

    // Get real Sendwave rate
    const sendwaveData = await getSendwaveRate(from, to, amount);

    // Calculate rates for all apps
    const results = await Promise.all(APPS.map(async app => {
      let effectiveRate, fee, recipientGets;

      if (app.name === 'Wise') {
        fee = 0;
        effectiveRate = midRate;
        recipientGets = amount * effectiveRate;

      } else if (app.name === 'Sendwave' && sendwaveData) {
        fee = sendwaveData.fee;
        effectiveRate = sendwaveData.rate;
        recipientGets = (amount - fee) * effectiveRate;

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
        isRealRate: ['Wise', 'Sendwave'].includes(app.name)
      };
    }));

    // Sort by recipient gets
    results.sort((a, b) => b.recipientGets - a.recipientGets);
    results[0].isBest = true;

    res.json({ from, to, amount, midRate, results });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

app.listen(3000, () => {
  console.log('Remadvisor server running on http://localhost:3000');
});