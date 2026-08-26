"use client";

import { useState } from "react";

export default function ImageGallery({ images, alt, className }) {
  const [index, setIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-ink/5 ${className || ""}`}>
        <span className="font-display text-xs tracking-widest text-ink/40">
          NO IMAGE
        </span>
      </div>
    );
  }

  const hasMultiple = images.length > 1;

  function prev(e) {
    e.stopPropagation();
    setIndex((i) => (i - 1 + images.length) % images.length);
  }

  function next(e) {
    e.stopPropagation();
    setIndex((i) => (i + 1) % images.length);
  }

  return (
    <div className={`group relative overflow-hidden ${className || ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[index]} alt={alt || ""} className="h-full w-full object-cover" />

      {hasMultiple && (
        <>
          <button
            onClick={prev}
            aria-label="Previous photo"
            className="absolute left-0 top-0 flex h-full w-1/3 items-center justify-start bg-gradient-to-r from-ink/30 to-transparent px-2 opacity-0 transition group-hover:opacity-100"
          >
            <span className="font-display text-lg text-paper">&larr;</span>
          </button>
          <button
            onClick={next}
            aria-label="Next photo"
            className="absolute right-0 top-0 flex h-full w-1/3 items-center justify-end bg-gradient-to-l from-ink/30 to-transparent px-2 opacity-0 transition group-hover:opacity-100"
          >
            <span className="font-display text-lg text-paper">&rarr;</span>
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
                aria-label={`Photo ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === index ? "bg-paper" : "bg-paper/40"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
