import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { EventEmitter } from "events";
import path from 'path';

/**
 * Инициализация приложения и серверов
 */
const app = express();
app.use(cors());
app.use(express.json());

// Определение путей для статики. 
// В Docker-контейнере папка dist будет находиться в корневой рабочей директории.
const DIST_PATH = path.join(__dirname, 'dist');
app.use(express.static(DIST_PATH));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/**
 * Логгер для мониторинга событий (Требование ТЗ: Логи/Метрики)
 */
const log = (type: string, message: string) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
};

const eventBus = new EventEmitter();

// Хранилище для истории телеметрии (для формирования отчета CSV)
let telemetryHistory: any[] = [];

/**
 * Интерфейсы и начальная конфигурация
 */
interface TelemetryData {
  temp: number;
  pressure: number;
  sys_err: number;
  voltage: number;
  current: number;
  speed: number;
}

let CONFIG = {
  thresholds: {
    temp: { warn: 120, crit: 145, weight: 0.35 },
    press: { warn: 3.0, crit: 2.0, weight: 0.40 },
    volt: { warn: 95, crit: 80, weight: 0.25 }
  },
  loadMultiplier: 1 
};

/**
 * ФОРМУЛА ИНДЕКСА ЗДОРОВЬЯ (Прозрачная логика и веса)
 */
const calculateHealth = (raw: TelemetryData) => {
  let penalty = 0;
  let factors = [];
  let recommendations: string[] = [];

  // 1. Анализ температуры (Вес 35%)
  if (raw.temp >= CONFIG.thresholds.temp.crit) {
    const p = Math.round(CONFIG.thresholds.temp.weight * 100);
    penalty += p;
    factors.push({ name: "Критический перегрев", impact: p });
    recommendations.push("ЭКСТРЕННО: Снизить тягу, активировать доп. охлаждение.");
  } else if (raw.temp >= CONFIG.thresholds.temp.warn) {
    const p = 21; 
    penalty += p;
    factors.push({ name: "Повышенная температура", impact: p });
    recommendations.push("ВНИМАНИЕ: Контроль теплового режима двигателя.");
  }

  // 2. Анализ давления масла (Вес 40%)
  if (raw.pressure <= CONFIG.thresholds.press.crit) {
    const p = Math.round(CONFIG.thresholds.press.weight * 100);
    penalty += p;
    factors.push({ name: "Крит. давление масла", impact: p });
    recommendations.push("ОСТАНОВКА: Низкое давление масла! Риск заклинивания.");
  } else if (raw.pressure <= CONFIG.thresholds.press.warn) {
    const p = 20;
    penalty += p;
    factors.push({ name: "Снижение давления масла", impact: p });
    recommendations.push("ПРОВЕРКА: Уровень масла ниже нормы. Осмотреть на стоянке.");
  }

  // 3. Анализ напряжения (Вес 25%)
  if (raw.voltage <= CONFIG.thresholds.volt.crit) {
    const p = Math.round(CONFIG.thresholds.volt.weight * 100);
    penalty += p;
    factors.push({ name: "Критический разряд", impact: p });
    recommendations.push("ЭНЕРГОСБЕРЕЖЕНИЕ: Отключить вспомогательные системы.");
  } else if (raw.voltage <= CONFIG.thresholds.volt.warn) {
    const p = 10;
    penalty += p;
    factors.push({ name: "Низкое напряжение", impact: p });
  }

  // 4. Анализ системных ошибок
  if (raw.sys_err > 0) {
    const p = 20;
    penalty += p;
    factors.push({ name: "Сбой системы управления", impact: p });
    recommendations.push("ПЕРЕЗАГРУЗКА: Сбой контроллера. Выполнить сброс системы.");
  }

  const index = Math.max(0, 100 - penalty);
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

/**
 * ОБРАБОТКА ПОТОКА ДАННЫХ
 */
let distance = 0;
eventBus.on("telemetry_raw", (raw: TelemetryData) => {
  distance = (distance + (raw.speed / 3600)) % 100; // Условная карта пути
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

  // Сохранение истории для экспорта (Buffer)
  telemetryHistory.push(processed);
  if (telemetryHistory.length > 1000) telemetryHistory.shift();

  // Рассылка по WebSocket
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(processed));
    }
  });
});

/**
 * СИМУЛЯТОР ТЕЛЕМЕТРИИ (High-load Ready)
 */
let currentTemp = 75;
let currentPress = 4.0;
let isFailing = false;
let failCounter = 0;
let simulationInterval: NodeJS.Timeout;

const startSimulation = () => {
  if (simulationInterval) clearInterval(simulationInterval);
  const frequency = 1000 / CONFIG.loadMultiplier;
  
  simulationInterval = setInterval(() => {
    // Вероятность аномалии
    if (!isFailing && Math.random() > 0.98) {
      isFailing = true;
      failCounter = 20;
      log('ALARM', 'Simulating anomaly event');
    }

    if (isFailing && failCounter > 0) {
      currentTemp += 2.5;
      currentPress -= 0.2;
      failCounter--;
    } else {
      isFailing = false;
      if (currentTemp > 75) currentTemp -= 1.0;
      if (currentPress < 4.0) currentPress += 0.1;
      
      currentTemp += (Math.random() - 0.5) * 0.6;
      currentPress += (Math.random() - 0.5) * 0.03;
    }

    const mock: TelemetryData = {
      temp: currentTemp,
      pressure: Math.max(0.3, currentPress),
      sys_err: (isFailing && failCounter < 10) ? 1 : 0,
      voltage: 110 + (Math.random() * 2),
      current: 250 + (Math.random() * 30),
      speed: isFailing ? 40 : 88 + (Math.random() * 5),
    };
    
    eventBus.emit("telemetry_raw", mock);
  }, frequency);
};

/**
 * WebSocket Обработка команд
 */
wss.on('connection', (ws) => {
  log('WS', 'Client connected');
  ws.on('message', (message) => {
    try {
      const cmd = JSON.parse(message.toString());
      if (cmd.type === 'SET_LOAD') {
        CONFIG.loadMultiplier = cmd.value;
        log('WS_CMD', `Load multiplier updated: ${CONFIG.loadMultiplier}x`);
        startSimulation();
      }
    } catch (err) {
      log('ERROR', 'Failed to process WS message');
    }
  });
});

/**
 * REST API ЭНДПОИНТЫ
 */

// Health Check (Обязательное требование)
app.get('/api/health', (req, res) => {
  log('HEALTH', 'Status check requested');
  res.json({
    status: "UP",
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
    metrics: {
      memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      activeConnections: wss.clients.size,
      historyDepth: telemetryHistory.length
    }
  });
});

// Экспорт отчета в CSV
app.get("/api/export", (req, res) => {
  log('EXPORT', `Generating CSV report for ${telemetryHistory.length} records`);
  const headers = "Timestamp,HealthIndex,Speed,Temperature,OilPressure,Voltage,Status\n";
  const rows = telemetryHistory.map(d => {
    const time = new Date(d.timestamp).toISOString();
    return `${time},${d.index},${d.speed.toFixed(1)},${d.temp.toFixed(1)},${d.pressure.toFixed(2)},${d.voltage.toFixed(1)},${d.status}`;
  }).join("\n");

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=ktz_diagnostic_report.csv');
  res.status(200).send(headers + rows);
});

// Конфигурация порогов
app.post("/api/config", (req, res) => {
  log('CONFIG', 'Thresholds update received');
  CONFIG.thresholds = { ...CONFIG.thresholds, ...req.body };
  res.json({ success: true, current_config: CONFIG.thresholds });
});

/**
 * Финальная маршрутизация
 */
// Важно: Catch-all роут для React SPA должен быть ПОСЛЕ всех API эндпоинтов
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

/**
 * Запуск сервера
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('SYSTEM', `KTZ Digital Twin Backend listening on port ${PORT}`);
  log('SYSTEM', `Static files served from: ${DIST_PATH}`);
  startSimulation();
});