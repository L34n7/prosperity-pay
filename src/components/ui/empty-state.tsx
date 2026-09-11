import { SearchX } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span><SearchX size={22} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
