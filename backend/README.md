# Backend API

Backend API cho FX app với RFQ Model.

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

Server sẽ chạy tại: http://localhost:3001

## 📡 API Endpoints

### Health Check
```
GET /health
```

### RFQ
```
POST /api/rfq
Body: {
  from: { currency: "USDC", amount: "1000" },
  to: { currency: "EURC" },
  tenor: "instant" | "hourly" | "daily",
  takerAddress: "0x..."
}

GET /api/rfq/:rfqId
```

### Quotes
```
GET /api/quotes/:rfqId
POST /api/quotes/:rfqId/accept
Body: {
  quoteId: "...",
  takerAddress: "0x..."
}
```

### Settlement
```
GET /api/settlement/trade/:tradeId
POST /api/settlement/trade/:tradeId/fund
POST /api/settlement/trade/:tradeId/settle
GET /api/settlement/ready
```

## 🧪 Testing

### Test với curl hoặc Postman

1. Start server:
```bash
npm run dev
```

2. Test trong terminal khác:
```bash
# Health check
curl http://localhost:3001/health

# Create RFQ
curl -X POST http://localhost:3001/api/rfq \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"currency": "USDC", "amount": "1000"},
    "to": {"currency": "EURC"},
    "tenor": "instant",
    "takerAddress": "0x1234567890123456789012345678901234567890"
  }'
```

### Test với script
```bash
# Sử dụng Node.js script
node test-api.js
```

## 🤖 Maker BOTs

Backend tự động chạy 3 Maker BOTs để provide quotes cho RFQ requests:

1. **BOT 1 (Aggressive)**: Rate thấp hơn 2% (giá tốt hơn cho taker)
2. **BOT 2 (Standard)**: Rate chuẩn từ CoinGecko
3. **BOT 3 (Conservative)**: Rate cao hơn 2% (giá tốt hơn cho maker)

BOTs sẽ tự động:
- Poll `/api/rfq/pending` mỗi 3 giây
- Provide quotes với pricing strategy khác nhau
- Không duplicate quotes (mỗi BOT chỉ quote 1 lần cho 1 RFQ)

### Environment Variables

Thêm vào `.env`:
```env
MAKER_BOT1_PRIVATE_KEY=0x...
MAKER_BOT2_PRIVATE_KEY=0x...
MAKER_BOT3_PRIVATE_KEY=0x...
```

Nếu không có, BOTs sẽ không start và bạn sẽ thấy warning.

## 📝 Notes

- Hiện tại dùng in-memory storage (sẽ migrate sang database sau)
- Maker BOTs tự động provide quotes khi có RFQ mới
- Rate được fetch từ CoinGecko API (với fallback)

