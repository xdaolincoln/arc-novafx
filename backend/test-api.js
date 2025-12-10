// Simple test script for Backend API
require('dotenv').config();
const { privateKeyToAccount } = require('viem/accounts');

const BASE_URL = 'http://localhost:3001';

// Get taker address from TAKER_PRIVATE_KEY
function getTakerAddress() {
  const takerPrivateKey = process.env.TAKER_PRIVATE_KEY;
  if (!takerPrivateKey) {
    throw new Error('TAKER_PRIVATE_KEY must be set in .env');
  }
  const key = takerPrivateKey.startsWith('0x') ? takerPrivateKey : `0x${takerPrivateKey}`;
  const account = privateKeyToAccount(key);
  return account.address;
}

// Get maker address from MAKER_PRIVATE_KEY
function getMakerAddress() {
  const makerPrivateKey = process.env.MAKER_PRIVATE_KEY;
  if (!makerPrivateKey) {
    throw new Error('MAKER_PRIVATE_KEY must be set in .env');
  }
  const key = makerPrivateKey.startsWith('0x') ? makerPrivateKey : `0x${makerPrivateKey}`;
  const account = privateKeyToAccount(key);
  return account.address;
}

async function testAPI() {
  console.log('🧪 Testing Backend API...\n');

  try {
    // 1. Health Check
    console.log('1. Health Check:');
    const health = await fetch(`${BASE_URL}/health`);
    console.log(await health.json());
    console.log('');

    // 2. Create RFQ
    console.log('2. Create RFQ:');
    const rfqResponse = await fetch(`${BASE_URL}/api/rfq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { currency: 'USDC', amount: '1' },
        to: { currency: 'EURC' },
        tenor: 'instant',
        takerAddress: getTakerAddress(),
      }),
    });
    const rfqData = await rfqResponse.json();
    console.log(rfqData);
    const rfqId = rfqData.rfqId;
    console.log('');

    // 3. Wait for quote
    console.log('3. Waiting for quote (2 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('');

    // 4. Get Quotes
    console.log('4. Get Quotes:');
    const quotesResponse = await fetch(`${BASE_URL}/api/quotes/${rfqId}`);
    const quotesData = await quotesResponse.json();
    console.log(quotesData);
    const quoteId = quotesData.quotes?.[0]?.id;
    console.log('');

    if (quoteId) {
      // 5. Accept Quote
      console.log('5. Accept Quote:');
      const acceptResponse = await fetch(`${BASE_URL}/api/quotes/${rfqId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          takerAddress: getTakerAddress(),
        }),
      });
      const acceptData = await acceptResponse.json();
      console.log(acceptData);
      const tradeId = acceptData.trade?.id;
      console.log('');

      if (tradeId) {
        // 6. Get Trade
        console.log('6. Get Trade:');
        const tradeResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}`);
        const tradeData = await tradeResponse.json();
        console.log(tradeData);
        console.log('');

        // 7. Taker Fund Trade
        console.log('7. Taker Fund Trade:');
        console.log(`💰 Taker needs to fund: ${tradeData.trade?.fromAmount} ${tradeData.trade?.fromToken}`);
        console.log('⚠️  Note: Taker needs to approve tokens first (outside this test)');
        console.log('⚠️  Taker needs USDC balance to fund');
        try {
          const takerFundResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}/fund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: getTakerAddress(),
              role: 'taker',
            }),
          });
          const takerFundData = await takerFundResponse.json();
          console.log(takerFundData);
          console.log('');
        } catch (error) {
          console.log('⚠️  Taker fund failed (may need approval or balance):', error.message);
          console.log('');
        }

        // 8. Maker Fund Trade
        console.log('8. Maker Fund Trade:');
        console.log(`💰 Maker needs to fund: ${tradeData.trade?.toAmount} ${tradeData.trade?.toToken}`);
        console.log('⚠️  Note: Maker needs to approve tokens first (outside this test)');
        console.log('⚠️  Maker needs EURC balance to fund');
        try {
          const makerFundResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}/fund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: getMakerAddress(),
              role: 'maker',
            }),
          });
          const makerFundData = await makerFundResponse.json();
          console.log(makerFundData);
          console.log('');
        } catch (error) {
          console.log('⚠️  Maker fund failed (may need approval or balance):', error.message);
          console.log('');
        }

        // 9. Check Trade Status (should be 'funded')
        console.log('9. Check Trade Status:');
        const tradeStatusResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}`);
        const tradeStatusData = await tradeStatusResponse.json();
        console.log('Trade status:', tradeStatusData.trade?.status);
        console.log('');

        // 10. Settle Trade
        console.log('10. Settle Trade:');
        console.log('⚠️  Settlement time:', new Date(tradeStatusData.trade?.settlementTime * 1000).toISOString());
        console.log('⚠️  Current time:', new Date().toISOString());
        
        const waitTime = tradeStatusData.trade?.settlementTime - Math.floor(Date.now() / 1000);
        
        if (waitTime > 0) {
          console.log(`⏳ Waiting ${waitTime} seconds for settlement time...`);
          await new Promise(resolve => setTimeout(resolve, (waitTime + 1) * 1000)); // +1 để chắc chắn đã qua
          console.log('✅ Settlement time reached, calling settle...');
        }
        
        try {
          const settleResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}/settle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const settleData = await settleResponse.json();
          console.log(settleData);
          console.log('');
          
          // 11. Check Final Trade Status
          console.log('11. Check Final Trade Status:');
          const finalTradeResponse = await fetch(`${BASE_URL}/api/settlement/trade/${tradeId}`);
          const finalTradeData = await finalTradeResponse.json();
          console.log('Final trade status:', finalTradeData.trade?.status);
          console.log('');
        } catch (error) {
          console.log('⚠️  Settle failed:', error.message);
          console.log('');
        }
      }
    }

    console.log('✅ Test completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAPI();

