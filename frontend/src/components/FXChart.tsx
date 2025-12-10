'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
} from 'lightweight-charts';
import { BACKEND_URL } from '@/config/wagmi';

type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

interface FXChartProps {
  timeframe?: Timeframe;
  currentRate?: number | null;
  data?: CandlestickData<Time>[]; // optional override
}

export default function FXChart({ data, timeframe = '1h', currentRate }: FXChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const [chartData, setChartData] = useState<CandlestickData<Time>[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch candles from backend (built by PriceCandleService)
  useEffect(() => {
    let cancelled = false;

    // If external data is provided, use it directly
    if (data && data.length > 0) {
      setChartData(data);
      return;
    }

    const fetchCandles = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/candles/USDC-EURC?tf=${timeframe}&limit=200`,
        );
        const json = await res.json();

        let candles: CandlestickData<Time>[] = [];

        if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
          candles = (json.data as any[]).map((c) => ({
            time: Number(c.time) as Time,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
          }));

          // Sync last candle with currentRate if provided (for exact header match)
          if (candles.length > 0 && currentRate != null) {
            const last = candles[candles.length - 1];
            last.close = currentRate;
            last.high = Math.max(last.high, currentRate);
            last.low = Math.min(last.low, currentRate);
          }
        } else if (currentRate != null) {
          // Fallback: flat candles around current rate when backend has no data
          const now = Math.floor(Date.now() / 1000);
          const tfSeconds: Record<Timeframe, number> = {
            '5m': 5 * 60,
            '15m': 15 * 60,
            '30m': 30 * 60,
            '1h': 60 * 60,
            '4h': 4 * 60 * 60,
            '1d': 24 * 60 * 60,
          };
          const interval = tfSeconds[timeframe];
          const count = timeframe === '1d' || timeframe === '4h' ? 30 : 100;

          for (let i = count; i >= 0; i--) {
            const t = (now - i * interval) as Time;
            candles.push({
              time: t,
              open: currentRate,
              high: currentRate,
              low: currentRate,
              close: currentRate,
            });
          }
        }

        if (!cancelled) {
          setChartData(candles);
        }
      } catch (err) {
        console.error('Error fetching candles:', err);
        if (!cancelled && currentRate != null) {
          const now = Math.floor(Date.now() / 1000);
          setChartData([
            {
              time: now as Time,
              open: currentRate,
              high: currentRate,
              low: currentRate,
              close: currentRate,
            },
          ]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchCandles();

    return () => {
      cancelled = true;
    };
  }, [data, timeframe, currentRate]);

  // Init / update chart when data changes
  useEffect(() => {
    if (!chartRef.current) return;

    // Clear previous chart instance
    chartRef.current.innerHTML = '';

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight || 360,
      layout: {
        background: { color: '#0f2027' },
        textColor: '#ddd',
      },
      grid: {
        vertLines: { color: '#1a2e35' },
        horzLines: { color: '#1a2e35' },
      },
      rightPriceScale: {
        borderColor: '#1a2e35',
      },
      timeScale: {
        borderColor: '#1a2e35',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartInstanceRef.current = chart;

    let candleSeries: ISeriesApi<'Candlestick', Time>;
    try {
      candleSeries = (chart as any).addSeries({
        type: 'Candlestick',
        upColor: '#00D4AA',
        downColor: '#ff4444',
        borderVisible: false,
        wickUpColor: '#00D4AA',
        wickDownColor: '#ff4444',
      }) as ISeriesApi<'Candlestick', Time>;
    } catch {
      candleSeries = (chart as any).addCandlestickSeries({
        upColor: '#00D4AA',
        downColor: '#ff4444',
        borderVisible: false,
        wickUpColor: '#00D4AA',
        wickDownColor: '#ff4444',
      }) as ISeriesApi<'Candlestick', Time>;
    }

    seriesRef.current = candleSeries;

    if (chartData.length > 0) {
      candleSeries.setData(chartData);
    } else if (loading) {
      candleSeries.setData([]);
    }

    const handleResize = () => {
      if (chartRef.current && chartInstanceRef.current) {
        chartInstanceRef.current.applyOptions({
          width: chartRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [chartData, loading]);

  return (
    <div
      ref={chartRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    />
  );
}


