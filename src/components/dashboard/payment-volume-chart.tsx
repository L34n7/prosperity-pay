import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import { compactMoneyFormatter } from "@/lib/dashboard/formatters";
import { paymentVolume } from "@/lib/dashboard/mock-data";

const width = 760;
const height = 240;
const paddingX = 22;
const paddingTop = 18;
const paddingBottom = 28;
const values = paymentVolume.map((item) => item.value);
const min = Math.min(...values) * 0.75;
const max = Math.max(...values) * 1.08;
const graphHeight = height - paddingTop - paddingBottom;
const graphWidth = width - paddingX * 2;

const points = paymentVolume.map((item, index) => ({
  ...item,
  x: paddingX + (index / (paymentVolume.length - 1)) * graphWidth,
  y: paddingTop + ((max - item.value) / (max - min)) * graphHeight,
}));

const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
const areaPath = `${linePath} L${points.at(-1)?.x},${height - paddingBottom} L${points[0].x},${height - paddingBottom} Z`;

export function PaymentVolumeChart() {
  return (
    <section className="panel volume-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fluxo de caixa</p>
          <h2>Volume de pagamentos</h2>
        </div>
        <button className="icon-button" aria-label="Mais opções"><MoreHorizontal size={19} /></button>
      </div>
      <div className="volume-summary">
        <strong>R$ 162.640,00</strong>
        <span><ArrowUpRight size={14} /> 18,4% no período</span>
      </div>
      <div className="chart-wrap" aria-label="Gráfico de volume de pagamentos nos últimos 30 dias">
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22e6a1" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#22e6a1" stopOpacity="0" />
            </linearGradient>
            <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[0, 1, 2, 3].map((line) => (
            <line key={line} x1={paddingX} x2={width - paddingX} y1={paddingTop + line * (graphHeight / 3)} y2={paddingTop + line * (graphHeight / 3)} className="chart-grid" />
          ))}
          <path d={areaPath} fill="url(#volumeFill)" />
          <path d={linePath} className="chart-line" filter="url(#lineGlow)" />
          {points.map((point) => (
            <g key={point.label} className="chart-point">
              <circle cx={point.x} cy={point.y} r="12" className="chart-hit" />
              <circle cx={point.x} cy={point.y} r="3.5" className="chart-dot" />
              <g className="chart-tooltip">
                <rect x={point.x - 48} y={point.y - 39} width="96" height="27" rx="7" />
                <text x={point.x} y={point.y - 21} textAnchor="middle">{compactMoneyFormatter.format(point.value)}</text>
              </g>
            </g>
          ))}
          {points.map((point, index) => index % 2 === 0 && (
            <text key={point.label} x={point.x} y={height - 4} textAnchor="middle" className="chart-label">{point.label}</text>
          ))}
        </svg>
      </div>
    </section>
  );
}
