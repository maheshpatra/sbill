import Image from "next/image";

/** Designer artwork shown whole at its native aspect ratio. */
export function ImageSlot({
  file,
  width,
  height,
  label,
  priority = false,
  className = "",
}: {
  file: string;
  width: number;
  height: number;
  label: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={file}
      alt={label}
      width={width}
      height={height}
      priority={priority}
      sizes="(min-width: 1024px) 720px, 100vw"
      className={`block h-auto w-full bg-[#f7f8f6] object-contain ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
}
