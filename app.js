// ===== Lease Mileage Tracker - Application Logic =====

window.App = window.App || {};

// ===== Supabase Client =====
const SUPABASE_URL = 'https://rmontolgjfondmcjpxmk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb250b2xnamZvbmRtY2pweG1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMDQ0MDQsImV4cCI6MjA4ODU4MDQwNH0.P-kfJYf_lwuJ4yV3fYgFZ5SYnMG5xD_pbUtyaiHV7tw';

const VAPID_PUBLIC_KEY = 'BCvh7aAADngEXVC8NEEPnh2WH09Au3xqg1H-XersVbAL8qvBlEH_-Bqc3jnYGCCArV9eZzqipHXJo5ktjbw3iaE';

let _supabase = null;
try {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.warn('Supabase client init failed:', e);
}

// Utility: Convert VAPID public key from base64 URL to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ===== Storage Module =====
App.Storage = {
  KEY: 'leaseMileageTracker',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data.config || !Array.isArray(data.entries)) return null;
      return data;
    } catch {
      return null;
    }
  },

  save(data) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (e) {
      App.UI.showToast('Failed to save data. Storage may be full.');
    }
    // Non-blocking cloud sync
    this.saveToCloud(data);
  },

  async saveToCloud(data) {
    if (!_supabase) return;
    const userId = App.Auth.userId();
    if (!userId) return;
    try {
      await _supabase.from('user_data').upsert({
        user_id: userId,
        data: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('Cloud sync failed:', e);
    }
  },

  async loadFromCloud() {
    if (!_supabase) return false;
    const userId = App.Auth.userId();
    if (!userId) return false;
    try {
      const { data: row, error } = await _supabase
        .from('user_data')
        .select('data')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) { console.warn('Cloud load error:', error); return false; }
      if (row && row.data) {
        localStorage.setItem(this.KEY, JSON.stringify(row.data));
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Cloud load failed:', e);
      return false;
    }
  },

  clearLocal() {
    localStorage.removeItem(this.KEY);
  },

  exportJSON() {
    const data = this.load();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lease-mileage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    App.UI.showToast('Data exported successfully.');
  },

  importJSON(fileContent) {
    try {
      const data = JSON.parse(fileContent);
      if (!data.config || !Array.isArray(data.entries)) {
        App.UI.showToast('Invalid file format.');
        return false;
      }
      this.save(data);
      return true;
    } catch {
      App.UI.showToast('Failed to parse file.');
      return false;
    }
  },

  async reset() {
    localStorage.removeItem(this.KEY);
    // Also delete cloud data if signed in
    if (_supabase && App.Auth.userId()) {
      try {
        await _supabase.from('user_data').delete().eq('user_id', App.Auth.userId());
      } catch (e) {
        console.warn('Cloud delete failed:', e);
      }
    }
  }
};

// ===== Auth Module =====
App.Auth = {
  _session: null,
  _isOffline: false, // true if user chose "continue without account"

  async init() {
    if (!_supabase) return null;
    try {
      const { data: { session } } = await _supabase.auth.getSession();
      this._session = session;
      // Listen for auth state changes (e.g. token refresh)
      _supabase.auth.onAuthStateChange((_event, session) => {
        this._session = session;
      });
      return session;
    } catch (e) {
      console.warn('Auth init failed:', e);
      return null;
    }
  },

  async signIn(email, password) {
    if (!_supabase) throw new Error('Auth not available');
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._session = data.session;
    return data;
  },

  async signUp(email, password) {
    if (!_supabase) throw new Error('Auth not available');
    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) throw error;
    this._session = data.session;
    return data;
  },

  async signOut() {
    if (!_supabase) return;
    await _supabase.auth.signOut();
    this._session = null;
    this._isOffline = false;
  },

  userId() {
    return this._session?.user?.id || null;
  },

  userEmail() {
    return this._session?.user?.email || null;
  },

  isSignedIn() {
    return !!this._session;
  },

  skipAuth() {
    this._isOffline = true;
  },

  isOfflineMode() {
    return this._isOffline;
  }
};

// ===== Calculations Module =====
App.Calc = {
  MS_PER_DAY: 86400000,

  leaseEndDate(startDate, termMonths) {
    const d = new Date(startDate + 'T00:00:00');
    d.setMonth(d.getMonth() + termMonths);
    return d;
  },

  totalAllotment(yearlyMiles, termMonths) {
    return yearlyMiles * (termMonths / 12);
  },

  totalMilesDriven(entries, startOdo) {
    if (entries.length === 0) return 0;
    return entries[entries.length - 1].odometer - startOdo;
  },

  timeElapsedFraction(startDate, termMonths) {
    const start = new Date(startDate + 'T00:00:00').getTime();
    const end = this.leaseEndDate(startDate, termMonths).getTime();
    const now = Date.now();
    return Math.max(0, (now - start) / (end - start));
  },

  expectedMilesAtDate(yearlyMiles, startDate, targetDate) {
    const start = new Date(startDate + 'T00:00:00').getTime();
    const target = targetDate instanceof Date ? targetDate.getTime() : new Date(targetDate).getTime();
    const days = (target - start) / this.MS_PER_DAY;
    return yearlyMiles * (days / 365.25);
  },

  paceDelta(driven, expected) {
    return driven - expected;
  },

  statusColor(delta, totalAllotment) {
    if (delta <= 0) return 'green';
    if (delta / totalAllotment <= 0.05) return 'yellow';
    return 'red';
  },

  milesPerDay(entries, startOdo, startDate) {
    const driven = this.totalMilesDriven(entries, startOdo);
    const start = new Date(startDate + 'T00:00:00').getTime();
    const days = (Date.now() - start) / this.MS_PER_DAY;
    if (days <= 0) return 0;
    return driven / days;
  },

  projectedTotalAtLeaseEnd(milesPerDay, termMonths, startDate) {
    const start = new Date(startDate + 'T00:00:00').getTime();
    const end = this.leaseEndDate(startDate, termMonths).getTime();
    const totalDays = (end - start) / this.MS_PER_DAY;
    return milesPerDay * totalDays;
  },

  // Get the odometer reading at or just before a given date
  odometerAtDate(entries, startOdo, startDate, targetDate) {
    const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
    const leaseStart = new Date(startDate + 'T00:00:00');
    if (target <= leaseStart) return startOdo;

    // If targetDate falls before the first entry, linearly interpolate
    // to spread early mileage evenly from lease start to first entry
    if (entries.length > 0) {
      const firstEntryDate = new Date(entries[0].date + 'T00:00:00');
      if (target < firstEntryDate) {
        const totalSpan = firstEntryDate.getTime() - leaseStart.getTime();
        if (totalSpan > 0) {
          const elapsed = target.getTime() - leaseStart.getTime();
          const fraction = elapsed / totalSpan;
          return startOdo + fraction * (entries[0].odometer - startOdo);
        }
        return startOdo;
      }
    }

    let odo = startOdo;
    for (const e of entries) {
      const eDate = new Date(e.date + 'T00:00:00');
      if (eDate <= target) {
        odo = e.odometer;
      } else {
        break;
      }
    }
    return odo;
  },

  periodMiles(entries, startOdo, startDate, periodStart, periodEnd) {
    const odoStart = this.odometerAtDate(entries, startOdo, startDate, periodStart);
    const odoEnd = this.odometerAtDate(entries, startOdo, startDate, periodEnd);
    return Math.max(0, odoEnd - odoStart);
  },

  frequencyToDays(freq) {
    const map = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };
    return map[freq] || 7;
  },

  // Compare current period vs previous period
  periodComparison(entries, startOdo, startDate, frequency) {
    const periodDays = this.frequencyToDays(frequency);
    const now = new Date();
    const currentStart = new Date(now.getTime() - periodDays * this.MS_PER_DAY);
    const priorStart = new Date(currentStart.getTime() - periodDays * this.MS_PER_DAY);

    const currentMiles = this.periodMiles(entries, startOdo, startDate, currentStart, now);
    const priorMiles = this.periodMiles(entries, startOdo, startDate, priorStart, currentStart);
    const change = currentMiles - priorMiles;
    const changePercent = priorMiles > 0 ? (change / priorMiles) * 100 : null;

    return { currentMiles, priorMiles, change, changePercent, periodDays };
  },

  accelerationTrend(entries, startOdo, startDate) {
    const now = new Date();
    const d7  = new Date(now.getTime() -  7 * this.MS_PER_DAY);
    const d14 = new Date(now.getTime() - 14 * this.MS_PER_DAY);

    const recent = this.periodMiles(entries, startOdo, startDate, d7,  now) / 7;
    const prior  = this.periodMiles(entries, startOdo, startDate, d14, d7)  / 7;

    if (prior === 0) return 'steady';
    const ratio = recent / prior;
    if (ratio > 1.05) return 'accelerating';
    if (ratio < 0.95) return 'decelerating';
    return 'steady';
  },

  // Generate period buckets for bar chart
  generatePeriods(startDate, termMonths, entries) {
    const start = new Date(startDate + 'T00:00:00');
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    const useWeekly = monthsElapsed < 3;

    const periods = [];
    if (useWeekly) {
      let cursor = new Date(start);
      while (cursor < now) {
        const periodEnd = new Date(cursor.getTime() + 7 * this.MS_PER_DAY);
        const end = periodEnd > now ? now : periodEnd;
        periods.push({
          label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          start: new Date(cursor),
          end: end,
          miles: 0
        });
        cursor = periodEnd;
      }
    } else {
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor < now) {
        const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        const periodStart = cursor < start ? start : cursor;
        const periodEnd = nextMonth > now ? now : nextMonth;
        periods.push({
          label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          start: new Date(periodStart),
          end: periodEnd,
          miles: 0
        });
        cursor = nextMonth;
      }
    }

    return { periods, useWeekly };
  }
};

// ===== UI Module =====
App.UI = {
  data: null,
  _authMode: 'signin', // 'signin' or 'signup'

  async init() {
    this.bindEvents();

    // Check for existing auth session
    const session = await App.Auth.init();

    if (!session) {
      // No session — show auth screen
      this.showView('auth');
      document.getElementById('bottom-nav').classList.add('hidden');
      return;
    }

    // Session exists — load cloud data, then render app
    await this._enterApp();
  },

  async _enterApp() {
    // Try loading from cloud first, then fall back to localStorage
    if (App.Auth.isSignedIn()) {
      await App.Storage.loadFromCloud();
    }

    this.data = App.Storage.load();

    if (!this.data || !this.data.config) {
      this.showView('setup');
      document.getElementById('bottom-nav').classList.add('hidden');
    } else {
      const lastView = (this.data.uiState && this.data.uiState.activeView) || 'dashboard';
      this.showView(lastView);
      document.getElementById('bottom-nav').classList.remove('hidden');
    }
  },

  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = document.getElementById('view-' + name);
    if (view) view.classList.remove('hidden');

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[data-view="${name}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Render view content
    switch (name) {
      case 'auth': break; // no render needed
      case 'setup': this.renderSetup(); break;
      case 'dashboard': this.renderDashboard(); break;
      case 'log': this.renderLog(); break;
      case 'trends': this.renderTrends(); break;
      case 'settings': this.renderSettings(); break;
    }

    // Don't persist 'auth' or 'setup' as the active view
    if (this.data && this.data.uiState && name !== 'auth' && name !== 'setup') {
      this.data.uiState.activeView = name;
      App.Storage.save(this.data);
    }
  },

  bindEvents() {
    // Auth form
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAuthSubmit();
    });
    document.getElementById('auth-toggle-btn').addEventListener('click', () => {
      this._authMode = this._authMode === 'signin' ? 'signup' : 'signin';
      const btn = document.getElementById('auth-submit-btn');
      const toggleText = document.getElementById('auth-toggle-text');
      const toggleBtn = document.getElementById('auth-toggle-btn');
      if (this._authMode === 'signup') {
        btn.textContent = 'Sign Up';
        toggleText.textContent = 'Already have an account?';
        toggleBtn.textContent = 'Sign In';
      } else {
        btn.textContent = 'Sign In';
        toggleText.textContent = "Don't have an account?";
        toggleBtn.textContent = 'Sign Up';
      }
      document.getElementById('auth-error').classList.add('hidden');
    });
    document.getElementById('auth-skip-btn').addEventListener('click', () => {
      App.Auth.skipAuth();
      this.data = App.Storage.load();
      if (!this.data || !this.data.config) {
        this.showView('setup');
        document.getElementById('bottom-nav').classList.add('hidden');
      } else {
        const lastView = (this.data.uiState && this.data.uiState.activeView) || 'dashboard';
        this.showView(lastView);
        document.getElementById('bottom-nav').classList.remove('hidden');
      }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      if (!confirm('Sign out? Your data is saved in the cloud.')) return;
      await App.Auth.signOut();
      App.Storage.clearLocal();
      this.data = null;
      if (App.Charts && App.Charts.destroyAll) App.Charts.destroyAll();
      this.showView('auth');
      document.getElementById('bottom-nav').classList.add('hidden');
      this.showToast('Signed out.');
    });

    // Nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showView(btn.dataset.view));
    });

    // Setup form
    document.getElementById('setup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSetupSubmit();
    });

    // Add target buttons
    document.getElementById('add-target-btn').addEventListener('click', () => {
      this.addTargetRow('custom-targets-list');
    });

    // Log form
    document.getElementById('log-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogEntry();
    });

    // Reminder buttons
    document.getElementById('reminder-log-btn').addEventListener('click', () => {
      this.showView('log');
    });
    document.getElementById('reminder-dismiss-btn').addEventListener('click', () => {
      this.dismissReminder();
    });

    // Settings form
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSettingsSave();
    });
    document.getElementById('settings-add-target-btn').addEventListener('click', () => {
      this.addTargetRow('settings-targets-list');
    });
    document.getElementById('settings-notifications').addEventListener('change', (e) => {
      document.getElementById('reminder-time-group').style.display = e.target.checked ? '' : 'none';
    });

    // CSV import
    document.getElementById('csv-import-btn').addEventListener('click', () => {
      document.getElementById('csv-file').click();
    });
    document.getElementById('csv-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.handleCSVImport(reader.result);
      reader.readAsText(file);
      e.target.value = '';
    });
    document.getElementById('csv-confirm-btn').addEventListener('click', () => this.confirmCSVImport());
    document.getElementById('csv-cancel-btn').addEventListener('click', () => {
      this._csvPendingEntries = null;
      document.getElementById('csv-preview').classList.add('hidden');
    });

    // Data management
    document.getElementById('export-btn').addEventListener('click', () => App.Storage.exportJSON());
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (App.Storage.importJSON(reader.result)) {
          this.data = App.Storage.load();
          this.showView('dashboard');
          document.getElementById('bottom-nav').classList.remove('hidden');
          this.showToast('Data imported successfully.');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    document.getElementById('reset-btn').addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset all data? This cannot be undone.')) {
        await App.Storage.reset();
        this.data = null;
        if (App.Charts && App.Charts.destroyAll) App.Charts.destroyAll();
        this.showView('setup');
        document.getElementById('bottom-nav').classList.add('hidden');
        this.showToast('All data has been reset.');
      }
    });
  },

  // ===== Auth =====
  async handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit-btn');

    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = this._authMode === 'signin' ? 'Signing in…' : 'Signing up…';

    try {
      if (this._authMode === 'signup') {
        const result = await App.Auth.signUp(email, password);
        // Some Supabase projects require email confirmation
        if (result.user && !result.session) {
          errorEl.textContent = 'Check your email to confirm your account, then sign in.';
          errorEl.style.background = 'var(--color-blue-bg)';
          errorEl.style.color = 'var(--color-blue)';
          errorEl.classList.remove('hidden');
          this._authMode = 'signin';
          submitBtn.textContent = 'Sign In';
          document.getElementById('auth-toggle-text').textContent = "Don't have an account?";
          document.getElementById('auth-toggle-btn').textContent = 'Sign Up';
          return;
        }
      } else {
        await App.Auth.signIn(email, password);
      }

      // Signed in — check if existing local data should upload
      const localData = App.Storage.load();
      if (localData && localData.config) {
        // Push local data to cloud on first sign-in (merge scenario)
        await App.Storage.saveToCloud(localData);
      }

      await this._enterApp();
      this.showToast('Signed in as ' + App.Auth.userEmail());
    } catch (err) {
      errorEl.textContent = err.message || 'Authentication failed.';
      errorEl.style.background = '';
      errorEl.style.color = '';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this._authMode === 'signin' ? 'Sign In' : 'Sign Up';
    }
  },

  // ===== Setup =====
  renderSetup() {
    document.getElementById('custom-targets-list').innerHTML = '';
    const form = document.getElementById('setup-form');
    form.reset();
    // Set default date to today
    document.getElementById('setup-start-date').value = new Date().toISOString().slice(0, 10);
  },

  addTargetRow(containerId) {
    const container = document.getElementById(containerId);
    const count = container.querySelectorAll('.target-row').length;
    if (count >= 5) {
      this.showToast('Maximum 5 custom targets.');
      return;
    }
    const row = document.createElement('div');
    row.className = 'target-row';
    row.innerHTML = `
      <input type="text" placeholder="Target name" class="target-name" required>
      <input type="number" placeholder="Miles/year" class="target-miles" min="1" step="1" required>
      <button type="button" class="btn-icon danger" onclick="this.parentElement.remove()">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(row);
  },

  getTargetsFromContainer(containerId) {
    const rows = document.querySelectorAll(`#${containerId} .target-row`);
    const targets = [];
    for (const row of rows) {
      const name = row.querySelector('.target-name').value.trim();
      const miles = parseInt(row.querySelector('.target-miles').value);
      if (name && miles > 0) {
        targets.push({ name, yearlyMiles: miles });
      }
    }
    return targets;
  },

  handleSetupSubmit() {
    const startDate = document.getElementById('setup-start-date').value;
    const term = parseInt(document.getElementById('setup-term').value);
    const odometer = parseInt(document.getElementById('setup-odometer').value);
    const allotment = parseInt(document.getElementById('setup-allotment').value);
    const frequency = document.getElementById('setup-frequency').value;
    const targets = this.getTargetsFromContainer('custom-targets-list');

    if (!startDate || !term || isNaN(odometer) || !allotment) {
      this.showToast('Please fill in all required fields.');
      return;
    }

    this.data = {
      config: {
        leaseStartDate: startDate,
        leaseTerm: term,
        startingOdometer: odometer,
        yearlyAllotment: allotment,
        checkInFrequency: frequency,
        customTargets: targets,
        notificationsEnabled: false
      },
      entries: [],
      uiState: {
        lastDismissedReminder: null,
        lastNotifiedDate: null,
        activeView: 'dashboard'
      }
    };

    App.Storage.save(this.data);
    document.getElementById('bottom-nav').classList.remove('hidden');
    this.showView('dashboard');
    this.showToast('Setup complete! Start logging your mileage.');
  },

  // ===== Dashboard =====
  renderDashboard() {
    if (!this.data) return;
    const { config, entries } = this.data;
    const C = App.Calc;

    // Lease progress
    const frac = C.timeElapsedFraction(config.leaseStartDate, config.leaseTerm);
    const pct = Math.min(100, Math.round(frac * 100));
    document.getElementById('lease-progress-bar').style.width = pct + '%';
    const monthsElapsed = Math.round(frac * config.leaseTerm);
    document.getElementById('lease-progress-label').textContent =
      `${pct}% elapsed — ${monthsElapsed} of ${config.leaseTerm} months`;

    // Metrics
    const driven = C.totalMilesDriven(entries, config.startingOdometer);
    const allotment = C.totalAllotment(config.yearlyAllotment, config.leaseTerm);
    const remaining = Math.max(0, allotment - driven);
    const expected = C.expectedMilesAtDate(config.yearlyAllotment, config.leaseStartDate, new Date());
    const delta = C.paceDelta(driven, expected);
    const color = C.statusColor(delta, allotment);

    document.getElementById('metric-driven').textContent = driven.toLocaleString() + ' mi';
    document.getElementById('metric-remaining').textContent = remaining.toLocaleString() + ' mi';

    const sign = delta >= 0 ? '+' : '';
    document.getElementById('metric-pace').textContent = sign + Math.round(delta).toLocaleString() + ' mi';
    const statusEl = document.getElementById('metric-pace-status');
    statusEl.textContent = delta <= 0 ? 'UNDER BUDGET' : delta / allotment <= 0.05 ? 'NEAR BUDGET' : 'OVER BUDGET';
    statusEl.className = 'metric-status status-' + color;

    // Budget status rows
    const budgetList = document.getElementById('budget-status-list');
    budgetList.innerHTML = '';

    const allBudgets = [
      { name: `Lease (${(config.yearlyAllotment / 1000).toFixed(0)}k/yr)`, yearly: config.yearlyAllotment },
      ...config.customTargets.map(t => ({ name: t.name, yearly: t.yearlyMiles }))
    ];

    for (const budget of allBudgets) {
      const total = C.totalAllotment(budget.yearly, config.leaseTerm);
      const exp = C.expectedMilesAtDate(budget.yearly, config.leaseStartDate, new Date());
      const d = C.paceDelta(driven, exp);
      const c = C.statusColor(d, total);
      const pctUsed = Math.min(100, Math.round((driven / total) * 100));

      const row = document.createElement('div');
      row.className = 'budget-row';
      const dSign = d >= 0 ? '+' : '';
      const pctDelta = ((d / total) * 100).toFixed(0);
      row.innerHTML = `
        <span class="budget-name">${budget.name}</span>
        <div class="budget-bar-wrap">
          <div class="budget-bar-fill bg-${c}" style="width: ${pctUsed}%"></div>
        </div>
        <span class="budget-delta status-${c}">${dSign}${Math.round(d).toLocaleString()} mi / ${dSign}${pctDelta}% <span class="status-dot dot-${c}"></span></span>
      `;
      budgetList.appendChild(row);
    }

    // Reminder
    this.evaluateReminder();

    // Charts
    if (App.Charts && App.Charts.updateCumulativeChart) {
      App.Charts.updateCumulativeChart(config, entries);

      // Build gauge data for all budgets (lease + custom targets)
      const gaugeBudgets = allBudgets.map(budget => {
        const total = C.totalAllotment(budget.yearly, config.leaseTerm);
        const exp = C.expectedMilesAtDate(budget.yearly, config.leaseStartDate, new Date());
        const d = C.paceDelta(driven, exp);
        const c = C.statusColor(d, total);
        return { name: budget.name, driven, total, color: c };
      });

      // Destroy old gauges, rebuild container, create new gauges
      App.Charts.destroyAllGauges();
      const gaugesContainer = document.getElementById('gauges-container');
      gaugesContainer.innerHTML = '';

      // Dynamic column count: max 3 per row, balanced rows
      const gaugeCount = gaugeBudgets.length;
      const gaugeCols = gaugeCount <= 3 ? gaugeCount : (gaugeCount === 4 ? 2 : 3);
      gaugesContainer.style.gridTemplateColumns = `repeat(${gaugeCols}, 1fr)`;

      gaugeBudgets.forEach((gb, i) => {
        const card = document.createElement('div');
        card.className = 'gauge-card';
        card.innerHTML = `
          <h3>${gb.name}</h3>
          <div class="chart-container chart-container-gauge">
            <canvas id="chart-gauge-${i}"></canvas>
          </div>
        `;
        gaugesContainer.appendChild(card);
      });

      App.Charts.updateAllGauges(gaugeBudgets);
    }
  },

  evaluateReminder() {
    const { config, entries, uiState } = this.data;
    const banner = document.getElementById('reminder-banner');
    const text = document.getElementById('reminder-text');

    if (entries.length === 0) {
      banner.classList.remove('hidden');
      text.textContent = "You haven't logged any mileage yet. Time to check in!";
      return;
    }

    const lastDate = new Date(entries[entries.length - 1].date + 'T00:00:00');
    const daysSince = Math.floor((Date.now() - lastDate.getTime()) / App.Calc.MS_PER_DAY);
    const interval = App.Calc.frequencyToDays(config.checkInFrequency);

    if (daysSince < interval) {
      banner.classList.add('hidden');
      return;
    }

    // Check if dismissed recently
    if (uiState.lastDismissedReminder) {
      const dismissed = new Date(uiState.lastDismissedReminder);
      const hoursSince = (Date.now() - dismissed.getTime()) / 3600000;
      if (hoursSince < 24) {
        banner.classList.add('hidden');
        return;
      }
    }

    banner.classList.remove('hidden');
    text.textContent = `It's been ${daysSince} day${daysSince !== 1 ? 's' : ''} since your last entry — time to check in!`;

    // Also fire a browser notification if enabled
    this.sendReminderNotification(daysSince);
  },

  dismissReminder() {
    this.data.uiState.lastDismissedReminder = new Date().toISOString();
    App.Storage.save(this.data);
    document.getElementById('reminder-banner').classList.add('hidden');
  },

  async requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  async sendReminderNotification(daysSince) {
    if (!this.data.config.notificationsEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    // Anti-spam: only notify once per calendar day
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.uiState.lastNotifiedDate === today) return;

    // Fire via service worker for PWA support
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg) {
        reg.showNotification('Time to log mileage', {
          body: `It's been ${daysSince} day${daysSince !== 1 ? 's' : ''} since your last entry.`,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: 'mileage-reminder',
          renotify: true,
          data: { action: 'log' }
        });
      }
    } catch (e) {
      console.warn('Notification failed:', e);
    }

    // Record that we notified today
    this.data.uiState.lastNotifiedDate = today;
    App.Storage.save(this.data);
  },

  async subscribeToPush() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg || !reg.pushManager) return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      // Store subscription in Supabase
      if (_supabase && App.Auth.isSignedIn()) {
        await _supabase.from('push_subscriptions').upsert({
          user_id: App.Auth.userId(),
          subscription: sub.toJSON()
        }, { onConflict: 'user_id' });
      }
    } catch (e) {
      console.warn('Push subscription failed:', e);
    }
  },

  async unsubscribeFromPush() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }

      // Remove from Supabase
      if (_supabase && App.Auth.isSignedIn()) {
        await _supabase.from('push_subscriptions')
          .delete()
          .eq('user_id', App.Auth.userId());
      }
    } catch (e) {
      console.warn('Push unsubscribe failed:', e);
    }
  },

  // ===== Mileage Log =====
  renderLog() {
    if (!this.data) return;
    const { config, entries } = this.data;

    // Pre-fill date
    document.getElementById('log-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('log-odometer').value = '';

    const history = document.getElementById('log-history');
    const empty = document.getElementById('log-empty');

    if (entries.length === 0) {
      history.innerHTML = '';
      empty.classList.remove('hidden');
      // Show starting odometer marker
      history.innerHTML = `<div class="log-start-marker">Lease start — ${config.startingOdometer.toLocaleString()} mi</div>`;
      return;
    }

    empty.classList.add('hidden');
    let html = '';

    // Reverse chronological
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const prevOdo = i > 0 ? entries[i - 1].odometer : config.startingOdometer;
      const delta = e.odometer - prevOdo;
      const dateStr = new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });

      html += `
        <div class="log-entry" id="entry-${e.id}">
          <div class="log-entry-info">
            <div class="log-entry-date">${dateStr}</div>
            <div class="log-entry-odo">${e.odometer.toLocaleString()} mi</div>
            <div class="log-entry-delta positive">+${delta.toLocaleString()} mi</div>
          </div>
          <div class="log-entry-actions">
            <button class="btn-icon" onclick="App.UI.startEdit('${e.id}')" title="Edit">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon danger" onclick="App.UI.deleteEntry('${e.id}')" title="Delete">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }

    html += `<div class="log-start-marker">Lease start — ${config.startingOdometer.toLocaleString()} mi</div>`;
    history.innerHTML = html;
  },

  handleLogEntry() {
    const odo = parseInt(document.getElementById('log-odometer').value);
    const date = document.getElementById('log-date').value;
    const { config, entries } = this.data;

    if (isNaN(odo) || !date) {
      this.showToast('Please enter odometer and date.');
      return;
    }

    if (odo < config.startingOdometer) {
      this.showToast(`Odometer must be at least ${config.startingOdometer.toLocaleString()} (starting value).`);
      return;
    }

    // Validate against existing entries for the same or surrounding dates
    const leaseEnd = App.Calc.leaseEndDate(config.leaseStartDate, config.leaseTerm);
    const entryDate = new Date(date + 'T00:00:00');
    const leaseStart = new Date(config.leaseStartDate + 'T00:00:00');

    if (entryDate < leaseStart) {
      this.showToast('Date must be on or after lease start date.');
      return;
    }
    if (entryDate > leaseEnd) {
      this.showToast('Date must be within the lease period.');
      return;
    }

    // Check odometer is consistent with surrounding entries
    for (const e of entries) {
      if (e.date < date && odo < e.odometer) {
        this.showToast(`Odometer must be >= ${e.odometer.toLocaleString()} (reading from ${e.date}).`);
        return;
      }
      if (e.date > date && odo > e.odometer) {
        this.showToast(`Odometer must be <= ${e.odometer.toLocaleString()} (reading from ${e.date}).`);
        return;
      }
      if (e.date === date) {
        this.showToast('An entry already exists for this date. Edit it instead.');
        return;
      }
    }

    const entry = {
      id: 'e_' + Date.now(),
      date: date,
      odometer: odo,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    entries.push(entry);
    entries.sort((a, b) => a.date.localeCompare(b.date));
    App.Storage.save(this.data);
    this.renderLog();
    this.showToast('Entry saved.');
  },

  startEdit(id) {
    const entry = this.data.entries.find(e => e.id === id);
    if (!entry) return;

    const el = document.getElementById('entry-' + id);
    if (!el) return;
    el.classList.add('editing');

    const actionsEl = el.querySelector('.log-entry-actions');
    actionsEl.innerHTML = '';

    const form = document.createElement('div');
    form.className = 'log-edit-form';
    form.innerHTML = `
      <input type="number" value="${entry.odometer}" class="edit-odo" min="0" step="1">
      <input type="date" value="${entry.date}" class="edit-date">
      <button class="btn-primary btn-sm" onclick="App.UI.saveEdit('${id}')">Save</button>
      <button class="btn-ghost btn-sm" onclick="App.UI.renderLog()">Cancel</button>
    `;
    el.appendChild(form);
  },

  saveEdit(id) {
    const el = document.getElementById('entry-' + id);
    const odo = parseInt(el.querySelector('.edit-odo').value);
    const date = el.querySelector('.edit-date').value;
    const { config, entries } = this.data;

    if (isNaN(odo) || !date) {
      this.showToast('Please enter valid values.');
      return;
    }

    if (odo < config.startingOdometer) {
      this.showToast(`Odometer must be at least ${config.startingOdometer.toLocaleString()}.`);
      return;
    }

    // Check consistency with other entries (excluding this one)
    for (const e of entries) {
      if (e.id === id) continue;
      if (e.date < date && odo < e.odometer) {
        this.showToast(`Odometer must be >= ${e.odometer.toLocaleString()} (reading from ${e.date}).`);
        return;
      }
      if (e.date > date && odo > e.odometer) {
        this.showToast(`Odometer must be <= ${e.odometer.toLocaleString()} (reading from ${e.date}).`);
        return;
      }
      if (e.date === date) {
        this.showToast('Another entry already exists for this date.');
        return;
      }
    }

    const entry = entries.find(e => e.id === id);
    entry.odometer = odo;
    entry.date = date;
    entry.updatedAt = new Date().toISOString();
    entries.sort((a, b) => a.date.localeCompare(b.date));
    App.Storage.save(this.data);
    this.renderLog();
    this.showToast('Entry updated.');
  },

  deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    this.data.entries = this.data.entries.filter(e => e.id !== id);
    App.Storage.save(this.data);
    this.renderLog();
    this.showToast('Entry deleted.');
  },

  // ===== Trends =====
  renderTrends() {
    if (!this.data) return;
    const { config, entries } = this.data;
    const C = App.Calc;

    const trendsEmpty = document.getElementById('trends-empty');
    const trendsContent = document.getElementById('trends-content');

    if (entries.length < 2) {
      trendsEmpty.classList.remove('hidden');
      trendsContent.classList.add('hidden');
      return;
    }

    trendsEmpty.classList.add('hidden');
    trendsContent.classList.remove('hidden');

    // Period comparison — always show Week / Month / Quarter
    const periods = [
      { label: 'Week',    freq: 'weekly'    },
      { label: 'Month',   freq: 'monthly'   },
      { label: 'Quarter', freq: 'quarterly' },
    ];
    const tbody = document.getElementById('period-comparison-body');
    tbody.innerHTML = '';
    for (const { label, freq } of periods) {
      const comp = C.periodComparison(entries, config.startingOdometer, config.leaseStartDate, freq);
      const sign = comp.change >= 0 ? '+' : '';
      const pct = comp.changePercent !== null ? ` (${sign}${comp.changePercent.toFixed(1)}%)` : '';
      const arrow = comp.change > 0 ? ' \u25B2' : comp.change < 0 ? ' \u25BC' : '';
      const colorClass = comp.change > 0 ? 'status-red' : comp.change < 0 ? 'status-green' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="period-row-label">${label}</td>
        <td>${Math.round(comp.currentMiles).toLocaleString()} mi</td>
        <td>${Math.round(comp.priorMiles).toLocaleString()} mi</td>
        <td class="${colorClass}">${sign}${Math.round(comp.change).toLocaleString()} mi${pct}${arrow}</td>
      `;
      tbody.appendChild(tr);
    }

    // Averages
    const mpd = C.milesPerDay(entries, config.startingOdometer, config.leaseStartDate);
    document.getElementById('avg-daily').textContent = mpd.toFixed(1) + ' mi';
    document.getElementById('avg-weekly').textContent = (mpd * 7).toFixed(1) + ' mi';
    document.getElementById('avg-monthly').textContent = (mpd * 30.44).toFixed(1) + ' mi';

    // Projection
    const projected = C.projectedTotalAtLeaseEnd(mpd, config.leaseTerm, config.leaseStartDate);
    const allotment = C.totalAllotment(config.yearlyAllotment, config.leaseTerm);
    const diff = projected - allotment;

    document.getElementById('proj-total').textContent = Math.round(projected).toLocaleString() + ' mi';
    document.getElementById('proj-allotment').textContent = Math.round(allotment).toLocaleString() + ' mi';

    const diffEl = document.getElementById('proj-diff');
    const diffSign = diff >= 0 ? '+' : '';
    diffEl.textContent = diffSign + Math.round(diff).toLocaleString() + ' mi';
    const diffColor = diff <= 0 ? 'green' : diff / allotment <= 0.05 ? 'yellow' : 'red';
    diffEl.className = 'trend-value status-' + diffColor;

    // Acceleration
    const accel = C.accelerationTrend(entries, config.startingOdometer, config.leaseStartDate);
    const accelEl = document.getElementById('trend-acceleration');
    if (accel === 'accelerating') {
      accelEl.textContent = '\u25B2 Usage is accelerating (driving more this week)';
      accelEl.className = 'trend-acceleration trend-accel-up';
    } else if (accel === 'decelerating') {
      accelEl.textContent = '\u25BC Usage is decelerating (driving less this week)';
      accelEl.className = 'trend-acceleration trend-accel-down';
    } else {
      accelEl.textContent = '\u25CF Usage is steady';
      accelEl.className = 'trend-acceleration trend-accel-steady';
    }

    // Period chart
    if (App.Charts && App.Charts.updatePeriodChart) {
      App.Charts.updatePeriodChart(config, entries);
    }
  },

  // ===== Settings =====
  renderSettings() {
    if (!this.data) return;
    const { config } = this.data;

    document.getElementById('settings-start-date').value = config.leaseStartDate;
    document.getElementById('settings-term').value = config.leaseTerm;
    document.getElementById('settings-odometer').value = config.startingOdometer;
    document.getElementById('settings-allotment').value = config.yearlyAllotment;
    document.getElementById('settings-frequency').value = config.checkInFrequency;
    document.getElementById('settings-notifications').checked = config.notificationsEnabled || false;
    document.getElementById('settings-reminder-time').value = config.reminderTimeLocal || '09:00';
    document.getElementById('settings-reminder-day').value = String(config.reminderDayOfWeek ?? -1);
    document.getElementById('reminder-time-group').style.display = config.notificationsEnabled ? '' : 'none';

    // Targets
    const container = document.getElementById('settings-targets-list');
    container.innerHTML = '';
    for (const t of config.customTargets) {
      const row = document.createElement('div');
      row.className = 'target-row';
      row.innerHTML = `
        <input type="text" placeholder="Target name" class="target-name" value="${t.name}" required>
        <input type="number" placeholder="Miles/year" class="target-miles" value="${t.yearlyMiles}" min="1" step="1" required>
        <button type="button" class="btn-icon danger" onclick="this.parentElement.remove()">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      container.appendChild(row);
    }

    // Account card — show if signed in
    const accountCard = document.getElementById('account-card');
    if (App.Auth.isSignedIn()) {
      accountCard.style.display = '';
      document.getElementById('settings-user-email').textContent = App.Auth.userEmail();
    } else {
      accountCard.style.display = 'none';
    }
  },

  async handleSettingsSave() {
    const startDate = document.getElementById('settings-start-date').value;
    const term = parseInt(document.getElementById('settings-term').value);
    const odometer = parseInt(document.getElementById('settings-odometer').value);
    const allotment = parseInt(document.getElementById('settings-allotment').value);
    const frequency = document.getElementById('settings-frequency').value;
    const targets = this.getTargetsFromContainer('settings-targets-list');
    let notificationsEnabled = document.getElementById('settings-notifications').checked;

    if (!startDate || !term || isNaN(odometer) || !allotment) {
      this.showToast('Please fill in all required fields.');
      return;
    }

    // Request notification permission if newly enabled
    let permissionDenied = false;
    if (notificationsEnabled && !(this.data.config.notificationsEnabled)) {
      const granted = await this.requestNotificationPermission();
      if (!granted) {
        document.getElementById('settings-notifications').checked = false;
        notificationsEnabled = false;
        permissionDenied = true;
      }
    }

    // Manage push subscription
    if (notificationsEnabled && !permissionDenied) {
      await this.subscribeToPush();
    } else if (!notificationsEnabled && this.data.config.notificationsEnabled) {
      await this.unsubscribeFromPush();
    }

    const reminderTimeLocal = document.getElementById('settings-reminder-time').value || '09:00';
    const reminderHourUTC = (() => {
      const d = new Date();
      d.setHours(parseInt(reminderTimeLocal.split(':')[0]), 0, 0, 0);
      return d.getUTCHours();
    })();
    const reminderDayOfWeek = parseInt(document.getElementById('settings-reminder-day').value);

    this.data.config = {
      leaseStartDate: startDate,
      leaseTerm: term,
      startingOdometer: odometer,
      yearlyAllotment: allotment,
      checkInFrequency: frequency,
      customTargets: targets,
      notificationsEnabled: notificationsEnabled,
      reminderTimeLocal,
      reminderHourUTC,
      reminderDayOfWeek
    };

    App.Storage.save(this.data);
    this.showToast(permissionDenied
      ? 'Saved, but notification permission was denied. Enable in browser settings.'
      : 'Settings saved.');
  },

  // ===== CSV Import =====
  _csvPendingEntries: null,

  handleCSVImport(csvText) {
    if (!this.data) {
      this.showToast('Please complete setup first.');
      return;
    }

    // Parse CSV
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      this.showToast('CSV file is empty or has no data rows.');
      return;
    }

    // Parse header to find date and odometer columns
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/["']/g, ''));
    const dateIdx = header.findIndex(h => h === 'date');
    const odoIdx = header.findIndex(h => h === 'odometer' || h === 'mileage' || h === 'odo' || h === 'miles');

    if (dateIdx === -1 || odoIdx === -1) {
      this.showToast('CSV must have "date" and "odometer" (or "mileage") columns.');
      return;
    }

    // Parse rows into daily readings
    const dailyReadings = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/["']/g, ''));
      if (cols.length <= Math.max(dateIdx, odoIdx)) continue;

      const dateStr = cols[dateIdx];
      const odoVal = parseFloat(cols[odoIdx]);
      if (!dateStr || isNaN(odoVal)) continue;

      // Parse date flexibly (YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY)
      const parsed = this.parseCSVDate(dateStr);
      if (!parsed) continue;

      dailyReadings.push({ date: parsed, odometer: Math.round(odoVal) });
    }

    if (dailyReadings.length === 0) {
      this.showToast('No valid rows found in CSV.');
      return;
    }

    // Sort by date
    dailyReadings.sort((a, b) => a.date.localeCompare(b.date));

    // Aggregate into weekly entries: take the last reading of each ISO week
    const weeklyEntries = this.aggregateWeekly(dailyReadings);

    if (weeklyEntries.length === 0) {
      this.showToast('No weekly entries could be generated.');
      return;
    }

    // Store pending and show preview
    this._csvPendingEntries = weeklyEntries;
    this.renderCSVPreview(dailyReadings.length, weeklyEntries);
  },

  parseCSVDate(str) {
    // Try YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // Try MM/DD/YYYY or M/D/YYYY
    const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdyMatch) {
      const m = mdyMatch[1].padStart(2, '0');
      const d = mdyMatch[2].padStart(2, '0');
      return `${mdyMatch[3]}-${m}-${d}`;
    }

    // Try Date.parse as fallback
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }

    return null;
  },

  aggregateWeekly(dailyReadings) {
    // Group by ISO week (week ending on Sunday)
    const weeks = new Map();

    for (const r of dailyReadings) {
      const d = new Date(r.date + 'T00:00:00');
      // Get the Sunday that ends this week
      const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ...
      const sunday = new Date(d);
      sunday.setDate(sunday.getDate() + (7 - dayOfWeek) % 7);
      const weekKey = sunday.toISOString().slice(0, 10);

      // Keep the last (highest date) reading in each week
      if (!weeks.has(weekKey) || r.date > weeks.get(weekKey).date) {
        weeks.set(weekKey, { date: r.date, odometer: r.odometer });
      }
    }

    // Convert to sorted array
    const entries = Array.from(weeks.values());
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  },

  renderCSVPreview(totalDaily, weeklyEntries) {
    const preview = document.getElementById('csv-preview');
    const summary = document.getElementById('csv-preview-summary');
    const tbody = document.querySelector('#csv-preview-table tbody');

    summary.textContent = `${totalDaily} daily rows → ${weeklyEntries.length} weekly entries`;

    tbody.innerHTML = '';
    const { config, entries } = this.data;
    const existingDates = new Set(entries.map(e => e.date));

    for (let i = 0; i < weeklyEntries.length; i++) {
      const we = weeklyEntries[i];
      const prevOdo = i > 0 ? weeklyEntries[i - 1].odometer : config.startingOdometer;
      const weekMiles = we.odometer - prevOdo;
      const conflict = existingDates.has(we.date);

      const tr = document.createElement('tr');
      if (conflict) tr.className = 'csv-row-conflict';

      const dateStr = new Date(we.date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      tr.innerHTML = `
        <td>${dateStr}${conflict ? ' *' : ''}</td>
        <td>${we.odometer.toLocaleString()}</td>
        <td>+${Math.max(0, weekMiles).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    }

    preview.classList.remove('hidden');
  },

  confirmCSVImport() {
    if (!this._csvPendingEntries || !this.data) return;

    const { entries } = this.data;
    const existingDates = new Set(entries.map(e => e.date));
    let added = 0;
    let skipped = 0;

    for (const we of this._csvPendingEntries) {
      if (existingDates.has(we.date)) {
        skipped++;
        continue;
      }
      entries.push({
        id: 'e_' + Date.now() + '_' + added,
        date: we.date,
        odometer: we.odometer,
        createdAt: new Date().toISOString(),
        updatedAt: null
      });
      added++;
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    App.Storage.save(this.data);
    this._csvPendingEntries = null;
    document.getElementById('csv-preview').classList.add('hidden');
    this.showToast(`Imported ${added} entries.${skipped ? ` ${skipped} skipped (duplicate dates).` : ''}`);
  },

  // ===== Toast =====
  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => App.UI.init());
