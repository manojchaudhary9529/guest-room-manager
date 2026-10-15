import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
async function api(path, { token, ...options } = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "Request failed.");
  return data;
}
function getToken() { return sessionStorage.getItem("grm_token") || ""; }

function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { const result = await api("/auth/login", { method:"POST", body:JSON.stringify({ username, password }) }); onLogin(result); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="login-wrap"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">GR</div><p className="eyebrow">GUEST SERVICES</p><h1>Guest Room Manager</h1>
    <p className="muted">Sign in to manage your 9 guest rooms.</p>
    <label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required /></label>
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required /></label>
    {error && <div className="alert error">{error}</div>}
    <button className="primary full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <p className="tiny muted">Admin access only. Configure credentials in the server .env file.</p>
  </form></div>;
}

function App() {
  const [token, setToken] = useState(getToken());
  const [username, setUsername] = useState("admin");
  const [page, setPage] = useState("dashboard");
  const [dashboardDate, setDashboardDate] = useState(todayISO());
  const [dashboard, setDashboard] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [checkedAvailability, setCheckedAvailability] = useState(false);
  const [form, setForm] = useState({ visitorName:"", department:"", contact:"", purpose:"", checkIn:todayISO(), checkOut:"", roomNo:"" });
  const [editingStatus, setEditingStatus] = useState("");
  const navigate = useNavigate();

  function onLogin(result) {
    sessionStorage.setItem("grm_token", result.token);
    setToken(result.token); setUsername(result.username || "admin"); setPage("dashboard");
  }
  function logout() {
    sessionStorage.removeItem("grm_token"); setToken(""); setDashboard(null); setBookings([]);
  }
  async function loadDashboard() {
    if (!token) return;
    try { setDashboard(await api(`/dashboard?date=${dashboardDate}`, { token })); setError(""); }
    catch (e) { setError(e.message); if (/sign in|session/i.test(e.message)) logout(); }
  }
  async function loadBookings() {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "All") params.set("status", statusFilter);
      setBookings(await api(`/bookings?${params}`, { token })); setError("");
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { loadDashboard(); }, [token, dashboardDate]);
  useEffect(() => { loadBookings(); }, [token, search, statusFilter]);
  function updateForm(key, value) {
    setForm(prev => ({ ...prev, [key]: value, ...(key === "checkIn" || key === "checkOut" ? { roomNo:"" } : {}) }));
    if (key === "checkIn" || key === "checkOut") { setCheckedAvailability(false); setAvailableRooms([]); }
  }
  async function checkAvailability(e) {
    e?.preventDefault(); setError(""); setNotice("");
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) {
      setError("Check-out must be after check-in."); return;
    }
    setBusy(true);
    try {
      const data = await api("/bookings/availability", { token, method:"POST", body:JSON.stringify({ checkIn:form.checkIn, checkOut:form.checkOut }) });
      setAvailableRooms(data.availableRooms); setCheckedAvailability(true); setForm(p=>({ ...p, roomNo:"" }));
      if (!data.availableRooms.length) setNotice("No rooms are available for the entire selected date range.");
      else setNotice(`${data.availableRooms.length} room(s) available. Select one to continue.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function createBooking(e) {
    e.preventDefault(); setError(""); setNotice("");
    if (!checkedAvailability) { setError("Check availability first."); return; }
    if (!form.roomNo) { setError("Select an available room."); return; }
    setBusy(true);
    try {
      const booking = await api("/bookings", { token, method:"POST", body:JSON.stringify({ ...form, roomNo:Number(form.roomNo) }) });
      setNotice(`Booking ${booking.bookingId} saved — Room ${booking.roomNo} assigned.`);
      setForm({ visitorName:"", department:"", contact:"", purpose:"", checkIn:todayISO(), checkOut:"", roomNo:"" });
      setCheckedAvailability(false); setAvailableRooms([]);
      setPage("bookings"); await loadBookings(); await loadDashboard();
    } catch (e) { setError(e.message); if (e.message.includes("no longer available")) { setCheckedAvailability(false); setAvailableRooms([]); } }
    finally { setBusy(false); }
  }
  async function changeStatus(id, status) {
    setError(""); setNotice("");
    try {
      await api(`/bookings/${id}/status`, { token, method:"PATCH", body:JSON.stringify({ status }) });
      setNotice(`Booking status changed to ${status}.`); await loadBookings(); await loadDashboard();
    } catch (e) { setError(e.message); }
  }
  async function cancelBooking(id) {
    if (!window.confirm("Cancel this booking? The room dates will become available.")) return;
    setError(""); setNotice("");
    try {
      const result = await api(`/bookings/${id}`, { token, method:"DELETE" });
      setNotice(result.message); await loadBookings(); await loadDashboard();
    } catch (e) { setError(e.message); }
  }
  const nights = form.checkIn && form.checkOut && form.checkOut > form.checkIn
    ? Math.round((new Date(`${form.checkOut}T00:00:00`) - new Date(`${form.checkIn}T00:00:00`)) / 86400000) : 0;

  if (!token) return <Login onLogin={onLogin} />;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="side-brand"><div className="brand-mark small">GR</div><div><strong>Guest Rooms</strong><span>MANAGEMENT</span></div></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${page==="dashboard"?"active":""}`} onClick={()=>setPage("dashboard")}><span>▦</span> Dashboard</button>
      <button className={`nav-item ${page==="new"?"active":""}`} onClick={()=>{setPage("new");setNotice("");setError("");}}><span>＋</span> New booking</button>
      <button className={`nav-item ${page==="bookings"?"active":""}`} onClick={()=>setPage("bookings")}><span>▤</span> Visitor history</button>
      <div className="sidebar-bottom"><div className="admin-chip"><div className="avatar">A</div><div><strong>{username}</strong><span>Administrator</span></div></div><button className="nav-item logout" onClick={logout}>↪ Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="crumb">Guest Services</span><span className="slash"> / </span><strong>{page==="dashboard"?"Dashboard":page==="new"?"New booking":"Visitor history"}</strong></div><div className="top-meta"><span className="online-dot"></span> Local workspace <span className="date-label">{new Date().toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"})}</span></div></header>
      <div className="content">
        {notice && <div className="alert success"><span>✓</span>{notice}<button onClick={()=>setNotice("")}>×</button></div>}
        {error && <div className="alert error"><span>!</span>{error}<button onClick={()=>setError("")}>×</button></div>}
        {page==="dashboard" && <Dashboard data={dashboard} date={dashboardDate} setDate={setDashboardDate} goNew={()=>setPage("new")} goHistory={()=>setPage("bookings")} />}
        {page==="new" && <section>
          <div className="page-heading"><div><p className="eyebrow">RESERVATIONS</p><h1>New visitor booking</h1><p className="muted">Enter visitor details, check the dates, then select an available room.</p></div><span className="pill neutral">9 rooms total</span></div>
          <form className="form-layout" onSubmit={createBooking}>
            <div className="panel">
              <div className="panel-heading"><div className="step">1</div><div><h2>Visitor information</h2><p>Basic details for the guest register</p></div></div>
              <div className="form-grid">
                <label className="span-2">Visitor full name <span className="required">*</span><input value={form.visitorName} onChange={e=>updateForm("visitorName",e.target.value)} required maxLength="120" placeholder="Enter visitor's full name" /></label>
                <label>Department / organisation<input value={form.department} onChange={e=>updateForm("department",e.target.value)} maxLength="120" placeholder="e.g. Accounts" /></label>
                <label>Contact number<input value={form.contact} onChange={e=>updateForm("contact",e.target.value)} maxLength="40" placeholder="Phone number" /></label>
                <label className="span-2">Purpose / remarks<textarea value={form.purpose} onChange={e=>updateForm("purpose",e.target.value)} maxLength="300" rows="3" placeholder="Optional notes" /></label>
              </div>
              <div className="panel-heading section-gap"><div className="step">2</div><div><h2>Stay details</h2><p>Check-out day is not counted as an occupied night</p></div></div>
              <div className="form-grid">
                <label>Check-in date <span className="required">*</span><input type="date" value={form.checkIn} onChange={e=>updateForm("checkIn",e.target.value)} required /></label>
                <label>Check-out date <span className="required">*</span><input type="date" value={form.checkOut} min={form.checkIn || todayISO()} onChange={e=>updateForm("checkOut",e.target.value)} required /></label>
                <div className="nights-box"><span>Length of stay</span><strong>{nights || "—"} <small>{nights===1?"night":"nights"}</small></strong></div>
              </div>
              <div className="availability-action"><button type="button" className="secondary" disabled={busy} onClick={checkAvailability}>⌕ &nbsp; Check room availability</button><span className="muted tiny">Required before choosing a room</span></div>
            </div>
            <div className="panel">
              <div className="panel-heading"><div className="step">3</div><div><h2>Select a room</h2><p>Only rooms free for the entire stay are shown</p></div></div>
              {!checkedAvailability ? <div className="empty-state compact"><div className="empty-icon">⌕</div><strong>Check dates first</strong><p>Choose check-in and check-out dates, then check availability.</p></div> :
                availableRooms.length===0 ? <div className="empty-state compact"><div className="empty-icon">!</div><strong>No rooms available</strong><p>Try different dates or check existing bookings.</p></div> :
                <div className="room-select-grid">{availableRooms.map(r=><button type="button" key={r.roomNo} className={`room-option ${String(r.roomNo)===form.roomNo?"selected":""}`} onClick={()=>setForm(p=>({...p,roomNo:String(r.roomNo)}))}><span className="room-symbol">▣</span><strong>Room {r.roomNo}</strong><span className="available-label">● Available</span>{String(r.roomNo)===form.roomNo&&<span className="selected-check">✓</span>}</button>)}</div>}
              <div className="form-footer"><button className="primary" disabled={busy || !checkedAvailability || !form.roomNo || !form.visitorName.trim()}>{busy?"Saving…":"Confirm booking →"}</button><button type="button" className="text-button" onClick={()=>{setPage("dashboard");setError("");setNotice("");}}>Cancel</button></div>
              <p className="tiny muted footnote">The server rechecks room availability when saving to prevent a conflicting booking.</p>
            </div>
          </form>
        </section>}
        {page==="bookings" && <section>
          <div className="page-heading"><div><p className="eyebrow">RECORDS</p><h1>Visitor history</h1><p className="muted">Search past and upcoming stays, track check-in status, or cancel a booking.</p></div><button className="primary" onClick={()=>{setPage("new");setNotice("");setError("");}}>＋ New booking</button></div>
          <div className="panel table-panel"><div className="table-toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, phone, department or booking ID" /></div><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>All</option><option>Booked</option><option>Checked-in</option><option>Checked-out</option><option>Cancelled</option></select></div>
            <div className="table-wrap"><table><thead><tr><th>Booking / Visitor</th><th>Room</th><th>Stay dates</th><th>Nights</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {bookings.map(b=><tr key={b._id}><td><strong>{b.visitorName}</strong><div className="subline">{b.bookingId} · {b.department || "No department"}</div>{b.contact&&<div className="subline">{b.contact}</div>}</td><td><span className="room-tag">Room {b.roomNo}</span></td><td><div>{fmtDate(b.checkIn)} –</div><div>{fmtDate(b.checkOut)}</div></td><td>{nightsBetween(b.checkIn,b.checkOut)}</td><td><span className={`status-pill ${statusClass(b.status)}`}>{b.status}</span></td><td><div className="action-stack">
                <button className="mini-btn" onClick={()=>printReceipt(b)}>Print receipt</button>
                {b.status==="Booked"&&<button className="mini-btn" onClick={()=>changeStatus(b._id,"Checked-in")}>Check in</button>}
                {b.status==="Checked-in"&&<button className="mini-btn" onClick={()=>changeStatus(b._id,"Checked-out")}>Check out</button>}
                {!["Cancelled","Checked-out"].includes(b.status)&&<button className="mini-btn danger-text" onClick={()=>cancelBooking(b._id)}>Cancel</button>}
              </div></td></tr>)}
              {!bookings.length&&<tr><td colSpan="6"><div className="empty-state"><div className="empty-icon">▤</div><strong>No bookings found</strong><p>Try another search or create a new booking.</p></div></td></tr>}
            </tbody></table></div><div className="table-bottom"><span>{bookings.length} record(s) shown · maximum 1,000 per query</span><span>Cancelled bookings remain in visitor history.</span></div>
          </div>
        </section>}
      </div>
    </main>
  </div>;
}

function Dashboard({data,date,setDate,goNew,goHistory}) {
  return <section>
    <div className="page-heading"><div><p className="eyebrow">OVERVIEW</p><h1>Room dashboard</h1><p className="muted">A live view of all nine guest rooms and today's arrivals.</p></div><button className="primary" onClick={goNew}>＋ New booking</button></div>
    <div className="dashboard-date"><div><span className="calendar-icon">▦</span><div><strong>Room status by date</strong><span className="muted tiny">Choose any date to view occupancy</span></div></div><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
    <div className="stat-grid">
      <Stat label="Total rooms" value="9" detail="Fixed room inventory" icon="▦" />
      <Stat label="Occupied" value={data?.occupied ?? "—"} detail="On selected date" icon="▣" tone="occupied" />
      <Stat label="Available" value={data?.available ?? "—"} detail="On selected date" icon="✓" tone="available" />
      <Stat label="Today's arrivals" value={data?.checkIns?.length ?? "—"} detail="Scheduled check-ins" icon="↘" />
    </div>
    <div className="section-title"><div><h2>All guest rooms</h2><p className="muted">Status for {fmtDate(date)}</p></div><div className="legend"><span><i className="dot green"></i>Available</span><span><i className="dot red"></i>Occupied</span></div></div>
    <div className="room-grid">{(data?.rooms || Array.from({length:9},(_,i)=>({roomNo:i+1,status:"Loading",booking:null}))).map(r=><div key={r.roomNo} className={`room-card ${r.status==="Occupied"?"is-occupied":""}`}><div className="room-card-top"><span className="room-icon">▣</span><span className={`status-pill ${r.status==="Occupied"?"status-occupied":"status-available"}`}>{r.status}</span></div><h3>Room {r.roomNo}</h3>{r.booking?<><p className="guest-name">{r.booking.visitorName}</p><p className="room-dates">{fmtDate(r.booking.checkIn)} – {fmtDate(r.booking.checkOut)}</p><span className="booking-ref">{r.booking.bookingId}</span></>:<><p className="guest-name muted">No active visitor</p><p className="room-dates">Free for this date</p><button className="room-book-link" onClick={goNew}>Book this room →</button></>}</div>)}</div>
    <div className="two-col">
      <div className="panel"><div className="panel-heading simple"><div><h2>Check-ins</h2><p>Arrivals on {fmtDate(date)}</p></div><span className="count-badge">{data?.checkIns?.length||0}</span></div><EventList items={data?.checkIns||[]} empty="No arrivals for this date." type="in"/></div>
      <div className="panel"><div className="panel-heading simple"><div><h2>Check-outs</h2><p>Departures on {fmtDate(date)}</p></div><span className="count-badge">{data?.checkOuts?.length||0}</span></div><EventList items={data?.checkOuts||[]} empty="No departures for this date." type="out"/></div>
    </div>
    <div className="bottom-link"><span className="muted">Need to find an earlier visitor booking?</span><button className="text-button" onClick={goHistory}>Open visitor history →</button></div>
  </section>;
}
function Stat({label,value,detail,icon,tone=""}) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></div></div>; }
function EventList({items,empty,type}) { return !items.length?<div className="event-empty">{empty}</div>:<div className="event-list">{items.map(b=><div className="event-row" key={b._id}><div className={`event-avatar ${type}`}>{type==="in"?"↘":"↗"}</div><div className="event-info"><strong>{b.visitorName}</strong><span>Room {b.roomNo} · {b.bookingId}</span></div><span className="event-date">{type==="in"?fmtDate(b.checkIn):fmtDate(b.checkOut)}</span></div>)}</div>; }
function fmtDate(value) { if(!value) return "—"; const d = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00`) : new Date(value); return Number.isNaN(d.getTime())?"—":d.toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"}); }
function nightsBetween(a,b) { return Math.max(0,Math.round((new Date(b)-new Date(a))/86400000)); }
function statusClass(s) { return ({Booked:"status-booked","Checked-in":"status-checkedin","Checked-out":"status-checkedout",Cancelled:"status-cancelled"})[s]||"status-booked"; }
function printReceipt(b) {
  const w = window.open("", "_blank", "width=760,height=800");
  if(!w) { alert("Please allow pop-ups to print a receipt."); return; }
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  w.document.write(`<!doctype html><html><head><title>Receipt ${esc(b.bookingId)}</title><style>body{font:15px Arial,sans-serif;color:#1d2939;padding:42px;max-width:680px;margin:auto}h1{font-size:24px}small{color:#667085}.line{border-top:1px solid #ddd;margin:24px 0}.row{display:flex;padding:12px 0;border-bottom:1px solid #eee}.row strong{width:180px}.id{background:#f2f6fa;padding:12px;border-radius:8px}@media print{button{display:none}}</style></head><body><small>GUEST SERVICES · ROOM ALLOCATION</small><h1>Guest Room Booking Receipt</h1><div class="id"><strong>Booking ID: ${esc(b.bookingId)}</strong><br>Status: ${esc(b.status)}</div><div class="line"></div>${[["Visitor name",b.visitorName],["Department",b.department||"—"],["Contact",b.contact||"—"],["Room",`Room ${b.roomNo}`],["Check-in",fmtDate(b.checkIn)],["Check-out",fmtDate(b.checkOut)],["Number of nights",nightsBetween(b.checkIn,b.checkOut)],["Purpose / remarks",b.purpose||"—"]].map(([k,v])=>`<div class="row"><strong>${esc(k)}</strong><span>${esc(v)}</span></div>`).join("")}<p style="margin-top:40px;color:#667085">Please present this receipt to the guest services desk if requested.</p><button onclick="window.print()">Print receipt</button><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
}
export default App;
