import { useState, useEffect, useCallback } from 'react';


const api = async (path, method = 'GET', body) => {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.token || '') },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
};


function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'ok' : 'err');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}


function useDebounce(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}


const rules = {
  name: (v = '') => (v.length >= 20 && v.length <= 60) || 'Name must be 20-60 characters',
  email: (v = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email',
  password: (v = '') => /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,16}$/.test(v) || '8-16 chars, 1 uppercase, 1 special character',
  address: (v = '') => v.length <= 400 || 'Max 400 characters',
};


function Stars({ value = 0, onPick }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={'star' + (n <= (hover || value) ? ' on' : '')}
          onMouseEnter={() => setHover(n)} onClick={() => onPick(n)} title={`${n} star${n > 1 ? 's' : ''}`}>★</button>
      ))}
    </span>
  );
}

function DataTable({ url, columns, filters = [], extra }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({});
  const df = useDebounce(f);
  const [sort, setSort] = useState({ by: columns[0].key, order: 'asc' });

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ ...df, sort: sort.by, order: sort.order }).toString();
    api(`${url}?${qs}`).then(setRows).catch((e) => toast(e.message, false)).finally(() => setLoading(false));
  }, [url, df, sort]);
  useEffect(load, [load]);

  const toggle = (key) => setSort({ by: key, order: sort.by === key && sort.order === 'asc' ? 'desc' : 'asc' });

  return (
    <div>
      <div className="filters">
        {filters.map((k) => (
          <input key={k} placeholder={`Search by ${k}...`} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} onClick={() => toggle(c.key)}>
                  {c.label} {sort.by === c.key ? (sort.order === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              {extra && <th style={{ cursor: 'default' }}>Your rating</th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className="empty" colSpan={columns.length + 1}>Loading...</td></tr>}
            {!loading && !rows.length && <tr><td className="empty" colSpan={columns.length + 1}>No results found</td></tr>}
            {!loading && rows.map((r, i) => (
              <tr key={r.id || i}>
                {columns.map((c) => (
                  <td key={c.key}>{c.key.includes('rating') && r[c.key] ? <span className="avg">★ {r[c.key]}</span> : r[c.key] ?? '-'}</td>
                ))}
                {extra && <td>{extra(r, load)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Form({ fields, submitLabel, onSubmit, validate = false }) {
  const [v, setV] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (name, val) => {
    setV({ ...v, [name]: val });
    if (validate && rules[name]) {
      const r = rules[name](val);
      setErrors({ ...errors, [name]: r === true ? '' : r });
    }
  };
  const go = async (e) => {
    e.preventDefault();
    if (validate) {
      const errs = {};
      fields.forEach((f) => { const r = rules[f.name]?.(v[f.name]); if (r && r !== true) errs[f.name] = r; });
      setErrors(errs);
      if (Object.keys(errs).length) return;
    }
    setBusy(true);
    try {
      const msg = await onSubmit(v);
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message, false);
    }
    setBusy(false);
  };
  return (
    <form onSubmit={go} noValidate>
      {fields.map((f) => (
        <div key={f.name} className={'field' + (errors[f.name] ? ' invalid' : '')}>
          {f.type === 'select' ? (
            <select onChange={(e) => set(f.name, e.target.value)}>
              {f.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input type={f.type || 'text'} placeholder={f.label} onChange={(e) => set(f.name, e.target.value)} />
          )}
          {errors[f.name] && <div className="error">{errors[f.name]}</div>}
        </div>
      ))}
      <button disabled={busy}>{busy ? 'Please wait...' : submitLabel}</button>
    </form>
  );
}

const PasswordForm = () => (
  <details className="card">
    <summary>Change password</summary>
    <Form validate submitLabel="Update password" fields={[{ name: 'password', label: 'New password', type: 'password' }]}
      onSubmit={async (v) => (await api('/password', 'PUT', v)).message} />
  </details>
);


function Admin() {
  const [stats, setStats] = useState({});
  const [tick, setTick] = useState(0); // refresh lists after adding
  useEffect(() => { api('/admin/stats').then(setStats); }, [tick]);
  return (
    <div>
      <div className="stats">
        <div className="stat"><b>{stats.users ?? '-'}</b><span>Total users</span></div>
        <div className="stat"><b>{stats.stores ?? '-'}</b><span>Total stores</span></div>
        <div className="stat"><b>{stats.ratings ?? '-'}</b><span>Total ratings</span></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <h4>Add user</h4>
          <Form validate submitLabel="Add user" onSubmit={async (v) => { await api('/admin/users', 'POST', v); setTick(tick + 1); return 'User added'; }}
            fields={[{ name: 'name', label: 'Name (20-60 chars)' }, { name: 'email', label: 'Email' },
              { name: 'password', label: 'Password', type: 'password' }, { name: 'address', label: 'Address' },
              { name: 'role', type: 'select', options: ['USER', 'OWNER', 'ADMIN'] }]} />
        </div>
        <div className="card">
          <h4>Add store</h4>
          <Form validate submitLabel="Add store" onSubmit={async (v) => { await api('/admin/stores', 'POST', v); setTick(tick + 1); return 'Store added'; }}
            fields={[{ name: 'name', label: 'Store name (20-60 chars)' }, { name: 'email', label: 'Email' },
              { name: 'address', label: 'Address' }, { name: 'ownerId', label: 'Owner user ID (optional)' }]} />
        </div>
      </div>
      <div className="card">
        <h4>Stores</h4>
        <DataTable key={'s' + tick} url="/admin/stores" filters={['name', 'email', 'address']}
          columns={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
            { key: 'address', label: 'Address' }, { key: 'rating', label: 'Rating' }]} />
      </div>
      <div className="card">
        <h4>Users</h4>
        <DataTable key={'u' + tick} url="/admin/users" filters={['name', 'email', 'address', 'role']}
          columns={[{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
            { key: 'address', label: 'Address' }, { key: 'role', label: 'Role' }, { key: 'rating', label: 'Rating (owners)' }]} />
      </div>
    </div>
  );
}

function UserStores() {
  return (
    <div className="card">
      <h4>All stores</h4>
      <DataTable url="/stores" filters={['name', 'address']}
        columns={[{ key: 'name', label: 'Store' }, { key: 'address', label: 'Address' },
          { key: 'rating', label: 'Overall' }, { key: 'my_rating', label: 'My rating' }]}
        extra={(s, reload) => (
          <Stars value={s.my_rating || 0} onPick={async (n) => {
            try { await api(`/stores/${s.id}/rating`, 'POST', { rating: n }); toast(s.my_rating ? 'Rating updated' : 'Rating submitted'); reload(); }
            catch (e) { toast(e.message, false); }
          }} />
        )} />
    </div>
  );
}

function Owner() {
  const [d, setD] = useState({ average: 0, raters: [] });
  useEffect(() => { api('/owner/dashboard').then(setD).catch((e) => toast(e.message, false)); }, []);
  return (
    <div>
      <div className="stats">
        <div className="stat"><b>★ {d.average}</b><span>Average rating</span></div>
        <div className="stat"><b>{d.raters.length}</b><span>Total ratings</span></div>
      </div>
      <div className="card">
        <h4>Users who rated your store</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Email</th><th>Store</th><th>Rating</th></tr></thead>
            <tbody>
              {!d.raters.length && <tr><td className="empty" colSpan="4">No ratings yet</td></tr>}
              {d.raters.map((r, i) => (
                <tr key={i}><td>{r.name}</td><td>{r.email}</td><td>{r.store}</td><td><span className="avg">★ {r.rating}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.user || 'null'));
  const [mode, setMode] = useState('login');
  const [theme, setTheme] = useState(localStorage.theme || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.theme = theme;
  }, [theme]);

  const themeBtn = (
    <button className="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); toast('Logged out'); };

  if (!user)
    return (
      <div className="auth">
        <div className="card">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          {mode === 'login' ? (
            <Form submitLabel="Login" fields={[{ name: 'email', label: 'Email' }, { name: 'password', label: 'Password', type: 'password' }]}
              onSubmit={async (v) => {
                const d = await api('/login', 'POST', v);
                localStorage.token = d.token; localStorage.user = JSON.stringify(d.user); setUser(d.user);
                toast('Welcome, ' + d.user.name);
              }} />
          ) : (
            <Form validate submitLabel="Register" fields={[{ name: 'name', label: 'Full name (20-60 chars)' }, { name: 'email', label: 'Email' },
              { name: 'address', label: 'Address' }, { name: 'password', label: 'Password', type: 'password' }]}
              onSubmit={async (v) => { await api('/signup', 'POST', v); setMode('login'); return 'Registered! Please login.'; }} />
          )}
          <p><a onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? "Don't have an account? Sign up" : 'Back to login'}
          </a></p>
        </div>
        <div style={{ textAlign: 'center' }}>{themeBtn}</div>
      </div>
    );

  return (
    <div className="container">
      <div className="topbar">
        <h2><span className={"badge " + user.role}>{user.role}</span>{user.name}</h2>
        <div className="actions">{themeBtn}<button onClick={logout}>Logout</button></div>
      </div>
      <PasswordForm />
      {user.role === 'ADMIN' && <Admin />}
      {user.role === 'USER' && <UserStores />}
      {user.role === 'OWNER' && <Owner />}
    </div>
  );
}
