const axios = require('axios');

async function getWiseRate(from, to, amount = 500) {
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
    const rate = data && data.length > 0 ? data[data.length - 1].value : null;

    if (!rate) return null;

    // Wise fee structure for GBP sending
    // Fixed fee + percentage fee based on amount
    let fee;
    if (from === 'GBP') {
      fee = 0.54 + (amount * 0.0057); // ~0.62% + £0.54 fixed
    } else if (from === 'USD') {
      fee = 1.04 + (amount * 0.0062);
    } else if (from === 'EUR') {
      fee = 0.54 + (amount * 0.0062);
    } else {
      fee = amount * 0.007; // default 0.7%
    }

    fee = parseFloat(fee.toFixed(2));

    console.log(`Wise real rate ${from}→${to}: ${rate}, fee: £${fee}`);
    return { rate, fee };

  } catch (error) {
    console.error('Wise rate error:', error.message);
    return null;
  }
}

module.exports = { getWiseRate };