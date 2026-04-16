const axios = require('axios');

const COUNTRY_MAP = {
  GBP: 'GB', USD: 'US', EUR: 'EU', CAD: 'CA', AED: 'AE'
};

const CURRENCY_MAP = {
  NGN: 'NG', GHS: 'GH', KES: 'KE', UGX: 'UG',
  TZS: 'TZ', INR: 'IN', PHP: 'PH', PKR: 'PK',
  BDT: 'BD', ZAR: 'ZA'
};

async function getTapTapRate(from, to, amount = 500) {
  try {
    const response = await axios.get(
      'https://api.taptapsend.com/api/fxRates',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.taptapsend.com',
          'Referer': 'https://www.taptapsend.com/',
          'x-device-model': 'web',
          'x-device-id': 'web',
          'appian-version': 'web/2022-05-03.0'
        }
      }
    );

    const data = response.data;
    const sendCountry = COUNTRY_MAP[from];
    const receiveCountry = CURRENCY_MAP[to];

    if (!sendCountry || !receiveCountry) {
      console.log(`TapTap doesn't support ${from}→${to}`);
      return null;
    }

    const countryData = data.availableCountries?.find(
      c => c.isoCountryCode === sendCountry
    );

    if (!countryData) {
      console.log(`TapTap: sending country ${sendCountry} not found`);
      return null;
    }

    const corridor = countryData.corridors?.find(
      c => c.isoCountryCode === receiveCountry
    );

    if (!corridor) {
      console.log(`TapTap: corridor ${sendCountry}→${receiveCountry} not found`);
      return null;
    }

    const rate = parseFloat(corridor.fxRate);
    const fee = 0;

    console.log(`TapTap real rate ${from}→${to}: ${rate}, fee: ${fee}`);
    return { rate, fee };

  } catch (error) {
    console.error('TapTap error:', error.message);
    return null;
  }
}

module.exports = { getTapTapRate };