const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getSendwaveRate } = require('./scrapers/sendwave');
const { getWiseRate } = require('./scrapers/wise');
const { getTapTapRate } = require('./scrapers/taptapsend');

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
  { name: 'Nala',         fee: 0,    spread: 0.971, affiliate: 'https://nala.com/?ref=yourcode' },
];

app.get('/', (req, res) => {
  res.send('Remadvisor backend is running! 🚀');
});

app.get('/rates', async (req, res) => {
  const from = req.query.from || 'GBP';
  const to = req.query.to || 'NGN';
  const amount = parseFloat(req.query.amount) || 500;

  try {
    // Get real Wise rate and fee
    const wiseData = await getWiseRate(from, to, amount);
    let midRate = wiseData ? wiseData.rate : null;

    // Fallback to open.er-api if Wise fails
    if (!midRate) {
      console.log('Wise rate failed, using fallback API');
      const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
      midRate = response.data.rates[to];
    }

    if (!midRate) {
      return res.status(400).json({ error: `Currency pair ${from}→${to} not supported` });
    }

    console.log(`Mid-market rate ${from}→${to}: ${midRate}`);

    // Get real scraper rates in parallel
    const [sendwaveData, tapTapData] = await Promise.all([
      getSendwaveRate(from, to, amount),
      getTapTapRate(from, to, amount),
    ]);

    // Calculate rates for all apps
    const results = await Promise.all(APPS.map(async app => {
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
        isRealRate: ['Wise', 'Sendwave', 'TapTap Send'].includes(app.name)
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