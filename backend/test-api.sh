#!/bin/bash

echo "🧪 Testing Backend API..."
echo ""

BASE_URL="http://localhost:3001"

# Test Health Check
echo "1. Health Check:"
curl -s "$BASE_URL/health" | jq .
echo ""

# Test Create RFQ
echo "2. Create RFQ:"
RFQ_RESPONSE=$(curl -s -X POST "$BASE_URL/api/rfq" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {
      "currency": "USDC",
      "amount": "1000"
    },
    "to": {
      "currency": "EURC"
    },
    "tenor": "instant",
    "takerAddress": "0x1234567890123456789012345678901234567890"
  }')

echo "$RFQ_RESPONSE" | jq .
RFQ_ID=$(echo "$RFQ_RESPONSE" | jq -r '.rfqId')
echo ""

# Wait for quote
echo "3. Waiting for quote (2 seconds)..."
sleep 2

# Get Quotes
echo "4. Get Quotes for RFQ:"
curl -s "$BASE_URL/api/quotes/$RFQ_ID" | jq .
echo ""

# Accept Quote
echo "5. Accept Quote:"
QUOTES_RESPONSE=$(curl -s "$BASE_URL/api/quotes/$RFQ_ID")
QUOTE_ID=$(echo "$QUOTES_RESPONSE" | jq -r '.quotes[0].id')

ACCEPT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/quotes/$RFQ_ID/accept" \
  -H "Content-Type: application/json" \
  -d "{
    \"quoteId\": \"$QUOTE_ID\",
    \"takerAddress\": \"0x1234567890123456789012345678901234567890\"
  }")

echo "$ACCEPT_RESPONSE" | jq .
TRADE_ID=$(echo "$ACCEPT_RESPONSE" | jq -r '.trade.id')
echo ""

# Get Trade
echo "6. Get Trade:"
curl -s "$BASE_URL/api/settlement/trade/$TRADE_ID" | jq .
echo ""

echo "✅ Test completed!"

