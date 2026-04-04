import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { EventEmitter } from "events";
import path from 'path';
import { fileURLToPath } from 'url';

// Настройка путей для ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Инициализация приложения и серверов
 */
const app = express();
app.use(cors());
app.use(express.json());

// Раздача статики (для Docker/Production)
const DIST_PATH = path.join(__dirname, 'dist');
app.use(express.static(DIST_PATH));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/**
 * Логгер для мониторинга событий
 */
const log = (type, message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
};

const eventBus = new EventEmitter();

// Хранилище для истории телеметрии (для формирования отчета CSV)
let telemetryHistory = [];

/**
 * Интерфейсы и начальная конфигурация
 */
let CONFIG = {
  thresholds: {
    temp: { warn: 120, crit: 150, weight: 0.35 },
    temp_conv: { warn: 90, crit: 110, weight: 0.35 },
    axle_temp: { warn: 70, crit: 90, weight: 0.50 },
    press: { warn: 2.1, crit: 2.0, weight: 0.40 },
    press_tm: { warn: 4.5, crit: 4.5, weight: 1.0 }, // 100% штраф
    sys_err: { crit: 0, weight: 0.20 },
    conv_curr: { warn: 1200, crit: 1500, weight: 0.40 },
    volt: { warn: 75, crit: 75, weight: 0.10 },
    velo: { warn: 101, crit: 120, weight: 0.15 }
  },
  loadMultiplier: 1 
};

/**
 * ФОРМУЛА ИНДЕКСА ЗДОРОВЬЯ (Прозрачная логика и веса)
 */
const calculateHealth = (raw) => {
  let penalty = 0;
  let factors = [];
  let recommendations = [];

  // 1. Температура двигателя
  if (raw.temp > CONFIG.thresholds.temp.crit) {
    penalty += 35;
    factors.push({ name: "Крит. темп. двигателя", impact: 35 });
    recommendations.push("АКТИВАЦИЯ ОХЛАЖДЕНИЯ: Ограничение мощности на 50%.");
  }

  // 2. Температура преобразователя
  if (raw.temp_conv > CONFIG.thresholds.temp_conv.crit) {
    penalty += 35;
    factors.push({ name: "Крит. темп. преобр.", impact: 35 });
    recommendations.push("ОТКЛЮЧЕНИЕ ТЯГИ: Перегрев преобразователя.");
  } else if (raw.temp_conv > CONFIG.thresholds.temp_conv.warn) {
    penalty += 20;
    factors.push({ name: "Повышенная темп. преобр.", impact: 20 });
  }

  // 3. Температура буксовых узлов
  if (raw.axle_temp > CONFIG.thresholds.axle_temp.crit) {
    penalty += 50;
    factors.push({ name: "Крит. темп. букс", impact: 50 });
    recommendations.push("ОСТАНОВКА: Осмотр состава.");
  } else if (raw.axle_temp > CONFIG.thresholds.axle_temp.warn) {
    penalty += 25;
    factors.push({ name: "Повышенная темп. букс", impact: 25 });
  }

  // 4. Давление масла
  if (raw.pressure < CONFIG.thresholds.press.crit) {
    penalty += 40;
    factors.push({ name: "Крит. давление масла", impact: 40 });
    recommendations.push("STOP ENGINE: Глушение двигателя, блокировка запуска.");
  }

  // 5. Давление в ТМ (Тормозная магистраль)
  if (raw.press_tm < CONFIG.thresholds.press_tm.crit) {
    penalty += 100;
    factors.push({ name: "Давление ТМ ниже нормы", impact: 100 });
    recommendations.push("ТОРМОЖЕНИЕ: Автоматическое срабатывание тормозов.");
  }

  // 6. Ток нагрузки
  if (raw.conv_curr > CONFIG.thresholds.conv_curr.crit) {
    penalty += 40;
    factors.push({ name: "Крит. ток нагрузки", impact: 40 });
    recommendations.push("ОТКЛЮЧЕНИЕ ДВИГАТЕЛЕЙ: Перегрузка по току.");
  } else if (raw.conv_curr > CONFIG.thresholds.conv_curr.warn) {
    penalty += 15;
    factors.push({ name: "Высокий ток нагрузки", impact: 15 });
  }

  // 7. Напряжение цепи
  if (raw.voltage < CONFIG.thresholds.volt.warn) {
    penalty += 10;
    factors.push({ name: "Низкое напряжение", impact: 10 });
    recommendations.push("ЭНЕРГОСБЕРЕЖЕНИЕ: Отключение вспомогательных систем.");
  }

  // 8. Скорость
  if (raw.speed > CONFIG.thresholds.velo.crit) {
    penalty += 15;
    factors.push({ name: "Превышение констр. скорости", impact: 15 });
    recommendations.push("АВТОТОРМОЖЕНИЕ: Превышение 120 км/ч.");
  }

  // 9. Системная ошибка
  if (raw.sys_err > 0) {
    penalty += 20;
    factors.push({ name: "Системная ошибка", impact: 20 });
  }

  const index = Math.max(0, 100 - penalty);
  
  return {
    index: Math.round(index),
    status: index >= 80 ? "Норма" : index >= 50 ? "Предупреждение" : "Авария",
    factors,
    recommendation: recommendations.length > 0 ? recommendations[0] : "Норма"
  };
};

/**
 * ОБРАБОТКА ПОТОКА ДАННЫХ
 */
let distance = 0;
eventBus.on("telemetry_raw", (raw) => {
  distance = (distance + (raw.speed / 3600)) % 100; // Условная карта пути
  const { index, status, factors, recommendation } = calculateHealth(raw);

  const processed = {
    ...raw,
    timestamp: Date.now(),
    index,
    status,
    top_factors: factors,
    recommendation,
    location: { x: distance },
    latency: 0 // Будет рассчитано на фронтенде
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
let currentTemp = 72;
let currentPress = 3.8;
let isFailing = false;
let failCounter = 0;
let simulationInterval;

const startSimulation = () => {
  if (simulationInterval) clearInterval(simulationInterval);
  const frequency = 1000 / CONFIG.loadMultiplier;
  
  simulationInterval = setInterval(() => {
    // Вероятность аномалии
    if (!isFailing && Math.random() > 0.985) {
      isFailing = true;
      failCounter = 15;
      log('ALARM', 'Simulating anomaly event');
    }

    if (isFailing && failCounter > 0) {
      currentTemp += 3.0;
      currentPress -= 0.2;
      failCounter--;
    } else {
      isFailing = false;
      if (currentTemp > 72) currentTemp -= 1.0;
      if (currentPress < 3.8) currentPress += 0.1;
      
      currentTemp += (Math.random() - 0.5) * 0.8;
      currentPress += (Math.random() - 0.5) * 0.05;
    }

    const mock = {
    temp: currentTemp,
    pressure: Math.max(0.2, currentPress),
    sys_err: (isFailing && failCounter < 5) ? 1 : 0,
    voltage: 110 + (Math.random() * 5),
    speed: isFailing ? 35 : 85 + (Math.random() * 10),
    fuel: Math.max(0, 85 - (distance * 0.5)),
    rpm: isFailing ? 900 + (Math.random() * 100) : 1800 + (Math.random() * 200),
    vibration: isFailing ? 6.2 + (Math.random() * 2) : 1.2 + (Math.random() * 0.5),
    load: isFailing ? 30 + (Math.random() * 10) : 70 + (Math.random() * 15),

    // Температура преобразователя (чуть ниже двигателя)
    temp_conv: currentTemp - 20 + (Math.random() * 5), 
    // Температура букс (в норме 40-60 градусов)
    axle_temp: 45 + (Math.random() * 10),             
    // Давление в тормозной магистрали (в норме ~5.1)
    press_tm: isFailing ? 4.2 : 5.1 + (Math.random() * 0.1), 
    // Ток нагрузки (в норме 600-900А)
    conv_curr: isFailing ? 1600 : 800 + (Math.random() * 300)
  };
    
    eventBus.emit("telemetry_raw", mock);
  }, frequency);
};

/**
 * WebSocket Обработка команд
 */
wss.on('connection', (ws) => {
  log('WS', 'Dashboard client connected');
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

// Health Check
app.get('/api/health', (req, res) => {
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

// Экспорт отчета в CSV (с поддержкой Excel BOM)
app.get("/api/export", (req, res) => {
  log('EXPORT', `Generating report for ${telemetryHistory.length} records`);
  
  // Обновленные заголовки
  const headers = "Time,HealthIndex,Status,Speed,Temp_Eng,Temp_Conv,Temp_Axle,Press_Oil,Press_TM,Current,Volt\n";
  
  const rows = telemetryHistory.map(d => {
    const time = new Date(d.timestamp).toLocaleTimeString();
    console.log("Current Display Data:", displayData);
    return [
      time,
      d.index,
      d.status,
      d.speed?.toFixed(1),
      d.temp?.toFixed(1),
      d.temp_conv?.toFixed(1),
      d.axle_temp?.toFixed(1),
      d.pressure?.toFixed(2),
      d.press_tm?.toFixed(2),
      d.conv_curr?.toFixed(0),
      d.voltage?.toFixed(1)
    ].join(",");
  }).join("\n");

  const BOM = '\uFEFF'; 
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=ktz_detailed_report.csv');
  res.status(200).send(BOM + headers + rows);
});

// Конфигурация порогов
app.post("/api/settings", (req, res) => {
  CONFIG.thresholds = { ...CONFIG.thresholds, ...req.body };
  res.json({ success: true, current: CONFIG.thresholds });
});

/**
 * Финальная маршрутизация
 */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return;
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

/**
 * Запуск сервера
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('SYSTEM', `KTZ Digital Twin Backend listening on port ${PORT}`);
  startSimulation();
});