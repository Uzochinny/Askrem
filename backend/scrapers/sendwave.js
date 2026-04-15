const axios = require('axios');
// Country codes mapping
const COUNTRY_CODES = {
  GBP: { send: 'gb', receive: null },
  USD: { send: 'us', receive: null },
  EUR: { send: 'de', receive: null },
  NGN: { send: null, receive: 'ng' },
  GHS: { send: null, receive: 'gh' },
  KES: { send: null, receive: 'ke' },
  UGX: { send: null, receive: 'ug' },
  TZS: { send: null, receive: 'tz' },
  PHP: { send: null, receive: 'ph' },
  INR: { send: null, receive: 'in' },
};

async function getSendwaveRate(from, to, amount = 500) {
  try {
    const sendCountry = COUNTRY_CODES[from]?.send;
    const receiveCountry = COUNTRY_CODES[to]?.receive;

    if (!sendCountry || !receiveCountry) {
      console.log(`Sendwave doesn't support ${from}→${to}`);
      return null;
    }

    const url = `https://app.sendwave.com/v2/pricing-public?amountType=SEND&receiveCurrency=${to}&amount=${amount}&sendCurrency=${from}&sendCountryIso2=${sendCountry}&receiveCountryIso2=${receiveCountry}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
        'Origin': 'https://www.sendwave.com',
        'Referer': 'https://www.sendwave.com/'
      }
    });

    const data = response.data;
    const rate = parseFloat(data.baseExchangeRate);
    const fee = parseFloat(data.baseFeeAmount);

    console.log(`Sendwave real rate ${from}→${to}: ${rate}, fee: ${fee}`);
    return { rate, fee };

  } catch (error) {
    console.error('Sendwave error:', error.message);
    return null;
  }
}

module.exports = { getSendwaveRate };