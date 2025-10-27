import { useState } from "react";
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";
import toast from "react-hot-toast";

interface CopyableProps {
  value: string;
  display?: string;
  className?: string;
}

export function Copyable({ value, display, className }: CopyableProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast.error("Unable to copy");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-800/60 px-3 py-1 text-sm text-slate-200 transition hover:border-primary-400 hover:text-primary-200",
        className,
      )}
    >
      <span className="font-mono text-xs md:text-sm">{display ?? value}</span>
      {copied ? (
        <ClipboardDocumentCheckIcon className="h-4 w-4 text-primary-300" />
      ) : (
        <ClipboardDocumentIcon className="h-4 w-4 text-slate-400" />
      )}
    </button>
  );
}
