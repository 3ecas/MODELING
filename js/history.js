// Snapshot-based undo/redo. The whole document is small, so each step stores its full JSON.

export class History {
  constructor(model, { limit = 100 } = {}) {
    this.model = model;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.current = JSON.stringify(model.toJSON());
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  /** Call after any user-visible change has been fully applied. */
  commit() {
    const snap = JSON.stringify(this.model.toJSON());
    if (snap === this.current) return;
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.current = snap;
    this._emit();
  }

  /** Resets the baseline without creating an undo step (after New / Open). */
  reset() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.current = JSON.stringify(this.model.toJSON());
    this._emit();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo) return false;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    this.model.fromJSON(JSON.parse(this.current));
    this._emit();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    this.model.fromJSON(JSON.parse(this.current));
    this._emit();
    return true;
  }
}
