export function QuoteBubble({ preview, author }: { preview: string; author?: string }) {
  return <span className="chat-quote-preview">
    {author && <strong>{author}</strong>}
    <span>{preview}</span>
  </span>;
}
