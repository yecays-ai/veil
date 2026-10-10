// Presentational only: ChatRoom owns the selection state and every handler passed in here.
export function ChatMultiSelectBar({ selectedCount, canSelectFromHere, onSelectAll, onSelectFromHere, onDelete, onCancel }: {
  selectedCount: number;
  canSelectFromHere: boolean;
  onSelectAll: () => void;
  onSelectFromHere: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="chat-multi-select-bar">
      <span>{selectedCount} selected</span>
      <button type="button" onClick={onSelectAll}>Select all</button>
      <button type="button" disabled={!canSelectFromHere} onClick={onSelectFromHere}>
        Select from here to latest
      </button>
      <button type="button" className="chat-danger" disabled={!selectedCount} onClick={onDelete}>Delete selected</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}
