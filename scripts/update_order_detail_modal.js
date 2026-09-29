const fs = require('fs');
const filePath = 'C:/Users/avani/Downloads/print it/print it/shop_portal/src/components/OrderDetailModal.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update onPrint call to pass idx
content = content.replace(
  "onClick={() => onPrint(order.order_id)}",
  "onClick={() => onPrint(order.order_id, idx)}"
);

// 2. Add batch print buttons in Attached Files header if multiple files
const oldHeader = `<h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-on-surface">
                    <span className="material-symbols-outlined text-[16px] text-primary">description</span>
                    Attached Files ({files.length})
                  </span>
                  {opts.multi_file_grid && (
                    <span className="text-[10px] bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 px-2 py-0.5 rounded font-bold border border-cyan-500/30">
                      Collated onto 1 Sheet
                    </span>
                  )}
                </h4>`;

const newHeader = `<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">description</span>
                    Attached Files ({files.length})
                    {opts.multi_file_grid && (
                      <span className="text-[10px] bg-cyan-500/15 text-cyan-400 px-2 py-0.5 rounded font-bold border border-cyan-500/30 ml-1">
                        Collated onto 1 Sheet
                      </span>
                    )}
                  </h4>

                  {files.length > 1 && !order.files_deleted && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onPrint(order.order_id, 'all')}
                        className="px-2 py-0.5 bg-surface-container hover:bg-surface-variant text-on-surface border border-outline-variant font-bold rounded text-[10px] transition-colors flex items-center gap-1 cursor-pointer"
                        title="Print all document files separately"
                      >
                        <span className="material-symbols-outlined text-[12px]">print</span>
                        Print All ({files.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => onPrint(order.order_id, 0, true)}
                        className="px-2 py-0.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border border-cyan-500/30 font-bold rounded text-[10px] transition-colors flex items-center gap-1 cursor-pointer"
                        title="Collate all document files into N-Up grid on 1 sheet"
                      >
                        <span className="material-symbols-outlined text-[12px]">grid_view</span>
                        Collate Grid
                      </button>
                    </div>
                  )}
                </div>`;

if (content.includes(oldHeader)) {
  content = content.replace(oldHeader, newHeader);
  console.log('Added batch print buttons to OrderDetailModal.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated OrderDetailModal.jsx');
