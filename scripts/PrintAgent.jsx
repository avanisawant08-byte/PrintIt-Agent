import React, { useState, useEffect, useMemo } from 'react';
import api from '../../core/api';

const PrintAgent = () => {
  const [device, setDevice] = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stationName, setStationName] = useState('Counter-Station-1');

  // Printer Routing State
  const [selectedBw, setSelectedBw] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedFallback, setSelectedFallback] = useState('');
  const [isSavingPrinters, setIsSavingPrinters] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Diagnostic Test Print State
  const [testPrinterTarget, setTestPrinterTarget] = useState('');
  const [isTestPrinting, setIsTestPrinting] = useState(false);
  const [testPrintMessage, setTestPrintMessage] = useState('');
  const [testPrintError, setTestPrintError] = useState('');

  useEffect(() => {
    fetchAgentStatus();
  }, []);

  const fetchAgentStatus = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/shop/agent');
      if (res.data && res.data.device) {
        const dev = res.data.device;
        setDevice(dev);
        setSelectedBw(dev.selected_printer_bw || '');
        setSelectedColor(dev.selected_printer_color || '');
        setSelectedFallback(dev.selected_printer || '');
        if (dev.pairing_code) {
          setPairingCode(dev.pairing_code);
          setCodeExpiresAt(new Date(dev.pairing_code_expires_at));
        }
      }
    } catch (err) {
      console.error('Failed to load agent status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    try {
      setIsGenerating(true);
      const res = await api.post('/shop/agent/pairing-code', {
        device_name: stationName || 'Counter-Station-1'
      });
      if (res.data && res.data.pairing_code) {
        setPairingCode(res.data.pairing_code);
        setCodeExpiresAt(new Date(Date.now() + 15 * 60 * 1000));
        fetchAgentStatus();
      }
    } catch (err) {
      alert('Failed to generate pairing code: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSavePrinters = async () => {
    try {
      setIsSavingPrinters(true);
      await api.put('/shop/agent/printer', {
        selected_printer: selectedFallback || null,
        selected_printer_bw: selectedBw || null,
        selected_printer_color: selectedColor || null
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      fetchAgentStatus();
    } catch (err) {
      alert('Failed to save printer routing: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSavingPrinters(false);
    }
  };

  const handleTestPrint = async () => {
    try {
      setIsTestPrinting(true);
      setTestPrintMessage('');
      setTestPrintError('');
      const target = testPrinterTarget || selectedFallback || selectedBw || selectedColor || null;
      const res = await api.post('/shop/agent/test-print', { printer_name: target });
      setTestPrintMessage(res.data?.message || 'Diagnostic test page queued for silent print!');
      setTimeout(() => setTestPrintMessage(''), 6000);
    } catch (err) {
      setTestPrintError(err.response?.data?.error || err.message || 'Failed to dispatch test print.');
      setTimeout(() => setTestPrintError(''), 6000);
    } finally {
      setIsTestPrinting(false);
    }
  };

  // Extract detected printers from the agent
  const availablePrinters = useMemo(() => {
    const list = new Set();
    if (device?.available_printers) {
      let raw = device.available_printers;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = []; }
      }
      if (Array.isArray(raw)) {
        raw.forEach(p => {
          const name = typeof p === 'string' ? p : p?.name;
          if (name) list.add(name);
        });
      }
    }
    if (device?.selected_printer) list.add(device.selected_printer);
    if (device?.selected_printer_bw) list.add(device.selected_printer_bw);
    if (device?.selected_printer_color) list.add(device.selected_printer_color);

    if (list.size === 0) {
      list.add('Virtual Test Printer (Save to Disk)');
    }
    return Array.from(list);
  }, [device]);

  const isOnline = device && ['ONLINE', 'READY', 'PRINTING'].includes(device.status);
  const isPrinting = device && device.status === 'PRINTING';

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-on-surface tracking-tight flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-3xl">print_connect</span>
            Remote Print Agent
          </h1>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-1">
            Connect your shop's desktop PC for silent, automatic background printing directly to local printers.
          </p>
        </div>

        <button
          onClick={fetchAgentStatus}
          disabled={isLoading}
          className="self-start sm:self-auto px-4 py-2 bg-surface-container border border-glass-edge/40 hover:border-primary/40 rounded-xl text-xs font-semibold text-on-surface flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-sm ${isLoading ? 'animate-spin' : ''}`}>refresh</span>
          Refresh Status
        </button>
      </div>

      {/* Main Status Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Device Status Card */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="glass-panel p-6 rounded-2xl border border-glass-edge shadow-lg flex flex-col gap-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Station Status</span>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                isPrinting
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : isOnline 
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  isPrinting 
                    ? 'bg-blue-400 animate-ping' 
                    : isOnline 
                    ? 'bg-emerald-400 animate-pulse' 
                    : 'bg-amber-400'
                }`} />
                {isPrinting ? 'PRINTING' : (isOnline ? 'ONLINE & READY' : (device ? device.status : 'NOT PAIRED'))}
              </div>
            </div>

            <div className="flex items-center gap-3.5 my-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">desktop_windows</span>
              </div>
              <div className="truncate">
                <h3 className="font-display font-bold text-on-surface text-base truncate">
                  {device?.device_name || 'No Linked Station'}
                </h3>
                <p className="text-xs text-on-surface-variant truncate">
                  {device?.selected_printer ? `Fallback: ${device.selected_printer}` : 'Auto-detected spooler'}
                </p>
              </div>
            </div>

            <div className="h-px w-full bg-glass-edge/20 my-1" />

            <div className="flex flex-col gap-2.5 text-xs text-on-surface-variant">
              <div className="flex justify-between">
                <span>Agent Version:</span>
                <span className="font-mono text-on-surface font-semibold">{device?.agent_version || '1.0.0'}</span>
              </div>
              <div className="flex justify-between">
                <span>Last Heartbeat:</span>
                <span className="font-mono text-on-surface font-semibold">
                  {device?.last_seen_at ? new Date(device.last_seen_at).toLocaleTimeString() : 'Never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Silent Spooling:</span>
                <span className="text-emerald-400 font-semibold">Enabled (SumatraPDF)</span>
              </div>
              <div className="flex justify-between">
                <span>Discovered Printers:</span>
                <span className="text-primary font-semibold font-mono">{availablePrinters.length} installed</span>
              </div>
            </div>
          </div>

          {/* Diagnostic Test Print Card */}
          <div className="glass-panel p-5 rounded-2xl border border-glass-edge shadow-lg flex flex-col gap-3">
            <div className="flex items-center gap-2 text-on-surface font-bold text-xs uppercase tracking-wider">
              <span className="material-symbols-outlined text-primary text-base">fact_check</span>
              Hardware Diagnostics
            </div>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Verify physical printer connectivity, toner swatches, and silent spooler communication.
            </p>

            <div className="flex flex-col gap-2 mt-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Target Diagnostic Printer:
              </label>
              <select
                value={testPrinterTarget}
                onChange={(e) => setTestPrinterTarget(e.target.value)}
                className="w-full bg-surface-container-high border border-glass-edge/40 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-on-surface outline-none focus:border-primary cursor-pointer"
              >
                <option value="">Default Routing (Auto)</option>
                {availablePrinters.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleTestPrint}
                disabled={isTestPrinting || !isOnline}
                className="mt-2 w-full py-2 px-3 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <span className={`material-symbols-outlined text-base ${isTestPrinting ? 'animate-spin' : ''}`}>
                  {isTestPrinting ? 'autorenew' : 'print'}
                </span>
                <span>{isTestPrinting ? 'Sending Test Page...' : 'Print Test Page'}</span>
              </button>

              {testPrintMessage && (
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5 animate-fade-in">
                  <span className="material-symbols-outlined text-sm shrink-0">check_circle</span>
                  <span>{testPrintMessage}</span>
                </div>
              )}

              {testPrintError && (
                <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-[11px] text-rose-400 font-semibold flex items-center gap-1.5 animate-fade-in">
                  <span className="material-symbols-outlined text-sm shrink-0">error</span>
                  <span>{testPrintError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Info Box */}
          <div className="p-4 bg-surface-container/60 rounded-xl border border-glass-edge/30 text-xs text-on-surface-variant leading-relaxed">
            <span className="font-bold text-on-surface flex items-center gap-1.5 mb-1.5">
              <span className="material-symbols-outlined text-primary text-base">info</span>
              Smart Hardware Routing
            </span>
            Incoming customer print jobs automatically route to your designated B&W or Color printer without manual switching.
          </div>
        </div>

        {/* Right Column: Routing Settings & Pairing Section */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Dedicated Hardware Printer Routing Card */}
          <div className="glass-panel p-6 sm:p-7 rounded-2xl border border-glass-edge shadow-lg flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-glass-edge/20 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-xl">tune</span>
                </div>
                <div>
                  <h2 className="text-base font-display font-bold text-on-surface">Default Printer Routing</h2>
                  <p className="text-xs text-on-surface-variant">Assign default physical hardware for Black & White vs. Color printing.</p>
                </div>
              </div>
              {saveSuccess && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full animate-fade-in">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  Printers Synced!
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* B&W Printer */}
              <div className="bg-surface-container/70 p-4 rounded-xl border border-glass-edge/30 flex flex-col gap-2">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
                  Default B&W (Monochrome) Printer
                </label>
                <select
                  value={selectedBw}
                  onChange={(e) => setSelectedBw(e.target.value)}
                  className="w-full bg-surface-container-high border border-glass-edge/40 rounded-lg px-3 py-2 text-xs font-semibold text-primary outline-none focus:border-primary cursor-pointer"
                >
                  <option value="">Auto (OS Default Spooler)</option>
                  {availablePrinters.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-on-surface-variant">
                  Used for standard single/double sided documents and text prints.
                </p>
              </div>

              {/* Color Printer */}
              <div className="bg-surface-container/70 p-4 rounded-xl border border-glass-edge/30 flex flex-col gap-2">
                <label className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-indigo-500 inline-block"></span>
                  Default Color / Photo Printer
                </label>
                <select
                  value={selectedColor}
                  onChange={(e) => setSelectedColor(e.target.value)}
                  className="w-full bg-surface-container-high border border-glass-edge/40 rounded-lg px-3 py-2 text-xs font-semibold text-primary outline-none focus:border-primary cursor-pointer"
                >
                  <option value="">Auto (OS Default Spooler)</option>
                  {availablePrinters.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-on-surface-variant">
                  Used when customer selects Full Color mode or Photo Grid printing.
                </p>
              </div>
            </div>

            {/* General Fallback Printer */}
            <div className="bg-surface-container/40 p-4 rounded-xl border border-glass-edge/20 flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="text-xs font-bold text-on-surface block mb-1">
                    General Fallback Printer
                  </label>
                  <select
                    value={selectedFallback}
                    onChange={(e) => setSelectedFallback(e.target.value)}
                    className="w-full bg-surface-container-high border border-glass-edge/40 rounded-lg px-3 py-2 text-xs font-semibold text-on-surface outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="">Auto (OS Default Spooler)</option>
                    {availablePrinters.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="self-end sm:self-center pt-2 sm:pt-4">
                  <button
                    type="button"
                    onClick={handleSavePrinters}
                    disabled={isSavingPrinters}
                    className="px-5 py-2.5 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/90 flex items-center gap-2 cursor-pointer shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">{isSavingPrinters ? 'hourglass_top' : 'save'}</span>
                    <span>{isSavingPrinters ? 'Saving...' : 'Save Printer Routing'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Pairing Code Section */}
          <div className="glass-panel p-6 sm:p-7 rounded-2xl border border-glass-edge shadow-lg flex flex-col gap-6">
            <div>
              <h2 className="text-base font-display font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">key</span>
                Station Pairing Code
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                Enter this 6-character code into the <strong>PrintIt Agent</strong> window on your shop PC to link the station.
              </p>
            </div>

            {/* Code Display Area */}
            {pairingCode ? (
              <div className="flex flex-col items-center justify-center p-6 bg-surface-container border border-primary/30 rounded-2xl gap-4">
                <span className="text-[11px] uppercase font-bold tracking-widest text-primary">Active 6-Digit Pairing Code</span>
                
                <div className="flex items-center gap-2 sm:gap-3">
                  {pairingCode.split('').map((char, index) => (
                    <div
                      key={index}
                      className="w-10 h-14 sm:w-12 sm:h-16 rounded-xl bg-background border-2 border-primary/50 flex items-center justify-center font-mono text-2xl sm:text-3xl font-black text-primary shadow-md shadow-primary/10"
                    >
                      {char}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={handleCopyCode}
                    className="px-4 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl flex items-center gap-1.5 hover:bg-primary/90 cursor-pointer shadow-md transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                    <span>{copied ? 'Code Copied!' : 'Copy Pairing Code'}</span>
                  </button>

                  <button
                    onClick={handleGenerateCode}
                    disabled={isGenerating}
                    className="px-4 py-2 bg-surface-bright text-on-surface border border-outline-variant font-bold text-xs rounded-xl hover:border-primary/40 cursor-pointer transition-all"
                  >
                    Generate New Code
                  </button>
                </div>

                <p className="text-[11px] text-on-surface-variant/80 mt-1">
                  Expires in 15 minutes • Single-use for station linking
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 bg-surface-container/50 border border-dashed border-glass-edge/60 rounded-2xl text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-3xl">add_to_queue</span>
                </div>
                <div>
                  <h3 className="font-display font-bold text-on-surface text-base">No Active Pairing Code</h3>
                  <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                    Click the button below to generate a new 6-character code to link your counter print station.
                  </p>
                </div>

                <div className="flex items-center gap-3 w-full max-w-xs">
                  <input
                    type="text"
                    value={stationName}
                    onChange={(e) => setStationName(e.target.value)}
                    placeholder="Station Name (e.g. Counter-POS-1)"
                    className="flex-1 bg-black/30 border border-outline-variant/40 rounded-xl px-3.5 py-2 text-xs text-on-surface outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleGenerateCode}
                    disabled={isGenerating}
                    className="px-5 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/90 flex items-center gap-2 cursor-pointer shadow-lg shadow-primary/20 transition-all shrink-0"
                  >
                    <span className="material-symbols-outlined text-sm">key</span>
                    <span>{isGenerating ? 'Generating...' : 'Generate Code'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 3 Step Setup Instructions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
              <div className="p-4 bg-surface-container/40 rounded-xl border border-glass-edge/20 flex flex-col gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center">1</div>
                <h4 className="font-bold text-xs text-on-surface">Launch Agent</h4>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Open the <strong>PrintIt Agent</strong> app on your Windows shop computer.
                </p>
              </div>

              <div className="p-4 bg-surface-container/40 rounded-xl border border-glass-edge/20 flex flex-col gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center">2</div>
                <h4 className="font-bold text-xs text-on-surface">Enter Code</h4>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Type the 6-digit code above into the pairing screen and click <strong>Connect</strong>.
                </p>
              </div>

              <div className="p-4 bg-surface-container/40 rounded-xl border border-glass-edge/20 flex flex-col gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center">3</div>
                <h4 className="font-bold text-xs text-on-surface">Auto-Print</h4>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  The agent links in seconds and automatically handles incoming print jobs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintAgent;
