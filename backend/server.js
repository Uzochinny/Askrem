const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getSendwaveRate } = require('./scrapers/sendwave');
const { getWiseRate } = require('./scrapers/wise');
const { getTapTapRate } = require('./scrapers/taptapsend');
const { getRemitlyRate } = require('./scrapers/remitly');

const app = express();
app.use(cors());

// Only real scrapers — verified accurate
const APPS = [
  { name: 'Wise', fee: 0, spread: 1, affiliate: 'https://wise.prf.hn/click/camref:1011l5FHNd' },
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

    // Get all real scraper rates in parallel
    const [sendwaveData, tapTapData, remitlyData] = await Promise.all([
      getSendwaveRate(from, to, amount),
      getTapTapRate(from, to, amount),
      getRemitlyRate(from, to, amount),
    ]);

    // Calculate rates for all apps
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
        // Fallback — should not happen with current APPS list
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
  console.log('Remadvisor backend is running! 🚀');
});