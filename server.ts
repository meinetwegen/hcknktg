import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { EventEmitter } from "events";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const eventBus = new EventEmitter();

// Хранилище для истории (для формирования отчета CSV)
let telemetryHistory: any[] = [];

// --- ТЕЛЕМЕТРИЯ ИНТЕРФЕЙС ---
interface TelemetryData {
  temp: number;
  pressure: number;
  sys_err: number;
  voltage: number;
  current: number;
  speed: number;
}

// --- ДИНАМИЧЕСКАЯ КОНФИГУРАЦИЯ ---
let CONFIG = {
  thresholds: {
    temp: { warn: 120, crit: 145, weight: 0.35 },
    press: { warn: 3.0, crit: 2.0, weight: 0.40 },
    volt: { warn: 95, crit: 80, weight: 0.25 }
  },
  loadMultiplier: 1 
};

// --- ФОРМУЛА ИНДЕКСА ЗДОРОВЬЯ ---
const calculateHealth = (raw: TelemetryData) => {
  let penalty = 0;
  let factors = [];
  let recommendations: string[] = []; // Используем массив для сбора всех советов

  // 1. Температура (35%)
  if (raw.temp >= CONFIG.thresholds.temp.crit) {
    const p = Math.round(CONFIG.thresholds.temp.weight * 100); // 35%
    penalty += p;
    factors.push({ name: "Критический перегрев", impact: p });
    recommendations.push("ЭКСТРЕННО: Снизить тягу, активировать доп. охлаждение.");
  } else if (raw.temp >= CONFIG.thresholds.temp.warn) {
    // Делаем штраф 21%, чтобы статус гарантированно стал "Внимание" (100 - 21 = 79)
    const p = 21; 
    penalty += p;
    factors.push({ name: "Повышенная температура", impact: p });
    recommendations.push("ВНИМАНИЕ: Контроль теплового режима двигателя.");
  }

  // 2. Давление масла (40%)
  if (raw.pressure <= CONFIG.thresholds.press.crit) {
    const p = Math.round(CONFIG.thresholds.press.weight * 100);
    penalty += p;
    factors.push({ name: "Крит. давление масла", impact: p });
    recommendations.push("ОСТАНОВКА: Низкое давление масла! Риск заклинивания.");
  } else if (raw.pressure <= CONFIG.thresholds.press.warn) {
    penalty += 20;
    factors.push({ name: "Снижение давления масла", impact: 20 });
    recommendations.push("ПРОВЕРКА: Уровень масла ниже нормы. Осмотреть на стоянке.");
  }

  // 3. Напряжение (25%)
  if (raw.voltage <= CONFIG.thresholds.volt.crit) {
    const p = Math.round(CONFIG.thresholds.volt.weight * 100);
    penalty += p;
    factors.push({ name: "Критический разряд", impact: p });
    recommendations.push("ЭНЕРГОСБЕРЕЖЕНИЕ: Отключить вспомогательные системы.");
  } else if (raw.voltage <= CONFIG.thresholds.volt.warn) {
    penalty += 10;
    factors.push({ name: "Низкое напряжение", impact: 10 });
  }

  // 3. Системный сбой (тот самый рандомный штраф -20%)
  if (raw.sys_err > 0) {
    const p = 20;
    penalty += p;
    factors.push({ name: "Сбой системы управления", impact: p });
    recommendations.push("ПЕРЕЗАГРУЗКА: Сбой контроллера. Выполнить сброс системы.");
  }

  const index = Math.max(0, 100 - penalty);
  
  // Выбираем самую приоритетную рекомендацию или дефолтную
  const finalRecommendation = recommendations.length > 0 
    ? recommendations[0] 
    : "Следовать по маршруту согласно графику. Вмешательство не требуется.";

  return {
    index: Math.round(index),
    status: index > 80 ? "Норма" : index > 50 ? "Внимание" : "Критично",
    factors,
    recommendation: finalRecommendation
  };
};

let distance = 0;
// --- ОБРАБОТКА ПОТОКА ---
eventBus.on("telemetry_raw", (raw: TelemetryData) => {
  distance = (distance + (raw.speed / 3600)) % 100;
  const { index, status, factors, recommendation } = calculateHealth(raw);

  const processed = {
    ...raw,
    timestamp: Date.now(),
    index,
    status,
    top_factors: factors,
    recommendation,
    location: { x: distance }
  };

  // Сохраняем в историю для CSV (ограничим 1000 записей)
  telemetryHistory.push(processed);
  if (telemetryHistory.length > 1000) telemetryHistory.shift();

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(processed));
    }
  });
});

// --- СИМУЛЯТОР С ЗАПЛАНИРОВАННЫМИ АВАРИЯМИ ---
let currentTemp = 75;
let currentPress = 4.0;
let isFailing = false;
let failCounter = 0;
let simulationInterval: NodeJS.Timeout;

const startSimulation = () => {
  if (simulationInterval) clearInterval(simulationInterval); // Это правильно
  const frequency = 1000 / CONFIG.loadMultiplier;
  
  simulationInterval = setInterval(() => {
    // Шанс возникновения длительной аварии (раз в ~30-40 секунд при 1x)
    if (!isFailing && Math.random() > 0.97) {
      isFailing = true;
      failCounter = 15; // Авария длится 15 секунд, чтобы успеть прочитать совет
    }

    if (isFailing && failCounter > 0) {
      // Имитируем уход параметров в красную зону
      currentTemp += 2.0;
      currentPress -= 0.15;
      failCounter--;
    } else {
      isFailing = false;
      // Плавное восстановление к норме
      if (currentTemp > 75) currentTemp -= 0.8;
      if (currentPress < 4.0) currentPress += 0.08;
      
      // Небольшая болтанка в покое
      currentTemp += (Math.random() - 0.5) * 0.5;
      currentPress += (Math.random() - 0.5) * 0.02;
    }

    const mock: TelemetryData = {
      temp: currentTemp,
      pressure: Math.max(0.4, currentPress),
      sys_err: (isFailing && failCounter < 10) ? 1 : 0, // Ошибка ПО появляется не сразу
      voltage: 108 + (Math.random() * 4),
      current: 240 + (Math.random() * 40),
      speed: isFailing ? 45 : 92 + (Math.random() * 2),
    };
    
    eventBus.emit("telemetry_raw", mock);
  }, frequency);
};

// Обработка команд WebSocket
wss.on('connection', (ws) => {
    console.log("🟢 Client connected to Telemetry Stream");
    ws.on('message', (message) => {
        try {
            const cmd = JSON.parse(message.toString());
            if (cmd.type === 'SET_LOAD') {
                CONFIG.loadMultiplier = cmd.value;
                console.log(`Load changed to: ${CONFIG.loadMultiplier}x`);
                startSimulation();
            }
        } catch (err) {
            console.error("❌ Failed to parse WS message");
        }
    });
});

// --- ЭКСПОРТ CSV С ПОЛНЫМ НАБОРОМ ДАННЫХ ---
app.get("/api/export", (req, res) => {
  const headers = "Time,HealthIndex,Speed,Temp,OilPress,Volt,Status\n";
  const rows = telemetryHistory.map(d => {
    const time = new Date(d.timestamp).toLocaleTimeString('ru-RU', { hour12: false });
    return `${time},${d.index},${d.speed.toFixed(1)},${d.temp.toFixed(1)},${d.pressure.toFixed(2)},${d.voltage.toFixed(1)},${d.status}`;
  }).join("\n");

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=ktz_telemetry_report.csv');
  res.status(200).send(headers + rows);
});

// API для изменения конфига
app.post("/api/config", (req, res) => {
  CONFIG.thresholds = { ...CONFIG.thresholds, ...req.body };
  res.json({ status: "Updated", config: CONFIG.thresholds });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`KTZ Digital Twin Backend Ready on port ${PORT}`);
  startSimulation();
});