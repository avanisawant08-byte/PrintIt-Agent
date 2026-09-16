const fs = require('fs');
const path = require('path');

const shopPortalDir = 'c:/Users/avani/Downloads/print it/print it/shop_portal';

// 1. Create PrintAgent.jsx
const printAgentPath = path.join(shopPortalDir, 'src/pages/dashboard/PrintAgent.jsx');
const printAgentContent = `import React, { useState, useEffect } from 'react';
import api from '../../core/api';

const PrintAgent = () => {
  const [device, setDevice] = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stationName, setStationName] = useState('Counter-Station-1');

  useEffect(() => {
    fetchAgentStatus();
  }, []);

  const fetchAgentStatus = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/shop/agent');
      if (res.data && res.data.device) {
        setDevice(res.data.device);
        if (res.data.device.pairing_code) {
          setPairingCode(res.data.device.pairing_code);
          setCodeExpiresAt(new Date(res.data.device.pairing_code_expires_at));
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

  const isOnline = device && device.status === 'ONLINE';

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
          className="self-start sm:self-auto px-4 py-2 bg-surface-container border border-glass-edge/40 hover:border-primary/40 rounded-xl text-xs font-semibold text-on-surface flex items-center gap-2 cursor-pointer transition-all"
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
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
              <div className={\`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold \${
                isOnline 
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }\`}>
                <span className={\`w-2 h-2 rounded-full \${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}\`} />
                {isOnline ? 'ONLINE' : (device ? device.status : 'NOT PAIRED')}
              </div>
            </div>

            <div className="flex items-center gap-3.5 my-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">desktop_windows</span>
              </div>
              <div>
                <h3 className="font-display font-bold text-on-surface text-base">
                  {device?.device_name || 'No Linked Station'}
                </h3>
                <p className="text-xs text-on-surface-variant">
                  {device?.selected_printer ? \`Printer: \${device.selected_printer}\` : 'Default Windows Printer'}
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
            </div>
          </div>

          {/* Quick Info Box */}
          <div className="p-4 bg-surface-container/60 rounded-xl border border-glass-edge/30 text-xs text-on-surface-variant leading-relaxed">
            <span className="font-bold text-on-surface flex items-center gap-1.5 mb-1.5">
              <span className="material-symbols-outlined text-primary text-base">info</span>
              How Automatic Printing Works
            </span>
            When a customer submits a print order, PrintIt's cloud notifies your desktop agent in real-time. The agent verifies document integrity, verifies silent spooling, and cleans temporary files immediately.
          </div>
        </div>

        {/* Right Column: Pairing Code Section */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-glass-edge shadow-lg flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-display font-bold text-on-surface flex items-center gap-2">
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
`;

fs.writeFileSync(printAgentPath, printAgentContent, 'utf8');
console.log('Created PrintAgent.jsx successfully!');

// 2. Update App.jsx to include route
const appPath = path.join(shopPortalDir, 'src/App.jsx');
let appContent = fs.readFileSync(appPath, 'utf8');

if (!appContent.includes('PrintAgent')) {
  appContent = appContent.replace(
    "const Settings = lazy(() => import('./pages/dashboard/Settings'));",
    "const Settings = lazy(() => import('./pages/dashboard/Settings'));\nconst PrintAgent = lazy(() => import('./pages/dashboard/PrintAgent'));"
  );

  appContent = appContent.replace(
    '<Route path="settings" element={<Settings />} />',
    '<Route path="settings" element={<Settings />} />\n            <Route path="agent" element={<PrintAgent />} />'
  );

  fs.writeFileSync(appPath, appContent, 'utf8');
  console.log('Updated App.jsx with /dashboard/agent route');
}

// 3. Update DashboardLayout.jsx to include nav item
const layoutPath = path.join(shopPortalDir, 'src/pages/dashboard/DashboardLayout.jsx');
let layoutContent = fs.readFileSync(layoutPath, 'utf8');

if (!layoutContent.includes('/dashboard/agent')) {
  layoutContent = layoutContent.replace(
    "{ name: 'Support & FAQ', path: '/dashboard/support', icon: 'help_outline' },",
    "{ name: 'Print Agent', path: '/dashboard/agent', icon: 'print_connect' },\n    { name: 'Support & FAQ', path: '/dashboard/support', icon: 'help_outline' },"
  );

  fs.writeFileSync(layoutPath, layoutContent, 'utf8');
  console.log('Updated DashboardLayout.jsx with Print Agent nav item');
}
