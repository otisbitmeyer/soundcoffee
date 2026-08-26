"use client";

import { useState, useRef } from "react";
import { uploadToNostrBuild } from "@/lib/nostrBuild";

export default function ImageUploadField({ value, onChange, compact }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadToNostrBuild(file);
      onChange(url);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-2"}>
      {value ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className={compact ? "h-10 w-10 border border-ink/30 object-cover" : "h-20 w-20 border-2 border-ink/30 object-cover"}
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="font-display text-xs text-rust hover:text-ink"
          >
            REMOVE
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={
            compact
              ? "border-2 border-ink/30 px-2 py-1.5 font-display text-xs text-ink hover:border-ink disabled:opacity-50"
              : "border-2 border-ink/30 px-3 py-2 font-display text-xs tracking-widest text-ink hover:border-ink disabled:opacity-50"
          }
        >
          {uploading ? "UPLOADING…" : "📷 UPLOAD PHOTO"}
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      {error && <p className="font-serif text-xs text-rust">{error}</p>}
    </div>
  );
}
