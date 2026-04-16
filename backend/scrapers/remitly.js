const axios = require('axios');

const CONDUIT_MAP = {
  'GBP-NGN': 'GBR:GBP-NGA:NGN',
  'GBP-GHS': 'GBR:GBP-GHA:GHS',
  'GBP-KES': 'GBR:GBP-KEN:KES',
  'GBP-UGX': 'GBR:GBP-UGA:UGX',
  'GBP-ZAR': 'GBR:GBP-ZAF:ZAR',
  'GBP-INR': 'GBR:GBP-IND:INR',
  'GBP-PHP': 'GBR:GBP-PHL:PHP',
  'GBP-PKR': 'GBR:GBP-PAK:PKR',
  'GBP-BDT': 'GBR:GBP-BGD:BDT',
  'USD-NGN': 'USA:USD-NGA:NGN',
  'USD-GHS': 'USA:USD-GHA:GHS',
  'USD-KES': 'USA:USD-KEN:KES',
  'USD-INR': 'USA:USD-IND:INR',
  'USD-PHP': 'USA:USD-PHL:PHP',
  'EUR-NGN': 'DEU:EUR-NGA:NGN',
  'EUR-GHS': 'DEU:EUR-GHA:GHS',
  'CAD-NGN': 'CAN:CAD-NGA:NGN',
  'CAD-GHS': 'CAN:CAD-GHA:GHS',
};

async function getRemitlyRate(from, to, amount = 500) {
  try {
    const conduitKey = `${from}-${to}`;
    const conduit = CONDUIT_MAP[conduitKey];

    if (!conduit) {
      console.log(`Remitly doesn't support ${from}→${to}`);
      return null;
    }

    const response = await axios.get(
      'https://api.remitly.io/v3/calculator/estimate',
      {
        params: {
          conduit,
          anchor: 'SEND',
          amount,
          purpose: 'OTHER',
          customer_segment: 'STANDARD',
          customer_recognition: 'UNRECOGNIZED',
          strict_promo: false
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'application/json',
          'Referer': 'https://www.remitly.com/'
        }
      }
    );

    const estimate = response.data?.estimate;
    if (!estimate) return null;

    const rate = parseFloat(estimate.exchange_rate?.base_rate);
    const fee = parseFloat(estimate.fee?.total_fee_amount) || 0;
    const recipientGets = parseFloat(estimate.receive_amount);

    console.log(`Remitly real rate ${from}→${to}: ${rate}, fee: £${fee}, gets: ${recipientGets}`);
    return { rate, fee, recipientGets };

  } catch (error) {
    console.error('Remitly error:', error.message);
    return null;
  }
}

module.exports = { getRemitlyRate };