"use client";

import { useState } from "react";
import ZapModal from "./ZapModal";

export default function ZapButton({
  recipientPubkey,
  label,
  eventId,
  aTag,
  episodeGuid,
  onZapped,
  className,
  children,
}) {
  const [open, setOpen] = useState(false);

  if (!recipientPubkey) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {children || "⚡ ZAP"}
      </button>
      {open && (
        <ZapModal
          recipientPubkey={recipientPubkey}
          label={label}
          eventId={eventId}
          aTag={aTag}
          episodeGuid={episodeGuid}
          onZapped={onZapped}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
