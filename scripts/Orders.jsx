import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../core/api';
import OrderDetailModal from '../../components/OrderDetailModal';
import PrintReviewModal from '../../components/PrintReviewModal';
import NewPrintJobModal from '../../components/NewPrintJobModal';

const Orders = () => {
  const { searchQuery } = useOutletContext() || { searchQuery: '' };
  const [activeTab, setActiveTab] = useState('store'); // 'store' | 'print'

  // Print orders state
  const [printOrders, setPrintOrders] = useState([]);
  const [printPagination, setPrintPagination] = useState({ page: 1, limit: 50, total_pages: 1 });
  const [isPrintLoading, setIsPrintLoading] = useState(true);

  // Store orders state
  const [storeOrders, setStoreOrders] = useState([]);
  const [isStoreLoading, setIsStoreLoading] = useState(true);
  
  // Verification modal state
  const [verifyingOrder, setVerifyingOrder] = useState(null);
  const [enteredPickupCode, setEnteredPickupCode] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Print modals state
  const [selectedPrintOrder, setSelectedPrintOrder] = useState(null);
  const [reviewOrder, setReviewOrder] = useState(null);
  const [showNewJobModal, setShowNewJobModal] = useState(false);

  useEffect(() => {
    if (activeTab === 'print') {
      fetchPrintOrders(1);
    } else {
      fetchStoreOrders();
    }
  }, [activeTab]);

  const fetchPrintOrders = async (page = 1) => {
    setIsPrintLoading(true);
    try {
      const res = await api.get(`/shop/orders?page=${page}&limit=50`);
      setPrintOrders(res.data.data || res.data);
      if (res.data.pagination) setPrintPagination(res.data.pagination);
    } catch (err) {
      console.error('Failed to load print orders:', err);
    } finally {
      setIsPrintLoading(false);
    }
  };

  const fetchStoreOrders = async () => {
    setIsStoreLoading(true);
    try {
      const res = await api.get('/shop/inventory/orders');
      setStoreOrders(res.data.orders || []);
    } catch (err) {
      console.error('Failed to load store orders:', err);
    } finally {
      setIsStoreLoading(false);
    }
  };

  const handlePrint = async (orderId, fileIndex = null, forceMultiGrid = false) => {
    try {
      const order = printOrders.find(o => o.order_id === orderId || o.id === orderId);
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

      await api.post(`/shop/orders/${orderId}/dispatch-to-agent`, { 
        file_index: effectiveFileIndex,
        multi_file_grid: isMultiGrid
      });

      const toast = document.createElement('div');
      toast.textContent = isMultiGrid 
        ? '🖨️ Combined grid print job sent to Print Agent' 
        : (hasMultipleFiles ? '🖨️ Multi-document print jobs sent to Print Agent' : '🖨️ Print job sent to Print Agent');
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#059669;color:#fff;padding:12px 24px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);

    } catch (err) {
      alert('Failed to dispatch print: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStatusUpdate = async (orderId, newStatus) => {
    try {
      await api.patch(`/shop/orders/${orderId}/status`, { status: newStatus });
      fetchPrintOrders(printPagination.page);
    } catch (err) {
      alert('Failed to update status: ' + err.message);
    }
  };

  const handleApproveAndPrint = async (orderId, verifiedPrintOptions) => {
    try {
      await api.patch(`/shop/orders/${orderId}/status`, { 
        status: 'processing',
        print_options: verifiedPrintOptions
      });
      fetchPrintOrders(printPagination.page);
    } catch (err) {
      alert('Failed to approve and print: ' + err.message);
      throw err;
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!verifyingOrder || !enteredPickupCode.trim()) return;

    setIsVerifying(true);
    setVerificationError('');

    try {
      await api.patch(`/shop/inventory/orders/${verifyingOrder.order_id}/collect`, {
        pickup_code: enteredPickupCode.trim()
      });

      setStoreOrders(prev => prev.map(o => 
        o.order_id === verifyingOrder.order_id ? { ...o, status: 'collected', collected_at: new Date().toISOString() } : o
      ));
      setVerifyingOrder(null);
      setEnteredPickupCode('');
      alert('Order successfully verified and handed over!');
    } catch (err) {
      setVerificationError(err.response?.data?.error || 'Invalid pickup code. Please check with customer.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Filter Print Orders
  const filteredPrintOrders = printOrders.filter(o => {
    if (!searchQuery || !searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (o.order_id || '').toLowerCase().includes(q) ||
      (o.customer_phone || '').toLowerCase().includes(q) ||
      (o.status || '').toLowerCase().includes(q)
    );
  });

  // Filter Store Orders
  const filteredStoreOrders = storeOrders.filter(o => {
    if (!searchQuery || !searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (o.order_id || '').toLowerCase().includes(q) ||
      (o.customer_name || '').toLowerCase().includes(q) ||
      (o.customer_phone || '').toLowerCase().includes(q) ||
      (o.pickup_code || '').toLowerCase().includes(q) ||
      (o.status || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Top Header & Tab Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-on-surface mb-1">Orders & Pickups</h1>
          <p className="text-xs text-on-surface-variant">Manage in-store customer pickups and document print orders</p>
        </div>

        {/* Tab switch & Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowNewJobModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[17px]">add_circle</span>
            <span>+ Walk-in Print</span>
          </button>

          <div className="flex items-center gap-2 bg-surface-container border border-outline-variant/30 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('store')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'store'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">shopping_bag</span>
              Store Pickups ({storeOrders.filter(o => o.status === 'placed').length} Pending)
            </button>
            <button
              onClick={() => setActiveTab('print')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'print'
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print Orders
            </button>
          </div>
        </div>
      </div>

      {/* Store Pickups Tab */}
      {activeTab === 'store' && (
        <div className="w-full flex flex-col">
          {isStoreLoading ? (
            <div className="py-20 flex items-center justify-center text-on-surface-variant">
              <span className="material-symbols-outlined text-primary text-2xl animate-spin mr-2">autorenew</span>
              <span>Loading store pickup orders...</span>
            </div>
          ) : filteredStoreOrders.length === 0 ? (
            <div className="flex items-center justify-center bg-surface-container border border-outline-variant rounded-2xl text-on-surface-variant p-12 text-center">
              <div>
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">shopping_basket</span>
                <p className="font-semibold text-sm">No store orders found.</p>
                <p className="text-xs opacity-70 mt-1">When students purchase books or manuals from your shop, they appear here.</p>
              </div>
            </div>
          ) : (
            <div className="bg-surface-container border border-outline-variant rounded-2xl overflow-x-auto shadow-sm">
              <table className="w-full text-left border-collapse font-body-sm text-sm min-w-[780px]">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant text-[0.75rem] uppercase tracking-wider text-on-surface-variant font-bold">
                    <th className="p-4">Order Details</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Items Ordered</th>
                    <th className="p-4">Total Amount</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {filteredStoreOrders.map(order => {
                    const isCollected = order.status === 'collected';
                    const isCancelled = order.status === 'cancelled';
                    const isPending = order.status === 'placed';

                    return (
                      <tr key={order.order_id} className="hover:bg-surface-bright/50 transition-colors">
                        <td className="p-4">
                          <span className="font-mono font-bold text-primary block">
                            #{order.order_id.split('-')[0].toUpperCase()}
                          </span>
                          <span className="text-[11px] text-on-surface-variant">
                            {new Date(order.created_at).toLocaleString()}
                          </span>
                        </td>

                        <td className="p-4">
                          <p className="font-bold text-on-surface text-xs">{order.customer_name || 'Student'}</p>
                          <p className="text-[11px] text-on-surface-variant font-mono">{order.customer_phone || '—'}</p>
                        </td>

                        <td className="p-4">
                          <div className="space-y-1">
                            {order.items?.map((it, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                <span className="font-bold text-primary">{it.quantity}x</span>
                                <span className="text-on-surface font-medium truncate max-w-[200px]">{it.title}</span>
                                <span className="text-[10px] text-on-surface-variant">(₹{it.unit_price} each)</span>
                              </div>
                            ))}
                          </div>
                        </td>

                        <td className="p-4 font-black text-base text-on-surface">
                          ₹{order.total_amount}
                          <span className="block text-[10px] font-normal text-emerald-500 uppercase">Prepaid ({order.payment_method})</span>
                        </td>

                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                            isCollected
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : isCancelled
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          }`}>
                            {isCollected ? 'Collected' : isCancelled ? 'Cancelled' : 'Ready for Pickup'}
                          </span>
                        </td>

                        <td className="p-4 text-right">
                          {isPending && (
                            <button
                              onClick={() => {
                                setVerifyingOrder(order);
                                setEnteredPickupCode('');
                                setVerificationError('');
                              }}
                              className="bg-primary hover:bg-primary/90 text-on-primary px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-sm inline-flex items-center gap-1 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[16px]">pin</span>
                              Verify Code
                            </button>
                          )}
                          {isCollected && (
                            <span className="text-[11px] text-emerald-500 font-semibold flex items-center justify-end gap-1">
                              <span className="material-symbols-outlined text-[16px]">check_circle</span>
                              Handed Over
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Print Orders Tab */}
      {activeTab === 'print' && (
        <div className="w-full flex flex-col">
          {isPrintLoading ? (
            <div className="py-20 flex items-center justify-center text-on-surface-variant">
              <span className="material-symbols-outlined text-primary text-2xl animate-spin mr-2">autorenew</span>
              <span>Loading print orders...</span>
            </div>
          ) : filteredPrintOrders.length === 0 ? (
            <div className="p-12 flex items-center justify-center bg-surface-container border border-outline-variant rounded-xl text-on-surface-variant">
              No print orders match your search.
            </div>
          ) : (
            <div className="bg-surface-container border border-outline-variant rounded-xl overflow-x-auto shadow-sm">
              <table className="w-full text-left border-collapse font-body-sm text-sm min-w-[780px]">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant text-[0.75rem] uppercase tracking-wider text-on-surface-variant font-bold">
                    <th className="p-4">Order ID</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Placed At</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Payment</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPrintOrders.map(o => {
                    let opts = {};
                    try { opts = typeof o.print_options === 'string' ? JSON.parse(o.print_options) : (o.print_options || {}); } catch(e) {}
                    const isScheduled = opts.pickup_type === 'scheduled' || o.order_id?.startsWith('S');

                    return (
                      <tr 
                        key={o.order_id} 
                        onClick={() => setSelectedPrintOrder(o)}
                        className="border-b border-outline-variant/30 hover:bg-surface-bright/50 transition-colors cursor-pointer"
                      >
                        <td className="p-4 font-mono font-semibold text-primary">#{o.order_id.split('-')[0]}</td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <span className={`px-2 py-1 rounded text-[0.7rem] font-bold ${
                              isScheduled ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}>
                              {isScheduled ? '📅 Scheduled' : '⚡ Express'}
                            </span>

                            {(o.files_deleted || o.deletion_status === 'deleted') && (
                              <span className="px-1.5 py-0.5 rounded text-[0.65rem] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                                Erased
                              </span>
                            )}

                            {opts.multi_file_grid && (
                              <span className="px-1.5 py-0.5 rounded text-[0.65rem] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                Grid Layout
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-on-surface-variant text-xs">{new Date(o.created_at).toLocaleString()}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-[0.7rem] font-bold uppercase ${
                            o.status === 'ready' ? 'bg-green-500/15 text-green-400' :
                            o.status === 'processing' ? 'bg-yellow-500/15 text-yellow-400' :
                            o.status === 'queued' ? 'bg-blue-500/15 text-blue-400' :
                            'bg-surface-container-highest text-on-surface-variant'
                          }`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-on-surface">₹{o.amount_total}</td>
                        <td className="p-4">
                          <span className={`text-[11px] font-bold ${o.payment_status === 'captured' ? 'text-green-400' : 'text-amber-400'}`}>
                            {o.payment_status === 'captured' ? 'Paid' : 'Pending'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelectedPrintOrder(o); }}
                              className="px-2.5 py-1 bg-surface-container hover:bg-surface-variant text-on-surface border border-outline-variant font-bold rounded-lg text-xs transition-colors flex items-center gap-1 cursor-pointer"
                              title="View document specs and files"
                            >
                              <span className="material-symbols-outlined text-[14px]">visibility</span>
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handlePrint(o.order_id); }}
                              disabled={Boolean(o.files_deleted)}
                              className="px-2.5 py-1 bg-primary text-on-primary hover:bg-primary/90 font-bold rounded-lg text-xs transition-colors flex items-center gap-1 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title={o.files_deleted ? "Document permanently erased" : "Reprint to connected Print Agent"}
                            >
                              <span className="material-symbols-outlined text-[14px]">print</span>
                              <span>Reprint</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4-Digit Pickup Verification Modal */}
      {verifyingOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-outline-variant/40 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2">
                <span className="material-symbols-outlined text-2xl">pin</span>
              </div>
              <h3 className="font-bold text-lg text-on-surface">Verify In-Store Pickup</h3>
              <p className="text-xs text-on-surface-variant">
                Ask student for the 4-digit code shown in their PrintIt app.
              </p>
            </div>

            <div className="bg-surface-container p-3 rounded-xl mb-4 text-xs">
              <p className="text-on-surface-variant">Order: <strong className="text-on-surface">#{verifyingOrder.order_id.split('-')[0].toUpperCase()}</strong></p>
              <p className="text-on-surface-variant">Student: <strong className="text-on-surface">{verifyingOrder.customer_name || 'Customer'}</strong></p>
              <p className="text-on-surface-variant">Total: <strong className="text-primary font-bold">₹{verifyingOrder.total_amount}</strong></p>
            </div>

            {verificationError && (
              <div className="bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs p-3 rounded-xl mb-4 text-center font-medium">
                {verificationError}
              </div>
            )}

            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <label className="block text-center text-xs font-bold text-on-surface-variant mb-2">
                  ENTER 4-DIGIT CODE
                </label>
                <input
                  type="text"
                  maxLength={4}
                  required
                  autoFocus
                  placeholder="••••"
                  value={enteredPickupCode}
                  onChange={(e) => setEnteredPickupCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center tracking-[0.5em] font-mono text-2xl font-black bg-surface-container py-3 rounded-xl border border-outline-variant/40 focus:border-primary outline-none text-primary"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyingOrder(null)}
                  className="flex-1 py-2.5 rounded-xl bg-surface-container hover:bg-outline-variant/20 text-xs font-bold text-on-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isVerifying || enteredPickupCode.length !== 4}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-bold shadow disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying...' : 'Handover Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedPrintOrder && (
        <OrderDetailModal
          order={selectedPrintOrder}
          onClose={() => setSelectedPrintOrder(null)}
          onStatusUpdate={handleStatusUpdate}
          onPrint={handlePrint}
          onReviewAndAccept={(o) => {
            setSelectedPrintOrder(null);
            setReviewOrder(o);
          }}
        />
      )}

      {/* Print Review & Approval Modal */}
      {reviewOrder && (
        <PrintReviewModal
          order={reviewOrder}
          onClose={() => setReviewOrder(null)}
          onApprove={handleApproveAndPrint}
        />
      )}

      {/* Walk-in Print Creation Modal */}
      {showNewJobModal && (
        <NewPrintJobModal
          onClose={() => setShowNewJobModal(false)}
          onJobCreated={() => fetchPrintOrders(printPagination.page)}
        />
      )}
    </div>
  );
};

export default Orders;
