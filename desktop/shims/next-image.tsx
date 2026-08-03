/**
 * next/image → plain img for desktop SPA.
 */
import type { CSSProperties, ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  style?: CSSProperties;
};

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  style,
  priority: _priority,
  ...rest
}: ImageProps) {
  const mergedStyle: CSSProperties = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style }
    : { ...style };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      style={mergedStyle}
      {...rest}
    />
  );
}
