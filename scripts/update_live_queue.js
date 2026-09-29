const fs = require('fs');

const filePath = 'C:/Users/avani/Downloads/print it/print it/shop_portal/src/pages/dashboard/LiveQueue.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import for NewPrintJobModal and Link
if (!content.includes('NewPrintJobModal')) {
  content = content.replace(
    "import PrintReviewModal from '../../components/PrintReviewModal';",
    "import PrintReviewModal from '../../components/PrintReviewModal';\nimport NewPrintJobModal from '../../components/NewPrintJobModal';\nimport { Link } from 'react-router-dom';"
  );
}

// 2. Add state for agentDevice and showNewJobModal
if (!content.includes('showNewJobModal')) {
  content = content.replace(
    "const [colorFilter, setColorFilter] = useState('all');",
    "const [colorFilter, setColorFilter] = useState('all');\n  const [agentDevice, setAgentDevice] = useState(null);\n  const [showNewJobModal, setShowNewJobModal] = useState(false);"
  );
}

// 3. Fetch agent status in fetchOrders
if (!content.includes('/shop/agent')) {
  content = content.replace(
    "setOrders(res.data.data || res.data);\n      setLastUpdated(new Date());",
    "setOrders(res.data.data || res.data);\n      setLastUpdated(new Date());\n      try {\n        const aRes = await api.get('/shop/agent');\n        if (aRes.data?.device) setAgentDevice(aRes.data.device);\n      } catch (e) {}"
  );
}

// 4. Update handlePrint to accept fileIndex and forceMultiGrid
const oldHandlePrint = `  const handlePrint = async (orderId) => {
    try {
      const order = orders.find(o => o.order_id === orderId || o.id === orderId);
      let isMultiGrid = false;
      let hasMultipleFiles = false;
      if (order) {
        let opts = {};
        try { opts = typeof order.print_options === 'string' ? JSON.parse(order.print_options) : (order.print_options || {}); } catch(e) {}
        isMultiGrid = opts.multi_file_grid === true;
        let files = order.files;
        if (typeof files === 'string') {
          try { files = JSON.parse(files); } catch(e) { files = []; }
        }
        if (Array.isArray(files) && files.length > 1) {
          hasMultipleFiles = true;
        }
      }

      // Try dispatching to the linked desktop print agent first
      await api.post(\`/shop/orders/\${orderId}/dispatch-to-agent\`, { 
        file_index: isMultiGrid ? 0 : (hasMultipleFiles ? 'all' : 0),
        multi_file_grid: isMultiGrid
      });`;

const newHandlePrint = `  const handlePrint = async (orderId, fileIndex = null, forceMultiGrid = false) => {
    try {
      const order = orders.find(o => o.order_id === orderId || o.id === orderId);
      let isMultiGrid = Boolean(forceMultiGrid);
      let hasMultipleFiles = false;
      if (order) {
        let opts = {};
        try { opts = typeof order.print_options === 'string' ? JSON.parse(order.print_options) : (order.print_options || {}); } catch(e) {}
        if (!forceMultiGrid && opts.multi_file_grid === true) {
          isMultiGrid = true;
        }
        let files = order.files;
        if (typeof files === 'string') {
          try { files = JSON.parse(files); } catch(e) { files = []; }
        }
        if (Array.isArray(files) && files.length > 1) {
          hasMultipleFiles = true;
        }
      }

      let effectiveFileIndex;
      if (fileIndex !== null && fileIndex !== undefined) {
        effectiveFileIndex = fileIndex;
      } else {
        effectiveFileIndex = isMultiGrid ? 0 : (hasMultipleFiles ? 'all' : 0);
      }

      // Dispatch to the linked desktop print agent
      await api.post(\`/shop/orders/\${orderId}/dispatch-to-agent\`, { 
        file_index: effectiveFileIndex,
        multi_file_grid: isMultiGrid
      });`;

if (content.includes(oldHandlePrint)) {
  content = content.replace(oldHandlePrint, newHandlePrint);
  console.log('Updated handlePrint in LiveQueue.');
}

// 5. Add Live Agent Status pill & Walk-in Print button in header
const headerControlsTarget = '{/* Filter Button */}';
const headerControlsAddition = `{/* Agent Status Pill */}
          <Link
            to="/dashboard/agent"
            className={\`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-[1.02] cursor-pointer \${
              agentDevice?.status === 'PRINTING'
                ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                : (agentDevice && ['ONLINE', 'READY'].includes(agentDevice.status))
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
            }\`}
            title={agentDevice ? \`Station: \${agentDevice.device_name || 'Counter'} • \${agentDevice.selected_printer || 'Auto'} • Click for settings\` : 'Click to configure Print Agent'}
          >
            <span className={\`w-2 h-2 rounded-full \${
              agentDevice?.status === 'PRINTING'
                ? 'bg-blue-400 animate-ping'
                : (agentDevice && ['ONLINE', 'READY'].includes(agentDevice.status))
                ? 'bg-emerald-400 animate-pulse'
                : 'bg-amber-400'
            }\`}></span>
            <span className="hidden sm:inline">
              {agentDevice?.status === 'PRINTING'
                ? 'Agent Printing...'
                : (agentDevice && ['ONLINE', 'READY'].includes(agentDevice.status))
                ? \`Agent Ready (\${(agentDevice.selected_printer || 'Auto').split(' ')[0]})\`
                : 'Agent Offline'}
            </span>
            <span className="sm:hidden">
              {agentDevice?.status === 'PRINTING' ? 'Printing' : ((agentDevice && ['ONLINE', 'READY'].includes(agentDevice.status)) ? 'Ready' : 'Offline')}
            </span>
          </Link>

          {/* + Walk-in Print Button */}
          <button
            onClick={() => setShowNewJobModal(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm shadow-primary/20 shrink-0"
          >
            <span className="material-symbols-outlined text-[17px]">add_circle</span>
            <span>+ Walk-in Print</span>
          </button>

          `;

if (content.includes(headerControlsTarget) && !content.includes('Agent Status Pill')) {
  content = content.replace(headerControlsTarget, headerControlsAddition + headerControlsTarget);
  console.log('Added Agent Status Pill and Walk-in Print button to header.');
}

// 6. Render NewPrintJobModal at bottom
const modalTarget = '{reviewOrder && (';
const modalAddition = `{showNewJobModal && (
        <NewPrintJobModal
          onClose={() => setShowNewJobModal(false)}
          onJobCreated={() => fetchOrders(true)}
        />
      )}\n\n      `;

if (content.includes(modalTarget) && !content.includes('showNewJobModal && (')) {
  content = content.replace(modalTarget, modalAddition + modalTarget);
  console.log('Rendered NewPrintJobModal at bottom of LiveQueue.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated LiveQueue.jsx');
