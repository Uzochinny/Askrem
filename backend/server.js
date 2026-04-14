const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

const APPS = [
  { name: 'Wise',         fee: 3.69, spread: 0.995, affiliate: 'https://wise.com/invite/u/yourcode' },
  { name: 'Remitly',      fee: 2.99, spread: 0.985, affiliate: 'https://remitly.com/?referralcode=yourcode' },
  { name: 'WorldRemit',   fee: 1.99, spread: 0.978, affiliate: 'https://worldremit.com/?referral=yourcode' },
  { name: 'Sendwave',     fee: 0,    spread: 0.972, affiliate: 'https://sendwave.com/?ref=yourcode' },
  { name: 'LemFi',        fee: 0,    spread: 0.970, affiliate: 'https://lemfi.com/?ref=yourcode' },
  { name: 'Azimo',        fee: 1.99, spread: 0.975, affiliate: 'https://azimo.com/?ref=yourcode' },
  { name: 'Xoom',         fee: 4.99, spread: 0.980, affiliate: 'https://xoom.com/?ref=yourcode' },
  { name: 'Western Union', fee: 5.00, spread: 0.968, affiliate: 'https://westernunion.com/?ref=yourcode' },
  { name: 'Paysend',      fee: 2.00, spread: 0.975, affiliate: 'https://paysend.com/?ref=yourcode' },
  { name: 'TransferGo',   fee: 0.99, spread: 0.980, affiliate: 'https://transfergo.com/?ref=yourcode' },
  { name: 'OFX',          fee: 0,    spread: 0.978, affiliate: 'https://ofx.com/?ref=yourcode' },
  { name: 'Instarem',     fee: 0,    spread: 0.974, affiliate: 'https://instarem.com/?ref=yourcode' },
];

app.get('/', (req, res) => {
  res.send('Askrem backend is running! 🚀');
});

app.get('/rates', async (req, res) => {
  const from = req.query.from || 'GBP';
  const to = req.query.to || 'NGN';
  const amount = parseFloat(req.query.amount) || 500;

  try {
    const response = await axios.get(`https://open.er-api.com/v6/latest/${from}`);
    const midRate = response.data.rates[to];

    if (!midRate) {
      return res.status(400).json({ error: `Currency pair ${from}→${to} not supported` });
    }

    const results = APPS.map(app => {
      const amountAfterFee = amount - app.fee;
      const effectiveRate = midRate * app.spread;
      const recipientGets = amountAfterFee * effectiveRate;
      return {
        name: app.name,
        fee: app.fee,
        effectiveRate: parseFloat(effectiveRate.toFixed(4)),
        recipientGets: parseFloat(recipientGets.toFixed(2)),
        affiliate: app.affiliate,
        isBest: false
      };
    }).sort((a, b) => b.recipientGets - a.recipientGets);

    results[0].isBest = true;

    res.json({ from, to, amount, midRate, results });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

app.listen(3000, () => {
  console.log('Askrem server running on http://localhost:3000');
});