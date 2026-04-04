import React, { useEffect, useState, useRef, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  Activity, 
  Zap, 
  Gauge, 
  MapPin, 
  Thermometer, 
  Wind,
  ShieldCheck,
  Database,
  Sun,
  Moon,
  Info,
  Download,
  History,
  AlertOctagon,
  Clock,
  TrendingDown,
  Lock
} from 'lucide-react';

// --- ТИПЫ ДАННЫХ ---
interface Telemetry {
  timestamp: number;
  temp: number;      // Было temp_eng
  pressure: number;  // Было press_oil
  voltage: number;   // Было volt_batt
  sys_err: number;
  speed: number;
  index: number;
  status: string;
  top_factors: { name: string; impact: number }[];
  location: { x: number };
  latency: number;
  recommendation?: string;
}

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [data, setData] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [connStatus, setConnStatus] = useState<'online' | 'offline' | 'connecting'>('connecting');
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [isHighLoad, setIsHighLoad] = useState(false);
  
  const ws = useRef<WebSocket | null>(null);
  const lastUpdate = useRef<number>(Date.now());

  // Текущее состояние
  const displayData = replayIndex !== null ? history[replayIndex] : data;
  
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'ktz2026') { // Твой пароль
      setIsAuthenticated(true);
    } else {
      alert('Доступ запрещен: Неверный код инженера');
    }
  };

  // --- WEBSOCKET & REALTIME LOGIC ---
  const connect = () => {
    setConnStatus('connecting');
    const socket = new WebSocket(`ws://${window.location.hostname}:3000/ws`);

    socket.onopen = () => setConnStatus('online');

    socket.onmessage = (event) => {
      const now = Date.now();
      const payload: Telemetry = JSON.parse(event.data);
      
      // Замер задержки (от сервера до отрисовки)
      payload.latency = now - payload.timestamp;
      
      setData(payload);
      setHistory(prev => {
        const newHistory = [...prev, payload];
        return newHistory.slice(-900); // 15 минут при 1Гц
      });
      lastUpdate.current = now;
    };

    socket.onclose = () => {
      setConnStatus('offline');
      setTimeout(connect, 3000);
    };

    ws.current = socket;
  };

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, []);

  // Переключение режима Highload (для демонстрации жюри)
  const toggleHighLoad = () => {
    setIsHighLoad(!isHighLoad);
    ws.current?.send(JSON.stringify({ type: 'SET_LOAD', value: !isHighLoad ? 10 : 1 }));
  };

  // --- ЭКСПОРТ (CSV) ---
  const exportToCSV = () => {
    if (history.length === 0) return;
    
    const headers = "Time,HealthIndex,Speed,Temp,OilPress,Volt,Status\n";
    const csvContent = history.map(h => 
      `${new Date(h.timestamp).toLocaleTimeString()},${h.index},${h.speed.toFixed(1)},${h.temp.toFixed(1)},${h.pressure.toFixed(2)},${h.voltage.toFixed(1)},${h.status}`
    ).join("\n");
    
    const blob = new Blob(["\ufeff" + headers + csvContent], { type: 'text/csv;charset=utf-8;' }); // \ufeff для Excel (поддержка кириллицы)
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.style.display = 'none'; // Скрываем
    a.href = url;
    a.download = `KTZ_Report_${Date.now()}.csv`;
    
    document.body.appendChild(a); // Обязательно добавляем в DOM
    a.click();
    
    // Очистка
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 100);
  };

  // --- ECHARTS CONFIG ---
  const chartOptions = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { 
      trigger: 'axis',
      backgroundColor: theme === 'dark' ? '#1a1c2e' : '#fff',
      textStyle: { color: theme === 'dark' ? '#fff' : '#000' }
    },
    grid: { top: 20, right: 10, bottom: 40, left: 40 },
    xAxis: { 
      type: 'category', 
      data: history.map(h => new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})),
      axisLabel: { color: '#64748b', fontSize: 9, hideOverlap: true }
    },
    yAxis: { 
      type: 'value', 
      min: 0, 
      max: 105, 
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } 
    },
    dataZoom: [{ type: 'inside' }],
    series: [{
      name: 'Health Index',
      data: history.map(h => h.index),
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 3, color: '#3b82f6' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(59,130,246,0.4)' }, { offset: 1, color: 'transparent' }]
        }
      }
    }]
  }), [history, theme]);

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-[9999]">
        <div className="p-8 bg-white/5 border border-white/10 rounded-[2rem] backdrop-blur-md w-full max-w-md text-center">
          <div className="w-16 h-16 bg-blue-500/20 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter italic">
            KTZ Digital Twin
          </h1>
          <p className="text-slate-400 text-sm mb-8">Система мониторинга защищена. Введите ключ доступа.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-white text-center text-xl tracking-[0.5em] focus:outline-none focus:border-blue-500 transition-all"
              autoFocus
            />
            <button 
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl transition-all uppercase italic tracking-widest"
            >
              Войти в систему
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col transition-all duration-300 ${
      theme === 'dark' ? 'bg-[#05070a] text-slate-200' : 'bg-[#f8fafc] text-slate-900'
    }`}>
      
      {/* HEADER */}
      <header className={`h-16 md:h-20 flex justify-between items-center px-6 border-b shrink-0 ${
        theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-blue-600 rounded-xl text-white shadow-xl shadow-blue-600/20">
            <Activity size={24}/>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic leading-none">KTZ <span className="text-blue-500 font-normal ml-1">Twin v1.0</span></h1>
            <p className="text-[9px] opacity-40 font-mono tracking-widest uppercase">Digital Health Monitoring</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Режим нагрузки (Демо-функция) */}
          <button 
            onClick={toggleHighLoad}
            className={`px-3 py-1.5 rounded-lg text-[9px] font-black border transition-all ${
              isHighLoad ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 opacity-40'
            }`}
          >
            HIGH-LOAD x10
          </button>

          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-[9px] font-bold opacity-30 uppercase">Latency</span>
            <span className={`text-xs font-mono font-bold ${displayData && displayData.latency < 100 ? 'text-emerald-500' : 'text-amber-500'}`}>
              {displayData?.latency ?? 0}ms
            </span>
          </div>

          <div className={`px-4 py-1.5 rounded-full border text-[10px] font-black tracking-widest flex items-center gap-2 ${
            connStatus === 'online' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'
          }`}>
             <div className={`w-1.5 h-1.5 rounded-full ${connStatus === 'online' ? 'bg-emerald-500' : 'bg-red-500 animate-ping'}`} />
             {connStatus.toUpperCase()}
          </div>

          <div className={`flex p-1 rounded-xl ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200'}`}>
            <button onClick={() => setTheme('light')} className={`p-1.5 rounded-lg ${theme === 'light' ? 'bg-white text-blue-600' : 'text-slate-500'}`}><Sun size={14}/></button>
            <button onClick={() => setTheme('dark')} className={`p-1.5 rounded-lg ${theme === 'dark' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}><Moon size={14}/></button>
          </div>
        </div>
      </header>

      {/* DASHBOARD */}
      <main className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col gap-6">
        
        <div className="grid grid-cols-12 gap-6 flex-[3] min-h-0">
          
          {/* LEFT: HEALTH INDEX (Explainability) */}
          <div className={`col-span-12 lg:col-span-5 rounded-[2.5rem] p-8 border relative overflow-hidden flex flex-col justify-between transition-all ${
            displayData?.status === 'Критично' ? 'bg-red-500/10 border-red-500/40 shadow-2xl' :
            theme === 'dark' ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200'
          }`}>
             <div className="relative z-10">
               <div className="flex justify-between items-start">
                 <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-30 italic">Locomotive Integrity</span>
                 {replayIndex !== null && <span className="bg-amber-500 text-black text-[9px] px-2 py-1 rounded font-black">REPLAY</span>}
               </div>
               <div className="mt-4 flex items-baseline gap-4">
                 <h2 className="text-8xl md:text-[10rem] font-black tracking-tighter leading-none italic">{displayData?.index ?? '--'}</h2>
                 <span className="text-2xl font-bold opacity-20">%</span>
               </div>
               
               <div className={`inline-flex items-center gap-2 px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest mt-6 ${
                 displayData?.status === 'Критично' ? 'bg-red-500 text-white' :
                 displayData?.status === 'Внимание' ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-white'
               }`}>
                 {displayData?.status || 'Waiting...'}
               </div>
             </div>

             <div className="grid grid-cols-2 gap-4 relative z-10">
               <div className={`p-5 rounded-3xl border ${theme === 'dark' ? 'bg-black/30 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
                 <p className="text-[9px] font-black opacity-30 uppercase mb-3 flex items-center gap-2"><TrendingDown size={12}/> Факторы штрафа</p>
                 <div className="space-y-2">
                    {displayData?.top_factors?.length ? displayData.top_factors.map((f, i) => (
                      <div key={i} className="flex justify-between text-[11px] font-bold">
                        <span className="opacity-60">{f.name}</span>
                        <span className="text-red-500">-{Math.abs(f.impact)}%</span>
                      </div>
                    )) : <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">Все системы в норме</div>}
                 </div>
               </div>
               
               <div className={`p-5 rounded-3xl border ${
                 displayData?.recommendation ? 'bg-blue-600/10 border-blue-500/40' : 
                 theme === 'dark' ? 'bg-black/30 border-white/5' : 'bg-slate-50 border-slate-200'
               }`}>
                 <p className="text-[9px] font-black opacity-30 uppercase mb-3 flex items-center gap-2"><AlertOctagon size={12}/> Рекомендация</p>
                 <p className="text-[11px] font-bold leading-snug">
                   {displayData?.recommendation || "Следовать по маршруту согласно графику. Вмешательство не требуется."}
                 </p>
               </div>
             </div>
             
             {/* Фоновая иконка для стиля */}
             <div className="absolute -bottom-10 -right-10 opacity-[0.03] pointer-events-none">
               <Activity size={300} />
             </div>
          </div>

          {/* RIGHT: METRICS & MAP */}
          <div className="col-span-12 lg:col-span-7 flex flex-col gap-6">
             <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard theme={theme} label="Velocity" value={displayData?.speed} unit="km/h" icon={<Gauge/>} />
                <MetricCard theme={theme} label="Eng. Temp" value={displayData?.temp} unit="°C" icon={<Thermometer/>} warn={displayData?.temp && displayData.temp > 90} />
                <MetricCard theme={theme} label="Oil Press" value={displayData?.pressure} unit="bar" icon={<Wind/>} warn={displayData?.pressure && displayData.pressure < 2.5} />
                <MetricCard theme={theme} label="Circuit" value={displayData?.voltage} unit="V" icon={<Zap/>} warn={displayData?.voltage && displayData.voltage < 85} />
             </div>

             {/* MAP / ROUTE */}
             <div className={`flex-1 rounded-[2.5rem] border p-8 relative overflow-hidden transition-all ${
               theme === 'dark' ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200 shadow-sm'
             }`}>
                <div className="flex justify-between items-center mb-10">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30 flex items-center gap-2"><MapPin size={14} className="text-blue-500"/> Route Overview</span>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500/40"/> <span className="text-[9px] font-bold opacity-40">WARN ZONE</span></div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500/40"/> <span className="text-[9px] font-bold opacity-40">CRIT ZONE</span></div>
                  </div>
                </div>

                <div className="relative h-12 mt-16">
                   {/* Track Background */}
                   <div className={`absolute w-full h-[6px] top-1/2 -translate-y-1/2 rounded-full ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'}`}>
                      {/* Ограничения */}
                      <div className="absolute left-[25%] w-[10%] h-full bg-amber-500/30 rounded-sm" />
                      <div className="absolute left-[70%] w-[5%] h-full bg-red-500/40 rounded-sm" />
                   </div>
                   
                   {/* Track Progress */}
                   <div 
                     className="absolute h-[6px] top-1/2 -translate-y-1/2 bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-1000 ease-linear rounded-full"
                     style={{ width: `${displayData?.location?.x || 0}%` }}
                   />

                   {/* Locomotive Indicator */}
                   <div 
                     className="absolute top-1/2 -translate-y-1/2 transition-all duration-1000 ease-linear flex flex-col items-center"
                     style={{ left: `calc(${displayData?.location?.x || 0}% - 15px)` }}
                   >
                     <div className="px-2 py-1 bg-white text-black text-[9px] font-black rounded shadow-xl mb-2 italic">EL-KTZ</div>
                     <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center text-white ring-4 ring-blue-500/20">
                       <Activity size={12}/>
                     </div>
                   </div>
                </div>
                
                <div className="mt-12 flex justify-between text-[10px] font-black opacity-30 uppercase tracking-widest">
                  <span>Departure: Station A</span>
                  <span className="text-blue-500 font-bold opacity-100">Current Pos: {(displayData?.location?.x || 0).toFixed(1)} km</span>
                  <span>Arrival: Station B</span>
                </div>
             </div>
          </div>
        </div>

        {/* BOTTOM: GRAPH & REPLAY */}
        <div className={`h-64 rounded-[2.5rem] border p-6 flex flex-col transition-all ${
          theme === 'dark' ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200'
        }`}>
          <div className="flex justify-between items-center mb-4 px-2">
             <div className="flex items-center gap-6 flex-1">
               <span className="text-[10px] font-black uppercase tracking-widest opacity-30 flex items-center gap-2 shrink-0">
                 <History size={14}/> Replay & Trends
               </span>
               <div className="flex items-center gap-4 flex-1 max-w-xl">
                 <Clock size={14} className={replayIndex !== null ? 'text-amber-500' : 'opacity-20'} />
                 <input 
                    type="range" 
                    min="0" 
                    max={Math.max(0, history.length - 1)} 
                    value={replayIndex ?? history.length - 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setReplayIndex(val === history.length - 1 ? null : val);
                    }}
                    className="flex-1 h-1.5 bg-blue-500/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                 />
                 <span className="text-[10px] font-mono opacity-40 w-16 text-right shrink-0">
                   {replayIndex !== null ? `HIST: -${history.length - 1 - replayIndex}s` : 'LIVE FEED'}
                 </span>
               </div>
             </div>
             
             <button onClick={exportToCSV} className="text-[10px] font-black flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all">
               <Download size={14}/> GENERATE REPORT
             </button>
          </div>

          <div className="flex-1 min-h-0">
             <ReactECharts option={chartOptions} style={{height: '100%'}} />
          </div>
        </div>

      </main>

      <footer className="h-10 border-t flex items-center justify-between px-8 text-[9px] font-black uppercase tracking-[0.4em] opacity-30 shrink-0">
        <div className="flex gap-6">
          <span>Buffer: {history.length}/900 samples</span>
          <span>Sampling: 1Hz</span>
        </div>
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> UI_READY_FOR_DEMO</span>
          <span>Digital Twin Core v1.4.2</span>
        </div>
      </footer>
    </div>
  );
};

const MetricCard = ({ label, value, unit, icon, warn, theme }: any) => (
  <div className={`p-5 rounded-3xl border flex flex-col justify-between transition-all group ${
    warn ? 'bg-red-500/10 border-red-500/40 shadow-lg' : 
    theme === 'dark' ? 'bg-white/[0.03] border-white/5' : 'bg-white border-slate-200'
  }`}>
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${warn ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-500/10 text-blue-500'}`}>
      {React.cloneElement(icon, { size: 16 })}
    </div>
    <div>
      <p className="text-[9px] font-black uppercase opacity-30 tracking-widest mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black italic">{value !== undefined ? (typeof value === 'number' ? value.toFixed(1) : value) : '--'}</span>
        <span className="text-[10px] font-bold opacity-30 italic">{unit}</span>
      </div>
    </div>
  </div>
);

export default App;