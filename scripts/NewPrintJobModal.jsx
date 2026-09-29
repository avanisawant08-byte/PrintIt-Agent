import React, { useState, useEffect, useMemo } from 'react';
import api from '../core/api';

const NewPrintJobModal = ({ onClose, onJobCreated }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [colorMode, setColorMode] = useState('bw'); // 'bw' | 'color'
  const [paperSize, setPaperSize] = useState('A4');
  const [sides, setSides] = useState('single'); // 'single' | 'double'
  const [padOddDuplex, setPadOddDuplex] = useState(true);
  const [orientation, setOrientation] = useState('portrait'); // 'portrait' | 'landscape'
  const [copies, setCopies] = useState(1);
  const [pagesPerPaper, setPagesPerPaper] = useState(1);
  const [pageRange, setPageRange] = useState('');
  const [repeatImageOnGrid, setRepeatImageOnGrid] = useState(true);
  const [isMultiGrid, setIsMultiGrid] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [targetPrinter, setTargetPrinter] = useState('');

  // Agent State & detected printers
  const [agentDevice, setAgentDevice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const res = await api.get('/shop/agent');
        if (res.data?.device) {
          setAgentDevice(res.data.device);
        }
      } catch (e) {
        console.warn('Could not load agent details for walk-in modal:', e);
      }
    };
    fetchAgent();
  }, []);

  // Multi-file grid toggle auto-activation when multiple files added
  useEffect(() => {
    if (selectedFiles.length > 1) {
      setIsMultiGrid(true);
      if (pagesPerPaper === 1) {
        setPagesPerPaper(selectedFiles.length <= 2 ? 2 : 4);
      }
    } else {
      setIsMultiGrid(false);
    }
  }, [selectedFiles.length]);

  // Detected printers from agent
  const availablePrinters = useMemo(() => {
    const list = new Set();
    if (agentDevice?.available_printers) {
      let raw = agentDevice.available_printers;
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
    if (agentDevice?.selected_printer) list.add(agentDevice.selected_printer);
    if (agentDevice?.selected_printer_bw) list.add(agentDevice.selected_printer_bw);
    if (agentDevice?.selected_printer_color) list.add(agentDevice.selected_printer_color);
    return Array.from(list);
  }, [agentDevice]);

  // Price Calculation Logic
  const singlePrice = colorMode === 'color' ? 10 : 2;
  const doublePrice = colorMode === 'color' ? 18 : 3;
  const estimatedPages = Math.max(1, selectedFiles.length || 1);
  const isDoubleSided = sides === 'double';
  const sheetCost = isDoubleSided
    ? (Math.floor(estimatedPages / 2) * doublePrice) + ((estimatedPages % 2) * singlePrice)
    : (estimatedPages * singlePrice);
  const totalPrice = (sheetCost * copies).toFixed(2);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const isAgentActive = agentDevice && ['ONLINE', 'READY', 'PRINTING'].includes(agentDevice.status);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      alert('Please upload at least one document or image file.');
      return;
    }

    try {
      setIsSubmitting(true);
      setUploadProgress('Uploading document(s) to secure cloud storage...');

      // 1. Upload files
      const formData = new FormData();
      selectedFiles.forEach(file => {
        formData.append('files', file);
      });

      const uploadRes = await api.post('/upload/multiple', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const uploadedFiles = uploadRes.data?.files || [];
      if (uploadedFiles.length === 0) {
        throw new Error('Upload succeeded but no file records returned.');
      }

      setUploadProgress('Queueing print order to desktop Print Agent...');

      // 2. Prepare print options
      const printOptions = {
        color: colorMode,
        copies: Math.max(1, copies),
        size: paperSize,
        sides,
        orientation,
        pages_per_paper: pagesPerPaper,
        pages: pageRange.trim() || undefined,
        pad_odd_duplex: sides === 'double' ? padOddDuplex : false,
        repeat_image_on_grid: repeatImageOnGrid,
        multi_file_grid: isMultiGrid && selectedFiles.length > 1,
        printer_name: targetPrinter || undefined
      };

      // 3. Create walk-in order
      const walkInRes = await api.post('/shop/orders/walk-in', {
        files: uploadedFiles,
        print_options: printOptions,
        customer_phone: customerPhone.trim() || undefined,
        amount_total: parseFloat(totalPrice)
      });

      // 4. Notify user and close
      const isDispatched = walkInRes.data?.agent_dispatched;
      const toast = document.createElement('div');
      toast.textContent = isDispatched
        ? '🖨️ Walk-in print created & spooled to Print Agent!'
        : '📋 Walk-in order created and added to queue!';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#059669;color:#fff;padding:12px 24px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);

      if (onJobCreated) onJobCreated();
      onClose();

    } catch (err) {
      console.error('Walk-in order submission failed:', err);
      alert('Failed to create walk-in print: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSubmitting(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div 
        className="glass-panel-heavy rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-glass-edge animate-fade-in relative bg-surface-container text-on-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-glass-edge/30 bg-surface-container-low flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-2xl">print</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-on-surface">New Counter / Walk-in Print</h2>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isAgentActive 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isAgentActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                  {isAgentActive ? 'AGENT ONLINE' : 'AGENT OFFLINE'}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant">Upload documents or photos to print silently on your counter station.</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-surface-variant text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {/* Upload Section */}
          <section>
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('new-file-input').click()}
              className="rounded-2xl p-6 border-dashed border-2 border-primary/40 bg-surface-container-low/50 hover:bg-surface-container-high/40 flex flex-col items-center justify-center text-center transition-all cursor-pointer group relative"
            >
              <input
                id="new-file-input"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform text-primary">
                <span className="material-symbols-outlined text-3xl">cloud_upload</span>
              </div>
              <h3 className="text-base font-bold text-on-surface mb-0.5">
                Drop files here or browse from PC / USB
              </h3>
              <p className="text-xs text-on-surface-variant">
                Supports PDF, Images (PNG, JPG), Word (DOCX) • Multiple files supported
              </p>
            </div>

            {/* Attached Files List */}
            {selectedFiles.length > 0 && (
              <div className="mt-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-on-surface-variant px-1">
                  <span>Selected Documents ({selectedFiles.length})</span>
                  <button 
                    type="button" 
                    onClick={() => setSelectedFiles([])}
                    className="text-rose-400 hover:text-rose-300 text-[11px] cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                  {selectedFiles.map((file, idx) => (
                    <div 
                      key={idx} 
                      className="p-2.5 bg-surface-container-high rounded-xl border border-glass-edge/40 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="material-symbols-outlined text-primary text-base">
                          {file.type?.includes('image') ? 'image' : 'description'}
                        </span>
                        <div className="truncate">
                          <p className="text-xs font-bold text-on-surface truncate">{file.name}</p>
                          <p className="text-[10px] text-on-surface-variant">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                        className="text-on-surface-variant hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* LEFT COLUMN: Hardware Target & Color */}
            <div className="space-y-4">

              {/* Target Printer Selection */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-base">print</span>
                    Target Physical Printer
                  </span>
                  <span className="text-[10px] text-primary font-mono">{availablePrinters.length} detected</span>
                </label>
                <select
                  value={targetPrinter}
                  onChange={(e) => setTargetPrinter(e.target.value)}
                  className="w-full bg-surface-container border border-glass-edge rounded-lg py-2 px-3 text-xs font-semibold text-on-surface outline-none focus:border-primary cursor-pointer"
                >
                  <option value="">Auto-Route (Honors B&W / Color Defaults)</option>
                  {availablePrinters.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <p className="text-[10px] text-on-surface-variant mt-1.5">
                  Leave on Auto to route to your configured B&W or Color printer automatically.
                </p>
              </div>

              {/* Color Mode Toggle */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-2 block">Color Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setColorMode('bw')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer flex items-center justify-center gap-1.5 ${
                      colorMode === 'bw'
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface-container text-on-surface-variant border-glass-edge hover:text-on-surface'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                    <span>B&W (₹{singlePrice}/page)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setColorMode('color')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer flex items-center justify-center gap-1.5 ${
                      colorMode === 'color'
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface-container text-on-surface-variant border-glass-edge hover:text-on-surface'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-indigo-500"></span>
                    <span>Full Color (₹{colorMode === 'color' ? doublePrice : 10}/page)</span>
                  </button>
                </div>
              </div>

              {/* Copies & Paper Size */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                  <label className="text-xs font-bold text-on-surface mb-2 block">Copies</label>
                  <div className="flex items-center justify-between bg-surface-container p-1 rounded-lg border border-glass-edge">
                    <button
                      type="button"
                      onClick={() => setCopies(Math.max(1, copies - 1))}
                      className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center font-bold text-xs hover:bg-surface-variant cursor-pointer"
                    >
                      -
                    </button>
                    <span className="font-mono font-bold text-sm">{copies}</span>
                    <button
                      type="button"
                      onClick={() => setCopies(copies + 1)}
                      className="w-7 h-7 rounded bg-surface-container-high flex items-center justify-center font-bold text-xs hover:bg-surface-variant cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                  <label className="text-xs font-bold text-on-surface mb-2 block">Paper Size</label>
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                    className="w-full bg-surface-container border border-glass-edge rounded-lg py-2 px-3 text-xs font-semibold text-on-surface outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="A4">A4 Standard</option>
                    <option value="A3">A3 Large</option>
                    <option value="Letter">Letter</option>
                  </select>
                </div>
              </div>

              {/* Customer Phone */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-1.5 block">Customer Phone (Optional)</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]">call</span>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full bg-surface-container border border-glass-edge rounded-lg py-2 pl-9 pr-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                  />
                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: Advanced N-Up, Duplex, Selective Pages */}
            <div className="space-y-4">

              {/* Sides / Duplex & Padding */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-2 block">Print Sides</label>
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <button
                    type="button"
                    onClick={() => setSides('single')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                      sides === 'single'
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface-container text-on-surface-variant border-glass-edge'
                    }`}
                  >
                    Single Sided
                  </button>
                  <button
                    type="button"
                    onClick={() => setSides('double')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                      sides === 'double'
                        ? 'bg-primary text-on-primary border-primary shadow-sm'
                        : 'bg-surface-container text-on-surface-variant border-glass-edge'
                    }`}
                  >
                    Double Sided (Duplex)
                  </button>
                </div>

                {sides === 'double' && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-on-surface cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={padOddDuplex}
                      onChange={(e) => setPadOddDuplex(e.target.checked)}
                      className="rounded text-primary focus:ring-0 cursor-pointer"
                    />
                    <span>Pad odd document pages with blank backing</span>
                  </label>
                )}
              </div>

              {/* N-Up Pages Per Sheet & Orientation */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-2 block">
                  Sheet Layout (N-Up Grid)
                </label>
                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {[1, 2, 4, 6].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setPagesPerPaper(num)}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                        pagesPerPaper === num
                          ? 'bg-primary text-on-primary border-primary shadow-sm'
                          : 'bg-surface-container text-on-surface-variant border-glass-edge hover:text-on-surface'
                      }`}
                    >
                      {num === 1 ? '1 Page' : `${num}-Up`}
                    </button>
                  ))}
                </div>

                {/* Orientation Switch */}
                <div className="flex items-center justify-between pt-2 border-t border-glass-edge/30 text-xs">
                  <span className="font-semibold text-on-surface-variant">Orientation:</span>
                  <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg border border-glass-edge">
                    <button
                      type="button"
                      onClick={() => setOrientation('portrait')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                        orientation === 'portrait' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      Portrait
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientation('landscape')}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                        orientation === 'landscape' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                      }`}
                    >
                      Landscape
                    </button>
                  </div>
                </div>

                {/* Collate multiple files onto 1 sheet grid */}
                {selectedFiles.length > 1 && (
                  <label className="flex items-center gap-2 mt-3 pt-2 border-t border-glass-edge/30 text-xs text-cyan-300 font-semibold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isMultiGrid}
                      onChange={(e) => setIsMultiGrid(e.target.checked)}
                      className="rounded text-cyan-500 focus:ring-0 cursor-pointer"
                    />
                    <span>Collate all {selectedFiles.length} files onto 1 combined sheet grid</span>
                  </label>
                )}

                {/* Photo Repeat Toggle */}
                {selectedFiles.length === 1 && pagesPerPaper > 1 && (
                  <label className="flex items-center gap-2 mt-3 pt-2 border-t border-glass-edge/30 text-xs text-on-surface cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={repeatImageOnGrid}
                      onChange={(e) => setRepeatImageOnGrid(e.target.checked)}
                      className="rounded text-primary focus:ring-0 cursor-pointer"
                    />
                    <span>Repeat photo across all {pagesPerPaper} grid cells (Passport/ID photo)</span>
                  </label>
                )}
              </div>

              {/* Selective Page Range */}
              <div className="bg-surface-container-high/60 p-4 rounded-xl border border-glass-edge/40">
                <label className="text-xs font-bold text-on-surface mb-1.5 block">
                  Selective Page Range (Optional)
                </label>
                <input
                  type="text"
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  placeholder="e.g. 1-3, 5, 7-10 (leave empty for all)"
                  className="w-full bg-surface-container border border-glass-edge rounded-lg py-2 px-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                />
                <p className="text-[10px] text-on-surface-variant mt-1.5">
                  Only the specified pages will be extracted and printed.
                </p>
              </div>

            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-glass-edge bg-surface-container-low flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-primary">₹{totalPrice}</span>
              <span className="text-xs text-on-surface-variant font-medium">({copies} {copies > 1 ? 'copies' : 'copy'})</span>
            </div>
            {uploadProgress ? (
              <span className="text-xs text-primary font-semibold animate-pulse">{uploadProgress}</span>
            ) : (
              <span className="text-[11px] text-on-surface-variant">Spools directly to connected PrintIt Agent</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-surface-container border border-glass-edge rounded-xl text-xs font-bold text-on-surface-variant hover:text-on-surface cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || selectedFiles.length === 0}
              className="px-6 py-2.5 bg-primary text-on-primary font-bold rounded-xl flex items-center gap-2 transition-all text-xs cursor-pointer shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-base ${isSubmitting ? 'animate-spin' : ''}`}>
                {isSubmitting ? 'autorenew' : 'print'}
              </span>
              <span>{isSubmitting ? 'Processing...' : 'Create & Print Now'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewPrintJobModal;
