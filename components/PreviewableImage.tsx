"use client";

import { useEffect, useId, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";

interface PreviewableImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the lightbox dialog. */
  previewLabel?: string;
}

/**
 * Thumbnail that opens a true full-screen preview on click.
 * Shared by chat transcript images and markdown body images.
 */
export function PreviewableImage({
  src,
  alt = "",
  className,
  style,
  previewLabel,
}: PreviewableImageProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!src) return null;

  const openPreview = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };

  const closePreview = () => setOpen(false);

  const label = previewLabel || alt || "Image preview";

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={["previewable-image", className].filter(Boolean).join(" ")}
        style={style}
        onClick={openPreview}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && mounted && createPortal(
        <div
          className="image-preview-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={closePreview}
        >
          <span id={titleId} className="sr-only">{label}</span>
          <button
            type="button"
            className="image-preview-fullscreen-close"
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              closePreview();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="image-preview-fullscreen-img"
            src={src}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            draggable={false}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
