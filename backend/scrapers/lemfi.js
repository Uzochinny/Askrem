const axios = require('axios');

// Map currency codes to sender country names LemFi expects
const SENDER_COUNTRIES = {
  GBP: 'United Kingdom',
  USD: 'United States',
  EUR: 'Germany',
  AUD: 'Australia',
  CAD: 'Canada',
  AED: 'United Arab Emirates',
};

async function getLemFiRate(from, to, amount) {
  const senderCountry = SENDER_COUNTRIES[from];

  if (!senderCountry) {
    console.log(`LemFi: unsupported sending currency ${from}`);
    return null;
  }

  try {
    const response = await axios.post(
      'https://lemfi.com/api/lemonade/v2/exchange',
      {
        from,
        to,
        sender_country: senderCountry,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://lemfi.com',
          'Referer': 'https://lemfi.com/en-gb',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        timeout: 10000,
      }
    );

    const data = response.data?.data;
    if (!data || !data.rate) {
      console.log('LemFi: no rate in response');
      return null;
    }

    const rate = parseFloat(data.rate);
    const fee  = parseFloat(data.transaction_fee) || 0;

    // Sanity check — catch the "31 quintillion" bug
    if (rate > 1000000 && to !== 'IDR' && to !== 'VND') {
      console.log(`LemFi: rate ${rate} looks invalid for ${from}→${to}`);
      return null;
    }

    const recipientGets = (amount - fee) * rate;

    console.log(`LemFi ${from}→${to}: rate=${rate}, fee=${fee}`);

    return {
      name:         'LemFi',
      fee,
      rate,
      recipientGets: parseFloat(recipientGets.toFixed(2)),
    };

  } catch (error) {
    console.error('LemFi scraper error:', error.message);
    return null;
  }
}

module.exports = { getLemFiRate };