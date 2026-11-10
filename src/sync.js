// A single document per account, with an atomic comparison of revisions.
// The browser keeps a pending draft until a write is acknowledged.
export class DocumentSync {
  constructor({ remote, draft, onStatus, onApply, onCommit }) {
    this.remote = remote;
    this.draft = draft;
    this.onStatus = onStatus;
    this.onApply = onApply;
    this.onCommit = onCommit;
    this.revision = 0;
    this.updatedAt = null;
    this.lastDocument = null;
    this.pending = null;
    this.pendingRevision = 0;
    this.flight = null;
    this.reading = false;
    this.closed = false;
    this.conflict = false;
  }

  status(kind, error = null) {
    if (!this.closed)
      this.onStatus?.({ kind, error, updatedAt: this.updatedAt });
  }

  useRow(row) {
    this.revision = row?.revision ?? 0;
    this.updatedAt = row?.updatedAt ?? null;
    this.lastDocument = row?.state ?? null;
  }

  async start(fallback) {
    const row = await this.remote.read();
    if (this.closed) return fallback;
    this.useRow(row);
    const saved = this.draft.read();
    if (saved) {
      this.pending = saved.state;
      this.pendingRevision = saved.revision;
      this.conflict = saved.revision !== this.revision;
      this.status(this.conflict ? "conflict" : "pending");
      return saved.state;
    }
    this.status("connected");
    return row?.state ?? fallback;
  }

  queue(state) {
    if (this.closed) return Promise.resolve(false);
    if (!this.pending) this.pendingRevision = this.revision;
    this.pending = structuredClone(state);
    this.draft.write(this.pendingRevision, this.pending);
    this.status(this.conflict ? "conflict" : "pending");
    return this.flush();
  }

  flush() {
    if (this.closed || this.conflict) return Promise.resolve(false);
    if (this.flight) return this.flight;
    if (!this.pending) return Promise.resolve(true);
    this.flight = this.writePending().finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  async writePending() {
    while (this.pending && !this.closed) {
      const document = this.pending;
      this.status("saving");
      try {
        const result = await this.remote.write(document, this.pendingRevision);
        if (this.closed) return false;
        if (!result) {
          this.conflict = true;
          this.status("conflict");
          return false;
        }
        const previous = this.lastDocument;
        this.useRow({ ...result, state: document });
        this.pendingRevision = this.revision;
        if (this.pending === document) this.pending = null;
        if (this.pending) this.draft.write(this.revision, this.pending);
        else this.draft.clear();
        this.onCommit?.(previous, document);
        this.status(this.pending ? "pending" : "saved");
      } catch (error) {
        this.status("error", error);
        return false;
      }
    }
    return !this.closed;
  }

  async refresh(canApply = () => true) {
    if (this.closed || this.reading || this.pending || this.flight) return;
    this.reading = true;
    const revision = this.revision;
    try {
      const row = await this.remote.read();
      if (
        this.closed ||
        this.pending ||
        this.flight ||
        this.revision !== revision ||
        !canApply()
      )
        return;
      if (row && row.revision !== revision) {
        this.useRow(row);
        this.onApply?.(row.state);
      }
      this.status(this.updatedAt ? "saved" : "connected");
    } catch (error) {
      if (!this.pending) this.status("error", error);
    } finally {
      this.reading = false;
    }
  }

  async resolve(choice, fallback) {
    if (this.closed || !this.conflict || this.reading || this.flight)
      return false;
    this.reading = true;
    const pending = this.pending;
    try {
      const row = await this.remote.read();
      if (this.closed || this.pending !== pending) return false;
      this.useRow(row);
      this.conflict = false;
      if (choice === "local") {
        this.pendingRevision = this.revision;
        this.draft.write(this.revision, this.pending);
        return await this.flush();
      }
      this.pending = null;
      this.draft.clear();
      this.onApply?.(row?.state ?? fallback);
      this.status("connected");
      return true;
    } catch (error) {
      this.status(this.conflict ? "conflict" : "error", error);
      return false;
    } finally {
      this.reading = false;
    }
  }

  close() {
    this.closed = true;
  }
}
