import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { rfqRoutes } from './routes/rfq.routes';
import { quoteRoutes } from './routes/quote.routes';
import { settlementRoutes } from './routes/settlement.routes';
import { priceRoutes } from './routes/price.routes';
import { candleRoutes } from './routes/candle.routes';
import { MakerBotService } from './services/maker-bot.service';
import { PriceCandleService } from './services/candle.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/rfq', rfqRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/settlement', settlementRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/candles', candleRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  
  // Start Maker BOTs
  MakerBotService.start();
  // Start price candle service
  PriceCandleService.start();
});

