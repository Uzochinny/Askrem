const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Test route
app.get('/', (req, res) => {
  res.send('Koridor backend is running! 🚀');
});

// Rates route
app.get('/rates', async (req, res) => {
  try {
    const response = await axios.get('https://open.er-api.com/v6/latest/GBP');
    const data = response.data;

    const currencies = ['NGN', 'GHS', 'KES', 'ZAR', 'INR', 'PHP'];
    const filtered = currencies.map(currency => ({
      currency: currency,
      rate: data.rates[currency]
    }));

    res.json(filtered);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

app.listen(3000, () => {
  console.log('Koridor server running on http://localhost:3000');
});