const fs = require('fs');
const filePath = 'C:/Users/avani/Downloads/print it/print it/shop_portal/src/components/PrintReviewModal.jsx';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  "const isAgentOnline = agentDevice && agentDevice.status === 'ONLINE';",
  "const isAgentOnline = agentDevice && ['ONLINE', 'READY', 'PRINTING'].includes(agentDevice.status);\n  const isAgentPrinting = agentDevice && agentDevice.status === 'PRINTING';"
);

content = content.replace(
  "{isAgentOnline ? 'ONLINE' : 'OFFLINE'}",
  "{isAgentPrinting ? 'PRINTING' : (isAgentOnline ? 'ONLINE & READY' : 'OFFLINE')}"
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated PrintReviewModal.jsx');
