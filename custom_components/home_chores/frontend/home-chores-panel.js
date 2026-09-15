const ICONS = [
  "mdi:check-circle-outline", "mdi:dog-side", "mdi:food-apple", "mdi:vacuum",
  "mdi:broom", "mdi:dishwasher", "mdi:trash-can-outline", "mdi:book-open-page-variant",
  "mdi:bed", "mdi:toothbrush", "mdi:laundry", "mdi:flower"
];

class HomeChoresPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = null;
    this._selected = "all";
    this._tab = "chores";
    this._parent = false;
    this._parentToken = null;
    this._loading = true;
    this._dialog = null;
    this._toast = "";
    this._lastHass = null;
  }

  set hass(value) {
    this._lastHass = value;
    if (!this._data && !this._loadingPromise) this._load();
    if (this.isConnected && !this._unsubscribePromise) this._subscribe();
  }

  get hass() { return this._lastHass; }
  set narrow(value) { this.toggleAttribute("narrow", Boolean(value)); }
  set panel(value) { this._panel = value; }

  connectedCallback() { this._render(); if (this.hass) this._subscribe(); }
  disconnectedCallback() {
    if (this._unsubscribePromise) this._unsubscribePromise.then(unsub => unsub()).catch(() => {});
    this._unsubscribePromise = null;
  }

  _subscribe() {
    if (!this.hass || this._unsubscribePromise) return;
    this._unsubscribePromise = this.hass.connection.subscribeMessage(
      data => { this._data = data; this._loading = false; this._render(); },
      { type: "home_chores/subscribe" }
    );
  }

  async _call(type, values = {}) {
    if (!this.hass) throw new Error("Home Assistant is not ready");
    return this.hass.connection.sendMessagePromise({ type: "home_chores/" + type, ...values });
  }

  async _load() {
    this._loadingPromise = this._call("get_state");
    try {
      this._data = await this._loadingPromise;
      this._loading = false;
    } catch (error) {
      this._loading = false;
      this._toast = this._message(error);
    } finally {
      this._loadingPromise = null;
      this._render();
    }
  }

  _message(error) {
    return error?.message || error?.body?.message || "Something went wrong";
  }

  _escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  _person(id) { return this._data?.people.find(person => person.id === id); }
  _chore(id) { return this._data?.chores.find(chore => chore.id === id); }

  _startOfPeriod(chore) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    if (chore.frequency === "week") {
      const weekday = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - weekday);
    }
    return date;
  }

  _count(chore) {
    const start = this._startOfPeriod(chore);
    return this._data.completions.filter(item =>
      item.chore_id === chore.id && new Date(item.completed_at) >= start
    ).length;
  }

  _scheduledToday(chore) {
    if (!chore.weekdays?.length) return true;
    const mondayIndex = (new Date().getDay() + 6) % 7;
    return chore.weekdays.includes(mondayIndex);
  }

  _frequency(chore) {
    const period = chore.frequency === "day" ? "day" : "week";
    const amount = chore.times === 1 ? "Once" : chore.times + " times";
    const weekday = chore.weekdays?.length === 5 && chore.weekdays.join() === "0,1,2,3,4"
      ? " · weekdays" : "";
    return amount + " a " + period + weekday;
  }

  _availableChores() {
    if (!this._data) return [];
    return this._data.chores.filter(chore => {
      if (this._selected === "all") return chore.assignee_id === null;
      return chore.assignee_id === this._selected;
    });
  }

  _progress() {
    const chores = this._availableChores().filter(chore => this._scheduledToday(chore));
    const total = chores.reduce((sum, chore) => sum + chore.times, 0);
    const done = chores.reduce((sum, chore) => sum + Math.min(chore.times, this._count(chore)), 0);
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  _activity() {
    const completions = this._data.completions.map(item => ({ ...item, kind: "completion", at: item.completed_at }));
    const adjustments = this._data.adjustments.map(item => ({ ...item, kind: "adjustment", at: item.created_at }));
    return [...completions, ...adjustments].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
  }

  _render() {
    if (!this.shadowRoot) return;
    const admin = Boolean(this.hass?.user?.is_admin);
    const selectedPerson = this._selected === "all" ? null : this._person(this._selected);
    const progress = this._data ? this._progress() : { done: 0, total: 0, pct: 0 };
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="shell">
        <header>
          <button class="menu-button" data-action="toggle-menu" aria-label="Open Home Assistant sidebar"><ha-icon icon="mdi:menu"></ha-icon></button>
          <div class="brand"><span class="brand-star">★</span><span>Home Chores</span></div>
          <div class="date">${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
          <button class="parent-toggle ${this._parent ? "active" : ""}" data-action="parent"><ha-icon icon="mdi:${this._parent ? "lock-open-variant" : "lock"}"></ha-icon>${this._parent ? "Lock parent tools" : "Parent tools"}</button>
        </header>
        ${this._loading ? this._loadingView() : this._data ? `
          <aside>
            <p class="eyebrow">Family stars</p>
            <button class="member ${this._selected === "all" ? "selected" : ""}" data-person="all">
              <span class="shared-avatar"><ha-icon icon="mdi:account-group"></ha-icon></span>
              <span class="member-copy"><strong>Up for grabs</strong><small>Shared chores</small></span>
              <span class="chev">›</span>
            </button>
            <div class="members">
              ${this._data.people.map(person => `
                <button class="member ${this._selected === person.id ? "selected" : ""}" data-person="${this._escape(person.id)}">
                  <span class="avatar" style="--avatar:${this._escape(person.color)}">${this._escape(person.avatar)}</span>
                  <span class="member-copy"><strong>${this._escape(person.name)}</strong><small><b>★</b> ${person.score} stars</small></span>
                  <span class="chev">›</span>
                </button>`).join("")}
            </div>
            ${this._parent ? `<button class="add-member" data-action="add-person"><ha-icon icon="mdi:account-plus-outline"></ha-icon>Add person</button>` : ""}
            <div class="family-total"><span>Total earned</span><strong>★ ${this._data.people.reduce((sum, p) => sum + p.score, 0)}</strong></div>
          </aside>
          <main>
            <nav class="tabs" aria-label="Chore views">
              <button class="${this._tab === "chores" ? "active" : ""}" data-tab="chores">Today</button>
              <button class="${this._tab === "history" ? "active" : ""}" data-tab="history">Activity</button>
            </nav>
            ${this._tab === "chores" ? this._choreView(selectedPerson, progress) : this._historyView()}
          </main>
        ` : this._errorView()}
      </div>
      ${this._dialog ? this._dialogMarkup() : ""}
      ${this._toast ? `<div class="toast" role="status">${this._escape(this._toast)}</div>` : ""}
      <div class="star-layer" aria-hidden="true"></div>
    `;
    this._bind();
  }

  _loadingView() {
    return `<main class="loading"><div class="spinner"></div><p>Loading your chore board…</p></main>`;
  }

  _errorView() {
    return `<main class="empty"><ha-icon icon="mdi:alert-circle-outline"></ha-icon><h2>Couldn’t load chores</h2><p>${this._escape(this._toast)}</p><button data-action="retry">Try again</button></main>`;
  }

  _choreView(person, progress) {
    const chores = this._availableChores();
    const title = person ? person.name + "’s chores" : "Up for grabs";
    const subtitle = person ? "Personal routines and responsibilities" : "Anyone can pitch in and earn the stars";
    return `
      <section class="overview">
        <div>
          <p class="eyebrow">${person ? "Personal list" : "Shared list"}</p>
          <h1>${this._escape(title)}</h1>
          <p class="subtitle">${subtitle}</p>
        </div>
        <div class="progress-card">
          <div class="progress-top"><span>Today’s progress</span><strong>${progress.done}<small> / ${progress.total}</small></strong></div>
          <div class="track"><span style="width:${progress.pct}%"></span></div>
        </div>
      </section>
      ${this._parent ? `
        <section class="parent-bar">
          <div><ha-icon icon="mdi:shield-account"></ha-icon><span><strong>Parent tools unlocked</strong><small>Edit chores, unmark completions, or correct stars.</small></span></div>
          <div class="parent-actions">
            ${person ? `<button data-action="score"><ha-icon icon="mdi:star-cog-outline"></ha-icon>Adjust stars</button>` : ""}
            ${person ? `<button class="danger-subtle" data-action="remove-person"><ha-icon icon="mdi:account-remove-outline"></ha-icon>Remove person</button>` : ""}
            <button data-action="change-pin"><ha-icon icon="mdi:key-variant"></ha-icon>Change PIN</button>
            <button class="primary" data-action="add-chore"><ha-icon icon="mdi:plus"></ha-icon>Add chore</button>
          </div>
        </section>` : ""}
      <section class="chore-grid">
        ${chores.length ? chores.map((chore, index) => this._choreCard(chore, index, chores.length)).join("") : `
          <div class="empty-list"><span>✓</span><h2>No chores here yet</h2><p>${this._parent ? "Add the first chore to this list." : "A parent can add a chore here."}</p></div>`}
      </section>`;
  }

  _choreCard(chore, index, total) {
    const count = this._count(chore);
    const complete = count >= chore.times;
    const scheduled = this._scheduledToday(chore);
    const disabled = complete || !scheduled;
    const dots = Array.from({ length: chore.times }, (_, index) => `<i class="${index < count ? "done" : ""}"></i>`).join("");
    return `
      <article class="chore-card ${complete ? "complete" : ""} ${!scheduled ? "not-today" : ""}">
        <div class="chore-head">
          <span class="chore-icon"><ha-icon icon="${this._escape(chore.icon)}"></ha-icon></span>
          <span class="stars">★ ${chore.stars}</span>
          ${this._parent ? `<span class="order-controls"><button class="icon-button" title="Move chore up" aria-label="Move ${this._escape(chore.title)} up" data-move-chore="${this._escape(chore.id)}" data-direction="up" ${index === 0 ? "disabled" : ""}><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="icon-button" title="Move chore down" aria-label="Move ${this._escape(chore.title)} down" data-move-chore="${this._escape(chore.id)}" data-direction="down" ${index === total - 1 ? "disabled" : ""}><ha-icon icon="mdi:arrow-down"></ha-icon></button></span><button class="icon-button edit" title="Edit chore" data-edit-chore="${this._escape(chore.id)}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button><button class="icon-button delete" title="Remove chore" data-remove-chore="${this._escape(chore.id)}"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>` : ""}
        </div>
        <div class="chore-copy"><h2>${this._escape(chore.title)}</h2><p>${this._escape(this._frequency(chore))}</p></div>
        <div class="card-foot">
          <span class="occurrences">${dots}<small>${scheduled ? count + " of " + chore.times : "Not today"}</small></span>
          ${this._parent && count > 0 ? `<button class="unmark-button" data-unmark="${this._escape(chore.id)}">Unmark</button>` : ""}
          <button class="complete-button" data-complete="${this._escape(chore.id)}" ${disabled ? "disabled" : ""} aria-label="Complete ${this._escape(chore.title)}">
            <ha-icon icon="${complete ? "mdi:check" : "mdi:star-four-points"}"></ha-icon>
            ${complete ? "Done" : "Complete"}
          </button>
        </div>
      </article>`;
  }

  _historyView() {
    const activity = this._activity();
    return `
      <section class="history-head"><div><p class="eyebrow">Recent activity</p><h1>Stars & completions</h1><p class="subtitle">A clear record parents can review and correct.</p></div></section>
      <section class="activity-list">
        ${activity.length ? activity.map(item => {
          const person = this._person(item.person_id);
          if (!person) return "";
          const adjustment = item.kind === "adjustment";
          return `<article class="activity-row">
            <span class="avatar small" style="--avatar:${this._escape(person.color)}">${this._escape(person.avatar)}</span>
            <span class="activity-copy"><strong>${adjustment ? this._escape(item.reason) : this._escape(item.title)}</strong><small>${this._escape(person.name)} · ${this._relative(item.at)}</small></span>
            <span class="activity-stars ${adjustment && item.delta < 0 ? "negative" : ""}">${adjustment ? (item.delta > 0 ? "+" : "") + item.delta : "+" + item.stars} ★</span>
            ${this._parent && !adjustment ? `<button class="undo" data-undo="${this._escape(item.id)}">Undo</button>` : ""}
          </article>`;
        }).join("") : `<div class="empty-list"><span>★</span><h2>No activity yet</h2><p>Completed chores will appear here.</p></div>`}
      </section>`;
  }

  _relative(value) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value)) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + " min ago";
    if (minutes < 1440) return Math.floor(minutes / 60) + " hr ago";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
  }

  _dialogMarkup() {
    const d = this._dialog;
    if (d.type === "complete") {
      const chore = this._chore(d.choreId);
      return this._modal("Who completed it?", "Choose who earned the stars for “" + this._escape(chore.title) + "”.", `
        <div class="person-picker">${this._data.people.map(person => `
          <button data-award="${this._escape(person.id)}"><span class="avatar" style="--avatar:${this._escape(person.color)}">${this._escape(person.avatar)}</span><strong>${this._escape(person.name)}</strong><small>+${chore.stars} ★</small></button>`).join("")}</div>`);
    }
    if (d.type === "person") {
      return this._modal("Add a person", "Create a personal chore list and star total.", `
        <form id="person-form" class="form">
          <label><span>Name</span><input name="name" maxlength="40" required autofocus placeholder="e.g. Sam"></label>
          <div class="form-row"><label><span>Initials</span><input name="avatar" maxlength="2" placeholder="SA"></label><label><span>Color</span><input name="color" type="color" value="#6c5ce7"></label></div>
          <button class="submit" type="submit">Add person</button>
        </form>`);
    }
    if (d.type === "chore") {
      const chore = d.choreId ? this._chore(d.choreId) : null;
      const target = chore ? (chore.assignee_id || "") : (this._selected === "all" ? "" : this._selected);
      const frequency = chore?.frequency || "day";
      const weekdays = chore?.weekdays || [];
      return this._modal(chore ? "Edit chore" : "Add a chore", chore ? "Update this individual chore without changing its copies." : "Choose one or more lists. Each selection gets an independent copy.", `
        <form id="chore-form" class="form">
          <input type="hidden" name="chore_id" value="${this._escape(chore?.id || "")}">
          <label><span>Chore name</span><input name="title" maxlength="80" required autofocus placeholder="e.g. Put away dishes" value="${this._escape(chore?.title || "")}"></label>
          ${chore ? `<label><span>List</span><select name="assignee_id"><option value="">Up for grabs</option>${this._data.people.map(person => `<option value="${this._escape(person.id)}" ${target === person.id ? "selected" : ""}>${this._escape(person.name)}</option>`).join("")}</select></label>` : `<fieldset class="target-field"><legend>Add separate chore to</legend><div class="target-picker"><label><input type="checkbox" name="assignee_id" value="" ${target === "" ? "checked" : ""}><span class="shared-avatar"><ha-icon icon="mdi:account-group"></ha-icon></span><strong>Up for grabs</strong></label>${this._data.people.map(person => `<label><input type="checkbox" name="assignee_id" value="${this._escape(person.id)}" ${target === person.id ? "checked" : ""}><span class="avatar" style="--avatar:${this._escape(person.color)}">${this._escape(person.avatar)}</span><strong>${this._escape(person.name)}</strong></label>`).join("")}</div><small>Select one or more. Each list gets its own independent chore.</small></fieldset>`}
          <fieldset class="icon-field"><legend>Icon</legend><input type="hidden" name="icon" value="${this._escape(chore?.icon || ICONS[0])}"><div class="icon-picker" role="listbox" aria-label="Chore icon">${ICONS.map(icon => { const label = icon.replace("mdi:", "").replaceAll("-", " "); return `<button type="button" role="option" aria-label="${label}" aria-selected="${(chore?.icon || ICONS[0]) === icon}" class="${(chore?.icon || ICONS[0]) === icon ? "selected" : ""}" data-icon-choice="${icon}" title="${label}"><ha-icon icon="${icon}"></ha-icon></button>`; }).join("")}</div></fieldset>
          <div class="form-row three"><label><span>Repeats</span><select name="frequency"><option value="day" ${frequency === "day" ? "selected" : ""}>Every day</option><option value="week" ${frequency === "week" ? "selected" : ""}>Every week</option></select></label><label><span>Times</span><input name="times" type="number" min="1" max="20" value="${chore?.times || 1}" required></label><label><span>Stars</span><input name="stars" type="number" min="1" max="100" value="${chore?.stars || 1}" required></label></div>
          <fieldset><legend>Days (leave all off for every day)</legend><div class="day-picker">${["M","T","W","T","F","S","S"].map((day, index) => `<label><input type="checkbox" name="weekday" value="${index}" ${weekdays.includes(index) ? "checked" : ""}><span>${day}</span></label>`).join("")}</div></fieldset>
          <button class="submit" type="submit">${chore ? "Save changes" : "Add chore"}</button>
        </form>`);
    }
    if (d.type === "pin-setup") {
      return this._modal("Set a parent PIN", "Use 4–8 digits. Parent changes will require this PIN, even from a non-admin Home Assistant account.", `
        <form id="pin-setup-form" class="form pin-form">
          <label><span>New PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autofocus autocomplete="new-password"></label>
          <label><span>Confirm PIN</span><input name="confirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
          <button class="submit" type="submit">Set PIN</button>
        </form>`);
    }
    if (d.type === "pin-unlock") {
      return this._modal("Unlock parent tools", "The dashboard will lock again after 30 minutes or when you choose Lock.", `
        <form id="pin-unlock-form" class="form pin-form">
          <label><span>Parent PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autofocus autocomplete="current-password"></label>
          <button class="submit" type="submit">Unlock</button>
          <button class="text-button" type="button" data-action="forgot-pin">Forgot PIN?</button>
        </form>`);
    }
    if (d.type === "pin-recover") {
      return this._modal("Recover parent access", "Enter the recovery code saved when the PIN was created. A new recovery code will replace it.", `
        <form id="pin-recover-form" class="form pin-form">
          <label><span>Recovery code</span><input name="recovery_code" maxlength="24" required autofocus placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off"></label>
          <label><span>New PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
          <label><span>Confirm PIN</span><input name="confirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
          <button class="submit" type="submit">Reset PIN</button>
          ${this.hass?.user?.is_admin ? `<button class="text-button" type="button" data-action="admin-recovery">Lost the recovery code? Use HA admin recovery</button>` : ""}
        </form>`);
    }
    if (d.type === "admin-reset" || d.type === "change-pin") {
      const adminReset = d.type === "admin-reset";
      return this._modal(adminReset ? "Administrator recovery" : "Change parent PIN", adminReset ? "Your Home Assistant administrator account is the final recovery method." : "Changing the PIN also creates a new recovery code.", `
        <form id="pin-change-form" class="form pin-form" data-admin="${adminReset}">
          <label><span>New PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autofocus autocomplete="new-password"></label>
          <label><span>Confirm PIN</span><input name="confirm" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
          <button class="submit" type="submit">${adminReset ? "Reset parent PIN" : "Change PIN"}</button>
        </form>`);
    }
    if (d.type === "recovery-code") {
      return this._modal("Save your recovery code", "This code is shown only once. Store it in a password manager or another safe place.", `
        <div class="recovery-code" aria-label="Recovery code">${this._escape(d.code)}</div>
        <button class="submit full" data-copy-recovery="${this._escape(d.code)}">Copy recovery code</button>
        <button class="text-button full" data-action="recovery-done">I saved it</button>`);
    }
    if (d.type === "score") {
      const person = this._person(this._selected);
      return this._modal("Adjust " + this._escape(person.name) + "’s stars", "Use a negative number to correct a score.", `
        <form id="score-form" class="form">
          <label><span>Star change</span><input name="delta" type="number" min="-1000" max="1000" required placeholder="e.g. -2 or 5"></label>
          <label><span>Reason</span><input name="reason" maxlength="120" required placeholder="e.g. Chore marked by mistake"></label>
          <button class="submit" type="submit">Save adjustment</button>
        </form>`);
    }
    if (d.type === "confirm") {
      return this._modal(d.title, d.text, `<div class="confirm-actions"><button data-action="close">Cancel</button><button class="danger" data-confirm="${d.action}">Remove</button></div>`);
    }
    return "";
  }

  _modal(title, text, body) {
    return `<div class="modal-backdrop" data-action="close"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" @click=""><button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">${title}</h2><p>${text}</p>${body}</section></div>`;
  }

  _bind() {
    this.shadowRoot.querySelectorAll("[data-person]").forEach(button => button.onclick = () => {
      this._selected = button.dataset.person; this._tab = "chores"; this._render();
    });
    this.shadowRoot.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => {
      this._tab = button.dataset.tab; this._render();
    });
    this.shadowRoot.querySelectorAll("[data-action]").forEach(button => button.onclick = async event => {
      const action = button.dataset.action;
      if (action === "close" && (event.target === button || button.classList.contains("modal-close") || button.textContent === "Cancel")) { this._dialog = null; this._render(); }
      if (action === "parent") {
        if (this._parent) {
          try { await this._call("lock_parent", { parent_token: this._parentToken }); } catch (_) {}
          this._parent = false; this._parentToken = null; this._render();
        } else if (this._data.parent_security?.configured) {
          this._dialog = { type: "pin-unlock" }; this._render();
        } else if (this.hass?.user?.is_admin) {
          this._dialog = { type: "pin-setup" }; this._render();
        } else {
          this._showToast("A Home Assistant administrator must set the first parent PIN");
        }
      }
      if (action === "toggle-menu") {
        this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
      }
      if (action === "add-person") { this._dialog = { type: "person" }; this._render(); }
      if (action === "add-chore") { this._dialog = { type: "chore" }; this._render(); }
      if (action === "change-pin") { this._dialog = { type: "change-pin" }; this._render(); }
      if (action === "forgot-pin") { this._dialog = { type: "pin-recover" }; this._render(); }
      if (action === "admin-recovery") { this._dialog = { type: "admin-reset" }; this._render(); }
      if (action === "recovery-done") { this._dialog = null; this._render(); }
      if (action === "score") { this._dialog = { type: "score" }; this._render(); }
      if (action === "remove-person") { const p = this._person(this._selected); this._dialog = { type: "confirm", action: "person", title: "Remove " + p.name + "?", text: "Their personal chore list will also be removed." }; this._render(); }
      if (action === "retry") this._load();
    });
    this.shadowRoot.querySelectorAll("[data-complete]").forEach(button => button.onclick = () => {
      const chore = this._chore(button.dataset.complete);
      if (chore.assignee_id) this._complete(chore.id, chore.assignee_id, button);
      else { this._dialog = { type: "complete", choreId: chore.id }; this._render(); }
    });
    this.shadowRoot.querySelectorAll("[data-award]").forEach(button => button.onclick = () => this._complete(this._dialog.choreId, button.dataset.award, button));
    this.shadowRoot.querySelectorAll("[data-remove-chore]").forEach(button => button.onclick = () => {
      const c = this._chore(button.dataset.removeChore); this._dialog = { type: "confirm", action: "chore:" + c.id, title: "Remove this chore?", text: "“" + c.title + "” will no longer appear on the board." }; this._render();
    });
    this.shadowRoot.querySelectorAll("[data-edit-chore]").forEach(button => button.onclick = () => {
      this._dialog = { type: "chore", choreId: button.dataset.editChore }; this._render();
    });
    this.shadowRoot.querySelectorAll("[data-move-chore]").forEach(button => button.onclick = () => {
      this._mutate("move_chore", { chore_id: button.dataset.moveChore, direction: button.dataset.direction }, "Chore moved");
    });
    this.shadowRoot.querySelectorAll("[data-unmark]").forEach(button => button.onclick = () => {
      this._mutate("undo_chore", { chore_id: button.dataset.unmark }, "Completion unmarked and stars removed");
    });
    this.shadowRoot.querySelectorAll("[data-icon-choice]").forEach(button => button.onclick = () => {
      const picker = button.closest(".icon-picker");
      picker.querySelectorAll("[data-icon-choice]").forEach(option => { option.classList.toggle("selected", option === button); option.setAttribute("aria-selected", option === button ? "true" : "false"); });
      picker.closest(".icon-field").querySelector('input[name="icon"]').value = button.dataset.iconChoice;
    });
    this.shadowRoot.querySelectorAll("[data-undo]").forEach(button => button.onclick = () => this._mutate("undo_completion", { completion_id: button.dataset.undo }, "Completion undone"));
    this.shadowRoot.querySelectorAll("[data-confirm]").forEach(button => button.onclick = () => {
      const action = button.dataset.confirm;
      if (action === "person") this._mutate("remove_person", { person_id: this._selected }, "Person removed", () => { this._selected = "all"; });
      else this._mutate("remove_chore", { chore_id: action.split(":")[1] }, "Chore removed");
    });
    const personForm = this.shadowRoot.querySelector("#person-form");
    if (personForm) personForm.onsubmit = event => { event.preventDefault(); const f = new FormData(personForm); this._mutate("add_person", { name: f.get("name"), avatar: f.get("avatar"), color: f.get("color") }, "Person added"); };
    const choreForm = this.shadowRoot.querySelector("#chore-form");
    if (choreForm) choreForm.onsubmit = event => { event.preventDefault(); const f = new FormData(choreForm); const choreId = f.get("chore_id"); const base = { title: f.get("title"), icon: f.get("icon"), frequency: f.get("frequency"), times: Number(f.get("times")), weekdays: f.getAll("weekday").map(Number), stars: Number(f.get("stars")) }; if (choreId) this._mutate("update_chore", { chore_id: choreId, assignee_id: f.get("assignee_id") || null, ...base }, "Chore updated"); else { const targets = f.getAll("assignee_id").map(value => value || null); if (!targets.length) { this._showToast("Choose at least one chore list"); return; } this._mutate("add_chore", { assignee_ids: targets, ...base }, targets.length === 1 ? "Chore added" : "Chore added to " + targets.length + " lists"); } };
    const scoreForm = this.shadowRoot.querySelector("#score-form");
    if (scoreForm) scoreForm.onsubmit = event => { event.preventDefault(); const f = new FormData(scoreForm); this._mutate("adjust_score", { person_id: this._selected, delta: Number(f.get("delta")), reason: f.get("reason") }, "Stars adjusted"); };
    const setupForm = this.shadowRoot.querySelector("#pin-setup-form");
    if (setupForm) setupForm.onsubmit = event => { event.preventDefault(); this._submitPinForm(setupForm, "set_parent_pin", "pin"); };
    const unlockForm = this.shadowRoot.querySelector("#pin-unlock-form");
    if (unlockForm) unlockForm.onsubmit = async event => { event.preventDefault(); const f = new FormData(unlockForm); try { this._acceptParentResult(await this._call("unlock_parent", { pin: f.get("pin") })); } catch (error) { this._showToast(this._message(error)); } };
    const recoverForm = this.shadowRoot.querySelector("#pin-recover-form");
    if (recoverForm) recoverForm.onsubmit = event => { event.preventDefault(); this._submitPinForm(recoverForm, "recover_parent_pin", "new_pin", { recovery_code: new FormData(recoverForm).get("recovery_code") }); };
    const changeForm = this.shadowRoot.querySelector("#pin-change-form");
    if (changeForm) changeForm.onsubmit = event => { event.preventDefault(); const admin = changeForm.dataset.admin === "true"; this._submitPinForm(changeForm, admin ? "admin_reset_parent_pin" : "change_parent_pin", "new_pin", admin ? {} : { parent_token: this._parentToken }); };
    this.shadowRoot.querySelectorAll("[data-copy-recovery]").forEach(button => button.onclick = async () => { try { await navigator.clipboard.writeText(button.dataset.copyRecovery); button.textContent = "Copied"; } catch (_) { this._showToast("Copy failed—write down the recovery code instead"); } });
  }

  async _submitPinForm(form, command, pinField, extra = {}) {
    const values = new FormData(form);
    const pin = values.get("pin");
    if (pin !== values.get("confirm")) { this._showToast("The PIN entries do not match"); return; }
    try {
      const result = await this._call(command, { [pinField]: pin, ...extra });
      this._acceptParentResult(result);
    } catch (error) { this._showToast(this._message(error)); }
  }

  _acceptParentResult(result) {
    this._parentToken = result.parent_token;
    this._parent = true;
    this._dialog = result.recovery_code ? { type: "recovery-code", code: result.recovery_code } : null;
    this._render();
  }

  async _complete(choreId, personId, source) {
    source.disabled = true;
    try {
      const result = await this._call("complete", { chore_id: choreId, person_id: personId });
      this._dialog = null;
      await this._load();
      const person = this._person(personId);
      this._showToast("+" + result.stars + " stars for " + person.name + "!");
      this._burst();
    } catch (error) {
      source.disabled = false;
      this._showToast(this._message(error));
    }
  }

  async _mutate(type, values, success, beforeRender) {
    try {
      await this._call(type, { ...values, parent_token: this._parentToken });
      if (beforeRender) beforeRender();
      this._dialog = null;
      await this._load();
      this._showToast(success);
    } catch (error) {
      const message = this._message(error);
      if (message.toLowerCase().includes("parent tools are locked")) {
        this._parent = false; this._parentToken = null; this._dialog = { type: "pin-unlock" }; this._render();
      } else this._showToast(message);
    }
  }

  _showToast(message) {
    this._toast = message; this._render();
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this._toast = ""; this._render(); }, 2800);
  }

  _burst() {
    requestAnimationFrame(() => {
      const layer = this.shadowRoot.querySelector(".star-layer");
      if (!layer) return;
      for (let i = 0; i < 26; i++) {
        const star = document.createElement("span");
        star.textContent = "★";
        star.style.setProperty("--x", (Math.random() * 90 - 45) + "vw");
        star.style.setProperty("--y", (-15 - Math.random() * 55) + "vh");
        star.style.setProperty("--r", (Math.random() * 420 - 210) + "deg");
        star.style.setProperty("--delay", (Math.random() * 0.18) + "s");
        layer.appendChild(star);
        setTimeout(() => star.remove(), 1300);
      }
    });
  }

  _styles() { return `
    :host { display:block; min-height:100%; color:var(--primary-text-color,#17233b); background:var(--primary-background-color,#f3f6fb); font-family:var(--paper-font-body1_-_font-family,Inter,system-ui,sans-serif); }
    * { box-sizing:border-box; } button,input,select { font:inherit; } button { color:inherit; }
    .shell { min-height:100vh; display:grid; grid-template-columns:260px minmax(0,1fr); grid-template-rows:72px 1fr; }
    header { grid-column:1/-1; display:grid; grid-template-columns:auto 230px 1fr auto; gap:14px; align-items:center; padding:0 24px; background:var(--card-background-color,#fff); border-bottom:1px solid var(--divider-color,#e7eaf0); position:sticky; top:0; z-index:5; }
    .menu-button { width:42px; height:42px; border:0; border-radius:12px; display:grid; place-items:center; background:transparent; cursor:pointer; color:var(--primary-text-color,#17233b); }
    .menu-button:hover { background:var(--secondary-background-color,#eef1f5); }
    .brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:800; letter-spacing:-.02em; }
    .brand-star { display:grid; place-items:center; width:34px; height:34px; border-radius:11px; color:#18233c; background:#ffd85a; transform:rotate(-5deg); }
    .date { color:var(--secondary-text-color,#697386); font-size:14px; }
    .parent-toggle,.add-member { border:1px solid var(--divider-color,#dde2ea); background:transparent; border-radius:12px; min-height:42px; padding:0 14px; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; font-weight:700; }
    .parent-toggle.active { background:#17233b; color:#fff; border-color:#17233b; }
    aside { grid-row:2; padding:28px 16px; background:var(--card-background-color,#fff); border-right:1px solid var(--divider-color,#e7eaf0); }
    .eyebrow { margin:0 0 10px; color:#55627a; font-weight:800; font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
    aside>.eyebrow { padding:0 12px; }
    .members { display:grid; gap:5px; margin-top:8px; }
    .member { width:100%; border:0; background:transparent; border-radius:14px; padding:10px 10px; display:grid; grid-template-columns:42px 1fr auto; gap:10px; align-items:center; text-align:left; cursor:pointer; }
    .member:hover { background:var(--secondary-background-color,#f4f6fa); } .member.selected { background:#edf0ff; color:#29347b; }
    .avatar,.shared-avatar { width:42px; height:42px; border-radius:14px; display:grid; place-items:center; flex:0 0 auto; font-weight:900; color:#fff; background:var(--avatar,#6c5ce7); box-shadow:inset 0 -2px rgba(0,0,0,.12); }
    .shared-avatar { background:#17233b; } .shared-avatar ha-icon { --mdc-icon-size:21px; }
    .member-copy { min-width:0; display:grid; gap:3px; } .member-copy strong { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .member-copy small { font-size:12px; color:var(--secondary-text-color,#758095); } .member-copy b { color:#e3a900; }
    .chev { color:#9ca5b5; font-size:23px; } .add-member { margin:16px 8px 0; width:calc(100% - 16px); border-style:dashed; }
    .family-total { margin:26px 10px 0; padding:15px; border-radius:15px; background:#17233b; color:#fff; display:flex; align-items:center; justify-content:space-between; font-size:13px; }
    .family-total strong { color:#ffd85a; font-size:16px; }
    main { grid-row:2; padding:0 clamp(22px,4vw,58px) 48px; max-width:1440px; width:100%; margin:0 auto; }
    .tabs { height:64px; display:flex; align-items:end; gap:28px; border-bottom:1px solid var(--divider-color,#dfe4ed); }
    .tabs button { height:48px; border:0; border-bottom:3px solid transparent; background:transparent; cursor:pointer; font-weight:750; color:var(--secondary-text-color,#758095); }
    .tabs button.active { color:var(--primary-text-color,#17233b); border-color:#6c5ce7; }
    .overview,.history-head { padding:34px 0 24px; display:flex; justify-content:space-between; gap:30px; align-items:end; }
    h1 { margin:0; font-size:clamp(30px,4vw,46px); line-height:1.05; letter-spacing:-.045em; } .subtitle { margin:9px 0 0; color:var(--secondary-text-color,#6f7b90); font-size:15px; }
    .progress-card { width:min(350px,40%); padding:18px 20px; border-radius:18px; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#e3e7ef); box-shadow:0 7px 25px rgba(25,36,62,.05); }
    .progress-top { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; font-weight:750; } .progress-top strong { font-size:22px; } .progress-top small { color:#9aa3b2; font-weight:600; }
    .track { height:8px; background:var(--secondary-background-color,#edf0f5); border-radius:999px; margin-top:12px; overflow:hidden; } .track span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#6c5ce7,#8c7cf4); }
    .parent-bar { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:14px 16px; margin-bottom:20px; background:#fff8de; border:1px solid #f1da83; border-radius:16px; color:#4b4122; }
    .parent-bar>div { display:flex; align-items:center; gap:10px; } .parent-bar small { display:block; margin-top:2px; color:#766c4d; }
    .parent-actions { flex-wrap:wrap; justify-content:flex-end; } .parent-actions button { border:1px solid #dfd19a; background:#fff; border-radius:10px; min-height:38px; padding:0 11px; display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; font-size:13px; }
    .parent-actions .primary { background:#17233b; color:#fff; border-color:#17233b; } .parent-actions .danger-subtle { color:#a13a3a; }
    .chore-grid { display:grid; grid-template-columns:repeat(3,minmax(240px,1fr)); gap:16px; }
    .chore-card { min-height:205px; padding:18px; display:flex; flex-direction:column; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#e1e6ee); border-radius:20px; box-shadow:0 9px 28px rgba(22,35,61,.055); transition:transform .18s ease,box-shadow .18s ease; }
    .chore-card:hover { transform:translateY(-2px); box-shadow:0 14px 32px rgba(22,35,61,.09); } .chore-card.complete { background:color-mix(in srgb,var(--card-background-color,#fff) 89%,#ddfaed); } .chore-card.not-today { opacity:.58; }
    .chore-head { display:flex; align-items:center; gap:8px; } .chore-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:14px; color:#5444cc; background:#eeebff; }
    .stars { margin-left:auto; color:#8a6800; background:#fff3bd; border-radius:999px; padding:6px 9px; font-size:13px; font-weight:850; }
    .icon-button { width:32px; height:32px; display:grid; place-items:center; border:0; border-radius:9px; background:transparent; cursor:pointer; color:#9c5260; } .icon-button:hover { background:#ffe8ec; }
    .icon-button:disabled { opacity:.3; cursor:default; background:transparent; } .order-controls { display:flex; gap:1px; } .order-controls .icon-button { color:#657187; }
    .chore-copy { margin-top:19px; } .chore-copy h2 { margin:0; font-size:19px; letter-spacing:-.02em; } .chore-copy p { margin:6px 0 0; color:var(--secondary-text-color,#778196); font-size:13px; }
    .card-foot { margin-top:auto; padding-top:18px; display:flex; justify-content:flex-end; align-items:center; gap:9px; flex-wrap:wrap; }
    .card-foot .occurrences { margin-right:auto; }
    .occurrences { display:flex; align-items:center; gap:4px; flex-wrap:wrap; } .occurrences i { width:8px; height:8px; border-radius:50%; background:#dce1ea; } .occurrences i.done { background:#6c5ce7; } .occurrences small { width:100%; margin-top:3px; color:#8b95a6; font-size:11px; }
    .complete-button { min-height:40px; border:0; border-radius:12px; padding:0 13px; display:flex; align-items:center; gap:7px; background:#6c5ce7; color:#fff; cursor:pointer; font-weight:800; box-shadow:0 6px 16px rgba(108,92,231,.24); }
    .complete-button:disabled { cursor:default; box-shadow:none; background:#e1e5eb; color:#6c7688; }
    .unmark-button { min-height:38px; border:1px solid #d7dce5; border-radius:11px; padding:0 10px; background:transparent; color:#9b4050; cursor:pointer; font-size:12px; font-weight:800; }
    .unmark-button:hover { background:#fff0f2; border-color:#e7b8c0; }
    .activity-list { display:grid; gap:9px; } .activity-row { display:grid; grid-template-columns:42px 1fr auto auto; gap:13px; align-items:center; padding:14px 16px; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#e2e6ed); border-radius:15px; }
    .avatar.small { width:38px; height:38px; border-radius:12px; font-size:13px; } .activity-copy { display:grid; gap:4px; } .activity-copy small { color:var(--secondary-text-color,#768196); }
    .activity-stars { color:#317356; font-weight:850; } .activity-stars.negative { color:#b53e4b; } .undo { border:0; background:transparent; color:#6c5ce7; font-weight:800; cursor:pointer; }
    .empty-list { grid-column:1/-1; text-align:center; padding:64px 20px; border:2px dashed var(--divider-color,#d9dee8); border-radius:20px; color:var(--secondary-text-color,#768196); } .empty-list>span { display:grid; place-items:center; width:54px; height:54px; margin:auto; border-radius:18px; background:#eeebff; color:#6c5ce7; font-size:25px; } .empty-list h2 { margin:14px 0 5px; color:var(--primary-text-color,#17233b); }
    .modal-backdrop { position:fixed; inset:0; z-index:20; display:grid; place-items:center; padding:20px; background:rgba(12,19,34,.58); backdrop-filter:blur(5px); }
    .modal { width:min(540px,100%); max-height:min(780px,calc(100vh - 32px)); overflow:auto; position:relative; padding:26px; background:var(--card-background-color,#fff); border-radius:24px; box-shadow:0 30px 80px rgba(0,0,0,.28); }
    .modal>h2 { margin:0; font-size:25px; letter-spacing:-.03em; } .modal>p { margin:7px 36px 22px 0; color:var(--secondary-text-color,#717c90); line-height:1.45; } .modal-close { position:absolute; top:17px; right:17px; width:36px; height:36px; border:0; border-radius:50%; background:var(--secondary-background-color,#eef1f5); cursor:pointer; font-size:23px; }
    .person-picker { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; } .person-picker button { border:1px solid var(--divider-color,#dfe4ec); border-radius:16px; padding:14px 8px; background:transparent; cursor:pointer; display:grid; justify-items:center; gap:8px; } .person-picker button:hover { border-color:#6c5ce7; background:#f3f1ff; } .person-picker small { color:#987300; font-weight:800; }
    .form { display:grid; gap:16px; } .form label { display:grid; gap:7px; color:var(--secondary-text-color,#657187); font-size:13px; font-weight:750; } .form input,.form select { width:100%; min-height:46px; border:1px solid var(--divider-color,#d5dbe5); border-radius:11px; padding:0 12px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#17233b); outline:none; } .form input:focus,.form select:focus { border-color:#6c5ce7; box-shadow:0 0 0 3px rgba(108,92,231,.14); }
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; } .form-row.three { grid-template-columns:1.4fr .7fr .7fr; } fieldset { border:0; padding:0; margin:0; } legend { margin-bottom:8px; font-size:13px; color:var(--secondary-text-color,#657187); font-weight:750; }
    .day-picker { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; } .day-picker label { display:block; } .day-picker input { position:absolute; opacity:0; pointer-events:none; } .day-picker span { aspect-ratio:1; display:grid; place-items:center; border:1px solid var(--divider-color,#d7dce5); border-radius:10px; cursor:pointer; } .day-picker input:checked+span { background:#6c5ce7; color:#fff; border-color:#6c5ce7; }
    .icon-field { display:grid; gap:8px; } .icon-picker { display:grid; grid-template-columns:repeat(6,1fr); gap:7px; } .icon-picker button { min-width:0; height:46px; border:1px solid var(--divider-color,#d7dce5); border-radius:11px; display:grid; place-items:center; background:var(--card-background-color,#fff); color:var(--secondary-text-color,#68758b); cursor:pointer; } .icon-picker button:hover { border-color:#9185e8; background:#f5f3ff; color:#5847cd; } .icon-picker button.selected { border-color:#6c5ce7; background:#ebe8ff; color:#4f3bc8; box-shadow:0 0 0 2px rgba(108,92,231,.15); } .icon-picker ha-icon { --mdc-icon-size:23px; }
    .target-field { display:grid; gap:8px; } .target-picker { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; } .target-picker label { position:relative; min-width:0; min-height:74px; padding:9px 6px; border:1px solid var(--divider-color,#d7dce5); border-radius:13px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; cursor:pointer; color:var(--primary-text-color,#17233b); } .target-picker input { position:absolute; opacity:0; pointer-events:none; } .target-picker label:has(input:checked) { border-color:#6c5ce7; background:#f0edff; box-shadow:0 0 0 2px rgba(108,92,231,.13); } .target-picker .avatar,.target-picker .shared-avatar { width:32px; height:32px; border-radius:10px; font-size:11px; } .target-picker strong { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; } .target-field>small { color:var(--secondary-text-color,#768196); font-size:12px; font-weight:500; }
    .submit { min-height:48px; border:0; border-radius:12px; background:#6c5ce7; color:#fff; cursor:pointer; font-weight:850; }
    .submit.full,.text-button.full { width:100%; margin-top:12px; }
    .text-button { min-height:40px; border:0; background:transparent; color:#5a49d3; cursor:pointer; font-weight:800; }
    .recovery-code { padding:18px 12px; border:1px dashed #8d80e9; border-radius:14px; background:#f2f0ff; color:#35269b; text-align:center; font:800 clamp(17px,4vw,24px)/1.2 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.08em; }
    .confirm-actions { display:flex; justify-content:flex-end; gap:10px; } .confirm-actions button { min-height:42px; border:1px solid var(--divider-color,#d8dde6); border-radius:10px; background:transparent; padding:0 16px; cursor:pointer; font-weight:800; } .confirm-actions .danger { background:#b83d4a; color:#fff; border-color:#b83d4a; }
    .toast { position:fixed; z-index:40; left:50%; bottom:24px; transform:translateX(-50%); min-width:220px; max-width:calc(100vw - 32px); padding:13px 18px; border-radius:13px; background:#17233b; color:#fff; text-align:center; font-weight:750; box-shadow:0 12px 35px rgba(0,0,0,.25); animation:toast-in .22s ease-out; }
    .star-layer { position:fixed; inset:0; z-index:35; pointer-events:none; overflow:hidden; } .star-layer span { position:absolute; left:50%; top:58%; color:#ffd43b; font-size:clamp(17px,3vw,34px); text-shadow:0 2px 0 #d59b00; animation:star-burst 1.15s cubic-bezier(.16,.8,.25,1) var(--delay) both; }
    .loading,.empty { grid-column:1/-1; display:grid; place-items:center; align-content:center; gap:12px; min-height:70vh; text-align:center; } .spinner { width:38px; height:38px; border:4px solid #dedaf8; border-top-color:#6c5ce7; border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } } @keyframes toast-in { from { opacity:0; transform:translate(-50%,12px); } } @keyframes star-burst { 0% { opacity:0; transform:translate(0,0) scale(.2) rotate(0); } 15% { opacity:1; } 100% { opacity:0; transform:translate(var(--x),var(--y)) scale(1.2) rotate(var(--r)); } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; transition-duration:.01ms!important; } }
    @media (max-width:1000px) { .shell { grid-template-columns:220px minmax(0,1fr); } header { grid-template-columns:auto 190px 1fr auto; } .chore-grid { grid-template-columns:repeat(2,minmax(220px,1fr)); } .parent-bar { align-items:flex-start; flex-direction:column; } }
    @media (max-width:720px) { .shell { display:block; } header { height:calc(68px + var(--safe-area-inset-top,env(safe-area-inset-top,0px))); display:flex; padding-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px)); padding-right:calc(10px + var(--safe-area-content-inset-right,var(--safe-area-inset-right,env(safe-area-inset-right,0px)))); padding-bottom:0; padding-left:calc(10px + var(--safe-area-content-inset-left,var(--safe-area-inset-left,env(safe-area-inset-left,0px)))); gap:7px; } .menu-button { width:48px; height:48px; flex:0 0 48px; } .brand { font-size:17px; gap:7px; white-space:nowrap; } .brand-star { display:grid; width:28px; height:28px; border-radius:9px; font-size:15px; } .date { display:none; } .parent-toggle { margin-left:auto; font-size:0; padding:0; width:48px; height:48px; flex:0 0 48px; } aside { padding:12px 14px; border-right:0; border-bottom:1px solid var(--divider-color,#e3e7ee); overflow-x:auto; } aside>.eyebrow,.family-total,.chev { display:none; } .members { display:flex; margin:0; gap:4px; } .member { display:flex; width:auto; min-width:max-content; padding:7px 10px; } .member-copy strong { max-width:110px; } .member-copy small { display:block; } .add-member { display:flex; margin:9px 0 0; width:auto; min-width:145px; } main { padding:0 14px calc(34px + var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))); } .tabs { height:54px; } .overview,.history-head { padding:25px 0 18px; display:block; } .progress-card { width:100%; margin-top:18px; } .chore-grid { grid-template-columns:1fr; } .chore-card { min-height:190px; } .parent-actions { justify-content:flex-start!important; } .activity-row { grid-template-columns:38px 1fr auto; } .undo { grid-column:2/-1; justify-self:start; padding:0; } .modal { padding:22px 18px; padding-bottom:calc(22px + var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))); border-radius:20px; } .person-picker { grid-template-columns:repeat(2,1fr); } .icon-picker { grid-template-columns:repeat(4,1fr); } .target-picker { grid-template-columns:repeat(2,1fr); } .form-row,.form-row.three { grid-template-columns:1fr; } }
  `; }
}

customElements.define("home-chores-panel", HomeChoresPanel);
